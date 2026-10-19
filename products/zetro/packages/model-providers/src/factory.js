/**
 * Model Providers - Factory & Registry
 *
 * Instantiates verified free model providers with injected configurations.
 */

import { GroqProvider } from './groq.js';
import { OpenCodeProvider } from './opencode.js';
import { OpenRouterProvider } from './openrouter.js';
import { FreeRoutingViolationError } from './errors.js';

export function createModelProvider({
  provider,
  model,
  apiKey,
  fetchImpl = globalThis.fetch,
  retryDelayMs = 400,
  allowLiveCalls = false,
  transportPort = null,
  ...rest
}) {
  if (!provider || typeof provider !== 'string') {
    throw new FreeRoutingViolationError('A valid provider name is required');
  }

  const normalized = provider.toLowerCase().trim();

  switch (normalized) {
    case 'groq':
      return new GroqProvider({
        apiKey,
        model,
        fetchImpl,
        retryDelayMs,
        allowLiveCalls,
        ...rest
      });

    case 'opencode':
      return new OpenCodeProvider({
        apiKey,
        model,
        fetchImpl,
        retryDelayMs,
        allowLiveCalls,
        ...rest
      });

    case 'openrouter':
      return new OpenRouterProvider({
        apiKey,
        model,
        fetchImpl,
        retryDelayMs,
        allowLiveCalls,
        ...rest
      });

    default:
      throw new FreeRoutingViolationError(
        `Unsupported or unapproved provider '${provider}'. Supported free providers: groq, opencode, openrouter`
      );
  }
}
