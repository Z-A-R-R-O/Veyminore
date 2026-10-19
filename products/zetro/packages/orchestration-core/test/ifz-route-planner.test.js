import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVED_WORKFLOW_TEMPLATES,
  planRoute,
  createRoutePreview,
  computeRouteHash,
  normalizeManifests,
  findMatchingWorker,
  revalidateSavedWorkflow
} from '../src/ifz/route-planner.js';
import {
  CapabilityMismatchError,
  RouteValidationError,
  WorkerUnavailableError,
  WorkspaceMismatchError,
  CircularRouteError,
  DuplicateWorkerTaskError,
  AuthorityExpansionError,
  BudgetExceededError
} from '../src/ifz/route-guard.js';

const mockManifests = [
  {
    workerId: 'agr-1',
    workerType: 'architecture-worker',
    adapterId: 'adapter-local',
    workspaceId: 'ws-zetro',
    projectId: 'proj-zetro',
    availability: { status: 'available', observedAt: Date.now() },
    capabilities: { effects: ['read', 'write', 'execute'] }
  },
  {
    workerId: 'agr-2',
    workerType: 'router-worker',
    adapterId: 'adapter-local',
    workspaceId: 'ws-zetro',
    projectId: 'proj-zetro',
    availability: { status: 'available', observedAt: Date.now() },
    capabilities: { effects: ['read', 'write'] }
  },
  {
    workerId: 'agr-3',
    workerType: 'prompt-worker',
    adapterId: 'adapter-local',
    workspaceId: 'ws-zetro',
    projectId: 'proj-zetro',
    availability: { status: 'available', observedAt: Date.now() },
    capabilities: { effects: ['read', 'write'] }
  },
  {
    workerId: 'agr-4',
    workerType: 'shell-worker',
    adapterId: 'adapter-local',
    workspaceId: 'ws-zetro',
    projectId: 'proj-zetro',
    availability: { status: 'available', observedAt: Date.now() },
    capabilities: { effects: ['read', 'write'] }
  },
  {
    workerId: 'agr-5',
    workerType: 'ui-worker',
    adapterId: 'adapter-local',
    workspaceId: 'ws-zetro',
    projectId: 'proj-zetro',
    availability: { status: 'available', observedAt: Date.now() },
    capabilities: { effects: ['read', 'write'] }
  },
  {
    workerId: 'ocr-1',
    workerType: 'review-worker',
    adapterId: 'adapter-local',
    workspaceId: 'ws-zetro',
    projectId: 'proj-zetro',
    availability: { status: 'idle', observedAt: Date.now() },
    capabilities: { effects: ['read', 'execute'] }
  },
  {
    workerId: 'ocr-2',
    workerType: 'review-worker',
    adapterId: 'adapter-local',
    workspaceId: 'ws-zetro',
    projectId: 'proj-zetro',
    availability: { status: 'available', observedAt: Date.now() },
    capabilities: { effects: ['read', 'execute'] }
  },
  {
    workerId: 'rct-1',
    workerType: 'runtime-qualification-worker',
    adapterId: 'adapter-local',
    workspaceId: 'ws-zetro',
    projectId: 'proj-zetro',
    availability: { status: 'available', observedAt: Date.now() },
    capabilities: { effects: ['read', 'execute'] }
  },
  {
    workerId: 'w-stale',
    workerType: 'general-worker',
    adapterId: 'adapter-local',
    workspaceId: 'ws-zetro',
    projectId: 'proj-zetro',
    availability: { status: 'available', observedAt: Date.now() - 400000 }, // 400s > 300s
    capabilities: { effects: ['read', 'write'] }
  },
  {
    workerId: 'w-offline',
    workerType: 'general-worker',
    adapterId: 'adapter-local',
    workspaceId: 'ws-zetro',
    projectId: 'proj-zetro',
    availability: { status: 'offline', observedAt: Date.now() },
    capabilities: { effects: ['read', 'write'] }
  },
  {
    workerId: 'w-wrong-ws',
    workerType: 'general-worker',
    adapterId: 'adapter-local',
    workspaceId: 'ws-other',
    projectId: 'proj-zetro',
    availability: { status: 'available', observedAt: Date.now() },
    capabilities: { effects: ['read', 'write'] }
  }
];

test('Adversarial Scenario 1: AGR2 to OCR1 manual route', () => {
  const plan = planRoute({
    routeId: 'route_agr2_ocr1',
    runId: 'run_manual_1',
    conversationId: 'conv_1',
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'manual',
    strategy: 'sequential',
    prompt: 'AGR-2 delegates review to OCR-1',
    destinations: ['ocr-1'],
    requiredCapabilities: ['read', 'execute']
  }, { manifests: mockManifests });

  assert.equal(plan.mode, 'manual');
  assert.equal(plan.strategy, 'sequential');
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].workerId, 'ocr-1');
  assert.equal(plan.steps[0].workerType, 'review-worker');
  assert.equal(plan.isProposal, false);
});

test('Adversarial Scenario 2: RCT to AGR1-5 bounded parallel execution and branch overflow', () => {
  const plan = planRoute({
    routeId: 'route_rct_parallel',
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'manual',
    strategy: 'parallel',
    prompt: 'RCT fans out exploration to AGR1 through AGR5',
    destinations: ['agr-1', 'agr-2', 'agr-3', 'agr-4', 'agr-5'],
    limits: {
      maxWorkers: 10,
      maxActiveBranches: 5
    }
  }, { manifests: mockManifests });

  assert.equal(plan.strategy, 'parallel');
  assert.equal(plan.steps.length, 5);
  // All 5 steps must have dependsOn: [] (concurrent branches)
  for (const step of plan.steps) {
    assert.deepEqual(step.dependsOn, []);
  }

  // Probe overflow: attempting 6 branches when maxActiveBranches = 5 throws RouteValidationError
  assert.throws(() => {
    planRoute({
      routeId: 'route_overflow_branches',
      projectId: 'proj-zetro',
      workspaceId: 'ws-zetro',
      mode: 'manual',
      strategy: 'parallel',
      destinations: ['agr-1', 'agr-2', 'agr-3', 'agr-4', 'agr-5', 'ocr-1'],
      limits: { maxActiveBranches: 5 }
    }, { manifests: mockManifests });
  }, RouteValidationError);
});

test('Adversarial Scenario 3: AGR5 -> AGR1 -> OCR2 -> RCT sequential/review pipeline', () => {
  const plan = planRoute({
    routeId: 'route_multi_stage',
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'manual',
    strategy: 'sequential',
    prompt: 'AGR-5 UI -> AGR-1 Contract -> OCR-2 Review -> RCT Qualification',
    destinations: [
      { workerId: 'agr-5', requiredCapabilities: ['write'], taskId: 't1' },
      { workerId: 'agr-1', requiredCapabilities: ['write'], taskId: 't2' },
      { workerId: 'ocr-2', requiredCapabilities: ['read', 'execute'], taskId: 't3' },
      { workerId: 'rct-1', requiredCapabilities: ['read', 'execute'], taskId: 't4' }
    ]
  }, { manifests: mockManifests });

  assert.equal(plan.strategy, 'sequential');
  assert.equal(plan.steps.length, 4);

  // Progressive dependencies
  assert.deepEqual(plan.steps[0].dependsOn, []);
  assert.deepEqual(plan.steps[1].dependsOn, ['step_1']);
  assert.deepEqual(plan.steps[2].dependsOn, ['step_2']);
  assert.deepEqual(plan.steps[3].dependsOn, ['step_3']);

  assert.equal(plan.steps[0].workerId, 'agr-5');
  assert.equal(plan.steps[1].workerId, 'agr-1');
  assert.equal(plan.steps[2].workerId, 'ocr-2');
  assert.equal(plan.steps[3].workerId, 'rct-1');
});

test('Adversarial Scenario 4: Automatic mode returns proposal only and cannot dispatch', () => {
  const proposal = planRoute({
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'automatic',
    requiredCapabilities: ['write'],
    prompt: 'Propose refactoring'
  }, { manifests: mockManifests });

  assert.equal(proposal.mode, 'automatic');
  assert.equal(proposal.isProposal, true);
  assert.equal(proposal.status, 'proposed');
  assert.equal(typeof proposal.dispatch, 'undefined', 'Proposal must NOT contain dispatch method');
  assert.ok(proposal.routeHash, 'Proposal contains cryptographic integrity hash');
});

test('Adversarial Scenario 5: Saved-workflow revalidation at use time', () => {
  // Plan using saved template
  const plan = planRoute({
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'saved-workflow',
    templateId: 'standard-review-chain',
    prompt: 'Standard review chain implementation'
  }, { manifests: mockManifests });

  assert.equal(plan.mode, 'saved-workflow');
  assert.equal(plan.strategy, 'review-chain');

  // 1. Initial revalidation succeeds
  assert.doesNotThrow(() => {
    revalidateSavedWorkflow(plan, { manifests: mockManifests });
  });

  // 2. Worker becomes unavailable at use time: revalidation fails
  const manifestsWithUnavailable = mockManifests.map(m => {
    if (m.workerId === plan.steps[0].workerId) {
      return { ...m, availability: { status: 'unavailable', observedAt: Date.now() } };
    }
    return m;
  });

  assert.throws(() => {
    revalidateSavedWorkflow(plan, { manifests: manifestsWithUnavailable });
  }, WorkerUnavailableError);

  // 3. Worker becomes stale at use time: revalidation fails
  const manifestsWithStale = mockManifests.map(m => {
    if (m.workerId === plan.steps[0].workerId) {
      return { ...m, availability: { status: 'available', observedAt: Date.now() - 500000 } };
    }
    return m;
  });

  assert.throws(() => {
    revalidateSavedWorkflow(plan, { manifests: manifestsWithStale });
  }, WorkerUnavailableError);

  // 4. Worker loses capability at use time: revalidation fails
  const manifestsWithLostCap = mockManifests.map(m => {
    if (m.workerId === plan.steps[0].workerId) {
      return { ...m, capabilities: { effects: ['read'] } }; // lost 'write'
    }
    return m;
  });

  assert.throws(() => {
    revalidateSavedWorkflow(plan, { manifests: manifestsWithLostCap });
  }, CapabilityMismatchError);
});

test('Adversarial Scenario 6: Cycles in ancestry delegation and step DAG', () => {
  // Re-delegation to ancestor
  assert.throws(() => {
    planRoute({
      projectId: 'proj-zetro',
      workspaceId: 'ws-zetro',
      mode: 'manual',
      destinations: ['agr-1']
    }, {
      manifests: mockManifests,
      delegationChain: ['agr-1']
    });
  }, CircularRouteError);

  // Step cycle
  assert.throws(() => {
    planRoute({
      projectId: 'proj-zetro',
      workspaceId: 'ws-zetro',
      mode: 'manual',
      destinations: [
        { stepId: 's1', workerId: 'agr-1', dependsOn: ['s2'] },
        { stepId: 's2', workerId: 'agr-2', dependsOn: ['s1'] }
      ]
    }, { manifests: mockManifests });
  }, CircularRouteError);
});

test('Adversarial Scenario 7: Stale worker rejection in manual and automatic modes', () => {
  // Manual selection of stale worker rejected
  assert.throws(() => {
    planRoute({
      projectId: 'proj-zetro',
      workspaceId: 'ws-zetro',
      mode: 'manual',
      destinations: ['w-stale']
    }, { manifests: mockManifests });
  }, WorkerUnavailableError);

  // Automatic matching avoids stale and offline workers
  const matched = findMatchingWorker(mockManifests, {
    workspaceId: 'ws-zetro',
    projectId: 'proj-zetro',
    requiredCapabilities: ['write']
  });
  assert.ok(matched);
  assert.notEqual(matched.workerId, 'w-stale');
  assert.notEqual(matched.workerId, 'w-offline');
});

test('Adversarial Scenario 8: Wrong workspace rejection', () => {
  assert.throws(() => {
    planRoute({
      projectId: 'proj-zetro',
      workspaceId: 'ws-zetro',
      mode: 'manual',
      destinations: ['w-wrong-ws']
    }, { manifests: mockManifests });
  }, WorkspaceMismatchError);
});

test('Adversarial Scenario 9: Capability mismatch rejection', () => {
  assert.throws(() => {
    planRoute({
      projectId: 'proj-zetro',
      workspaceId: 'ws-zetro',
      mode: 'manual',
      destinations: ['ocr-1'], // only has read, execute
      requiredCapabilities: ['write']
    }, { manifests: mockManifests });
  }, CapabilityMismatchError);
});

test('Adversarial Scenario 10: Duplicates rejection', () => {
  // Duplicate worker-task
  assert.throws(() => {
    planRoute({
      projectId: 'proj-zetro',
      workspaceId: 'ws-zetro',
      mode: 'manual',
      destinations: [
        { stepId: 's1', workerId: 'agr-1', taskId: 'same-task', dependsOn: [] },
        { stepId: 's2', workerId: 'agr-1', taskId: 'same-task', dependsOn: ['s1'] }
      ]
    }, { manifests: mockManifests });
  }, DuplicateWorkerTaskError);

  // Duplicate stepId
  assert.throws(() => {
    planRoute({
      projectId: 'proj-zetro',
      workspaceId: 'ws-zetro',
      mode: 'manual',
      destinations: [
        { stepId: 'dup_step', workerId: 'agr-1', taskId: 't1', dependsOn: [] },
        { stepId: 'dup_step', workerId: 'agr-2', taskId: 't2', dependsOn: [] }
      ]
    }, { manifests: mockManifests });
  }, RouteValidationError);
});

test('Adversarial Scenario 11: All Limit Overflows in Child Delegation', () => {
  const parentEnvelope = {
    taskId: 'parent_t1',
    runId: 'run_p',
    conversationId: 'conv_p',
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    depth: 1,
    limits: {
      maxWorkers: 3,
      maxActiveBranches: 2,
      maxDelegationDepth: 2
    },
    authority: {
      effectClasses: ['read', 'write'],
      allowedPaths: ['src/ifz'],
      writePaths: ['src/ifz']
    },
    budget: {
      timeBudgetMs: 20000,
      tokenBudget: 5000,
      maxProviderAttempts: 2
    },
    context: {
      allowedTypes: ['charter']
    }
  };

  // 1. maxDelegationDepth overflow: depth (1) + 1 = 2 is at max. If parent depth was 2:
  assert.throws(() => {
    planRoute({
      mode: 'manual',
      destinations: ['agr-1']
    }, {
      manifests: mockManifests,
      parentEnvelope: { ...parentEnvelope, depth: 2 } // 2 + 1 = 3 > max 2
    });
  }, RouteValidationError);

  // 2. Child expanding maxWorkers above parent limit
  assert.throws(() => {
    planRoute({
      mode: 'manual',
      destinations: ['agr-1'],
      limits: { maxWorkers: 4 } // parent is 3
    }, {
      manifests: mockManifests,
      parentEnvelope
    });
  }, RouteValidationError);

  // 3. Child expanding maxActiveBranches above parent limit
  assert.throws(() => {
    planRoute({
      mode: 'manual',
      destinations: ['agr-1'],
      limits: { maxActiveBranches: 3 } // parent is 2
    }, {
      manifests: mockManifests,
      parentEnvelope
    });
  }, RouteValidationError);

  // 4. Child expanding authority effectClasses
  assert.throws(() => {
    planRoute({
      mode: 'manual',
      destinations: ['agr-1'],
      authority: { effectClasses: ['read', 'write', 'computer'] }
    }, {
      manifests: mockManifests,
      parentEnvelope
    });
  }, AuthorityExpansionError);

  // 5. Child expanding allowedPaths
  assert.throws(() => {
    planRoute({
      mode: 'manual',
      destinations: ['agr-1'],
      authority: {
        effectClasses: ['read'],
        allowedPaths: ['src/outside-scope'],
        writePaths: []
      }
    }, {
      manifests: mockManifests,
      parentEnvelope
    });
  }, AuthorityExpansionError);

  // 6. Child expanding writePaths
  assert.throws(() => {
    planRoute({
      mode: 'manual',
      destinations: ['agr-1'],
      authority: {
        effectClasses: ['read', 'write'],
        allowedPaths: ['src/ifz'],
        writePaths: ['src/ifz', 'packages/outside']
      }
    }, {
      manifests: mockManifests,
      parentEnvelope
    });
  }, AuthorityExpansionError);

  // 7. Child expanding context
  assert.throws(() => {
    planRoute({
      mode: 'manual',
      destinations: ['agr-1'],
      context: { allowedTypes: ['charter', 'full_database'] }
    }, {
      manifests: mockManifests,
      parentEnvelope
    });
  }, AuthorityExpansionError);

  // 8. Child expanding timeBudgetMs
  assert.throws(() => {
    planRoute({
      mode: 'manual',
      destinations: ['agr-1'],
      budget: { timeBudgetMs: 25000 } // parent is 20000
    }, {
      manifests: mockManifests,
      parentEnvelope
    });
  }, BudgetExceededError);

  // 9. Child expanding tokenBudget
  assert.throws(() => {
    planRoute({
      mode: 'manual',
      destinations: ['agr-1'],
      budget: { tokenBudget: 6000 } // parent is 5000
    }, {
      manifests: mockManifests,
      parentEnvelope
    });
  }, BudgetExceededError);

  // 10. Child expanding maxProviderAttempts
  assert.throws(() => {
    planRoute({
      mode: 'manual',
      destinations: ['agr-1'],
      budget: { maxProviderAttempts: 3 } // parent is 2
    }, {
      manifests: mockManifests,
      parentEnvelope
    });
  }, BudgetExceededError);
});

test('IFZ Route Planner - Public Route Preview Strict Explicit Allowlist', () => {
  const plan = planRoute({
    routeId: 'route_preview_safe',
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'manual',
    strategy: 'sequential',
    prompt: 'SUPER_SECRET_USER_PROMPT_DO_NOT_LEAK',
    destinations: [{ workerId: 'agr-1', prompt: 'STEP_SECRET_INSTRUCTION' }]
  }, { manifests: mockManifests });

  // Adversarially inject sensitive fields directly onto plan object
  const toxicPlan = {
    ...plan,
    rawReasoning: 'SECRET_THOUGHT_TRACE',
    modelThinking: '<thinking>private chain of thought</thinking>',
    apiKey: 'sk-1234567890abcdef',
    token: 'ghp_secret_access_token',
    password: 'super_secure_password',
    fileContents: 'const x = "classified_code_buffer";'
  };

  const preview = createRoutePreview(toxicPlan);

  // Verify that preview only contains explicit allowlisted keys
  const allowedTopLevelKeys = new Set([
    'routeId',
    'runId',
    'conversationId',
    'projectId',
    'workspaceId',
    'mode',
    'strategy',
    'isProposal',
    'createdAt',
    'routeHash',
    'stepCount',
    'limits',
    'authority',
    'budget',
    'steps',
    'summary'
  ]);

  for (const key of Object.keys(preview)) {
    assert.ok(allowedTopLevelKeys.has(key), `Key '${key}' is not in explicit allowlist`);
  }

  // Serialized preview must not contain any trace of secret or prompt tokens
  const jsonStr = JSON.stringify(preview);
  assert.ok(!jsonStr.includes('SUPER_SECRET_USER_PROMPT_DO_NOT_LEAK'));
  assert.ok(!jsonStr.includes('STEP_SECRET_INSTRUCTION'));
  assert.ok(!jsonStr.includes('SECRET_THOUGHT_TRACE'));
  assert.ok(!jsonStr.includes('sk-1234567890abcdef'));
  assert.ok(!jsonStr.includes('ghp_secret_access_token'));
  assert.ok(!jsonStr.includes('super_secure_password'));
  assert.ok(!jsonStr.includes('classified_code_buffer'));
});
