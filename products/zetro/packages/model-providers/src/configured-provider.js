/**
 * Model Providers - Configured Provider Integration Entrypoint
 *
 * Provides the unified, runtime-compatible integration entrypoint connecting
 * @zetro/provider-config with @zetro/model-providers.
 *
 * Enforces:
 * - Opaque credential access (reads strictly via config.getApiKey WeakMap)
 * - Shared validated metadata proof via catalog validator
 * - Offline-safe fake default
 * - Explicit live inference, provider approval, and source code transmission gates
 * - Prevention of silent source transmission or paid fallback
 * - Endpoint containment and credential leakage prevention
 */

import { loadProviderConfig as actualLoadProviderConfig } from '../../provider-config/src/loader.js';
import { createCatalogSnapshotPort as actualCreateCatalogSnapshotPort } from '../../provider-config/src/catalog-validator.js';
import { createModelProvider } from './factory.js';
import { FREE_MODEL_CATALOG, APPROVED_ENDPOINTS, validateFreeRouting, normalizeModelId } from './metadata.js';
import { validateModelSnapshot } from './validator-port.js';
import { resolveTools } from './base.js';
import { ProviderError, FreeRoutingViolationError, redactError } from './errors.js';

const DEFAULT_MODELS = Object.freeze({
  fake: 'fake-model',
  groq: 'qwen/qwen3.8-27b',
  opencode: 'glm-5.3-flash-free',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free'
});

const PROVIDER_INSTANCES = new WeakMap();

/**
 * Creates a catalog snapshot port backed by FREE_MODEL_CATALOG.
 */
export function createModelCatalogPort() {
  return actualCreateCatalogSnapshotPort(FREE_MODEL_CATALOG);
}

/**
 * Runtime-compatible provider adapter wrapping configured model execution.
 */
export class ConfiguredModelProvider {
  constructor({
    config,
    allowLiveCalls = false,
    fetchImpl = globalThis.fetch,
    snapshot = null,
    steps = null,
    transportPort = null,
    ...providerOptions
  } = {}) {
    if (!config || typeof config !== 'object') {
      throw new Error('ConfiguredModelProvider requires a valid ZetroProviderConfig object');
    }

    this.config = config;
    this.provider = (config.provider || 'fake').toLowerCase().trim();
    this.model = config.model || (this.provider === 'fake' ? 'fake-model' : DEFAULT_MODELS[this.provider] || 'unknown');
    this.name = this.provider === 'fake' ? 'fake' : `${this.provider}:${this.model}`;
    this.allowLiveCalls = allowLiveCalls === true;
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.snapshot = snapshot || null;
    this.steps = Array.isArray(steps) ? [...steps] : null;
    this.transportPort = transportPort || providerOptions.transportPort || null;
    this.providerOptions = providerOptions;
  }

  toJSON() {
    return {
      name: this.name,
      provider: this.provider,
      model: this.model,
      allowLiveCalls: this.allowLiveCalls,
      config: typeof this.config?.toJSON === 'function' ? this.config.toJSON() : this.config
    };
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return {
      name: this.name,
      provider: this.provider,
      model: this.model,
      allowLiveCalls: this.allowLiveCalls,
      config: this.config
    };
  }

  get secrets() {
    const key = typeof this.config.getApiKey === 'function' ? this.config.getApiKey(this.provider) : undefined;
    return key ? [key] : [];
  }

  /**
   * Evaluates all security and policy gates before dispatching any network request.
   */
  _validateGates({ requireSourceSharing = false, snapshot = null } = {}) {
    // 1. Fake provider: offline-safe, no remote network dispatch
    if (this.provider === 'fake') {
      if (!this.config.providerApproved) {
        throw new FreeRoutingViolationError(
          'Fake provider was explicitly disallowed in approved providers list',
          { provider: 'fake', secrets: this.secrets }
        );
      }
      return null;
    }

    // 2. Gate: Live inference authorization (Key presence alone never authorizes live calls)
    if (this.config.liveAllowed !== true || this.allowLiveCalls !== true) {
      throw new ProviderError(
        `Live inference disabled: ${this.provider} calls require explicit live authorization (ZETRO_LIVE_INFERENCE_ENABLED=1 and allowLiveCalls: true). Key presence alone does not authorize execution.`,
        { provider: this.provider, secrets: this.secrets }
      );
    }

    // 3. Gate: Approved provider list match
    if (this.config.providerApproved !== true) {
      throw new FreeRoutingViolationError(
        `Provider '${this.provider}' has not been approved in ZETRO_APPROVED_PROVIDERS. Remote execution prohibited.`,
        { provider: this.provider, secrets: this.secrets }
      );
    }

    // 4. Gate: Remote source code sharing approval (Prevent silent source transmission)
    if (requireSourceSharing && this.config.sourceSharingApproved !== true) {
      throw new FreeRoutingViolationError(
        `Remote source code transmission is not approved. Execution prohibited without explicit ZETRO_ALLOW_REMOTE_SOURCE=1 authorization. Silent source transmission prevented.`,
        { provider: this.provider, secrets: this.secrets }
      );
    }

    // 5. Gate: Model eligibility & Free-only policy (No paid fallback)
    const mv = this.config.modelVerification;
    if (!mv || mv.verified !== true || (this.config.freeOnly && mv.isFree !== true)) {
      throw new FreeRoutingViolationError(
        `Model '${this.model}' failed free catalog verification: ${mv?.reason || 'Unknown or paid model'}. Paid fallback prohibited.`,
        { provider: this.provider, secrets: this.secrets }
      );
    }

    // 6. Gate: API Key presence (Opaque credential access)
    const apiKey = typeof this.config.getApiKey === 'function' ? this.config.getApiKey(this.provider) : undefined;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new ProviderError(
        `API key for provider '${this.provider}' is not set or empty. Remote execution prohibited.`,
        { provider: this.provider, secrets: this.secrets }
      );
    }

    // 7. Gate: Fresh validated metadata proof matching exact configured provider AND model
    // Timeless static catalog fallback is prohibited for live inference.
    const activeSnapshot = snapshot || this.snapshot || this.config?.snapshot || this.config?.modelSnapshot;
    if (!activeSnapshot) {
      throw new FreeRoutingViolationError(
        `Missing fresh validated metadata snapshot for live inference on provider '${this.provider}' model '${this.model}'. Live execution requires fresh validated metadata proof matching exact configured provider and model. Timeless static catalog replacement is prohibited.`,
        { provider: this.provider, secrets: this.secrets }
      );
    }

    // A. Validate snapshot structure, finite TTL, freshness, capabilities, and zero pricing
    validateModelSnapshot(activeSnapshot);

    // B. Exact provider match: snapshot provider must match configured provider
    const normConfiguredProvider = (this.provider || '').toLowerCase().trim();
    const normSnapshotProvider = (activeSnapshot.provider || '').toLowerCase().trim();
    if (normSnapshotProvider !== normConfiguredProvider) {
      throw new FreeRoutingViolationError(
        `Metadata proof provider '${activeSnapshot.provider}' does not match configured provider '${this.provider}'. Swapped provider proof rejected. Zero network dispatch enforced.`,
        { provider: this.provider, secrets: this.secrets }
      );
    }

    // C. Exact model match: snapshot model ID must match configured model ID
    const normConfiguredModel = normalizeModelId(this.model, normConfiguredProvider);
    const normSnapshotModel = normalizeModelId(activeSnapshot.id, normSnapshotProvider);
    if (normSnapshotModel !== normConfiguredModel) {
      throw new FreeRoutingViolationError(
        `Metadata proof model '${activeSnapshot.id}' does not match configured model '${this.model}'. Swapped model proof rejected. Zero network dispatch enforced.`,
        { provider: this.provider, secrets: this.secrets }
      );
    }

    return { apiKey, snapshot: activeSnapshot };
  }

  _getUnderlyingProvider(apiKey, snapshot = null) {
    let instance = PROVIDER_INSTANCES.get(this);
    if (!instance) {
      instance = createModelProvider({
        provider: this.provider,
        model: this.model,
        apiKey,
        fetchImpl: this.fetchImpl,
        allowLiveCalls: true, // Authorization verified by ConfiguredModelProvider gates
        snapshot: snapshot || this.snapshot || this.config?.snapshot || this.config?.modelSnapshot,
        transportPort: this.transportPort,
        ...this.providerOptions
      });
      PROVIDER_INSTANCES.set(this, instance);
    }
    return instance;
  }

  /**
   * Verifies access to the provider without transmitting source code.
   */
  async checkAccess(timeoutMs = 20000) {
    if (this.provider === 'fake') {
      if (!this.config.providerApproved) {
        throw new FreeRoutingViolationError(
          'Fake provider was explicitly disallowed in approved providers list',
          { provider: 'fake', secrets: this.secrets }
        );
      }
      return {
        authenticated: true,
        modelAvailable: true,
        model: this.model,
        provenZeroCost: true
      };
    }

    const { apiKey, snapshot } = this._validateGates({ requireSourceSharing: false });
    const underlying = this._getUnderlyingProvider(apiKey, snapshot);
    return await underlying.checkAccess(timeoutMs);
  }

  /**
   * Executes next inference turn with tool calling, parameter negotiation, and token limits.
   */
  async next({ messages, tools, maxOutputTokens = 1024, timeoutMs = 30000, snapshot = null, signal = null, transportPort = null }) {
    const activeTransportPort = transportPort || this.transportPort;
    if (this.provider === 'fake') {
      if (signal?.aborted) {
        const abortErr = new Error('Operation aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      if (!this.config.providerApproved) {
        throw new FreeRoutingViolationError(
          'Fake provider was explicitly disallowed in approved providers list',
          { provider: 'fake', secrets: this.secrets }
        );
      }
      if (activeTransportPort && typeof activeTransportPort.reserve === 'function') {
        const reservation = await activeTransportPort.reserve({
          provider: 'fake',
          model: this.model,
          attempt: 1,
          remainingMs: timeoutMs,
          signal
        });
        if (signal?.aborted) {
          const abortErr = new Error('Operation aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        if (!reservation || reservation.ok !== true) {
          const reason = (reservation && typeof reservation.reason === 'string' && reservation.reason.trim())
            ? reservation.reason
            : 'Missing or malformed reservation approval (literal ok: true required)';
          const denialErr = new ProviderError(
            `Transport reservation denied for fake:${this.model}: ${reason}`,
            { provider: 'fake', secrets: this.secrets, attempts: 0, retries: 0, remoteUsageUncertain: false }
          );
          denialErr.reservationDenied = true;
          denialErr.reason = reason;
          if (typeof reservation?.retryAfterMs === 'number') {
            denialErr.retryAfterMs = reservation.retryAfterMs;
          }
          denialErr.attempts = 0;
          denialErr.retries = 0;
          throw denialErr;
        }
      }
      if (signal?.aborted) {
        const abortErr = new Error('Operation aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      if (this.steps && this.steps.length > 0) {
        const step = this.steps.shift();
        if (activeTransportPort && typeof activeTransportPort.report === 'function') {
          try {
            await activeTransportPort.report({
              provider: 'fake',
              model: this.model,
              attempt: 1,
              ok: true,
              status: 200,
              error: null,
              usage: { inputTokens: 20, outputTokens: 10 },
              unknownUsage: false,
              durationMs: 1,
              remainingMs: timeoutMs
            });
          } catch {}
        }
        return {
          toolCalls: [step],
          usage: { inputTokens: 20, outputTokens: 10 },
          attempts: 1,
          retries: 0
        };
      }
      const resolvedTools = resolveTools(tools);
      const firstTool = resolvedTools[0]?.function?.name || 'submit_receipt';
      if (activeTransportPort && typeof activeTransportPort.report === 'function') {
        try {
          await activeTransportPort.report({
            provider: 'fake',
            model: this.model,
            attempt: 1,
            ok: true,
            status: 200,
            error: null,
            usage: { inputTokens: 20, outputTokens: 10 },
            unknownUsage: false,
            durationMs: 1,
            remainingMs: timeoutMs
          });
        } catch {}
      }
      return {
        toolCalls: [{ name: firstTool, args: {} }],
        usage: { inputTokens: 20, outputTokens: 10 },
        attempts: 1,
        retries: 0
      };
    }

    const { apiKey, snapshot: activeSnapshot } = this._validateGates({
      requireSourceSharing: true,
      snapshot
    });
    const underlying = this._getUnderlyingProvider(apiKey, activeSnapshot);
    try {
      const result = await underlying.next({
        messages,
        tools,
        maxOutputTokens,
        timeoutMs,
        snapshot: activeSnapshot,
        signal,
        transportPort: activeTransportPort
      });
      return {
        toolCalls: result.toolCalls,
        usage: result.usage,
        attempts: result.attempts ?? 1,
        retries: result.retries ?? 0
      };
    } catch (err) {
      throw redactError(err, this.secrets);
    }
  }
}

/**
 * Factory entrypoint integrating provider configuration with model provider adapters.
 *
 * @param {object} [options={}]
 * @param {object} [options.config] - Pre-loaded ZetroProviderConfig
 * @param {Record<string, string>} [options.env] - Injected environment variables (defaults to empty object to prevent actualenv read)
 * @param {string} [options.envFile] - Synthetic env file path
 * @param {string} [options.syntheticEnvContent] - Inline synthetic env text
 * @param {Function} [options.loadConfigImpl] - Custom config loader function
 * @param {Function} [options.catalogPort] - Custom catalog snapshot port
 * @param {boolean} [options.allowLiveCalls=false] - Programmatic live authorization
 * @param {Function} [options.fetchImpl] - Injected fetch implementation
 * @param {object} [options.snapshot] - Validated model snapshot
 * @param {Array} [options.steps] - Simulated steps for fake provider
 * @param {object} [options.transportPort] - Transport lifecycle port for campaign budget owner
 * @returns {ConfiguredModelProvider}
 */
export function createConfiguredProvider(options = {}) {
  const {
    config: injectedConfig,
    env,
    envFile,
    syntheticEnvContent,
    loadConfigImpl = actualLoadProviderConfig,
    catalogPort,
    allowLiveCalls = false,
    fetchImpl = globalThis.fetch,
    snapshot = null,
    steps = null,
    transportPort = null,
    ...rest
  } = options;

  const activeCatalogPort = catalogPort || actualCreateCatalogSnapshotPort(FREE_MODEL_CATALOG);

  let config = injectedConfig;
  if (!config) {
    if (typeof loadConfigImpl !== 'function') {
      throw new Error('loadConfigImpl must be a function that loads provider configuration');
    }
    // Prevent accidental read of process.env when env is not supplied
    const resolvedEnv = env !== undefined ? env : (options.env || {});
    config = loadConfigImpl({
      env: resolvedEnv,
      envFile,
      syntheticEnvContent,
      catalogPort: activeCatalogPort
    });
  }

  return new ConfiguredModelProvider({
    config,
    allowLiveCalls,
    fetchImpl,
    snapshot,
    steps,
    transportPort,
    ...rest
  });
}

// Alias for runtime compatibility
export const createRuntimeProvider = createConfiguredProvider;
