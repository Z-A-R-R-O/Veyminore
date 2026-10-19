import { createHash } from 'node:crypto';

export const ROUTING_MODES = Object.freeze(['manual', 'automatic', 'saved-workflow']);

export const CANONICAL_EXECUTION_STRATEGIES = Object.freeze([
  'parallel',
  'sequential',
  'review-chain',
  'first-verified',
  'compare',
  'bounded-delegation'
]);

export const STRATEGY_ALIASES = Object.freeze({
  'review_chain': 'review-chain',
  'first_verified': 'first-verified',
  'compare_results': 'compare',
  'bounded_delegation': 'bounded-delegation'
});

export const EXECUTION_STRATEGIES = Object.freeze([
  ...CANONICAL_EXECUTION_STRATEGIES,
  'review_chain',
  'first_verified',
  'compare_results',
  'bounded_delegation'
]);

/**
 * Normalizes an execution strategy to its canonical identifier.
 * @param {string} strategy
 * @returns {string|null} Canonical strategy or null if invalid
 */
export function normalizeStrategy(strategy) {
  if (!strategy || typeof strategy !== 'string') return null;
  const canonical = STRATEGY_ALIASES[strategy] || strategy;
  return CANONICAL_EXECUTION_STRATEGIES.includes(canonical) ? canonical : null;
}

export const EFFECT_CLASSES = Object.freeze([
  'read',
  'write',
  'create',
  'execute',
  'external_send',
  'inference',
  'computer'
]);

export const DEFAULT_LIMITS = Object.freeze({
  maxWorkers: 10,
  maxActiveBranches: 5,
  maxDelegationDepth: 3,
  timeBudgetMs: 600000, // 10 minutes
  tokenBudget: 100000,
  maxProviderAttempts: 5
});

export const DEFAULT_MAX_STALENESS_MS = 300000; // 5 minutes

export class RouteValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RouteValidationError';
    this.details = details;
  }
}

export class CapabilityMismatchError extends RouteValidationError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'CapabilityMismatchError';
  }
}

export class AuthorityExpansionError extends RouteValidationError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'AuthorityExpansionError';
  }
}

export class BudgetExceededError extends RouteValidationError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'BudgetExceededError';
  }
}

export class CircularRouteError extends RouteValidationError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'CircularRouteError';
  }
}

export class DuplicateWorkerTaskError extends RouteValidationError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'DuplicateWorkerTaskError';
  }
}

export class WorkspaceMismatchError extends RouteValidationError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'WorkspaceMismatchError';
  }
}

export class WorkerUnavailableError extends RouteValidationError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'WorkerUnavailableError';
  }
}

/**
 * Determines if a value is a non-null plain object.
 * @param {any} val
 * @returns {boolean}
 */
export function isPlainObject(val) {
  if (val === null || typeof val !== 'object') return false;
  if (Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

/**
 * Validates input safety: rejects non-plain objects, cyclic references, and deep nesting.
 * @param {any} input
 * @param {number} [maxDepth=10]
 */
export function validateInputSafety(input, maxDepth = 15) {
  if (!isPlainObject(input)) {
    throw new RouteValidationError('Input must be a non-null plain object');
  }

  const activeStack = new WeakSet();

  function check(current, depth) {
    if (depth > maxDepth) {
      throw new RouteValidationError(`Input exceeds maximum nesting depth (${maxDepth})`);
    }
    if (current && typeof current === 'object') {
      if (activeStack.has(current)) {
        throw new RouteValidationError('Cyclic reference detected in input object');
      }
      activeStack.add(current);
      if (Array.isArray(current)) {
        for (const item of current) {
          check(item, depth + 1);
        }
      } else {
        for (const val of Object.values(current)) {
          check(val, depth + 1);
        }
      }
      activeStack.delete(current);
    }
  }

  check(input, 0);
}

/**
 * Deep freezes an object recursively.
 * @param {any} obj
 * @returns {any}
 */
export function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

const ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function isSubPathOrEqual(parentPath, childPath) {
  if (parentPath === childPath || parentPath === '.' || parentPath === '*' || parentPath === '**') return true;
  const normalizedParent = parentPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedChild = childPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalizedParent === normalizedChild) return true;
  return normalizedChild.startsWith(normalizedParent + '/');
}

/**
 * Checks worker manifest availability freshness.
 * @param {Object} manifest
 * @param {Object} [options]
 * @param {number} [options.maxStalenessMs=DEFAULT_MAX_STALENESS_MS]
 * @param {number} [options.now=Date.now()]
 */
export function checkWorkerFreshness(manifest, { maxStalenessMs = DEFAULT_MAX_STALENESS_MS, now = Date.now() } = {}) {
  if (!manifest) return;
  if (manifest.isStale === true || manifest.availability?.isStale === true) {
    throw new WorkerUnavailableError(
      `Worker '${manifest.workerId}' manifest is explicitly marked stale`,
      { workerId: manifest.workerId, isStale: true }
    );
  }
  const observedAt = manifest.availability?.observedAt;
  if (typeof observedAt === 'number') {
    if (observedAt <= 0 || !Number.isFinite(observedAt)) {
      throw new WorkerUnavailableError(
        `Worker '${manifest.workerId}' availability observedAt is non-finite or non-positive`,
        { workerId: manifest.workerId, observedAt }
      );
    }
    const age = now - observedAt;
    if (age > maxStalenessMs) {
      throw new WorkerUnavailableError(
        `Worker '${manifest.workerId}' availability is stale (${Math.round(age / 1000)}s old > ${Math.round(maxStalenessMs / 1000)}s limit)`,
        { workerId: manifest.workerId, ageMs: age, maxStalenessMs }
      );
    }
  }
}

/**
 * Checks worker qualification status.
 * @param {Object} manifest
 */
export function checkWorkerQualification(manifest) {
  if (!manifest) return;
  if (manifest.isQualified === false) {
    throw new CapabilityMismatchError(
      `Worker '${manifest.workerId}' is explicitly marked unqualified`,
      { workerId: manifest.workerId, isQualified: false }
    );
  }
  if (manifest.qualification) {
    const qual = manifest.qualification;
    if (typeof qual === 'string' && (qual === 'unqualified' || qual === 'failed' || qual === 'rejected')) {
      throw new CapabilityMismatchError(
        `Worker '${manifest.workerId}' qualification status is '${qual}'`,
        { workerId: manifest.workerId, qualification: qual }
      );
    }
    if (typeof qual === 'object' && qual !== null) {
      if (qual.status === 'failed' || qual.status === 'unqualified' || qual.status === 'rejected') {
        throw new CapabilityMismatchError(
          `Worker '${manifest.workerId}' qualification status is '${qual.status}'`,
          { workerId: manifest.workerId, qualification: qual.status }
        );
      }
    }
  }
}

/**
 * Validates a single worker manifest descriptor.
 * @param {any} manifest
 * @returns {Readonly<Object>}
 */
export function validateWorkerManifest(manifest) {
  if (!isPlainObject(manifest)) {
    throw new RouteValidationError('Worker manifest must be a non-null plain object');
  }
  const {
    workerId,
    workerType,
    adapterId,
    workspaceId,
    projectId,
    availability = {},
    capabilities = {},
    isQualified,
    qualification
  } = manifest;

  if (typeof workerId !== 'string' || !ID_REGEX.test(workerId)) {
    throw new RouteValidationError(`workerId must match ^[a-zA-Z0-9_-]{1,128}$, got '${workerId}'`);
  }
  if (typeof workerType !== 'string' || workerType.trim().length === 0) {
    throw new RouteValidationError('workerType must be a non-empty string');
  }
  if (typeof adapterId !== 'string' || adapterId.trim().length === 0) {
    throw new RouteValidationError('adapterId must be a non-empty string');
  }
  if (typeof workspaceId !== 'string' || workspaceId.trim().length === 0) {
    throw new RouteValidationError('workspaceId must be a non-empty string');
  }
  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    throw new RouteValidationError('projectId must be a non-empty string');
  }

  const validAvailabilityStatuses = ['available', 'running', 'busy', 'idle', 'unavailable', 'offline'];
  const status = availability.status || 'available';
  if (!validAvailabilityStatuses.includes(status)) {
    throw new RouteValidationError(`Invalid availability status: '${status}'`);
  }

  return deepFreeze({
    workerId,
    workerType,
    adapterId,
    workspaceId,
    projectId,
    availability: {
      status,
      observedAt: typeof availability.observedAt === 'number' ? availability.observedAt : Date.now(),
      isStale: availability.isStale === true
    },
    capabilities: { ...capabilities },
    isQualified: isQualified !== false,
    qualification: qualification ? (typeof qualification === 'object' ? { ...qualification } : qualification) : undefined
  });
}

/**
 * Checks if a worker manifest has a specific capability.
 * Supports boolean flags, effects array, actions array, and contextTypes array.
 * @param {Object} manifest
 * @param {string} capability
 * @returns {boolean}
 */
export function hasCapability(manifest, capability) {
  if (!manifest || !manifest.capabilities) return false;
  const caps = manifest.capabilities;
  if (caps[capability] === true) return true;
  if (Array.isArray(caps.effects) && caps.effects.includes(capability)) return true;
  if (Array.isArray(caps.actions) && caps.actions.includes(capability)) return true;
  if (Array.isArray(caps.contextTypes) && caps.contextTypes.includes(capability)) return true;
  return false;
}

/**
 * Checks if a worker manifest supports all required capabilities.
 * @param {Object} manifest Worker manifest
 * @param {string[]} requiredCapabilities List of required capability names
 */
export function checkCapabilityCompatibility(manifest, requiredCapabilities = []) {
  if (!manifest) throw new RouteValidationError('Manifest is required for capability check');
  for (const req of requiredCapabilities) {
    if (!hasCapability(manifest, req)) {
      throw new CapabilityMismatchError(
        `Worker '${manifest.workerId}' of type '${manifest.workerType}' is missing required capability '${req}'`,
        { workerId: manifest.workerId, missingCapability: req, requiredCapabilities }
      );
    }
  }
}

/**
 * Checks that a child authority does not expand the parent authority.
 * @param {Object} parentAuth Parent authority descriptor
 * @param {Object} childAuth Child authority descriptor
 */
export function checkAuthorityNarrowing(parentAuth, childAuth) {
  if (!parentAuth || !childAuth) return;

  // 1. Effect classes
  const parentEffects = new Set(parentAuth.effectClasses || []);
  const childEffects = childAuth.effectClasses || [];
  for (const eff of childEffects) {
    if (!parentEffects.has(eff)) {
      throw new AuthorityExpansionError(
        `Authority expansion denied: child route requested effect class '${eff}' which is not in parent authority`,
        { parentEffects: Array.from(parentEffects), childEffect: eff }
      );
    }
  }

  // 2. Allowed read paths
  if (Array.isArray(parentAuth.allowedPaths) && Array.isArray(childAuth.allowedPaths)) {
    for (const childPath of childAuth.allowedPaths) {
      const allowed = parentAuth.allowedPaths.some(p => isSubPathOrEqual(p, childPath));
      if (!allowed) {
        throw new AuthorityExpansionError(
          `Scope expansion denied: child allowedPath '${childPath}' is outside parent allowedPaths scope`,
          { parentAllowedPaths: parentAuth.allowedPaths, childPath }
        );
      }
    }
  }

  // 3. Allowed write paths
  if (Array.isArray(parentAuth.writePaths) && Array.isArray(childAuth.writePaths)) {
    const parentWrites = parentAuth.writePaths || [];
    for (const childWrite of childAuth.writePaths) {
      const allowed = parentWrites.some(p => isSubPathOrEqual(p, childWrite));
      if (!allowed) {
        throw new AuthorityExpansionError(
          `Scope expansion denied: child writePath '${childWrite}' is outside parent writePaths scope`,
          { parentWritePaths: parentWrites, childWritePath: childWrite }
        );
      }
    }
  }
}

/**
 * Checks that a child route context does not expand the parent context.
 * @param {Object} parentContext Parent context descriptor
 * @param {Object} childContext Child context descriptor
 */
export function checkContextNarrowing(parentContext, childContext) {
  if (!parentContext || !childContext) return;
  if (Array.isArray(parentContext.allowedTypes) && Array.isArray(childContext.allowedTypes)) {
    const parentTypes = new Set(parentContext.allowedTypes);
    for (const t of childContext.allowedTypes) {
      if (!parentTypes.has(t)) {
        throw new AuthorityExpansionError(
          `Context expansion denied: child context type '${t}' is not permitted in parent context`,
          { parentAllowedTypes: parentContext.allowedTypes, childType: t }
        );
      }
    }
  }
}

/**
 * Checks that child limits do not expand parent limits (strict monotonicity).
 * @param {Object} parentLimits
 * @param {Object} childLimits
 */
export function checkLimitsMonotonicity(parentLimits = {}, childLimits = {}) {
  if (typeof childLimits.maxWorkers === 'number' && typeof parentLimits.maxWorkers === 'number') {
    if (childLimits.maxWorkers > parentLimits.maxWorkers) {
      throw new RouteValidationError(
        `Limit expansion denied: child maxWorkers (${childLimits.maxWorkers}) exceeds parent (${parentLimits.maxWorkers})`
      );
    }
  }
  if (typeof childLimits.maxActiveBranches === 'number' && typeof parentLimits.maxActiveBranches === 'number') {
    if (childLimits.maxActiveBranches > parentLimits.maxActiveBranches) {
      throw new RouteValidationError(
        `Limit expansion denied: child maxActiveBranches (${childLimits.maxActiveBranches}) exceeds parent (${parentLimits.maxActiveBranches})`
      );
    }
  }
  if (typeof childLimits.maxDelegationDepth === 'number' && typeof parentLimits.maxDelegationDepth === 'number') {
    if (childLimits.maxDelegationDepth > parentLimits.maxDelegationDepth) {
      throw new RouteValidationError(
        `Limit expansion denied: child maxDelegationDepth (${childLimits.maxDelegationDepth}) exceeds parent (${parentLimits.maxDelegationDepth})`
      );
    }
  }
}

/**
 * Checks that a requested budget does not exceed the remaining parent/run budget.
 * @param {Object} parentBudget Parent budget limits
 * @param {Object} requestedBudget Child requested budget
 */
export function checkBudgetLimits(parentBudget = {}, requestedBudget = {}) {
  if (typeof requestedBudget.timeBudgetMs === 'number' && typeof parentBudget.timeBudgetMs === 'number') {
    if (requestedBudget.timeBudgetMs > parentBudget.timeBudgetMs) {
      throw new BudgetExceededError(
        `Budget exceeded: requested timeBudgetMs (${requestedBudget.timeBudgetMs}) exceeds parent limit (${parentBudget.timeBudgetMs})`,
        { parent: parentBudget.timeBudgetMs, requested: requestedBudget.timeBudgetMs }
      );
    }
  }

  if (typeof requestedBudget.tokenBudget === 'number' && typeof parentBudget.tokenBudget === 'number') {
    if (requestedBudget.tokenBudget > parentBudget.tokenBudget) {
      throw new BudgetExceededError(
        `Budget exceeded: requested tokenBudget (${requestedBudget.tokenBudget}) exceeds parent limit (${parentBudget.tokenBudget})`,
        { parent: parentBudget.tokenBudget, requested: requestedBudget.tokenBudget }
      );
    }
  }

  if (typeof requestedBudget.maxProviderAttempts === 'number' && typeof parentBudget.maxProviderAttempts === 'number') {
    if (requestedBudget.maxProviderAttempts > parentBudget.maxProviderAttempts) {
      throw new BudgetExceededError(
        `Budget exceeded: requested maxProviderAttempts (${requestedBudget.maxProviderAttempts}) exceeds parent limit (${parentBudget.maxProviderAttempts})`,
        { parent: parentBudget.maxProviderAttempts, requested: requestedBudget.maxProviderAttempts }
      );
    }
  }
}

/**
 * Detects circular routes in step dependencies and delegation ancestry chains.
 * @param {Object[]} steps List of route steps
 * @param {any[]} [delegationChain=[]] List of worker IDs or task IDs or objects in the parent delegation chain
 */
export function detectCircularRoute(steps = [], delegationChain = []) {
  // Check delegation ancestry cycle
  const chainWorkerIds = new Set();
  const chainTaskIds = new Set();
  for (const entry of delegationChain) {
    if (typeof entry === 'string') {
      chainWorkerIds.add(entry);
      chainTaskIds.add(entry);
    } else if (entry && typeof entry === 'object') {
      if (entry.workerId) chainWorkerIds.add(entry.workerId);
      if (entry.taskId) chainTaskIds.add(entry.taskId);
    }
  }

  for (const step of steps) {
    if (chainWorkerIds.has(step.workerId)) {
      throw new CircularRouteError(
        `Circular delegation route detected: worker '${step.workerId}' is already present in parent delegation chain`,
        { workerId: step.workerId, delegationChain }
      );
    }
    if (step.taskId && chainTaskIds.has(step.taskId)) {
      throw new CircularRouteError(
        `Circular delegation route detected: taskId '${step.taskId}' is already present in parent delegation chain`,
        { taskId: step.taskId, delegationChain }
      );
    }
  }

  // Check step dependency cycle
  const stepMap = new Map();
  for (const step of steps) {
    if (stepMap.has(step.stepId)) {
      throw new RouteValidationError(`Duplicate stepId detected: '${step.stepId}'`);
    }
    stepMap.set(step.stepId, step);
  }

  // Check that all dependsOn references exist and don't self-reference
  for (const step of steps) {
    for (const depId of step.dependsOn || []) {
      if (depId === step.stepId) {
        throw new CircularRouteError(
          `Circular step dependency detected: step '${step.stepId}' depends on itself`,
          { cycle: [step.stepId, step.stepId] }
        );
      }
      if (!stepMap.has(depId)) {
        throw new RouteValidationError(
          `Step '${step.stepId}' depends on unknown step '${depId}'`,
          { stepId: step.stepId, unknownDependency: depId }
        );
      }
    }
  }

  const visited = new Map(); // 0: unvisited, 1: visiting (active stack), 2: visited

  function dfs(stepId, path) {
    visited.set(stepId, 1);
    const step = stepMap.get(stepId);
    if (!step) return;

    const dependsOn = step.dependsOn || [];
    for (const depId of dependsOn) {
      const state = visited.get(depId) || 0;
      if (state === 1) {
        throw new CircularRouteError(
          `Circular step dependency detected: step '${stepId}' depends on '${depId}', creating a cycle [${[...path, depId].join(' -> ')}]`,
          { cycle: [...path, depId] }
        );
      }
      if (state === 0 && stepMap.has(depId)) {
        dfs(depId, [...path, depId]);
      }
    }
    visited.set(stepId, 2);
  }

  for (const step of steps) {
    if ((visited.get(step.stepId) || 0) === 0) {
      dfs(step.stepId, [step.stepId]);
    }
  }
}

/**
 * Validates a complete RoutePlan before dispatch or preview.
 *
 * @param {Object} plan RoutePlan object
 * @param {Object} [options] Validation options
 * @param {Map<string, Object>|Object} [options.manifests] Registry manifests map
 * @param {Object} [options.parentEnvelope] Parent task envelope (for delegated child routes)
 * @param {any[]} [options.delegationChain=[]]
 * @param {number} [options.now]
 * @param {number} [options.maxStalenessMs]
 * @param {boolean} [options.requireAvailable=false]
 * @returns {Readonly<Object>}
 */
export function validateRoutePlan(plan, options = {}) {
  validateInputSafety(plan);

  const {
    routeId,
    runId,
    conversationId,
    projectId,
    workspaceId,
    mode,
    strategy,
    steps,
    limits = {},
    authority,
    budget,
    context
  } = plan;

  if (typeof routeId !== 'string' || !ID_REGEX.test(routeId)) {
    throw new RouteValidationError(`Invalid routeId: '${routeId}'`);
  }
  if (typeof runId !== 'string' || !ID_REGEX.test(runId)) {
    throw new RouteValidationError(`Invalid runId: '${runId}'`);
  }
  if (typeof conversationId !== 'string' || !ID_REGEX.test(conversationId)) {
    throw new RouteValidationError(`Invalid conversationId: '${conversationId}'`);
  }
  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    throw new RouteValidationError('projectId must be a non-empty string');
  }
  if (typeof workspaceId !== 'string' || workspaceId.trim().length === 0) {
    throw new RouteValidationError('workspaceId must be a non-empty string');
  }

  if (!ROUTING_MODES.includes(mode)) {
    throw new RouteValidationError(`Unsupported routing mode '${mode}'. Supported modes: ${ROUTING_MODES.join(', ')}`);
  }

  const canonicalStrategy = normalizeStrategy(strategy);
  if (!canonicalStrategy) {
    throw new RouteValidationError(
      `Unsupported execution strategy '${strategy}'. Supported strategies: ${CANONICAL_EXECUTION_STRATEGIES.join(', ')}`
    );
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new RouteValidationError('RoutePlan steps must be a non-empty array');
  }

  const effectiveLimits = { ...DEFAULT_LIMITS, ...limits };

  // 1. Worker count limit
  const uniqueWorkers = new Set(steps.map(s => s.workerId));
  if (uniqueWorkers.size > effectiveLimits.maxWorkers) {
    throw new RouteValidationError(
      `Route exceeds maxWorkers ceiling: ${uniqueWorkers.size} unique workers requested, maximum is ${effectiveLimits.maxWorkers}`,
      { uniqueWorkersCount: uniqueWorkers.size, maxWorkers: effectiveLimits.maxWorkers }
    );
  }

  // 2. Active branches limit
  const rootSteps = steps.filter(s => !s.dependsOn || s.dependsOn.length === 0);
  if (rootSteps.length > effectiveLimits.maxActiveBranches) {
    throw new RouteValidationError(
      `Route exceeds maxActiveBranches ceiling: ${rootSteps.length} initial active branches, maximum is ${effectiveLimits.maxActiveBranches}`,
      { activeBranches: rootSteps.length, maxActiveBranches: effectiveLimits.maxActiveBranches }
    );
  }

  // 3. Depth limit
  const maxDepth = Math.max(...steps.map(s => (typeof s.depth === 'number' ? s.depth : 0)));
  if (maxDepth > effectiveLimits.maxDelegationDepth) {
    throw new RouteValidationError(
      `Route exceeds maxDelegationDepth ceiling: step depth ${maxDepth} exceeds maximum ${effectiveLimits.maxDelegationDepth}`,
      { maxDepth, maxDelegationDepth: effectiveLimits.maxDelegationDepth }
    );
  }

  // 4. Unique worker-task pairs
  const seenWorkerTasks = new Set();
  for (const step of steps) {
    const key = `${step.workerId}:${step.taskId || step.stepId}`;
    if (seenWorkerTasks.has(key)) {
      throw new DuplicateWorkerTaskError(
        `Duplicate worker-task pair detected: worker '${step.workerId}' is assigned to task '${step.taskId || step.stepId}' multiple times`,
        { workerId: step.workerId, taskId: step.taskId || step.stepId }
      );
    }
    seenWorkerTasks.add(key);
  }

  // 5. Circular route detection
  const chain = options.delegationChain || [];
  if (options.parentEnvelope?.sourceWorkerId && !chain.includes(options.parentEnvelope.sourceWorkerId)) {
    chain.push(options.parentEnvelope.sourceWorkerId);
  }
  detectCircularRoute(steps, chain);

  // 6. Manifest validation, capability qualification, freshness, and workspace binding
  const manifests = options.manifests;
  if (manifests) {
    const manifestMap = manifests instanceof Map
      ? manifests
      : (typeof manifests === 'object' && !Array.isArray(manifests)
        ? new Map(Object.entries(manifests))
        : Array.isArray(manifests)
          ? new Map(manifests.map(m => [m.workerId, m]))
          : new Map());

    for (const step of steps) {
      const manifest = manifestMap.get(step.workerId);
      if (!manifest) {
        throw new RouteValidationError(
          `Destination worker '${step.workerId}' is not registered in supplied worker manifests`,
          { workerId: step.workerId }
        );
      }

      // Exact workspace and project binding
      if (manifest.workspaceId !== workspaceId) {
        throw new WorkspaceMismatchError(
          `Workspace mismatch: worker '${step.workerId}' is bound to workspace '${manifest.workspaceId}', but route requires '${workspaceId}'`,
          { workerId: step.workerId, workerWorkspace: manifest.workspaceId, routeWorkspace: workspaceId }
        );
      }
      if (manifest.projectId !== projectId) {
        throw new WorkspaceMismatchError(
          `Project mismatch: worker '${step.workerId}' is bound to project '${manifest.projectId}', but route requires '${projectId}'`,
          { workerId: step.workerId, workerProject: manifest.projectId, routeProject: projectId }
        );
      }

      // Check qualification
      checkWorkerQualification(manifest);

      // Check freshness
      checkWorkerFreshness(manifest, {
        now: options.now,
        maxStalenessMs: options.maxStalenessMs
      });

      // Availability check for manual mode or explicit requireAvailable
      const status = manifest.availability?.status;
      if ((mode === 'manual' || options.requireAvailable) && (status === 'unavailable' || status === 'offline')) {
        throw new WorkerUnavailableError(
          `Worker '${step.workerId}' is unavailable (status: '${status}')`,
          { workerId: step.workerId, status }
        );
      }

      // Capability compatibility
      if (Array.isArray(step.requiredCapabilities) && step.requiredCapabilities.length > 0) {
        checkCapabilityCompatibility(manifest, step.requiredCapabilities);
      }
    }
  }

  // 7. Child delegation checks (if parentEnvelope is supplied)
  if (options.parentEnvelope) {
    const parent = options.parentEnvelope;
    if (parent.workspaceId !== workspaceId) {
      throw new WorkspaceMismatchError(
        `Delegation workspace mismatch: parent workspace '${parent.workspaceId}' !== child workspace '${workspaceId}'`,
        { parentWorkspace: parent.workspaceId, childWorkspace: workspaceId }
      );
    }
    if (parent.projectId !== projectId) {
      throw new WorkspaceMismatchError(
        `Delegation project mismatch: parent project '${parent.projectId}' !== child project '${projectId}'`,
        { parentProject: parent.projectId, childProject: projectId }
      );
    }
    if (typeof parent.depth === 'number' && parent.depth + 1 > effectiveLimits.maxDelegationDepth) {
      throw new RouteValidationError(
        `Delegation depth limit exceeded: parent depth ${parent.depth} + 1 > maxDelegationDepth ${effectiveLimits.maxDelegationDepth}`
      );
    }
    if (parent.limits) {
      checkLimitsMonotonicity(parent.limits, limits);
    }
    if (parent.authority && authority) {
      checkAuthorityNarrowing(parent.authority, authority);
    }
    if (parent.context && context) {
      checkContextNarrowing(parent.context, context);
    }
    if (parent.budget && budget) {
      checkBudgetLimits(parent.budget, budget);
    }
  }

  return deepFreeze({
    ...plan,
    strategy: canonicalStrategy
  });
}
