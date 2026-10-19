/**
 * Model Providers - Bounded Model Discovery & Metadata Snapshot Service
 *
 * Implements bounded remote model discovery, validated metadata snapshots,
 * parameter capability negotiation, TTL-governed cache management, and strict zero-pricing proof.
 */

import { APPROVED_ENDPOINTS, validateEndpoint, FREE_MODEL_CATALOG, normalizeModelId } from './metadata.js';
import {
  FreeRoutingViolationError,
  ProviderError,
  ProviderTransportError,
  createHttpError,
  isTransportFailure,
  networkCodes,
  redactError
} from './errors.js';

function assertExplicitZeroCost(val, name, model, secrets) {
  if (typeof val !== 'number' && typeof val !== 'string') {
    throw new FreeRoutingViolationError(
      `Model '${model}' ${name} pricing (${typeof val === 'object' ? JSON.stringify(val) : String(val)}) must be an explicit numeric or string zero. Rejected non-number/non-string type.`,
      { secrets }
    );
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '' || !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
      throw new FreeRoutingViolationError(
        `Model '${model}' ${name} pricing (${JSON.stringify(val)}) is empty, whitespace, or non-numeric. Rejected invalid pricing string.`,
        { secrets }
      );
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num !== 0 || Object.is(num, -0)) {
      throw new FreeRoutingViolationError(
        `Model '${model}' ${name} pricing (${val}) is not finite positive zero. Proven zero cost required.`,
        { secrets }
      );
    }
    return num;
  }

  if (!Number.isFinite(val) || val !== 0 || Object.is(val, -0)) {
    throw new FreeRoutingViolationError(
      `Model '${model}' ${name} pricing (${val}) is not finite positive zero. Proven zero cost required.`,
      { secrets }
    );
  }
  return val;
}

export class ModelDiscoveryService {
  constructor({ defaultTtlMs = 60000 } = {}) {
    if (defaultTtlMs !== undefined) {
      if (typeof defaultTtlMs !== 'number' || !Number.isFinite(defaultTtlMs) || defaultTtlMs <= 0 || Object.is(defaultTtlMs, -0)) {
        throw new FreeRoutingViolationError(`ModelDiscoveryService defaultTtlMs (${defaultTtlMs}) must be a finite positive number`);
      }
    }
    this.defaultTtlMs = Math.min(Math.max(1, defaultTtlMs), 86400000);
    this.snapshots = new Map();
  }

  getSnapshot(provider, modelId) {
    if (!provider || !modelId) return null;
    const normProvider = provider.toLowerCase().trim();
    const normModel = normalizeModelId(modelId, normProvider);
    const key = `${normProvider}:${normModel}`;
    const cached = this.snapshots.get(key);
    if (!cached) return null;

    if (Date.now() >= cached.expiresAt) {
      this.snapshots.delete(key);
      return null;
    }

    return {
      ...cached,
      pricing: { ...cached.pricing },
      supportedParameters: [...cached.supportedParameters],
      negotiatedParameters: { ...cached.negotiatedParameters }
    };
  }

  invalidate(provider, modelId) {
    if (!provider || !modelId) return;
    const normProvider = provider.toLowerCase().trim();
    const normModel = normalizeModelId(modelId, normProvider);
    const key = `${normProvider}:${normModel}`;
    this.snapshots.delete(key);
  }

  clear() {
    this.snapshots.clear();
  }

  async discoverModel({
    provider,
    modelId,
    apiKey,
    fetchImpl = globalThis.fetch,
    timeoutMs = 15000,
    ttlMs = this.defaultTtlMs,
    allowLiveCalls = false,
    forceRefresh = false
  }) {
    if (!provider || typeof provider !== 'string') {
      throw new FreeRoutingViolationError('Provider is required for model discovery');
    }
    if (!modelId || typeof modelId !== 'string') {
      throw new FreeRoutingViolationError('Model ID is required for model discovery');
    }
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new Error('API key is required for model discovery');
    }

    if (ttlMs !== undefined) {
      if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0 || Object.is(ttlMs, -0)) {
        throw new FreeRoutingViolationError(`Model discovery ttlMs (${ttlMs}) must be a finite positive number`);
      }
      if (ttlMs > 86400000) {
        throw new FreeRoutingViolationError(`Model discovery ttlMs (${ttlMs}) exceeds maximum allowed TTL (86400000ms)`);
      }
    }
    const effectiveTtl = Math.min(Math.max(1, ttlMs), 86400000);

    const normProvider = provider.toLowerCase().trim();
    const normModel = normalizeModelId(modelId, normProvider);
    const key = `${normProvider}:${normModel}`;

    // Live execution gate: key presence alone never authorizes live network execution
    if (allowLiveCalls !== true) {
      throw new ProviderError(
        `Live inference disabled: ${normProvider} model discovery requires explicit allowLiveCalls: true authorization. Key presence alone does not authorize execution.`,
        { provider: normProvider, secrets: [apiKey] }
      );
    }

    // Invalidate before refresh so failed refresh never leaves old free cache usable
    if (forceRefresh) {
      this.invalidate(normProvider, normModel);
    } else {
      const existing = this.getSnapshot(normProvider, normModel);
      if (existing) {
        return existing;
      }
    }

    // Invalidate on any failed proof path within execution
    try {
      const modelsEndpoint = APPROVED_ENDPOINTS[normProvider]?.models;
      if (!modelsEndpoint) {
        throw new FreeRoutingViolationError(`Provider '${provider}' has no approved models discovery endpoint`);
      }
      validateEndpoint(normProvider, 'models', modelsEndpoint);

      const boundedTimeout = Math.max(1, Math.min(timeoutMs, 60000));
      let response;
      try {
        response = await fetchImpl(modelsEndpoint, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`
          },
          redirect: 'error',
          signal: AbortSignal.timeout(boundedTimeout)
        });
      } catch (err) {
        if (isTransportFailure(err)) {
          throw new ProviderTransportError(`${normProvider} model discovery transport failure`, {
            cause: err,
            networkCodes: networkCodes(err),
            secrets: [apiKey],
            provider: normProvider
          });
        }
        throw redactError(err, [apiKey]);
      }

      if (!response.ok) {
        throw createHttpError(response, normProvider, [apiKey]);
      }

      let body;
      try {
        body = await response.json();
      } catch (err) {
        throw new ProviderError(`Malformed ${normProvider} models discovery response JSON`, {
          cause: err,
          provider: normProvider,
          secrets: [apiKey]
        });
      }

      if (!Array.isArray(body?.data)) {
        throw new ProviderError(`Malformed ${normProvider} models discovery response: missing data array`, {
          provider: normProvider,
          secrets: [apiKey]
        });
      }

      const item = body.data.find(m => m?.id === normModel || m?.id === modelId);
      if (!item) {
        throw new FreeRoutingViolationError(
          `Model '${modelId}' not found in ${normProvider} models discovery catalog. Absent model cannot authorize inference.`,
          { provider: normProvider, secrets: [apiKey] }
        );
      }

      // Provider-specific metadata extraction & zero-price proof
      let supportedParameters = ['tools'];
      let contextWindow = item.context_length || 32768;
      let hasExplicitRequestCost = false;

      if (normProvider === 'openrouter') {
        const pricing = item.pricing;
        if (!pricing || typeof pricing !== 'object') {
          throw new FreeRoutingViolationError(
            `OpenRouter model '${modelId}' is missing pricing evidence from models endpoint. Missing pricing cannot authorize inference.`,
            { provider: 'openrouter', secrets: [apiKey] }
          );
        }

        assertExplicitZeroCost(pricing.prompt, 'prompt', modelId, [apiKey]);
        assertExplicitZeroCost(pricing.completion, 'completion', modelId, [apiKey]);
        // Do NOT invent missing request zero: only set if explicitly present in provider response
        if (pricing.request !== undefined && pricing.request !== null) {
          assertExplicitZeroCost(pricing.request, 'request', modelId, [apiKey]);
          hasExplicitRequestCost = true;
        }

        const supported = item.supported_parameters;
        const hasTools = Array.isArray(supported) &&
          supported.length > 0 &&
          (supported.includes('tools') || supported.includes('functions'));

        if (!hasTools) {
          throw new FreeRoutingViolationError(
            `OpenRouter model '${modelId}' lacks verified tool calling evidence in supported_parameters. Models without verified tool support cannot authorize inference.`,
            { provider: 'openrouter', secrets: [apiKey] }
          );
        }

        const hasTokenLimit = Array.isArray(supported) &&
          (supported.includes('max_tokens') || supported.includes('max_completion_tokens'));
        if (!hasTokenLimit) {
          throw new FreeRoutingViolationError(
            `OpenRouter model '${modelId}' lacks verified output token limit parameter ('max_tokens' or 'max_completion_tokens') in supported_parameters. Models without output token limit support cannot authorize inference.`,
            { provider: 'openrouter', secrets: [apiKey] }
          );
        }
        supportedParameters = [...supported];
      } else {
        // Groq / OpenCode: ensure model is recognized in free catalog
        const catalogEntry = FREE_MODEL_CATALOG[normModel];
        if (!catalogEntry || !catalogEntry.isFree) {
          throw new FreeRoutingViolationError(
            `Model '${modelId}' is not a verified free model in ${normProvider} catalog.`,
            { provider: normProvider, secrets: [apiKey] }
          );
        }
        contextWindow = catalogEntry.contextWindow;
        supportedParameters = catalogEntry.supportedParameters ? [...catalogEntry.supportedParameters] : ['tools', 'parallel_tool_calls'];
      }

      const now = Date.now();
      const pricingObj = {
        inputCostPerM: 0,
        outputCostPerM: 0
      };
      if (hasExplicitRequestCost) {
        pricingObj.requestCost = 0;
      }

      const snapshot = {
        id: normModel,
        provider: normProvider,
        displayName: item.name || normModel,
        contextWindow,
        toolCalling: true,
        pricing: pricingObj,
        isFree: true,
        supportedParameters,
        negotiatedParameters: {
          tools: supportedParameters.includes('tools') || supportedParameters.includes('functions'),
          toolChoice: supportedParameters.includes('tool_choice'),
          parallelToolCalls: supportedParameters.includes('parallel_tool_calls'),
          maxTokensParam: supportedParameters.includes('max_tokens')
            ? 'max_tokens'
            : supportedParameters.includes('max_completion_tokens')
              ? 'max_completion_tokens'
              : null,
          temperature: supportedParameters.includes('temperature')
        },
        source: modelsEndpoint,
        checkedAt: new Date(now).toISOString(),
        ttlMs: effectiveTtl,
        expiresAt: now + effectiveTtl,
        accountEligibility: 'unknown' // Explicitly kept separate from route price
      };

      this.snapshots.set(key, snapshot);
      return {
        ...snapshot,
        pricing: { ...snapshot.pricing },
        supportedParameters: [...snapshot.supportedParameters],
        negotiatedParameters: { ...snapshot.negotiatedParameters }
      };
    } catch (err) {
      // Invalidate on all failed proof paths so stale/old cache is never left usable
      this.invalidate(normProvider, normModel);
      throw err;
    }
  }
}
