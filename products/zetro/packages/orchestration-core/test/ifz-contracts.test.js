/**
 * @file test/ifz-contracts.test.js
 * Comprehensive unit and adversarial tests for IFZ Unified Architecture contracts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSIONS,
  EFFECT_CLASSES,
  ROUTE_STRATEGIES,
  validateWorkerManifest,
  createWorkerManifest,
  validateContextReference,
  createContextReference,
  validateRouteRequest,
  createRouteRequest,
  validateTaskEnvelope,
  createTaskEnvelope,
  validatePublicEvent,
  createPublicEvent,
  validateDeliveryReceipt,
  createDeliveryReceipt,
  assertNoAuthorityGrowth,
  deepClone,
  deepFreeze,
  canonicalJson,
  computeSha256,
  sanitizeAndBoundPayload,
  IfzValidationError,
  IfzAuthorityGrowthError
} from '../src/ifz/contracts.js';

describe('IFZ Unified Architecture Contracts', () => {
  const baseWorker = {
    workerId: 'AGR-1',
    workerType: 'agent',
    adapterId: 'adapter-antigravity',
    projectId: 'zetro-core',
    workspaceId: 'ws-main-01',
    capabilities: {
      effects: ['read', 'write', 'execute'],
      actions: ['read_file', 'edit_file', 'run_tests'],
      contextTypes: ['project_context', 'task_package'],
      canDelegate: true,
      supportsCancellation: true,
      supportsResume: false
    },
    observation: {
      status: 'available',
      observedAt: 1713000000000
    },
    qualification: {
      roles: ['agent', 'orchestrator'],
      certifications: ['ifz_v1'],
      tags: ['primary', 'core'],
      level: 'standard'
    }
  };

  describe('1. Worker Manifest', () => {
    it('creates and validates a well-formed WorkerManifest', () => {
      const manifest = createWorkerManifest(baseWorker);

      assert.equal(manifest.schemaVersion, SCHEMA_VERSIONS.WORKER_MANIFEST);
      assert.equal(manifest.workerId, 'AGR-1');
      assert.equal(manifest.revision, 1);
      assert.deepEqual(manifest.capabilities.effects, ['read', 'write', 'execute']);
      assert.equal(manifest.capabilities.canDelegate, true);
      assert.equal(manifest.capabilities.supportsCancellation, true);
      assert.equal(manifest.capabilities.supportsResume, false);
      assert.equal(manifest.delegation.canDelegate, true);
      assert.equal(manifest.observation.status, 'available');
      assert.equal(manifest.observation.observedAt, 1713000000000);
      assert.deepEqual(manifest.qualification.roles, ['agent', 'orchestrator']);
      assert.ok(Object.isFrozen(manifest));
      assert.ok(Object.isFrozen(manifest.capabilities));
    });

    it('rejects empty or whitespace-only identities', () => {
      assert.throws(
        () => createWorkerManifest({ ...baseWorker, workerId: '' }),
        (err) => err instanceof IfzValidationError && err.message.includes('workerId')
      );
      assert.throws(
        () => createWorkerManifest({ ...baseWorker, adapterId: '   ' }),
        (err) => err instanceof IfzValidationError && err.message.includes('adapterId')
      );
      assert.throws(
        () => createWorkerManifest({ ...baseWorker, projectId: null }),
        (err) => err instanceof IfzValidationError && err.message.includes('projectId')
      );
      assert.throws(
        () => createWorkerManifest({ ...baseWorker, workspaceId: undefined }),
        (err) => err instanceof IfzValidationError && err.message.includes('workspaceId')
      );
    });

    it('rejects malformed booleans (no truthy coercion)', () => {
      assert.throws(
        () => createWorkerManifest({
          ...baseWorker,
          capabilities: { ...baseWorker.capabilities, canDelegate: 'true' }
        }),
        (err) => err instanceof IfzValidationError && err.message.includes('capabilities.canDelegate must be a strict boolean')
      );
      assert.throws(
        () => createWorkerManifest({
          ...baseWorker,
          capabilities: { ...baseWorker.capabilities, supportsCancellation: 1 }
        }),
        (err) => err instanceof IfzValidationError && err.message.includes('capabilities.supportsCancellation must be a strict boolean')
      );
    });

    it('validates distinct effect classes and rejects unknown effects', () => {
      assert.throws(
        () => createWorkerManifest({
          ...baseWorker,
          capabilities: {
            ...baseWorker.capabilities,
            effects: ['read', 'teleport']
          }
        }),
        (err) => err instanceof IfzValidationError && err.message.includes("unknown effect class 'teleport'")
      );
    });

    it('rejects duplicate effect classes in capabilities', () => {
      assert.throws(
        () => createWorkerManifest({
          ...baseWorker,
          capabilities: {
            ...baseWorker.capabilities,
            effects: ['read', 'write', 'read']
          }
        }),
        (err) => err instanceof IfzValidationError && err.message.includes("duplicate effect 'read'")
      );
    });

    it('supports all 7 approved effect classes', () => {
      const manifest = createWorkerManifest({
        ...baseWorker,
        capabilities: {
          ...baseWorker.capabilities,
          effects: [...EFFECT_CLASSES]
        }
      });
      assert.equal(manifest.capabilities.effects.length, 7);
      for (const eff of EFFECT_CLASSES) {
        assert.ok(manifest.capabilities.effects.includes(eff));
      }
    });
  });

  describe('2. Context Reference', () => {
    it('creates and validates a ContextReference with SHA-256 digest', () => {
      const ref = createContextReference({
        contextId: 'ctx-001',
        conversationId: 'conv-100',
        runId: 'run-500',
        kind: 'task_package',
        digest: 'a'.repeat(64),
        byteLength: 4096,
        summary: 'Unit test context package'
      });

      assert.equal(ref.schemaVersion, SCHEMA_VERSIONS.CONTEXT_REFERENCE);
      assert.equal(ref.digest, 'a'.repeat(64));
      assert.equal(ref.byteLength, 4096);
      assert.ok(Object.isFrozen(ref));
    });

    it('rejects invalid context kinds and malformed digests', () => {
      assert.throws(
        () => createContextReference({
          contextId: 'ctx-001',
          conversationId: 'conv-1',
          runId: 'run-1',
          kind: 'unsupported_kind',
          digest: 'a'.repeat(64)
        }),
        (err) => err instanceof IfzValidationError && err.message.includes('kind must be one of')
      );

      assert.throws(
        () => createContextReference({
          contextId: 'ctx-001',
          conversationId: 'conv-1',
          runId: 'run-1',
          kind: 'attachment',
          digest: 'invalid-non-hex'
        }),
        (err) => err instanceof IfzValidationError && err.message.includes('digest must be a 64-character hex')
      );
    });
  });

  describe('3. Route Request & Canonical Strategies', () => {
    it('creates and validates an Any-to-Any RouteRequest with canonical review-chain strategy', () => {
      const route = createRouteRequest({
        requestId: 'req-route-01',
        runId: 'run-100',
        conversationId: 'conv-100',
        sourceWorkerId: 'Codex',
        destinationWorkerIds: ['AGR-1', 'RCT'],
        strategy: 'review-chain',
        objective: 'Implement feature and independently review',
        requiredEffects: ['read', 'write']
      });

      assert.equal(route.schemaVersion, SCHEMA_VERSIONS.ROUTE_REQUEST);
      assert.equal(route.sourceWorkerId, 'Codex');
      assert.deepEqual(route.destinationWorkerIds, ['AGR-1', 'RCT']);
      assert.equal(route.strategy, 'review-chain');
      assert.ok(Object.isFrozen(route));
    });

    it('accepts all 6 canonical route strategies exactly', () => {
      const canonical = ['parallel', 'sequential', 'review-chain', 'first-verified', 'compare', 'bounded-delegation'];
      for (const strat of canonical) {
        const req = createRouteRequest({
          requestId: `req-${strat}`,
          runId: 'run-1',
          conversationId: 'conv-1',
          sourceWorkerId: 'AGR-1',
          destinationWorkerIds: ['AGR-2'],
          strategy: strat,
          objective: `Testing ${strat}`
        });
        assert.equal(req.strategy, strat);
      }
    });

    it('strictly rejects underscore aliases from the public contract', () => {
      const underscoreVariants = ['review_chain', 'first_verified', 'compare_results', 'bounded_delegation'];
      for (const variant of underscoreVariants) {
        assert.throws(
          () => createRouteRequest({
            requestId: 'req-1',
            runId: 'run-1',
            conversationId: 'conv-1',
            sourceWorkerId: 'AGR-1',
            destinationWorkerIds: ['AGR-2'],
            strategy: variant,
            objective: 'Test invalid strategy'
          }),
          (err) => err instanceof IfzValidationError && err.message.includes('strategy must be one of')
        );
      }
    });

    it('rejects empty destinations or unsupported strategies', () => {
      assert.throws(
        () => createRouteRequest({
          requestId: 'req-1',
          runId: 'run-1',
          conversationId: 'conv-1',
          sourceWorkerId: 'AGR-1',
          destinationWorkerIds: [],
          objective: 'Do work'
        }),
        (err) => err instanceof IfzValidationError && err.message.includes('destinationWorkerIds')
      );

      assert.throws(
        () => createRouteRequest({
          requestId: 'req-1',
          runId: 'run-1',
          conversationId: 'conv-1',
          sourceWorkerId: 'AGR-1',
          destinationWorkerIds: ['OCR-1'],
          strategy: 'wild_guess',
          objective: 'Do work'
        }),
        (err) => err instanceof IfzValidationError && err.message.includes('strategy must be one of')
      );
    });
  });

  describe('4. Task Envelope & Budgets', () => {
    it('creates and validates a TaskEnvelope preserving IDs, versions, scopes, and budgets', () => {
      const envelope = createTaskEnvelope({
        taskId: 'task-100',
        runId: 'run-100',
        conversationId: 'conv-100',
        sourceWorkerId: 'IFZ',
        destinationWorkerId: 'AGR-1',
        objective: 'Implement contracts',
        masterPromptVersion: 'charter-v1.2',
        contextVersion: 'context-pkg-v2',
        projectId: 'zetro-core',
        workspaceId: 'ws-main',
        cancellationId: 'cancel-100',
        scopes: {
          effects: ['read', 'write'],
          readPaths: ['src/'],
          writePaths: ['src/ifz/'],
          createPaths: ['src/ifz/new.js']
        },
        budgets: {
          timeBudgetMs: 45000,
          tokenBudget: 50000,
          providerBudget: 3,
          workerBudget: 5,
          depthBudget: 2,
          branchBudget: 2
        }
      });

      assert.equal(envelope.schemaVersion, SCHEMA_VERSIONS.TASK_ENVELOPE);
      assert.equal(envelope.taskId, 'task-100');
      assert.equal(envelope.masterPromptVersion, 'charter-v1.2');
      assert.equal(envelope.contextVersion, 'context-pkg-v2');
      assert.equal(envelope.projectId, 'zetro-core');
      assert.equal(envelope.workspaceId, 'ws-main');
      assert.equal(envelope.cancellationId, 'cancel-100');
      assert.deepEqual(envelope.scopes.effects, ['read', 'write']);
      assert.deepEqual(envelope.scopes.writePaths, ['src/ifz/']);
      assert.equal(envelope.budgets.timeBudgetMs, 45000);
      assert.equal(envelope.budgets.tokenBudget, 50000);
      assert.equal(envelope.budgets.branchBudget, 2);
      assert.equal(envelope.limits.maxDurationMs, 45000);
      assert.equal(envelope.limits.maxDelegationDepth, 2);
      assert.ok(Object.isFrozen(envelope));
    });

    it('rejects empty objective, missing cancellationId, or missing identities in envelope', () => {
      assert.throws(
        () => createTaskEnvelope({
          taskId: 'task-1',
          runId: 'run-1',
          conversationId: 'conv-1',
          sourceWorkerId: 'IFZ',
          destinationWorkerId: 'AGR-1',
          objective: '',
          masterPromptVersion: 'v1',
          projectId: 'p1',
          workspaceId: 'w1',
          cancellationId: 'c1'
        }),
        (err) => err instanceof IfzValidationError && err.message.includes('objective')
      );

      assert.throws(
        () => createTaskEnvelope({
          taskId: 'task-1',
          runId: 'run-1',
          conversationId: 'conv-1',
          sourceWorkerId: 'IFZ',
          destinationWorkerId: 'AGR-1',
          objective: 'Do work',
          masterPromptVersion: 'v1',
          projectId: 'p1',
          workspaceId: 'w1',
          cancellationId: ''
        }),
        (err) => err instanceof IfzValidationError && err.message.includes('cancellationId')
      );
    });
  });

  describe('5. Public Event', () => {
    it('creates and validates a safe PublicEvent', () => {
      const event = createPublicEvent({
        eventId: 'ev-001',
        runId: 'run-100',
        conversationId: 'conv-100',
        taskId: 'task-100',
        eventType: 'worker_public_status',
        producerWorkerId: 'AGR-1',
        summary: 'Compiling source files',
        details: { step: 'build', durationMs: 250 }
      });

      assert.equal(event.schemaVersion, SCHEMA_VERSIONS.PUBLIC_EVENT);
      assert.equal(event.eventType, 'worker_public_status');
      assert.equal(event.summary, 'Compiling source files');
      assert.ok(Object.isFrozen(event));
    });

    it('rejects sensitive reasoning or credential fields in public event details', () => {
      assert.throws(
        () => createPublicEvent({
          eventId: 'ev-001',
          runId: 'run-1',
          conversationId: 'conv-1',
          taskId: 'task-1',
          eventType: 'worker_result',
          producerWorkerId: 'AGR-1',
          summary: 'Finished work',
          details: { rawReasoning: 'Secret plan' }
        }),
        (err) => err instanceof IfzValidationError && err.message.includes("sensitive field 'rawReasoning'")
      );
    });
  });

  describe('6. Delivery Receipt & Secret Prevention', () => {
    it('creates and validates a DeliveryReceipt with cryptographic digest verification', () => {
      const receipt = createDeliveryReceipt({
        receiptId: 'rcpt-001',
        taskId: 'task-100',
        runId: 'run-100',
        conversationId: 'conv-100',
        workerId: 'AGR-1',
        status: 'completed',
        delivered: true,
        effectsObserved: true,
        appliedEffects: ['read', 'write'],
        verification: {
          verified: true,
          verifierId: 'AGR-REV',
          checksPassed: 12,
          checksFailed: 0
        },
        dispatchedAt: 1713000000000,
        completedAt: 1713000010000
      });

      assert.equal(receipt.schemaVersion, SCHEMA_VERSIONS.DELIVERY_RECEIPT);
      assert.equal(receipt.status, 'completed');
      assert.equal(receipt.delivered, true);
      assert.equal(receipt.effectsObserved, true);
      assert.equal(receipt.verification.verified, true);
      assert.ok(receipt.receiptDigest.length === 64);
      assert.ok(Object.isFrozen(receipt));
    });

    it('detects digest tampering when verifyDigest=true', () => {
      assert.throws(
        () => validateDeliveryReceipt({
          schemaVersion: SCHEMA_VERSIONS.DELIVERY_RECEIPT,
          receiptId: 'rcpt-001',
          taskId: 'task-100',
          runId: 'run-100',
          conversationId: 'conv-100',
          workerId: 'AGR-1',
          status: 'completed',
          delivered: true,
          effectsObserved: true,
          appliedEffects: ['read'],
          verification: { verified: false, verifierId: null, checksPassed: 0, checksFailed: 0 },
          dispatchedAt: 1713000000000,
          completedAt: 1713000010000,
          receiptDigest: 'b'.repeat(64) // Tampered digest
        }, { throwOnError: true, verifyDigest: true }),
        (err) => err instanceof IfzValidationError && err.message.includes('tampering detected')
      );
    });

    it('strictly forbids prompt text, source code, secrets, and raw reasoning in receipts', () => {
      const forbiddenProps = ['prompt', 'promptText', 'source', 'sourceCode', 'secrets', 'secret', 'password', 'token', 'credentials', 'rawReasoning'];
      for (const prop of forbiddenProps) {
        assert.throws(
          () => createDeliveryReceipt({
            receiptId: 'rcpt-bad',
            taskId: 'task-1',
            runId: 'run-1',
            conversationId: 'conv-1',
            workerId: 'AGR-1',
            status: 'completed',
            delivered: true,
            effectsObserved: true,
            appliedEffects: [],
            verification: { verified: false, verifierId: null, checksPassed: 0, checksFailed: 0 },
            dispatchedAt: 1000,
            completedAt: 2000,
            [prop]: 'leak'
          }),
          (err) => err instanceof IfzValidationError && err.message.includes(`must not store '${prop}'`)
        );
      }
    });

    it('rejects verified=true without verifier checks record', () => {
      assert.throws(
        () => createDeliveryReceipt({
          receiptId: 'rcpt-001',
          taskId: 'task-1',
          runId: 'run-1',
          conversationId: 'conv-1',
          workerId: 'AGR-1',
          status: 'completed',
          delivered: true,
          effectsObserved: true,
          appliedEffects: [],
          verification: { verified: true, verifierId: null, checksPassed: 0, checksFailed: 0 },
          dispatchedAt: 1000,
          completedAt: 2000
        }),
        (err) => err instanceof IfzValidationError && err.message.includes('without verifier checks record')
      );
    });
  });

  describe('7. Authority Growth Prevention & Budgets', () => {
    const parent = createTaskEnvelope({
      taskId: 'parent-task',
      runId: 'run-1',
      conversationId: 'conv-1',
      sourceWorkerId: 'USER',
      destinationWorkerId: 'AGR-1',
      objective: 'Parent task with bounded scopes and budgets',
      masterPromptVersion: 'v1',
      projectId: 'p1',
      workspaceId: 'w1',
      cancellationId: 'c1',
      scopes: {
        effects: ['read', 'write'],
        readPaths: ['src/'],
        writePaths: ['src/ifz/'],
        createPaths: ['src/ifz/new.js']
      },
      budgets: {
        timeBudgetMs: 60000,
        tokenBudget: 100000,
        providerBudget: 5,
        workerBudget: 10,
        depthBudget: 2,
        branchBudget: 4
      }
    });

    it('permits child request within parent authority scope', () => {
      const child = createRouteRequest({
        requestId: 'child-req-01',
        runId: 'run-1',
        conversationId: 'conv-1',
        sourceWorkerId: 'AGR-1',
        destinationWorkerIds: ['AGR-2'],
        strategy: 'sequential',
        objective: 'Subtask reading and writing within scope',
        requiredEffects: ['read', 'write'],
        maxDelegationDepth: 1
      });

      assert.equal(assertNoAuthorityGrowth(parent, child), true);
    });

    it('rejects authority growth when child requests ungranted effect', () => {
      const child = createRouteRequest({
        requestId: 'child-req-growth',
        runId: 'run-1',
        conversationId: 'conv-1',
        sourceWorkerId: 'AGR-1',
        destinationWorkerIds: ['AGR-2'],
        strategy: 'sequential',
        objective: 'Subtask attempting execute',
        requiredEffects: ['read', 'execute']
      });

      assert.throws(
        () => assertNoAuthorityGrowth(parent, child),
        (err) => err instanceof IfzAuthorityGrowthError && err.message.includes("effect 'execute' not granted to parent")
      );
    });

    it('rejects authority growth when child requests undeclared write path', () => {
      const childEnvelope = createTaskEnvelope({
        taskId: 'child-task-path',
        runId: 'run-1',
        conversationId: 'conv-1',
        parentTaskId: 'parent-task',
        sourceWorkerId: 'AGR-1',
        destinationWorkerId: 'AGR-2',
        objective: 'Write outside scope',
        masterPromptVersion: 'v1',
        projectId: 'p1',
        workspaceId: 'w1',
        cancellationId: 'c1',
        scopes: {
          effects: ['write'],
          readPaths: [],
          writePaths: ['config/secrets.env'],
          createPaths: []
        }
      });

      assert.throws(
        () => assertNoAuthorityGrowth(parent, childEnvelope),
        (err) => err instanceof IfzAuthorityGrowthError && err.message.includes("write path 'config/secrets.env' outside parent scope")
      );
    });

    it('rejects authority growth when delegation depth exceeds limit', () => {
      const deepChild = createRouteRequest({
        requestId: 'child-deep',
        runId: 'run-1',
        conversationId: 'conv-1',
        sourceWorkerId: 'AGR-1',
        destinationWorkerIds: ['AGR-2'],
        strategy: 'sequential',
        objective: 'Deep subtask',
        requiredEffects: ['read'],
        maxDelegationDepth: 5 // Exceeds parent limit of 2
      });

      assert.throws(
        () => assertNoAuthorityGrowth(parent, deepChild),
        (err) => err instanceof IfzAuthorityGrowthError && err.message.includes('exceeds maximum allowed depth')
      );
    });

    it('rejects authority growth when child budget exceeds parent limits', () => {
      const greedyChild = createTaskEnvelope({
        taskId: 'child-greedy',
        runId: 'run-1',
        conversationId: 'conv-1',
        parentTaskId: 'parent-task',
        sourceWorkerId: 'AGR-1',
        destinationWorkerId: 'AGR-2',
        objective: 'Greedy subtask',
        masterPromptVersion: 'v1',
        projectId: 'p1',
        workspaceId: 'w1',
        cancellationId: 'c1',
        scopes: { effects: ['read'] },
        budgets: {
          timeBudgetMs: 120000, // Parent is 60000
          tokenBudget: 50000,
          depthBudget: 1,
          branchBudget: 2
        }
      });

      assert.throws(
        () => assertNoAuthorityGrowth(parent, greedyChild),
        (err) => err instanceof IfzAuthorityGrowthError && err.message.includes('timeBudgetMs (120000) exceeds parent limit')
      );

      const tokenGreedy = createTaskEnvelope({
        taskId: 'child-token-greedy',
        runId: 'run-1',
        conversationId: 'conv-1',
        parentTaskId: 'parent-task',
        sourceWorkerId: 'AGR-1',
        destinationWorkerId: 'AGR-2',
        objective: 'Token subtask',
        masterPromptVersion: 'v1',
        projectId: 'p1',
        workspaceId: 'w1',
        cancellationId: 'c1',
        scopes: { effects: ['read'] },
        budgets: {
          timeBudgetMs: 30000,
          tokenBudget: 500000, // Parent is 100000
          depthBudget: 1,
          branchBudget: 2
        }
      });

      assert.throws(
        () => assertNoAuthorityGrowth(parent, tokenGreedy),
        (err) => err instanceof IfzAuthorityGrowthError && err.message.includes('tokenBudget (500000) exceeds parent limit')
      );
    });
  });

  describe('8. Focused Adversarial Tests & Input Bounding', () => {
    it('rejects non-plain objects and custom prototypes', () => {
      class MaliciousWorkerManifest {
        workerId = 'HACK-1';
      }

      assert.throws(
        () => validateWorkerManifest(new MaliciousWorkerManifest()),
        (err) => err instanceof IfzValidationError && err.message.includes('Non-plain object detected')
      );

      const customProtoObj = Object.create({ inheritedProp: 'bad' });
      customProtoObj.workerId = 'HACK-2';

      assert.throws(
        () => validateWorkerManifest(customProtoObj),
        (err) => err instanceof IfzValidationError && err.message.includes('Non-plain object detected')
      );
    });

    it('rejects property accessors (getters/setters)', () => {
      const accessorObj = {
        ...baseWorker,
        get workerId() {
          return 'TRICK-1';
        }
      };

      assert.throws(
        () => createWorkerManifest(accessorObj),
        (err) => err instanceof IfzValidationError && err.message.includes('Property accessor (getter/setter) \'workerId\' prohibited')
      );
    });

    it('rejects prototype pollution attempts', () => {
      const polluted = JSON.parse('{"workerId":"AGR-1","__proto__":{"isAdmin":true}}');
      assert.throws(
        () => createWorkerManifest(polluted),
        (err) => err instanceof IfzValidationError && err.message.includes('Forbidden property name \'__proto__\'')
      );
    });

    it('rejects control characters in identities', () => {
      const nullByteWorker = { ...baseWorker, workerId: 'AGR\x00-1' };
      assert.throws(
        () => createWorkerManifest(nullByteWorker),
        (err) => err instanceof IfzValidationError && err.message.includes('Control characters detected')
      );

      const escapeWorker = { ...baseWorker, adapterId: 'adapter\x1B[31m' };
      assert.throws(
        () => createWorkerManifest(escapeWorker),
        (err) => err instanceof IfzValidationError && err.message.includes('Control characters detected')
      );
    });

    it('rejects NaN and Infinity', () => {
      assert.throws(
        () => createWorkerManifest({ ...baseWorker, revision: NaN }),
        (err) => err instanceof IfzValidationError && err.message.includes('NaN and Infinity are prohibited')
      );

      assert.throws(
        () => createWorkerManifest({ ...baseWorker, revision: Infinity }),
        (err) => err instanceof IfzValidationError && err.message.includes('NaN and Infinity are prohibited')
      );

      assert.throws(
        () => createWorkerManifest({
          ...baseWorker,
          limits: { maxDurationMs: Infinity }
        }),
        (err) => err instanceof IfzValidationError && err.message.includes('NaN and Infinity are prohibited')
      );
    });

    it('rejects duplicate entries in capability actions and context types', () => {
      assert.throws(
        () => createWorkerManifest({
          ...baseWorker,
          capabilities: {
            ...baseWorker.capabilities,
            actions: ['read_file', 'edit_file', 'read_file']
          }
        }),
        (err) => err instanceof IfzValidationError && err.message.includes("duplicate entry 'read_file'")
      );

      assert.throws(
        () => createWorkerManifest({
          ...baseWorker,
          capabilities: {
            ...baseWorker.capabilities,
            contextTypes: ['task_package', 'task_package']
          }
        }),
        (err) => err instanceof IfzValidationError && err.message.includes("duplicate entry 'task_package'")
      );
    });

    it('rejects malformed nested arrays in place of string arrays', () => {
      assert.throws(
        () => createWorkerManifest({
          ...baseWorker,
          capabilities: {
            ...baseWorker.capabilities,
            actions: [['nested_action']]
          }
        }),
        (err) => err instanceof IfzValidationError && err.message.includes('must be a string')
      );
    });

    it('fails deterministically on cyclic structures without crashing stack', () => {
      const cyclic = { ...baseWorker };
      cyclic.self = cyclic;

      assert.throws(
        () => validateWorkerManifest(cyclic),
        (err) => err instanceof IfzValidationError && err.message.includes('Circular reference detected')
      );

      assert.throws(
        () => deepClone(cyclic),
        (err) => err instanceof IfzValidationError && err.message.includes('Circular reference detected')
      );

      assert.throws(
        () => deepFreeze(cyclic),
        (err) => err instanceof IfzValidationError && err.message.includes('Circular reference detected')
      );

      assert.throws(
        () => canonicalJson(cyclic),
        (err) => err instanceof IfzValidationError && err.message.includes('Circular reference detected')
      );
    });

    it('bounds payload depth and rejects deep nesting', () => {
      let nested = { value: 1 };
      for (let i = 0; i < 20; i++) {
        nested = { child: nested };
      }

      assert.throws(
        () => sanitizeAndBoundPayload(nested, { maxDepth: 16 }),
        (err) => err instanceof IfzValidationError && err.message.includes('exceeds maximum limit of 16')
      );
    });

    it('bounds array lengths and string UTF-8 byte sizes', () => {
      const hugeArray = new Array(600).fill('item');
      assert.throws(
        () => sanitizeAndBoundPayload({ list: hugeArray }),
        (err) => err instanceof IfzValidationError && err.message.includes('exceeds maximum allowed length of 512')
      );

      const hugeString = 'a'.repeat(70000);
      assert.throws(
        () => sanitizeAndBoundPayload({ text: hugeString }),
        (err) => err instanceof IfzValidationError && err.message.includes('exceeds maximum byte length')
      );
    });
  });
});
