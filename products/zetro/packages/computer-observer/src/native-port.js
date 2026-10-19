import { ObserverError } from './index.js';

const CAPTURE_ATTESTATION = 'caller_asserted_not_native_verified';

const EFFECTS = Object.freeze({ mouse: false, keyboard: false, clipboard: false, shell: false });

const DEFAULTS = Object.freeze({
  maxWindows: 256,
  maxTitleChars: 128,
  maxResponseBytes: 65536,
  maxImageBytes: 8 * 1024 * 1024,
  maxDimension: 8192,
  maxArtifactRefChars: 512,
  maxAgeMs: 5000,
  timeoutMs: 5000,
});

const PORT_CODE_MAP = Object.freeze({
  REVOKED: 'PORT_REVOKED',
  PORT_REVOKED: 'PORT_REVOKED',
  AUTH_REVOKED: 'PORT_REVOKED',
  ABORTED: 'OBSERVER_CANCELLED',
  ABORT: 'OBSERVER_CANCELLED',
  CANCELLED: 'OBSERVER_CANCELLED',
  TIMEOUT: 'OBSERVER_TIMEOUT',
});

const encoder = new TextEncoder();

function fail(code, message, details) {
  throw new ObserverError(code, message, details);
}

function byteLength(value) {
  return encoder.encode(value).length;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function posInt(value) {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value.trim());
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function nonNegInt(value) {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value.trim());
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function normalizeGeneration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value;
  return null;
}

function mapPortError(err) {
  if (err instanceof ObserverError) return err;
  if (err && typeof err === 'object' && typeof err.code === 'string' && PORT_CODE_MAP[err.code]) {
    return new ObserverError(
      PORT_CODE_MAP[err.code],
      `native provider: ${err.message || err.code}`,
      { providerCode: err.code },
    );
  }
  return new ObserverError('RESPONSE_MALFORMED', 'native provider call failed', {
    reason: err && err.message ? String(err.message).slice(0, 200) : 'unknown',
  });
}

async function runBounded(fn, { timeoutMs, signal }) {
  if (signal && signal.aborted) fail('OBSERVER_CANCELLED', 'request cancelled before execution');
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onExternalAbort, { once: true });
  const abortPromise = new Promise((_, reject) => {
    const onAbort = () =>
      reject(
        timedOut
          ? new ObserverError('OBSERVER_TIMEOUT', 'operation exceeded timeoutMs', { timeoutMs })
          : new ObserverError('OBSERVER_CANCELLED', 'request cancelled during execution', {}),
      );
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  abortPromise.catch(() => {});
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await Promise.race([
      Promise.resolve().then(() => fn(controller.signal)),
      abortPromise,
    ]);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

export function createNativeObservationAdapter(options) {
  const opts = options || {};
  const port = opts.port || null;
  const clock = typeof opts.clock === 'function' ? opts.clock : () => Date.now();
  const cfg = {
    maxWindows: clampInt(opts.maxWindows, 1, 10000, DEFAULTS.maxWindows),
    maxTitleChars: clampInt(opts.maxTitleChars, 0, 4096, DEFAULTS.maxTitleChars),
    maxResponseBytes: clampInt(opts.maxResponseBytes, 256, 1024 * 1024, DEFAULTS.maxResponseBytes),
    maxImageBytes: DEFAULTS.maxImageBytes,
    maxDimension: DEFAULTS.maxDimension,
    maxArtifactRefChars: DEFAULTS.maxArtifactRefChars,
    maxAgeMs: clampInt(opts.maxAgeMs, 0, Number.MAX_SAFE_INTEGER, DEFAULTS.maxAgeMs),
    timeoutMs: clampInt(opts.timeoutMs, 1, Number.MAX_SAFE_INTEGER, DEFAULTS.timeoutMs),
  };

  let revoked = false;

  function hasProvider() {
    return Boolean(
      port &&
        typeof port.enumerate === 'function' &&
        typeof port.inspect === 'function' &&
        typeof port.capture === 'function',
    );
  }

  function assertActive() {
    if (revoked) fail('PORT_REVOKED', 'native observation port has been revoked');
  }

  function requireProvider() {
    if (!hasProvider()) {
      fail('CAPTURE_UNSUPPORTED', 'native observation provider is missing or incomplete', {
        reason: 'NATIVE_PROVIDER_MISSING',
      });
    }
  }

  function assertBounded(value, where, limit) {
    let text;
    if (typeof value === 'string') {
      text = value;
    } else {
      try {
        text = JSON.stringify(value);
      } catch {
        fail('RESPONSE_MALFORMED', `${where} response is not serializable`);
      }
      if (text === undefined) fail('RESPONSE_MALFORMED', `${where} response missing`);
    }
    const bytes = byteLength(text);
    if (bytes > limit) {
      fail('RESPONSE_TOO_LARGE', `${where} response exceeded bound`, { bytes, limit });
    }
  }

  function assertFresh(observedAt, where) {
    if (typeof observedAt !== 'number' || !Number.isFinite(observedAt) || observedAt < 0) {
      fail('RESPONSE_MALFORMED', `${where}.observedAt missing or invalid`);
    }
    const now = clock();
    if (observedAt > now) {
      fail('RESPONSE_MALFORMED', `${where}.observedAt is in the future; refusing untrusted freshness`, {
        observedAt,
        clockNow: now,
      });
    }
    const ageMs = now - observedAt;
    if (ageMs > cfg.maxAgeMs) {
      fail('WINDOW_STALE', `${where} response is stale`, { ageMs, maxAgeMs: cfg.maxAgeMs });
    }
    return ageMs;
  }

  function readRecord(src) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
    const windowHandle = posInt(src.windowHandle);
    const processId = posInt(src.processId);
    const processStartedAt = posInt(src.processStartedAt);
    const generation = normalizeGeneration(src.generation);
    const displayId = nonNegInt(src.displayId);
    if (!windowHandle || !processId || !processStartedAt || !generation || displayId === null) return null;
    if (typeof src.minimized !== 'boolean' || typeof src.visible !== 'boolean') return null;
    const title = typeof src.title === 'string' ? src.title.slice(0, cfg.maxTitleChars) : '';
    return {
      windowHandle,
      processId,
      processStartedAt,
      generation,
      displayId,
      minimized: src.minimized,
      visible: src.visible,
      title,
    };
  }

  function assertExpected(expected, record) {
    if (!expected) return;
    if (expected.processId !== undefined) {
      const pid = posInt(expected.processId);
      if (!pid || pid !== record.processId) {
        fail('PROCESS_MISMATCH', 'target processId does not match expected identity', {
          windowHandle: record.windowHandle,
          expectedProcessId: expected.processId,
          actualProcessId: record.processId,
        });
      }
    }
    if (expected.processStartedAt !== undefined) {
      const ps = posInt(expected.processStartedAt);
      if (!ps || ps !== record.processStartedAt) {
        fail('WINDOW_STALE', 'target processStartedAt changed; window identity renewed or reused', {
          windowHandle: record.windowHandle,
          expectedProcessStartedAt: expected.processStartedAt,
          actualProcessStartedAt: record.processStartedAt,
        });
      }
    }
    if (expected.generation !== undefined) {
      const g = normalizeGeneration(expected.generation);
      if (!g || g !== record.generation) {
        fail('GENERATION_MISMATCH', 'target generation does not match expected identity', {
          windowHandle: record.windowHandle,
          expectedGeneration: expected.generation,
          actualGeneration: record.generation,
        });
      }
    }
    if (expected.displayId !== undefined) {
      const d = nonNegInt(expected.displayId);
      if (d === null || d !== record.displayId) {
        fail('WINDOW_STALE', 'target displayId changed', {
          windowHandle: record.windowHandle,
          expectedDisplayId: expected.displayId,
          actualDisplayId: record.displayId,
        });
      }
    }
  }

  function assertUnchanged(before, after) {
    if (after.processId !== before.processId) {
      fail('PROCESS_MISMATCH', 'target identity changed across async capture (processId)', {
        windowHandle: before.windowHandle,
        beforeProcessId: before.processId,
        afterProcessId: after.processId,
      });
    }
    if (after.processStartedAt !== before.processStartedAt || after.displayId !== before.displayId) {
      fail('WINDOW_STALE', 'target identity changed across async capture', {
        windowHandle: before.windowHandle,
        beforeProcessStartedAt: before.processStartedAt,
        afterProcessStartedAt: after.processStartedAt,
        beforeDisplayId: before.displayId,
        afterDisplayId: after.displayId,
      });
    }
    if (after.generation !== before.generation) {
      fail('GENERATION_MISMATCH', 'target generation changed across async capture', {
        windowHandle: before.windowHandle,
        beforeGeneration: before.generation,
        afterGeneration: after.generation,
      });
    }
  }

  function readArtifact(artifact, windowHandle) {
    if (!artifact || typeof artifact !== 'object') {
      fail('ARTIFACT_INVALID', 'capture result must include an artifact reference object', { windowHandle });
    }
    if (typeof artifact.mime !== 'string' || artifact.mime.length === 0 || artifact.mime.length > 64) {
      fail('ARTIFACT_INVALID', 'artifact.mime missing or out of bounds');
    }
    if (
      typeof artifact.width !== 'number' ||
      !Number.isSafeInteger(artifact.width) ||
      artifact.width <= 0 ||
      artifact.width > cfg.maxDimension
    ) {
      fail('ARTIFACT_INVALID', 'artifact.width missing or out of bounds');
    }
    if (
      typeof artifact.height !== 'number' ||
      !Number.isSafeInteger(artifact.height) ||
      artifact.height <= 0 ||
      artifact.height > cfg.maxDimension
    ) {
      fail('ARTIFACT_INVALID', 'artifact.height missing or out of bounds');
    }
    if (
      typeof artifact.bytes !== 'number' ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      artifact.bytes > cfg.maxImageBytes
    ) {
      fail('ARTIFACT_INVALID', 'artifact.bytes missing or out of bounds');
    }
    const ref = typeof artifact.artifactId === 'string' ? artifact.artifactId : artifact.uri;
    if (typeof ref !== 'string' || ref.length === 0 || ref.length > cfg.maxArtifactRefChars) {
      fail('ARTIFACT_INVALID', 'artifact reference (artifactId/uri) missing or out of bounds');
    }
    const published = {
      mime: artifact.mime,
      width: artifact.width,
      height: artifact.height,
      bytes: artifact.bytes,
      ref,
      artifactId: ref,
    };
    if (typeof artifact.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(artifact.sha256)) {
      published.sha256 = artifact.sha256.toLowerCase();
    }
    return published;
  }

  async function callPort(where, fn, { timeoutMs, signal }) {
    assertActive();
    requireProvider();
    try {
      return await runBounded((sig) => Promise.resolve().then(() => fn(sig)), { timeoutMs, signal });
    } catch (err) {
      throw mapPortError(err);
    }
  }

  async function enumerate({ limit, timeoutMs, signal } = {}) {
    const boundedLimit = clampInt(limit, 1, cfg.maxWindows, cfg.maxWindows);
    const effectiveTimeout = clampInt(timeoutMs, 1, Number.MAX_SAFE_INTEGER, cfg.timeoutMs);
    const raw = await callPort(
      'enumerate',
      (sig) => port.enumerate({ maxWindows: boundedLimit }, { signal: sig }),
      { timeoutMs: effectiveTimeout, signal },
    );
    assertBounded(raw, 'enumerate', cfg.maxResponseBytes);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail('RESPONSE_MALFORMED', 'enumerate response must be an object');
    }
    if (!Array.isArray(raw.windows)) {
      fail('RESPONSE_MALFORMED', 'enumerate.windows must be an array');
    }
    const generation = normalizeGeneration(raw.generation);
    if (!generation) fail('RESPONSE_MALFORMED', 'enumerate.generation missing or invalid');
    const ageMs = assertFresh(raw.observedAt, 'enumerate');
    let dropped = 0;
    const valid = [];
    for (const item of raw.windows) {
      const record = readRecord(item);
      if (record) valid.push(record);
      else dropped += 1;
    }
    if (raw.windows.length > 0 && valid.length === 0) {
      fail('RESPONSE_MALFORMED', 'all window records failed validation');
    }
    const truncated = valid.length > boundedLimit;
    return {
      generation,
      observedAt: raw.observedAt,
      ageMs,
      truncated,
      dropped,
      windows: truncated ? valid.slice(0, boundedLimit) : valid,
    };
  }

  async function inspect({ windowHandle, expected } = {}, { timeoutMs, signal } = {}) {
    assertActive();
    requireProvider();
    const handle = posInt(windowHandle);
    if (!handle) fail('REQUEST_INVALID', 'windowHandle must be a positive integer');
    const effectiveTimeout = clampInt(timeoutMs, 1, Number.MAX_SAFE_INTEGER, cfg.timeoutMs);
    const raw = await callPort(
      'inspect',
      (sig) => port.inspect({ windowHandle: handle }, { signal: sig }),
      { timeoutMs: effectiveTimeout, signal },
    );
    if (raw === null || raw === undefined) {
      fail('WINDOW_MISSING', 'target window not present in native provider', { windowHandle: handle });
    }
    assertBounded(raw, 'inspect', cfg.maxResponseBytes);
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      fail('RESPONSE_MALFORMED', 'inspect response must be an object or null');
    }
    if (!raw.window) fail('RESPONSE_MALFORMED', 'inspect response missing window record');
    const record = readRecord(raw.window);
    if (!record) fail('RESPONSE_MALFORMED', 'inspect window record failed validation');
    if (record.windowHandle !== handle) {
      fail('WINDOW_MISSING', 'provider returned a different window handle; refusing to substitute', {
        requested: handle,
        returned: record.windowHandle,
      });
    }
    const ageMs = assertFresh(raw.observedAt, 'inspect');
    assertExpected(expected, record);
    if (record.minimized === true) {
      fail('WINDOW_MINIMIZED', 'target window is minimized; observation rejected explicitly', {
        windowHandle: handle,
      });
    }
    if (record.visible !== true) {
      fail('WINDOW_NOT_VISIBLE', 'target window is not visible; observation rejected explicitly', {
        windowHandle: handle,
      });
    }
    return { ...record, observedAt: raw.observedAt, ageMs };
  }

  async function capture(target, { timeoutMs, signal } = {}) {
    assertActive();
    requireProvider();
    const t = target || {};
    const handle = posInt(t.windowHandle !== undefined ? t.windowHandle : t.hwnd);
    if (!handle) fail('REQUEST_INVALID', 'capture target requires a positive windowHandle');
    const expected = {};
    const expectedPid = t.processId !== undefined ? t.processId : t.pid;
    if (expectedPid !== undefined) expected.processId = expectedPid;
    if (t.processStartedAt !== undefined) expected.processStartedAt = t.processStartedAt;
    if (t.generation !== undefined) expected.generation = t.generation;
    if (t.displayId !== undefined) expected.displayId = t.displayId;
    const effectiveTimeout = clampInt(timeoutMs, 1, Number.MAX_SAFE_INTEGER, cfg.timeoutMs);

    const before = await inspect({ windowHandle: handle, expected }, { timeoutMs: effectiveTimeout, signal });

    const raw = await callPort(
      'capture',
      (sig) =>
        port.capture(
          {
            windowHandle: handle,
            processId: before.processId,
            processStartedAt: before.processStartedAt,
            generation: before.generation,
            displayId: before.displayId,
          },
          { signal: sig },
        ),
      { timeoutMs: effectiveTimeout, signal },
    );
    assertBounded(raw, 'capture', cfg.maxResponseBytes * 64);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail('RESPONSE_MALFORMED', 'capture response must be an object');
    }
    if (
      raw.data !== undefined ||
      raw.pixels !== undefined ||
      raw.base64 !== undefined ||
      raw.imageData !== undefined
    ) {
      fail('INLINE_PIXELS_REJECTED', 'native provider returned inline pixel data; artifact reference only', {
        windowHandle: handle,
      });
    }

    const after = await inspect({ windowHandle: handle }, { timeoutMs: effectiveTimeout, signal });
    assertUnchanged(before, after);

    const artifact = readArtifact(raw.artifact, handle);
    return {
      status: 'captured',
      artifact,
      target: {
        windowHandle: after.windowHandle,
        processId: after.processId,
        processStartedAt: after.processStartedAt,
        generation: after.generation,
        displayId: after.displayId,
      },
      identityRecheck: { before: before.observedAt, after: after.observedAt },
      attestation: CAPTURE_ATTESTATION,
      retention: 'metadata-only; no pixel data retained',
    };
  }

  function finishWire(payload) {
    const stdout = JSON.stringify(payload);
    const bytes = byteLength(stdout);
    if (bytes > cfg.maxResponseBytes) {
      fail('RESPONSE_TOO_LARGE', 'adapter stdout exceeded maxResponseBytes', {
        bytes,
        limit: cfg.maxResponseBytes,
      });
    }
    return { ok: true, stdout };
  }

  async function run(spec, runOpts = {}) {
    assertActive();
    if (!spec || typeof spec !== 'object' || typeof spec.kind !== 'string') {
      fail('REQUEST_INVALID', 'spec.kind is required');
    }
    const inner = { timeoutMs: runOpts.timeoutMs, signal: runOpts.signal };
    if (spec.kind === 'enumerate') {
      const snapshot = await enumerate({ limit: spec.limit, ...inner });
      return finishWire({
        generation: snapshot.generation,
        observedAt: snapshot.observedAt,
        windows: snapshot.windows.map((record) => ({
          hwnd: record.windowHandle,
          processId: record.processId,
          minimized: record.minimized,
          visible: record.visible,
          generation: record.generation,
          title: record.title,
        })),
      });
    }
    if (spec.kind === 'inspect') {
      const record = await inspect(
        { windowHandle: spec.windowHandle, expected: spec.expected },
        inner,
      );
      return finishWire({
        generation: record.generation,
        observedAt: record.observedAt,
        window: {
          hwnd: record.windowHandle,
          processId: record.processId,
          processStartedAt: record.processStartedAt,
          generation: record.generation,
          displayId: record.displayId,
          minimized: record.minimized,
          visible: record.visible,
          title: record.title,
        },
      });
    }
    fail('REQUEST_INVALID', `unsupported spec.kind: ${String(spec.kind).slice(0, 32)}`);
  }

  function getCapabilities() {
    const status = hasProvider() ? 'supported' : 'unsupported';
    const independentlyTested = Boolean(port && port.independentlyTested === true);
    return {
      read: {
        enumerate: true,
        inspect: true,
        capture: true,
        freshness: true,
        identityRecheckBeforeAfter: true,
        timeout: true,
        cancellation: true,
        boundedResponses: true,
      },
      provider: hasProvider() ? 'injected' : 'missing',
      nativeCapture: status === 'supported' && independentlyTested ? 'supported' : 'unsupported',
      nativeCaptureAttestation: CAPTURE_ATTESTATION,
      effects: EFFECTS,
    };
  }

  return Object.freeze({
    enumerate,
    inspect,
    capture,
    run,
    getCapabilities,
    revoke: () => {
      revoked = true;
    },
    get revoked() {
      return revoked;
    },
    status: hasProvider() ? 'supported' : 'unsupported',
    independentlyTested: Boolean(port && port.independentlyTested === true),
  });
}

export default createNativeObservationAdapter;
