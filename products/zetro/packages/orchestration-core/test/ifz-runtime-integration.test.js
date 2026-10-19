import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WorkerRegistry,
  validateWorkerManifest,
  createWorkerManifest,
  createDeliveryReceipt,
  validateDeliveryReceipt,
  ROUTING_MODES,
  CANONICAL_EXECUTION_STRATEGIES,
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
  checkWorkerFreshness,
  checkWorkerQualification,
  checkCapabilityCompatibility,
  checkBudgetLimits,
  checkLimitsMonotonicity,
  detectCircularRoute,
  validateRoutePlan,
  planRoute,
  revalidateSavedWorkflow,
  SAVED_WORKFLOW_TEMPLATES,
  buildFreshWorkerPackage,
  createWorkerAcknowledgment,
  verifyWorkerAcknowledgment,
  createCharter,
  createWorkerKnowledge,
  createProjectContext,
  createTaskPackage,
  applyPreset,
  getPreset,
  MAX_ENTRY_BOUNDS
} from '../src/index.js';

/**
 * Pure In-Memory Fake-Adapter Lifecycle Integration Harness for IFZ Core.
 *
 * Implements:
 * 1. Worker Context Admission & Acknowledgment Verification.
 * 2. Route Planning & Proposal-Only Gating for Automatic Mode.
 * 3. Route Effect Boundary Enforcement: rejects stale, unavailable, unqualified, wrong workspace/project in ALL modes.
 * 4. Dispatched Task Lifecycle State Machine: submitted -> uncertain -> completed / cancelled / late-result.
 * 5. Explicit Reconciliation with Strict No Blind Resend.
 * 6. Pure in-memory operation: zero network, subprocess, or native OS effects.
 */
class IfzLifecycleHarness {
  constructor({ registry, now = Date.now(), maxStalenessMs = DEFAULT_MAX_STALENESS_MS } = {}) {
    this.registry = registry || new WorkerRegistry();
    this.now = now;
    this.maxStalenessMs = maxStalenessMs;
    this.tasks = new Map();
    this.admittedWorkers = new Map();
    this.lateResults = [];
    this.eventLog = [];
    this.approvedPlans = new Set();
    this.adapterExecutions = new Map(); // simulated adapter backend state
  }

  /**
   * Admits a worker via Context Package generation and strict Acknowledgment Verification.
   */
  admitWorker(workerId, {
    project = 'proj-zetro',
    workspace = 'ws-zetro',
    task = { taskId: 't-init', userObjective: 'Initialize worker' },
    routePosition = { index: 1, total: 1 },
    preset = 'ZETRO Standard',
    ackOverrides = {}
  } = {}) {
    const manifest = this.registry.get(workerId);
    if (!manifest) {
      throw new RouteValidationError(`Cannot admit unregistered worker '${workerId}'`);
    }

    if (manifest.workspaceId && manifest.workspaceId !== workspace) {
      throw new WorkspaceMismatchError(
        `Workspace mismatch during admission: worker '${workerId}' is bound to workspace '${manifest.workspaceId}', but admission requested '${workspace}'`,
        { workerId, workerWorkspace: manifest.workspaceId, requestedWorkspace: workspace }
      );
    }
    if (manifest.projectId && manifest.projectId !== project) {
      throw new WorkspaceMismatchError(
        `Project mismatch during admission: worker '${workerId}' is bound to project '${manifest.projectId}', but admission requested '${project}'`,
        { workerId, workerProject: manifest.projectId, requestedProject: project }
      );
    }

    const pkg = buildFreshWorkerPackage({
      worker: {
        workerId: manifest.workerId,
        workerType: manifest.workerType,
        adapterId: manifest.adapterId,
        capabilities: manifest.capabilities || {}
      },
      adapter: manifest.adapterId,
      project,
      workspace,
      task,
      routePosition,
      preset
    });

    const baseAck = createWorkerAcknowledgment({
      workerId: pkg.bindings.workerId,
      workspace: pkg.bindings.workspace,
      taskId: pkg.bindings.taskId,
      scope: {
        ownedPaths: [...pkg.scope.ownedPaths],
        allowedActions: [...pkg.scope.allowedActions],
        readOnly: pkg.scope.readOnly
      },
      contextVersion: pkg.bindings.contextVersions.compositeVersion
    });

    const ack = Object.keys(ackOverrides).length > 0
      ? { ...baseAck, ...ackOverrides }
      : baseAck;

    const verification = verifyWorkerAcknowledgment(pkg, ack);
    if (!verification.valid) {
      throw new Error(`Worker admission rejected: ${verification.reason}`);
    }

    this.admittedWorkers.set(workerId, { pkg, ack, verifiedAt: this.now });
    return { pkg, ack, verification };
  }

  /**
   * Plans a route using the canonical IFZ Route Planner.
   */
  proposeRoute(params, options = {}) {
    return planRoute(params, {
      manifests: this.registry.list(),
      now: this.now,
      maxStalenessMs: this.maxStalenessMs,
      ...options
    });
  }

  /**
   * Explicitly approves an automatic mode proposal, unlocking it for effect dispatch.
   */
  approveProposal(plan) {
    if (!plan || !plan.routeId) {
      throw new Error('Valid route plan is required for proposal approval');
    }
    this.approvedPlans.add(plan.routeId);
    return Object.freeze({
      ...plan,
      isProposal: false,
      status: 'approved'
    });
  }

  /**
   * Effect Boundary Enforcement: Reconciles and verifies all destination workers
   * before any effect dispatch can take place across ALL routing modes.
   */
  validateAtEffectBoundary(plan) {
    if (!plan || typeof plan !== 'object') {
      throw new RouteValidationError('RoutePlan is required at effect boundary');
    }

    // Automatic mode must be explicitly approved before effect dispatch
    if (plan.mode === 'automatic' && !this.approvedPlans.has(plan.routeId)) {
      throw new RouteValidationError(
        `Automatic route '${plan.routeId}' is proposal-only and cannot execute effects without explicit approval`,
        { routeId: plan.routeId, mode: 'automatic', isProposal: true }
      );
    }

    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    for (const step of steps) {
      const manifest = this.registry.get(step.workerId);
      if (!manifest) {
        throw new RouteValidationError(
          `Destination worker '${step.workerId}' is not registered in worker registry`,
          { workerId: step.workerId }
        );
      }

      // Exact workspace and project binding
      if (manifest.workspaceId !== plan.workspaceId) {
        throw new WorkspaceMismatchError(
          `Workspace mismatch: worker '${step.workerId}' is bound to workspace '${manifest.workspaceId}', but route requires '${plan.workspaceId}'`,
          { workerId: step.workerId, workerWorkspace: manifest.workspaceId, routeWorkspace: plan.workspaceId }
        );
      }
      if (manifest.projectId !== plan.projectId) {
        throw new WorkspaceMismatchError(
          `Project mismatch: worker '${step.workerId}' is bound to project '${manifest.projectId}', but route requires '${plan.projectId}'`,
          { workerId: step.workerId, workerProject: manifest.projectId, routeProject: plan.projectId }
        );
      }

      // Check qualification
      if (manifest.isQualified === false || manifest.qualification?.status === 'failed' || manifest.qualification?.level === 'unqualified') {
        throw new CapabilityMismatchError(
          `Worker '${step.workerId}' is explicitly marked unqualified at route effect boundary`,
          { workerId: step.workerId, qualification: manifest.qualification }
        );
      }
      checkWorkerQualification(manifest);

      // Check observation freshness
      const observedAt = manifest.availability?.observedAt ?? manifest.observation?.observedAt;
      if (typeof observedAt === 'number') {
        const age = this.now - observedAt;
        if (age > this.maxStalenessMs) {
          throw new WorkerUnavailableError(
            `Worker '${step.workerId}' availability is stale (${Math.round(age / 1000)}s old > ${Math.round(this.maxStalenessMs / 1000)}s limit)`,
            { workerId: step.workerId, ageMs: age, maxStalenessMs: this.maxStalenessMs }
          );
        }
      }
      checkWorkerFreshness({
        ...manifest,
        availability: manifest.availability || manifest.observation
      }, {
        now: this.now,
        maxStalenessMs: this.maxStalenessMs
      });

      // At effect boundary, ALL modes must reject unavailable/offline workers
      const status = manifest.availability?.status ?? manifest.observation?.status;
      if (status === 'unavailable' || status === 'offline') {
        throw new WorkerUnavailableError(
          `Worker '${step.workerId}' is unavailable at route effect boundary (status: '${status}')`,
          { workerId: step.workerId, status }
        );
      }

      // Capability compatibility
      if (Array.isArray(step.requiredCapabilities) && step.requiredCapabilities.length > 0) {
        checkCapabilityCompatibility(manifest, step.requiredCapabilities);
      }
    }

    return true;
  }

  /**
   * Submits a step for dispatch to a worker adapter.
   */
  submitTask({ taskId, runId = 'run-default', routeId = 'route-default', conversationId = 'conv-default', stepId, workerId, dependsOn = [] }) {
    // Verify dependencies
    for (const depId of dependsOn) {
      const depTask = this.tasks.get(depId);
      if (!depTask || depTask.state !== 'completed') {
        throw new Error(`Cannot submit step '${stepId}': dependency '${depId}' is not completed`);
      }
    }

    const existing = this.tasks.get(taskId);
    if (existing) {
      if (existing.state === 'uncertain') {
        throw new Error(
          `Cannot blindly resend task '${taskId}' in 'uncertain' state; explicit reconciliation required`
        );
      }
      if (existing.state === 'completed') {
        throw new Error(`Cannot submit task '${taskId}': task is already completed`);
      }
    }

    const taskRecord = {
      taskId,
      runId,
      routeId,
      conversationId,
      stepId,
      workerId,
      state: 'submitted',
      attempts: (existing?.attempts || 0) + 1,
      receipt: null,
      submittedAt: this.now,
      history: [...(existing?.history || []), { state: 'submitted', timestamp: this.now }]
    };

    this.tasks.set(taskId, taskRecord);
    this.adapterExecutions.set(taskId, { executed: true, resultReady: false });
    this.eventLog.push({ type: 'worker_request', taskId, workerId, timestamp: this.now });
    return taskRecord;
  }

  /**
   * Simulates an uncertain transition (network timeout, adapter crash).
   */
  simulateUncertain(taskId, reason = 'adapter_timeout') {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);
    if (task.state !== 'submitted') {
      throw new Error(`Cannot transition task '${taskId}' to uncertain from state '${task.state}'`);
    }

    task.state = 'uncertain';
    task.uncertainReason = reason;
    task.history.push({ state: 'uncertain', reason, timestamp: this.now });
    this.eventLog.push({ type: 'uncertain_event', taskId, reason, timestamp: this.now });
    return task;
  }

  /**
   * Explicit reconciliation: Inspects adapter status and reconciles uncertain task.
   */
  reconcile(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    const adapterState = this.adapterExecutions.get(taskId);
    if (adapterState && adapterState.resultReady && adapterState.receipt) {
      task.state = 'completed';
      task.receipt = adapterState.receipt;
      task.history.push({ state: 'completed', reconciled: true, timestamp: this.now });
      this.eventLog.push({ type: 'reconciliation_success', taskId, state: 'completed', timestamp: this.now });
      return { reconciled: true, state: 'completed', receipt: task.receipt };
    }

    // Work was not finalized on adapter
    task.state = 'reconciled_unresolved';
    task.history.push({ state: 'reconciled_unresolved', timestamp: this.now });
    return { reconciled: true, state: 'reconciled_unresolved' };
  }

  /**
   * Completes task execution and attaches cryptographic delivery receipt.
   */
  completeTask(taskId, {
    modifiedFiles = [],
    checks = [{ name: 'unit_tests', command: 'node --test', passed: true, durationMs: 12 }],
    summary = 'Step execution completed cleanly'
  } = {}) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);
    if (task.state === 'cancelled') {
      throw new Error(`Cannot complete cancelled task '${taskId}'`);
    }

    const allPassed = checks.length > 0 && checks.every(c => c.passed);
    const receipt = createDeliveryReceipt({
      receiptId: `rcpt-${taskId}`,
      taskId,
      runId: task.runId || 'run-default',
      conversationId: task.conversationId || 'conv-default',
      workerId: task.workerId,
      status: 'completed',
      delivered: true,
      effectsObserved: true,
      appliedEffects: ['read', 'write'],
      verification: {
        verified: allPassed,
        verifierId: 'rct-verifier',
        checksPassed: checks.filter(c => c.passed).length,
        checksFailed: checks.filter(c => !c.passed).length
      },
      dispatchedAt: task.submittedAt || (this.now - 1000),
      completedAt: this.now
    });

    validateDeliveryReceipt(receipt, { verifyDigest: true });

    task.state = 'completed';
    task.receipt = receipt;
    task.history.push({ state: 'completed', timestamp: this.now });

    const adapterState = this.adapterExecutions.get(taskId) || {};
    adapterState.resultReady = true;
    adapterState.receipt = receipt;
    this.adapterExecutions.set(taskId, adapterState);

    this.eventLog.push({
      type: 'worker_result',
      taskId,
      workerId: task.workerId,
      receiptId: receipt.receiptId,
      timestamp: this.now
    });
    return receipt;
  }

  /**
   * Cancels an ongoing task with a cancellationId.
   */
  cancelTask(taskId, cancellationId = 'cancel-001') {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);
    if (task.state === 'completed') {
      throw new Error(`Cannot cancel already completed task '${taskId}'`);
    }

    task.state = 'cancelled';
    task.cancellationId = cancellationId;
    task.history.push({ state: 'cancelled', cancellationId, timestamp: this.now });
    this.eventLog.push({ type: 'cancellation', taskId, cancellationId, timestamp: this.now });
    return task;
  }

  /**
   * Handles late result arrival for a cancelled or timed-out task.
   * Guaranteed to preserve terminal cancelled state without mutation.
   */
  handleLateResult(taskId, lateData = {}) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    const lateEntry = {
      taskId,
      workerId: task.workerId,
      resultData: lateData,
      preservedTaskState: task.state,
      receivedAt: this.now
    };
    this.lateResults.push(lateEntry);
    this.eventLog.push({ type: 'late_result_recorded', taskId, preservedState: task.state, timestamp: this.now });

    // Terminal state remains cancelled
    return lateEntry;
  }
}

// Helper to seed canonical workers in registry
function seedStandardWorkers(registry, now = Date.now()) {
  const workers = [
    {
      workerId: 'AGR-1',
      workerType: 'architect',
      adapterId: 'antigravity-adapter',
      workspaceId: 'ws-zetro',
      projectId: 'proj-zetro',
      capabilities: { effects: ['read', 'write', 'execute'], actions: ['build', 'refine'], canDelegate: true },
      observation: { status: 'available', observedAt: now - 5000 },
      qualification: { roles: ['builder', 'lead'], level: 'lead' }
    },
    {
      workerId: 'AGR-2',
      workerType: 'developer',
      adapterId: 'antigravity-adapter',
      workspaceId: 'ws-zetro',
      projectId: 'proj-zetro',
      capabilities: { effects: ['read', 'write'], actions: ['code', 'patch'] },
      observation: { status: 'available', observedAt: now - 2000 },
      qualification: { roles: ['developer'], level: 'senior' }
    },
    {
      workerId: 'AGR-3',
      workerType: 'core-engineer',
      adapterId: 'antigravity-adapter',
      workspaceId: 'ws-zetro',
      projectId: 'proj-zetro',
      capabilities: { effects: ['read', 'write', 'execute'], actions: ['orchestrate'] },
      observation: { status: 'available', observedAt: now - 1000 },
      qualification: { roles: ['core'], level: 'lead' }
    },
    {
      workerId: 'AGR-4',
      workerType: 'shell-specialist',
      adapterId: 'antigravity-adapter',
      workspaceId: 'ws-zetro',
      projectId: 'proj-zetro',
      capabilities: { effects: ['read', 'write'], actions: ['ui-shell'] },
      observation: { status: 'available', observedAt: now - 3000 },
      qualification: { roles: ['frontend'], level: 'standard' }
    },
    {
      workerId: 'AGR-5',
      workerType: 'product-designer',
      adapterId: 'antigravity-adapter',
      workspaceId: 'ws-zetro',
      projectId: 'proj-zetro',
      capabilities: { effects: ['read', 'write'], actions: ['design', 'spec'] },
      observation: { status: 'available', observedAt: now - 1500 },
      qualification: { roles: ['designer', 'planner'], level: 'standard' }
    },
    {
      workerId: 'OCR-1',
      workerType: 'code-reviewer',
      adapterId: 'open-code-review-adapter',
      workspaceId: 'ws-zetro',
      projectId: 'proj-zetro',
      capabilities: { effects: ['read'], actions: ['review', 'audit'] },
      observation: { status: 'available', observedAt: now - 4000 },
      qualification: { roles: ['reviewer'], level: 'lead' }
    },
    {
      workerId: 'OCR-2',
      workerType: 'verification-reviewer',
      adapterId: 'open-code-review-adapter',
      workspaceId: 'ws-zetro',
      projectId: 'proj-zetro',
      capabilities: { effects: ['read'], actions: ['verify', 'inspect'] },
      observation: { status: 'available', observedAt: now - 2500 },
      qualification: { roles: ['verifier'], level: 'senior' }
    },
    {
      workerId: 'RCT',
      workerType: 'qualification-verifier',
      adapterId: 'rct-native-adapter',
      workspaceId: 'ws-zetro',
      projectId: 'proj-zetro',
      capabilities: { effects: ['read', 'execute', 'computer'], actions: ['test', 'qualify'] },
      observation: { status: 'available', observedAt: now - 500 },
      qualification: { roles: ['tester', 'verifier'], level: 'lead' }
    }
  ];

  for (const w of workers) {
    registry.register({
      ...w,
      capabilities: {
        canDelegate: false,
        supportsCancellation: true,
        supportsResume: true,
        ...w.capabilities
      }
    });
  }
}

// -----------------------------------------------------------------------------
// Integration Test Suite
// -----------------------------------------------------------------------------

test('IFZ Lifecycle: Manual AGR2 -> OCR1 sequential workflow execution', () => {
  const now = 1710000000000;
  const registry = new WorkerRegistry();
  seedStandardWorkers(registry, now);
  const harness = new IfzLifecycleHarness({ registry, now });

  // 1. Admit workers with context packages and verified acknowledgments
  const adm1 = harness.admitWorker('AGR-2', { task: { taskId: 'task-impl', userObjective: 'Implement slice' } });
  assert.equal(adm1.verification.valid, true);
  assert.equal(adm1.verification.evidenceType, 'admission_evidence');

  const adm2 = harness.admitWorker('OCR-1', { task: { taskId: 'task-review', userObjective: 'Review slice' } });
  assert.equal(adm2.verification.valid, true);
  assert.equal(adm2.verification.evidenceType, 'admission_evidence');

  // 2. Propose manual route AGR2 -> OCR1
  const plan = harness.proposeRoute({
    routeId: 'route-agr2-ocr1',
    runId: 'run-001',
    conversationId: 'conv-001',
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'manual',
    strategy: 'sequential',
    prompt: 'Implement and review change',
    destinations: [
      { stepId: 'step-impl', workerId: 'AGR-2', taskId: 'task-impl', requiredCapabilities: ['write'], dependsOn: [] },
      { stepId: 'step-rev', workerId: 'OCR-1', taskId: 'task-review', requiredCapabilities: ['read'], dependsOn: ['step-impl'] }
    ]
  });

  // 3. Effect boundary validation
  assert.doesNotThrow(() => harness.validateAtEffectBoundary(plan));

  // 4. Dispatch Step 1 (AGR-2)
  const t1 = harness.submitTask({ taskId: 'task-impl', runId: 'run-001', routeId: plan.routeId, stepId: 'step-impl', workerId: 'AGR-2' });
  assert.equal(t1.state, 'submitted');
  const rcpt1 = harness.completeTask('task-impl', { modifiedFiles: ['src/feature.js'] });
  assert.equal(rcpt1.status, 'completed');
  assert.equal(harness.tasks.get('task-impl').state, 'completed');

  // 5. Dispatch Step 2 (OCR-1) once Step 1 is completed
  const t2 = harness.submitTask({ taskId: 'task-review', runId: 'run-001', routeId: plan.routeId, stepId: 'step-rev', workerId: 'OCR-1', dependsOn: ['task-impl'] });
  assert.equal(t2.state, 'submitted');
  const rcpt2 = harness.completeTask('task-review', { checks: [{ name: 'code_review', command: 'ocr check', passed: true, durationMs: 40 }] });
  assert.equal(rcpt2.status, 'completed');
  assert.equal(rcpt2.verification.verified, true);
  assert.equal(harness.tasks.get('task-review').state, 'completed');
});

test('IFZ Lifecycle: Bounded parallel execution RCT -> AGR1-5 and branch overflow rejection', () => {
  const now = 1710000000000;
  const registry = new WorkerRegistry();
  seedStandardWorkers(registry, now);
  const harness = new IfzLifecycleHarness({ registry, now });

  const workerIds = ['AGR-1', 'AGR-2', 'AGR-3', 'AGR-4', 'AGR-5'];
  for (const wid of workerIds) {
    harness.admitWorker(wid, { task: { taskId: `t-${wid}`, userObjective: `Task for ${wid}` } });
  }

  // 1. Valid parallel route with exactly 5 branches (within maxActiveBranches = 5)
  const validParallelPlan = harness.proposeRoute({
    routeId: 'route-parallel-5',
    runId: 'run-par',
    conversationId: 'conv-par',
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'manual',
    strategy: 'parallel',
    prompt: 'Execute parallel probes',
    destinations: workerIds.map((wid, idx) => ({
      stepId: `step-${idx + 1}`,
      workerId: wid,
      taskId: `t-${wid}`,
      requiredCapabilities: ['read'],
      dependsOn: []
    }))
  });

  assert.doesNotThrow(() => harness.validateAtEffectBoundary(validParallelPlan));

  // Dispatch all 5 in parallel
  for (let i = 0; i < workerIds.length; i++) {
    const wid = workerIds[i];
    const task = harness.submitTask({
      taskId: `t-${wid}`,
      runId: 'run-par',
      routeId: validParallelPlan.routeId,
      stepId: `step-${i + 1}`,
      workerId: wid
    });
    assert.equal(task.state, 'submitted');
    harness.completeTask(`t-${wid}`, { summary: `Probe completed by ${wid}` });
    assert.equal(harness.tasks.get(`t-${wid}`).state, 'completed');
  }

  // 2. Branch overflow rejection: 6 root parallel branches exceeds maxActiveBranches (5)
  assert.throws(() => {
    harness.proposeRoute({
      routeId: 'route-overflow',
      runId: 'run-over',
      conversationId: 'conv-over',
      projectId: 'proj-zetro',
      workspaceId: 'ws-zetro',
      mode: 'manual',
      strategy: 'parallel',
      prompt: 'Excessive branch test',
      limits: { maxActiveBranches: 5 },
      destinations: [
        ...workerIds.map((wid, idx) => ({
          stepId: `step-${idx + 1}`,
          workerId: wid,
          taskId: `t-${wid}-overflow`,
          dependsOn: []
        })),
        { stepId: 'step-6', workerId: 'OCR-1', taskId: 't-ocr1-overflow', dependsOn: [] }
      ]
    });
  }, RouteValidationError);
});

test('IFZ Lifecycle: AGR5 -> AGR1 -> OCR2 -> RCT review chain pipeline', () => {
  const now = 1710000000000;
  const registry = new WorkerRegistry();
  seedStandardWorkers(registry, now);
  const harness = new IfzLifecycleHarness({ registry, now });

  const pipeline = [
    { wid: 'AGR-5', taskId: 't-design', stepId: 's1', reqCaps: ['write'] },
    { wid: 'AGR-1', taskId: 't-build', stepId: 's2', reqCaps: ['write'], dep: 't-design' },
    { wid: 'OCR-2', taskId: 't-verify', stepId: 's3', reqCaps: ['read'], dep: 't-build' },
    { wid: 'RCT', taskId: 't-qualify', stepId: 's4', reqCaps: ['execute'], dep: 't-verify' }
  ];

  for (const stage of pipeline) {
    harness.admitWorker(stage.wid, { task: { taskId: stage.taskId, userObjective: `Stage ${stage.stepId}` } });
  }

  const plan = harness.proposeRoute({
    routeId: 'route-review-chain',
    runId: 'run-chain',
    conversationId: 'conv-chain',
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'manual',
    strategy: 'review-chain',
    prompt: 'Execute full architectural review pipeline',
    destinations: [
      { stepId: 's1', workerId: 'AGR-5', taskId: 't-design', requiredCapabilities: ['write'], dependsOn: [] },
      { stepId: 's2', workerId: 'AGR-1', taskId: 't-build', requiredCapabilities: ['write'], dependsOn: ['s1'] },
      { stepId: 's3', workerId: 'OCR-2', taskId: 't-verify', requiredCapabilities: ['read'], dependsOn: ['s2'] },
      { stepId: 's4', workerId: 'RCT', taskId: 't-qualify', requiredCapabilities: ['execute'], dependsOn: ['s3'] }
    ]
  });

  assert.doesNotThrow(() => harness.validateAtEffectBoundary(plan));

  // Stage 1: AGR-5
  harness.submitTask({ taskId: 't-design', runId: 'run-chain', routeId: plan.routeId, stepId: 's1', workerId: 'AGR-5' });
  harness.completeTask('t-design', { modifiedFiles: ['docs/design.md'] });

  // Stage 2: AGR-1
  harness.submitTask({ taskId: 't-build', runId: 'run-chain', routeId: plan.routeId, stepId: 's2', workerId: 'AGR-1', dependsOn: ['t-design'] });
  harness.completeTask('t-build', { modifiedFiles: ['src/core.js'] });

  // Stage 3: OCR-2
  harness.submitTask({ taskId: 't-verify', runId: 'run-chain', routeId: plan.routeId, stepId: 's3', workerId: 'OCR-2', dependsOn: ['t-build'] });
  harness.completeTask('t-verify', { checks: [{ name: 'ocr_audit', command: 'audit', passed: true, durationMs: 15 }] });

  // Stage 4: RCT
  harness.submitTask({ taskId: 't-qualify', runId: 'run-chain', routeId: plan.routeId, stepId: 's4', workerId: 'RCT', dependsOn: ['t-verify'] });
  const finalRcpt = harness.completeTask('t-qualify', {
    checks: [{ name: 'rct_conformance', command: 'rct test', passed: true, durationMs: 50 }]
  });

  assert.equal(finalRcpt.status, 'completed');
  assert.equal(finalRcpt.verification.verified, true);
  assert.equal(harness.tasks.get('t-qualify').state, 'completed');
});

test('IFZ Lifecycle: Automatic mode proposal-only boundary enforcement', () => {
  const now = 1710000000000;
  const registry = new WorkerRegistry();
  seedStandardWorkers(registry, now);
  const harness = new IfzLifecycleHarness({ registry, now });

  harness.admitWorker('AGR-3', { task: { taskId: 't-auto', userObjective: 'Auto test' } });

  // Propose route in automatic mode
  const autoPlan = harness.proposeRoute({
    routeId: 'route-auto-001',
    runId: 'run-auto',
    conversationId: 'conv-auto',
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'automatic',
    prompt: 'Automatic planned route',
    requiredCapabilities: ['read']
  });

  assert.equal(autoPlan.mode, 'automatic');
  assert.equal(autoPlan.isProposal, true);
  assert.equal(autoPlan.status, 'proposed');

  // Attempting to execute effects on unapproved proposal must throw
  assert.throws(() => {
    harness.validateAtEffectBoundary(autoPlan);
  }, RouteValidationError);

  // Once explicitly approved, effect boundary passes
  const approvedPlan = harness.approveProposal(autoPlan);
  assert.equal(approvedPlan.status, 'approved');
  assert.doesNotThrow(() => harness.validateAtEffectBoundary(approvedPlan));
});

test('IFZ Lifecycle: Saved-workflow revalidation at use time', () => {
  const now = 1710000000000;
  const registry = new WorkerRegistry();
  seedStandardWorkers(registry, now);

  const template = SAVED_WORKFLOW_TEMPLATES['standard-review-chain'];
  assert.ok(template);

  const plan = {
    routeId: 'rw-saved-001',
    runId: 'run-s1',
    conversationId: 'c-s1',
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'saved-workflow',
    strategy: template.strategy,
    steps: [
      { stepId: 's1', workerId: 'AGR-1', taskId: 't1', requiredCapabilities: ['write'], dependsOn: [] },
      { stepId: 's2', workerId: 'OCR-1', taskId: 't2', requiredCapabilities: ['read'], dependsOn: ['s1'] }
    ]
  };

  // 1. Fresh live workers -> revalidation passes
  const manifests = new Map(registry.list().map(m => [m.workerId, m]));
  assert.doesNotThrow(() => {
    revalidateSavedWorkflow(plan, { manifests, now });
  });

  // 2. If reviewer worker becomes stale (> 300,000ms old) -> rejected
  const staleManifests = new Map(registry.list().map(m => [m.workerId, { ...m }]));
  staleManifests.set('OCR-1', {
    ...staleManifests.get('OCR-1'),
    availability: { status: 'available', observedAt: now - 400000 },
    observation: { status: 'available', observedAt: now - 400000 }
  });
  assert.throws(() => {
    revalidateSavedWorkflow(plan, { manifests: staleManifests, now });
  }, WorkerUnavailableError);

  // 3. If worker becomes unavailable -> rejected
  const unavailManifests = new Map(registry.list().map(m => [m.workerId, { ...m }]));
  unavailManifests.set('OCR-1', {
    ...unavailManifests.get('OCR-1'),
    availability: { status: 'unavailable', observedAt: now - 1000 },
    observation: { status: 'unavailable', observedAt: now - 1000 }
  });
  assert.throws(() => {
    revalidateSavedWorkflow(plan, { manifests: unavailManifests, now });
  }, WorkerUnavailableError);
});

test('IFZ Lifecycle: Route Effect Boundary Negatives across all modes', () => {
  const now = 1710000000000;

  for (const mode of ROUTING_MODES) {
    const registry = new WorkerRegistry();
    seedStandardWorkers(registry, now);
    const harness = new IfzLifecycleHarness({ registry, now });

    const createPlanForWorker = (workerId, requiredCapabilities = []) => ({
      routeId: `route-${mode}-${workerId}`,
      runId: `run-${mode}`,
      conversationId: `conv-${mode}`,
      projectId: 'proj-zetro',
      workspaceId: 'ws-zetro',
      mode,
      strategy: 'sequential',
      steps: [{ stepId: 's1', workerId, taskId: `t-${workerId}`, requiredCapabilities, dependsOn: [] }]
    });

    // A. Stale Worker Rejected
    registry.replace({
      ...registry.get('AGR-2'),
      revision: 2,
      observation: { status: 'available', observedAt: now - 350000 },
      availability: { status: 'available', observedAt: now - 350000 }
    }, 1);
    const pStale = createPlanForWorker('AGR-2');
    if (mode === 'automatic') harness.approveProposal(pStale);
    assert.throws(() => harness.validateAtEffectBoundary(pStale), WorkerUnavailableError);

    // B. Unavailable / Offline Worker Rejected
    registry.replace({
      ...registry.get('OCR-1'),
      revision: 2,
      observation: { status: 'offline', observedAt: now - 1000 },
      availability: { status: 'offline', observedAt: now - 1000 }
    }, 1);
    const pOffline = createPlanForWorker('OCR-1');
    if (mode === 'automatic') harness.approveProposal(pOffline);
    assert.throws(() => harness.validateAtEffectBoundary(pOffline), WorkerUnavailableError);

    // C. Unqualified Worker Rejected
    registry.replace({
      ...registry.get('AGR-4'),
      revision: 2,
      qualification: { roles: ['frontend'], certifications: [], tags: [], level: 'unqualified' }
    }, 1);
    const pUnqual = createPlanForWorker('AGR-4');
    if (mode === 'automatic') harness.approveProposal(pUnqual);
    assert.throws(() => harness.validateAtEffectBoundary(pUnqual), CapabilityMismatchError);

    // D. Wrong Workspace Rejected
    registry.replace({
      ...registry.get('AGR-5'),
      revision: 2,
      workspaceId: 'ws-other-environment'
    }, 1);
    const pWrongWs = createPlanForWorker('AGR-5');
    if (mode === 'automatic') harness.approveProposal(pWrongWs);
    assert.throws(() => harness.validateAtEffectBoundary(pWrongWs), WorkspaceMismatchError);

    // E. Wrong Project Rejected
    registry.replace({
      ...registry.get('AGR-1'),
      revision: 2,
      projectId: 'proj-rogue'
    }, 1);
    const pWrongProj = createPlanForWorker('AGR-1');
    if (mode === 'automatic') harness.approveProposal(pWrongProj);
    assert.throws(() => harness.validateAtEffectBoundary(pWrongProj), WorkspaceMismatchError);

    // F. Capability Mismatch Rejected
    // OCR-2 only has 'read'; asking for 'write' and 'computer' must reject
    const pCapMismatch = createPlanForWorker('OCR-2', ['write', 'computer']);
    if (mode === 'automatic') harness.approveProposal(pCapMismatch);
    assert.throws(() => harness.validateAtEffectBoundary(pCapMismatch), CapabilityMismatchError);
  }
});

test('IFZ Lifecycle: Structural Route Negatives (Duplicates, Cycles, Budget Overflows)', () => {
  const now = 1710000000000;
  const registry = new WorkerRegistry();
  seedStandardWorkers(registry, now);
  const manifests = new Map(registry.list().map(m => [m.workerId, m]));

  const basePlan = {
    routeId: 'route-neg-001',
    runId: 'run-neg',
    conversationId: 'conv-neg',
    projectId: 'proj-zetro',
    workspaceId: 'ws-zetro',
    mode: 'manual',
    strategy: 'sequential',
    steps: []
  };

  // 1. Duplicate worker-task pair rejected
  assert.throws(() => {
    validateRoutePlan({
      ...basePlan,
      steps: [
        { stepId: 's1', workerId: 'AGR-1', taskId: 't-dup', dependsOn: [] },
        { stepId: 's2', workerId: 'AGR-1', taskId: 't-dup', dependsOn: ['s1'] }
      ]
    }, { manifests });
  }, DuplicateWorkerTaskError);

  // 2. Direct cycle rejected
  assert.throws(() => {
    detectCircularRoute([
      { stepId: 's1', workerId: 'AGR-1', dependsOn: ['s2'] },
      { stepId: 's2', workerId: 'AGR-2', dependsOn: ['s1'] }
    ]);
  }, CircularRouteError);

  // 3. Indirect cycle rejected (s1 -> s2 -> s3 -> s1)
  assert.throws(() => {
    detectCircularRoute([
      { stepId: 's1', workerId: 'AGR-1', dependsOn: ['s2'] },
      { stepId: 's2', workerId: 'AGR-2', dependsOn: ['s3'] },
      { stepId: 's3', workerId: 'AGR-3', dependsOn: ['s1'] }
    ]);
  }, CircularRouteError);

  // 4. Self dependency rejected
  assert.throws(() => {
    detectCircularRoute([
      { stepId: 's1', workerId: 'AGR-1', dependsOn: ['s1'] }
    ]);
  }, CircularRouteError);

  // 5. Ancestor delegation cycle rejected
  assert.throws(() => {
    detectCircularRoute(
      [{ stepId: 's1', workerId: 'AGR-1', dependsOn: [] }],
      ['parent-lead', 'AGR-1']
    );
  }, CircularRouteError);

  // 6. All budget negatives
  // Time budget exceeded
  assert.throws(() => {
    checkBudgetLimits({ timeBudgetMs: 10000 }, { timeBudgetMs: 10001 });
  }, BudgetExceededError);

  // Token budget exceeded
  assert.throws(() => {
    checkBudgetLimits({ tokenBudget: 5000 }, { tokenBudget: 5001 });
  }, BudgetExceededError);

  // Provider attempts exceeded
  assert.throws(() => {
    checkBudgetLimits({ maxProviderAttempts: 3 }, { maxProviderAttempts: 4 });
  }, BudgetExceededError);

  // Limits monotonicity (maxWorkers)
  assert.throws(() => {
    checkLimitsMonotonicity({ maxWorkers: 3 }, { maxWorkers: 4 });
  }, RouteValidationError);

  // Limits monotonicity (maxActiveBranches)
  assert.throws(() => {
    checkLimitsMonotonicity({ maxActiveBranches: 2 }, { maxActiveBranches: 3 });
  }, RouteValidationError);

  // Limits monotonicity (maxDelegationDepth)
  assert.throws(() => {
    checkLimitsMonotonicity({ maxDelegationDepth: 1 }, { maxDelegationDepth: 2 });
  }, RouteValidationError);
});

test('IFZ Lifecycle: Submitted, Uncertain, Reconciliation, and No Blind Resend', () => {
  const now = 1710000000000;
  const registry = new WorkerRegistry();
  seedStandardWorkers(registry, now);
  const harness = new IfzLifecycleHarness({ registry, now });

  harness.admitWorker('AGR-2', { task: { taskId: 'task-transient', userObjective: 'Transient work' } });

  // 1. Submit task
  const t = harness.submitTask({
    taskId: 'task-transient',
    runId: 'run-t',
    routeId: 'r-t',
    stepId: 's1',
    workerId: 'AGR-2'
  });
  assert.equal(t.state, 'submitted');
  assert.equal(t.attempts, 1);

  // 2. Transient adapter failure -> state becomes 'uncertain'
  harness.simulateUncertain('task-transient', 'gateway_timeout');
  assert.equal(harness.tasks.get('task-transient').state, 'uncertain');

  // 3. Strict No Blind Resend: Attempting to re-submit while uncertain without reconciliation throws
  assert.throws(() => {
    harness.submitTask({
      taskId: 'task-transient',
      runId: 'run-t',
      routeId: 'r-t',
      stepId: 's1',
      workerId: 'AGR-2'
    });
  }, (err) => err.message.includes('Cannot blindly resend task') && err.message.includes('explicit reconciliation required'));

  // 4. Simulate adapter finalizing work in the background
  const adapterState = harness.adapterExecutions.get('task-transient');
  adapterState.resultReady = true;
  adapterState.receipt = createDeliveryReceipt({
    receiptId: 'rcpt-task-transient',
    taskId: 'task-transient',
    runId: 'run-t',
    conversationId: 'conv-t',
    workerId: 'AGR-2',
    status: 'completed',
    delivered: true,
    effectsObserved: true,
    appliedEffects: ['read', 'write'],
    verification: {
      verified: true,
      verifierId: 'rct-verifier',
      checksPassed: 1,
      checksFailed: 0
    },
    dispatchedAt: now - 500,
    completedAt: now
  });

  // 5. Explicit Reconciliation resolves uncertain task to completed
  const recResult = harness.reconcile('task-transient');
  assert.equal(recResult.reconciled, true);
  assert.equal(recResult.state, 'completed');
  assert.equal(harness.tasks.get('task-transient').state, 'completed');
  assert.ok(harness.tasks.get('task-transient').receipt);
});

test('IFZ Lifecycle: Task Cancellation and Deterministic Late Result Handling', () => {
  const now = 1710000000000;
  const registry = new WorkerRegistry();
  seedStandardWorkers(registry, now);
  const harness = new IfzLifecycleHarness({ registry, now });

  harness.admitWorker('AGR-3', { task: { taskId: 'task-cancel', userObjective: 'Cancel work' } });

  // 1. Submit task
  harness.submitTask({
    taskId: 'task-cancel',
    runId: 'run-c',
    routeId: 'r-c',
    stepId: 's1',
    workerId: 'AGR-3'
  });
  assert.equal(harness.tasks.get('task-cancel').state, 'submitted');

  // 2. Cancel task via cancellationId
  harness.cancelTask('task-cancel', 'cancellation-999');
  assert.equal(harness.tasks.get('task-cancel').state, 'cancelled');
  assert.equal(harness.tasks.get('task-cancel').cancellationId, 'cancellation-999');

  // 3. Worker adapter finishes work late and posts result
  const latePayload = { output: 'Late generated diff', completedSteps: 5 };
  const lateReport = harness.handleLateResult('task-cancel', latePayload);

  // Late result is captured in lateResults log
  assert.equal(lateReport.taskId, 'task-cancel');
  assert.equal(lateReport.preservedTaskState, 'cancelled');
  assert.equal(harness.lateResults.length, 1);
  assert.deepEqual(harness.lateResults[0].resultData, latePayload);

  // Crucial invariant: Task state in harness remains strictly 'cancelled' (not mutated to completed)
  assert.equal(harness.tasks.get('task-cancel').state, 'cancelled');

  // Attempting to complete an already cancelled task is rejected
  assert.throws(() => {
    harness.completeTask('task-cancel');
  }, (err) => err.message.includes('Cannot complete cancelled task'));
});

test('IFZ Lifecycle: Context Acknowledgment admission-only semantics and claim rejection', () => {
  const now = 1710000000000;
  const registry = new WorkerRegistry();
  seedStandardWorkers(registry, now);
  const harness = new IfzLifecycleHarness({ registry, now });

  // 1. Valid admission succeeds
  const validAdmission = harness.admitWorker('AGR-1', {
    task: { taskId: 't-valid', userObjective: 'Standard admission' }
  });
  assert.equal(validAdmission.verification.valid, true);
  assert.equal(validAdmission.verification.evidenceType, 'admission_evidence');
  assert.equal(validAdmission.verification.isDispatch, false);
  assert.equal(validAdmission.verification.isCompletion, false);
  assert.equal(validAdmission.verification.isVerification, false);

  // 2. Adversarial: Acknowledgment attempting to claim isDispatch: true rejected
  assert.throws(() => {
    harness.admitWorker('AGR-2', {
      task: { taskId: 't-adv-dispatch', userObjective: 'Adversarial dispatch' },
      ackOverrides: { isDispatch: true }
    });
  }, (err) => err.message.includes('cannot claim dispatch'));

  // 3. Adversarial: Acknowledgment attempting to claim isCompletion: true rejected
  assert.throws(() => {
    harness.admitWorker('AGR-3', {
      task: { taskId: 't-adv-completion', userObjective: 'Adversarial completion' },
      ackOverrides: { isCompletion: true }
    });
  }, (err) => err.message.includes('cannot claim dispatch, completion, or verification'));

  // 4. Adversarial: Acknowledgment attempting to claim isVerification: true rejected
  assert.throws(() => {
    harness.admitWorker('AGR-4', {
      task: { taskId: 't-adv-verif', userObjective: 'Adversarial verification' },
      ackOverrides: { isVerification: true }
    });
  }, (err) => err.message.includes('cannot claim dispatch, completion, or verification'));

  // 5. Mismatched workspace rejected during admission
  assert.throws(() => {
    harness.admitWorker('AGR-5', {
      task: { taskId: 't-mismatch', userObjective: 'Workspace mismatch' },
      workspace: 'ws-unauthorized-target'
    });
  }, (err) => err.message.includes('Workspace mismatch') || err.name === 'WorkspaceMismatchError');
});
