/**
 * @file model-router.js
 * Capability-aware model router with automatic fallback ladder for ZETRO Universal Agent 2.0.
 *
 * Dynamically selects optimal models based on capability profiles (Level 1..4),
 * monitors operational health, and seamlessly fails over to backup models
 * upon timeouts, rate limits, or quota exhaustion.
 */

export class ModelRouterError extends Error {
  constructor(message, details = {}) {
    super(`[ModelRouter] ${message}`);
    this.name = 'ModelRouterError';
    this.details = details;
  }
}

/**
 * Creates an intelligent capability-aware ModelRouter.
 *
 * @param {Object} options
 * @param {import('@zetro/model-gateway').ModelProviderRegistry} options.registry
 * @param {string[]} [options.preferredOrder=[]] - Ordered list of preferred model IDs
 * @param {Function} [options.onModelSwitch] - Callback when router switches models during task
 * @param {number} [options.maxAttemptsPerModel=2]
 * @returns {ModelRouter}
 */
export function createModelRouter({
  registry,
  preferredOrder = [],
  onModelSwitch = null,
  maxAttemptsPerModel = 2
}) {
  if (!registry || typeof registry.listModels !== 'function') {
    throw new ModelRouterError('createModelRouter requires a valid ModelProviderRegistry instance');
  }

  // Track operational health per model
  const healthStats = new Map();

  function getModelStats(modelId) {
    if (!healthStats.has(modelId)) {
      healthStats.set(modelId, {
        attempts: 0,
        failures: 0,
        consecutiveFailures: 0,
        lastFailureTime: null,
        lastError: null
      });
    }
    return healthStats.get(modelId);
  }

  function recordSuccess(modelId) {
    const stats = getModelStats(modelId);
    stats.consecutiveFailures = 0;
  }

  function recordFailure(modelId, err) {
    const stats = getModelStats(modelId);
    stats.failures += 1;
    stats.consecutiveFailures += 1;
    stats.lastFailureTime = Date.now();
    stats.lastError = err?.message || String(err);
  }

  const LEVEL_RANK = {
    'level_1_native_computer_use': 1,
    'level_2_function_calling': 2,
    'level_3_structured_output': 3,
    'level_4_text_only': 4
  };

  function getLevelRank(lvl) {
    if (typeof lvl === 'number') return lvl;
    return LEVEL_RANK[lvl] || 4;
  }

  /**
   * Sorts candidate models by compatibility level, preference, and health.
   */
  function rankModels(models) {
    return [...models].sort((a, b) => {
      // 1. Compatibility level (Level 1 is best, Level 4 is least capable)
      const levelDiff = getLevelRank(a.compatibilityLevel) - getLevelRank(b.compatibilityLevel);
      if (levelDiff !== 0) return levelDiff;

      // 2. Preferred order
      const prefA = preferredOrder.indexOf(a.id);
      const prefB = preferredOrder.indexOf(b.id);
      if (prefA !== -1 && prefB !== -1) return prefA - prefB;
      if (prefA !== -1) return -1;
      if (prefB !== -1) return 1;

      // 3. Consecutive failures penalty
      const failuresA = getModelStats(a.id).consecutiveFailures;
      const failuresB = getModelStats(b.id).consecutiveFailures;
      return failuresA - failuresB;
    });
  }

  return {
    registry,

    /**
     * Resolves ordered ladder of candidate models satisfying requirements.
     */
    resolveCandidateLadder({ requiredCapabilities = ['vision'] } = {}) {
      const allEnabled = registry.listModels({ enabledOnly: true });
      const eligible = allEnabled.filter(m => {
        // Must satisfy all required capabilities
        return requiredCapabilities.every(cap => {
          const state = m.capabilities?.[cap];
          return state === 'verified' || state === 'reported';
        });
      });

      return rankModels(eligible);
    },

    /**
     * Executes proposal request across fallback ladder.
     *
     * @param {Object} proposalParams
     * @param {string} proposalParams.prompt
     * @param {Buffer} [proposalParams.screenshotBuffer]
     * @param {Array} [proposalParams.history]
     * @param {string[]} [proposalParams.requiredCapabilities=['vision']]
     * @returns {Promise<{ action: Object, modelId: string, usage: Object, rawResponse: any }>}
     */
    async proposeWithFallback({
      prompt,
      screenshotBuffer = null,
      history = [],
      requiredCapabilities = ['vision'],
      signal = null,
      ...rest
    }) {
      const candidates = this.resolveCandidateLadder({ requiredCapabilities });
      if (candidates.length === 0) {
        throw new ModelRouterError('No enabled models meet the required capabilities', {
          requiredCapabilities,
          availableCount: registry.listModels().length
        });
      }

      const errors = [];
      let previousModelId = null;

      for (const candidate of candidates) {
        const stats = getModelStats(candidate.id);
        // Skip models that have failed 3 or more times consecutively
        if (stats.consecutiveFailures >= 3) {
          continue;
        }

        const port = registry.getModel(candidate.id);
        if (!port) continue;

        if (previousModelId && previousModelId !== candidate.id) {
          if (typeof onModelSwitch === 'function') {
            try {
              onModelSwitch({
                from: previousModelId,
                to: candidate.id,
                reason: errors[errors.length - 1]?.message || 'Fallback failover'
              });
            } catch {
              // Ignore callback error
            }
          }
        }
        previousModelId = candidate.id;

        for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
          if (signal?.aborted) {
            throw new ModelRouterError('Proposal aborted by caller signal');
          }

          try {
            const proposal = await port.proposeAction({
              prompt,
              screenshotBuffer,
              history,
              signal,
              ...rest
            });

            recordSuccess(candidate.id);

            return {
              action: proposal.action,
              modelId: candidate.id,
              usage: proposal.usage,
              rawResponse: proposal.rawResponse
            };
          } catch (err) {
            recordFailure(candidate.id, err);
            errors.push({
              modelId: candidate.id,
              attempt,
              error: err.message
            });

            // If error is deterministic validation error, do not retry same model
            if (err.name === 'ComputerActionValidationError') {
              break;
            }
          }
        }
      }

      throw new ModelRouterError('All candidate models in fallback ladder failed', {
        attemptedCount: candidates.length,
        errors
      });
    },

    /**
     * Returns operational health statistics for all tracked models.
     */
    getHealth() {
      const result = {};
      for (const [id, stats] of healthStats.entries()) {
        result[id] = { ...stats };
      }
      return result;
    }
  };
}
