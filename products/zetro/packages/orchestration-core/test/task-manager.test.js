import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteTaskStore } from '../src/task-store.js';
import { TaskManager } from '../src/task-manager.js';
import { FakeRctAdapter } from '../src/rct-conformance-fixture.js';
import { States, Intents } from '../src/types.js';

function createFakeVerifier(verifierName = 'test-independent-verifier') {
  return {
    name: verifierName,
    async verify(envelope, receipt, context) {
      return {
        taskId: envelope.id,
        attemptId: context?.attemptId || `${envelope.id}-att-1`,
        verified: true,
        checks: Array.isArray(receipt.checks) && receipt.checks.length > 0
          ? receipt.checks
          : [{ name: 'npm-test', passed: true }]
      };
    }
  };
}

async function createTestEnv(t, adapter, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-mgr-test-'));
  const dbPath = join(dir, 'tasks.db');
  const store = new SqliteTaskStore(dbPath);
  const manager = new TaskManager(store, adapter, options);
  await manager.init();

  if (t && typeof t.after === 'function') {
    t.after(async () => {
      manager.close();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    });
  }

  return { manager, store, dir, dbPath };
}

function sampleEnvelope(id) {
  return {
    id,
    agent: 'worker-mgr-1',
    objective: 'Refactor dispatcher',
    allowedPaths: ['src/dispatcher.js'],
    contextRefs: ['docs/PLAN.md'],
    acceptance: 'All tests pass',
    verification: 'npm-test',
    workspaceRoot: 'E:/Veyminore/products/zetro',
    sourceHash: 'git-commit-hash-1',
    assignmentDigest: 'digest-1',
    deadlineMs: 2000,
    budget: { maxContextChars: 10000, maxReplyChars: 2000 }
  };
}

test('TaskManager: run() basic flow with independent verifier achieving COMPLETED', async (t) => {
  let executed = false;
  const adapter = {
    execute: async (env) => {
      executed = true;
      return {
        id: env.id,
        agent: env.agent,
        state: States.COMPLETED,
        changedFiles: ['src/dispatcher.js'],
        checks: [{ name: 'npm-test', passed: true }],
        evidenceRefs: ['evidence/patch.diff'],
        summary: 'Completed successfully',
        uncertainty: 'None'
      };
    }
  };

  const { manager, store } = await createTestEnv(t, adapter, { verifier: createFakeVerifier() });

  const env = sampleEnvelope('task-mgr-1');
  const result = await manager.run(env);

  assert.equal(executed, true);
  assert.equal(result.id, 'task-mgr-1');
  assert.equal(result.state, States.COMPLETED);

  // Durable task ID existed in store
  const stored = store.getTask('task-mgr-1');
  assert.equal(stored.id, 'task-mgr-1');
  assert.equal(stored.state, States.COMPLETED);

  // Verifier evidence artifact recorded
  const artifacts = store.getArtifacts('task-mgr-1');
  assert.ok(artifacts.some(a => a.artifactType === 'verifier_evidence'));
});

test('TaskManager: preserves unverified worker claim as SUBMITTED when verifier is absent', async (t) => {
  const adapter = {
    execute: async (env) => ({
      id: env.id,
      agent: env.agent,
      state: States.COMPLETED,
      changedFiles: ['src/dispatcher.js'],
      checks: [{ name: 'npm-test', passed: true }],
      evidenceRefs: ['evidence/patch.diff'],
      summary: 'Worker claims completion',
      uncertainty: 'None'
    })
  };

  // No verifier passed to TaskManager
  const { manager, store } = await createTestEnv(t, adapter);

  const env = sampleEnvelope('task-unverified-1');
  const result = await manager.run(env);

  // Authoritative completion is NOT granted without independent verifier!
  assert.equal(result.state, States.SUBMITTED);
  assert.match(result.uncertainty, /Unverified worker claim/);

  const stored = store.getTask('task-unverified-1');
  assert.equal(stored.state, States.SUBMITTED);
  assert.match(stored.uncertainty, /Unverified worker claim/);

  // Worker artifacts ARE preserved for review
  const artifacts = store.getArtifacts('task-unverified-1');
  assert.ok(artifacts.some(a => a.artifactType === 'patch'));
  assert.ok(artifacts.some(a => a.artifactType === 'evidence'));
  assert.equal(artifacts.some(a => a.artifactType === 'verifier_evidence'), false);
});

test('TaskManager: rejects worker claim when independent verifier check fails', async (t) => {
  const adapter = {
    execute: async (env) => ({
      id: env.id,
      agent: env.agent,
      state: States.COMPLETED,
      changedFiles: ['src/dispatcher.js'],
      checks: [{ name: 'npm-test', passed: true }],
      evidenceRefs: ['evidence/patch.diff'],
      summary: 'Worker completed',
      uncertainty: 'None'
    })
  };

  const failingVerifier = {
    name: 'failing-verifier',
    async verify(env, receipt, ctx) {
      return {
        taskId: env.id,
        attemptId: ctx.attemptId,
        verified: false,
        checks: [{ name: 'independent-test', passed: false }]
      };
    }
  };

  const { manager, store } = await createTestEnv(t, adapter, { verifier: failingVerifier });

  const env = sampleEnvelope('task-verifier-fail-1');
  const result = await manager.run(env);

  assert.equal(result.state, States.FAILED);
  assert.match(result.error, /Verification failed/);

  const stored = store.getTask('task-verifier-fail-1');
  assert.equal(stored.state, States.FAILED);
  // Zero unauthorized proposed artifacts persisted
  assert.equal(store.getArtifacts('task-verifier-fail-1').length, 0);
});

test('TaskManager: rejects forged verifier evidence with mismatched taskId', async (t) => {
  const adapter = {
    execute: async (env) => ({
      id: env.id,
      agent: env.agent,
      state: States.COMPLETED,
      changedFiles: ['src/dispatcher.js'],
      checks: [{ name: 'npm-test', passed: true }],
      evidenceRefs: [],
      summary: 'Done',
      uncertainty: 'None'
    })
  };

  const forgedVerifier = {
    name: 'forged-verifier',
    async verify() {
      return {
        taskId: 'some-other-task-id',
        verified: true,
        checks: [{ name: 'test', passed: true }]
      };
    }
  };

  const { manager, store } = await createTestEnv(t, adapter, { verifier: forgedVerifier });

  const env = sampleEnvelope('task-forged-ver-1');
  const result = await manager.run(env);

  assert.equal(result.state, States.FAILED);
  assert.match(result.error, /Verifier evidence taskId mismatch/);
  assert.equal(store.getArtifacts('task-forged-ver-1').length, 0);
});

test('TaskManager: status() returns metadata and latest attempt', async (t) => {
  const adapter = {
    execute: async (env) => ({
      id: env.id, agent: env.agent, state: States.COMPLETED,
      changedFiles: [], checks: [{ name: 'npm-test', passed: true }], evidenceRefs: [], summary: 'Done', uncertainty: 'None'
    })
  };

  const { manager } = await createTestEnv(t, adapter, { verifier: createFakeVerifier() });

  await manager.run(sampleEnvelope('task-status-1'));
  const status = manager.status('task-status-1');

  assert.equal(status.id, 'task-status-1');
  assert.equal(status.state, States.COMPLETED);
  assert.equal(status.agent, 'worker-mgr-1');
  assert.ok(status.latestAttempt);
  assert.equal(status.latestAttempt.state, States.COMPLETED);
  assert.ok(status.createdAt > 0);
});

test('TaskManager: events() returns structured audit trail', async (t) => {
  const adapter = {
    execute: async (env) => ({
      id: env.id, agent: env.agent, state: States.COMPLETED,
      changedFiles: [], checks: [{ name: 'npm-test', passed: true }], evidenceRefs: [], summary: 'Done', uncertainty: 'None'
    })
  };

  const { manager } = await createTestEnv(t, adapter, { verifier: createFakeVerifier() });

  await manager.run(sampleEnvelope('task-events-1'));
  const events = manager.events('task-events-1');

  assert.ok(events.length >= 4);
  const types = events.map(e => e.eventType);
  assert.ok(types.includes('TASK_CREATED'));
  assert.ok(types.includes('ATTEMPT_STARTED'));
  assert.ok(types.includes('INTENT_RECORDED'));
  assert.ok(types.includes('STATE_TRANSITION'));
});

test('TaskManager: cancel() active execution', async (t) => {
  let abortFired = false;
  const adapter = {
    execute: async (env, signal) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({ id: env.id, agent: env.agent, state: States.COMPLETED, checks: [{ name: 'test', passed: true }] });
        }, 200);
        signal.addEventListener('abort', () => {
          abortFired = true;
          clearTimeout(timer);
          reject(new Error('AbortError'));
        });
      });
    }
  };

  const { manager } = await createTestEnv(t, adapter);

  const runPromise = manager.run(sampleEnvelope('task-cancel-1'));
  // Yield to allow execution to start
  await new Promise(r => setTimeout(r, 20));

  const cancelResult = manager.cancel('task-cancel-1');
  assert.equal(cancelResult.cancelled, true);

  await runPromise;
  assert.equal(abortFired, true);

  const status = manager.status('task-cancel-1');
  assert.equal(status.state, States.CANCELLED);

  // Attempting to cancel again returns false
  const repeatCancel = manager.cancel('task-cancel-1');
  assert.equal(repeatCancel.cancelled, false);
});

test('TaskManager: evidence() retrieves artifacts and execution receipts', async (t) => {
  const adapter = {
    execute: async (env) => ({
      id: env.id,
      agent: env.agent,
      state: States.COMPLETED,
      changedFiles: ['src/dispatcher.js'],
      checks: [{ name: 'npm-test', passed: true }],
      evidenceRefs: ['evidence/receipt.patch'],
      summary: 'Evidence test completed',
      uncertainty: 'None'
    })
  };

  const { manager } = await createTestEnv(t, adapter, { verifier: createFakeVerifier() });

  await manager.run(sampleEnvelope('task-evidence-1'));
  const evidence = manager.evidence('task-evidence-1');

  assert.equal(evidence.taskId, 'task-evidence-1');
  assert.equal(evidence.state, States.COMPLETED);
  assert.ok(evidence.artifacts.length >= 2); // evidenceRef + changedFile patch + verifier_evidence
  assert.ok(evidence.eventsCount >= 4);
});

test('TaskManager: kill/restart intent window and no duplicate dispatch', async (t) => {
  let dispatchCount = 0;
  const hangingAdapter = {
    execute: async () => {
      dispatchCount++;
      // Simulates in-flight call when process crashes / terminates
      return new Promise(() => {});
    }
  };

  const dir = await mkdtemp(join(tmpdir(), 'zetro-intent-test-'));
  const dbPath = join(dir, 'tasks.db');

  // 1. Process 1: Starts task, intent is recorded, but process crashes before receipt
  const store1 = new SqliteTaskStore(dbPath);
  const manager1 = new TaskManager(store1, hangingAdapter);
  await manager1.init();

  // Run task asynchronously (don't await completion since adapter hangs)
  const env = sampleEnvelope('task-kill-restart-1');
  manager1.run(env).catch(() => {});

  // Wait until intent is committed to database
  await new Promise(r => setTimeout(r, 30));
  assert.equal(dispatchCount, 1);

  // Simulate process kill/crash
  manager1.close();

  // 2. Process 2: Restart from the same durable SQLite database
  let restartDispatches = 0;
  const countingAdapter2 = {
    execute: async () => {
      restartDispatches++;
      return { id: 'x', state: States.COMPLETED };
    }
  };

  const store2 = new SqliteTaskStore(dbPath);
  const manager2 = new TaskManager(store2, countingAdapter2);
  const reconciledTasks = await manager2.init();

  // Task MUST be reconciled to UNKNOWN
  assert.ok(reconciledTasks.includes('task-kill-restart-1'));

  const status = manager2.status('task-kill-restart-1');
  assert.equal(status.state, States.UNKNOWN);
  assert.match(status.uncertainty, /Interrupted in-flight/);

  // NO duplicate dispatch occurred on restart!
  assert.equal(restartDispatches, 0, 'Must never automatically duplicate dispatch uncertain work on restart');

  // Attempting to run duplicate task ID is rejected
  await assert.rejects(manager2.run(env), /Duplicate Task ID/);

  manager2.close();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

test('TaskManager: rejects adversarial intruder agent, writes 0 artifacts, marks FAILED', async (t) => {
  const adapter = new FakeRctAdapter({ mode: 'intruder_agent' });
  const { manager, store } = await createTestEnv(t, adapter);

  const env = sampleEnvelope('task-intruder-1');
  const res = await manager.run(env);

  assert.equal(res.state, States.FAILED);
  assert.match(res.error, /Agent identity mismatch/);

  // Authoritative writes must have zero artifacts persisted
  const evidence = manager.evidence('task-intruder-1');
  assert.equal(evidence.artifacts.length, 0);

  // Attempt and task states are strictly consistent
  const task = store.getTask('task-intruder-1');
  const attempt = store.getLatestAttempt('task-intruder-1');
  assert.equal(task.state, States.FAILED);
  assert.equal(attempt.state, States.FAILED);
});

test('TaskManager: rejects adversarial mismatched task ID, writes 0 artifacts, marks FAILED', async (t) => {
  const adapter = new FakeRctAdapter({ mode: 'mismatched_id' });
  const { manager, store } = await createTestEnv(t, adapter);

  const env = sampleEnvelope('task-mismatch-1');
  const res = await manager.run(env);

  assert.equal(res.state, States.FAILED);
  assert.match(res.error, /Task ID mismatch/);

  const evidence = manager.evidence('task-mismatch-1');
  assert.equal(evidence.artifacts.length, 0);

  const task = store.getTask('task-mismatch-1');
  const attempt = store.getLatestAttempt('task-mismatch-1');
  assert.equal(task.state, States.FAILED);
  assert.equal(attempt.state, States.FAILED);
});

test('TaskManager: rejects adversarial outside-scope patch, writes 0 artifacts, marks FAILED', async (t) => {
  const adapter = new FakeRctAdapter({ mode: 'outside_scope_patch' });
  const { manager, store } = await createTestEnv(t, adapter);

  const env = sampleEnvelope('task-scope-1');
  const res = await manager.run(env);

  assert.equal(res.state, States.FAILED);
  assert.match(res.error, /Path scope violation/);

  // Absolutely zero unauthorized artifacts persisted
  const evidence = manager.evidence('task-scope-1');
  assert.equal(evidence.artifacts.length, 0);
  assert.equal(store.getArtifacts('task-scope-1').length, 0);

  const task = store.getTask('task-scope-1');
  const attempt = store.getLatestAttempt('task-scope-1');
  assert.equal(task.state, States.FAILED);
  assert.equal(attempt.state, States.FAILED);
});

test('TaskManager: rejects adversarial completed with no checks (worker completion alone)', async (t) => {
  const adapter = new FakeRctAdapter({ mode: 'completed_no_checks', changedFiles: ['src/dispatcher.js'] });
  const { manager, store } = await createTestEnv(t, adapter);

  const env = sampleEnvelope('task-no-checks-1');
  const res = await manager.run(env);

  assert.equal(res.state, States.FAILED);
  assert.match(res.error, /COMPLETED state requires non-empty verification checks/);

  const evidence = manager.evidence('task-no-checks-1');
  assert.equal(evidence.artifacts.length, 0);

  const task = store.getTask('task-no-checks-1');
  const attempt = store.getLatestAttempt('task-no-checks-1');
  assert.equal(task.state, States.FAILED);
  assert.equal(attempt.state, States.FAILED);
});

test('TaskManager: rejects adversarial completed with failed checks', async (t) => {
  const adapter = new FakeRctAdapter({ mode: 'completed_failed_checks', changedFiles: ['src/dispatcher.js'] });
  const { manager, store } = await createTestEnv(t, adapter);

  const env = sampleEnvelope('task-failed-checks-1');
  const res = await manager.run(env);

  assert.equal(res.state, States.FAILED);
  assert.match(res.error, /indicates failure/);

  const evidence = manager.evidence('task-failed-checks-1');
  assert.equal(evidence.artifacts.length, 0);

  const task = store.getTask('task-failed-checks-1');
  const attempt = store.getLatestAttempt('task-failed-checks-1');
  assert.equal(task.state, States.FAILED);
  assert.equal(attempt.state, States.FAILED);
});

test('TaskManager: cancel on terminal task does not alter attempt or task state (atomic immutability)', async (t) => {
  const adapter = new FakeRctAdapter({ mode: 'success', changedFiles: ['src/dispatcher.js'] });
  const { manager, store } = await createTestEnv(t, adapter, { verifier: createFakeVerifier() });

  const env = sampleEnvelope('task-cancel-term-1');
  await manager.run(env);

  const statusBefore = manager.status('task-cancel-term-1');
  assert.equal(statusBefore.state, States.COMPLETED);

  // Attempt cancel on completed task
  const cancelRes = manager.cancel('task-cancel-term-1');
  assert.equal(cancelRes.cancelled, false);

  const statusAfter = manager.status('task-cancel-term-1');
  assert.equal(statusAfter.state, States.COMPLETED);
  assert.equal(statusAfter.latestAttempt.state, States.COMPLETED);
});

test('TaskManager: failure injection inside finalizeTaskAttempt triggers atomic rollback and recovers safely on restart', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-atomic-fail-'));
  const dbPath = join(dir, 'tasks.db');

  const store1 = new SqliteTaskStore(dbPath);
  await store1.init();

  // Hook into finalizeTaskAttempt to simulate persistent storage/process crash during finalization
  store1.finalizeTaskAttempt = function () {
    throw new Error('Simulated storage crash during finalize');
  };

  const adapter = new FakeRctAdapter({ mode: 'success', changedFiles: ['src/dispatcher.js'] });
  const manager1 = new TaskManager(store1, adapter, { verifier: createFakeVerifier() });

  const env = sampleEnvelope('task-inject-fail-1');
  // run() will encounter the crash during finalize
  await assert.rejects(manager1.run(env), /Simulated storage crash during finalize/);

  // Due to atomic transaction rollback:
  // Task and attempt were NOT finalized to COMPLETED, and 0 artifacts were persisted
  const taskAfterCrash = store1.getTask('task-inject-fail-1');
  const attemptAfterCrash = store1.getLatestAttempt('task-inject-fail-1');
  assert.equal(taskAfterCrash.state, States.RUNNING);
  assert.equal(attemptAfterCrash.state, States.RUNNING);
  assert.equal(store1.getArtifacts('task-inject-fail-1').length, 0);

  manager1.close();

  // Process 2: Restart and reconcile
  const store2 = new SqliteTaskStore(dbPath);
  const manager2 = new TaskManager(store2, adapter);
  const reconciled = await manager2.init();

  // Task was cleanly reconciled to UNKNOWN on restart without duplicate dispatch
  assert.ok(reconciled.includes('task-inject-fail-1'));
  const reconciledStatus = manager2.status('task-inject-fail-1');
  assert.equal(reconciledStatus.state, States.UNKNOWN);
  assert.match(reconciledStatus.uncertainty, /Interrupted in-flight/);

  manager2.close();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

test('TaskManager: rejects adversarial forged check string labels, writes 0 artifacts, marks FAILED', async (t) => {
  const adapter = new FakeRctAdapter({ mode: 'forged_checks_strings' });
  const { manager, store } = await createTestEnv(t, adapter, { verifier: createFakeVerifier() });

  const env = sampleEnvelope('task-forged-str-1');
  const res = await manager.run(env);

  assert.equal(res.state, States.FAILED);
  assert.match(res.error, /string labels/);
  assert.equal(store.getArtifacts('task-forged-str-1').length, 0);
});

test('TaskManager: rejects adversarial forged check empty object, writes 0 artifacts, marks FAILED', async (t) => {
  const adapter = new FakeRctAdapter({ mode: 'forged_checks_empty_object' });
  const { manager, store } = await createTestEnv(t, adapter, { verifier: createFakeVerifier() });

  const env = sampleEnvelope('task-forged-empty-1');
  const res = await manager.run(env);

  assert.equal(res.state, States.FAILED);
  assert.match(res.error, /Check name must be a non-empty string/);
  assert.equal(store.getArtifacts('task-forged-empty-1').length, 0);
});

test('TaskManager: rejects adversarial forged check malformed boolean, writes 0 artifacts, marks FAILED', async (t) => {
  const adapter = new FakeRctAdapter({ mode: 'forged_checks_malformed_boolean' });
  const { manager, store } = await createTestEnv(t, adapter, { verifier: createFakeVerifier() });

  const env = sampleEnvelope('task-forged-bool-1');
  const res = await manager.run(env);

  assert.equal(res.state, States.FAILED);
  assert.match(res.error, /strict boolean/);
  assert.equal(store.getArtifacts('task-forged-bool-1').length, 0);
});

test('TaskManager: safe handling of malformed or omitted inputs across public APIs', async (t) => {
  const adapter = new FakeRctAdapter({ mode: 'success' });
  const { manager } = await createTestEnv(t, adapter);

  assert.equal(manager.status(null), null);
  assert.equal(manager.status(undefined), null);
  assert.equal(manager.status(123), null);

  assert.deepEqual(manager.events(null), []);
  assert.deepEqual(manager.events(undefined), []);

  assert.equal(manager.evidence(null), null);
  assert.equal(manager.evidence(undefined), null);

  const cancelNull = manager.cancel(null);
  assert.equal(cancelNull.cancelled, false);
  assert.match(cancelNull.reason, /Task ID must be a non-empty string/);

  await assert.rejects(manager.run(null), /missing required fields/);
  await assert.rejects(manager.run({}), /missing required fields/);
});

test('TaskManager: direct run({ verifierEvidence }) without verifier object succeeds and records trusted identity', async (t) => {
  const adapter = {
    execute: async (env) => ({
      id: env.id,
      agent: env.agent,
      state: States.COMPLETED,
      changedFiles: ['src/dispatcher.js'],
      checks: [{ name: 'npm-test', passed: true }],
      evidenceRefs: [],
      summary: 'Done',
      uncertainty: 'None'
    })
  };

  const { manager, store } = await createTestEnv(t, adapter);
  const env = sampleEnvelope('task-direct-ev-1');
  const attemptId = 'task-direct-ev-1-att-1';

  const verifierEvidence = {
    taskId: env.id,
    attemptId,
    verified: true,
    checks: [{ name: 'npm-test', passed: true }],
    verifier: 'direct-audit-authority'
  };

  // Called with verifierEvidence directly, verifier option is null
  const res = await manager.run(env, { verifierEvidence });

  assert.equal(res.state, States.COMPLETED);
  const artifacts = store.getArtifacts('task-direct-ev-1');
  const evArt = artifacts.find(a => a.artifactType === 'verifier_evidence');
  assert.ok(evArt);
  assert.equal(evArt.metadata.verifier, 'direct-audit-authority');
});

test('TaskManager: verifier exceeding deadline is bounded, fails to UNKNOWN, and rejects late completion', async (t) => {
  const adapter = {
    execute: async (env) => ({
      id: env.id,
      agent: env.agent,
      state: States.COMPLETED,
      changedFiles: ['src/dispatcher.js'],
      checks: [{ name: 'npm-test', passed: true }],
      evidenceRefs: [],
      summary: 'Done',
      uncertainty: 'None'
    })
  };

  // Verifier that takes 100ms when deadline is 25ms
  const slowVerifier = {
    name: 'slow-verifier',
    async verify(env, receipt, ctx) {
      await new Promise(r => setTimeout(r, 100));
      return {
        taskId: env.id,
        attemptId: ctx.attemptId,
        verified: true,
        checks: [{ name: 'npm-test', passed: true }]
      };
    }
  };

  const { manager, store } = await createTestEnv(t, adapter, { verifier: slowVerifier });
  const env = { ...sampleEnvelope('task-ver-deadline-1'), deadlineMs: 25 };

  const res = await manager.run(env);

  assert.equal(res.state, States.UNKNOWN);
  assert.equal(res.error, 'Deadline exceeded');

  // Verify stored state is UNKNOWN and 0 verifier artifacts were persisted
  const stored = store.getTask('task-ver-deadline-1');
  assert.equal(stored.state, States.UNKNOWN);
  assert.equal(store.getArtifacts('task-ver-deadline-1').length, 0);
});

test('TaskManager: cancel during verifier execution cancels cleanly and rejects late verifier completion', async (t) => {
  let verifierStarted = false;
  let verifierAborted = false;

  const adapter = {
    execute: async (env) => ({
      id: env.id,
      agent: env.agent,
      state: States.COMPLETED,
      changedFiles: ['src/dispatcher.js'],
      checks: [{ name: 'npm-test', passed: true }],
      evidenceRefs: [],
      summary: 'Done',
      uncertainty: 'None'
    })
  };

  const slowVerifier = {
    name: 'cancellable-verifier',
    async verify(env, receipt, ctx) {
      verifierStarted = true;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({
            taskId: env.id,
            attemptId: ctx.attemptId,
            verified: true,
            checks: [{ name: 'npm-test', passed: true }]
          });
        }, 150);
        ctx.abortSignal?.addEventListener('abort', () => {
          verifierAborted = true;
          clearTimeout(timer);
          reject(new Error('AbortError'));
        });
      });
    }
  };

  const { manager, store } = await createTestEnv(t, adapter, { verifier: slowVerifier });
  const env = sampleEnvelope('task-ver-cancel-1');

  const runPromise = manager.run(env);

  // Wait until verifier has started
  while (!verifierStarted) {
    await new Promise(r => setTimeout(r, 5));
  }

  // Cancel while verifier is running
  const cancelRes = manager.cancel('task-ver-cancel-1');
  assert.equal(cancelRes.cancelled, true);

  await runPromise;

  assert.equal(verifierAborted, true);
  const status = manager.status('task-ver-cancel-1');
  assert.equal(status.state, States.CANCELLED);

  // Terminal CANCELLED state was not overwritten by verifier
  const stored = store.getTask('task-ver-cancel-1');
  assert.equal(stored.state, States.CANCELLED);
  assert.equal(store.getArtifacts('task-ver-cancel-1').length, 0);
});

test('TaskManager: rejects verifier evidence missing attemptId or with unrelated checks', async (t) => {
  const adapter = {
    execute: async (env) => ({
      id: env.id,
      agent: env.agent,
      state: States.COMPLETED,
      changedFiles: ['src/dispatcher.js'],
      checks: [{ name: 'npm-test', passed: true }],
      evidenceRefs: [],
      summary: 'Done',
      uncertainty: 'None'
    })
  };

  // Missing attemptId
  const missingAttemptVerifier = {
    name: 'missing-attempt-ver',
    async verify(env) {
      return {
        taskId: env.id,
        // attemptId omitted
        verified: true,
        checks: [{ name: 'npm-test', passed: true }]
      };
    }
  };

  const { manager: m1 } = await createTestEnv(t, adapter, { verifier: missingAttemptVerifier });
  const res1 = await m1.run(sampleEnvelope('task-no-att-ver-1'));
  assert.equal(res1.state, States.FAILED);
  assert.match(res1.error, /attemptId is required/);

  // Unrelated checks
  const unrelatedVerifier = {
    name: 'unrelated-ver',
    async verify(env, receipt, ctx) {
      return {
        taskId: env.id,
        attemptId: ctx.attemptId,
        verified: true,
        checks: [{ name: 'completely-unrelated-check', passed: true }]
      };
    }
  };

  const { manager: m2 } = await createTestEnv(t, adapter, { verifier: unrelatedVerifier });
  const res2 = await m2.run(sampleEnvelope('task-unrelated-ver-1'));
  assert.equal(res2.state, States.FAILED);
  assert.match(res2.error, /Required check 'npm-test' was not verified as passed/);
});

test('TaskManager: rejects verifier evidence with altered check IDs (removeddash, case, underscore, whitespace)', async (t) => {
  const adapter = {
    execute: async (env) => ({
      id: env.id,
      agent: env.agent,
      state: States.COMPLETED,
      changedFiles: ['src/dispatcher.js'],
      checks: [{ name: 'placeholder', passed: true }],
      evidenceRefs: [],
      summary: 'Worker completed',
      uncertainty: 'None'
    })
  };

  // removeddash: required 'node --test' rejected when verifier supplies 'node test'
  const verifierRemovedDash = {
    name: 'dash-verifier',
    async verify(env, receipt, ctx) {
      return {
        taskId: env.id,
        attemptId: ctx.attemptId,
        verified: true,
        checks: [{ name: 'node test', passed: true }]
      };
    }
  };
  const { manager: m1 } = await createTestEnv(t, adapter, { verifier: verifierRemovedDash });
  const env1 = { ...sampleEnvelope('task-dash-regress-1'), verification: 'node --test' };
  const res1 = await m1.run(env1);
  assert.equal(res1.state, States.FAILED);
  assert.match(res1.error, /Required check 'node --test' was not verified as passed/);

  // case: required 'npm-test' rejected when verifier supplies 'NPM-TEST'
  const verifierCase = {
    name: 'case-verifier',
    async verify(env, receipt, ctx) {
      return {
        taskId: env.id,
        attemptId: ctx.attemptId,
        verified: true,
        checks: [{ name: 'NPM-TEST', passed: true }]
      };
    }
  };
  const { manager: m2 } = await createTestEnv(t, adapter, { verifier: verifierCase });
  const env2 = { ...sampleEnvelope('task-case-regress-1'), verification: 'npm-test' };
  const res2 = await m2.run(env2);
  assert.equal(res2.state, States.FAILED);
  assert.match(res2.error, /Required check 'npm-test' was not verified as passed/);

  // underscore: required 'test_unit' rejected when verifier supplies 'test-unit'
  const verifierUnderscore = {
    name: 'underscore-verifier',
    async verify(env, receipt, ctx) {
      return {
        taskId: env.id,
        attemptId: ctx.attemptId,
        verified: true,
        checks: [{ name: 'test-unit', passed: true }]
      };
    }
  };
  const { manager: m3 } = await createTestEnv(t, adapter, { verifier: verifierUnderscore });
  const env3 = { ...sampleEnvelope('task-under-regress-1'), verification: 'test_unit' };
  const res3 = await m3.run(env3);
  assert.equal(res3.state, States.FAILED);
  assert.match(res3.error, /Required check 'test_unit' was not verified as passed/);

  // argumentchanging whitespace: required 'node --test test/unit.js' rejected when whitespace altered
  const verifierWhitespace = {
    name: 'whitespace-verifier',
    async verify(env, receipt, ctx) {
      return {
        taskId: env.id,
        attemptId: ctx.attemptId,
        verified: true,
        checks: [{ name: 'node  --test  test/unit.js', passed: true }]
      };
    }
  };
  const { manager: m4 } = await createTestEnv(t, adapter, { verifier: verifierWhitespace });
  const env4 = { ...sampleEnvelope('task-white-regress-1'), verification: 'node --test test/unit.js' };
  const res4 = await m4.run(env4);
  assert.equal(res4.state, States.FAILED);
  assert.ok(res4.error.includes("Required check 'node --test test/unit.js' was not verified as passed"));
});

