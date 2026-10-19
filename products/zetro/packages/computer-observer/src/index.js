export const ERROR_CODES = Object.freeze([
  'REQUEST_INVALID',
  'OBSERVER_TIMEOUT',
  'OBSERVER_CANCELLED',
  'RESPONSE_MALFORMED',
  'RESPONSE_TOO_LARGE',
  'WINDOW_MISSING',
  'WINDOW_STALE',
  'WINDOW_MINIMIZED',
  'WINDOW_NOT_VISIBLE',
  'GENERATION_MISMATCH',
  'PROCESS_MISMATCH',
  'CAPTURE_UNSUPPORTED',
  'ARTIFACT_INVALID',
  'INLINE_PIXELS_REJECTED',
  'PORT_REVOKED',
]);

export class ObserverError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ObserverError';
    this.code = code;
    this.details = details ? { ...details } : {};
  }
}

const DEFAULTS = Object.freeze({
  maxWindows: 256,
  maxTitleChars: 128,
  maxProcessNameChars: 64,
  maxResponseBytes: 65536,
  maxImageBytes: 8 * 1024 * 1024,
  maxDimension: 8192,
  maxArtifactRefChars: 512,
  maxAgeMs: 5000,
  timeoutMs: 5000,
  includeTitles: false,
});

const EFFECTS = Object.freeze({
  mouse: false,
  keyboard: false,
  clipboard: false,
  shell: false,
});

const CAPTURE_ATTESTATION = Object.freeze('caller_asserted_not_native_verified');

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

function asHwnd(value) {
  let n = value;
  if (typeof n === 'string' && n.trim() !== '' && /^\d+$/.test(n.trim())) n = Number(n.trim());
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

function asGeneration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value;
  return null;
}

function boundedString(value, maxChars) {
  if (typeof value !== 'string') return '';
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function isPositiveInt(value, max) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max;
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

function captureCapability(captureBackend) {
  if (
    !captureBackend ||
    captureBackend.status !== 'supported' ||
    typeof captureBackend.capture !== 'function' ||
    captureBackend.independentlyTested !== true
  ) {
    return 'unsupported';
  }
  return 'supported';
}

export function createObserver(options) {
  const opts = options || {};
  const processRunner = opts.processRunner;
  if (!processRunner || typeof processRunner.run !== 'function') {
    fail('REQUEST_INVALID', 'options.processRunner with a run(spec, {signal}) function is required');
  }
  const captureBackend = opts.captureBackend || null;
  const clock = typeof opts.clock === 'function' ? opts.clock : () => Date.now();
  const cfg = {
    maxWindows: clampInt(opts.maxWindows, 1, 10000, DEFAULTS.maxWindows),
    maxTitleChars: clampInt(opts.maxTitleChars, 0, 4096, DEFAULTS.maxTitleChars),
    maxProcessNameChars: DEFAULTS.maxProcessNameChars,
    maxResponseBytes: clampInt(opts.maxResponseBytes, 256, 1024 * 1024, DEFAULTS.maxResponseBytes),
    maxImageBytes: DEFAULTS.maxImageBytes,
    maxDimension: DEFAULTS.maxDimension,
    maxArtifactRefChars: DEFAULTS.maxArtifactRefChars,
    maxAgeMs: clampInt(opts.maxAgeMs, 0, Number.MAX_SAFE_INTEGER, DEFAULTS.maxAgeMs),
    timeoutMs: clampInt(opts.timeoutMs, 1, Number.MAX_SAFE_INTEGER, DEFAULTS.timeoutMs),
    includeTitles: opts.includeTitles === true,
  };

  let lastSnapshot = null;

  async function callRunner(spec, signal) {
    const result = await processRunner.run({ ...spec }, { signal });
    if (!result || typeof result !== 'object') {
      fail('RESPONSE_MALFORMED', 'process runner result must be an object', { spec: spec.kind });
    }
    if (typeof result.stdout !== 'string') {
      fail('RESPONSE_MALFORMED', 'process runner result.stdout must be a string', { spec: spec.kind });
    }
    const bytes = byteLength(result.stdout);
    if (bytes > cfg.maxResponseBytes) {
      fail('RESPONSE_TOO_LARGE', 'runner response exceeded maxResponseBytes', {
        bytes,
        limit: cfg.maxResponseBytes,
      });
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      fail('RESPONSE_MALFORMED', 'runner stdout is not valid JSON', { spec: spec.kind, bytes });
    }
  }

  function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const hwnd = asHwnd(raw.hwnd);
    const processId = raw.processId;
    if (!hwnd) return null;
    if (typeof processId !== 'number' || !Number.isSafeInteger(processId) || processId <= 0) return null;
    const generation = asGeneration(raw.generation);
    if (!generation) return null;
    if (typeof raw.minimized !== 'boolean') return null;
    if (typeof raw.visible !== 'boolean') return null;
    const title = boundedString(raw.title, cfg.maxTitleChars);
    const processName = boundedString(raw.processName, cfg.maxProcessNameChars);
    return {
      hwnd,
      processId,
      processName,
      minimized: raw.minimized,
      visible: raw.visible,
      generation,
      title,
    };
  }

  function normalizeSnapshot(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail('RESPONSE_MALFORMED', 'enumerate payload must be an object');
    }
    if (!Array.isArray(raw.windows)) {
      fail('RESPONSE_MALFORMED', 'enumerate payload.windows must be an array');
    }
    const generation = asGeneration(raw.generation);
    if (!generation) fail('RESPONSE_MALFORMED', 'enumerate payload.generation missing or invalid');
    if (typeof raw.observedAt !== 'number' || !Number.isFinite(raw.observedAt) || raw.observedAt < 0) {
      fail('RESPONSE_MALFORMED', 'enumerate payload.observedAt missing or invalid');
    }
    const now = clock();
    if (raw.observedAt > now) {
      fail('RESPONSE_MALFORMED', 'enumerate payload.observedAt is in the future; refusing untrusted freshness', {
        observedAt: raw.observedAt,
        clockNow: now,
      });
    }
    let dropped = 0;
    const valid = [];
    for (const item of raw.windows) {
      const entry = normalizeEntry(item);
      if (entry) valid.push(entry);
      else dropped += 1;
    }
    if (raw.windows.length > 0 && valid.length === 0) {
      fail('RESPONSE_MALFORMED', 'all window entries failed validation');
    }
    const truncated = valid.length > cfg.maxWindows;
    return {
      generation,
      observedAt: raw.observedAt,
      windows: truncated ? valid.slice(0, cfg.maxWindows) : valid,
      truncated,
      dropped,
    };
  }

  function publishEntry(entry) {
    const base = {
      hwnd: entry.hwnd,
      processId: entry.processId,
      processName: entry.processName,
      minimized: entry.minimized,
      visible: entry.visible,
      generation: entry.generation,
    };
    if (cfg.includeTitles) return { ...base, title: entry.title };
    return { ...base, titleChars: entry.title.length };
  }

  function publishSnapshot(snapshot) {
    return {
      generation: snapshot.generation,
      observedAt: snapshot.observedAt,
      ageMs: clock() - snapshot.observedAt,
      truncated: snapshot.truncated,
      dropped: snapshot.dropped,
      windows: snapshot.windows.map(publishEntry),
    };
  }

  async function enumerate({ limit, timeoutMs, signal } = {}) {
    const boundedLimit = clampInt(limit, 1, cfg.maxWindows, cfg.maxWindows);
    const effectiveTimeout = clampInt(timeoutMs, 1, Number.MAX_SAFE_INTEGER, cfg.timeoutMs);
    const raw = await runBounded(
      (sig) => callRunner({ kind: 'enumerate', limit: boundedLimit, maxWindows: cfg.maxWindows }, sig),
      { timeoutMs: effectiveTimeout, signal },
    );
    const snapshot = normalizeSnapshot(raw);
    lastSnapshot = snapshot;
    return publishSnapshot(snapshot);
  }

  async function performCapture(entry, { timeoutMs, signal }) {
    const raw = await runBounded(
      async (sig) => {
        const result = await captureBackend.capture(
          { hwnd: entry.hwnd, processId: entry.processId },
          { signal: sig },
        );
        if (!result || typeof result !== 'object') {
          fail('RESPONSE_MALFORMED', 'capture backend result must be an object');
        }
        if (byteLength(JSON.stringify(result)) > cfg.maxResponseBytes * 64) {
          fail('RESPONSE_TOO_LARGE', 'capture response exceeded bounded size', {});
        }
        return result;
      },
      { timeoutMs, signal },
    );
    if (
      raw.data !== undefined ||
      raw.pixels !== undefined ||
      raw.base64 !== undefined ||
      raw.imageData !== undefined
    ) {
      fail('INLINE_PIXELS_REJECTED', 'pixel payloads are not permitted; return an artifact reference only', {
        hwnd: entry.hwnd,
      });
    }
    const artifact = raw.artifact;
    if (!artifact || typeof artifact !== 'object') {
      fail('ARTIFACT_INVALID', 'capture result must include an artifact reference object', {
        hwnd: entry.hwnd,
      });
    }
    if (typeof artifact.mime !== 'string' || artifact.mime.length === 0 || artifact.mime.length > 64) {
      fail('ARTIFACT_INVALID', 'artifact.mime missing or out of bounds');
    }
    if (!isPositiveInt(artifact.width, cfg.maxDimension)) {
      fail('ARTIFACT_INVALID', 'artifact.width missing or out of bounds');
    }
    if (!isPositiveInt(artifact.height, cfg.maxDimension)) {
      fail('ARTIFACT_INVALID', 'artifact.height missing or out of bounds');
    }
    if (!isPositiveInt(artifact.bytes, cfg.maxImageBytes)) {
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
    };
    if (typeof artifact.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(artifact.sha256)) {
      published.sha256 = artifact.sha256.toLowerCase();
    }
    return {
      status: 'captured',
      artifact: published,
      retention: 'metadata-only; no pixel data retained',
      attestation: CAPTURE_ATTESTATION,
    };
  }

  async function observeWindow(request) {
    const req = request || {};
    const hwnd = asHwnd(req.hwnd);
    if (!hwnd) fail('REQUEST_INVALID', 'request.hwnd must be a positive window handle');
    const effectiveTimeout = clampInt(req.timeoutMs, 1, Number.MAX_SAFE_INTEGER, cfg.timeoutMs);
    const maxAge = clampInt(req.maxAgeMs, 0, Number.MAX_SAFE_INTEGER, cfg.maxAgeMs);
    const snapshot = await runBounded(
      (sig) => callRunner({ kind: 'enumerate', limit: cfg.maxWindows, maxWindows: cfg.maxWindows }, sig),
      { timeoutMs: effectiveTimeout, signal: req.signal },
    ).then((raw) => {
      const normalized = normalizeSnapshot(raw);
      lastSnapshot = normalized;
      return normalized;
    });

    const entry = snapshot.windows.find((w) => w.hwnd === hwnd);
    if (!entry) {
      fail('WINDOW_MISSING', 'exact hwnd not present in fresh enumeration; refusing to guess', {
        hwnd,
        snapshotGeneration: snapshot.generation,
      });
    }
    if (entry.generation !== snapshot.generation) {
      fail('GENERATION_MISMATCH', 'window entry generation inconsistent with snapshot generation', {
        hwnd,
        entryGeneration: entry.generation,
        snapshotGeneration: snapshot.generation,
      });
    }
    if (req.expectedGeneration !== undefined) {
      const expected = asGeneration(req.expectedGeneration);
      if (!expected || expected !== snapshot.generation) {
        fail('WINDOW_STALE', 'stale request: expectedGeneration is no longer current', {
          hwnd,
          expectedGeneration: expected,
          snapshotGeneration: snapshot.generation,
        });
      }
    }
    const ageMs = clock() - snapshot.observedAt;
    if (ageMs > maxAge) {
      fail('WINDOW_STALE', 'snapshot older than maxAgeMs; refusing stale observation', {
        hwnd,
        ageMs,
        maxAgeMs: maxAge,
      });
    }
    if (req.expectedProcessId !== undefined) {
      const expectedPid = Number(req.expectedProcessId);
      if (!Number.isSafeInteger(expectedPid) || expectedPid <= 0 || expectedPid !== entry.processId) {
        fail('PROCESS_MISMATCH', 'hwnd is bound to a different process than expected', {
          hwnd,
          expectedProcessId: req.expectedProcessId,
          actualProcessId: entry.processId,
        });
      }
    }
    if (entry.minimized === true) {
      fail('WINDOW_MINIMIZED', 'target window is minimized; observation rejected explicitly', { hwnd });
    }
    if (entry.visible !== true) {
      fail('WINDOW_NOT_VISIBLE', 'target window is not visible; observation rejected explicitly', { hwnd });
    }

    const wantsCapture = req.capture === true || req.requireCapture === true;
    const capability = captureCapability(captureBackend);
    let captureInfo;
    if (!wantsCapture) {
      captureInfo = { status: 'not_requested', artifact: null };
    } else if (capability !== 'supported') {
      if (req.requireCapture === true) {
        fail('CAPTURE_UNSUPPORTED', 'native capture is explicitly unsupported until independently tested', {
          hwnd,
          reason: 'NATIVE_CAPTURE_UNSUPPORTED',
        });
      }
      captureInfo = {
        status: 'unsupported',
        artifact: null,
        reason: 'NATIVE_CAPTURE_UNSUPPORTED',
      };
    } else {
      captureInfo = await performCapture(entry, { timeoutMs: effectiveTimeout, signal: req.signal });
    }

    return {
      status: 'observed',
      window: publishEntry(entry),
      snapshot: {
        generation: snapshot.generation,
        observedAt: snapshot.observedAt,
        ageMs,
        truncated: snapshot.truncated,
        dropped: snapshot.dropped,
      },
      capture: captureInfo,
    };
  }

  function getCapabilities() {
    return {
      read: {
        enumerateWindows: true,
        observeWindow: true,
        freshnessChecks: true,
        generationChecks: true,
        futureTimestampRejection: true,
        strictFlagTypes: true,
        timeout: true,
        cancellation: true,
        boundedResponses: true,
      },
      nativeCapture: captureCapability(captureBackend),
      nativeCaptureAttestation: CAPTURE_ATTESTATION,
      effects: EFFECTS,
    };
  }

  return Object.freeze({
    enumerate,
    observeWindow,
    getCapabilities,
    getLastSnapshot: () => (lastSnapshot ? publishSnapshot(lastSnapshot) : null),
    config: Object.freeze({ ...cfg }),
  });
}

export { createNativeObservationAdapter } from './native-port.js';
export { createIfzProjector, IFZ_STATES, IFZ_REJECTIONS } from './ifz-projection.js';

export default createObserver;
