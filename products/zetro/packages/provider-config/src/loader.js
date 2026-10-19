/**
 * Provider Configuration Loader
 *
 * Implements safe, dependency-free configuration loading with:
 * - WeakMap credential storage (invisible to symbols, Object.keys, util.inspect showHidden)
 * - Strict boolean and numeric parsing with explicit bounds
 * - Canonical template names with strict precedence (canonical false overrides legacy true)
 * - Approved-provider list matching and mismatch detection
 * - Model eligibility and free catalog verification (no fake proof)
 * - Retaining restrictive defaults and blocking readiness on invalid flags
 *
 * Owned by AGR-5.
 */

import { parseStrictBooleanFlag } from './boolean.js';
import { parseStrictInteger, parseStrictCost } from './numeric.js';
import { parseDotEnv, parseDotEnvFile } from './parser.js';
import { validateModelEligibility } from './catalog-validator.js';

// Module-scoped WeakMap for private credentials.
// Zero properties (enumerable, non-enumerable, or symbol) are attached to config objects.
const CREDENTIAL_STORE = new WeakMap();

export const KNOWN_PROVIDERS = Object.freeze(['fake', 'groq', 'opencode', 'openrouter']);

export const DEFAULT_MODELS = Object.freeze({
  fake: 'fake-model',
  groq: 'openai/gpt-oss-120b',
  opencode: 'glm-5.3-flash-free',
  openrouter: 'openai/gpt-oss-120b:free'
});

/**
 * Resolves a raw value checking environment first, then file values.
 *
 * @param {Record<string, string>} envSource
 * @param {Record<string, string>} fileValues
 * @param {string} key
 * @returns {string | undefined}
 */
function getRawValue(envSource, fileValues, key) {
  if (envSource[key] !== undefined) return envSource[key];
  if (fileValues[key] !== undefined) return fileValues[key];
  return undefined;
}

/**
 * Loads provider configuration from environment and optional synthetic file.
 *
 * @param {object} [options={}]
 * @param {Record<string, string>} [options.env] - Injected environment variables (defaults to process.env)
 * @param {string} [options.envFile] - Optional explicit path to synthetic .env file
 * @param {string} [options.syntheticEnvContent] - Optional inline synthetic .env text
 * @param {Function} [options.catalogValidator] - Optional external catalog validator
 * @returns {ZetroProviderConfig}
 */
export function loadProviderConfig(options = {}) {
  const envSource = options.env || process.env;

  // 1. Load file values if explicit path or synthetic content provided
  let fileValues = {};
  if (options.syntheticEnvContent) {
    fileValues = parseDotEnv(options.syntheticEnvContent);
  } else if (options.envFile) {
    fileValues = parseDotEnvFile(options.envFile);
  } else if (envSource.ZETRO_ENV_FILE) {
    fileValues = parseDotEnvFile(envSource.ZETRO_ENV_FILE);
  }

  const invalidFlags = [];
  const reasons = [];

  // 2. Resolve Provider Name
  // Canonical: ZETRO_PROVIDER. Aliases: ZETRO_MODEL_PROVIDER, MODEL_PROVIDER. Default: 'fake'
  const rawProvider = getRawValue(envSource, fileValues, 'ZETRO_PROVIDER')
    ?? getRawValue(envSource, fileValues, 'ZETRO_MODEL_PROVIDER')
    ?? getRawValue(envSource, fileValues, 'MODEL_PROVIDER');

  const provider = (rawProvider && typeof rawProvider === 'string' && rawProvider.trim())
    ? rawProvider.trim().toLowerCase()
    : 'fake';

  // 3. Resolve Model Name
  // Canonical: ZETRO_MODEL. Alias: MODEL
  const rawModel = getRawValue(envSource, fileValues, 'ZETRO_MODEL')
    ?? getRawValue(envSource, fileValues, 'MODEL');

  const model = (rawModel && typeof rawModel === 'string' && rawModel.trim())
    ? rawModel.trim()
    : (DEFAULT_MODELS[provider] || 'fake-model');

  // 4. Resolve Free-Only Policy & Cost Ceiling
  // Canonical: ZETRO_FREE_ONLY. Alias: FREE_ONLY. Default: true
  const rawFreeOnly = getRawValue(envSource, fileValues, 'ZETRO_FREE_ONLY')
    ?? getRawValue(envSource, fileValues, 'FREE_ONLY');

  const freeOnlyResult = parseStrictBooleanFlag(rawFreeOnly, 'ZETRO_FREE_ONLY', true);
  const freeOnly = freeOnlyResult.value;
  if (!freeOnlyResult.isValid) {
    invalidFlags.push(freeOnlyResult.error);
    reasons.push(freeOnlyResult.error);
  }

  // Cost: Canonical: ZETRO_MAX_COST_USD. Default: 0
  const rawCost = getRawValue(envSource, fileValues, 'ZETRO_MAX_COST_USD');
  const costResult = parseStrictCost(rawCost, 'ZETRO_MAX_COST_USD', { freeOnly, maxLimit: 100.0 });
  const maxCostUsd = costResult.value;
  if (!costResult.isValid) {
    invalidFlags.push(costResult.error);
    reasons.push(costResult.error);
  }

  // 5. Concurrency: Canonical: ZETRO_MAX_CONCURRENT_WORKERS. Aliases: ZETRO_MAX_CONCURRENCY, CONCURRENCY. Default: 1. Bounds: [1, 5]
  const rawConcurrency = getRawValue(envSource, fileValues, 'ZETRO_MAX_CONCURRENT_WORKERS')
    ?? getRawValue(envSource, fileValues, 'ZETRO_MAX_CONCURRENCY')
    ?? getRawValue(envSource, fileValues, 'CONCURRENCY');

  const concurrencyResult = parseStrictInteger(rawConcurrency, 'ZETRO_MAX_CONCURRENT_WORKERS', {
    min: 1,
    max: 5,
    defaultValue: 1
  });
  const concurrency = concurrencyResult.value;
  if (!concurrencyResult.isValid) {
    invalidFlags.push(concurrencyResult.error);
    reasons.push(concurrencyResult.error);
  }

  // 6. Security Flag: Live Inference Approval
  // Canonical: ZETRO_LIVE_INFERENCE_ENABLED. Aliases: ZETRO_ALLOW_LIVE, ALLOW_LIVE. Default: false.
  // Invariant: Existing canonical false must override any legacy alias.
  // Invariant: ZETRO_LIVE_SMOKE must never authorize general live inference.
  const canonicalLiveRaw = getRawValue(envSource, fileValues, 'ZETRO_LIVE_INFERENCE_ENABLED');
  const legacyLiveRaw = getRawValue(envSource, fileValues, 'ZETRO_ALLOW_LIVE')
    ?? getRawValue(envSource, fileValues, 'ALLOW_LIVE');

  let liveAllowed = false;
  if (canonicalLiveRaw !== undefined) {
    const parsedCanonical = parseStrictBooleanFlag(canonicalLiveRaw, 'ZETRO_LIVE_INFERENCE_ENABLED', false);
    if (!parsedCanonical.isValid) {
      invalidFlags.push(parsedCanonical.error);
      reasons.push(parsedCanonical.error);
    }
    // Canonical takes strict precedence: if false, overrides any legacy alias
    liveAllowed = parsedCanonical.value;
  } else if (legacyLiveRaw !== undefined) {
    const parsedLegacy = parseStrictBooleanFlag(legacyLiveRaw, 'ZETRO_ALLOW_LIVE', false);
    if (!parsedLegacy.isValid) {
      invalidFlags.push(parsedLegacy.error);
      reasons.push(parsedLegacy.error);
    }
    liveAllowed = parsedLegacy.value;
  }

  // 7. Security Flag: Remote Source Code Sharing Approval
  // Canonical: ZETRO_ALLOW_REMOTE_SOURCE. Aliases: ZETRO_APPROVE_SOURCE, ZETRO_APPROVE_SOURCE_SHARING, APPROVE_SOURCE_SHARING. Default: false.
  // Invariant: Existing canonical false must override any legacy alias.
  const canonicalSourceRaw = getRawValue(envSource, fileValues, 'ZETRO_ALLOW_REMOTE_SOURCE');
  const legacySourceRaw = getRawValue(envSource, fileValues, 'ZETRO_APPROVE_SOURCE')
    ?? getRawValue(envSource, fileValues, 'ZETRO_APPROVE_SOURCE_SHARING')
    ?? getRawValue(envSource, fileValues, 'APPROVE_SOURCE_SHARING');

  let sourceSharingApproved = false;
  if (canonicalSourceRaw !== undefined) {
    const parsedCanonical = parseStrictBooleanFlag(canonicalSourceRaw, 'ZETRO_ALLOW_REMOTE_SOURCE', false);
    if (!parsedCanonical.isValid) {
      invalidFlags.push(parsedCanonical.error);
      reasons.push(parsedCanonical.error);
    }
    sourceSharingApproved = parsedCanonical.value;
  } else if (legacySourceRaw !== undefined) {
    const parsedLegacy = parseStrictBooleanFlag(legacySourceRaw, 'ZETRO_ALLOW_REMOTE_SOURCE', false);
    if (!parsedLegacy.isValid) {
      invalidFlags.push(parsedLegacy.error);
      reasons.push(parsedLegacy.error);
    }
    sourceSharingApproved = parsedLegacy.value;
  }

  // 8. Security Flag: Approved Providers List & Provider Approval
  // Canonical: ZETRO_APPROVED_PROVIDERS (provider-specific list, e.g. "fake, groq").
  // Aliases: ZETRO_APPROVE_PROVIDER, APPROVE_PROVIDER.
  // Invariant: Provider-specific list overrides boolean alias; mismatch blocks readiness.
  const canonicalApprovedListRaw = getRawValue(envSource, fileValues, 'ZETRO_APPROVED_PROVIDERS');
  const legacyApproveRaw = getRawValue(envSource, fileValues, 'ZETRO_APPROVE_PROVIDER')
    ?? getRawValue(envSource, fileValues, 'APPROVE_PROVIDER');

  let providerApproved = false;
  let approvedProvidersList = null;

  if (canonicalApprovedListRaw !== undefined) {
    const listStr = String(canonicalApprovedListRaw).trim();
    if (listStr === '' || listStr.toLowerCase() === 'none' || listStr.toLowerCase() === 'false' || listStr === '0') {
      approvedProvidersList = [];
    } else {
      approvedProvidersList = listStr
        .split(/[,\s]+/)
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
    }

    if (provider === 'fake') {
      // Fake is allowed unless explicitly excluded or list is non-empty and does not contain 'fake'
      providerApproved = approvedProvidersList.length === 0 || approvedProvidersList.includes('fake');
    } else {
      providerApproved = approvedProvidersList.includes(provider);
      if (!providerApproved) {
        reasons.push(
          `Approved-provider mismatch: Active provider '${provider}' is not in ZETRO_APPROVED_PROVIDERS [${approvedProvidersList.join(', ')}]`
        );
      }
    }
  } else if (legacyApproveRaw !== undefined) {
    const parsedLegacy = parseStrictBooleanFlag(legacyApproveRaw, 'ZETRO_APPROVE_PROVIDER', false);
    if (!parsedLegacy.isValid) {
      invalidFlags.push(parsedLegacy.error);
      reasons.push(parsedLegacy.error);
    }
    providerApproved = provider === 'fake' ? true : parsedLegacy.value;
  } else {
    // Default: fake is pre-approved; remote providers are not approved
    providerApproved = provider === 'fake';
  }

  // 9. API Keys / Credentials (stored strictly in WeakMap)
  const secretsMap = new Map();
  const rawGroqKey = getRawValue(envSource, fileValues, 'GROQ_API_KEY');
  const rawOpenCodeKey = getRawValue(envSource, fileValues, 'OPENCODE_API_KEY');
  const rawOpenRouterKey = getRawValue(envSource, fileValues, 'OPENROUTER_API_KEY');

  if (rawGroqKey && String(rawGroqKey).trim()) {
    secretsMap.set('groq', String(rawGroqKey).trim());
  }
  if (rawOpenCodeKey && String(rawOpenCodeKey).trim()) {
    secretsMap.set('opencode', String(rawOpenCodeKey).trim());
  }
  if (rawOpenRouterKey && String(rawOpenRouterKey).trim()) {
    secretsMap.set('openrouter', String(rawOpenRouterKey).trim());
  }

  const keysPresent = Object.freeze({
    groq: secretsMap.has('groq'),
    opencode: secretsMap.has('opencode'),
    openrouter: secretsMap.has('openrouter')
  });

  // 10. Model Eligibility & Catalog Verification (No Fake Proof)
  const modelVerification = validateModelEligibility({
    provider,
    model,
    freeOnly,
    maxCostUsd,
    catalogPort: options.catalogPort || options.catalogValidator
  });

  // CRITICAL P1: Always require eligible model and consistent explicit finite budget
  if (!modelVerification.eligible) {
    reasons.push(`Model eligibility failure: ${modelVerification.reason}`);
  }
  if (!modelVerification.verified && provider !== 'fake') {
    reasons.push(`Model catalog verification failure: ${modelVerification.reason}`);
  }
  if (!freeOnly && maxCostUsd <= 0 && provider !== 'fake') {
    reasons.push(`Paid mode requires an explicit finite budget > $0.00 (configured max cost: $${maxCostUsd.toFixed(2)})`);
  }

  // 11. Evaluate Readiness & Operating Mode
  let ready = false;
  let mode = 'offline-safe';

  if (invalidFlags.length > 0) {
    ready = false;
    mode = 'invalid-config';
  } else if (!KNOWN_PROVIDERS.includes(provider)) {
    ready = false;
    mode = 'invalid-provider';
    reasons.push(`Unknown provider '${provider}'. Supported providers: ${KNOWN_PROVIDERS.join(', ')}`);
  } else if (provider === 'fake') {
    ready = providerApproved;
    mode = 'offline-safe';
    if (!ready) {
      reasons.push("Fake provider was explicitly disallowed in approved providers list");
    } else {
      reasons.push('Fake provider active: zero cost, offline-safe, no external credentials required');
    }
  } else {
    // Remote Provider Readiness Checks
    if (!keysPresent[provider]) {
      reasons.push(`API key for provider '${provider}' is not set`);
    }
    if (!providerApproved) {
      if (!reasons.some(r => r.includes('Approved-provider mismatch'))) {
        reasons.push(`Provider '${provider}' has not been explicitly approved (requires ZETRO_APPROVED_PROVIDERS or ZETRO_APPROVE_PROVIDER=1)`);
      }
    }
    if (!liveAllowed) {
      reasons.push(`Live model inference is disabled (requires ZETRO_LIVE_INFERENCE_ENABLED=1)`);
    }
    if (!sourceSharingApproved) {
      reasons.push(`Remote source code transmission is not approved (requires ZETRO_ALLOW_REMOTE_SOURCE=1)`);
    }

    if (reasons.length === 0) {
      ready = true;
      mode = 'live-approved';
      reasons.push(`Provider '${provider}' with model '${model}' is verified eligible and ready for live execution`);
    } else {
      ready = false;
      mode = 'unready';
    }
  }

  const status = Object.freeze({
    ready,
    mode,
    reasons: Object.freeze([...reasons])
  });

  // 12. Create Safe Public Config Object (WeakMap credential attachment)
  const config = {
    provider,
    model,
    liveAllowed,
    sourceSharingApproved,
    providerApproved,
    approvedProvidersList: approvedProvidersList ? Object.freeze([...approvedProvidersList]) : null,
    freeOnly,
    maxCostUsd,
    concurrency,
    keysPresent,
    invalidFlags: Object.freeze([...invalidFlags]),
    modelVerification: Object.freeze({
      verified: modelVerification.verified,
      eligible: modelVerification.eligible,
      isFree: modelVerification.isFree,
      pricingProof: modelVerification.pricingProof,
      reason: modelVerification.reason
    }),
    status
  };

  // Associate secrets exclusively via module-scoped WeakMap
  CREDENTIAL_STORE.set(config, secretsMap);

  // Runtime accessor: reads ONLY from WeakMap
  Object.defineProperty(config, 'getApiKey', {
    value: function (providerName) {
      if (!providerName || typeof providerName !== 'string') return undefined;
      const map = CREDENTIAL_STORE.get(this);
      return map ? map.get(providerName.toLowerCase().trim()) : undefined;
    },
    writable: false,
    enumerable: false,
    configurable: false
  });

  Object.defineProperty(config, 'hasApiKey', {
    value: function (providerName) {
      if (!providerName || typeof providerName !== 'string') return false;
      const map = CREDENTIAL_STORE.get(this);
      return map ? map.has(providerName.toLowerCase().trim()) : false;
    },
    writable: false,
    enumerable: false,
    configurable: false
  });

  Object.defineProperty(config, 'getPublicConfig', {
    value: function () {
      return {
        provider,
        model,
        liveAllowed,
        sourceSharingApproved,
        providerApproved,
        approvedProvidersList: approvedProvidersList ? [...approvedProvidersList] : null,
        freeOnly,
        maxCostUsd,
        concurrency,
        keysPresent: { ...keysPresent },
        invalidFlags: [...invalidFlags],
        modelVerification: {
          verified: modelVerification.verified,
          eligible: modelVerification.eligible,
          isFree: modelVerification.isFree,
          pricingProof: modelVerification.pricingProof,
          reason: modelVerification.reason
        },
        status: {
          ready: status.ready,
          mode: status.mode,
          reasons: [...status.reasons]
        }
      };
    },
    writable: false,
    enumerable: false,
    configurable: false
  });

  Object.defineProperty(config, 'toJSON', {
    value: function () {
      return config.getPublicConfig();
    },
    writable: false,
    enumerable: false,
    configurable: false
  });

  Object.defineProperty(config, Symbol.for('nodejs.util.inspect.custom'), {
    value: function () {
      return config.getPublicConfig();
    },
    writable: false,
    enumerable: false,
    configurable: false
  });

  return Object.freeze(config);
}
