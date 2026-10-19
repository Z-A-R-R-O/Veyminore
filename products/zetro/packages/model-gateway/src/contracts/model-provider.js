/**
 * @file model-provider.js
 * Model Provider Port contract and standard gateway error hierarchy.
 */

import { validateComputerAction } from './action-contract.js';
import { validateModelProfile } from './capabilities.js';

export class ModelGatewayError extends Error {
  constructor(message, details = {}) {
    super(`[ModelGateway] ${message}`);
    this.name = 'ModelGatewayError';
    this.details = details;
  }
}

export class ProviderTimeoutError extends ModelGatewayError {
  constructor(providerId, timeoutMs) {
    super(`Provider '${providerId}' timed out after ${timeoutMs}ms`, { providerId, timeoutMs });
    this.name = 'ProviderTimeoutError';
  }
}

export class QuotaExceededError extends ModelGatewayError {
  constructor(providerId, message) {
    super(`Provider '${providerId}' quota exceeded: ${message}`, { providerId });
    this.name = 'QuotaExceededError';
  }
}

export class CapabilityMismatchError extends ModelGatewayError {
  constructor(providerId, requiredCapability, actualState) {
    super(`Provider '${providerId}' does not satisfy required capability '${requiredCapability}' (state: ${actualState})`, {
      providerId,
      requiredCapability,
      actualState
    });
    this.name = 'CapabilityMismatchError';
  }
}

export class AdapterTranslationError extends ModelGatewayError {
  constructor(providerId, message, rawPayload) {
    super(`Provider '${providerId}' adapter failed to normalize response into ComputerAction: ${message}`, {
      providerId,
      rawPayload
    });
    this.name = 'AdapterTranslationError';
  }
}

/**
 * Creates a Model Provider Port instance enforcing the standard gateway lifecycle.
 *
 * @param {Object} spec
 * @param {Object} spec.profile Model capability profile
 * @param {Function} spec.proposeActionImpl Core proposal handler: ({ prompt, observation, history, tools, signal }) => Promise<{ action, raw, usage }>
 * @param {Function} [spec.testConnectionImpl] Optional connection probe handler
 * @returns {Object} ModelProviderPort instance
 */
export function createModelProviderPort(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new ModelGatewayError('Provider spec must be a non-null object');
  }

  const profile = validateModelProfile(spec.profile);

  if (typeof spec.proposeActionImpl !== 'function') {
    throw new ModelGatewayError("Provider spec requires a 'proposeActionImpl' function");
  }

  return {
    id: profile.id,
    profile,

    getProfile() {
      return { ...profile };
    },

    /**
     * Solicits a next action proposal from the model, normalizing it into a canonical ComputerAction.
     */
    async proposeAction({ prompt, observation, history = [], tools = [], messages, availableTools, expectedSchema, signal = null, ...rest } = {}) {
      if (!profile.enabled) {
        throw new ModelGatewayError(`Model provider '${profile.id}' is disabled`);
      }

      const startTime = Date.now();
      let result;
      try {
        result = await spec.proposeActionImpl({
          prompt,
          observation,
          history,
          tools: tools.length > 0 ? tools : availableTools,
          messages,
          availableTools,
          expectedSchema,
          signal,
          ...rest
        });
      } catch (err) {
        if (err instanceof ModelGatewayError) throw err;
        throw new ModelGatewayError(`Execution failed for provider '${profile.id}': ${err.message}`, { cause: err });
      }

      if (!result || !result.action) {
        throw new AdapterTranslationError(profile.id, 'Provider implementation returned no action payload', result);
      }

      // Strictly validate normalized ComputerAction against canonical contract
      const validatedAction = validateComputerAction(result.action);

      return {
        action: validatedAction,
        rawResponse: result.raw || null,
        usage: {
          promptTokens: result.usage?.promptTokens || 0,
          completionTokens: result.usage?.completionTokens || 0,
          durationMs: Date.now() - startTime,
          ...result.usage
        }
      };
    },

    /**
     * Executes a live connectivity and capability test.
     */
    async testConnection({ signal = null } = {}) {
      if (typeof spec.testConnectionImpl === 'function') {
        return await spec.testConnectionImpl({ signal });
      }

      return {
        ok: true,
        endpoint: profile.endpoint || 'cloud',
        latencyMs: 0,
        testedAt: Date.now()
      };
    }
  };
}
