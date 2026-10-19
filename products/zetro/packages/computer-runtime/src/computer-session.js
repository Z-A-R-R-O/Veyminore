/**
 * @file computer-session.js
 * Read-only Computer session lifecycle core (OCR-2).
 * All side effects flow through injected ports; this module performs no desktop
 * calls and injects no input. Expiry and revocation are re-checked at effect time,
 * after the awaited authority decision and before the observer runs.
 */

export const SessionState = Object.freeze({
  ACTIVE: 'active',
  REVOKED: 'revoked',
  STOPPED: 'stopped'
});

export const SessionErrorCode = Object.freeze({
  MISSING_PRINCIPAL: 'missing_principal',
  MISSING_TOKEN: 'missing_token',
  MISSING_SESSION: 'missing_session',
  INVALID_TOKEN: 'invalid_token',
  PRINCIPAL_MISMATCH: 'principal_mismatch',
  SESSION_NOT_FOUND: 'session_not_found',
  SESSION_EXPIRED: 'session_expired',
  SESSION_REVOKED: 'session_revoked',
  SESSION_STOPPED: 'session_stopped',
  TARGET_MISMATCH: 'target_mismatch',
  AUTHORITY_DENIED: 'authority_denied',
  AUTHORITY_UNAVAILABLE: 'authority_unavailable',
  OBSERVER_FAILED: 'observer_failed',
  OBSERVATION_CANCELLED: 'observation_cancelled',
  OBSERVATION_LIMIT_EXCEEDED: 'observation_limit_exceeded',
  CONCURRENCY_LIMIT_EXCEEDED: 'concurrency_limit_exceeded',
  AUTHORITY_TIMEOUT: 'authority_timeout',
  OBSERVER_TIMEOUT: 'observer_timeout',
  INVALID_OBSERVATION_SCHEMA: 'invalid_observation_schema',
  CONTRACT_INVALID: 'contract_invalid'
});

export const AuditEventType = Object.freeze({
  SESSION_STARTED: 'session_started',
  SESSION_STATUS: 'session_status',
  OBSERVATION_DELIVERED: 'observation_delivered',
  OBSERVATION_CANCELLED: 'observation_cancelled',
  OBSERVATION_DENIED: 'observation_denied',
  SESSION_REVOKED: 'session_revoked',
  SESSION_STOPPED: 'session_stopped',
  OPERATION_DENIED: 'operation_denied'
});

const DEFAULT_LIMITS = Object.freeze({
  maxObservationsPerSession: 64,
  maxFramesPerObservation: 1,
  maxBytesPerObservation: 4 * 1024 * 1024,
  maxFrameInlineBytes: 1024 * 1024,
  maxStringFieldBytes: 256,
  maxMetadataBytes: 4096,
  maxConcurrentObservationsPerSession: 1,
  authorityTimeoutMs: 5_000,
  observerTimeoutMs: 10_000,
  defaultTtlMs: 600_000,
  minTtlMs: 1_000,
  maxTtlMs: 3_600_000
});

function fail(code, details) {
  return { ok: false, code, ...(details ? { details } : {}) };
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

const TIMEOUT = Symbol('zetro.operation_timeout');

function timeoutError(ms) {
  const err = new Error(`operation timed out after ${ms}ms`);
  err.code = TIMEOUT;
  return err;
}

function isTimeout(err) {
  return Boolean(err) && err.code === TIMEOUT;
}

async function withTimeout(promise, ms, onTimeout) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (typeof onTimeout === 'function') {
        try { onTimeout(); } catch { /* abort hooks must not mask the timeout */ }
      }
      reject(timeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function contentByteLength(data) {
  if (data instanceof Uint8Array) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (typeof data === 'string') return new TextEncoder().encode(data).length;
  return null;
}

const RESULT_FIELD_WHITELIST = new Set(['frames', 'bytes']);
const FRAME_FIELD_WHITELIST = new Set(['id', 'data', 'metadata']);
const METADATA_FIELD_WHITELIST = new Set(['format', 'bytes', 'size', 'contentLength', 'capturedAt']);

/**
 * @typedef {object} ComputerSessionPorts
 * @property {{ now(): number }} clock
 * @property {{ verify(args: { token: string, principalId: string, sessionId?: string }):
 *   ({ valid: true, principalId: string, claims?: object } | { valid: false, reason?: string }) }} tokenVerifier
 * @property {{ evaluateScreenCapture(params: object, options?: object):
 *   ({ allowed: boolean, reason?: string, grantId?: string, details?: object }) }} authorityPort
 * @property {{ capture(args: { sessionId: string, displayId: string|number, frames: number,
 *   maxBytes: number, signal: { aborted: boolean, onAbort(cb: () => void): void } }):
 *   Promise<{ frames: object[], bytes: number }> }} observer
 * @property {{ write(event: object): void }} auditSink
 * @property {{ validate(operation: string, payload: object): ({ valid: boolean, errors?: string[] }) }} [validationPort]
 * @property {(prefix: string) => string} [idFactory]
 * @property {Partial<typeof DEFAULT_LIMITS>} [limits]
 */

export class ComputerSession {
  /**
   * @param {ComputerSessionPorts} ports
   */
  constructor(ports) {
    if (!ports || typeof ports !== 'object') {
      throw new Error('ComputerSession requires an injected ports object');
    }
    for (const name of ['clock', 'tokenVerifier', 'authorityPort', 'observer', 'auditSink']) {
      if (!ports[name] || typeof ports[name] !== 'object') {
        throw new Error(`ComputerSession requires an injected ${name} port`);
      }
    }
    this._clock = ports.clock;
    this._verifier = ports.tokenVerifier;
    this._authority = ports.authorityPort;
    this._observer = ports.observer;
    this._audit = ports.auditSink;
    this._validationPort = ports.validationPort ?? null;
    this._idFactory = typeof ports.idFactory === 'function'
      ? ports.idFactory
      : (prefix) => `${prefix}-${this._seq++}`;
    this._limits = { ...DEFAULT_LIMITS, ...(ports.limits || {}) };
    this._seq = 1;
    /** @type {Map<string, object>} */
    this._sessions = new Map();
    /** @type {Map<string, Set<{ cancel: (reason: string) => void }>>} */
    this._pending = new Map();
  }

  now() {
    return this._clock.now();
  }

  /** Returns the derived session record (read-only snapshot) or null. */
  getSession(sessionId) {
    const s = this._sessions.get(sessionId);
    return s ? this._snapshot(s) : null;
  }

  /**
   * Authenticates a call. Worker-supplied labels never verify: the verifier's
   * resolved principal must equal the claimed principal and (when present)
   * the session's principal.
   */
  _authenticate({ token, principalId, sessionId }) {
    if (!isNonEmptyString(principalId)) {
      return fail(SessionErrorCode.MISSING_PRINCIPAL);
    }
    if (!isNonEmptyString(token)) {
      return fail(SessionErrorCode.MISSING_TOKEN);
    }
    let verdict;
    try {
      verdict = this._verifier.verify({ token, principalId, sessionId });
    } catch {
      return fail(SessionErrorCode.INVALID_TOKEN);
    }
    if (!verdict || verdict.valid !== true || !isNonEmptyString(verdict.principalId)) {
      return fail(SessionErrorCode.INVALID_TOKEN, { reason: verdict?.reason ?? 'unverified' });
    }
    if (verdict.principalId !== principalId) {
      return fail(SessionErrorCode.PRINCIPAL_MISMATCH, {
        claimed: principalId,
        resolved: verdict.principalId
      });
    }
    return { ok: true, principalId: verdict.principalId, claims: verdict.claims ?? {} };
  }

  _contract(operation, payload) {
    if (!this._validationPort) return { ok: true };
    let verdict;
    try {
      verdict = this._validationPort.validate(operation, payload);
    } catch (err) {
      return fail(SessionErrorCode.CONTRACT_INVALID, { error: String(err?.message ?? err) });
    }
    if (!verdict || verdict.valid !== true) {
      return fail(SessionErrorCode.CONTRACT_INVALID, { errors: verdict?.errors ?? ['invalid'] });
    }
    return { ok: true };
  }

  _resolveCorrelation(correlationId) {
    return isNonEmptyString(correlationId)
      ? correlationId
      : this._idFactory('corr');
  }

  _auditEmit(event) {
    this._audit.write({ at: this._clock.now(), ...event });
  }

  _denyAudit(type, correlationId, principalId, sessionId, code, details) {
    this._auditEmit({
      type: AuditEventType.OPERATION_DENIED,
      operation: type,
      correlationId,
      principalId: principalId ?? null,
      sessionId: sessionId ?? null,
      code,
      details: details ?? null
    });
  }

  _snapshot(s) {
    return {
      sessionId: s.sessionId,
      principalId: s.principalId,
      targetDisplayId: s.targetDisplayId,
      state: s.state,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      observationCount: s.observationCount,
      revokeReason: s.revokeReason ?? null,
      stopReason: s.stopReason ?? null
    };
  }

  /** Derived lifecycle state; expiry is checked against the injected clock. */
  _derivedState(s) {
    if (s.state !== SessionState.ACTIVE) return s.state;
    return this._clock.now() >= s.expiresAt ? 'expired' : SessionState.ACTIVE;
  }

  /** Effect-time gate: expiry, revocation, stop. Fail-closed. */
  _effectGate(s) {
    if (s.state === SessionState.STOPPED) {
      return fail(SessionErrorCode.SESSION_STOPPED, { stopReason: s.stopReason ?? null });
    }
    if (s.state === SessionState.REVOKED) {
      return fail(SessionErrorCode.SESSION_REVOKED, { revokeReason: s.revokeReason ?? null });
    }
    const now = this._clock.now();
    if (now >= s.expiresAt) {
      return fail(SessionErrorCode.SESSION_EXPIRED, {
        expiresAt: s.expiresAt,
        currentTime: now
      });
    }
    return { ok: true };
  }

  _checkSessionRef({ principalId, sessionId }) {
    if (!isNonEmptyString(sessionId)) {
      return fail(SessionErrorCode.MISSING_SESSION);
    }
    const s = this._sessions.get(sessionId);
    if (!s) {
      return fail(SessionErrorCode.SESSION_NOT_FOUND, { sessionId });
    }
    if (s.principalId !== principalId) {
      return fail(SessionErrorCode.PRINCIPAL_MISMATCH, {
        sessionId,
        sessionPrincipal: s.principalId,
        claimed: principalId
      });
    }
    return { ok: true, session: s };
  }

  /**
   * Starts a read-only session bound to a principal and target display.
   * @param {{ token: string, principalId: string, targetDisplayId?: string|number,
   *   ttlMs?: number, correlationId?: string }} req
   */
  start(req = {}) {
    const correlationId = this._resolveCorrelation(req.correlationId);
    const auth = this._authenticate(req);
    if (!auth.ok) {
      this._denyAudit('start', correlationId, req.principalId, null, auth.code, auth.details);
      return auth;
    }
    const contract = this._contract('session.start', {
      principalId: auth.principalId,
      targetDisplayId: req.targetDisplayId ?? 0,
      ttlMs: req.ttlMs ?? this._limits.defaultTtlMs
    });
    if (!contract.ok) {
      this._denyAudit('start', correlationId, auth.principalId, null, contract.code, contract.details);
      return contract;
    }
    const ttlRaw = req.ttlMs ?? this._limits.defaultTtlMs;
    if (typeof ttlRaw !== 'number' || !Number.isFinite(ttlRaw)
      || ttlRaw < this._limits.minTtlMs || ttlRaw > this._limits.maxTtlMs) {
      this._denyAudit('start', correlationId, auth.principalId, null,
        SessionErrorCode.CONTRACT_INVALID, { ttlMs: ttlRaw });
      return fail(SessionErrorCode.CONTRACT_INVALID, { ttlMs: ttlRaw });
    }
    const now = this._clock.now();
    const session = {
      sessionId: this._idFactory('csession'),
      principalId: auth.principalId,
      targetDisplayId: req.targetDisplayId ?? 0,
      state: SessionState.ACTIVE,
      createdAt: now,
      expiresAt: now + ttlRaw,
      observationCount: 0,
      reservedCount: 0,
      inFlight: 0,
      revokeReason: null,
      stopReason: null
    };
    this._sessions.set(session.sessionId, session);
    this._pending.set(session.sessionId, new Set());
    this._auditEmit({
      type: AuditEventType.SESSION_STARTED,
      operation: 'start',
      correlationId,
      principalId: session.principalId,
      sessionId: session.sessionId,
      targetDisplayId: session.targetDisplayId,
      expiresAt: session.expiresAt
    });
    return { ok: true, correlationId, session: this._snapshot(session) };
  }

  /**
   * Returns lifecycle status. Authenticated; does not hit the observer.
   * @param {{ token: string, principalId: string, sessionId: string, correlationId?: string }} req
   */
  status(req = {}) {
    const correlationId = this._resolveCorrelation(req.correlationId);
    const auth = this._authenticate(req);
    if (!auth.ok) {
      this._denyAudit('status', correlationId, req.principalId, req.sessionId ?? null, auth.code, auth.details);
      return auth;
    }
    const ref = this._checkSessionRef({ principalId: auth.principalId, sessionId: req.sessionId });
    if (!ref.ok) {
      this._denyAudit('status', correlationId, auth.principalId, req.sessionId ?? null, ref.code, ref.details);
      return ref;
    }
    const s = ref.session;
    const derived = this._derivedState(s);
    this._auditEmit({
      type: AuditEventType.SESSION_STATUS,
      operation: 'status',
      correlationId,
      principalId: s.principalId,
      sessionId: s.sessionId,
      state: derived
    });
    return {
      ok: true,
      correlationId,
      state: derived,
      session: this._snapshot(s)
    };
  }

  /**
   * Bounded, read-only observation. Authority is awaited first; expiry and
   * revocation are re-checked at effect time, after that await and before the
   * observer runs. Revocation/stop during the await cancels deterministically.
   * @param {{ token: string, principalId: string, sessionId: string,
   *   displayId?: string|number, frames?: number, correlationId?: string }} req
   */
  async observe(req = {}) {
    const correlationId = this._resolveCorrelation(req.correlationId);
    const auth = this._authenticate(req);
    if (!auth.ok) {
      this._denyAudit('observe', correlationId, req.principalId, req.sessionId ?? null, auth.code, auth.details);
      return auth;
    }
    const contract = this._contract('session.observe', {
      sessionId: req.sessionId,
      displayId: req.displayId ?? 0,
      frames: req.frames ?? 1
    });
    if (!contract.ok) {
      this._denyAudit('observe', correlationId, auth.principalId, req.sessionId ?? null, contract.code, contract.details);
      return contract;
    }
    const ref = this._checkSessionRef({ principalId: auth.principalId, sessionId: req.sessionId });
    if (!ref.ok) {
      this._denyAudit('observe', correlationId, auth.principalId, req.sessionId ?? null, ref.code, ref.details);
      return ref;
    }
    const s = ref.session;

    // Pre-effect gate before spending the authority round-trip.
    const preGate = this._effectGate(s);
    if (!preGate.ok) {
      this._denyAudit('observe', correlationId, s.principalId, s.sessionId, preGate.code, preGate.details);
      return preGate;
    }

    const displayId = req.displayId ?? 0;
    if (String(displayId) !== String(s.targetDisplayId)) {
      this._denyAudit('observe', correlationId, s.principalId, s.sessionId,
        SessionErrorCode.TARGET_MISMATCH, { requested: displayId, bound: s.targetDisplayId });
      return fail(SessionErrorCode.TARGET_MISMATCH, {
        requestedDisplayId: displayId,
        boundDisplayId: s.targetDisplayId
      });
    }

    const framesRaw = req.frames ?? 1;
    const frames = Math.min(
      Math.max(1, Math.floor(typeof framesRaw === 'number' && Number.isFinite(framesRaw) ? framesRaw : 1)),
      this._limits.maxFramesPerObservation
    );

    // Quota reservation BEFORE any await: delivered+reserved bound and
    // concurrency bound are enforced at admission, not after settle.
    if (s.observationCount + s.reservedCount >= this._limits.maxObservationsPerSession) {
      this._denyAudit('observe', correlationId, s.principalId, s.sessionId,
        SessionErrorCode.OBSERVATION_LIMIT_EXCEEDED,
        { observationCount: s.observationCount, reservedCount: s.reservedCount });
      return fail(SessionErrorCode.OBSERVATION_LIMIT_EXCEEDED, {
        observationCount: s.observationCount,
        reservedCount: s.reservedCount,
        limit: this._limits.maxObservationsPerSession
      });
    }
    if (s.inFlight >= this._limits.maxConcurrentObservationsPerSession) {
      this._denyAudit('observe', correlationId, s.principalId, s.sessionId,
        SessionErrorCode.CONCURRENCY_LIMIT_EXCEEDED, { inFlight: s.inFlight });
      return fail(SessionErrorCode.CONCURRENCY_LIMIT_EXCEEDED, {
        inFlight: s.inFlight,
        limit: this._limits.maxConcurrentObservationsPerSession
      });
    }
    s.reservedCount += 1;
    s.inFlight += 1;
    const release = () => {
      s.reservedCount -= 1;
      s.inFlight -= 1;
    };

    // Awaited authority decision (shared port). Literal `allowed === true` only;
    // errors and hangs are caught and bounded. The port is never trusted to settle.
    let authority;
    try {
      authority = await withTimeout(
        Promise.resolve().then(() => this._authority.evaluateScreenCapture({
          principalId: s.principalId,
          sessionId: s.sessionId,
          displayId,
          frames
        })),
        this._limits.authorityTimeoutMs
      );
    } catch (err) {
      release();
      if (isTimeout(err)) {
        this._denyAudit('observe', correlationId, s.principalId, s.sessionId,
          SessionErrorCode.AUTHORITY_TIMEOUT, { timeoutMs: this._limits.authorityTimeoutMs });
        return fail(SessionErrorCode.AUTHORITY_TIMEOUT, { timeoutMs: this._limits.authorityTimeoutMs });
      }
      this._denyAudit('observe', correlationId, s.principalId, s.sessionId,
        SessionErrorCode.AUTHORITY_UNAVAILABLE, { error: String(err?.message ?? err) });
      return fail(SessionErrorCode.AUTHORITY_UNAVAILABLE, { error: String(err?.message ?? err) });
    }
    if (!authority || authority.allowed !== true) {
      release();
      this._auditEmit({
        type: AuditEventType.OBSERVATION_DENIED,
        operation: 'observe',
        correlationId,
        principalId: s.principalId,
        sessionId: s.sessionId,
        reason: authority?.reason ?? 'denied',
        details: authority?.details ?? null
      });
      return fail(SessionErrorCode.AUTHORITY_DENIED, {
        reason: authority?.reason ?? 'denied',
        grantId: authority?.grantId ?? null,
        details: authority?.details ?? null
      });
    }

    // Effect-time recheck AFTER the awaited authority call: expiry, revocation, stop.
    const gate = this._effectGate(s);
    if (!gate.ok) {
      release();
      this._denyAudit('observe', correlationId, s.principalId, s.sessionId, gate.code, gate.details);
      return gate;
    }

    // Register pending observation for deterministic cancellation on revoke/stop.
    const pendingSet = this._pending.get(s.sessionId) ?? new Set();
    this._pending.set(s.sessionId, pendingSet);
    let cancelledReason = null;
    const signal = {
      aborted: false,
      onAbort(cb) {
        if (this.aborted) cb();
        else this._cbs.push(cb);
      },
      _cbs: [],
      _abort(reason) {
        if (this.aborted) return;
        this.aborted = true;
        cancelledReason = reason;
        for (const cb of this._cbs.splice(0)) {
          try { cb(); } catch { /* observer-side abort hooks must not break the core */ }
        }
      }
    };
    const entry = {
      cancel: (reason) => signal._abort(reason)
    };
    pendingSet.add(entry);

    let captured = null;
    let timedOut = false;
    try {
      captured = await withTimeout(
        this._observer.capture({
          sessionId: s.sessionId,
          displayId,
          frames,
          maxBytes: this._limits.maxBytesPerObservation,
          signal
        }),
        this._limits.observerTimeoutMs,
        () => {
          timedOut = true;
          signal._abort(SessionErrorCode.OBSERVER_TIMEOUT);
        }
      );
    } catch (err) {
      pendingSet.delete(entry);
      release();
      if (timedOut) {
        this._denyAudit('observe', correlationId, s.principalId, s.sessionId,
          SessionErrorCode.OBSERVER_TIMEOUT, { timeoutMs: this._limits.observerTimeoutMs });
        return fail(SessionErrorCode.OBSERVER_TIMEOUT, { timeoutMs: this._limits.observerTimeoutMs });
      }
      if (cancelledReason || signal.aborted) {
        this._auditEmit({
          type: AuditEventType.OBSERVATION_CANCELLED,
          operation: 'observe',
          correlationId,
          principalId: s.principalId,
          sessionId: s.sessionId,
          reason: cancelledReason ?? SessionErrorCode.OBSERVATION_CANCELLED
        });
        return fail(SessionErrorCode.OBSERVATION_CANCELLED, {
          reason: cancelledReason ?? SessionErrorCode.OBSERVATION_CANCELLED
        });
      }
      this._denyAudit('observe', correlationId, s.principalId, s.sessionId,
        SessionErrorCode.OBSERVER_FAILED, { error: String(err?.message ?? err) });
      return fail(SessionErrorCode.OBSERVER_FAILED, { error: String(err?.message ?? err) });
    }
    pendingSet.delete(entry);
    release();

    // Post-await gate: hung-port timeouts, cancelled observers, or state
    // changed while capturing. Revoke/stop/expiry gates are preserved here.
    if (timedOut) {
      this._denyAudit('observe', correlationId, s.principalId, s.sessionId,
        SessionErrorCode.OBSERVER_TIMEOUT, { timeoutMs: this._limits.observerTimeoutMs });
      return fail(SessionErrorCode.OBSERVER_TIMEOUT, { timeoutMs: this._limits.observerTimeoutMs });
    }
    if (cancelledReason || signal.aborted) {
      this._auditEmit({
        type: AuditEventType.OBSERVATION_CANCELLED,
        operation: 'observe',
        correlationId,
        principalId: s.principalId,
        sessionId: s.sessionId,
        reason: cancelledReason ?? SessionErrorCode.OBSERVATION_CANCELLED
      });
      return fail(SessionErrorCode.OBSERVATION_CANCELLED, {
        reason: cancelledReason ?? SessionErrorCode.OBSERVATION_CANCELLED
      });
    }
    const postGate = this._effectGate(s);
    if (!postGate.ok) {
      this._denyAudit('observe', correlationId, s.principalId, s.sessionId, postGate.code, postGate.details);
      return postGate;
    }

    const verdict = this._validateObservation(captured, frames);
    if (!verdict.ok) {
      this._denyAudit('observe', correlationId, s.principalId, s.sessionId, verdict.code, verdict.details);
      return verdict;
    }

    s.observationCount += 1;
    this._auditEmit({
      type: AuditEventType.OBSERVATION_DELIVERED,
      operation: 'observe',
      correlationId,
      principalId: s.principalId,
      sessionId: s.sessionId,
      displayId,
      frames: verdict.frameCount,
      bytes: verdict.actualBytes,
      grantId: authority.grantId ?? null
    });
    return {
      ok: true,
      correlationId,
      frames: verdict.frames,
      bytes: verdict.actualBytes,
      observationIndex: s.observationCount
    };
  }

  /**
   * Strict observation schema with whitelisted fields and sanitized output.
   * Declared size metadata is validated but never trusted: bounds are enforced
   * against actual measured content bytes plus serialized metadata bytes.
   * Unknown nested fields and unbounded strings are rejected fail-closed, and
   * the returned frames contain only whitelisted, sanitized fields.
   */
  _validateObservation(captured, framesAllowed) {
    const bad = (reason, details) => ({
      ok: false,
      code: SessionErrorCode.INVALID_OBSERVATION_SCHEMA,
      details: { reason, ...(details || {}) }
    });
    const boundedString = (v, where) => {
      if (typeof v !== 'string') {
        return bad('string_field_invalid', where);
      }
      if (v.length > this._limits.maxStringFieldBytes) {
        return bad('unbounded_string',
          { ...where, length: v.length, max: this._limits.maxStringFieldBytes });
      }
      return { ok: true };
    };
    if (!captured || typeof captured !== 'object' || Array.isArray(captured)) {
      return bad('captured_not_object');
    }
    for (const key of Object.keys(captured)) {
      if (!RESULT_FIELD_WHITELIST.has(key)) {
        return bad('unknown_result_field', { field: key });
      }
    }
    if (!Array.isArray(captured.frames)) {
      return bad('frames_not_array');
    }
    if (captured.frames.length > framesAllowed) {
      return bad('frames_exceed_allotment', { frameCount: captured.frames.length, framesAllowed });
    }
    if (captured.bytes !== undefined && captured.bytes !== null
      && (!Number.isInteger(captured.bytes) || captured.bytes < 0)) {
      return bad('declared_size_not_non_negative_integer', { field: 'bytes', value: captured.bytes });
    }
    const declaredKeys = ['bytes', 'size', 'contentLength'];
    let actualBytes = 0;
    const sanitizedFrames = [];
    for (let i = 0; i < captured.frames.length; i += 1) {
      const frame = captured.frames[i];
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
        return bad('frame_not_object', { index: i });
      }
      for (const key of Object.keys(frame)) {
        if (!FRAME_FIELD_WHITELIST.has(key)) {
          return bad('unknown_frame_field', { index: i, field: key });
        }
      }
      const sanitized = {};
      if (frame.id !== undefined) {
        if (frame.id === null) {
          return bad('string_field_invalid', { index: i, field: 'id' });
        }
        const check = boundedString(frame.id, { index: i, field: 'id' });
        if (!check.ok) return check;
        sanitized.id = frame.id;
      }
      for (const key of declaredKeys) {
        const v = frame[key];
        if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0)) {
          return bad('declared_size_not_non_negative_integer', { index: i, field: key, value: v });
        }
      }
      let metaBytes = 0;
      if (frame.metadata !== undefined) {
        if (frame.metadata === null || typeof frame.metadata !== 'object' || Array.isArray(frame.metadata)) {
          return bad('metadata_not_object', { index: i });
        }
        const meta = frame.metadata;
        const sanitizedMeta = {};
        for (const key of Object.keys(meta)) {
          if (!METADATA_FIELD_WHITELIST.has(key)) {
            return bad('unknown_metadata_field', { index: i, field: `metadata.${key}` });
          }
        }
        for (const key of declaredKeys) {
          const v = meta[key];
          if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0)) {
            return bad('declared_size_not_non_negative_integer',
              { index: i, field: `metadata.${key}`, value: v });
          }
          if (v !== undefined && v !== null) {
            sanitizedMeta[key] = v;
          }
        }
        if (meta.capturedAt !== undefined) {
          if (meta.capturedAt === null || !Number.isInteger(meta.capturedAt) || meta.capturedAt < 0) {
            return bad('declared_size_not_non_negative_integer',
              { index: i, field: 'metadata.capturedAt', value: meta.capturedAt });
          }
          sanitizedMeta.capturedAt = meta.capturedAt;
        }
        if (meta.format !== undefined) {
          if (meta.format === null) {
            return bad('string_field_invalid', { index: i, field: 'metadata.format' });
          }
          const check = boundedString(meta.format, { index: i, field: 'metadata.format' });
          if (!check.ok) return check;
          sanitizedMeta.format = meta.format;
        }
        // Serialized metadata is measured too — nested payloads cannot bypass bounds.
        metaBytes = new TextEncoder().encode(JSON.stringify(sanitizedMeta)).length;
        if (metaBytes > this._limits.maxMetadataBytes) {
          return bad('metadata_exceeds_limit',
            { index: i, actualBytes: metaBytes, maxMetadataBytes: this._limits.maxMetadataBytes });
        }
        sanitized.metadata = sanitizedMeta;
      }
      let frameBytes = 0;
      if (frame.data !== undefined && frame.data !== null) {
        const n = contentByteLength(frame.data);
        if (n === null) {
          return bad('unbounded_frame_data', {
            index: i,
            hint: 'inline object/array frame.data is rejected; use bounded binary or string content'
          });
        }
        if (n > this._limits.maxFrameInlineBytes) {
          return bad('unbounded_frame_data', {
            index: i,
            actualBytes: n,
            maxFrameInlineBytes: this._limits.maxFrameInlineBytes
          });
        }
        frameBytes = n;
        // Declared sizes must agree with measured content, never substitute for it.
        const declareds = [frame.bytes, frame.size,
          frame.metadata?.bytes, frame.metadata?.size, frame.metadata?.contentLength];
        for (const d of declareds) {
          if (d !== undefined && d !== null && d !== frameBytes) {
            return bad('declared_size_mismatch', { index: i, declared: d, actual: frameBytes });
          }
        }
        sanitized.data = frame.data;
      }
      // Count ALL delivered sanitized frame material (id, metadata, serialized
      // keys) as the UTF-8 byte length of the sanitized serializable frame,
      // plus measured data content. Character counts are never used.
      const { data: _dropped, ...serializable } = sanitized;
      const overheadBytes = new TextEncoder().encode(JSON.stringify(serializable)).length;
      actualBytes += frameBytes + overheadBytes;
      sanitizedFrames.push(sanitized);
    }
    if (actualBytes > this._limits.maxBytesPerObservation) {
      return {
        ok: false,
        code: SessionErrorCode.OBSERVER_FAILED,
        details: {
          reason: 'observer_exceeded_bounds',
          actualBytes,
          maxBytes: this._limits.maxBytesPerObservation
        }
      };
    }
    return { ok: true, actualBytes, frameCount: captured.frames.length, frames: sanitizedFrames };
  }

  /**
   * Revokes a session. Cancels all pending observations deterministically.
   * @param {{ token: string, principalId: string, sessionId: string, reason?: string, correlationId?: string }} req
   */
  revoke(req = {}) {
    return this._terminate(req, 'revoke');
  }

  /**
   * Emergency stop. Terminal; cancels all pending observations deterministically.
   * @param {{ token: string, principalId: string, sessionId: string, reason?: string, correlationId?: string }} req
   */
  emergencyStop(req = {}) {
    return this._terminate(req, 'stop');
  }

  _terminate(req, mode) {
    const correlationId = this._resolveCorrelation(req.correlationId);
    const auth = this._authenticate(req);
    if (!auth.ok) {
      this._denyAudit(mode, correlationId, req.principalId, req.sessionId ?? null, auth.code, auth.details);
      return auth;
    }
    const ref = this._checkSessionRef({ principalId: auth.principalId, sessionId: req.sessionId });
    if (!ref.ok) {
      this._denyAudit(mode, correlationId, auth.principalId, req.sessionId ?? null, ref.code, ref.details);
      return ref;
    }
    const s = ref.session;
    if (s.state === SessionState.STOPPED || s.state === SessionState.REVOKED) {
      this._denyAudit(mode, correlationId, s.principalId, s.sessionId,
        mode === 'stop' ? SessionErrorCode.SESSION_STOPPED : SessionErrorCode.SESSION_REVOKED,
        { state: s.state });
      return fail(
        mode === 'stop' ? SessionErrorCode.SESSION_STOPPED : SessionErrorCode.SESSION_REVOKED,
        { state: s.state }
      );
    }
    const reason = isNonEmptyString(req.reason) ? req.reason : null;
    if (mode === 'stop') {
      s.state = SessionState.STOPPED;
      s.stopReason = reason ?? 'emergency_stop';
    } else {
      s.state = SessionState.REVOKED;
      s.revokeReason = reason ?? 'revoked';
    }
    const cancelReason = mode === 'stop'
      ? SessionErrorCode.SESSION_STOPPED
      : SessionErrorCode.SESSION_REVOKED;
    const pendingSet = this._pending.get(s.sessionId);
    let cancelled = 0;
    if (pendingSet) {
      for (const entry of [...pendingSet]) {
        entry.cancel(cancelReason);
        pendingSet.delete(entry);
        cancelled += 1;
      }
    }
    this._auditEmit({
      type: mode === 'stop' ? AuditEventType.SESSION_STOPPED : AuditEventType.SESSION_REVOKED,
      operation: mode,
      correlationId,
      principalId: s.principalId,
      sessionId: s.sessionId,
      reason: mode === 'stop' ? s.stopReason : s.revokeReason,
      cancelledObservations: cancelled
    });
    return {
      ok: true,
      correlationId,
      state: this._derivedState(s),
      cancelledObservations: cancelled,
      session: this._snapshot(s)
    };
  }
}
