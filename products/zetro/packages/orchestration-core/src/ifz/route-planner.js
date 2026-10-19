import { createHash, randomBytes } from 'node:crypto';
import {
  ROUTING_MODES,
  CANONICAL_EXECUTION_STRATEGIES,
  EXECUTION_STRATEGIES,
  DEFAULT_LIMITS,
  DEFAULT_MAX_STALENESS_MS,
  EFFECT_CLASSES,
  RouteValidationError,
  CapabilityMismatchError,
  AuthorityExpansionError,
  BudgetExceededError,
  CircularRouteError,
  DuplicateWorkerTaskError,
  WorkspaceMismatchError,
  WorkerUnavailableError,
  deepFreeze,
  hasCapability,
  normalizeStrategy,
  validateInputSafety,
  validateRoutePlan
} from './route-guard.js';

/**
 * Standard saved workflow templates supported out-of-the-box by IFZ.
 */
export const SAVED_WORKFLOW_TEMPLATES = Object.freeze({
  'standard-review-chain': Object.freeze({
    id: 'standard-review-chain',
    name: 'Standard Review Chain',
    strategy: 'review-chain',
    description: 'Two-stage chain: primary worker implements changes, followed by independent reviewer verification.',
    roles: Object.freeze([
      Object.freeze({
        roleId: 'implementer',
        requiredCapabilities: Object.freeze(['write']),
        dependsOn: Object.freeze([])
      }),
      Object.freeze({
        roleId: 'reviewer',
        requiredCapabilities: Object.freeze(['read']),
        dependsOn: Object.freeze(['implementer'])
      })
    ])
  }),

  'parallel-exploration': Object.freeze({
    id: 'parallel-exploration',
    name: 'Parallel Exploration',
    strategy: 'parallel',
    description: 'Concurrent exploration across multiple independent workers with no step dependencies.',
    roles: Object.freeze([
      Object.freeze({
        roleId: 'worker-1',
        requiredCapabilities: Object.freeze(['read']),
        dependsOn: Object.freeze([])
      }),
      Object.freeze({
        roleId: 'worker-2',
        requiredCapabilities: Object.freeze(['read']),
        dependsOn: Object.freeze([])
      })
    ])
  }),

  'dual-compare': Object.freeze({
    id: 'dual-compare',
    name: 'Dual Compare',
    strategy: 'compare',
    description: 'Two workers independently solve the task, followed by an arbiter step comparing the solutions.',
    roles: Object.freeze([
      Object.freeze({
        roleId: 'candidate-a',
        requiredCapabilities: Object.freeze(['read']),
        dependsOn: Object.freeze([])
      }),
      Object.freeze({
        roleId: 'candidate-b',
        requiredCapabilities: Object.freeze(['read']),
        dependsOn: Object.freeze([])
      }),
      Object.freeze({
        roleId: 'comparator',
        requiredCapabilities: Object.freeze(['read']),
        dependsOn: Object.freeze(['candidate-a', 'candidate-b'])
      })
    ])
  }),

  'first-verified': Object.freeze({
    id: 'first-verified',
    name: 'First Verified Result',
    strategy: 'first-verified',
    description: 'Multiple parallel candidate workers compete; first result verified by checks is accepted.',
    roles: Object.freeze([
      Object.freeze({
        roleId: 'candidate-1',
        requiredCapabilities: Object.freeze(['read']),
        dependsOn: Object.freeze([])
      }),
      Object.freeze({
        roleId: 'candidate-2',
        requiredCapabilities: Object.freeze(['read']),
        dependsOn: Object.freeze([])
      })
    ])
  }),

  'sequential-pipeline': Object.freeze({
    id: 'sequential-pipeline',
    name: 'Sequential Pipeline',
    strategy: 'sequential',
    description: 'Ordered multi-stage pipeline executing strictly sequentially.',
    roles: Object.freeze([
      Object.freeze({
        roleId: 'stage-1',
        requiredCapabilities: Object.freeze(['read']),
        dependsOn: Object.freeze([])
      }),
      Object.freeze({
        roleId: 'stage-2',
        requiredCapabilities: Object.freeze(['read']),
        dependsOn: Object.freeze(['stage-1'])
      })
    ])
  }),

  'bounded-delegation': Object.freeze({
    id: 'bounded-delegation',
    name: 'Bounded Delegation',
    strategy: 'bounded-delegation',
    description: 'Single lead worker granted bounded delegation authority under strict depth and budget ceilings.',
    roles: Object.freeze([
      Object.freeze({
        roleId: 'lead',
        requiredCapabilities: Object.freeze(['read']),
        dependsOn: Object.freeze([])
      })
    ])
  })
});

/**
 * Normalizes manifests from various container types (Map, Array, Object, WorkerRegistry) into an Array.
 * @param {any} manifests
 * @returns {Array<Object>}
 */
export function normalizeManifests(manifests) {
  if (!manifests) return [];
  if (typeof manifests.list === 'function') {
    return manifests.list();
  }
  if (manifests instanceof Map) {
    return Array.from(manifests.values());
  }
  if (Array.isArray(manifests)) {
    return manifests;
  }
  if (typeof manifests === 'object') {
    return Object.values(manifests);
  }
  return [];
}

/**
 * Helper to generate unique identifiers.
 * @param {string} prefix
 * @returns {string}
 */
function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

/**
 * Computes deterministic SHA-256 integrity hash for a route plan.
 * Omits existing routeHash to ensure idempotent computation.
 *
 * @param {Object} plan
 * @returns {string} SHA-256 hex digest
 */
export function computeRouteHash(plan) {
  const canonicalData = {
    routeId: plan.routeId,
    runId: plan.runId,
    conversationId: plan.conversationId,
    projectId: plan.projectId,
    workspaceId: plan.workspaceId,
    mode: plan.mode,
    strategy: plan.strategy,
    steps: (plan.steps || []).map(s => ({
      stepId: s.stepId,
      stepIndex: s.stepIndex,
      workerId: s.workerId,
      taskId: s.taskId,
      depth: s.depth,
      dependsOn: [...(s.dependsOn || [])].sort(),
      requiredCapabilities: [...(s.requiredCapabilities || [])].sort()
    })),
    limits: {
      maxWorkers: plan.limits?.maxWorkers,
      maxActiveBranches: plan.limits?.maxActiveBranches,
      maxDelegationDepth: plan.limits?.maxDelegationDepth
    },
    authority: {
      effectClasses: [...(plan.authority?.effectClasses || [])].sort(),
      allowedPaths: [...(plan.authority?.allowedPaths || [])].sort(),
      writePaths: [...(plan.authority?.writePaths || [])].sort()
    },
    budget: {
      timeBudgetMs: plan.budget?.timeBudgetMs,
      tokenBudget: plan.budget?.tokenBudget,
      maxProviderAttempts: plan.budget?.maxProviderAttempts
    }
  };

  return createHash('sha256')
    .update(JSON.stringify(canonicalData))
    .digest('hex');
}

/**
 * Selects candidate workers from supplied manifests matching capability, workspace, and project criteria.
 * Prioritizes available and idle workers over busy ones, and rejects unavailable, offline, unqualified, or stale workers.
 *
 * @param {Array<Object>} manifestList
 * @param {Object} criteria
 * @param {string} criteria.workspaceId
 * @param {string} criteria.projectId
 * @param {string[]} [criteria.requiredCapabilities=[]]
 * @param {Set<string>} [criteria.excludeWorkerIds=new Set()]
 * @param {number} [criteria.maxStalenessMs=DEFAULT_MAX_STALENESS_MS]
 * @param {number} [criteria.now=Date.now()]
 * @returns {Object|null} Best matching worker manifest or null
 */
export function findMatchingWorker(manifestList, criteria = {}) {
  const {
    workspaceId,
    projectId,
    requiredCapabilities = [],
    excludeWorkerIds = new Set(),
    maxStalenessMs = DEFAULT_MAX_STALENESS_MS,
    now = Date.now()
  } = criteria;

  const validStatusOrder = { available: 1, idle: 2, running: 3, busy: 4 };

  const candidates = manifestList.filter(m => {
    if (excludeWorkerIds.has(m.workerId)) return false;
    if (m.workspaceId !== workspaceId) return false;
    if (m.projectId !== projectId) return false;

    // Check availability
    const status = m.availability?.status || 'available';
    if (status === 'unavailable' || status === 'offline') return false;

    // Check freshness
    if (m.isStale === true || m.availability?.isStale === true) return false;
    const observedAt = m.availability?.observedAt;
    if (typeof observedAt === 'number' && observedAt > 0) {
      if (now - observedAt > maxStalenessMs) return false;
    }

    // Check qualification
    if (m.isQualified === false) return false;
    if (m.qualification) {
      const q = typeof m.qualification === 'object' ? m.qualification.status : m.qualification;
      if (q === 'unqualified' || q === 'failed' || q === 'rejected') return false;
    }

    // Check all required capabilities
    for (const req of requiredCapabilities) {
      if (!hasCapability(m, req)) return false;
    }
    return true;
  });

  if (candidates.length === 0) return null;

  // Sort by availability status precedence
  candidates.sort((a, b) => {
    const statusA = a.availability?.status || 'available';
    const statusB = b.availability?.status || 'available';
    const rankA = validStatusOrder[statusA] || 99;
    const rankB = validStatusOrder[statusB] || 99;
    return rankA - rankB;
  });

  return candidates[0];
}

/**
 * Pure offline Route Planner.
 *
 * Supports:
 * - Modes: 'manual', 'automatic', 'saved-workflow'
 * - Strategies: 'parallel', 'sequential', 'review-chain', 'first-verified', 'compare', 'bounded-delegation'
 * - Strict limits, capability qualification, authority monotonicity, and budget checks.
 *
 * Automatic mode returns a proposal only and cannot dispatch.
 * Manual mode preserves exact user destinations.
 *
 * @param {Object} request Route planning request
 * @param {Object} [options] Planning options
 * @param {any} [options.manifests] Registry manifests (Map, Array, Object, or WorkerRegistry)
 * @param {Object} [options.parentEnvelope] Parent task envelope when creating a child delegation route
 * @param {any[]} [options.delegationChain=[]] Delegation chain ancestor IDs or objects
 * @returns {Readonly<Object>} Fully validated and deeply frozen RoutePlan
 */
export function planRoute(request, options = {}) {
  validateInputSafety(request);

  const {
    routeId = generateId('route'),
    runId = options.parentEnvelope?.runId || generateId('run'),
    conversationId = options.parentEnvelope?.conversationId || generateId('conv'),
    projectId = options.parentEnvelope?.projectId,
    workspaceId = options.parentEnvelope?.workspaceId,
    mode = 'automatic',
    strategy: requestedStrategy,
    prompt = '',
    templateId,
    destinations = [],
    requiredCapabilities = [],
    limits = {},
    authority: requestedAuthority,
    budget: requestedBudget,
    context: requestedContext
  } = request;

  if (!projectId || typeof projectId !== 'string') {
    throw new RouteValidationError('projectId must be a non-empty string');
  }
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new RouteValidationError('workspaceId must be a non-empty string');
  }
  if (!ROUTING_MODES.includes(mode)) {
    throw new RouteValidationError(`Invalid routing mode '${mode}'. Supported: ${ROUTING_MODES.join(', ')}`);
  }

  const manifestList = normalizeManifests(options.manifests);
  const manifestMap = new Map(manifestList.map(m => [m.workerId, m]));

  // Combine limits with defaults
  const effectiveLimits = {
    ...DEFAULT_LIMITS,
    ...(options.parentEnvelope?.limits || {}),
    ...limits
  };

  // Determine authority (child cannot expand parent)
  let effectiveAuthority;
  if (requestedAuthority) {
    effectiveAuthority = {
      effectClasses: requestedAuthority.effectClasses
        ? [...requestedAuthority.effectClasses]
        : (options.parentEnvelope?.authority?.effectClasses || [...EFFECT_CLASSES]),
      allowedPaths: requestedAuthority.allowedPaths
        ? [...requestedAuthority.allowedPaths]
        : (options.parentEnvelope?.authority?.allowedPaths || ['.']),
      writePaths: requestedAuthority.writePaths
        ? [...requestedAuthority.writePaths]
        : (options.parentEnvelope?.authority?.writePaths || ['.'])
    };
  } else if (options.parentEnvelope?.authority) {
    effectiveAuthority = {
      effectClasses: [...options.parentEnvelope.authority.effectClasses],
      allowedPaths: [...(options.parentEnvelope.authority.allowedPaths || ['.'])],
      writePaths: [...(options.parentEnvelope.authority.writePaths || ['.'])]
    };
  } else {
    effectiveAuthority = {
      effectClasses: [...EFFECT_CLASSES],
      allowedPaths: ['.'],
      writePaths: ['.']
    };
  }

  // Determine budget (child cannot exceed parent)
  let effectiveBudget;
  if (requestedBudget) {
    effectiveBudget = {
      timeBudgetMs: requestedBudget.timeBudgetMs ?? options.parentEnvelope?.budget?.timeBudgetMs ?? effectiveLimits.timeBudgetMs,
      tokenBudget: requestedBudget.tokenBudget ?? options.parentEnvelope?.budget?.tokenBudget ?? effectiveLimits.tokenBudget,
      maxProviderAttempts: requestedBudget.maxProviderAttempts ?? options.parentEnvelope?.budget?.maxProviderAttempts ?? effectiveLimits.maxProviderAttempts
    };
  } else if (options.parentEnvelope?.budget) {
    effectiveBudget = {
      timeBudgetMs: options.parentEnvelope.budget.timeBudgetMs,
      tokenBudget: options.parentEnvelope.budget.tokenBudget,
      maxProviderAttempts: options.parentEnvelope.budget.maxProviderAttempts
    };
  } else {
    effectiveBudget = {
      timeBudgetMs: effectiveLimits.timeBudgetMs,
      tokenBudget: effectiveLimits.tokenBudget,
      maxProviderAttempts: effectiveLimits.maxProviderAttempts
    };
  }

  let finalStrategy = requestedStrategy;
  let steps = [];

  // ==========================================
  // MODE: manual
  // ==========================================
  if (mode === 'manual') {
    if (!Array.isArray(destinations) || destinations.length === 0) {
      throw new RouteValidationError('Manual routing mode requires non-empty destinations array');
    }

    if (!finalStrategy) {
      finalStrategy = destinations.length > 1 ? 'sequential' : 'parallel';
    }

    const canonicalStrat = normalizeStrategy(finalStrategy);
    if (!canonicalStrat) {
      throw new RouteValidationError(
        `Unsupported execution strategy '${finalStrategy}'. Supported: ${CANONICAL_EXECUTION_STRATEGIES.join(', ')}`
      );
    }
    finalStrategy = canonicalStrat;

    const stepIdList = [];
    for (let i = 0; i < destinations.length; i++) {
      const dest = destinations[i];
      const isObject = typeof dest === 'object' && dest !== null;
      const workerId = isObject ? dest.workerId : dest;
      const stepId = isObject && dest.stepId ? dest.stepId : `step_${i + 1}`;
      const taskId = isObject && dest.taskId ? dest.taskId : `task_${routeId}_${i + 1}`;
      const stepCaps = isObject && Array.isArray(dest.requiredCapabilities)
        ? dest.requiredCapabilities
        : requiredCapabilities;

      stepIdList.push(stepId);

      let stepDependsOn = [];
      if (isObject && Array.isArray(dest.dependsOn)) {
        stepDependsOn = [...dest.dependsOn];
      } else {
        // Derive default dependencies based on strategy
        if (finalStrategy === 'sequential') {
          if (i > 0) stepDependsOn = [stepIdList[i - 1]];
        } else if (finalStrategy === 'review-chain') {
          if (i > 0) stepDependsOn = [stepIdList[i - 1]];
        } else if (finalStrategy === 'compare') {
          if (i === destinations.length - 1 && destinations.length > 1) {
            stepDependsOn = stepIdList.slice(0, destinations.length - 1);
          }
        }
      }

      const manifest = manifestMap.get(workerId);
      const workerType = manifest?.workerType || (isObject ? dest.workerType : 'unknown-worker');
      const adapterId = manifest?.adapterId || (isObject ? dest.adapterId : 'unknown-adapter');
      const depth = (options.parentEnvelope?.depth ?? -1) + 1;

      steps.push({
        stepId,
        stepIndex: i,
        workerId,
        workerType,
        adapterId,
        taskId,
        depth,
        dependsOn: stepDependsOn,
        requiredCapabilities: stepCaps,
        prompt: isObject && dest.prompt ? dest.prompt : prompt
      });
    }
  }

  // ==========================================
  // MODE: saved-workflow
  // ==========================================
  else if (mode === 'saved-workflow') {
    if (!templateId || typeof templateId !== 'string') {
      throw new RouteValidationError('Saved-workflow routing mode requires a templateId string');
    }

    const template = SAVED_WORKFLOW_TEMPLATES[templateId] || request.template;
    if (!template) {
      throw new RouteValidationError(
        `Saved workflow template '${templateId}' not found. Available: ${Object.keys(SAVED_WORKFLOW_TEMPLATES).join(', ')}`
      );
    }

    const canonicalStrat = normalizeStrategy(template.strategy);
    if (!canonicalStrat) {
      throw new RouteValidationError(`Invalid template strategy: '${template.strategy}'`);
    }
    finalStrategy = canonicalStrat;

    const assignedWorkers = new Set();
    const roleToStepId = new Map();
    const depth = (options.parentEnvelope?.depth ?? -1) + 1;

    // First pass: assign stepIds
    template.roles.forEach((role, idx) => {
      roleToStepId.set(role.roleId, `step_${idx + 1}`);
    });

    for (let i = 0; i < template.roles.length; i++) {
      const role = template.roles[i];
      const stepId = roleToStepId.get(role.roleId);
      const taskId = `task_${routeId}_${i + 1}`;
      const roleCaps = [...(role.requiredCapabilities || []), ...requiredCapabilities];

      // Explicit destination override for this role or automatic matching
      let assignedWorkerId = null;
      if (Array.isArray(destinations) && destinations[i]) {
        assignedWorkerId = typeof destinations[i] === 'object' ? destinations[i].workerId : destinations[i];
      }

      if (!assignedWorkerId) {
        const matched = findMatchingWorker(manifestList, {
          workspaceId,
          projectId,
          requiredCapabilities: roleCaps,
          excludeWorkerIds: assignedWorkers,
          maxStalenessMs: options.maxStalenessMs,
          now: options.now
        }) || findMatchingWorker(manifestList, {
          workspaceId,
          projectId,
          requiredCapabilities: roleCaps,
          maxStalenessMs: options.maxStalenessMs,
          now: options.now
        });

        if (!matched) {
          throw new CapabilityMismatchError(
            `No available worker in workspace '${workspaceId}' satisfies role '${role.roleId}' with capabilities [${roleCaps.join(', ')}]`,
            { roleId: role.roleId, requiredCapabilities: roleCaps, workspaceId }
          );
        }
        assignedWorkerId = matched.workerId;
      }

      assignedWorkers.add(assignedWorkerId);
      const manifest = manifestMap.get(assignedWorkerId);

      // Map role dependencies to stepIds
      const stepDependsOn = (role.dependsOn || []).map(depRole => {
        return roleToStepId.get(depRole) || depRole;
      });

      steps.push({
        stepId,
        stepIndex: i,
        workerId: assignedWorkerId,
        workerType: manifest?.workerType || 'workflow-worker',
        adapterId: manifest?.adapterId || 'workflow-adapter',
        taskId,
        depth,
        dependsOn: stepDependsOn,
        requiredCapabilities: roleCaps,
        prompt
      });
    }
  }

  // ==========================================
  // MODE: automatic (PROPOSAL ONLY)
  // ==========================================
  else if (mode === 'automatic') {
    if (!finalStrategy) {
      if (requiredCapabilities.includes('write')) {
        finalStrategy = 'review-chain';
      } else {
        finalStrategy = 'sequential';
      }
    }

    const canonicalStrat = normalizeStrategy(finalStrategy);
    if (!canonicalStrat) {
      throw new RouteValidationError(
        `Unsupported execution strategy '${finalStrategy}'. Supported: ${CANONICAL_EXECUTION_STRATEGIES.join(', ')}`
      );
    }
    finalStrategy = canonicalStrat;

    const depth = (options.parentEnvelope?.depth ?? -1) + 1;

    if (finalStrategy === 'review-chain') {
      // 2 steps: Implementer -> Reviewer
      const implCaps = requiredCapabilities.length > 0 ? requiredCapabilities : ['write'];
      const implWorker = findMatchingWorker(manifestList, {
        workspaceId,
        projectId,
        requiredCapabilities: implCaps,
        maxStalenessMs: options.maxStalenessMs,
        now: options.now
      });

      if (!implWorker) {
        throw new CapabilityMismatchError(
          `Automatic proposal failed: no worker in workspace '${workspaceId}' satisfies implementation capabilities [${implCaps.join(', ')}]`,
          { requiredCapabilities: implCaps, workspaceId }
        );
      }

      const reviewCaps = ['read'];
      // Try to find an independent reviewer worker distinct from implementer
      const reviewWorker = findMatchingWorker(manifestList, {
        workspaceId,
        projectId,
        requiredCapabilities: reviewCaps,
        excludeWorkerIds: new Set([implWorker.workerId]),
        maxStalenessMs: options.maxStalenessMs,
        now: options.now
      }) || findMatchingWorker(manifestList, {
        workspaceId,
        projectId,
        requiredCapabilities: reviewCaps,
        maxStalenessMs: options.maxStalenessMs,
        now: options.now
      });

      if (!reviewWorker) {
        throw new CapabilityMismatchError(
          `Automatic proposal failed: no worker in workspace '${workspaceId}' satisfies review capabilities [${reviewCaps.join(', ')}]`,
          { requiredCapabilities: reviewCaps, workspaceId }
        );
      }

      steps.push({
        stepId: 'step_1',
        stepIndex: 0,
        workerId: implWorker.workerId,
        workerType: implWorker.workerType,
        adapterId: implWorker.adapterId,
        taskId: `task_${routeId}_1`,
        depth,
        dependsOn: [],
        requiredCapabilities: implCaps,
        prompt
      });

      steps.push({
        stepId: 'step_2',
        stepIndex: 1,
        workerId: reviewWorker.workerId,
        workerType: reviewWorker.workerType,
        adapterId: reviewWorker.adapterId,
        taskId: `task_${routeId}_2`,
        depth,
        dependsOn: ['step_1'],
        requiredCapabilities: reviewCaps,
        prompt
      });
    }

    else if (finalStrategy === 'compare') {
      // Two candidates in parallel + one comparator
      const candWorkerA = findMatchingWorker(manifestList, {
        workspaceId,
        projectId,
        requiredCapabilities,
        maxStalenessMs: options.maxStalenessMs,
        now: options.now
      });
      if (!candWorkerA) {
        throw new CapabilityMismatchError(
          `Automatic proposal failed: no candidate worker found for compare strategy in workspace '${workspaceId}'`
        );
      }

      const candWorkerB = findMatchingWorker(manifestList, {
        workspaceId,
        projectId,
        requiredCapabilities,
        excludeWorkerIds: new Set([candWorkerA.workerId]),
        maxStalenessMs: options.maxStalenessMs,
        now: options.now
      }) || candWorkerA;

      const compWorker = findMatchingWorker(manifestList, {
        workspaceId,
        projectId,
        requiredCapabilities: ['read'],
        excludeWorkerIds: new Set([candWorkerA.workerId, candWorkerB.workerId]),
        maxStalenessMs: options.maxStalenessMs,
        now: options.now
      }) || candWorkerA;

      steps.push({
        stepId: 'step_1',
        stepIndex: 0,
        workerId: candWorkerA.workerId,
        workerType: candWorkerA.workerType,
        adapterId: candWorkerA.adapterId,
        taskId: `task_${routeId}_1`,
        depth,
        dependsOn: [],
        requiredCapabilities,
        prompt
      });

      steps.push({
        stepId: 'step_2',
        stepIndex: 1,
        workerId: candWorkerB.workerId,
        workerType: candWorkerB.workerType,
        adapterId: candWorkerB.adapterId,
        taskId: `task_${routeId}_2`,
        depth,
        dependsOn: [],
        requiredCapabilities,
        prompt
      });

      steps.push({
        stepId: 'step_3',
        stepIndex: 2,
        workerId: compWorker.workerId,
        workerType: compWorker.workerType,
        adapterId: compWorker.adapterId,
        taskId: `task_${routeId}_3`,
        depth,
        dependsOn: ['step_1', 'step_2'],
        requiredCapabilities: ['read'],
        prompt
      });
    }

    else if (finalStrategy === 'first-verified') {
      // Multiple candidates in parallel
      const candWorkerA = findMatchingWorker(manifestList, {
        workspaceId,
        projectId,
        requiredCapabilities,
        maxStalenessMs: options.maxStalenessMs,
        now: options.now
      });
      if (!candWorkerA) {
        throw new CapabilityMismatchError(
          `Automatic proposal failed: no worker found in workspace '${workspaceId}' for first-verified strategy`
        );
      }

      const candWorkerB = findMatchingWorker(manifestList, {
        workspaceId,
        projectId,
        requiredCapabilities,
        excludeWorkerIds: new Set([candWorkerA.workerId]),
        maxStalenessMs: options.maxStalenessMs,
        now: options.now
      }) || candWorkerA;

      steps.push({
        stepId: 'step_1',
        stepIndex: 0,
        workerId: candWorkerA.workerId,
        workerType: candWorkerA.workerType,
        adapterId: candWorkerA.adapterId,
        taskId: `task_${routeId}_1`,
        depth,
        dependsOn: [],
        requiredCapabilities,
        prompt
      });

      steps.push({
        stepId: 'step_2',
        stepIndex: 1,
        workerId: candWorkerB.workerId,
        workerType: candWorkerB.workerType,
        adapterId: candWorkerB.adapterId,
        taskId: `task_${routeId}_2`,
        depth,
        dependsOn: [],
        requiredCapabilities,
        prompt
      });
    }

    else {
      // Default: parallel, sequential, or bounded-delegation with single worker
      const primaryWorker = findMatchingWorker(manifestList, {
        workspaceId,
        projectId,
        requiredCapabilities,
        maxStalenessMs: options.maxStalenessMs,
        now: options.now
      });

      if (!primaryWorker) {
        throw new CapabilityMismatchError(
          `Automatic proposal failed: no worker in workspace '${workspaceId}' satisfies capabilities [${requiredCapabilities.join(', ')}]`,
          { requiredCapabilities, workspaceId }
        );
      }

      steps.push({
        stepId: 'step_1',
        stepIndex: 0,
        workerId: primaryWorker.workerId,
        workerType: primaryWorker.workerType,
        adapterId: primaryWorker.adapterId,
        taskId: `task_${routeId}_1`,
        depth,
        dependsOn: [],
        requiredCapabilities,
        prompt
      });
    }
  }

  // Assemble unhashed plan candidate
  const planCandidate = {
    routeId,
    runId,
    conversationId,
    projectId,
    workspaceId,
    mode,
    strategy: finalStrategy,
    isProposal: mode === 'automatic',
    status: mode === 'automatic' ? 'proposed' : 'planned',
    createdAt: Date.now(),
    steps,
    limits: effectiveLimits,
    authority: effectiveAuthority,
    budget: effectiveBudget
  };

  if (requestedContext || options.parentEnvelope?.context) {
    planCandidate.context = requestedContext || options.parentEnvelope.context;
  }

  if (prompt) {
    planCandidate.prompt = prompt;
  }

  // Compute integrity hash
  const routeHash = computeRouteHash(planCandidate);
  planCandidate.routeHash = routeHash;

  // Validate the plan against route guard controls
  return validateRoutePlan(planCandidate, {
    manifests: manifestMap,
    parentEnvelope: options.parentEnvelope,
    delegationChain: options.delegationChain || [],
    now: options.now,
    maxStalenessMs: options.maxStalenessMs
  });
}

/**
 * Revalidates a saved workflow route plan against live worker manifests at use time.
 * Verifies that all assigned workers still exist, are fresh, qualified, available, and meet capabilities.
 *
 * @param {Object} plan RoutePlan to revalidate
 * @param {Object} options Revalidation options (manifests, now, maxStalenessMs)
 * @returns {Readonly<Object>} Revalidated frozen plan
 */
export function revalidateSavedWorkflow(plan, options = {}) {
  if (!plan || typeof plan !== 'object') {
    throw new RouteValidationError('Plan to revalidate must be a non-null object');
  }
  if (plan.mode !== 'saved-workflow') {
    throw new RouteValidationError(`revalidateSavedWorkflow expected mode 'saved-workflow', got '${plan.mode}'`);
  }
  return validateRoutePlan(plan, {
    manifests: options.manifests,
    parentEnvelope: options.parentEnvelope,
    delegationChain: options.delegationChain,
    now: options.now,
    maxStalenessMs: options.maxStalenessMs,
    requireAvailable: true
  });
}

/**
 * Creates a public sanitized preview of a RoutePlan for display on Work/Runs pages.
 *
 * PURE EXPLICIT ALLOWLIST ONLY:
 * Never copies then redacts. Extracts only safe scalar attributes and allowed structural metadata.
 * Guaranteed to NEVER leak:
 * - Prompt text or user objective details
 * - Private reasoning or internal chain-of-thought
 * - Authentication tokens, passwords, API keys, or secrets
 * - File contents, buffers, or diff bodies
 *
 * @param {Object} plan Validated RoutePlan
 * @returns {Readonly<Object>} Deeply frozen public route preview
 */
export function createRoutePreview(plan) {
  validateInputSafety(plan);

  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const uniqueWorkers = new Set();
  let rootStepCount = 0;
  let maxStepDepth = 0;

  const sanitizedSteps = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s && typeof s === 'object') {
      if (s.workerId) uniqueWorkers.add(s.workerId);
      const isRoot = !s.dependsOn || s.dependsOn.length === 0;
      if (isRoot) rootStepCount++;
      const d = typeof s.depth === 'number' ? s.depth : 0;
      if (d > maxStepDepth) maxStepDepth = d;

      // EXPLICIT ALLOWLIST ONLY: Never copy/spread `s`
      sanitizedSteps.push(Object.freeze({
        stepId: typeof s.stepId === 'string' ? s.stepId : `step_${i + 1}`,
        stepIndex: typeof s.stepIndex === 'number' ? s.stepIndex : i,
        workerId: typeof s.workerId === 'string' ? s.workerId : '',
        workerType: typeof s.workerType === 'string' ? s.workerType : '',
        adapterId: typeof s.adapterId === 'string' ? s.adapterId : '',
        taskId: typeof s.taskId === 'string' ? s.taskId : '',
        depth: d,
        dependsOn: Array.isArray(s.dependsOn) ? Object.freeze([...s.dependsOn]) : Object.freeze([]),
        requiredCapabilities: Array.isArray(s.requiredCapabilities)
          ? Object.freeze([...s.requiredCapabilities])
          : Object.freeze([])
      }));
    }
  }

  // EXPLICIT ALLOWLIST ONLY: Never copy/spread `plan`
  const preview = {
    routeId: typeof plan.routeId === 'string' ? plan.routeId : '',
    runId: typeof plan.runId === 'string' ? plan.runId : '',
    conversationId: typeof plan.conversationId === 'string' ? plan.conversationId : '',
    projectId: typeof plan.projectId === 'string' ? plan.projectId : '',
    workspaceId: typeof plan.workspaceId === 'string' ? plan.workspaceId : '',
    mode: typeof plan.mode === 'string' ? plan.mode : 'automatic',
    strategy: typeof plan.strategy === 'string' ? plan.strategy : 'sequential',
    isProposal: plan.isProposal === true,
    createdAt: typeof plan.createdAt === 'number' ? plan.createdAt : 0,
    routeHash: typeof plan.routeHash === 'string' ? plan.routeHash : '',
    stepCount: sanitizedSteps.length,
    limits: Object.freeze({
      maxWorkers: plan.limits?.maxWorkers ?? DEFAULT_LIMITS.maxWorkers,
      maxActiveBranches: plan.limits?.maxActiveBranches ?? DEFAULT_LIMITS.maxActiveBranches,
      maxDelegationDepth: plan.limits?.maxDelegationDepth ?? DEFAULT_LIMITS.maxDelegationDepth
    }),
    authority: Object.freeze({
      effectClasses: Array.isArray(plan.authority?.effectClasses)
        ? Object.freeze([...plan.authority.effectClasses])
        : Object.freeze([]),
      allowedPathCount: Array.isArray(plan.authority?.allowedPaths) ? plan.authority.allowedPaths.length : 0,
      writePathCount: Array.isArray(plan.authority?.writePaths) ? plan.authority.writePaths.length : 0
    }),
    budget: Object.freeze({
      timeBudgetMs: typeof plan.budget?.timeBudgetMs === 'number' ? plan.budget.timeBudgetMs : null,
      tokenBudget: typeof plan.budget?.tokenBudget === 'number' ? plan.budget.tokenBudget : null,
      maxProviderAttempts: typeof plan.budget?.maxProviderAttempts === 'number' ? plan.budget.maxProviderAttempts : null
    }),
    steps: Object.freeze(sanitizedSteps),
    summary: Object.freeze({
      totalWorkers: sanitizedSteps.length,
      uniqueWorkers: uniqueWorkers.size,
      activeBranches: rootStepCount,
      maxDepth: maxStepDepth
    })
  };

  return Object.freeze(preview);
}
