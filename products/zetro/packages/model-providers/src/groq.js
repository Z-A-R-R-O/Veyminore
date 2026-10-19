/**
 * Model Providers - Groq Adapter
 *
 * Groq official endpoint adapter with free-only model enforcement and live call gating.
 */

import { BaseOpenAICompatibleProvider } from './base.js';
import { APPROVED_ENDPOINTS } from './metadata.js';

export class GroqProvider extends BaseOpenAICompatibleProvider {
  constructor({
    apiKey = process.env.GROQ_API_KEY,
    model = 'qwen/qwen3.8-27b',
    endpoint = APPROVED_ENDPOINTS.groq.chat,
    modelsEndpoint = APPROVED_ENDPOINTS.groq.models,
    fetchImpl = globalThis.fetch,
    retryDelayMs = 400,
    allowLiveCalls = false,
    ...rest
  } = {}) {
    super({
      provider: 'groq',
      apiKey,
      model,
      endpoint,
      modelsEndpoint,
      fetchImpl,
      retryDelayMs,
      allowLiveCalls,
      ...rest
    });
  }
}
