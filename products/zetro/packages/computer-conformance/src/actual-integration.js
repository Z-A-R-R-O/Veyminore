/**
 * @file actual-integration.js
 * OCR-W2: offline integration adapter over the ACTUAL accepted packages.
 *
 * Actual (not mocked) consumed public APIs:
 *  - @zetro/computer-contract  (OCR-1): validateSessionIdentity, validateObserveRequest,
 *    validateObservationResult, validateAuditEvidence, verifyObservation,
 *    createTrustedVerifierPort, computeResultDigest, VerificationStatus, schema versions.
 *  - @zetro/computer-runtime   (OCR-2): real ComputerSession (start/observe/revoke/emergencyStop).
 *  - @zetro/computer-observer  (OCR-3): real createObserver (enumerate/observeWindow).
 *
 * Boundary mocks ONLY (allowed): injected clock, token verifier (auth), shared authority port,
 * trusted verifier port, audit sink, and the Windows metadata process runner (OS metadata).
 * No desktop operations, no input effects, no pixel capture.
 *
 * Label: 'offline-integration'; native Windows verification is UNVERIFIED here.
 */

import {
  validateSessionIdentity,
  validateObserveRequest,
  validateObservationResult,
  validateAuditEvidence,
  verifyObservation,
  createTrustedVerifierPort,
  computeResultDigest,
  VerificationStatus,
  COMPUTER_SCHEMA_VERSIONS,
  TargetKind,
  PrincipalRole
} from '../../computer-contract/src/index.js';
import { ComputerSession, SessionState, SessionErrorCode, AuditEventType } from '../../computer-runtime/src/index.js';
import { createObserver, ObserverError } from '../../computer-observer/src/index.js';

export const INTEGRATION_LABEL = 'offline-integration';
export const NATIVE_UNVERIFIED = true;

/* ---------- boundary mocks (clock / auth / authority / OS metadata / audit) ---------- */

export function createMockClock(start = 1700000000000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; return t; }, set: (v) => { t = v; } };
}

export function createMockTokenVerifier(tokens) {
  return {
    verify({ token, principalId }) {
      const resolved = tokens[token];
      if (!resolved) return { valid: false, reason: 'unknown_token' };
      return { valid: true, principalId: resolved, claims: { token } };
    }
  };
}

export function createMockAuthority({ onEvaluate = null } = {}) {
  return {
    async evaluateScreenCapture(params) {
      if (onEvaluate) await onEvaluate(params);
      return { allowed: true, grantId: `grant-${params.sessionId}` };
    }
  };
}

export function createHangingAuthority() {
  return { evaluateScreenCapture() { return new Promise(() => {}); } };
}

export function createDeniedAuthority(reason = 'policy_denied') {
  return { evaluateScreenCapture() { return { allowed: false, reason }; } };
}

export function createCollectingAuditSink() {
  const records = [];
  return { write(event) { records.push(event); }, records };
}

/** Injected Windows metadata runner (OS metadata boundary mock). stdout JSON only. */
export function createWindowsMetadataRunner({ clock, windows, observedAtOffsetMs = 0, huge = false }) {
  return {
    async run(spec) {
      if (!spec || spec.kind !== 'enumerate') throw new Error(`unsupported runner spec: ${spec && spec.kind}`);
      if (huge) {
        return { stdout: `{"generation":"gen-1","observedAt":${clock.now()},"windows":[],"pad":"${'x'.repeat(70000)}"}`, stderr: '', exitCode: 0 };
      }
      const payload = {
        generation: 'gen-1',
        observedAt: clock.now() + observedAtOffsetMs,
        windows: windows()
      };
      return { stdout: JSON.stringify(payload), stderr: '', exitCode: 0 };
    }
  };
}

export const DEFAULT_WINDOWS = () => ([
  {
    hwnd: 4242,
    processId: 1234,
    processName: 'notepad.exe',
    minimized: false,
    visible: true,
    generation: 'gen-1',
    title: 'Notes'
  }
]);

/** Real OCR-3 observer over the injected Windows metadata runner. */
export function createRealObserver(clock, runner) {
  return createObserver({
    processRunner: runner,
    clock: () => clock.now(),
    timeoutMs: 1000,
    maxAgeMs: 5000,
    includeTitles: false
  });
}

/** OCR-2 observer port adapter: real observer.observeWindow -> ComputerSession frame schema. */
export function createSessionObserverPort(realObserver, { hwnd }) {
  return {
    async capture({ sessionId, displayId, frames, maxBytes, signal }) {
      const ctl = new AbortController();
      if (signal) {
        if (signal.aborted) ctl.abort();
        else signal.onAbort(() => ctl.abort());
      }
      const observed = await realObserver.observeWindow({
        hwnd,
        timeoutMs: 1000,
        maxAgeMs: 5000,
        signal: ctl.signal
      });
      const meta = JSON.stringify({
        sessionId,
        displayId,
        hwnd: observed.window.hwnd,
        processId: observed.window.processId,
        processName: observed.window.processName,
        generation: observed.snapshot.generation,
        observedAt: observed.snapshot.observedAt,
        captureStatus: observed.capture.status
      });
      return {
        frames: [{
          id: 'frame-1',
          data: meta,
          metadata: { format: 'window-metadata', bytes: meta.length, capturedAt: observed.snapshot.observedAt }
        }],
        bytes: meta.length
      };
    }
  };
}

export function createRealSession({ clock, tokenVerifier, authorityPort, observer, auditSink, limits = {} }) {
  return new ComputerSession({ clock, tokenVerifier, authorityPort, observer, auditSink, limits });
}

/* ---------- real contract (OCR-1) builders ---------- */

export function buildSessionIdentity({ sessionId, principalId, clock, ttlMs = 600000 }) {
  const identity = validateSessionIdentity({
    schemaVersion: COMPUTER_SCHEMA_VERSIONS.SESSION_IDENTITY,
    sessionId,
    principalId,
    agentId: 'agent-ocr2',
    role: PrincipalRole.COORDINATOR,
    issuedAt: clock.now(),
    expiresAt: clock.now() + ttlMs
  });
  return identity;
}

export function buildObserveRequest({ identity, requestId, clock, targetId = '0', fingerprint }) {
  return validateObserveRequest({
    schemaVersion: COMPUTER_SCHEMA_VERSIONS.OBSERVE_REQUEST,
    requestId,
    sessionId: identity.sessionId,
    principalId: identity.principalId,
    capability: 'observe',
    target: { targetId, kind: TargetKind.SCREEN, fingerprint },
    requestedAt: clock.now(),
    freshness: { maxAgeMs: 5000 },
    limits: { maxPayloadBytes: 65536 }
  }, { session: identity });
}

export function buildObservationResult({ request, frameData, clock, sequence }) {
  const sha256 = computeResultDigest({ data: frameData });
  return validateObservationResult({
    schemaVersion: COMPUTER_SCHEMA_VERSIONS.OBSERVATION_RESULT,
    requestId: request.requestId,
    sessionId: request.sessionId,
    target: { targetId: request.target.targetId, fingerprint: request.target.fingerprint },
    capturedAt: clock.now(),
    sequence,
    payload: { sha256, byteLength: Buffer.byteLength(frameData, 'utf8'), mimeType: 'application/json' },
    observedBy: 'worker-ocr3'
  }, { request, maxPayloadBytes: request.limits.maxPayloadBytes });
}

export function buildAuditEvidence({ request, validatedResult, clock, verifierId }) {
  return validateAuditEvidence({
    schemaVersion: COMPUTER_SCHEMA_VERSIONS.AUDIT_EVIDENCE,
    evidenceId: `ev-${request.requestId}`,
    sessionId: request.sessionId,
    requestId: request.requestId,
    capability: 'observe',
    resultDigest: computeResultDigest(validatedResult),
    effect: null,
    verification: {
      verified: true,
      status: VerificationStatus.PASSED,
      verifier: verifierId,
      checksPassed: 1,
      checksFailed: 0,
      checkedAt: clock.now()
    },
    createdAt: clock.now()
  });
}

export function createTrustedPort(verifierId = 'trusted-verifier-ocr5') {
  return createTrustedVerifierPort(verifierId, (context) => ({
    authorized: true,
    status: VerificationStatus.PASSED,
    bindings: {
      requestId: context.requestId,
      sessionId: context.sessionId,
      principalId: context.principalId,
      resultDigest: context.resultDigest
    }
  }));
}

/* ---------- happy path: authenticate -> authority -> real session -> real observer ->
     contract request/result/trusted verification -> revoke -> stop -> audit ---------- */

export async function runOfflineIntegration() {
  const clock = createMockClock();
  const auditSink = createCollectingAuditSink();
  const tokenVerifier = createMockTokenVerifier({ 'token-alice': 'alice' });
  const authorityPort = createMockAuthority();
  const runner = createWindowsMetadataRunner({ clock, windows: DEFAULT_WINDOWS });
  const realObserver = createRealObserver(clock, runner);
  const baseObserverPort = createSessionObserverPort(realObserver, { hwnd: 4242 });
  let observerCaptures = 0;
  const session = createRealSession({
    clock,
    tokenVerifier,
    authorityPort,
    observer: {
      capture(args) {
        observerCaptures += 1;
        return baseObserverPort.capture(args);
      }
    },
    auditSink
  });

  const auth = 'token-alice';
  const principalId = 'alice';
  const start = session.start({ token: auth, principalId, targetDisplayId: 0, ttlMs: 600000 });
  if (!start.ok) throw new Error(`start failed: ${start.code}`);
  const sessionId = start.session.sessionId;

  const identity = buildSessionIdentity({ sessionId, principalId, clock });
  const fingerprint = 'f'.repeat(64);
  const request = buildObserveRequest({ identity, requestId: 'req-1', clock, targetId: '0', fingerprint });

  const observed = await session.observe({ token: auth, principalId, sessionId, displayId: 0, frames: 1 });
  if (!observed.ok) throw new Error(`observe failed: ${observed.code}`);
  const frameData = String(observed.frames[0].data);

  const validatedResult = buildObservationResult({ request, frameData, clock, sequence: observed.observationIndex });
  if (validatedResult.ok === false) throw new Error(`result invalid: ${(validatedResult.errors || []).join('; ')}`);

  const evidence = buildAuditEvidence({ request, validatedResult, clock, verifierId: 'trusted-verifier-ocr5' });
  const trust = createTrustedPort();
  const verification = verifyObservation(validatedResult, evidence, {
    now: clock.now(),
    maxAgeMs: 5000,
    request,
    trust
  });
  if (verification.status !== VerificationStatus.PASSED) {
    throw new Error(`trusted verification did not pass: ${verification.status}`);
  }

  const revoked = session.revoke({ token: auth, principalId, sessionId, reason: 'conformance_complete' });
  if (!revoked.ok) throw new Error(`revoke failed: ${revoked.code}`);

  // Terminal-state assertions: after revocation, observe is rejected and the observer never runs.
  const capturesAfterRevoke = observerCaptures;
  const postRevokeObserve = await session.observe({ token: auth, principalId, sessionId, displayId: 0 });
  if (postRevokeObserve.ok !== false || postRevokeObserve.code !== SessionErrorCode.SESSION_REVOKED) {
    throw new Error(`post-revoke observe must be rejected as session_revoked, got: ${JSON.stringify(postRevokeObserve)}`);
  }
  if (observerCaptures !== capturesAfterRevoke) {
    throw new Error(`observer effect occurred after revocation: ${capturesAfterRevoke} -> ${observerCaptures}`);
  }

  // Actual lifecycle: revoke is terminal. emergencyStop on an already-revoked session is
  // honestly rejected as already-terminal (session_stopped); the state stays 'revoked'.
  const stopAttempt = session.emergencyStop({ token: auth, principalId, sessionId, reason: 'conformance_stop' });
  if (stopAttempt.ok !== false || stopAttempt.code !== SessionErrorCode.SESSION_STOPPED) {
    throw new Error(`stop-after-revoke must report already-terminal session_stopped, got: ${JSON.stringify(stopAttempt)}`);
  }
  const finalSession = session.getSession(sessionId);
  if (!finalSession || finalSession.state !== SessionState.REVOKED) {
    throw new Error(`terminal state must remain revoked, got: ${finalSession && finalSession.state}`);
  }

  return {
    label: INTEGRATION_LABEL,
    nativeUnverified: NATIVE_UNVERIFIED,
    sessionId,
    verificationStatus: verification.status,
    checksPassed: verification.checksPassed,
    checksFailed: verification.checksFailed,
    sessionStateAfterRevoke: revoked.state,
    postRevokeObserveCode: postRevokeObserve.code,
    stopAfterRevoke: { ok: stopAttempt.ok, code: stopAttempt.code, terminalState: stopAttempt.details?.state ?? null },
    finalSessionState: finalSession.state,
    observerCaptures,
    auditTypes: auditSink.records.map(r => r.type),
    auditRecords: auditSink.records.length
  };
}

/* ---------- negatives: rejected or never-verified by the ACTUAL packages ---------- */

async function expectOk(result, expectedCode, label) {
  if (result && typeof result.then === 'function') {
    throw new Error(`${label}: received an un-awaited Promise; call sites must await session methods`);
  }
  if (!result || typeof result !== 'object') throw new Error(`${label}: expected result object, got ${JSON.stringify(result)}`);
  if (result.ok === true) throw new Error(`${label}: expected rejection, got ok: ${JSON.stringify(result)}`);
  if (result.code !== expectedCode) throw new Error(`${label}: expected ${expectedCode}, got ${result.code} (${JSON.stringify(result)})`);
  return { name: label, rejected: true, code: result.code };
}

async function expectObserverError(promise, expectedCode, label) {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ObserverError && e.code === expectedCode) {
      return { name: label, rejected: true, code: e.code };
    }
    throw new Error(`${label}: expected ObserverError ${expectedCode}, got ${e && e.code}`);
  }
  throw new Error(`${label}: expected rejection, got success`);
}

function makeStack({ clock, authorityPort, runner, limits = {} }) {
  const auditSink = createCollectingAuditSink();
  const tokenVerifier = createMockTokenVerifier({ 'token-alice': 'alice' });
  const realObserver = createRealObserver(clock, runner);
  const basePort = createSessionObserverPort(realObserver, { hwnd: 4242 });
  const stats = { observerCaptures: 0 };
  const session = createRealSession({
    clock, tokenVerifier, authorityPort,
    observer: {
      capture(args) {
        stats.observerCaptures += 1;
        return basePort.capture(args);
      }
    },
    auditSink, limits
  });
  return { session, auditSink, realObserver, stats };
}

export async function runNegativeSuite() {
  const negatives = [];

  // wrong identity: verifier resolves a different principal than claimed
  {
    const clock = createMockClock();
    const auditSink = createCollectingAuditSink();
    const session = createRealSession({
      clock,
      tokenVerifier: createMockTokenVerifier({ 'token-x': 'mallory' }),
      authorityPort: createMockAuthority(),
      observer: createSessionObserverPort(createRealObserver(clock, createWindowsMetadataRunner({ clock, windows: DEFAULT_WINDOWS })), { hwnd: 4242 }),
      auditSink
    });
    negatives.push(await expectOk(
      session.start({ token: 'token-x', principalId: 'alice' }),
      SessionErrorCode.PRINCIPAL_MISMATCH,
      'wrong-identity'
    ));
  }

  // future target: OS metadata observedAt in the future -> real observer rejects
  {
    const clock = createMockClock();
    const runner = createWindowsMetadataRunner({ clock, windows: DEFAULT_WINDOWS, observedAtOffsetMs: 60000 });
    const observer = createRealObserver(clock, runner);
    negatives.push(await expectObserverError(
      observer.observeWindow({ hwnd: 4242, timeoutMs: 500 }),
      'RESPONSE_MALFORMED',
      'future-target'
    ));
  }

  // stale target: expectedGeneration no longer current -> WINDOW_STALE
  {
    const clock = createMockClock();
    const runner = createWindowsMetadataRunner({ clock, windows: DEFAULT_WINDOWS });
    const observer = createRealObserver(clock, runner);
    negatives.push(await expectObserverError(
      observer.observeWindow({ hwnd: 4242, expectedGeneration: 'gen-0', timeoutMs: 500 }),
      'WINDOW_STALE',
      'stale-target'
    ));
  }

  // revoke between authority-start and authority-completion: post-await effect gate rejects,
  // and the observer must never run after revocation (explicit start/release barriers).
  {
    const clock = createMockClock();
    const auditSink = createCollectingAuditSink();
    let authorityStartedResolve;
    const authorityStarted = new Promise(r => { authorityStartedResolve = r; });
    let releaseAuthorityResolve;
    const releaseAuthority = new Promise(r => { releaseAuthorityResolve = r; });
    let observerCaptures = 0;
    const authorityPort = {
      async evaluateScreenCapture() {
        authorityStartedResolve();
        await releaseAuthority;
        return { allowed: true, grantId: 'grant-x' };
      }
    };
    const baseObserver = createSessionObserverPort(
      createRealObserver(clock, createWindowsMetadataRunner({ clock, windows: DEFAULT_WINDOWS })),
      { hwnd: 4242 }
    );
    const session = createRealSession({
      clock,
      tokenVerifier: createMockTokenVerifier({ 'token-alice': 'alice' }),
      authorityPort,
      observer: {
        capture(args) {
          observerCaptures += 1;
          return baseObserver.capture(args);
        }
      },
      auditSink
    });
    const start = session.start({ token: 'token-alice', principalId: 'alice', targetDisplayId: 0 });
    const sessionId = start.session.sessionId;
    const observePromise = session.observe({ token: 'token-alice', principalId: 'alice', sessionId, displayId: 0 });
    await authorityStarted;
    const revoked = session.revoke({ token: 'token-alice', principalId: 'alice', sessionId, reason: 'revoked_during_authority_await' });
    if (!revoked.ok) throw new Error(`revoke-during-authority-await: setup revoke failed: ${revoked.code}`);
    releaseAuthorityResolve();
    const observed = await observePromise;
    if (observed.ok !== false || observed.code !== SessionErrorCode.SESSION_REVOKED) {
      throw new Error(`revoke-during-authority-await: expected session_revoked, got: ${JSON.stringify(observed)}`);
    }
    if (observerCaptures !== 0) {
      throw new Error(`revoke-during-authority-await: observer ran after revocation (${observerCaptures} captures)`);
    }
    negatives.push({ name: 'revoke-during-authority-await', rejected: true, code: observed.code, observerCaptures });
  }

  // authority timeout: hung port is bounded fail-closed; observer must never run
  {
    const clock = createMockClock();
    const stack = makeStack({
      clock,
      authorityPort: createHangingAuthority(),
      runner: createWindowsMetadataRunner({ clock, windows: DEFAULT_WINDOWS }),
      limits: { authorityTimeoutMs: 30 }
    });
    const start = stack.session.start({ token: 'token-alice', principalId: 'alice', targetDisplayId: 0 });
    const beganAt = Date.now();
    const observed = await stack.session.observe({ token: 'token-alice', principalId: 'alice', sessionId: start.session.sessionId, displayId: 0 });
    const elapsedMs = Date.now() - beganAt;
    negatives.push(await expectOk(observed, SessionErrorCode.AUTHORITY_TIMEOUT, 'authority-timeout'));
    if (elapsedMs > 2000) {
      throw new Error(`authority-timeout: rejection was not bounded (elapsed ${elapsedMs}ms)`);
    }
    if (stack.stats.observerCaptures !== 0) {
      throw new Error(`authority-timeout: observer ran despite authority timeout (${stack.stats.observerCaptures} captures)`);
    }
    negatives[negatives.length - 1].boundedElapsedMs = elapsedMs;
    negatives[negatives.length - 1].observerCaptures = stack.stats.observerCaptures;
  }

  // bounds: runner response exceeds maxResponseBytes -> observer rejects, session denies
  {
    const clock = createMockClock();
    const stack = makeStack({
      clock,
      authorityPort: createMockAuthority(),
      runner: createWindowsMetadataRunner({ clock, windows: DEFAULT_WINDOWS, huge: true })
    });
    const start = stack.session.start({ token: 'token-alice', principalId: 'alice', targetDisplayId: 0 });
    const observed = await stack.session.observe({ token: 'token-alice', principalId: 'alice', sessionId: start.session.sessionId, displayId: 0 });
    negatives.push(await expectOk(observed, SessionErrorCode.OBSERVER_FAILED, 'bounds-oversize-runner-response'));
    negatives[negatives.length - 1].observerCaptureAttempts = stack.stats.observerCaptures;
  }

  // no trusted verifier: verification is inconclusive, NEVER passed
  {
    const clock = createMockClock();
    const identity = buildSessionIdentity({ sessionId: 'csession-9', principalId: 'alice', clock });
    const request = buildObserveRequest({ identity, requestId: 'req-9', clock, targetId: '0', fingerprint: 'a'.repeat(64) });
    const frameData = JSON.stringify({ hello: 'world' });
    const validatedResult = buildObservationResult({ request, frameData, clock, sequence: 1 });
    const evidence = buildAuditEvidence({ request, validatedResult, clock, verifierId: 'trusted-verifier-ocr5' });
    const verification = verifyObservation(validatedResult, evidence, { now: clock.now(), maxAgeMs: 5000, request });
    if (verification.status === VerificationStatus.PASSED) {
      throw new Error('no-trusted-verifier: verification must never pass without a trusted port');
    }
    const trustCheck = verification.checks.find(c => c.name === 'trusted_authority');
    if (!trustCheck || trustCheck.ok !== false) {
      throw new Error('no-trusted-verifier: trusted_authority check must fail');
    }
    negatives.push({ name: 'no-trusted-verifier', neverVerified: true, status: verification.status });
  }

  return { label: INTEGRATION_LABEL, nativeUnverified: NATIVE_UNVERIFIED, negatives };
}
