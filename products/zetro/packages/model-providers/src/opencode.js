/**
 * Model Providers - OpenCode Console Adapter
 *
 * OpenCode Console adapter with free model slug allowlist and data policy adherence.
 */

import { BaseOpenAICompatibleProvider } from './base.js';
import { APPROVED_ENDPOINTS, normalizeModelId } from './metadata.js';

export class OpenCodeProvider extends BaseOpenAICompatibleProvider {
  constructor({
    apiKey = process.env.OPENCODE_API_KEY,
    model = 'deepseek-v4.1-flash-free',
    endpoint = APPROVED_ENDPOINTS.opencode.chat,
    modelsEndpoint = APPROVED_ENDPOINTS.opencode.models,
    fetchImpl = globalThis.fetch,
    retryDelayMs = 400,
    allowLiveCalls = false,
    ...rest
  } = {}) {
    const normalizedModel = normalizeModelId(model, 'opencode');
    super({
      provider: 'opencode',
      apiKey,
      model: normalizedModel,
      endpoint,
      modelsEndpoint,
      fetchImpl,
      retryDelayMs,
      allowLiveCalls,
      ...rest
    });
  }
}
