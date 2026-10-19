/**
 * @file index.js
 * Dependency-free OpenCode session bridge adapter.
 * Injected fetch + opaque credential callback. Loopback-only. Journaled
 * prompt intent/ack. Timeout becomes delivery_unknown; no blind resend.
 */

export { createFileJournal, JournalError } from './file-journal.js';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESPONSE_BYTES = 1048576;
const DEFAULT_MAX_REQUEST_BYTES = 65536;
const FREE_MODEL = Object.freeze({ providerID: 'opencode', modelID: 'opencode/mimo-v2.6-flash-free' });

const REDACT_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/g,
  /("authorization"\s*:\s*)"[^"]*"/gi,
  /(x-auth-token["']?\s*[:=]\s*)["'][^"']*["']/gi,
  /opencode_[A-Za-z0-9]+/g,
];

export class AdapterError extends Error {
  constructor(code, message, cause) {
    super(redact(message));
    this.name = 'AdapterError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export function redact(text) {
  let out = String(text);
  for (const re of REDACT_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

function assertLoopbackUrl(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AdapterError('invalid_endpoint', 'endpoint is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AdapterError('invalid_endpoint', 'endpoint must be http(s)');
  }
  const host = url.hostname;
  const loopback = host === '127.0.0.1' || host === '::1' || host === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  if (!loopback) {
    throw new AdapterError('invalid_endpoint', 'endpoint must be a literal loopback address');
  }
  if (url.username || url.password) {
    throw new AdapterError('invalid_endpoint', 'endpoint must not embed credentials');
  }
  return url;
}

function sameOrigin(a, b) {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
}

function timeoutSignal(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new AdapterError('timeout', 'request timed out')), ms);
  if (typeof timer.unref === 'function') timer.unref();
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

/**
 * @param {object} options
 * @param {string} options.endpoint literal loopback base URL of the local OpenCode server
 * @param {typeof fetch} options.fetch injected fetch implementation
 * @param {() => Record<string,string>|Promise<Record<string,string>>} [options.getCredentialHeaders]
 *        opaque callback returning auth headers; adapter never inspects or logs values
 * @param {string} options.projectID expected project id (exact)
 * @param {string} options.sessionID expected session id (exact)
 * @param {string} options.directory expected workspace directory from /path (exact)
 * @param {string} options.root expected workspace root from /path (exact)
 * @param {string} [options.agent] agent name for prompts (default 'build')
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxResponseBytes]
 * @param {number} [options.maxRequestBytes]
 * @param {{get(id: string): any, set(id: string, entry: any): void}} [options.journal]
 *        optional durable journal port; when provided, restart replays of a
 *        known messageID return duplicate/no-resend instead of resubmitting.
 */
export function createOpenCodeAdapter(options) {
  const {
    endpoint,
    fetch: fetchImpl,
    getCredentialHeaders,
    projectID,
    sessionID,
    directory,
    root,
    agent = 'build',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
    journal = null,
  } = options ?? {};

  if (typeof fetchImpl !== 'function') {
    throw new AdapterError('invalid_config', 'injected fetch implementation is required');
  }
  if (!projectID || !sessionID || !directory || !root) {
    throw new AdapterError('invalid_config', 'projectID, sessionID, directory and root identities are required');
  }
  const base = assertLoopbackUrl(endpoint);

  // Durable journal port ({get,set}) if injected, else in-memory. A durable
  // port makes restart replays of a known messageID return duplicate/no-resend.
  const memoryJournal = new Map();
  const durableJournal = journal && typeof journal.get === 'function' && typeof journal.set === 'function'
    ? journal
    : null;

  function journalGet(messageID) {
    return durableJournal ? durableJournal.get(messageID) : memoryJournal.get(messageID);
  }

  function journalSet(messageID, state, reason) {
    const entry = { state, at: Date.now(), ...(reason ? { reason } : {}) };
    if (durableJournal) durableJournal.set(messageID, entry);
    else memoryJournal.set(messageID, entry);
  }

  async function headers(extra) {
    const h = { accept: 'application/json', ...(extra ?? {}) };
    if (typeof getCredentialHeaders === 'function') {
      const cred = await getCredentialHeaders();
      if (cred && typeof cred === 'object') Object.assign(h, cred);
    }
    return h;
  }

  async function request(method, path, body, preHeaders) {
    const url = new URL(path, base);
    if (!sameOrigin(url, base)) {
      throw new AdapterError('auth_destination_change', 'request URL escaped pinned loopback origin');
    }
    const init = { method, redirect: 'manual', headers: await headers(preHeaders) };
    if (body !== undefined) {
      const text = JSON.stringify(body);
      if (Buffer.byteLength(text, 'utf8') > maxRequestBytes) {
        throw new AdapterError('request_too_large', 'request body exceeds configured limit');
      }
      init.headers['content-type'] = 'application/json';
      init.body = text;
    }
    const t = timeoutSignal(timeoutMs);
    let res;
    try {
      res = await fetchImpl(url.toString(), { ...init, signal: t.signal });
    } catch (err) {
      t.done();
      if (err && err.name === 'AbortError') throw new AdapterError('timeout', 'request timed out');
      throw new AdapterError('transport_error', redact(err && err.message ? err.message : String(err)));
    }
    try {
      if (res.status >= 300 && res.status < 400) {
        throw new AdapterError('auth_destination_change', 'redirects are rejected on the OpenCode bridge');
      }
      const len = Number(res.headers?.get?.('content-length') ?? 0);
      if (len > maxResponseBytes) {
        throw new AdapterError('response_too_large', 'response exceeds configured limit');
      }
      // Deadline stays armed through the bounded body read. Injected fetch
      // must honor the signal during res.text(); the race guards implementations that do not.
      let text;
      try {
        text = await Promise.race([
          res.text(),
          new Promise((_, reject) => {
            const fail = () => reject(new AdapterError('timeout', 'request timed out'));
            if (t.signal.aborted) fail();
            else t.signal.addEventListener('abort', fail, { once: true });
          }),
        ]);
      } catch (err) {
        if (err instanceof AdapterError) throw err;
        if (err && err.name === 'AbortError') throw new AdapterError('timeout', 'request timed out');
        throw new AdapterError('transport_error', redact(err && err.message ? err.message : String(err)));
      }
      if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) {
        throw new AdapterError('response_too_large', 'response exceeds configured limit');
      }
      let json = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      return { status: res.status, text, json };
    } finally {
      t.done();
    }
  }

  async function requireOk(method, path, body, preHeaders) {
    const r = await request(method, path, body, preHeaders);
    if (r.status < 200 || r.status >= 300) {
      throw new AdapterError('http_error', `${method} ${path} failed with status ${r.status}: ${redact(r.text).slice(0, 200)}`);
    }
    return r;
  }

  async function verifyIdentity() {
    const health = await requireOk('GET', '/global/health');
    if (health.json && health.json.status && health.json.status !== 'ok') {
      throw new AdapterError('identity_mismatch', 'server health is not ok');
    }
    const project = await requireOk('GET', '/project/current');
    const pid = project.json && (project.json.id ?? project.json.projectID ?? project.json.projectId);
    if (pid !== projectID) {
      throw new AdapterError('identity_mismatch', 'project identity does not match pinned projectID');
    }
    const path = await requireOk('GET', '/path');
    const dir = path.json && (path.json.directory ?? path.json.cwd ?? path.json.path);
    const rt = path.json && (path.json.root ?? path.json.workspaceRoot);
    if (dir !== directory) {
      throw new AdapterError('identity_mismatch', 'workspace directory does not match pinned directory');
    }
    if (rt !== root) {
      throw new AdapterError('identity_mismatch', 'workspace root does not match pinned root');
    }
    const sess = await requireOk('GET', `/session/${encodeURIComponent(sessionID)}`);
    const sid = sess.json && (sess.json.id ?? sess.json.sessionID ?? sess.json.sessionId);
    if (sid !== sessionID) {
      throw new AdapterError('identity_mismatch', 'session identity does not match pinned sessionID');
    }
    const sproj = sess.json && (sess.json.projectID ?? sess.json.projectId);
    if (sproj !== undefined && sproj !== projectID) {
      throw new AdapterError('identity_mismatch', 'session belongs to a different project');
    }
    return { projectID: pid, sessionID: sid, directory: dir, root: rt };
  }

  /**
   * Submit a prompt. Journals intent before submission and acknowledgment after.
   * On timeout the state becomes delivery_unknown; never blind-resends.
   */
  async function prompt({ messageID, text, model = FREE_MODEL, agentName = agent }) {
    if (!messageID || typeof messageID !== 'string') {
      throw new AdapterError('invalid_argument', 'messageID is required');
    }
    if (!text || typeof text !== 'string') {
      throw new AdapterError('invalid_argument', 'text is required');
    }
    if (!model || model.providerID !== FREE_MODEL.providerID || model.modelID !== FREE_MODEL.modelID) {
      throw new AdapterError('model_not_pinned', 'only the pinned free model opencode/mimo-v2.6-flash-free is allowed; no paid fallback');
    }
    const prior = journalGet(messageID);
    if (prior) {
      return { messageID, state: prior.state, duplicate: true, resent: false };
    }
    // Reserve intent synchronously before any await so concurrent prompts with
    // the same messageID cannot both pass the duplicate check and reach
    // prompt_async (at most one POST per messageID).
    journalSet(messageID, 'intent');
    try {
      await verifyIdentity();
    } catch (err) {
      // Identity pinning failed before submission; nothing was sent, so this
      // is a definite rejection (not delivery_unknown) and never resent.
      journalSet(messageID, 'rejected', 'identity_verification_failed');
      throw err;
    }
    try {
      const res = await request('POST', `/session/${encodeURIComponent(sessionID)}/prompt_async`, {
        messageID,
        model: { providerID: model.providerID, modelID: model.modelID },
        agent: agentName,
        parts: [{ type: 'text', text }],
      });
      if (res.status === 204) {
        journalSet(messageID, 'acknowledged');
        return { messageID, state: 'acknowledged', duplicate: false, resent: false };
      }
      if (res.status >= 300) {
        journalSet(messageID, 'rejected', `status_${res.status}`);
        throw new AdapterError('prompt_rejected', `prompt_async returned status ${res.status}`);
      }
      journalSet(messageID, 'acknowledged');
      return { messageID, state: 'acknowledged', duplicate: false, resent: false };
    } catch (err) {
      if (err instanceof AdapterError && err.code === 'timeout') {
        journalSet(messageID, 'delivery_unknown', 'timeout');
        return { messageID, state: 'delivery_unknown', duplicate: false, resent: false };
      }
      if (journalGet(messageID)?.state === 'intent') {
        journalSet(messageID, 'delivery_unknown', redact(err && err.message ? err.message : String(err)));
      }
      throw err;
    }
  }

  /**
   * Read-only correlation of a known messageID via GET /session/:id/message.
   * Never resends. Marks acknowledged only when the server echoes the messageID.
   */
  async function correlate(messageID) {
    const entry = journalGet(messageID);
    if (!entry) {
      throw new AdapterError('unknown_message', 'messageID is not present in the journal');
    }
    if (entry.state === 'acknowledged') {
      return { messageID, state: 'acknowledged', correlated: true };
    }
    const res = await requireOk('GET', `/session/${encodeURIComponent(sessionID)}/message`);
    const list = Array.isArray(res.json) ? res.json : res.json && Array.isArray(res.json.messages) ? res.json.messages : [];
    const seen = list.some((m) => m && (m.id === messageID || m.messageID === messageID));
    if (seen) {
      journalSet(messageID, 'acknowledged');
      return { messageID, state: 'acknowledged', correlated: true };
    }
    return { messageID, state: entry.state, correlated: false };
  }

  /**
   * Session status. Idle or assistant claims never certify completion;
   * this method never mutates journal completion state.
   */
  async function status() {
    const res = await requireOk('GET', `/session/${encodeURIComponent(sessionID)}/status`);
    return {
      raw: res.json,
      completes: false,
      note: 'idle or assistant claims never certify completion',
    };
  }

  /** Journal snapshot for a messageID. */
  function receipt(messageID) {
    const e = journalGet(messageID);
    return e ? { messageID, ...e } : null;
  }

  /**
   * Abort the pinned session. Re-verifies exact pinned identity on every
   * mutation; no identity is cached across calls.
   */
  async function abort() {
    await verifyIdentity();
    await requireOk('POST', `/session/${encodeURIComponent(sessionID)}/abort`, {});
    return { aborted: true };
  }

  return { verifyIdentity, prompt, correlate, status, abort, receipt, freeModel: FREE_MODEL };
}

// ============================================================================
// Pure IFZ Worker Manifest & Availability Projection
// ============================================================================

export const MANIFEST_PINNED_MODEL = Object.freeze({
  providerID: 'opencode',
  modelID: 'opencode/mimo-v2.6-flash-free'
});

export class ManifestError extends Error {
  constructor(code, message) {
    super(redact(message));
    this.name = 'ManifestError';
    this.code = code;
  }
}

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f<>\\'";]/;

function validateId(val, name) {
  if (typeof val !== 'string' || !SAFE_ID_RE.test(val) || CONTROL_CHAR_RE.test(val)) {
    throw new ManifestError('unsafe_identity', `${name} contains unsafe characters or does not match ^[a-zA-Z0-9_-]{1,128}$`);
  }
  return val;
}

const KNOWN_EFFECT_TOKENS = Object.freeze({
  'read': 'read',
  'write': 'write',
  'exec': 'execute',
  'execute': 'execute',
  'network': 'external-send',
  'external-send': 'external-send',
  'external_send': 'external-send',
  'inference': 'inference',
  'computer': 'computer'
});

function parsePermissions(permissions) {
  if (!permissions) {
    throw new ManifestError('malformed_permissions', 'permissions input is required');
  }

  const rules = Array.isArray(permissions)
    ? permissions
    : (Array.isArray(permissions.rules) ? permissions.rules : null);

  if (!rules) {
    throw new ManifestError('malformed_permissions', 'permissions must be an array of rule strings or an object with rules array');
  }

  const effects = new Set();
  const actions = [];

  for (const r of rules) {
    if (typeof r !== 'string' || r.trim().length === 0) {
      throw new ManifestError('malformed_permissions', 'each rule must be a non-empty string');
    }
    const trimmed = r.trim();
    let prefix = 'allow';
    let token = trimmed;

    if (trimmed.includes(':')) {
      const parts = trimmed.split(':');
      if (parts.length !== 2) {
        throw new ManifestError('malformed_permissions', `invalid rule format '${trimmed}'`);
      }
      prefix = parts[0].toLowerCase();
      token = parts[1].toLowerCase();
      if (prefix !== 'allow' && prefix !== 'deny' && prefix !== 'ask') {
        throw new ManifestError('malformed_permissions', `unknown permission prefix '${prefix}' in rule '${trimmed}'`);
      }
    } else {
      token = trimmed.toLowerCase();
    }

    const canonicalEffect = KNOWN_EFFECT_TOKENS[token];
    if (!canonicalEffect) {
      throw new ManifestError('unknown_effect', `unknown permission effect token '${token}' in rule '${trimmed}'`);
    }

    if (prefix === 'allow') {
      effects.add(canonicalEffect);
      actions.push(token);
    } else if (prefix === 'deny') {
      effects.delete(canonicalEffect);
    }
  }

  return {
    effects: Array.from(effects).sort(),
    actions: Array.from(new Set(actions)).sort()
  };
}

function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const k of Object.keys(obj)) {
    deepFreeze(obj[k]);
  }
  return obj;
}

/**
 * Pure projection of an OpenCode worker claim into an IFZ WorkerManifest.
 *
 * @param {Object} claim
 * @param {Object} [options]
 * @param {string} [options.projectID]
 * @param {string} [options.projectId]
 * @param {string} [options.workspaceId]
 * @param {string} [options.directory]
 * @param {string} [options.sessionID]
 * @param {number} [options.now=Date.now()]
 * @param {number} [options.maxAgeMs=300000]
 * @param {Set<string>} [options.registry]
 * @returns {Readonly<Object>}
 */
export function projectWorkerManifest(claim, options = {}) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
    throw new ManifestError('invalid_argument', 'claim must be a non-null plain object');
  }

  const workerId = validateId(claim.workerId || claim.workerID || `ocr_${claim.sessionID || claim.sessionId}`, 'workerId');
  const sessionID = validateId(claim.sessionID || claim.sessionId, 'sessionID');
  const projectId = validateId(claim.projectId || claim.projectID, 'projectId');
  const workspaceId = validateId(claim.workspaceId || claim.workspaceID || claim.directory, 'workspaceId');

  // Exact identity matching against options if supplied
  if (options.projectID && options.projectID !== projectId) {
    throw new ManifestError('identity_mismatch', `project identity mismatch: expected '${options.projectID}', got '${projectId}'`);
  }
  if (options.projectId && options.projectId !== projectId) {
    throw new ManifestError('identity_mismatch', `project identity mismatch: expected '${options.projectId}', got '${projectId}'`);
  }
  if (options.workspaceId && options.workspaceId !== workspaceId) {
    throw new ManifestError('identity_mismatch', `workspace identity mismatch: expected '${options.workspaceId}', got '${workspaceId}'`);
  }
  if (options.directory && options.directory !== (claim.directory || workspaceId)) {
    throw new ManifestError('identity_mismatch', `directory identity mismatch: expected '${options.directory}', got '${claim.directory}'`);
  }
  if (options.sessionID && options.sessionID !== sessionID) {
    throw new ManifestError('identity_mismatch', `session identity mismatch: expected '${options.sessionID}', got '${sessionID}'`);
  }

  // Model pinning check: opencode/mimo-v2.6-flash-free only
  const model = claim.model;
  if (!model || model.providerID !== MANIFEST_PINNED_MODEL.providerID || model.modelID !== MANIFEST_PINNED_MODEL.modelID) {
    throw new ManifestError('model_not_pinned', 'only opencode/mimo-v2.6-flash-free is allowed; no paid fallback');
  }

  // Qualification check
  const isQual = claim.isQualified === true || claim.qualification?.status === 'passed' || claim.qualification?.status === 'qualified';
  if (!isQual || claim.isQualified === false || claim.qualification === 'failed' || claim.qualification?.status === 'failed') {
    throw new ManifestError('missing_qualification', 'worker qualification is missing, unverified, or failed');
  }

  // Freshness check
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const maxAgeMs = typeof options.maxAgeMs === 'number' ? options.maxAgeMs : 300000;
  const observedAt = claim.observedAt ?? claim.availability?.observedAt;

  if (typeof observedAt !== 'number' || observedAt <= 0 || !Number.isFinite(observedAt)) {
    throw new ManifestError('stale_observation', 'observedAt must be a positive finite timestamp');
  }
  if (observedAt > now + 60000) {
    throw new ManifestError('future_observation', `observedAt is in the future (${observedAt} > now ${now} + 60s skew)`);
  }
  if (now - observedAt > maxAgeMs) {
    throw new ManifestError('stale_observation', `observedAt is stale (${now - observedAt}ms old > ${maxAgeMs}ms limit)`);
  }

  // Availability status check: busy/idle/available/running only, never completion
  const rawStatus = (claim.availability?.status || claim.status || 'available').toLowerCase();
  const validStatuses = ['available', 'idle', 'busy', 'running'];
  if (!validStatuses.includes(rawStatus)) {
    if (rawStatus === 'completed' || rawStatus === 'done' || rawStatus === 'finished') {
      throw new ManifestError('invalid_availability', `status '${rawStatus}' implies completion; observed status must reflect active availability only`);
    }
    throw new ManifestError('invalid_availability', `invalid availability status '${rawStatus}'`);
  }

  // Duplicate check against registry
  if (options.registry) {
    if (options.registry.has(workerId)) {
      throw new ManifestError('duplicate_identity', `workerId '${workerId}' is already registered in this batch/registry`);
    }
    if (options.registry.has(sessionID)) {
      throw new ManifestError('duplicate_identity', `sessionID '${sessionID}' is already registered in this batch/registry`);
    }
    options.registry.add(workerId);
    options.registry.add(sessionID);
  }

  // Parse permissions
  const { effects, actions } = parsePermissions(claim.permissions);

  // Whitelist-only output
  const manifest = {
    schemaVersion: 'zetro.ifz.worker_manifest.v1',
    workerId,
    workerType: 'opencode-worker',
    adapterId: '@zetro/opencode-adapter@0.1.0',
    projectId,
    workspaceId,
    sessionID,
    directory: typeof claim.directory === 'string' ? claim.directory : workspaceId,
    gitRoot: typeof claim.gitRoot === 'string' ? claim.gitRoot : (typeof claim.root === 'string' ? claim.root : workspaceId),
    model: MANIFEST_PINNED_MODEL,
    capabilities: {
      effects,
      actions,
      canDelegate: false,
      supportsCancellation: true,
      supportsResume: false
    },
    availability: {
      status: rawStatus,
      observedAt,
      sessionState: claim.lastObservation?.sessionState || claim.sessionState || rawStatus,
      completionCertified: false
    },
    qualification: {
      status: 'qualified',
      verifiedAt: claim.qualification?.verifiedAt || observedAt
    }
  };

  return deepFreeze(manifest);
}

/**
 * Projects a batch of OpenCode worker claims into deeply frozen WorkerManifests.
 * Enforces registry bound (max 64) and duplicate detection.
 *
 * @param {Array<Object>} claims
 * @param {Object} [options]
 * @returns {Array<Readonly<Object>>}
 */
export function projectWorkerManifests(claims, options = {}) {
  if (!Array.isArray(claims)) {
    throw new ManifestError('invalid_argument', 'claims must be an array');
  }
  if (claims.length > 64) {
    throw new ManifestError('registry_full', `manifest batch size ${claims.length} exceeds bound of 64`);
  }

  const registry = options.registry || new Set();
  const manifests = [];

  for (const claim of claims) {
    manifests.push(projectWorkerManifest(claim, { ...options, registry }));
  }

  return Object.freeze(manifests);
}
