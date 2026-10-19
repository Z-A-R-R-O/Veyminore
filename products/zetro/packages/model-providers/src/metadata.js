/**
 * Model Providers - Metadata, Catalog, and Free-Only Routing Policy
 *
 * Enforces verified zero pricing, approved endpoints, API slugs, and typed model metadata.
 */

import { FreeRoutingViolationError } from './errors.js';

export const APPROVED_ENDPOINTS = {
  groq: {
    chat: 'https://api.groq.com/openai/v1/chat/completions',
    models: 'https://api.groq.com/openai/v1/models'
  },
  opencode: {
    chat: 'https://opencode.ai/inference/openai/v1/chat/completions',
    models: 'https://opencode.ai/inference/openai/v1/models'
  },
  openrouter: {
    chat: 'https://openrouter.ai/api/v1/chat/completions',
    auth: 'https://openrouter.ai/api/v1/auth/key',
    models: 'https://openrouter.ai/api/v1/models'
  }
};

/**
 * Validates that an endpoint exactly matches the approved provider destination for the given purpose.
 */
export function validateEndpoint(provider, purpose, endpoint) {
  if (!provider || typeof provider !== 'string') {
    throw new FreeRoutingViolationError('Provider is required for endpoint validation');
  }
  const normProvider = provider.toLowerCase().trim();
  const providerEndpoints = APPROVED_ENDPOINTS[normProvider];
  if (!providerEndpoints) {
    throw new FreeRoutingViolationError(`Unapproved provider '${provider}'.`);
  }

  const expected = providerEndpoints[purpose];
  if (!expected) {
    throw new FreeRoutingViolationError(`Unknown endpoint purpose '${purpose}' for provider '${provider}'.`);
  }

  if (endpoint !== expected) {
    throw new FreeRoutingViolationError(
      `Destination '${endpoint}' rejected: does not match approved ${normProvider} ${purpose} endpoint '${expected}'. Custom or redirected destinations are prohibited.`
    );
  }

  return expected;
}

export const FREE_MODEL_CATALOG = {
  // Groq Official Free Tier Models (Checked 2026-10-17)
  'qwen/qwen3.8-27b': {
    id: 'qwen/qwen3.8-27b',
    provider: 'groq',
    displayName: 'Qwen 3.8 27B',
    contextWindow: 32768,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 },
    isFree: true,
    priceEvidence: 'Groq official free tier rate limits table',
    source: 'https://console.groq.com/docs/rate-limits',
    checkedAt: '2026-10-17',
    dataPolicy: 'Inference content not retained by default (reliability/abuse exceptions)',
    eligibility: 'Groq developer account free tier',
    supportedParameters: ['tools', 'tool_choice', 'parallel_tool_calls', 'temperature', 'max_completion_tokens']
  },
  'openai/gpt-oss-120b': {
    id: 'openai/gpt-oss-120b',
    provider: 'groq',
    displayName: 'GPT-OSS 120B',
    contextWindow: 131072,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 },
    isFree: true,
    priceEvidence: 'Groq official free tier (30 RPM, 1000 RPD, 8000 TPM, 200k TPD)',
    source: 'https://console.groq.com/docs/rate-limits',
    checkedAt: '2026-10-17',
    dataPolicy: 'Inference content not retained by default (reliability/abuse exceptions)',
    eligibility: 'Groq developer account free tier',
    supportedParameters: ['tools', 'tool_choice', 'parallel_tool_calls', 'temperature', 'max_completion_tokens']
  },
  'openai/gpt-oss-20b': {
    id: 'openai/gpt-oss-20b',
    provider: 'groq',
    displayName: 'GPT-OSS 20B',
    contextWindow: 131072,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 },
    isFree: true,
    priceEvidence: 'Groq official free tier rate limits table',
    source: 'https://console.groq.com/docs/rate-limits',
    checkedAt: '2026-10-17',
    dataPolicy: 'Inference content not retained by default (reliability/abuse exceptions)',
    eligibility: 'Groq developer account free tier',
    supportedParameters: ['tools', 'tool_choice', 'parallel_tool_calls', 'temperature', 'max_completion_tokens']
  },

  // OpenCode Console Free Models (API slugs) (Checked 2026-10-17)
  'glm-5.3-flash-free': {
    id: 'glm-5.3-flash-free',
    provider: 'opencode',
    displayName: 'GLM-5.3-Flash Free',
    contextWindow: 32768,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 },
    isFree: true,
    priceEvidence: 'OpenCode Console models pricing documentation (free tier)',
    source: 'https://opencode.ai/v2/docs/console/models/',
    checkedAt: '2026-10-17',
    dataPolicy: 'Improvement use permitted under OpenCode free tier terms',
    eligibility: 'OpenCode Console registered free tier',
    supportedParameters: ['tools', 'tool_choice', 'temperature', 'max_tokens']
  },
  'deepseek-v4.1-flash-free': {
    id: 'deepseek-v4.1-flash-free',
    provider: 'opencode',
    displayName: 'DeepSeek V4.1 Flash Free',
    contextWindow: 65536,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 },
    isFree: true,
    priceEvidence: 'OpenCode Console models pricing documentation (free tier)',
    source: 'https://opencode.ai/v2/docs/console/models/',
    checkedAt: '2026-10-17',
    dataPolicy: 'Documented zero retention on selected models',
    eligibility: 'OpenCode Console registered free tier',
    supportedParameters: ['tools', 'tool_choice', 'temperature', 'max_tokens']
  },
  'space-bunny-free': {
    id: 'space-bunny-free',
    provider: 'opencode',
    displayName: 'Space Bunny Free',
    contextWindow: 32768,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 },
    isFree: true,
    priceEvidence: 'OpenCode Console models pricing documentation (free tier)',
    source: 'https://opencode.ai/v2/docs/console/models/',
    checkedAt: '2026-10-17',
    dataPolicy: 'Research and evaluation terms',
    eligibility: 'OpenCode Console registered free tier',
    supportedParameters: ['tools', 'tool_choice', 'temperature', 'max_tokens']
  },

  // OpenRouter Verified Pinned Free Models (Checked 2026-10-17)
  'meta-llama/llama-3.3-70b-instruct:free': {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    provider: 'openrouter',
    displayName: 'Llama 3.3 70B Instruct (Free)',
    contextWindow: 131072,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 },
    isFree: true,
    priceEvidence: 'OpenRouter :free variant routing ($0 / 1M tokens)',
    source: 'https://openrouter.ai/docs/api_reference/limits',
    checkedAt: '2026-10-17',
    dataPolicy: 'Subject to underlying provider privacy policy',
    eligibility: 'OpenRouter account free daily allowance',
    supportedParameters: ['tools', 'tool_choice', 'parallel_tool_calls', 'temperature', 'max_tokens']
  },
  'google/gemini-2.0-flash-exp:free': {
    id: 'google/gemini-2.0-flash-exp:free',
    provider: 'openrouter',
    displayName: 'Gemini 2.0 Flash Exp (Free)',
    contextWindow: 1048576,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 },
    isFree: true,
    priceEvidence: 'OpenRouter :free variant routing ($0 / 1M tokens)',
    source: 'https://openrouter.ai/docs/api_reference/limits',
    checkedAt: '2026-10-17',
    dataPolicy: 'Free tier terms; improvement use permitted by host',
    eligibility: 'OpenRouter account free daily allowance',
    supportedParameters: ['tools', 'tool_choice', 'parallel_tool_calls', 'temperature', 'max_tokens']
  },
  'qwen/qwen-2.5-72b-instruct:free': {
    id: 'qwen/qwen-2.5-72b-instruct:free',
    provider: 'openrouter',
    displayName: 'Qwen 2.5 72B Instruct (Free)',
    contextWindow: 32768,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 },
    isFree: true,
    priceEvidence: 'OpenRouter :free variant routing ($0 / 1M tokens)',
    source: 'https://openrouter.ai/docs/api_reference/limits',
    checkedAt: '2026-10-17',
    dataPolicy: 'Subject to host provider terms',
    eligibility: 'OpenRouter account free daily allowance',
    supportedParameters: ['tools', 'temperature', 'max_tokens']
  },
  'deepseek/deepseek-r1:free': {
    id: 'deepseek/deepseek-r1:free',
    provider: 'openrouter',
    displayName: 'DeepSeek R1 (Free)',
    contextWindow: 65536,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 },
    isFree: true,
    priceEvidence: 'OpenRouter :free variant routing ($0 / 1M tokens)',
    source: 'https://openrouter.ai/docs/api_reference/limits',
    checkedAt: '2026-10-17',
    dataPolicy: 'Subject to host provider terms',
    eligibility: 'OpenRouter account free daily allowance',
    supportedParameters: ['tools', 'temperature', 'max_tokens']
  },
  'cohere/north-mini-code:free': {
    id: 'cohere/north-mini-code:free',
    provider: 'openrouter',
    displayName: 'Cohere North Mini Code (Free)',
    contextWindow: 32768,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 },
    isFree: true,
    priceEvidence: 'OpenRouter :free variant routing ($0 / 1M tokens)',
    source: 'https://openrouter.ai/docs/api_reference/limits',
    checkedAt: '2026-10-17',
    dataPolicy: 'Subject to Cohere terms',
    eligibility: 'OpenRouter account free daily allowance',
    supportedParameters: ['tools', 'temperature', 'max_tokens']
  }
};

// Aliases for OpenCode display names / short slugs
const OPENCODE_SLUG_ALIASES = {
  'glm-5.3-flash': 'glm-5.3-flash-free',
  'glm-5.3-flash free': 'glm-5.3-flash-free',
  'deepseek-v4.1-flash': 'deepseek-v4.1-flash-free',
  'deepseek v4.1 flash free': 'deepseek-v4.1-flash-free',
  'space-bunny': 'space-bunny-free',
  'space bunny free': 'space-bunny-free'
};

/**
 * Normalizes OpenCode model identifiers to canonical API slugs.
 */
export function normalizeModelId(modelId, provider) {
  if (!modelId || typeof modelId !== 'string') return modelId;
  if (provider === 'opencode') {
    const lower = modelId.toLowerCase().trim();
    if (OPENCODE_SLUG_ALIASES[lower]) {
      return OPENCODE_SLUG_ALIASES[lower];
    }
  }
  return modelId.trim();
}

/**
 * Returns verified metadata for a model ID.
 * Returns null for any model not strictly registered with verified 0 pricing and capabilities.
 */
export function getModelMetadata(modelId, provider = null) {
  if (!modelId || typeof modelId !== 'string') return null;

  const normalizedId = normalizeModelId(modelId, provider);
  if (FREE_MODEL_CATALOG[normalizedId]) {
    const meta = FREE_MODEL_CATALOG[normalizedId];
    if (provider && meta.provider !== provider) return null;
    return { ...meta };
  }

  // Unknown models or unverified :free suffixes are NOT authorized.
  return null;
}

/**
 * Lists all known verified free models, optionally filtered by provider.
 */
export function listFreeModels(provider = null) {
  const models = Object.values(FREE_MODEL_CATALOG);
  if (!provider) return models.map(m => ({ ...m }));
  return models.filter(m => m.provider === provider).map(m => ({ ...m }));
}

/**
 * Validates that a provider, model, and endpoint strictly adhere to the Free-Only Routing Policy.
 * Throws FreeRoutingViolationError if any condition is not met.
 */
export function validateFreeRouting({ provider, model, endpoint }) {
  if (!provider || typeof provider !== 'string') {
    throw new FreeRoutingViolationError('Provider is required for free-only routing validation');
  }

  const normalizedProvider = provider.toLowerCase().trim();
  const approved = APPROVED_ENDPOINTS[normalizedProvider];
  if (!approved) {
    throw new FreeRoutingViolationError(`Unapproved provider '${provider}'. Approved providers are: groq, opencode, openrouter`);
  }

  // Endpoint validation: must be an approved endpoint for this provider
  if (endpoint) {
    const allowedUrls = Object.values(approved);
    if (!allowedUrls.includes(endpoint)) {
      throw new FreeRoutingViolationError(
        `Destination endpoint '${endpoint}' is not an approved destination for ${provider}. Approved endpoints: ${allowedUrls.join(', ')}`
      );
    }
  }

  // Model validation
  if (!model || typeof model !== 'string') {
    throw new FreeRoutingViolationError('Model ID is required for free-only routing validation');
  }

  const normalizedModel = normalizeModelId(model, normalizedProvider);
  const meta = getModelMetadata(normalizedModel, normalizedProvider);
  if (!meta) {
    throw new FreeRoutingViolationError(
      `Model '${model}' is not registered as a verified free model for ${provider}. Unknown models, arbitrary :free suffixes without verified metadata, or paid models are strictly prohibited.`
    );
  }

  if (!meta.isFree || meta.pricing.inputCostPerM !== 0 || meta.pricing.outputCostPerM !== 0) {
    throw new FreeRoutingViolationError(
      `Model '${model}' has non-zero pricing (input: ${meta.pricing.inputCostPerM}, output: ${meta.pricing.outputCostPerM}). Zero paid fallback policy violated.`
    );
  }

  if (normalizedProvider === 'openrouter' && !normalizedModel.endsWith(':free')) {
    throw new FreeRoutingViolationError(
      `OpenRouter model '${model}' must end with ':free' suffix to guarantee zero-cost routing.`
    );
  }

  return meta;
}
