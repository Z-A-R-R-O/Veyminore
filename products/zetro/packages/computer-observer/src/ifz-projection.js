export const IFZ_STATES = Object.freeze([
  'available',
  'idle',
  'running',
  'reportedComplete',
  'verifiedComplete',
  'unavailable',
  'interrupted',
  'uncertain',
]);

export const IFZ_REJECTIONS = Object.freeze([
  'EVENT_MALFORMED',
  'EVENT_TOO_LARGE',
  'EVENT_FUTURE',
  'EVENT_STALE',
  'EVENT_MISMATCH',
  'EVENT_REORDERED',
  'EVENT_DUPLICATE',
]);

const KIND_TO_STATE = Object.freeze({
  available: 'available',
  connected: 'available',
  idle: 'idle',
  busy: 'running',
  'worker-started': 'running',
  progress: 'running',
  'reported-complete': 'reportedComplete',
  'verified-complete': 'verifiedComplete',
  unavailable: 'unavailable',
  interrupted: 'interrupted',
  failed: 'interrupted',
});

const SUBTEXT = Object.freeze({
  available: 'System available.',
  idle: 'No active work.',
  running: 'Work in progress.',
  reportedComplete: 'Work reported complete; not independently verified.',
  verifiedComplete: 'Work verified complete.',
  unavailable: 'Status temporarily unavailable.',
  interrupted: 'Work interrupted.',
  uncertain: 'Status uncertain.',
});

const TOKEN_RE = /^[A-Za-z0-9._:-]+$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function byteLen(value) {
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

function truncateBytes(value, maxBytes) {
  if (byteLen(value) <= maxBytes) return value;
  return decoder.decode(encoder.encode(value).subarray(0, maxBytes)).replace(/�+$/, '');
}

export function createIfzProjector(options) {
  const opts = options || {};
  const clock = typeof opts.clock === 'function' ? opts.clock : () => Date.now();
  const cfg = Object.freeze({
    maxAgeMs: clampInt(opts.maxAgeMs, 0, Number.MAX_SAFE_INTEGER, 30000),
    maxEventBytes: clampInt(opts.maxEventBytes, 64, 1024 * 1024, 2048),
    maxSubtextBytes: clampInt(opts.maxSubtextBytes, 8, 1024, 160),
    maxSourceChars: clampInt(opts.maxSourceChars, 1, 256, 64),
    maxIdChars: clampInt(opts.maxIdChars, 1, 256, 128),
    maxEvidenceRefs: clampInt(opts.maxEvidenceRefs, 0, 64, 8),
    maxEvidenceRefChars: clampInt(opts.maxEvidenceRefChars, 1, 256, 128),
    recentIdLimit: clampInt(opts.recentIdLimit, 8, 4096, 64),
  });

  function blankState() {
    return {
      lastSeq: null,
      sourceToken: null,
      identity: null,
      lifecycle: 'uncertain',
      lastAccepted: null,
      verifiedEvidence: [],
      admitted: 0,
      rejected: 0,
      rejectionCounts: Object.fromEntries(IFZ_REJECTIONS.map((c) => [c, 0])),
      recentIds: new Set(),
      idRing: [],
    };
  }

  let s = blankState();

  function rejectRef(code) {
    s.rejected += 1;
    s.rejectionCounts[code] += 1;
    return Object.freeze({ admitted: false, code });
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function readToken(value, maxChars) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > maxChars ||
      !TOKEN_RE.test(value)
    ) {
      return null;
    }
    return value;
  }

  function accept(event) {
    try {
      return acceptInner(event);
    } catch {
      s.rejected += 1;
      s.rejectionCounts.EVENT_MALFORMED += 1;
      return Object.freeze({ admitted: false, code: 'EVENT_MALFORMED' });
    }
  }

  function acceptInner(event) {
    if (!isPlainObject(event)) return rejectRef('EVENT_MALFORMED');
    let serialized;
    try {
      serialized = JSON.stringify(event);
    } catch {
      return rejectRef('EVENT_MALFORMED');
    }
    if (typeof serialized !== 'string') return rejectRef('EVENT_MALFORMED');
    if (byteLen(serialized) > cfg.maxEventBytes) return rejectRef('EVENT_TOO_LARGE');

    const id = readToken(event.id, cfg.maxIdChars);
    if (id === null) return rejectRef('EVENT_MALFORMED');
    const seq = event.seq;
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) {
      return rejectRef('EVENT_MALFORMED');
    }
    const at = event.at;
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) {
      return rejectRef('EVENT_MALFORMED');
    }
    const kind = event.kind;
    if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(KIND_TO_STATE, kind)) {
      return rejectRef('EVENT_MALFORMED');
    }
    const source = readToken(event.source, cfg.maxSourceChars);
    if (source === null) return rejectRef('EVENT_MALFORMED');
    let project = null;
    if (event.project !== undefined) {
      project = readToken(event.project, cfg.maxSourceChars);
      if (project === null) return rejectRef('EVENT_MALFORMED');
    }
    let workspace = null;
    if (event.workspace !== undefined) {
      workspace = readToken(event.workspace, cfg.maxSourceChars);
      if (workspace === null) return rejectRef('EVENT_MALFORMED');
    }

    const evidence = [];
    if (event.evidence !== undefined) {
      if (!Array.isArray(event.evidence)) return rejectRef('EVENT_MALFORMED');
      if (event.evidence.length > cfg.maxEvidenceRefs) return rejectRef('EVENT_MALFORMED');
      const seenRefs = new Set();
      for (const ref of event.evidence) {
        const token = readToken(ref, cfg.maxEvidenceRefChars);
        if (token === null) return rejectRef('EVENT_MALFORMED');
        if (seenRefs.has(token)) return rejectRef('EVENT_MALFORMED');
        seenRefs.add(token);
        evidence.push(token);
      }
    }
    if (kind === 'verified-complete' && evidence.length === 0) {
      return rejectRef('EVENT_MALFORMED');
    }

    const now = clock();
    if (at > now) return rejectRef('EVENT_FUTURE');
    if (now - at > cfg.maxAgeMs) return rejectRef('EVENT_STALE');

    if (s.identity === null) {
      s.identity = Object.freeze({ source, project, workspace });
      s.sourceToken = source;
    } else if (
      source !== s.identity.source ||
      project !== s.identity.project ||
      workspace !== s.identity.workspace
    ) {
      return rejectRef('EVENT_MISMATCH');
    }

    if (s.lastSeq !== null) {
      if (seq === s.lastSeq) return rejectRef('EVENT_DUPLICATE');
      if (seq < s.lastSeq) return rejectRef('EVENT_REORDERED');
    }
    if (s.recentIds.has(id)) return rejectRef('EVENT_DUPLICATE');

    s.recentIds.add(id);
    s.idRing.push(id);
    if (s.idRing.length > cfg.recentIdLimit) {
      const old = s.idRing.shift();
      s.recentIds.delete(old);
    }
    s.lastSeq = seq;
    s.lastAccepted = { at, source, project, workspace, seq };

    const mapped = KIND_TO_STATE[kind];
    if (kind === 'verified-complete') {
      s.verifiedEvidence = evidence.slice();
      s.lifecycle = 'verifiedComplete';
    } else if (s.lifecycle === 'verifiedComplete') {
      if (mapped !== 'available' && mapped !== 'idle') s.lifecycle = mapped;
    } else {
      s.lifecycle = mapped;
    }

    s.admitted += 1;
    return Object.freeze({ admitted: true, code: null });
  }

  function project() {
    const now = clock();
    let state = 'uncertain';
    let ageMs = null;
    if (s.lastAccepted) {
      ageMs = now - s.lastAccepted.at;
      if (ageMs >= 0 && ageMs <= cfg.maxAgeMs) state = s.lifecycle;
    }
    const evidence = state === 'verifiedComplete' ? s.verifiedEvidence.slice() : [];
    return Object.freeze({
      state,
      subtext: truncateBytes(SUBTEXT[state], cfg.maxSubtextBytes),
      ageMs,
      source: s.lastAccepted ? s.lastAccepted.source : null,
      project: s.lastAccepted ? s.lastAccepted.project : null,
      workspace: s.lastAccepted ? s.lastAccepted.workspace : null,
      seq: s.lastAccepted ? s.lastAccepted.seq : null,
      evidence: Object.freeze(evidence),
      admitted: s.admitted,
      rejections: Object.freeze({
        total: s.rejected,
        byCode: Object.freeze({ ...s.rejectionCounts }),
      }),
    });
  }

  function stats() {
    return Object.freeze({
      admitted: s.admitted,
      rejected: s.rejected,
      lastSeq: s.lastSeq,
      source: s.sourceToken,
    });
  }

  function reset() {
    s = blankState();
  }

  return Object.freeze({
    accept,
    project,
    stats,
    reset,
    config: cfg,
  });
}

export default createIfzProjector;
