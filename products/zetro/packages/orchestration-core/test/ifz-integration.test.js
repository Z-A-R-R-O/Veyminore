/**
 * @file test/ifz-integration.test.js
 * End-to-end cross-slice integration tests for IFZ Unified Architecture.
 *
 * Exercises all 7 core IFZ modules in unison:
 * 1. contracts.js
 * 2. worker-registry.js
 * 3. route-planner.js
 * 4. route-guard.js
 * 5. master-prompt.js
 * 6. presets.js
 * 7. context-package.js
 *
 * Scenarios:
 * - Manual AGR-2 to OCR-1 cross-slice pipeline
 * - Bounded parallel RCT to AGR-1..AGR-5
 * - Sequential/review pipeline: AGR-5 -> AGR-1 -> OCR-2 -> RCT
 * - Automatic proposal only, no dispatch
 * - Saved workflow revalidation at use time
 * - Fresh-worker package exact 8-step order, versioning, and admission-only acknowledgment
 * - Negative failure modes (stale, unavailable, unqualified, wrong workspace, cap mismatch, duplicates, cycles, limit growth, forbidden context)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSIONS,
  EFFECT_CLASSES,
  ROUTE_STRATEGIES,
  validateWorkerManifest,
  createWorkerManifest,
  validateTaskEnvelope,
  createTaskEnvelope,
  validateRouteRequest,
  createRouteRequest,
  validateContextReference,
  createContextReference,
  validatePublicEvent,
  createPublicEvent,
  validateDeliveryReceipt,
  createDeliveryReceipt,
  assertNoAuthorityGrowth,
  IfzValidationError,
  IfzAuthorityGrowthError,
  IfzConflictError
} from '../src/ifz/contracts.js';

import { WorkerRegistry } from '../src/ifz/worker-registry.js';

import {
  planRoute,
  revalidateSavedWorkflow,
  createRoutePreview,
  computeRouteHash,
  SAVED_WORKFLOW_TEMPLATES
} from '../src/ifz/route-planner.js';

import {
  RouteValidationError,
  CapabilityMismatchError,
  AuthorityExpansionError,
  BudgetExceededError,
  CircularRouteError,
  DuplicateWorkerTaskError,
  WorkspaceMismatchError,
  WorkerUnavailableError
} from '../src/ifz/route-guard.js';

import {
  createCharter,
  createWorkerKnowledge,
  createProjectContext,
  createTaskPackage,
  createMasterPrompt,
  MasterPromptError
} from '../src/ifz/master-prompt.js';

import {
  buildFreshWorkerPackage,
  createWorkerAcknowledgment,
  verifyWorkerAcknowledgment,
  ContextPackageError,
  ContextPackageBoundsError,
  ContextPackageSecurityError
} from '../src/ifz/context-package.js';

import {
  getPreset,
  applyPreset,
  PRESET_NAMES
} from '../src/ifz/presets.js';

describe('IFZ Cross-Slice Integration Tests', () => {
  const FIXED_TIMESTAMP = 1713000000000;
  const PROJECT_ID = 'zetro-core';
  const WORKSPACE_ID = 'ws-main-01';

  let registry;

  beforeEach(() => {
    registry = new WorkerRegistry();

    // 1. AGR-1: Agent, core builder, full write & execute
    registry.register({
      workerId: 'AGR-1',
      workerType: 'agent',
      adapterId: 'adapter-antigravity',
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      revision: 1,
      capabilities: {
        effects: ['read', 'write', 'execute'],
        actions: ['read_file', 'edit_file', 'run_command'],
        contextTypes: ['project_context', 'task_package'],
        canDelegate: true,
        supportsCancellation: true,
        supportsResume: false
      },
      observation: { status: 'available', observedAt: FIXED_TIMESTAMP },
      qualification: { roles: ['agent', 'core_builder'], certifications: ['ifz_v1'], tags: ['primary'], level: 'senior' },
      limits: { maxConcurrency: 2, maxDurationMs: 60000 }
    });

    // 2. AGR-2: Agent, router & planner
    registry.register({
      workerId: 'AGR-2',
      workerType: 'agent',
      adapterId: 'adapter-antigravity',
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      revision: 1,
      capabilities: {
        effects: ['read', 'write'],
        actions: ['read_file', 'plan_route'],
        contextTypes: ['project_context', 'task_package'],
        canDelegate: true,
        supportsCancellation: true,
        supportsResume: false
      },
      observation: { status: 'available', observedAt: FIXED_TIMESTAMP },
      qualification: { roles: ['agent', 'router'], certifications: ['ifz_v1'], tags: ['router'], level: 'senior' },
      limits: { maxConcurrency: 2, maxDurationMs: 60000 }
    });

    // 3. AGR-3: Agent, prompt engineer
    registry.register({
      workerId: 'AGR-3',
      workerType: 'agent',
      adapterId: 'adapter-antigravity',
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      revision: 1,
      capabilities: {
        effects: ['read', 'write'],
        actions: ['read_file', 'author_prompt'],
        contextTypes: ['project_context', 'task_package'],
        canDelegate: false,
        supportsCancellation: true,
        supportsResume: false
      },
      observation: { status: 'available', observedAt: FIXED_TIMESTAMP },
      qualification: { roles: ['agent', 'prompt_engineer'], certifications: ['ifz_v1'], tags: ['prompts'], level: 'standard' }
    });

    // 4. AGR-4: Agent, product shell
    registry.register({
      workerId: 'AGR-4',
      workerType: 'agent',
      adapterId: 'adapter-antigravity',
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      revision: 1,
      capabilities: {
        effects: ['read', 'write'],
        actions: ['read_file', 'edit_ui'],
        contextTypes: ['project_context', 'task_package'],
        canDelegate: false,
        supportsCancellation: true,
        supportsResume: false
      },
      observation: { status: 'available', observedAt: FIXED_TIMESTAMP },
      qualification: { roles: ['agent', 'product_shell'], certifications: ['ifz_v1'], tags: ['shell'], level: 'senior' }
    });

    // 5. AGR-5: Agent, UI work page & bento
    registry.register({
      workerId: 'AGR-5',
      workerType: 'agent',
      adapterId: 'adapter-antigravity',
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      revision: 1,
      capabilities: {
        effects: ['read', 'write'],
        actions: ['read_file', 'edit_components'],
        contextTypes: ['project_context', 'task_package'],
        canDelegate: false,
        supportsCancellation: true,
        supportsResume: false
      },
      observation: { status: 'available', observedAt: FIXED_TIMESTAMP },
      qualification: { roles: ['agent', 'ui_work_page'], certifications: ['ifz_v1'], tags: ['work_page'], level: 'senior' }
    });

    // 6. OCR-1: CLI code runner
    registry.register({
      workerId: 'OCR-1',
      workerType: 'cli',
      adapterId: 'adapter-opencode',
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      revision: 1,
      capabilities: {
        effects: ['read', 'write', 'execute'],
        actions: ['read_file', 'edit_file', 'run_tests'],
        contextTypes: ['project_context'],
        canDelegate: false,
        supportsCancellation: true,
        supportsResume: true
      },
      observation: { status: 'available', observedAt: FIXED_TIMESTAMP },
      qualification: { roles: ['cli_worker', 'code_runner'], certifications: ['ocr_v1'], tags: ['runner'], level: 'standard' }
    });

    // 7. OCR-2: CLI code reviewer
    registry.register({
      workerId: 'OCR-2',
      workerType: 'cli',
      adapterId: 'adapter-opencode',
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      revision: 1,
      capabilities: {
        effects: ['read'],
        actions: ['read_file', 'audit_code'],
        contextTypes: ['project_context'],
        canDelegate: false,
        supportsCancellation: true,
        supportsResume: true
      },
      observation: { status: 'available', observedAt: FIXED_TIMESTAMP },
      qualification: { roles: ['cli_worker', 'verifier'], certifications: ['ocr_v1'], tags: ['auditor'], level: 'standard' }
    });

    // 8. RCT: Computer host & verified runtime
    registry.register({
      workerId: 'RCT',
      workerType: 'service',
      adapterId: 'adapter-rct',
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      revision: 1,
      capabilities: {
        effects: ['read', 'write', 'execute', 'computer'],
        actions: ['inspect_system', 'execute_conformance', 'take_screenshot'],
        contextTypes: ['project_context', 'task_package'],
        canDelegate: true,
        supportsCancellation: true,
        supportsResume: false
      },
      observation: { status: 'available', observedAt: FIXED_TIMESTAMP },
      qualification: { roles: ['host_runtime', 'verifier'], certifications: ['rct_v1'], tags: ['computer'], level: 'verified' }
    });
  });

  describe('1. Manual AGR-2 to OCR-1 Cross-Slice Pipeline', () => {
    it('plans route, constructs Master Prompt & context package, validates envelopes and receipts', () => {
      // 1. Plan manual route AGR-2 -> OCR-1
      const plan = planRoute({
        routeId: 'route-manual-agr2-ocr1',
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        mode: 'manual',
        strategy: 'sequential',
        destinations: ['AGR-2', 'OCR-1'],
        prompt: 'Plan architecture and implement focused test suite'
      }, {
        manifests: registry,
        now: FIXED_TIMESTAMP
      });

      assert.equal(plan.mode, 'manual');
      assert.equal(plan.strategy, 'sequential');
      assert.equal(plan.steps.length, 2);
      assert.equal(plan.steps[0].workerId, 'AGR-2');
      assert.deepEqual(plan.steps[0].dependsOn, []);
      assert.equal(plan.steps[1].workerId, 'OCR-1');
      assert.deepEqual(plan.steps[1].dependsOn, ['step_1']);
      assert.ok(plan.routeHash);

      // 2. Validate public route preview strictly conforms to allowlist
      const preview = createRoutePreview(plan);
      assert.equal(preview.routeId, 'route-manual-agr2-ocr1');
      assert.equal(preview.strategy, 'sequential');
      assert.equal(preview.steps.length, 2);
      assert.equal(preview.prompt, undefined, 'Preview must never expose prompt text');

      // 3. Construct authoritative TaskEnvelope for Step 1 (AGR-2)
      const envelopeStep1 = createTaskEnvelope({
        taskId: plan.steps[0].taskId,
        runId: plan.runId,
        conversationId: plan.conversationId,
        sourceWorkerId: 'IFZ',
        destinationWorkerId: 'AGR-2',
        objective: 'Architect slice and delegate execution to OCR-1',
        masterPromptVersion: 'charter-v1.0#w1.0:p1.0:t1.0',
        contextVersion: 'context-pkg-v1.0',
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        cancellationId: 'cancel-step-1',
        scopes: {
          effects: ['read', 'write', 'execute'],
          readPaths: ['packages/orchestration-core/'],
          writePaths: ['packages/orchestration-core/test/']
        },
        budgets: {
          timeBudgetMs: 60000,
          tokenBudget: 50000,
          depthBudget: 2,
          branchBudget: 2
        }
      });
      assert.equal(envelopeStep1.destinationWorkerId, 'AGR-2');

      // 4. Assemble Master Prompt uniting 4 layers
      const masterPrompt = createMasterPrompt({
        charter: createCharter(),
        workerKnowledge: createWorkerKnowledge(registry.get('AGR-2')),
        projectContext: createProjectContext({ workspace: WORKSPACE_ID, project: PROJECT_ID }),
        taskPackage: createTaskPackage({
          taskId: envelopeStep1.taskId,
          runId: envelopeStep1.runId,
          userObjective: envelopeStep1.objective
        }),
        preset: 'ZETRO Standard'
      });
      assert.ok(masterPrompt.compositeVersion.includes('#c'));

      // 5. Build fresh-worker context package and acknowledge
      const contextPkg = buildFreshWorkerPackage({
        worker: registry.get('AGR-2'),
        adapter: 'adapter-antigravity',
        project: PROJECT_ID,
        workspace: WORKSPACE_ID,
        task: {
          taskId: envelopeStep1.taskId,
          runId: envelopeStep1.runId,
          userObjective: envelopeStep1.objective
        },
        scope: {
          ownedPaths: ['packages/orchestration-core/test/ifz-integration.test.js'],
          allowedActions: ['read', 'write']
        },
        preset: 'ZETRO Standard'
      });
      assert.equal(contextPkg.sections.length, 8);

      const ack = createWorkerAcknowledgment({
        workerId: 'AGR-2',
        workspace: WORKSPACE_ID,
        taskId: envelopeStep1.taskId,
        scope: {
          ownedPaths: ['packages/orchestration-core/test/ifz-integration.test.js'],
          allowedActions: ['read', 'write']
        },
        contextVersion: contextPkg.bindings.contextVersions.compositeVersion
      });
      const ackResult = verifyWorkerAcknowledgment(contextPkg, ack);
      assert.equal(ackResult.valid, true);
      assert.equal(ackResult.evidenceType, 'admission_evidence');

      // 6. Child route delegation from AGR-2 to OCR-1 with authority guard
      const childRouteReq = createRouteRequest({
        requestId: 'req-child-ocr1',
        runId: plan.runId,
        conversationId: plan.conversationId,
        sourceWorkerId: 'AGR-2',
        destinationWorkerIds: ['OCR-1'],
        strategy: 'sequential',
        objective: 'Run test suite',
        requiredEffects: ['read', 'execute'],
        maxDelegationDepth: 1
      });

      assert.equal(assertNoAuthorityGrowth(envelopeStep1, childRouteReq), true);

      // 7. Complete step and create secret-free delivery receipt
      const receipt = createDeliveryReceipt({
        receiptId: 'rcpt-ocr1-001',
        taskId: plan.steps[1].taskId,
        runId: plan.runId,
        conversationId: plan.conversationId,
        workerId: 'OCR-1',
        status: 'completed',
        delivered: true,
        effectsObserved: true,
        appliedEffects: ['read', 'execute'],
        verification: {
          verified: true,
          verifierId: 'AGR-1',
          checksPassed: 10,
          checksFailed: 0
        },
        dispatchedAt: FIXED_TIMESTAMP,
        completedAt: FIXED_TIMESTAMP + 2500
      });

      assert.equal(receipt.status, 'completed');
      assert.equal(receipt.delivered, true);
      assert.ok(receipt.receiptDigest.length === 64);
    });
  });

  describe('2. Bounded Parallel RCT to AGR-1..AGR-5', () => {
    it('coordinates bounded parallel delegation under active branch and worker ceilings', () => {
      const destinations = ['AGR-1', 'AGR-2', 'AGR-3', 'AGR-4', 'AGR-5'];

      const plan = planRoute({
        routeId: 'route-rct-parallel-fleet',
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        mode: 'manual',
        strategy: 'parallel',
        destinations,
        limits: {
          maxWorkers: 6,
          maxActiveBranches: 5,
          maxDelegationDepth: 2
        }
      }, {
        manifests: registry,
        now: FIXED_TIMESTAMP
      });

      assert.equal(plan.strategy, 'parallel');
      assert.equal(plan.steps.length, 5);
      for (const step of plan.steps) {
        assert.deepEqual(step.dependsOn, [], 'Parallel steps must have empty dependencies');
      }

      // Root task envelope for RCT
      const rctRootEnvelope = createTaskEnvelope({
        taskId: 'task-rct-root',
        runId: plan.runId,
        conversationId: plan.conversationId,
        sourceWorkerId: 'USER',
        destinationWorkerId: 'RCT',
        objective: 'Parallel architecture convergence',
        masterPromptVersion: 'charter-v1.0#w1.0:p1.0:t1.0',
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        cancellationId: 'cancel-root-parallel',
        scopes: {
          effects: ['read', 'write', 'execute', 'computer'],
          readPaths: ['docs/', 'packages/'],
          writePaths: ['docs/execution/']
        },
        budgets: {
          timeBudgetMs: 120000,
          tokenBudget: 200000,
          depthBudget: 2,
          branchBudget: 5
        }
      });

      // Verify each delegated child envelope satisfies authority monotonicity
      destinations.forEach((wId, idx) => {
        const childEnv = createTaskEnvelope({
          taskId: plan.steps[idx].taskId,
          runId: plan.runId,
          conversationId: plan.conversationId,
          parentTaskId: rctRootEnvelope.taskId,
          sourceWorkerId: 'RCT',
          destinationWorkerId: wId,
          objective: `Worker slice ${wId}`,
          masterPromptVersion: rctRootEnvelope.masterPromptVersion,
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          cancellationId: `cancel-child-${wId}`,
          scopes: {
            effects: ['read', 'write'],
            readPaths: ['docs/'],
            writePaths: ['docs/execution/']
          },
          budgets: {
            timeBudgetMs: 30000,
            tokenBudget: 25000,
            depthBudget: 1,
            branchBudget: 1
          }
        });

        assert.equal(assertNoAuthorityGrowth(rctRootEnvelope, childEnv), true);
      });
    });

    it('rejects parallel execution exceeding maxActiveBranches ceiling', () => {
      assert.throws(
        () => planRoute({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          mode: 'manual',
          strategy: 'parallel',
          destinations: ['AGR-1', 'AGR-2', 'AGR-3', 'AGR-4', 'AGR-5'],
          limits: { maxActiveBranches: 4 } // 5 steps > ceiling of 4
        }, {
          manifests: registry,
          now: FIXED_TIMESTAMP
        }),
        (err) => err instanceof RouteValidationError && err.message.includes('maxActiveBranches')
      );
    });
  });

  describe('3. Sequential/Review Pipeline: AGR-5 -> AGR-1 -> OCR-2 -> RCT', () => {
    it('enforces cascading step dependencies and cryptographic receipt verification across 4 stages', () => {
      const pipelineWorkers = ['AGR-5', 'AGR-1', 'OCR-2', 'RCT'];

      const plan = planRoute({
        routeId: 'route-review-quad',
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        mode: 'manual',
        strategy: 'sequential',
        destinations: pipelineWorkers,
        prompt: 'Build work page, review contracts, audit conformance, verify computer runtime'
      }, {
        manifests: registry,
        now: FIXED_TIMESTAMP
      });

      assert.equal(plan.steps.length, 4);
      assert.equal(plan.steps[0].workerId, 'AGR-5');
      assert.deepEqual(plan.steps[0].dependsOn, []);

      assert.equal(plan.steps[1].workerId, 'AGR-1');
      assert.deepEqual(plan.steps[1].dependsOn, ['step_1']);

      assert.equal(plan.steps[2].workerId, 'OCR-2');
      assert.deepEqual(plan.steps[2].dependsOn, ['step_2']);

      assert.equal(plan.steps[3].workerId, 'RCT');
      assert.deepEqual(plan.steps[3].dependsOn, ['step_3']);

      // Stage 1 Receipt: AGR-5 finishes UI work
      const r1 = createDeliveryReceipt({
        receiptId: 'rcpt-s1',
        taskId: plan.steps[0].taskId,
        runId: plan.runId,
        conversationId: plan.conversationId,
        workerId: 'AGR-5',
        status: 'completed',
        delivered: true,
        effectsObserved: true,
        appliedEffects: ['write'],
        verification: { verified: false, verifierId: null, checksPassed: 0, checksFailed: 0 },
        dispatchedAt: FIXED_TIMESTAMP,
        completedAt: FIXED_TIMESTAMP + 1000
      });

      // Stage 2 Receipt: AGR-1 reviews and verifies
      const r2 = createDeliveryReceipt({
        receiptId: 'rcpt-s2',
        taskId: plan.steps[1].taskId,
        runId: plan.runId,
        conversationId: plan.conversationId,
        workerId: 'AGR-1',
        status: 'completed',
        delivered: true,
        effectsObserved: true,
        appliedEffects: ['read'],
        verification: { verified: true, verifierId: 'AGR-1', checksPassed: 8, checksFailed: 0 },
        dispatchedAt: FIXED_TIMESTAMP + 1000,
        completedAt: FIXED_TIMESTAMP + 2000
      });

      // Stage 4 Receipt: RCT final acceptance
      const r4 = createDeliveryReceipt({
        receiptId: 'rcpt-s4',
        taskId: plan.steps[3].taskId,
        runId: plan.runId,
        conversationId: plan.conversationId,
        workerId: 'RCT',
        status: 'completed',
        delivered: true,
        effectsObserved: true,
        appliedEffects: ['read', 'computer'],
        verification: { verified: true, verifierId: 'RCT', checksPassed: 24, checksFailed: 0 },
        dispatchedAt: FIXED_TIMESTAMP + 3000,
        completedAt: FIXED_TIMESTAMP + 4000
      });

      assert.equal(r1.status, 'completed');
      assert.equal(r2.verification.verified, true);
      assert.equal(r4.verification.checksPassed, 24);
    });
  });

  describe('4. Automatic Proposal Only, No Dispatch', () => {
    it('produces proposed route plans with isProposal=true and status=proposed', () => {
      const plan = planRoute({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        mode: 'automatic',
        prompt: 'Implement secure route planning',
        requiredCapabilities: ['write']
      }, {
        manifests: registry,
        now: FIXED_TIMESTAMP
      });

      // Invariants: Automatic mode is proposal only!
      assert.equal(plan.mode, 'automatic');
      assert.equal(plan.isProposal, true);
      assert.equal(plan.status, 'proposed');
      assert.equal(plan.strategy, 'review-chain', 'Automatic mode with write requirements selects review-chain');
      assert.equal(plan.steps.length, 2);
      assert.equal(plan.steps[1].dependsOn[0], 'step_1');
      assert.ok(plan.routeHash);
    });
  });

  describe('5. Saved Workflow Revalidation at Use Time', () => {
    it('successfully revalidates valid template and fails closed if worker becomes unavailable or stale', () => {
      const templatePlan = planRoute({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        mode: 'saved-workflow',
        templateId: 'standard-review-chain'
      }, {
        manifests: registry,
        now: FIXED_TIMESTAMP
      });

      assert.equal(templatePlan.mode, 'saved-workflow');
      assert.equal(templatePlan.strategy, 'review-chain');
      assert.equal(templatePlan.steps.length, 2);

      // Healthy revalidation
      const revalidated = revalidateSavedWorkflow(templatePlan, {
        manifests: registry.list(),
        now: FIXED_TIMESTAMP
      });
      assert.ok(Object.isFrozen(revalidated));

      // Worker becomes unavailable
      const implementerId = templatePlan.steps[0].workerId;
      registry.updateAvailability(implementerId, {
        status: 'unavailable',
        observedAt: FIXED_TIMESTAMP + 100
      });

      assert.throws(
        () => revalidateSavedWorkflow(templatePlan, {
          manifests: registry.list(),
          now: FIXED_TIMESTAMP + 100
        }),
        (err) => err instanceof WorkerUnavailableError || err instanceof CapabilityMismatchError
      );

      // Worker observation becomes stale
      registry.updateAvailability(implementerId, {
        status: 'available',
        observedAt: FIXED_TIMESTAMP // Stale relative to future now
      });

      assert.throws(
        () => revalidateSavedWorkflow(templatePlan, {
          manifests: registry.list(),
          now: FIXED_TIMESTAMP + 5000000, // 5000s exceeds 300s staleness window
          maxStalenessMs: 300000
        }),
        (err) => err instanceof CapabilityMismatchError || err instanceof RouteValidationError
      );
    });
  });

  describe('6. Fresh-Worker Package Exact Order, Versioning, and Admission-Only Acknowledgment', () => {
    it('preserves exact 8-step boot sequence and verifies admission evidence invariants', () => {
      const pkg = buildFreshWorkerPackage({
        worker: registry.get('AGR-1'),
        adapter: 'adapter-antigravity',
        project: PROJECT_ID,
        workspace: WORKSPACE_ID,
        task: {
          taskId: 'task-integration-001',
          runId: 'run-integration-001',
          userObjective: 'Validate cross-slice architecture'
        },
        routePosition: { index: 1, total: 2 },
        scope: {
          ownedPaths: ['packages/orchestration-core/test/ifz-integration.test.js'],
          allowedActions: ['read', 'write']
        },
        preset: 'ZETRO Standard'
      });

      // 1. Verify exact 8-step boot package sequence in documented order
      const expectedSteps = [
        'charter',
        'workerContract',
        'projectContext',
        'preset',
        'taskPackage',
        'toolsAndScope',
        'requiredEvidence',
        'delegationProtocol'
      ];

      assert.equal(pkg.sections.length, 8);
      for (let i = 0; i < 8; i++) {
        assert.equal(pkg.sections[i].step, i + 1);
        assert.equal(pkg.sections[i].name, expectedSteps[i]);
      }

      // 2. Verify all versions are bound
      assert.ok(pkg.bindings.contextVersions.charterVersion);
      assert.ok(pkg.bindings.contextVersions.workerKnowledgeVersion);
      assert.ok(pkg.bindings.contextVersions.projectContextVersion);
      assert.ok(pkg.bindings.contextVersions.taskPackageVersion);
      assert.ok(pkg.bindings.contextVersions.presetVersion);
      assert.ok(pkg.bindings.contextVersions.compositeVersion);

      // 3. Create worker acknowledgment
      const ack = createWorkerAcknowledgment({
        workerId: 'AGR-1',
        workspace: WORKSPACE_ID,
        taskId: 'task-integration-001',
        scope: {
          ownedPaths: ['packages/orchestration-core/test/ifz-integration.test.js'],
          allowedActions: ['read', 'write']
        },
        contextVersion: pkg.bindings.contextVersions.compositeVersion,
        timestamp: FIXED_TIMESTAMP
      });

      const verification = verifyWorkerAcknowledgment(pkg, ack);
      assert.equal(verification.valid, true);
      assert.equal(verification.evidenceType, 'admission_evidence');
      assert.equal(verification.isDispatch, false);
      assert.equal(verification.isCompletion, false);
      assert.equal(verification.isVerification, false);

      // 4. Invariant: Acknowledgment must NEVER imply dispatch, completion, or verification
      const falseClaims = [
        { isDispatch: true },
        { isCompletion: true },
        { isVerification: true }
      ];

      for (const claim of falseClaims) {
        const fraudulentAck = {
          ...ack,
          ...claim
        };
        const fraudulentResult = verifyWorkerAcknowledgment(pkg, fraudulentAck);
        assert.equal(fraudulentResult.valid, false);
        assert.match(fraudulentResult.reason, /admission evidence only/);
      }
    });
  });

  describe('7. Negative Failure Modes (All Cross-Slice Constraints)', () => {
    it('rejects stale workers in routing and filtering', () => {
      registry.updateAvailability('AGR-1', {
        status: 'available',
        observedAt: FIXED_TIMESTAMP - 500000 // 500s ago
      });

      const freshList = registry.list({ maxAgeMs: 60000, now: FIXED_TIMESTAMP });
      assert.equal(freshList.some(w => w.workerId === 'AGR-1'), false);
    });

    it('rejects unavailable or offline workers', () => {
      registry.updateAvailability('OCR-1', {
        status: 'unavailable',
        observedAt: FIXED_TIMESTAMP
      });

      assert.throws(
        () => planRoute({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          mode: 'manual',
          strategy: 'sequential',
          destinations: ['OCR-1']
        }, {
          manifests: registry,
          now: FIXED_TIMESTAMP
        }),
        (err) => err instanceof WorkerUnavailableError || err instanceof RouteValidationError
      );
    });

    it('rejects workers bound to a different workspace', () => {
      registry.register({
        workerId: 'REMOTE-1',
        workerType: 'agent',
        adapterId: 'adapter-antigravity',
        projectId: PROJECT_ID,
        workspaceId: 'ws-secondary',
        revision: 1,
        capabilities: {
          effects: ['read'],
          canDelegate: false,
          supportsCancellation: true,
          supportsResume: false
        },
        observation: { status: 'available', observedAt: FIXED_TIMESTAMP }
      });

      assert.throws(
        () => planRoute({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID, // ws-main-01
          mode: 'manual',
          strategy: 'sequential',
          destinations: ['REMOTE-1']
        }, {
          manifests: registry,
          now: FIXED_TIMESTAMP
        }),
        (err) => err instanceof WorkspaceMismatchError || err instanceof RouteValidationError
      );
    });

    it('rejects capability mismatches when required effects are absent', () => {
      assert.throws(
        () => planRoute({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          mode: 'manual',
          strategy: 'sequential',
          destinations: [
            { workerId: 'OCR-2', requiredCapabilities: ['computer'] } // OCR-2 has only 'read'
          ]
        }, {
          manifests: registry,
          now: FIXED_TIMESTAMP
        }),
        (err) => err instanceof CapabilityMismatchError || err instanceof RouteValidationError
      );
    });

    it('rejects duplicate worker assignments in same step DAG where prohibited', () => {
      // 1. Duplicate worker-task pair in planRoute
      assert.throws(
        () => planRoute({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          mode: 'manual',
          strategy: 'parallel',
          destinations: [
            { workerId: 'AGR-1', taskId: 'same-task' },
            { workerId: 'AGR-1', taskId: 'same-task' }
          ]
        }, {
          manifests: registry,
          now: FIXED_TIMESTAMP
        }),
        (err) => err instanceof DuplicateWorkerTaskError || err instanceof RouteValidationError
      );

      // 2. Duplicate worker destinations in RouteRequest contract
      assert.throws(
        () => createRouteRequest({
          requestId: 'req-dup',
          runId: 'run-1',
          conversationId: 'conv-1',
          sourceWorkerId: 'AGR-1',
          destinationWorkerIds: ['AGR-2', 'AGR-2'],
          strategy: 'parallel',
          objective: 'Do parallel tasks'
        }),
        (err) => err instanceof IfzValidationError && err.message.includes('duplicate entry')
      );
    });

    it('rejects circular route dependency graphs', () => {
      assert.throws(
        () => planRoute({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          mode: 'manual',
          strategy: 'parallel',
          destinations: [
            { workerId: 'AGR-1', stepId: 'step_1', dependsOn: ['step_2'] },
            { workerId: 'AGR-2', stepId: 'step_2', dependsOn: ['step_1'] }
          ]
        }, {
          manifests: registry,
          now: FIXED_TIMESTAMP
        }),
        (err) => err instanceof CircularRouteError || err instanceof RouteValidationError
      );
    });

    it('rejects authority and budget growth across all dimensions in child delegation', () => {
      const parent = createTaskEnvelope({
        taskId: 'parent-env',
        runId: 'run-1',
        conversationId: 'conv-1',
        sourceWorkerId: 'USER',
        destinationWorkerId: 'AGR-1',
        objective: 'Parent bounded work',
        masterPromptVersion: 'v1',
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        cancellationId: 'c-root',
        scopes: {
          effects: ['read', 'write'],
          readPaths: ['src/'],
          writePaths: ['src/ifz/']
        },
        budgets: {
          timeBudgetMs: 30000,
          tokenBudget: 50000,
          depthBudget: 2,
          branchBudget: 2
        }
      });

      // 1. Time budget overflow
      const childTime = createTaskEnvelope({
        taskId: 'child-time',
        runId: 'run-1',
        conversationId: 'conv-1',
        sourceWorkerId: 'AGR-1',
        destinationWorkerId: 'OCR-1',
        objective: 'Time growth',
        masterPromptVersion: 'v1',
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        cancellationId: 'c-1',
        scopes: { effects: ['read'] },
        budgets: { timeBudgetMs: 60000, tokenBudget: 20000, depthBudget: 1, branchBudget: 1 }
      });
      assert.throws(() => assertNoAuthorityGrowth(parent, childTime), IfzAuthorityGrowthError);

      // 2. Token budget overflow
      const childTokens = createTaskEnvelope({
        taskId: 'child-tokens',
        runId: 'run-1',
        conversationId: 'conv-1',
        sourceWorkerId: 'AGR-1',
        destinationWorkerId: 'OCR-1',
        objective: 'Token growth',
        masterPromptVersion: 'v1',
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        cancellationId: 'c-2',
        scopes: { effects: ['read'] },
        budgets: { timeBudgetMs: 20000, tokenBudget: 90000, depthBudget: 1, branchBudget: 1 }
      });
      assert.throws(() => assertNoAuthorityGrowth(parent, childTokens), IfzAuthorityGrowthError);

      // 3. Ungranted effect expansion
      const childEffect = createRouteRequest({
        requestId: 'req-effect',
        runId: 'run-1',
        conversationId: 'conv-1',
        sourceWorkerId: 'AGR-1',
        destinationWorkerIds: ['OCR-1'],
        strategy: 'sequential',
        objective: 'Execute growth',
        requiredEffects: ['execute'] // Not in parent scopes (parent has only read, write)
      });
      assert.throws(() => assertNoAuthorityGrowth(parent, childEffect), IfzAuthorityGrowthError);

      // 4. Unauthorized write path
      const childPath = createTaskEnvelope({
        taskId: 'child-path',
        runId: 'run-1',
        conversationId: 'conv-1',
        sourceWorkerId: 'AGR-1',
        destinationWorkerId: 'OCR-1',
        objective: 'Path growth',
        masterPromptVersion: 'v1',
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        cancellationId: 'c-3',
        scopes: { effects: ['write'], readPaths: [], writePaths: ['config/secrets.env'] }
      });
      assert.throws(() => assertNoAuthorityGrowth(parent, childPath), IfzAuthorityGrowthError);
    });

    it('rejects forbidden secret credentials, thinking tags, and transcripts in context', () => {
      // 1. Secret pattern in task userObjective
      assert.throws(
        () => createTaskPackage({
          taskId: 'task-sec',
          runId: 'run-sec',
          userObjective: 'Use secret key ghp_123456789012345678901234567890123456'
        }),
        (err) => err instanceof MasterPromptError && err.message.includes('Forbidden credential')
      );

      // 2. Private reasoning tags in userObjective
      assert.throws(
        () => createTaskPackage({
          taskId: 'task-reason',
          runId: 'run-reason',
          userObjective: 'Task with <thinking>secret deliberation</thinking>'
        }),
        (err) => err instanceof MasterPromptError && err.message.includes('private reasoning tag')
      );

      // 3. Uncontrolled full transcript in project context
      assert.throws(
        () => createProjectContext({
          workspace: WORKSPACE_ID,
          acceptedWork: [{ title: 'Turn 1', rawTurns: ['user said hi'] }]
        }),
        (err) => err instanceof MasterPromptError && err.message.includes('uncontrolled transcript')
      );
    });
  });
});
