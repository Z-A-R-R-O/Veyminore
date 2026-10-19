/**
 * @zetro/model-gateway - Dynamic Model Provider Registry
 *
 * Manages runtime registration, capability discovery, probing, status tracking,
 * and fallback chains for any AI model or provider endpoint.
 *
 * Zero hardcoding: No provider names or model IDs are required or assumed.
 * Every model is evaluated purely by its capability profile and verification state.
 */

import { EventEmitter } from 'node:events';
import {
  VerificationState,
  determineCompatibilityLevel,
  createCapabilityProfile
} from '../contracts/capabilities.js';
import {
  ModelGatewayError,
  CapabilityMismatchError
} from '../contracts/model-provider.js';

export class ModelRegistryError extends ModelGatewayError {
  constructor(message, details = {}) {
    super(message, 'MODEL_REGISTRY_ERROR', details);
    this.name = 'ModelRegistryError';
  }
}

/**
 * Registry events
 */
export const RegistryEvent = Object.freeze({
  MODEL_REGISTERED: 'model_registered',
  MODEL_UNREGISTERED: 'model_unregistered',
  MODEL_STATUS_CHANGED: 'model_status_changed',
  CAPABILITIES_UPDATED: 'capabilities_updated',
  DEFAULT_MODEL_CHANGED: 'default_model_changed'
});

export class ModelProviderRegistry extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {Array<Object>} [options.initialModels=[]]
   * @param {string} [options.defaultModelId]
   */
  constructor(options = {}) {
    super();
    /** @type {Map<string, Object>} */
    this._models = new Map();
    /** @type {string|null} */
    this._defaultModelId = options.defaultModelId || null;

    if (Array.isArray(options.initialModels)) {
      for (const model of options.initialModels) {
        this.register(model);
      }
    }
  }

  /**
   * Registers a new model provider configuration.
   *
   * @param {Object} entry
   * @param {string} entry.id Unique identifier for this model configuration (e.g. 'local-llama-vision', 'prod-claude')
   * @param {string} entry.provider Provider driver name (e.g. 'openai-compatible', 'anthropic', 'gemini', 'mock')
   * @param {string} entry.model Target model name on the provider endpoint
   * @param {string} [entry.endpoint] Custom base URL or socket path
   * @param {string} [entry.apiKey] Optional API key or bearer token
   * @param {boolean} [entry.enabled=true] Whether this model is eligible for routing
   * @param {Object} [entry.capabilities] Declared or verified capability states
   * @param {Object} [entry.limits] Context and rate limits
   * @param {Object} [entry.policy] Execution policy overrides (e.g. maxActionsPerRun, allowConsequential)
   * @returns {Object} Stored model profile record
   */
  register(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new ModelRegistryError('Model registration entry must be a non-null object');
    }

    // Support both raw configuration objects and ModelProviderPort instances
    const source = (entry.profile && typeof entry.profile === 'object') ? entry.profile : entry;
    const port = (typeof entry.proposeAction === 'function') ? entry : null;

    if (typeof source.id !== 'string' || source.id.trim() === '') {
      throw new ModelRegistryError("Model entry missing required non-empty string 'id'");
    }

    const id = source.id.trim();

    if (this._models.has(id)) {
      throw new ModelRegistryError(`Model with ID '${id}' is already registered`, { modelId: id });
    }

    if (typeof source.provider !== 'string' || source.provider.trim() === '') {
      throw new ModelRegistryError("Model entry missing required non-empty string 'provider'");
    }

    if (typeof source.model !== 'string' || source.model.trim() === '') {
      throw new ModelRegistryError("Model entry missing required non-empty string 'model'");
    }

    const capabilities = createCapabilityProfile(source.capabilities || {});
    const compatibilityLevel = determineCompatibilityLevel(capabilities);

    const record = {
      id,
      provider: source.provider.trim(),
      model: source.model.trim(),
      endpoint: source.endpoint ? String(source.endpoint).trim() : null,
      apiKey: source.apiKey ? String(source.apiKey).trim() : null,
      enabled: source.enabled !== false,
      capabilities,
      compatibilityLevel,
      port,
      limits: {
        maxContextTokens: Number(source.limits?.maxContextTokens) || 32768,
        maxImagesPerTurn: Number(source.limits?.maxImagesPerTurn) || 1,
        rateLimitRpm: Number(source.limits?.rateLimitRpm) || 60,
        requestTimeoutMs: Number(source.limits?.requestTimeoutMs) || 30000,
        ...source.limits
      },
      policy: {
        maxActionsPerRun: Number(source.policy?.maxActionsPerRun) || 10,
        allowConsequentialWithoutApproval: Boolean(source.policy?.allowConsequentialWithoutApproval),
        ...source.policy
      },
      registeredAt: Date.now(),
      lastVerifiedAt: null
    };

    this._models.set(id, record);

    if (!this._defaultModelId && record.enabled) {
      this._defaultModelId = id;
    }

    this.emit(RegistryEvent.MODEL_REGISTERED, { model: record });
    return record;
  }

  /**
   * Alias for register.
   */
  registerModel(entry) {
    return this.register(entry);
  }

  /**
   * Unregisters a model by ID.
   *
   * @param {string} id
   * @returns {boolean} True if model existed and was removed
   */
  unregister(id) {
    if (typeof id !== 'string' || !this._models.has(id.trim())) {
      return false;
    }

    const cleanId = id.trim();
    const removed = this._models.get(cleanId);
    this._models.delete(cleanId);

    if (this._defaultModelId === cleanId) {
      // Pick next available enabled model as default
      const next = Array.from(this._models.values()).find(m => m.enabled);
      this._defaultModelId = next ? next.id : null;
      this.emit(RegistryEvent.DEFAULT_MODEL_CHANGED, { defaultModelId: this._defaultModelId });
    }

    this.emit(RegistryEvent.MODEL_UNREGISTERED, { modelId: cleanId, previous: removed });
    return true;
  }

  /**
   * Retrieves a model profile by ID.
   *
   * @param {string} id
   * @returns {Object|null}
   */
  get(id) {
    if (typeof id !== 'string') return null;
    return this._models.get(id.trim()) || null;
  }

  /**
   * Retrieves a registered model port or profile by ID.
   *
   * @param {string} id
   * @returns {Object|null}
   */
  getModel(id) {
    const rec = this.get(id);
    return rec?.port || rec;
  }

  /**
   * Returns all registered model profiles.
   *
   * @param {Object} [filter]
   * @param {boolean} [filter.enabled] Filter by enabled status
   * @param {boolean} [filter.enabledOnly] Filter enabled models only
   * @param {number} [filter.minCompatibilityLevel] Max compatibility tier (Level 1 is best, Level 4 is basic)
   * @param {string} [filter.requiredCapability] E.g. 'vision'
   * @returns {Array<Object>}
   */
  list(filter = {}) {
    let result = Array.from(this._models.values());

    if (filter.enabledOnly === true) {
      result = result.filter(m => m.enabled === true);
    } else if (typeof filter.enabled === 'boolean') {
      result = result.filter(m => m.enabled === filter.enabled);
    }

    if (typeof filter.requiredCapability === 'string') {
      const cap = filter.requiredCapability;
      result = result.filter(m => {
        const val = m.capabilities[cap];
        return val === VerificationState.VERIFIED || val === VerificationState.REPORTED;
      });
    }

    if (typeof filter.minCompatibilityLevel === 'number') {
      result = result.filter(m => m.compatibilityLevel <= filter.minCompatibilityLevel);
    }

    return result;
  }

  /**
   * Alias for list.
   */
  listModels(filter) {
    return this.list(filter);
  }

  /**
   * Enables or disables a model.
   *
   * @param {string} id
   * @param {boolean} enabled
   * @returns {Object} Updated model profile
   */
  setEnabled(id, enabled) {
    const model = this.get(id);
    if (!model) {
      throw new ModelRegistryError(`Model '${id}' not found`, { modelId: id });
    }

    model.enabled = Boolean(enabled);
    this.emit(RegistryEvent.MODEL_STATUS_CHANGED, { modelId: model.id, enabled: model.enabled });
    return model;
  }

  /**
   * Updates verified capabilities for a model (e.g. after a probe runs).
   *
   * @param {string} id
   * @param {Object} capabilities Partial or full capability updates
   * @returns {Object} Updated model profile
   */
  updateCapabilities(id, capabilities) {
    const model = this.get(id);
    if (!model) {
      throw new ModelRegistryError(`Model '${id}' not found`, { modelId: id });
    }

    model.capabilities = createCapabilityProfile({
      ...model.capabilities,
      ...capabilities
    });
    model.compatibilityLevel = determineCompatibilityLevel(model.capabilities);
    model.lastVerifiedAt = Date.now();

    this.emit(RegistryEvent.CAPABILITIES_UPDATED, {
      modelId: model.id,
      capabilities: model.capabilities,
      compatibilityLevel: model.compatibilityLevel
    });
    return model;
  }

  /**
   * Sets the default model ID.
   *
   * @param {string} id
   */
  setDefaultModel(id) {
    const model = this.get(id);
    if (!model) {
      throw new ModelRegistryError(`Cannot set unknown model '${id}' as default`, { modelId: id });
    }
    if (!model.enabled) {
      throw new ModelRegistryError(`Cannot set disabled model '${id}' as default`, { modelId: id });
    }

    this._defaultModelId = model.id;
    this.emit(RegistryEvent.DEFAULT_MODEL_CHANGED, { defaultModelId: this._defaultModelId });
  }

  /**
   * Gets the current default model profile.
   *
   * @returns {Object|null}
   */
  getDefaultModel() {
    if (!this._defaultModelId) return null;
    return this.get(this._defaultModelId);
  }

  /**
   * Resolves the best eligible model according to task requirements and capability matching.
   * If required capabilities are not met by the default model, walks the fallback ladder.
   *
   * @param {Object} requirements
   * @param {boolean} [requirements.requireVision=false]
   * @param {boolean} [requirements.requireTools=false]
   * @param {boolean} [requirements.requireStructuredOutput=false]
   * @param {boolean} [requirements.preferLocal=false]
   * @param {string} [requirements.specificModelId]
   * @returns {Object} Best eligible model profile
   */
  resolveModelForTask(requirements = {}) {
    if (requirements.specificModelId) {
      const specific = this.get(requirements.specificModelId);
      if (!specific || !specific.enabled) {
        throw new CapabilityMismatchError(
          `Requested specific model '${requirements.specificModelId}' is not found or disabled`,
          { requested: requirements.specificModelId }
        );
      }
      return specific;
    }

    const eligible = this.list({ enabled: true });

    if (eligible.length === 0) {
      throw new ModelRegistryError('No enabled models available in registry');
    }

    // Filter by mandatory capabilities
    const matched = eligible.filter(model => {
      if (requirements.requireVision) {
        const v = model.capabilities.vision;
        if (v !== VerificationState.VERIFIED && v !== VerificationState.REPORTED) return false;
      }
      if (requirements.requireTools) {
        const t = model.capabilities.toolCalling;
        if (t !== VerificationState.VERIFIED && t !== VerificationState.REPORTED) return false;
      }
      if (requirements.requireStructuredOutput) {
        const s = model.capabilities.structuredOutput;
        if (s !== VerificationState.VERIFIED && s !== VerificationState.REPORTED) return false;
      }
      return true;
    });

    if (matched.length === 0) {
      throw new CapabilityMismatchError(
        'No registered model satisfies the requested task capabilities',
        { requirements, availableCount: eligible.length }
      );
    }

    // Sort by best compatibility tier (Level 1 < Level 2 < Level 3 < Level 4)
    // and preference for local if requested
    matched.sort((a, b) => {
      if (requirements.preferLocal) {
        const aLocal = a.capabilities.local === VerificationState.VERIFIED;
        const bLocal = b.capabilities.local === VerificationState.VERIFIED;
        if (aLocal && !bLocal) return -1;
        if (!aLocal && bLocal) return 1;
      }
      return a.compatibilityLevel - b.compatibilityLevel;
    });

    return matched[0];
  }

  /**
   * Serializes the registry state to a plain JSON object.
   * Strips secret tokens for safe storage unless explicitly requested.
   *
   * @param {Object} [options]
   * @param {boolean} [options.includeSecrets=false]
   * @returns {Object}
   */
  toJSON({ includeSecrets = false } = {}) {
    return {
      version: '2.0.0',
      defaultModelId: this._defaultModelId,
      models: Array.from(this._models.values()).map(m => ({
        ...m,
        apiKey: includeSecrets ? m.apiKey : (m.apiKey ? '***REDACTED***' : null)
      }))
    };
  }

  /**
   * Loads registry state from a JSON representation.
   *
   * @param {Object} data
   * @returns {ModelProviderRegistry}
   */
  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new ModelRegistryError('Invalid registry JSON payload');
    }

    const registry = new ModelProviderRegistry({
      defaultModelId: data.defaultModelId
    });

    if (Array.isArray(data.models)) {
      for (const model of data.models) {
        registry.register(model);
      }
    }

    if (data.defaultModelId && registry.get(data.defaultModelId)) {
      registry.setDefaultModel(data.defaultModelId);
    }

    return registry;
  }
}
