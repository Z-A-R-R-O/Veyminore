#!/usr/bin/env node

/**
 * ZETRO Bounded Free Synthetic Qualification Runner
 *
 * Standalone qualification runner for validating candidate free models
 * against synthetic, public-only fixtures before any live qualification.
 *
 * Owned by AGR-5 (Milestone M0 Lead / Release Qualification).
 *
 * One Qualification Path (W5R-AGR5-one-qualification-path):
 * - Uses the EXACT SAME pipeline in both mock and live modes:
 *     ModelDiscoveryService (fresh metadata discovery)
 *     -> validateModelSnapshot + verifyCandidateEligibility (Gate 7 + suffix-only rejection)
 *     -> createCatalogSnapshotPort (shares fresh discovery proof with provider config)
 *     -> loadProviderConfig (mode: live-approved, ready: true)
 *     -> createConfiguredProvider / ConfiguredModelProvider (evaluates all 7 gates)
 *     -> OpenRouterProvider (actual candidate adapter)
 *     -> PolicyService + RctPolicyPort (authority grants)
 *     -> RealRctAdapter + TaskManager (isolated execution runtime)
 *     -> SqliteTaskStore (durable transactional evidence store)
 *     -> createIndependentRctVerifier (independent exact-check verification)
 * - Fetch-level reservation: Each HTTP dispatch (including retries) is counted against the 6-request cap.
 * - Strict fail-closed stop on HTTP 401, 402, 403, 429, non-zero pricing, or paid fallback attempt.
 * - In-flight deadline & wall-clock budget enforcement (max 30s per request, max 180s total campaign).
 * - Actual measured token usage from response payloads without fabrication.
 * - Requires all 3 trials verified for QUALIFIED status; exits non-zero otherwise.
 *
 * Operating Modes:
 * - Default: Offline dry-run (validates pipeline prerequisites, prints plan & opt-in command, exits 0)
 * - --mock / --test: Executes the complete pipeline offline using mocked transport with full barrier tests
 * - --live-opt-in: Opt-in live execution requiring coordinator credentials and authorization
 */

const fs = require('node:fs');
const { mkdir, writeFile, readFile, rm, mkdtemp } = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert');

const ROOT_DIR = path.resolve(__dirname, '..');

// Campaign Hard Limits & Invariants
const CAMPAIGN_BOUNDS = Object.freeze({
  MAX_TRIALS: 3,
  MAX_TOTAL_INFERENCE_REQUESTS: 6,
  MAX_OUTPUT_TOKENS_PER_REQUEST: 400,
  MAX_REQUEST_TIMEOUT_MS: 30000,
  MAX_CAMPAIGN_WALL_MS: 180000,
  STOP_HTTP_CODES: Object.freeze([401, 402, 403, 429])
});

// Candidate Specification
const CANDIDATE_SPEC = Object.freeze({
  provider: 'openrouter',
  model: 'cohere/north-mini-code:free',
  requiredSuffix: ':free',
  chatEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
  modelsEndpoint: 'https://openrouter.ai/api/v1/models',
  authEndpoint: 'https://openrouter.ai/api/v1/auth/key'
});

// Public Synthetic Fixtures (Generated only, zero repo source / context)
const SYNTHETIC_FIXTURES = Object.freeze([
  {
    id: 'trial-1-numeric',
    name: 'Numeric Addition Fix',
    relPath: 'src/calc.js',
    initialContent: [
      'function calculateTotal(items) {',
      '  return items.reduce((acc, item) => acc - item.price, 0);',
      '}',
      'module.exports = { calculateTotal };',
      ''
    ].join('\n'),
    targetContent: [
      'function calculateTotal(items) {',
      '  return items.reduce((acc, item) => acc + item.price, 0);',
      '}',
      'module.exports = { calculateTotal };',
      ''
    ].join('\n'),
    objective: 'Fix operator in calculateTotal so prices are added rather than subtracted',
    summary: 'Fixed subtraction operator to addition in calculateTotal'
  },
  {
    id: 'trial-2-greeting',
    name: 'Greeting Formatting Fix',
    relPath: 'src/greeting.js',
    initialContent: [
      'function formatGreeting(name) {',
      "  return 'Goodbye, ' + name;",
      '}',
      'module.exports = { formatGreeting };',
      ''
    ].join('\n'),
    targetContent: [
      'function formatGreeting(name) {',
      "  return 'Hello, ' + name + '!';",
      '}',
      'module.exports = { formatGreeting };',
      ''
    ].join('\n'),
    objective: 'Change greeting message to return Hello, <name>!',
    summary: 'Updated formatGreeting return value to Hello, <name>!'
  },
  {
    id: 'trial-3-status',
    name: 'Status Flag Update',
    relPath: 'src/status.js',
    initialContent: [
      "const STATUS = 'offline';",
      'module.exports = { STATUS };',
      ''
    ].join('\n'),
    targetContent: [
      "const STATUS = 'ready';",
      'module.exports = { STATUS };',
      ''
    ].join('\n'),
    objective: 'Update STATUS constant from offline to ready',
    summary: 'Changed STATUS constant to ready'
  }
]);

/**
 * Loads internal product packages dynamically via file URLs.
 */
async function loadModules() {
  const [orch, rct, policy, provCfg, modelProv] = await Promise.all([
    import(pathToFileURL(path.resolve(ROOT_DIR, 'packages/orchestration-core/src/index.js')).href),
    import(pathToFileURL(path.resolve(ROOT_DIR, 'packages/rct-runtime/src/index.js')).href),
    import(pathToFileURL(path.resolve(ROOT_DIR, 'packages/policy/src/index.js')).href),
    import(pathToFileURL(path.resolve(ROOT_DIR, 'packages/provider-config/src/index.js')).href),
    import(pathToFileURL(path.resolve(ROOT_DIR, 'packages/model-providers/src/index.js')).href)
  ]);

  return { orch, rct, policy, provCfg, modelProv };
}

/**
 * Verifies candidate model eligibility using fresh metadata discovery.
 * Strictly enforces that :free suffix alone is NEVER proof.
 */
function verifyCandidateEligibility({ provider, model, snapshot }) {
  if (!provider || provider.toLowerCase().trim() !== CANDIDATE_SPEC.provider) {
    throw new Error(`Candidate provider '${provider}' must be '${CANDIDATE_SPEC.provider}'`);
  }

  const normModel = (model || '').trim();
  if (normModel !== CANDIDATE_SPEC.model) {
    throw new Error(`Candidate model '${normModel}' must match measured candidate '${CANDIDATE_SPEC.model}'`);
  }

  // 1. Suffix requirement: :free suffix is necessary for OpenRouter free routing
  if (!normModel.endsWith(CANDIDATE_SPEC.requiredSuffix)) {
    throw new Error(`Candidate model '${normModel}' lacks required '${CANDIDATE_SPEC.requiredSuffix}' suffix`);
  }

  // 2. Gate: Suffix alone is never proof; must have fresh validated metadata snapshot
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Fresh metadata snapshot proof is required. Suffix :free alone is never proof of free eligibility.');
  }

  // 3. Exact pricing proof
  const pricing = snapshot.pricing;
  if (!pricing || typeof pricing !== 'object') {
    throw new Error('Model snapshot missing pricing object');
  }

  if (pricing.inputCostPerM !== 0 || pricing.outputCostPerM !== 0) {
    throw new Error(`Candidate model has non-zero pricing (inputCostPerM: ${pricing.inputCostPerM}, outputCostPerM: ${pricing.outputCostPerM}). Paid fallback prohibited.`);
  }

  if (snapshot.isFree !== true) {
    throw new Error('Candidate model snapshot does not prove isFree: true');
  }

  // 4. Literal tool calling capability proof
  if (snapshot.toolCalling !== true) {
    throw new Error(`Candidate model does not prove literal tool calling capability (toolCalling must be true)`);
  }

  const params = Array.isArray(snapshot.supportedParameters) ? snapshot.supportedParameters : [];
  const hasTools = params.includes('tools') || params.includes('functions');
  if (!hasTools) {
    throw new Error(`Candidate model lacks verified tool calling capability in supportedParameters: [${params.join(', ')}]`);
  }

  // 5. Output token limit capability proof
  const hasTokenLimit = params.includes('max_tokens') || params.includes('max_completion_tokens');
  if (!hasTokenLimit) {
    throw new Error(`Candidate model lacks output token limit parameter ('max_tokens' or 'max_completion_tokens') in supportedParameters`);
  }

  // 6. Source endpoint verification
  if (snapshot.source !== CANDIDATE_SPEC.modelsEndpoint) {
    throw new Error(`Metadata snapshot source '${snapshot.source}' does not match approved models discovery endpoint '${CANDIDATE_SPEC.modelsEndpoint}'`);
  }

  return {
    eligible: true,
    candidate: `${provider}:${model}`,
    pricingProvenZero: true,
    toolCallingProven: true,
    tokenLimitProven: true,
    suffixOnlyProofRejected: true
  };
}

/**
 * Strict validator for token counts: must be literal finite nonnegative integer.
 * Suffixes, negative numbers, floats, strings, null, undefined, objects are invalid.
 */
function isStrictNonNegativeInteger(val) {
  return typeof val === 'number' && Number.isInteger(val) && Number.isFinite(val) && val >= 0 && !Object.is(val, -0);
}

/**
 * Validates token usage object payload strictly.
 * Returns { valid: true, promptTokens, completionTokens, totalTokens } or { valid: false, reason }.
 * Never defaults missing as zero.
 */
function validateUsagePayload(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return { valid: false, reason: 'missing_or_non_object_usage' };
  }

  const p = usage.prompt_tokens;
  const c = usage.completion_tokens;
  const t = usage.total_tokens;

  if (!isStrictNonNegativeInteger(p)) {
    return { valid: false, reason: `invalid_prompt_tokens: ${typeof p === 'object' ? JSON.stringify(p) : String(p)}` };
  }

  if (!isStrictNonNegativeInteger(c)) {
    return { valid: false, reason: `invalid_completion_tokens: ${typeof c === 'object' ? JSON.stringify(c) : String(c)}` };
  }

  let total;
  if (t !== undefined && t !== null) {
    if (!isStrictNonNegativeInteger(t)) {
      return { valid: false, reason: `invalid_total_tokens: ${typeof t === 'object' ? JSON.stringify(t) : String(t)}` };
    }
    if (t < (p + c)) {
      return { valid: false, reason: `total_tokens_${t}_less_than_sum_${p + c}` };
    }
    total = t;
  } else {
    total = p + c;
  }

  return {
    valid: true,
    promptTokens: p,
    completionTokens: c,
    totalTokens: total
  };
}

/**
 * Fetch-Level Campaign Monitor and Dispatch Gatekeeper.
 *
 * Enforces request caps, timeout deadlines, and fail-closed stops at the
 * HTTP transport layer for every outgoing dispatch (including retries).
 */
class CampaignFetchMonitor {
  constructor(options = {}) {
    let maxWall = options.maxWallMs ?? options.maxWall ?? options.wallMs ?? options.wall;
    let maxReq = options.maxRequestTimeoutMs ?? options.requestTimeoutMs ?? options.requestMs ?? options.request;

    for (const key of Object.keys(options)) {
      const matchWall = key.match(/maxWall(\d+)ms/i) || key.match(/wall(\d+)ms/i);
      if (matchWall && maxWall === undefined) {
        maxWall = parseInt(matchWall[1], 10);
      }
      const matchReq = key.match(/request(\d+)ms/i) || key.match(/maxRequest(\d+)ms/i);
      if (matchReq && maxReq === undefined) {
        maxReq = parseInt(matchReq[1], 10);
      }
    }

    this.maxWallMs = maxWall !== undefined ? maxWall : CAMPAIGN_BOUNDS.MAX_CAMPAIGN_WALL_MS;
    this.maxRequestTimeoutMs = maxReq !== undefined ? maxReq : CAMPAIGN_BOUNDS.MAX_REQUEST_TIMEOUT_MS;
    this.maxInferenceRequests = options.maxInferenceRequests ?? options.maxRequests ?? CAMPAIGN_BOUNDS.MAX_TOTAL_INFERENCE_REQUESTS;
    this.maxTotalDispatches = options.maxTotalDispatches ?? (options.maxRequests !== undefined ? options.maxRequests : null);
    this.maxOutputTokens = options.maxOutputTokens ?? CAMPAIGN_BOUNDS.MAX_OUTPUT_TOKENS_PER_REQUEST;
    this.stopHttpCodes = new Set(options.stopHttpCodes ?? CAMPAIGN_BOUNDS.STOP_HTTP_CODES);

    this.startTime = Date.now();
    this.totalDispatches = 0;
    this.inferenceRequestsDispatched = 0;
    this.actualInputTokens = 0;
    this.actualOutputTokens = 0;
    this.actualTotalTokens = 0;
    this.hasUnknownUsage = false;
    this.halted = false;
    this.haltReason = null;
    this.httpStopStatus = null;
    this.dispatches = [];
  }

  /**
   * Returns an intercepting fetch implementation that wraps the underlying fetch.
   */
  createInterceptingFetch(baseFetch = globalThis.fetch) {
    return async (url, options = {}) => {
      const urlStr = typeof url === 'string' ? url : url?.toString() || '';
      const method = (options.method || 'GET').toUpperCase();
      const isInference = method === 'POST' || urlStr.includes('/chat/completions');

      // 1. In-flight campaign wall-clock deadline check before starting dispatch
      const elapsed = Date.now() - this.startTime;
      const remainingWallMs = this.maxWallMs - elapsed;
      if (remainingWallMs <= 0 || this.halted) {
        if (!this.halted) {
          this.halted = true;
          this.haltReason = `Campaign wall-clock budget of ${this.maxWallMs}ms exceeded in-flight`;
        }
        this.hasUnknownUsage = true;
        const err = new Error(`CAMPAIGN_LIMIT_EXCEEDED: ${this.haltReason}`);
        err.name = 'CampaignLimitError';
        throw err;
      }

      // 2. Compute effective per-dispatch deadline combining request deadline & remaining campaign budget
      const effectiveTimeoutMs = Math.min(this.maxRequestTimeoutMs, remainingWallMs);
      if (effectiveTimeoutMs <= 0) {
        this.halted = true;
        this.hasUnknownUsage = true;
        this.haltReason = `Campaign wall-clock budget of ${this.maxWallMs}ms exceeded in-flight`;
        const err = new Error(`CAMPAIGN_LIMIT_EXCEEDED: ${this.haltReason}`);
        err.name = 'CampaignLimitError';
        throw err;
      }

      // 3. Pre-dispatch reservation for total dispatches and inference requests
      if (this.maxTotalDispatches !== null && this.totalDispatches >= this.maxTotalDispatches) {
        this.halted = true;
        this.hasUnknownUsage = true;
        this.haltReason = `Exceeded campaign hard limit of ${this.maxTotalDispatches} total dispatches`;
        const err = new Error(`CAMPAIGN_LIMIT_EXCEEDED: ${this.haltReason}`);
        err.name = 'CampaignLimitError';
        throw err;
      }

      if (isInference) {
        if (this.inferenceRequestsDispatched >= this.maxInferenceRequests) {
          this.halted = true;
          this.hasUnknownUsage = true;
          this.haltReason = `Exceeded campaign hard limit of ${this.maxInferenceRequests} inference requests`;
          const err = new Error(`CAMPAIGN_LIMIT_EXCEEDED: ${this.haltReason}`);
          err.name = 'CampaignLimitError';
          throw err;
        }
        this.inferenceRequestsDispatched++;
      }

      this.totalDispatches++;
      const dispatchIndex = this.totalDispatches;
      const inferenceIndex = isInference ? this.inferenceRequestsDispatched : null;
      const reqStart = Date.now();

      // 4. Setup timeout controller combining caller abortsignal and dispatch deadline
      const dispatchAbort = new AbortController();
      let timerId = null;
      let timedOut = false;
      let timeoutError = null;

      let callerAbortListener = null;
      if (options.signal) {
        if (options.signal.aborted) {
          dispatchAbort.abort(options.signal.reason);
        } else {
          callerAbortListener = () => dispatchAbort.abort(options.signal.reason);
          options.signal.addEventListener('abort', callerAbortListener, { once: true });
        }
      }

      timerId = setTimeout(() => {
        timedOut = true;
        this.halted = true;
        this.hasUnknownUsage = true;
        const totalElapsed = Date.now() - this.startTime;
        if (totalElapsed >= this.maxWallMs) {
          this.haltReason = `Campaign wall-clock budget of ${this.maxWallMs}ms exceeded in-flight`;
        } else {
          this.haltReason = `Request deadline of ${this.maxRequestTimeoutMs}ms exceeded in-flight`;
        }
        timeoutError = new Error(`CAMPAIGN_LIMIT_EXCEEDED: ${this.haltReason}`);
        timeoutError.name = 'TimeoutError';
        dispatchAbort.abort(timeoutError);
      }, effectiveTimeoutMs);

      // Helper to race inflight promise against the combined dispatch deadline
      const raceOperation = (opPromise, opName) => {
        return new Promise((resolve, reject) => {
          let settled = false;

          const onAbort = () => {
            if (settled) return;
            settled = true;
            this.halted = true;
            this.hasUnknownUsage = true;
            const err = timeoutError || dispatchAbort.signal.reason || new Error(`CAMPAIGN_LIMIT_EXCEEDED: ${this.haltReason || 'Deadline exceeded'}`);
            if (!err.name || err.name === 'Error') {
              err.name = timedOut ? 'TimeoutError' : 'AbortError';
            }
            reject(err);
          };

          if (dispatchAbort.signal.aborted) {
            onAbort();
            return;
          }

          dispatchAbort.signal.addEventListener('abort', onAbort, { once: true });

          opPromise.then(
            res => {
              if (settled) return;
              settled = true;
              dispatchAbort.signal.removeEventListener('abort', onAbort);

              // Reject late completion check
              const now = Date.now();
              const reqDuration = now - reqStart;
              const totalElapsed = now - this.startTime;
              if (timedOut || totalElapsed >= this.maxWallMs || reqDuration > this.maxRequestTimeoutMs) {
                this.halted = true;
                this.hasUnknownUsage = true;
                if (totalElapsed >= this.maxWallMs) {
                  this.haltReason = `Campaign wall-clock budget of ${this.maxWallMs}ms exceeded in-flight`;
                } else {
                  this.haltReason = `Request deadline of ${this.maxRequestTimeoutMs}ms exceeded in-flight`;
                }
                const lateErr = new Error(`CAMPAIGN_LIMIT_EXCEEDED: ${this.haltReason}`);
                lateErr.name = 'TimeoutError';
                reject(lateErr);
                return;
              }

              resolve(res);
            },
            err => {
              if (settled) return;
              settled = true;
              dispatchAbort.signal.removeEventListener('abort', onAbort);
              this.hasUnknownUsage = true;
              reject(err);
            }
          );
        });
      };

      // 5. Dispatch HTTP request through base fetch raced against deadline
      let response;
      try {
        const fetchPromise = Promise.resolve().then(() => baseFetch(url, { ...options, signal: dispatchAbort.signal }));
        response = await raceOperation(fetchPromise, 'fetch');
      } catch (err) {
        if (timerId) clearTimeout(timerId);
        if (callerAbortListener && options.signal) {
          options.signal.removeEventListener('abort', callerAbortListener);
        }
        this.hasUnknownUsage = true;
        this.dispatches.push({
          index: dispatchIndex,
          inferenceIndex,
          url: urlStr,
          method,
          durationMs: Date.now() - reqStart,
          status: null,
          error: err.message
        });
        throw err;
      }

      const reqDuration = Date.now() - reqStart;

      // 6. Strict fail-closed HTTP stop check (HTTP 401, 402, 403, 429)
      if (this.stopHttpCodes.has(response.status)) {
        if (timerId) clearTimeout(timerId);
        if (callerAbortListener && options.signal) {
          options.signal.removeEventListener('abort', callerAbortListener);
        }
        this.halted = true;
        this.hasUnknownUsage = true;
        this.httpStopStatus = response.status;
        this.haltReason = `HTTP ${response.status} received at fetch transport. Stop policy triggered; paid fallback prohibited.`;
        this.dispatches.push({
          index: dispatchIndex,
          inferenceIndex,
          url: urlStr,
          method,
          durationMs: reqDuration,
          status: response.status,
          haltTriggered: true
        });
        return response;
      }

      // If response is not ok (e.g. non-200 non-stop), mark usage unknown
      if (!response.ok) {
        this.hasUnknownUsage = true;
      }

      // 7. Measure actual token usage directly from response JSON without fabricating
      if (isInference && response.ok) {
        try {
          const clone = typeof response.clone === 'function' ? response.clone() : null;
          if (clone && typeof clone.json === 'function') {
            const body = await raceOperation(clone.json(), 'body');
            const usageResult = validateUsagePayload(body?.usage);
            if (usageResult.valid) {
              this.actualInputTokens += usageResult.promptTokens;
              this.actualOutputTokens += usageResult.completionTokens;
              this.actualTotalTokens += usageResult.totalTokens;

              if (usageResult.completionTokens > this.maxOutputTokens) {
                this.halted = true;
                this.haltReason = `Output tokens (${usageResult.completionTokens}) exceeded per-request limit of ${this.maxOutputTokens}`;
              }
            } else {
              this.hasUnknownUsage = true;
            }
          } else {
            this.hasUnknownUsage = true;
          }
        } catch {
          this.hasUnknownUsage = true;
        }
      } else if (isInference) {
        this.hasUnknownUsage = true;
      }

      // Also wrap response.json for caller to race body reading
      if (response && typeof response.json === 'function') {
        const originalJson = response.json.bind(response);
        response.json = async () => {
          return raceOperation(originalJson(), 'response-json');
        };
      }

      if (timerId) clearTimeout(timerId);
      if (callerAbortListener && options.signal) {
        options.signal.removeEventListener('abort', callerAbortListener);
      }

      this.dispatches.push({
        index: dispatchIndex,
        inferenceIndex,
        url: urlStr,
        method,
        durationMs: reqDuration,
        status: response.status
      });

      return response;
    };
  }

  getMetrics() {
    return {
      wallMs: Date.now() - this.startTime,
      totalDispatches: this.totalDispatches,
      inferenceRequestsDispatched: this.inferenceRequestsDispatched,
      actualInputTokens: this.actualInputTokens,
      actualOutputTokens: this.actualOutputTokens,
      actualTotalTokens: this.actualTotalTokens,
      hasUnknownUsage: this.hasUnknownUsage,
      halted: this.halted,
      haltReason: this.haltReason,
      httpStopStatus: this.httpStopStatus
    };
  }
}

/**
 * Creates a schema-valid mock discovery response body.
 */
function createMockDiscoveryCatalog({
  modelId = CANDIDATE_SPEC.model,
  promptPrice = '0',
  completionPrice = '0',
  requestPrice = '0',
  supportedParameters = ['tools', 'tool_choice', 'max_tokens', 'temperature']
} = {}) {
  return {
    data: [
      {
        id: modelId,
        name: 'Cohere North Mini Code (Free)',
        context_length: 32768,
        pricing: {
          prompt: promptPrice,
          completion: completionPrice,
          request: requestPrice
        },
        supported_parameters: supportedParameters
      }
    ]
  };
}

/**
 * Creates a mock transport for testing the real OpenRouter adapter pipeline offline.
 */
function createMockTransport({
  discoveryCatalog = createMockDiscoveryCatalog(),
  authStatus = 200,
  chatStatus = 200,
  simulateRetry = false,
  excessiveOutputTokens = false,
  customUsage = null,
  fetchDelayMs = 0,
  bodyDelayMs = 0,
  discoveryDelayMs = 0
} = {}) {
  let retryCount = 0;

  return async (url, options = {}) => {
    const urlStr = typeof url === 'string' ? url : url?.toString() || '';
    const method = (options.method || 'GET').toUpperCase();

    // 1. Models Discovery Endpoint
    if (urlStr === CANDIDATE_SPEC.modelsEndpoint) {
      if (discoveryDelayMs > 0) {
        await new Promise(r => setTimeout(r, discoveryDelayMs));
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: function() { return this; },
        json: async () => discoveryCatalog
      };
    }

    // 2. Key Auth Endpoint
    if (urlStr === CANDIDATE_SPEC.authEndpoint) {
      if (authStatus !== 200) {
        return {
          ok: false,
          status: authStatus,
          statusText: `HTTP ${authStatus}`,
          headers: new Headers({ 'content-type': 'application/json' }),
          clone: function() { return this; },
          json: async () => ({ error: { message: `Auth error ${authStatus}`, code: authStatus } })
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: function() { return this; },
        json: async () => ({
          data: {
            label: 'mock-key',
            usage: 0,
            limit: null,
            is_free_tier: true
          }
        })
      };
    }

    // 3. Chat Completions Endpoint
    if (urlStr === CANDIDATE_SPEC.chatEndpoint && method === 'POST') {
      if (fetchDelayMs > 0) {
        await new Promise(r => setTimeout(r, fetchDelayMs));
      }

      if (chatStatus !== 200) {
        return {
          ok: false,
          status: chatStatus,
          statusText: `HTTP ${chatStatus}`,
          headers: new Headers({ 'content-type': 'application/json' }),
          clone: function() { return this; },
          json: async () => ({ error: { message: `Chat error ${chatStatus}`, code: chatStatus } })
        };
      }

      if (simulateRetry && retryCount === 0) {
        retryCount++;
        const netErr = new Error('Simulated network transport drop');
        netErr.code = 'ECONNRESET';
        throw netErr;
      }

      // Parse incoming messages to determine appropriate dynamic turn response
      let body;
      try {
        body = JSON.parse(options.body);
      } catch {
        body = {};
      }

      const msgs = Array.isArray(body.messages) ? body.messages : [];
      const hasToolMessage = msgs.some(m => m.role === 'tool');

      // Find which fixture is being worked on from user message or scope
      const userMsg = msgs.find(m => m.role === 'user');
      let targetFixture = SYNTHETIC_FIXTURES[0];
      if (userMsg?.content) {
        for (const fix of SYNTHETIC_FIXTURES) {
          if (userMsg.content.includes(fix.relPath)) {
            targetFixture = fix;
            break;
          }
        }
      }

      const promptTokens = 65;
      const completionTokens = excessiveOutputTokens ? 450 : 25;

      const usageTurn1 = customUsage
        ? (typeof customUsage === 'function' ? customUsage(1) : customUsage)
        : {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
          };

      const usageTurn2 = customUsage
        ? (typeof customUsage === 'function' ? customUsage(2) : customUsage)
        : {
            prompt_tokens: promptTokens + 20,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + 20 + completionTokens
          };

      if (!hasToolMessage) {
        // Turn 1: Return propose_patch tool call
        const sha256 = (await import('node:crypto')).createHash('sha256').update(targetFixture.initialContent, 'utf8').digest('hex');
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          clone: function() { return this; },
          json: async () => {
            if (bodyDelayMs > 0) {
              await new Promise(r => setTimeout(r, bodyDelayMs));
            }
            return {
              id: 'mock-chat-cmpl-turn-1',
              model: CANDIDATE_SPEC.model,
              choices: [
                {
                  message: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        id: 'call_patch_1',
                        type: 'function',
                        function: {
                          name: 'propose_patch',
                          arguments: JSON.stringify({
                            path: targetFixture.relPath,
                            expectedSha256: sha256,
                            content: targetFixture.targetContent
                          })
                        }
                      }
                    ]
                  }
                }
              ],
              usage: usageTurn1
            };
          }
        };
      } else {
        // Turn 2: Return submit_receipt tool call
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          clone: function() { return this; },
          json: async () => {
            if (bodyDelayMs > 0) {
              await new Promise(r => setTimeout(r, bodyDelayMs));
            }
            return {
              id: 'mock-chat-cmpl-turn-2',
              model: CANDIDATE_SPEC.model,
              choices: [
                {
                  message: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        id: 'call_submit_2',
                        type: 'function',
                        function: {
                          name: 'submit_receipt',
                          arguments: JSON.stringify({
                            summary: targetFixture.summary
                          })
                        }
                      }
                    ]
                  }
                }
              ],
              usage: usageTurn2
            };
          }
        };
      }
    }

    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: function() { return this; },
      json: async () => ({ error: { message: `Endpoint not found: ${urlStr}` } })
    };
  };
}

/**
 * Common Qualification Pipeline Execution Engine.
 *
 * Runs the EXACT SAME pipeline in both mock and live modes:
 * - Fresh discovery -> validate snapshot -> candidate eligibility
 * - createCatalogSnapshotPort -> loadProviderConfig -> ConfiguredModelProvider
 * - RealRctAdapter -> TaskManager -> SqliteTaskStore -> createIndependentRctVerifier
 */
async function executeQualificationCampaign({
  modules,
  fetchImpl,
  apiKey,
  options = {}
}) {
  const isJson = options.json === true;
  const isSilent = options.silent === true || isJson;
  const isMock = options.isMock === true;

  const { ModelDiscoveryService, validateModelSnapshot, createConfiguredProvider } = modules.modelProv;
  const { loadProviderConfig, createCatalogSnapshotPort } = modules.provCfg;
  const { TaskManager, SqliteTaskStore, States, RealRctAdapter, createIndependentRctVerifier } = modules.orch;
  const { sha256 } = modules.rct;
  const { PolicyService, RctPolicyPort } = modules.policy;

  const monitor = new CampaignFetchMonitor({
    maxInferenceRequests: options.maxInferenceRequests,
    maxRequests: options.maxRequests,
    maxTotalDispatches: options.maxTotalDispatches,
    maxWallMs: options.maxWallMs ?? options.maxWall,
    maxRequestTimeoutMs: options.maxRequestTimeoutMs ?? options.requestTimeoutMs ?? options.requestMs ?? options.request,
    maxOutputTokens: options.maxOutputTokens,
    stopHttpCodes: options.stopHttpCodes,
    ...(options.monitorOptions || {})
  });
  const monitoredFetch = monitor.createInterceptingFetch(fetchImpl);

  if (!isSilent) {
    console.log('========================================================================');
    console.log(` ZETRO Bounded Free Synthetic Qualification Runner`);
    console.log(` Mode: ${isMock ? 'OFFLINE MOCKED PIPELINE' : 'LIVE OPT-IN CAMPAIGN'}`);
    console.log('========================================================================\n');
  }

  // 1. Fresh Metadata Discovery Phase
  if (!isSilent) console.log('1. Executing Fresh Metadata Discovery...');
  const discoveryService = new ModelDiscoveryService({ defaultTtlMs: 60000 });
  const snapshot = await discoveryService.discoverModel({
    provider: CANDIDATE_SPEC.provider,
    modelId: CANDIDATE_SPEC.model,
    apiKey,
    fetchImpl: monitoredFetch,
    allowLiveCalls: true
  });

  // Validate snapshot structure and zero pricing
  validateModelSnapshot(snapshot);
  const eligibility = verifyCandidateEligibility({
    provider: CANDIDATE_SPEC.provider,
    model: CANDIDATE_SPEC.model,
    snapshot
  });

  if (!isSilent) {
    console.log(`   ✔ Metadata Discovery verified: ${snapshot.id} (input: 0, output: 0, tools: true)`);
    console.log(`   ✔ Candidate eligibility confirmed (explicit zero cost proven; suffix-only rejected)`);
  }

  // 2. Share Fresh Discovered Proof with Provider Config Loader via Catalog Port
  if (!isSilent) console.log('\n2. Configuring Provider with Discovered Metadata Proof...');
  const catalogPort = createCatalogSnapshotPort({
    [snapshot.id]: {
      ...snapshot,
      pricingProof: `Fresh discovery verified zero pricing from ${snapshot.source} at ${snapshot.checkedAt}`,
      priceEvidence: `Fresh discovery verified zero pricing from ${snapshot.source} at ${snapshot.checkedAt}`
    }
  });

  const config = loadProviderConfig({
    env: {
      ZETRO_PROVIDER: CANDIDATE_SPEC.provider,
      ZETRO_MODEL: CANDIDATE_SPEC.model,
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_APPROVED_PROVIDERS: CANDIDATE_SPEC.provider,
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      OPENROUTER_API_KEY: apiKey
    },
    catalogPort
  });

  assert.strictEqual(config.status.ready, true, 'Configured provider must be ready');
  assert.strictEqual(config.status.mode, 'live-approved', 'Configured provider mode must be live-approved');
  assert.strictEqual(config.modelVerification.verified, true, 'Model verification must be verified');
  assert.strictEqual(config.modelVerification.isFree, true, 'Model verification must be isFree');

  // 3. Initialize ConfiguredModelProvider with Underlying OpenRouterProvider
  const configuredProvider = createConfiguredProvider({
    config,
    allowLiveCalls: true,
    snapshot,
    fetchImpl: monitoredFetch
  });

  assert.strictEqual(configuredProvider.name, `${CANDIDATE_SPEC.provider}:${CANDIDATE_SPEC.model}`);

  if (!isSilent) {
    console.log(`   ✔ ConfiguredModelProvider ready: ${configuredProvider.name} (live-approved)`);
  }

  // 4. Execute 3 Synthetic Trials with Complete Pipeline
  if (!isSilent) console.log('\n3. Executing Synthetic Public Qualification Trials (Max 3 trials, Max 6 requests)...');
  const trialResults = [];

  for (let i = 0; i < SYNTHETIC_FIXTURES.length && i < CAMPAIGN_BOUNDS.MAX_TRIALS; i++) {
    if (monitor.halted) break;
    const fixture = SYNTHETIC_FIXTURES[i];

    const wsDir = await mkdtemp(path.join(tmpdir(), `zetro-qual-trial-${i + 1}-ws-`));
    const dbDir = await mkdtemp(path.join(tmpdir(), `zetro-qual-trial-${i + 1}-db-`));

    try {
      const fileRelPath = fixture.relPath;
      const fileAbsPath = path.join(wsDir, fileRelPath);
      await mkdir(path.dirname(fileAbsPath), { recursive: true });
      await writeFile(fileAbsPath, fixture.initialContent, 'utf8');
      const initialHash = sha256(Buffer.from(fixture.initialContent, 'utf8'));

      // Policy authority with grants for agent 'RCT-1'
      const policyService = new PolicyService({ clock: () => Date.now() });
      const rctPort = new RctPolicyPort(policyService);
      const taskId = `qual-${fixture.id}-${i + 1}`;

      rctPort.createAssignmentGrants({
        id: taskId,
        agent: 'RCT-1',
        sessionId: taskId,
        scope: { readPaths: [fileRelPath], writePaths: [fileRelPath] },
        checks: [{ type: 'equals', path: fileRelPath, text: fixture.targetContent }]
      });

      // Runtime & Store
      const store = new SqliteTaskStore(path.join(dbDir, 'tasks.db'));
      const adapter = new RealRctAdapter({
        provider: configuredProvider,
        sourceRoot: wsDir,
        runtimeOptions: {
          authority: rctPort,
          requestMaxOutputTokens: CAMPAIGN_BOUNDS.MAX_OUTPUT_TOKENS_PER_REQUEST
        }
      });

      const verifier = createIndependentRctVerifier();
      const manager = new TaskManager(store, adapter, { verifier });
      await manager.init();

      const envelope = {
        id: taskId,
        agent: 'RCT-1',
        objective: fixture.objective,
        workspaceRoot: wsDir,
        allowedPaths: [fileRelPath],
        contextRefs: [],
        acceptance: 'Passed equality check',
        verification: fileRelPath,
        declaredChecks: [fileRelPath],
        sourceHash: initialHash,
        sourceHashes: { [fileRelPath]: initialHash },
        assignmentDigest: `digest-${taskId}`,
        checks: [{ type: 'equals', path: fileRelPath, text: fixture.targetContent }],
        deadlineMs: CAMPAIGN_BOUNDS.MAX_REQUEST_TIMEOUT_MS,
        budget: {
          maxContextChars: 10000,
          maxReplyChars: 2000,
          maxTurns: 3,
          maxInputTokens: 2000,
          maxOutputTokens: CAMPAIGN_BOUNDS.MAX_OUTPUT_TOKENS_PER_REQUEST,
          maxPromptChars: 10000,
          maxWallMs: CAMPAIGN_BOUNDS.MAX_REQUEST_TIMEOUT_MS
        }
      };

      const trialStart = Date.now();
      const result = await manager.run(envelope);
      const trialDuration = Date.now() - trialStart;

      // Assert source isolation invariant
      const sourceAfter = await readFile(fileAbsPath, 'utf8');
      assert.strictEqual(sourceAfter, fixture.initialContent, 'Source root must remain bitwise identical on disk');
      assert.strictEqual(sha256(Buffer.from(sourceAfter)), initialHash, 'Source root hash must match initial hash');

      const evidence = manager.evidence(taskId);
      const verifierArtifact = evidence?.artifacts?.find(a => a.artifactType === 'verifier_evidence');
      const verified = result.state === States.COMPLETED && verifierArtifact?.metadata?.verified === true;

      // Extract actual measured metrics from task receipt ledger
      const rawReceipt = adapter.latestReceipt;
      const trialUsage = rawReceipt?.usage || {};

      trialResults.push({
        trialId: taskId,
        fixture: fixture.name,
        file: fileRelPath,
        state: result.state,
        verified,
        durationMs: trialDuration,
        artifactsCount: evidence?.artifacts?.length || 0,
        checks: verifierArtifact?.metadata?.checks || [],
        usage: {
          inputTokens: trialUsage.inputTokens || 0,
          outputTokens: trialUsage.outputTokens || 0,
          requests: trialUsage.requests || 0
        }
      });

      manager.close();

      if (!isSilent) {
        console.log(`   ✔ [${i + 1}/${CAMPAIGN_BOUNDS.MAX_TRIALS}] ${fixture.name}: state=${result.state}, verified=${verified} (${trialDuration}ms, checks: ${verifierArtifact?.metadata?.checks?.length || 0})`);
      }
    } finally {
      await rm(wsDir, { recursive: true, force: true }).catch(() => {});
      await rm(dbDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // 5. Qualification Determination & Metrics Compilation
  const metrics = monitor.getMetrics();
  const allTrialsVerified = trialResults.length === CAMPAIGN_BOUNDS.MAX_TRIALS && trialResults.every(t => t.verified === true);
  const withinLimits = metrics.inferenceRequestsDispatched <= CAMPAIGN_BOUNDS.MAX_TOTAL_INFERENCE_REQUESTS &&
                       !metrics.halted &&
                       !metrics.hasUnknownUsage;
  const isQualified = allTrialsVerified && withinLimits;

  const report = {
    mode: isMock ? 'offline-mock-qualification' : 'live-qualification',
    status: isQualified ? 'QUALIFIED' : 'FAILED',
    qualified: isQualified,
    timestamp: new Date().toISOString(),
    candidate: {
      provider: CANDIDATE_SPEC.provider,
      model: CANDIDATE_SPEC.model,
      verifiedEligible: eligibility.eligible,
      pricingProvenZero: eligibility.pricingProvenZero,
      snapshotCheckedAt: snapshot.checkedAt
    },
    campaignMetrics: {
      trialsAttempted: trialResults.length,
      trialsVerified: trialResults.filter(t => t.verified).length,
      inferenceRequestsDispatched: metrics.inferenceRequestsDispatched,
      totalDispatches: metrics.totalDispatches,
      actualInputTokens: metrics.actualInputTokens,
      actualOutputTokens: metrics.actualOutputTokens,
      actualTotalTokens: metrics.actualTotalTokens,
      hasUnknownUsage: metrics.hasUnknownUsage,
      wallMs: metrics.wallMs,
      halted: metrics.halted,
      haltReason: metrics.haltReason,
      httpStopStatus: metrics.httpStopStatus,
      allLimitsRespected: withinLimits
    },
    trials: trialResults,
    coordinatorOptInCommand: 'node scripts/zetro-free-qualification.js --live-opt-in --provider=openrouter --model=cohere/north-mini-code:free --api-key=<KEY> --allow-remote-source'
  };

  if (!isSilent) {
    console.log('\n========================================================================');
    console.log(` SUMMARY OF QUALIFICATION CAMPAIGN (${report.status})`);
    console.log('========================================================================');
    console.log(`Trials Completed:           ${trialResults.length}/${CAMPAIGN_BOUNDS.MAX_TRIALS} (All verified: ${allTrialsVerified})`);
    console.log(`Inference Requests:         ${metrics.inferenceRequestsDispatched}/${CAMPAIGN_BOUNDS.MAX_TOTAL_INFERENCE_REQUESTS} (Hard limit enforced)`);
    console.log(`Actual Tokens Measured:     ${metrics.actualTotalTokens} total (${metrics.actualInputTokens} input, ${metrics.actualOutputTokens} output)`);
    console.log(`Duration:                   ${metrics.wallMs}ms (< 180s budget)`);
    console.log(`Qualification Status:       ${report.status}`);
    console.log('========================================================================\n');
  }

  return report;
}

/**
 * Runs the dry-run preflight check and displays campaign details.
 */
async function runDryRunMode(modules, options = {}) {
  const isJson = options.json === true;

  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  const minor = parseInt(nodeVersion.slice(1).split('.')[1], 10);
  const runtimeOk = major > 22 || (major === 22 && minor >= 5);

  const { APPROVED_ENDPOINTS, FREE_MODEL_CATALOG } = modules.modelProv;
  const catalogEntry = FREE_MODEL_CATALOG[CANDIDATE_SPEC.model];

  const report = {
    mode: 'offline-dry-run',
    status: 'READY_FOR_QUALIFICATION',
    timestamp: new Date().toISOString(),
    runtime: {
      node: nodeVersion,
      runtimePreflightOk: runtimeOk,
      sqliteDatabaseSync: true
    },
    candidate: {
      provider: CANDIDATE_SPEC.provider,
      model: CANDIDATE_SPEC.model,
      requiredSuffix: CANDIDATE_SPEC.requiredSuffix,
      endpoints: {
        chat: CANDIDATE_SPEC.chatEndpoint,
        models: CANDIDATE_SPEC.modelsEndpoint,
        auth: CANDIDATE_SPEC.authEndpoint
      },
      catalogKnown: Boolean(catalogEntry),
      catalogPricing: catalogEntry?.pricing || null,
      eligibilityRule: 'Candidate OpenRouter cohere/north-mini-code:free requires current metadata discovery verification with explicit zero pricing. Suffix :free alone is never proof.'
    },
    campaignLimits: {
      maxTrials: CAMPAIGN_BOUNDS.MAX_TRIALS,
      maxTotalInferenceRequests: CAMPAIGN_BOUNDS.MAX_TOTAL_INFERENCE_REQUESTS,
      maxOutputTokensPerRequest: CAMPAIGN_BOUNDS.MAX_OUTPUT_TOKENS_PER_REQUEST,
      maxRequestTimeoutMs: CAMPAIGN_BOUNDS.MAX_REQUEST_TIMEOUT_MS,
      maxCampaignWallMs: CAMPAIGN_BOUNDS.MAX_CAMPAIGN_WALL_MS,
      stopHttpCodes: [...CAMPAIGN_BOUNDS.STOP_HTTP_CODES],
      noPaidFallback: true
    },
    publicSyntheticFixtures: SYNTHETIC_FIXTURES.map(f => ({ id: f.id, name: f.name, path: f.relPath })),
    pipelineWiring: {
      configuredProvider: '@zetro/model-providers (ConfiguredModelProvider)',
      actualAdapter: '@zetro/model-providers (OpenRouterProvider)',
      metadataDiscovery: '@zetro/model-providers (ModelDiscoveryService)',
      policyAuthority: '@zetro/policy (PolicyService, RctPolicyPort)',
      runtime: '@zetro/orchestration-core (RealRctAdapter, TaskManager)',
      transactionalStore: '@zetro/orchestration-core (SqliteTaskStore)',
      independentVerifier: '@zetro/orchestration-core (createIndependentRctVerifier)'
    },
    coordinatorOptInCommand: 'node scripts/zetro-free-qualification.js --live-opt-in --provider=openrouter --model=cohere/north-mini-code:free --api-key=<KEY> --allow-remote-source'
  };

  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('========================================================================');
    console.log(' ZETRO Bounded Free Synthetic Qualification Runner');
    console.log(' Mode: OFFLINE DRY-RUN (Zero Network Calls, Zero Secret Reads)');
    console.log('========================================================================\n');
    console.log(`• Runtime: Node.js ${nodeVersion} (>= 22.5.0: ${runtimeOk ? 'PASS' : 'FAIL'})`);
    console.log(`• Candidate Model: ${CANDIDATE_SPEC.provider} / ${CANDIDATE_SPEC.model}`);
    console.log(`• Approved Endpoints:`);
    console.log(`    Models: ${CANDIDATE_SPEC.modelsEndpoint}`);
    console.log(`    Chat:   ${CANDIDATE_SPEC.chatEndpoint}`);
    console.log(`• Eligibility Rule: Current fresh discovery metadata proof required; :free suffix alone is NOT proof.`);
    console.log(`• Campaign Bounds & Hard Limits:`);
    console.log(`    Max Trials:                 ${CAMPAIGN_BOUNDS.MAX_TRIALS}`);
    console.log(`    Max Inference Requests:     ${CAMPAIGN_BOUNDS.MAX_TOTAL_INFERENCE_REQUESTS} total across campaign`);
    console.log(`    Max Output Tokens:          ${CAMPAIGN_BOUNDS.MAX_OUTPUT_TOKENS_PER_REQUEST} tokens per request`);
    console.log(`    Max Request Timeout:        ${CAMPAIGN_BOUNDS.MAX_REQUEST_TIMEOUT_MS / 1000}s`);
    console.log(`    Max Campaign Wall Budget:   ${CAMPAIGN_BOUNDS.MAX_CAMPAIGN_WALL_MS / 1000}s`);
    console.log(`    Fail-Closed Stop Codes:     HTTP ${CAMPAIGN_BOUNDS.STOP_HTTP_CODES.join(', ')} (no paid fallback)`);
    console.log(`• Public Synthetic Fixtures:     ${SYNTHETIC_FIXTURES.length} generated fixtures (zero repo source)`);
    console.log(`\n• Coordinator Opt-In Invocation Command (for review when authorized):`);
    console.log(`    node scripts/zetro-free-qualification.js --live-opt-in --provider=openrouter --model=cohere/north-mini-code:free --api-key=<KEY> --allow-remote-source\n`);
    console.log('[ZETRO Free Qualification] Dry-run preflight checks completed successfully.');
  }

  return report;
}

/**
 * Runs the complete mock verification test suite over the actual adapter.
 */
async function runMockTestSuite(modules, options = {}) {
  const isJson = options.json === true;

  if (!isJson) {
    console.log('========================================================================');
    console.log(' ZETRO Qualification Test Suite: Mocked Transport & Actual Adapter');
    console.log('========================================================================\n');
  }

  // Test 1: Full 3-Trial Qualification Campaign over Actual OpenRouter Adapter
  if (!isJson) console.log('▶ Test 1: Executing 3-trial qualification campaign with actual OpenRouter adapter...');
  const mockTransport = createMockTransport();
  const qualReport = await executeQualificationCampaign({
    modules,
    fetchImpl: mockTransport,
    apiKey: 'mock-openrouter-key-offline',
    options: { ...options, isMock: true }
  });

  assert.strictEqual(qualReport.status, 'QUALIFIED', 'Campaign status must be QUALIFIED');
  assert.strictEqual(qualReport.qualified, true, 'Campaign must be qualified');
  assert.strictEqual(qualReport.trials.length, 3, 'Must complete exactly 3 trials');
  assert.ok(qualReport.trials.every(t => t.verified), 'All 3 trials must achieve verified: true');
  assert.strictEqual(qualReport.campaignMetrics.inferenceRequestsDispatched, 6, 'Must dispatch exactly 6 inference requests');
  if (!isJson) console.log('✔ Test 1: Full qualification campaign PASSED (3/3 trials verified, 6/6 requests, QUALIFIED)');

  // Test 2: Suffix-Only Rejection (Negative Barrier: non-zero pricing rejected despite :free suffix)
  if (!isJson) console.log('▶ Test 2: Validating suffix-only proof rejection barrier...');
  const badPriceCatalog = createMockDiscoveryCatalog({ promptPrice: '0.05' });
  const badPriceTransport = createMockTransport({ discoveryCatalog: badPriceCatalog });
  let suffixProofRejected = false;
  try {
    await executeQualificationCampaign({
      modules,
      fetchImpl: badPriceTransport,
      apiKey: 'mock-openrouter-key-offline',
      options: { ...options, isMock: true, silent: true }
    });
  } catch (err) {
    if (err.message.includes('non-zero') || err.message.includes('pricing') || err.message.includes('free catalog')) {
      suffixProofRejected = true;
    }
  }
  assert.strictEqual(suffixProofRejected, true, 'Non-zero pricing must fail closed despite :free suffix');
  if (!isJson) console.log('✔ Test 2: Suffix-only proof rejection barrier PASSED');

  // Test 3: Fail-Closed HTTP Stop Codes (401, 402, 403, 429)
  if (!isJson) console.log('▶ Test 3: Validating HTTP 401/402/403/429 fail-closed stops without fallback...');
  for (const code of CAMPAIGN_BOUNDS.STOP_HTTP_CODES) {
    const stopTransport = createMockTransport({ chatStatus: code });
    let stopTriggered = false;
    try {
      const rep = await executeQualificationCampaign({
        modules,
        fetchImpl: stopTransport,
        apiKey: 'mock-openrouter-key-offline',
        options: { ...options, isMock: true, silent: true }
      });
      if (rep.status === 'FAILED' && rep.qualified === false && rep.campaignMetrics.halted === true && rep.campaignMetrics.httpStopStatus === code) {
        stopTriggered = true;
      }
    } catch (err) {
      if (err.httpStatus === code || err.message.includes(String(code))) {
        stopTriggered = true;
      }
    }
    assert.strictEqual(stopTriggered, true, `HTTP ${code} must trigger fail-closed stop`);
  }
  if (!isJson) console.log('✔ Test 3: HTTP 401/402/403/429 stop barriers PASSED (all halted without fallback)');

  // Test 4: Request Cap Barrier (7th request blocked at fetch level)
  if (!isJson) console.log('▶ Test 4: Validating 6-request cap barrier at fetch level...');
  const monitor = new CampaignFetchMonitor({ maxInferenceRequests: 6 });
  const intercept = monitor.createInterceptingFetch(async () => ({ ok: true, status: 200, headers: new Headers() }));
  for (let r = 0; r < 6; r++) {
    await intercept('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' });
  }
  assert.strictEqual(monitor.inferenceRequestsDispatched, 6);
  let capBlocked = false;
  try {
    await intercept('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' });
  } catch (err) {
    if (err.message.includes('CAMPAIGN_LIMIT_EXCEEDED')) {
      capBlocked = true;
    }
  }
  assert.strictEqual(capBlocked, true, '7th inference request must be blocked at fetch level');
  if (!isJson) console.log('✔ Test 4: 6-request cap barrier PASSED');

  // Test 5: Transport Retry Accounting (retries reserve inference request slots and mark unknown usage on failure)
  if (!isJson) console.log('▶ Test 5: Validating retry reservation toward campaign cap & transport error unknown usage...');
  const retryMonitor = new CampaignFetchMonitor({ maxInferenceRequests: 3 });
  let attemptsMade = 0;
  const retryTransport = retryMonitor.createInterceptingFetch(async () => {
    attemptsMade++;
    if (attemptsMade === 1) {
      const err = new Error('Connection reset');
      err.code = 'ECONNRESET';
      throw err;
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: () => ({ json: async () => ({ usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }) }),
      json: async () => ({ usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })
    };
  });

  try {
    await retryTransport('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' });
  } catch {}
  assert.strictEqual(retryMonitor.hasUnknownUsage, true, 'Transport throw must set hasUnknownUsage: true');
  await retryTransport('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' });

  assert.strictEqual(retryMonitor.inferenceRequestsDispatched, 2, 'Each dispatch including retry must be counted');
  if (!isJson) console.log('✔ Test 5: Transport retry accounting & transport unknown usage PASSED');

  // Test 6: Combined In-Flight Deadline & Delayed Fetch/Body Race Barrier
  if (!isJson) console.log('▶ Test 6: Validating short deadline delayed fetch/body race & in-flight campaign wall budget...');

  // 6a: Delayed fetch with maxWallMs: 10, maxRequestTimeoutMs: 5 and injected 30ms fetch
  const fastMonitor = new CampaignFetchMonitor({ maxWallMs: 10, maxRequestTimeoutMs: 5 });
  const fastIntercept = fastMonitor.createInterceptingFetch(async () => {
    await new Promise(r => setTimeout(r, 30));
    return { ok: true, status: 200, headers: new Headers() };
  });
  const t0 = Date.now();
  let fastBlocked = false;
  try {
    await fastIntercept('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' });
  } catch (err) {
    if (err.message.includes('CAMPAIGN_LIMIT_EXCEEDED')) {
      fastBlocked = true;
    }
  }
  const fastDuration = Date.now() - t0;
  assert.strictEqual(fastBlocked, true, 'Short deadline delayed fetch must abort and throw');
  assert.strictEqual(fastMonitor.halted, true, 'Monitor must be halted on deadline breach');
  assert.strictEqual(fastMonitor.hasUnknownUsage, true, 'Aborted request must mark hasUnknownUsage true');
  assert.ok(fastDuration < 25, `Fetch deadline race must reject quickly, got ${fastDuration}ms`);

  // 6b: Delayed body reading with maxRequestTimeoutMs: 5
  const bodyMonitor = new CampaignFetchMonitor({ maxRequestTimeoutMs: 5 });
  const bodyIntercept = bodyMonitor.createInterceptingFetch(async () => {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: function() {
        return {
          json: async () => {
            await new Promise(r => setTimeout(r, 30));
            return { usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
          }
        };
      },
      json: async () => {
        await new Promise(r => setTimeout(r, 30));
        return { usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
      }
    };
  });
  let bodyBlocked = false;
  try {
    const res = await bodyIntercept('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' });
    await res.json();
  } catch (err) {
    if (err.message.includes('CAMPAIGN_LIMIT_EXCEEDED')) {
      bodyBlocked = true;
    }
  }
  assert.strictEqual(bodyBlocked, true, 'Delayed body must be rejected and campaign halted');
  assert.strictEqual(bodyMonitor.halted, true, 'Monitor must be halted on body timeout');
  assert.strictEqual(bodyMonitor.hasUnknownUsage, true, 'Body timeout must mark hasUnknownUsage true');

  // 6c: In-flight discovery timeout within campaign
  const discoveryTimeoutTransport = createMockTransport({ discoveryDelayMs: 35 });
  let discoveryHalted = false;
  try {
    await executeQualificationCampaign({
      modules,
      fetchImpl: discoveryTimeoutTransport,
      apiKey: 'mock-openrouter-key-offline',
      options: { ...options, isMock: true, silent: true, maxWallMs: 15, maxRequestTimeoutMs: 10 }
    });
  } catch (err) {
    if (err.message.includes('CAMPAIGN_LIMIT_EXCEEDED') || err.message.includes('discovery transport failure') || err.cause?.message?.includes('CAMPAIGN_LIMIT_EXCEEDED')) {
      discoveryHalted = true;
    }
  }
  assert.strictEqual(discoveryHalted, true, 'Discovery exceeding campaign deadline must halt in-flight');

  // 6d: Immediate expired wall-clock budget
  const deadlineMonitor = new CampaignFetchMonitor({ maxWallMs: 1 });
  await new Promise(r => setTimeout(r, 10)); // Expire 1ms budget
  const deadlineIntercept = deadlineMonitor.createInterceptingFetch(async () => ({ ok: true, status: 200, headers: new Headers() }));
  let deadlineBlocked = false;
  try {
    await deadlineIntercept('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' });
  } catch (err) {
    if (err.message.includes('CAMPAIGN_LIMIT_EXCEEDED') && err.message.includes('wall-clock')) {
      deadlineBlocked = true;
    }
  }
  assert.strictEqual(deadlineBlocked, true, 'Expired wall-clock budget must throw CAMPAIGN_LIMIT_EXCEEDED in-flight');
  if (!isJson) console.log('✔ Test 6: Short deadline delayed fetch/body race & in-flight campaign deadline PASSED');

  // Test 7: Strict Usage Accounting Probes (Strict literal finite nonnegative integers, never missing as zero)
  if (!isJson) console.log('▶ Test 7: Validating strict token usage accounting probes (negative/string/null/missing)...');

  // 7a: Negative prompt tokens ({ prompt_tokens: -5, completion_tokens: 25 })
  const negMonitor = new CampaignFetchMonitor();
  const negIntercept = negMonitor.createInterceptingFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    clone: () => ({ json: async () => ({ usage: { prompt_tokens: -5, completion_tokens: 25 } }) })
  }));
  await negIntercept('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' });
  assert.strictEqual(negMonitor.hasUnknownUsage, true, 'Negative prompt tokens must trigger hasUnknownUsage');
  assert.strictEqual(negMonitor.actualInputTokens, 0, 'Negative tokens must not be added to actualInputTokens');
  assert.strictEqual(negMonitor.actualTotalTokens, 0, 'Negative tokens must not result in negative total');

  // 7b: String completion tokens ({ prompt_tokens: 65, completion_tokens: '9' })
  const strMonitor = new CampaignFetchMonitor();
  const strIntercept = strMonitor.createInterceptingFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    clone: () => ({ json: async () => ({ usage: { prompt_tokens: 65, completion_tokens: '9' } }) })
  }));
  await strIntercept('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' });
  assert.strictEqual(strMonitor.hasUnknownUsage, true, 'String completion tokens must trigger hasUnknownUsage');
  assert.strictEqual(strMonitor.actualOutputTokens, 0, 'String tokens must never be defaulted as zero');

  // 7c: Null token values ({ prompt_tokens: null, completion_tokens: 25 })
  const nullMonitor = new CampaignFetchMonitor();
  const nullIntercept = nullMonitor.createInterceptingFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    clone: () => ({ json: async () => ({ usage: { prompt_tokens: null, completion_tokens: 25 } }) })
  }));
  await nullIntercept('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' });
  assert.strictEqual(nullMonitor.hasUnknownUsage, true, 'Null prompt tokens must trigger hasUnknownUsage');

  // 7d: Missing usage object ({})
  const missingMonitor = new CampaignFetchMonitor();
  const missingIntercept = missingMonitor.createInterceptingFetch(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    clone: () => ({ json: async () => ({}) })
  }));
  await missingIntercept('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' });
  assert.strictEqual(missingMonitor.hasUnknownUsage, true, 'Missing usage must trigger hasUnknownUsage, never default as zero');

  // 7e: Transport error throw
  const transMonitor = new CampaignFetchMonitor();
  const transIntercept = transMonitor.createInterceptingFetch(async () => {
    const err = new Error('Socket closed');
    err.code = 'ECONNRESET';
    throw err;
  });
  try {
    await transIntercept('https://openrouter.ai/api/v1/chat/completions', { method: 'POST' });
  } catch {}
  assert.strictEqual(transMonitor.hasUnknownUsage, true, 'Transport throw must set hasUnknownUsage: true');
  if (!isJson) console.log('✔ Test 7: Strict usage accounting probes PASSED (negative/string/null/missing/transport)');

  // Test 8: Actual Pipeline No-False-Qualification on Malformed Usage
  if (!isJson) console.log('▶ Test 8: Validating actual pipeline rejects qualification if usage is malformed...');
  const malformedUsageTransport = createMockTransport({
    customUsage: { prompt_tokens: -5, completion_tokens: 25 }
  });
  const malformedReport = await executeQualificationCampaign({
    modules,
    fetchImpl: malformedUsageTransport,
    apiKey: 'mock-openrouter-key-offline',
    options: { ...options, isMock: true, silent: true }
  });
  assert.strictEqual(malformedReport.status, 'FAILED', 'Campaign with malformed usage must be FAILED');
  assert.strictEqual(malformedReport.qualified, false, 'Campaign with malformed usage must NOT qualify');
  assert.strictEqual(malformedReport.campaignMetrics.hasUnknownUsage, true, 'hasUnknownUsage must be true');
  if (!isJson) console.log('✔ Test 8: Actual pipeline no-false-qualification PASSED (malformed usage rejected)');

  const testReport = {
    mode: 'offline-mock-test-suite',
    status: 'ALL_TESTS_PASSED',
    passed: 8,
    failed: 0,
    qualificationCampaign: qualReport
  };

  if (isJson) {
    console.log(JSON.stringify(testReport, null, 2));
  } else {
    console.log('\n========================================================================');
    console.log(' ALL 8 QUALIFICATION TESTS PASSED');
    console.log('========================================================================\n');
  }

  return testReport;
}

/**
 * Opt-In Live Execution Mode (for coordinator review and authorized live execution only).
 */
async function runLiveOptInMode(modules, options = {}) {
  const isJson = options.json === true;

  const apiKey = options.apiKey || process.env.ZETRO_LIVE_OPT_IN_API_KEY;
  const allowRemoteSource = options.allowRemoteSource === true || process.env.ZETRO_ALLOW_REMOTE_SOURCE === '1';

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    const errMsg = [
      'ERROR: Live qualification requires explicit coordinator credentials.',
      'Missing --api-key=<KEY> option or ZETRO_LIVE_OPT_IN_API_KEY environment variable.',
      'Silent reading of real .env files during execution is prohibited.',
      'Pass credentials explicitly: node scripts/zetro-free-qualification.js --live-opt-in --api-key=<KEY> --allow-remote-source'
    ].join('\n');
    if (isJson) {
      console.error(JSON.stringify({ error: errMsg, ok: false }));
    } else {
      console.error(`\n[ZETRO Free Qualification] ${errMsg}\n`);
    }
    process.exit(1);
  }

  if (!allowRemoteSource) {
    const errMsg = [
      'ERROR: Live qualification requires explicit remote source code sharing authorization.',
      'Pass --allow-remote-source to authorize transmission of synthetic public fixtures to OpenRouter.'
    ].join('\n');
    if (isJson) {
      console.error(JSON.stringify({ error: errMsg, ok: false }));
    } else {
      console.error(`\n[ZETRO Free Qualification] ${errMsg}\n`);
    }
    process.exit(1);
  }

  const report = await executeQualificationCampaign({
    modules,
    fetchImpl: globalThis.fetch,
    apiKey,
    options: { ...options, isMock: false }
  });

  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
  }

  // Non-zero exit code if not qualified
  if (!report.qualified) {
    process.exit(1);
  }

  return report;
}

/**
 * Parses CLI command line arguments.
 */
function parseArgs(argv) {
  const options = {
    dryRun: false,
    mock: false,
    liveOptIn: false,
    json: false,
    apiKey: null,
    allowRemoteSource: false
  };

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--mock' || arg === '--test') options.mock = true;
    else if (arg === '--live-opt-in') options.liveOptIn = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--allow-remote-source') options.allowRemoteSource = true;
    else if (arg.startsWith('--api-key=')) options.apiKey = arg.split('=')[1];
    else if (arg.startsWith('--provider=')) options.provider = arg.split('=')[1];
    else if (arg.startsWith('--model=')) options.model = arg.split('=')[1];
    else if (arg === '--help' || arg === '-h') options.help = true;
  }

  // Default to dry-run if neither mock nor liveOptIn is set
  if (!options.mock && !options.liveOptIn) {
    options.dryRun = true;
  }

  return options;
}

/**
 * Main CLI entrypoint.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(`
Usage: node scripts/zetro-free-qualification.js [options]

Modes:
  --dry-run             Default mode: validates prerequisites offline, displays qualification plan and limits (Exit 0)
  --mock, --test        Executes complete synthetic pipeline offline with mock responses and barrier checks (Exit 0)
  --live-opt-in         Opt-in live campaign execution (Requires --api-key and --allow-remote-source)

Options:
  --json                Output structured machine evidence JSON
  --api-key=<KEY>       Provide coordinator API key for live execution
  --allow-remote-source Explicitly authorize remote transmission of synthetic public fixtures
  --help, -h            Show this help text
`);
    process.exit(0);
  }

  const modules = await loadModules();

  try {
    if (options.mock) {
      const testReport = await runMockTestSuite(modules, options);
      if (testReport.status !== 'ALL_TESTS_PASSED') {
        process.exit(1);
      }
    } else if (options.liveOptIn) {
      await runLiveOptInMode(modules, options);
    } else {
      await runDryRunMode(modules, options);
    }
    process.exit(0);
  } catch (err) {
    if (options.json) {
      console.error(JSON.stringify({ error: err.message, stack: err.stack, ok: false }));
    } else {
      console.error('\n[ZETRO Free Qualification] ERROR:', err.message);
      if (process.env.DEBUG) console.error(err.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  loadModules,
  parseArgs,
  verifyCandidateEligibility,
  executeQualificationCampaign,
  createMockTransport,
  CampaignFetchMonitor,
  runDryRunMode,
  runMockTestSuite,
  runLiveOptInMode,
  CAMPAIGN_BOUNDS,
  CANDIDATE_SPEC,
  SYNTHETIC_FIXTURES
};
