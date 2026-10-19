import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTING_MODES,
  CANONICAL_EXECUTION_STRATEGIES,
  EXECUTION_STRATEGIES,
  DEFAULT_LIMITS,
  DEFAULT_MAX_STALENESS_MS,
  RouteValidationError,
  CapabilityMismatchError,
  AuthorityExpansionError,
  BudgetExceededError,
  CircularRouteError,
  DuplicateWorkerTaskError,
  WorkspaceMismatchError,
  WorkerUnavailableError,
  validateWorkerManifest,
  checkCapabilityCompatibility,
  checkAuthorityNarrowing,
  checkContextNarrowing,
  checkLimitsMonotonicity,
  checkBudgetLimits,
  checkWorkerFreshness,
  checkWorkerQualification,
  detectCircularRoute,
  validateRoutePlan,
  validateInputSafety,
  normalizeStrategy,
  hasCapability
} from '../src/ifz/route-guard.js';

test('IFZ Route Guard - Canonical Strategies & Normalization', () => {
  // Canonical identifiers
  assert.deepEqual(CANONICAL_EXECUTION_STRATEGIES, [
    'parallel',
    'sequential',
    'review-chain',
    'first-verified',
    'compare',
    'bounded-delegation'
  ]);

  // Normalization
  assert.equal(normalizeStrategy('parallel'), 'parallel');
  assert.equal(normalizeStrategy('sequential'), 'sequential');
  assert.equal(normalizeStrategy('review-chain'), 'review-chain');
  assert.equal(normalizeStrategy('first-verified'), 'first-verified');
  assert.equal(normalizeStrategy('compare'), 'compare');
  assert.equal(normalizeStrategy('bounded-delegation'), 'bounded-delegation');

  // Aliases normalized to canonical
  assert.equal(normalizeStrategy('review_chain'), 'review-chain');
  assert.equal(normalizeStrategy('first_verified'), 'first-verified');
  assert.equal(normalizeStrategy('compare_results'), 'compare');
  assert.equal(normalizeStrategy('bounded_delegation'), 'bounded-delegation');

  // Invalid strategies
  assert.equal(normalizeStrategy('unknown-strategy'), null);
  assert.equal(normalizeStrategy(123), null);
  assert.equal(normalizeStrategy(null), null);
});

test('IFZ Route Guard - Reject Malformed, Non-Plain, Cyclic, and Deep Inputs', () => {
  // Non-plain inputs rejected
  assert.throws(() => validateInputSafety(null), RouteValidationError);
  assert.throws(() => validateInputSafety(undefined), RouteValidationError);
  assert.throws(() => validateInputSafety([1, 2, 3]), RouteValidationError);
  assert.throws(() => validateInputSafety('string'), RouteValidationError);
  assert.throws(() => validateInputSafety(new Date()), RouteValidationError);
  assert.throws(() => validateInputSafety(new Set()), RouteValidationError);

  // Cyclic inputs rejected
  const cyclicObj = { a: 1 };
  cyclicObj.self = cyclicObj;
  assert.throws(() => validateInputSafety(cyclicObj), RouteValidationError);

  // Deep inputs exceeding maxDepth (default 10) rejected
  let deepObj = { level: 0 };
  let curr = deepObj;
  for (let i = 1; i <= 15; i++) {
    curr.nested = { level: i };
    curr = curr.nested;
  }
  assert.throws(() => validateInputSafety(deepObj, 10), RouteValidationError);

  // Valid plain object passes
  assert.doesNotThrow(() => validateInputSafety({ foo: 'bar', arr: [1, 2, { baz: true }] }));
});

test('IFZ Route Guard - Worker Freshness and Qualification Checks', () => {
  const now = 1700000000000;

  // Fresh worker passes
  const freshManifest = {
    workerId: 'w-fresh',
    availability: { status: 'available', observedAt: now - 10000 },
    isQualified: true
  };
  assert.doesNotThrow(() => checkWorkerFreshness(freshManifest, { now }));
  assert.doesNotThrow(() => checkWorkerQualification(freshManifest));

  // Explicitly stale manifest rejected
  assert.throws(() => {
    checkWorkerFreshness({ workerId: 'w-stale-flag', isStale: true }, { now });
  }, WorkerUnavailableError);

  assert.throws(() => {
    checkWorkerFreshness({ workerId: 'w-stale-avail', availability: { isStale: true } }, { now });
  }, WorkerUnavailableError);

  // Stale by observedAt timestamp (> 300,000ms old) rejected
  assert.throws(() => {
    checkWorkerFreshness({
      workerId: 'w-stale-time',
      availability: { observedAt: now - 350000 }
    }, { now });
  }, WorkerUnavailableError);

  // Non-finite observedAt rejected
  assert.throws(() => {
    checkWorkerFreshness({
      workerId: 'w-bad-time',
      availability: { observedAt: -1 }
    }, { now });
  }, WorkerUnavailableError);

  // Explicitly unqualified worker rejected
  assert.throws(() => {
    checkWorkerQualification({ workerId: 'w-unqual', isQualified: false });
  }, CapabilityMismatchError);

  // Qualification status 'failed' rejected
  assert.throws(() => {
    checkWorkerQualification({ workerId: 'w-failed-qual', qualification: 'failed' });
  }, CapabilityMismatchError);

  assert.throws(() => {
    checkWorkerQualification({ workerId: 'w-failed-qual-obj', qualification: { status: 'failed' } });
  }, CapabilityMismatchError);
});

test('IFZ Route Guard - Strict Authority Monotonicity Across All Limits', () => {
  const parentAuth = {
    effectClasses: ['read', 'write'],
    allowedPaths: ['src/ifz', 'docs'],
    writePaths: ['src/ifz']
  };

  // 1. Effect class expansion rejected
  assert.throws(() => {
    checkAuthorityNarrowing(parentAuth, {
      effectClasses: ['read', 'write', 'execute'],
      allowedPaths: ['src/ifz'],
      writePaths: ['src/ifz']
    });
  }, AuthorityExpansionError);

  // 2. Allowed paths expansion rejected
  assert.throws(() => {
    checkAuthorityNarrowing(parentAuth, {
      effectClasses: ['read'],
      allowedPaths: ['packages/other'],
      writePaths: []
    });
  }, AuthorityExpansionError);

  // 3. Write paths expansion rejected
  assert.throws(() => {
    checkAuthorityNarrowing(parentAuth, {
      effectClasses: ['read', 'write'],
      allowedPaths: ['src/ifz'],
      writePaths: ['docs'] // In allowedPaths but outside parent writePaths
    });
  }, AuthorityExpansionError);

  // 4. Context types expansion rejected
  const parentContext = { allowedTypes: ['charter', 'manifests'] };
  assert.throws(() => {
    checkContextNarrowing(parentContext, { allowedTypes: ['charter', 'full_database'] });
  }, AuthorityExpansionError);

  // 5. Budget timeBudgetMs overflow rejected
  assert.throws(() => {
    checkBudgetLimits({ timeBudgetMs: 50000 }, { timeBudgetMs: 50001 });
  }, BudgetExceededError);

  // 6. Budget tokenBudget overflow rejected
  assert.throws(() => {
    checkBudgetLimits({ tokenBudget: 10000 }, { tokenBudget: 10001 });
  }, BudgetExceededError);

  // 7. Budget maxProviderAttempts overflow rejected
  assert.throws(() => {
    checkBudgetLimits({ maxProviderAttempts: 3 }, { maxProviderAttempts: 4 });
  }, BudgetExceededError);

  // 8. Limit maxWorkers expansion rejected
  assert.throws(() => {
    checkLimitsMonotonicity({ maxWorkers: 5 }, { maxWorkers: 6 });
  }, RouteValidationError);

  // 9. Limit maxActiveBranches expansion rejected
  assert.throws(() => {
    checkLimitsMonotonicity({ maxActiveBranches: 2 }, { maxActiveBranches: 3 });
  }, RouteValidationError);

  // 10. Limit maxDelegationDepth expansion rejected
  assert.throws(() => {
    checkLimitsMonotonicity({ maxDelegationDepth: 2 }, { maxDelegationDepth: 3 });
  }, RouteValidationError);
});

test('IFZ Route Guard - Full Ancestry Cycle Detection and Missing Dependencies', () => {
  // 1. Ancestor worker in delegationChain rejected
  assert.throws(() => {
    detectCircularRoute(
      [{ stepId: 's1', workerId: 'agr-2', dependsOn: [] }],
      ['codex-lead', 'agr-2']
    );
  }, CircularRouteError);

  // 2. Ancestor taskId in delegationChain rejected
  assert.throws(() => {
    detectCircularRoute(
      [{ stepId: 's1', workerId: 'agr-1', taskId: 'root-task', dependsOn: [] }],
      [{ workerId: 'codex-lead', taskId: 'root-task' }]
    );
  }, CircularRouteError);

  // 3. Step self-dependency rejected
  assert.throws(() => {
    detectCircularRoute([
      { stepId: 's1', workerId: 'agr-1', dependsOn: ['s1'] }
    ]);
  }, CircularRouteError);

  // 4. Direct dependency cycle rejected
  assert.throws(() => {
    detectCircularRoute([
      { stepId: 's1', workerId: 'agr-1', dependsOn: ['s2'] },
      { stepId: 's2', workerId: 'agr-2', dependsOn: ['s1'] }
    ]);
  }, CircularRouteError);

  // 5. Indirect dependency cycle rejected
  assert.throws(() => {
    detectCircularRoute([
      { stepId: 's1', workerId: 'agr-1', dependsOn: ['s2'] },
      { stepId: 's2', workerId: 'agr-2', dependsOn: ['s3'] },
      { stepId: 's3', workerId: 'agr-3', dependsOn: ['s1'] }
    ]);
  }, CircularRouteError);

  // 6. Missing / unknown dependency step rejected
  assert.throws(() => {
    detectCircularRoute([
      { stepId: 's1', workerId: 'agr-1', dependsOn: ['non-existent-step'] }
    ]);
  }, RouteValidationError);

  // 7. Duplicate stepId rejected
  assert.throws(() => {
    detectCircularRoute([
      { stepId: 's1', workerId: 'agr-1', dependsOn: [] },
      { stepId: 's1', workerId: 'agr-2', dependsOn: [] }
    ]);
  }, RouteValidationError);

  // 8. Valid DAG passes
  assert.doesNotThrow(() => {
    detectCircularRoute([
      { stepId: 's1', workerId: 'agr-1', dependsOn: [] },
      { stepId: 's2', workerId: 'agr-2', dependsOn: ['s1'] },
      { stepId: 's3', workerId: 'ocr-1', dependsOn: ['s1'] },
      { stepId: 's4', workerId: 'rct-1', dependsOn: ['s2', 's3'] }
    ], ['unrelated-ancestor']);
  });
});

test('IFZ Route Guard - Duplicates, Wrong Workspace, and Cap Mismatches', () => {
  const manifests = new Map([
    ['agr-1', {
      workerId: 'agr-1',
      workerType: 'architect',
      adapterId: 'a1',
      workspaceId: 'ws-zetro',
      projectId: 'proj-zetro',
      availability: { status: 'available' },
      capabilities: { effects: ['read', 'write'] }
    }],
    ['ocr-1', {
      workerId: 'ocr-1',
      workerType: 'reviewer',
      adapterId: 'a2',
      workspaceId: 'ws-zetro',
      projectId: 'proj-zetro',
      availability: { status: 'available' },
      capabilities: { effects: ['read'] }
    }],
    ['w-wrong-ws', {
      workerId: 'w-wrong-ws',
      workerType: 'coder',
      adapterId: 'a1',
      workspaceId: 'ws-other',
      projectId: 'proj-zetro',
      availability: { status: 'available' },
      capabilities: { effects: ['read'] }
    }]
  ]);

  const basePlan = {
    routeId: 'r1',
    runId: 'run1',
    conversationId: 'c1',
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'manual',
    strategy: 'sequential',
    steps: [
      { stepId: 's1', workerId: 'agr-1', taskId: 't1', dependsOn: [] }
    ]
  };

  // 1. Duplicate worker-task pair rejected
  assert.throws(() => {
    validateRoutePlan({
      ...basePlan,
      steps: [
        { stepId: 's1', workerId: 'agr-1', taskId: 't-same', dependsOn: [] },
        { stepId: 's2', workerId: 'agr-1', taskId: 't-same', dependsOn: ['s1'] }
      ]
    }, { manifests });
  }, DuplicateWorkerTaskError);

  // 2. Wrong workspace rejected
  assert.throws(() => {
    validateRoutePlan({
      ...basePlan,
      steps: [{ stepId: 's1', workerId: 'w-wrong-ws', taskId: 't1', dependsOn: [] }]
    }, { manifests });
  }, WorkspaceMismatchError);

  // 3. Capability mismatch rejected
  assert.throws(() => {
    validateRoutePlan({
      ...basePlan,
      steps: [{
        stepId: 's1',
        workerId: 'ocr-1', // only has read
        taskId: 't1',
        dependsOn: [],
        requiredCapabilities: ['write', 'execute']
      }]
    }, { manifests });
  }, CapabilityMismatchError);
});
