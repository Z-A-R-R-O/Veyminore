import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SqliteTaskStore,
  TaskManager,
  WorkerStatusProjection,
  WorkerStates,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  sanitizeSummary,
  States,
  Intents
} from '../src/index.js';

async function createTestEnv() {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-proj-'));
  const dbPath = join(dir, 'tasks.db');
  const store = new SqliteTaskStore(dbPath);
  await store.init();
  return {
    dir,
    dbPath,
    store,
    async cleanup() {
      store.close();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

function createTask(store, {
  id = 'task-1',
  agent = 'RCT-1',
  state = States.PENDING,
  workspaceRoot = '/tmp/ws'
} = {}) {
  return store.createTask({
    id,
    agent,
    objective: `Objective for ${id}`,
    allowedPaths: ['src/index.js'],
    contextRefs: [],
    acceptance: 'Passes',
    verification: 'Passes',
    workspaceRoot,
    deadlineMs: 30000,
    budget: { maxContextChars: 1000, maxReplyChars: 1000 },
    state
  });
}

test('WorkerStatusProjection: Real SQLite restart preserves projected worker state and event sequences', async () => {
  const env = await createTestEnv();
  try {
    const workerId = 'RCT-1';
    const taskId = 'task-restart-1';
    const attemptId = 'task-restart-1-att-1';

    createTask(env.store, { id: taskId, agent: workerId, state: States.RUNNING });

    env.store.createAttempt({
      attemptId,
      taskId,
      attemptNumber: 1,
      intent: Intents.DISPATCH_CALL,
      state: States.RUNNING
    });

    env.store.recordEvent(taskId, attemptId, 'CUSTOM_PROGRESS', { step: 1 });
    env.store.recordEvent(taskId, attemptId, 'CUSTOM_PROGRESS', { step: 2 });

    const projection1 = new WorkerStatusProjection(env.store);
    const status1 = projection1.getWorkerStatus(workerId);

    assert.equal(status1.workerId, workerId);
    assert.equal(status1.taskId, taskId);
    assert.equal(status1.attemptId, attemptId);
    assert.equal(status1.state, WorkerStates.RUNNING);
    assert.equal(status1.phase, 'executing');
    assert.ok(typeof status1.lastEventSequence === 'number');
    assert.ok(status1.lastEventSequence > 0);
    assert.ok(typeof status1.lastTimestamp === 'number');

    // Simulate system shutdown: close store
    env.store.close();

    // Reopen brand new SqliteTaskStore on the same database file
    const store2 = new SqliteTaskStore(env.dbPath);
    await store2.init();

    try {
      const projection2 = new WorkerStatusProjection(store2);
      const status2 = projection2.getWorkerStatus(workerId);

      assert.equal(status2.workerId, status1.workerId);
      assert.equal(status2.taskId, status1.taskId);
      assert.equal(status2.attemptId, status1.attemptId);
      assert.equal(status2.state, status1.state);
      assert.equal(status2.phase, status1.phase);
      assert.equal(status2.lastEventSequence, status1.lastEventSequence);
      assert.equal(status2.lastTimestamp, status1.lastTimestamp);
      assert.equal(status2.heartbeat.timeoutMs, status1.heartbeat.timeoutMs);
    } finally {
      store2.close();
    }
  } finally {
    await env.cleanup();
  }
});

test('WorkerStatusProjection: Multiple isolated workers maintain partitioned, non-bleeding statuses', async () => {
  const env = await createTestEnv();
  try {
    const projection = new WorkerStatusProjection(env.store);

    // Setup 5 workers with distinct states
    // Worker 1 (RCT-1): Active running attempt
    createTask(env.store, { id: 'task-w1', agent: 'RCT-1', state: States.RUNNING });
    env.store.createAttempt({
      attemptId: 'task-w1-att-1',
      taskId: 'task-w1',
      attemptNumber: 1,
      intent: Intents.DISPATCH_CALL,
      state: States.RUNNING
    });

    // Worker 2 (RCT-2): Completed with verified independent evidence
    createTask(env.store, { id: 'task-w2', agent: 'RCT-2', state: States.COMPLETED });
    env.store.createAttempt({
      attemptId: 'task-w2-att-1',
      taskId: 'task-w2',
      attemptNumber: 1,
      intent: Intents.NONE,
      state: States.COMPLETED
    });
    env.store.recordArtifact('task-w2', 'task-w2-att-1', {
      artifactType: 'verifier_evidence',
      uri: 'evidence/verifier.json',
      metadata: {
        verified: true,
        verifier: 'authoritative-rct-verifier',
        checks: [{ path: 'src/index.js', passed: true, sha256: 'a'.repeat(64) }]
      }
    });

    // Worker 3 (RCT-3): Failed execution
    createTask(env.store, { id: 'task-w3', agent: 'RCT-3', state: States.RUNNING });
    env.store.createAttempt({
      attemptId: 'task-w3-att-1',
      taskId: 'task-w3',
      attemptNumber: 1,
      intent: Intents.NONE,
      state: States.RUNNING
    });
    env.store.updateAttemptState('task-w3-att-1', States.FAILED, { error: 'Syntax error in patch' });
    env.store.updateTaskState('task-w3', States.FAILED, { error: 'Syntax error in patch' });

    // Worker 4 (RCT-4): Cancelled by operator
    createTask(env.store, { id: 'task-w4', agent: 'RCT-4', state: States.CANCELLED });
    env.store.createAttempt({
      attemptId: 'task-w4-att-1',
      taskId: 'task-w4',
      attemptNumber: 1,
      intent: Intents.CANCEL_REQUESTED,
      state: States.CANCELLED
    });

    // Worker 5 (RCT-5): Unassigned / idle (no tasks created)

    // Project individually
    const s1 = projection.getWorkerStatus('RCT-1');
    const s2 = projection.getWorkerStatus('RCT-2');
    const s3 = projection.getWorkerStatus('RCT-3');
    const s4 = projection.getWorkerStatus('RCT-4');
    const s5 = projection.getWorkerStatus('RCT-5');

    assert.equal(s1.state, WorkerStates.RUNNING);
    assert.equal(s1.phase, 'executing');
    assert.equal(s1.taskId, 'task-w1');

    assert.equal(s2.state, WorkerStates.COMPLETED);
    assert.equal(s2.phase, 'verified_completed');
    assert.equal(s2.verified, true);
    assert.equal(s2.taskId, 'task-w2');

    assert.equal(s3.state, WorkerStates.FAILED);
    assert.equal(s3.phase, 'execution_failed');
    assert.equal(s3.error, 'Syntax error in patch');

    assert.equal(s4.state, WorkerStates.INTERRUPTED);
    assert.equal(s4.phase, 'cancelled');

    assert.equal(s5.state, WorkerStates.IDLE);
    assert.equal(s5.phase, 'unassigned');
    assert.equal(s5.taskId, null);
    assert.equal(s5.attemptId, null);

    // Test listWorkerStatuses with known slots
    const list = projection.listWorkerStatuses({
      knownWorkerIds: ['RCT-1', 'RCT-2', 'RCT-3', 'RCT-4', 'RCT-5']
    });

    assert.equal(list.length, 5);
    assert.deepEqual(list.map(w => w.workerId), ['RCT-1', 'RCT-2', 'RCT-3', 'RCT-4', 'RCT-5']);
    assert.deepEqual(list.map(w => w.state), [
      WorkerStates.RUNNING,
      WorkerStates.COMPLETED,
      WorkerStates.FAILED,
      WorkerStates.INTERRUPTED,
      WorkerStates.IDLE
    ]);
  } finally {
    await env.cleanup();
  }
});

test('WorkerStatusProjection: Running requires actual active attempt, never assignment or acknowledgment', async () => {
  const env = await createTestEnv();
  try {
    const projection = new WorkerStatusProjection(env.store);
    const workerId = 'RCT-1';
    const taskId = 'task-assigned-only';

    // 1. Task created in PENDING state (assigned to worker, but no attempt created)
    createTask(env.store, { id: taskId, agent: workerId, state: States.PENDING });

    let status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.IDLE);
    assert.equal(status.phase, 'awaiting_dispatch');
    assert.notEqual(status.state, WorkerStates.RUNNING, 'Assignment alone must NOT project as RUNNING');

    // 2. Task state set to RUNNING or ACKNOWLEDGED event recorded, but still no attempt record
    env.store.updateTaskState(taskId, States.RUNNING);
    env.store.recordEvent(taskId, null, 'TASK_ACKNOWLEDGED', { workerId, timestamp: Date.now() });

    status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.IDLE);
    assert.equal(status.phase, 'awaiting_attempt');
    assert.notEqual(status.state, WorkerStates.RUNNING, 'Acknowledgment alone must NOT project as RUNNING');

    // 3. Create actual active attempt in States.RUNNING
    const attemptId = 'task-assigned-only-att-1';
    env.store.createAttempt({
      attemptId,
      taskId,
      attemptNumber: 1,
      intent: Intents.DISPATCH_CALL,
      state: States.RUNNING
    });

    status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.RUNNING, 'Actual active attempt projects as RUNNING');
    assert.equal(status.phase, 'executing');

    // 4. Once attempt is finished, ceases to be RUNNING
    env.store.updateAttemptState(attemptId, States.COMPLETED);
    status = projection.getWorkerStatus(workerId);
    assert.notEqual(status.state, WorkerStates.RUNNING);
  } finally {
    await env.cleanup();
  }
});

test('WorkerStatusProjection: Missing heartbeat transitions active worker to stale/unknown', async () => {
  const env = await createTestEnv();
  try {
    const timeoutMs = 15000;
    const projection = new WorkerStatusProjection(env.store, { heartbeatTimeoutMs: timeoutMs });
    const workerId = 'RCT-1';
    const taskId = 'task-heartbeat-1';
    const attemptId = 'task-heartbeat-1-att-1';
    const t0 = Date.now();

    createTask(env.store, { id: taskId, agent: workerId, state: States.RUNNING });
    env.store.createAttempt({
      attemptId,
      taskId,
      attemptNumber: 1,
      intent: Intents.DISPATCH_CALL,
      state: States.RUNNING
    });

    // Record activity at t0
    env.store.recordEvent(taskId, attemptId, 'EXECUTION_PULSE', { step: 1 });

    // 1. Check at t0 + 5000 (fresh activity within timeout)
    const freshStatus = projection.getWorkerStatus(workerId, { now: t0 + 5000 });
    assert.equal(freshStatus.state, WorkerStates.RUNNING);
    assert.equal(freshStatus.phase, 'executing');
    assert.equal(freshStatus.heartbeat.stale, false);

    // 2. Check at t0 + 20000 (inactivity exceeds 15000ms threshold)
    const staleStatus = projection.getWorkerStatus(workerId, { now: t0 + 20000 });
    assert.equal(staleStatus.state, WorkerStates.STALE);
    assert.equal(staleStatus.phase, 'heartbeat_timeout');
    assert.equal(staleStatus.heartbeat.stale, true);
    assert.match(staleStatus.uncertainty, /Missing heartbeat/);

    // 3. Worker sends explicit heartbeat pulse -> recovers to RUNNING
    const eventId = projection.recordHeartbeat(workerId, taskId, attemptId);
    env.store.db.prepare('UPDATE events SET timestamp = ? WHERE id = ?').run(t0 + 22000, eventId);

    const recoveredStatus = projection.getWorkerStatus(workerId, { now: t0 + 23000 });
    assert.equal(recoveredStatus.state, WorkerStates.RUNNING);
    assert.equal(recoveredStatus.phase, 'executing');
    assert.equal(recoveredStatus.heartbeat.stale, false);
  } finally {
    await env.cleanup();
  }
});

test('WorkerStatusProjection: Failed vs Interrupted states are strictly distinct', async () => {
  const env = await createTestEnv();
  try {
    const projection = new WorkerStatusProjection(env.store);

    // Case 1: Failure (test failed, assertion error)
    createTask(env.store, { id: 'task-fail', agent: 'RCT-FAIL', state: States.RUNNING });
    env.store.createAttempt({
      attemptId: 'task-fail-att',
      taskId: 'task-fail',
      attemptNumber: 1,
      intent: Intents.NONE,
      state: States.RUNNING
    });
    env.store.updateAttemptState('task-fail-att', States.FAILED, { error: 'AssertionError: expected 42 got 0' });
    env.store.updateTaskState('task-fail', States.FAILED, { error: 'AssertionError: expected 42 got 0' });

    const failStatus = projection.getWorkerStatus('RCT-FAIL');
    assert.equal(failStatus.state, WorkerStates.FAILED);
    assert.equal(failStatus.phase, 'execution_failed');
    assert.equal(failStatus.error, 'AssertionError: expected 42 got 0');

    // Case 2: Interrupted via operator cancellation
    createTask(env.store, { id: 'task-cancel', agent: 'RCT-CANCEL', state: States.CANCELLED });
    env.store.createAttempt({
      attemptId: 'task-cancel-att',
      taskId: 'task-cancel',
      attemptNumber: 1,
      intent: Intents.CANCEL_REQUESTED,
      state: States.CANCELLED
    });

    const cancelStatus = projection.getWorkerStatus('RCT-CANCEL');
    assert.equal(cancelStatus.state, WorkerStates.INTERRUPTED);
    assert.equal(cancelStatus.phase, 'cancelled');
    assert.notEqual(cancelStatus.state, WorkerStates.FAILED, 'Cancelled must be INTERRUPTED, not FAILED');

    // Case 3: Interrupted via crash recovery reconciliation
    createTask(env.store, { id: 'task-crash', agent: 'RCT-CRASH', state: States.UNKNOWN });
    env.store.createAttempt({
      attemptId: 'task-crash-att',
      taskId: 'task-crash',
      attemptNumber: 1,
      intent: Intents.RECONCILED_UNKNOWN,
      state: States.UNKNOWN
    });

    const crashStatus = projection.getWorkerStatus('RCT-CRASH');
    assert.equal(crashStatus.state, WorkerStates.INTERRUPTED);
    assert.equal(crashStatus.phase, 'crash_reconciled');
    assert.notEqual(crashStatus.state, WorkerStates.FAILED, 'Crash reconciliation must be INTERRUPTED, not FAILED');
  } finally {
    await env.cleanup();
  }
});

test('WorkerStatusProjection: Accepted completion strictly requires stored independent verification', async () => {
  const env = await createTestEnv();
  try {
    const projection = new WorkerStatusProjection(env.store);
    const workerId = 'RCT-1';
    const taskId = 'task-verif-1';
    const attemptId = 'task-verif-1-att-1';

    createTask(env.store, { id: taskId, agent: workerId, state: States.COMPLETED });
    env.store.createAttempt({
      attemptId,
      taskId,
      attemptNumber: 1,
      intent: Intents.NONE,
      state: States.COMPLETED
    });

    // 1. Worker claim alone without stored verification artifact -> SUBMITTED, NOT COMPLETED
    let status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.SUBMITTED);
    assert.equal(status.phase, 'unverified_worker_claim');
    assert.equal(status.verified, false);
    assert.match(status.uncertainty, /without authoritative stored independent verification/);

    // 2. Artifact with verified: false -> still NOT COMPLETED
    env.store.recordArtifact(taskId, attemptId, {
      artifactType: 'verifier_evidence',
      uri: 'evidence/v1.json',
      metadata: {
        verified: false,
        checks: [{ path: 'test.js', passed: false }]
      }
    });

    status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.SUBMITTED);
    assert.equal(status.verified, false);

    // 3. Authoritative verifier evidence with verified: true and passed checks
    env.store.recordArtifact(taskId, attemptId, {
      artifactType: 'verifier_evidence',
      uri: 'evidence/v2.json',
      metadata: {
        verified: true,
        verifier: 'authoritative-rct-verifier',
        checks: [{ path: 'src/index.js', passed: true, sha256: 'a'.repeat(64) }]
      }
    });

    status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.COMPLETED);
    assert.equal(status.phase, 'verified_completed');
    assert.equal(status.verified, true);
  } finally {
    await env.cleanup();
  }
});

test('WorkerStatusProjection: Stale events and wrong identity never regress or corrupt worker projection', async () => {
  const env = await createTestEnv();
  try {
    const projection = new WorkerStatusProjection(env.store);
    const workerA = 'RCT-1';
    const workerB = 'RCT-2';

    // Worker A: Active running task
    createTask(env.store, { id: 'task-a', agent: workerA, state: States.RUNNING });
    env.store.createAttempt({
      attemptId: 'task-a-att-1',
      taskId: 'task-a',
      attemptNumber: 1,
      intent: Intents.DISPATCH_CALL,
      state: States.RUNNING
    });
    env.store.recordEvent('task-a', 'task-a-att-1', 'EVENT_A', { step: 10 });

    // Worker B: Separate task
    createTask(env.store, { id: 'task-b', agent: workerB, state: States.FAILED });
    env.store.createAttempt({
      attemptId: 'task-b-att-1',
      taskId: 'task-b',
      attemptNumber: 1,
      intent: Intents.NONE,
      state: States.FAILED
    });

    // Injected foreign event with workerId mismatch on task-a
    env.store.recordEvent('task-a', 'task-a-att-1', 'INTRUDER_EVENT', { workerId: 'intruder-agent' });

    // Injected event on task-b referencing workerA in payload
    env.store.recordEvent('task-b', 'task-b-att-1', 'CROSS_EVENT', { workerId: workerA });

    const statusA = projection.getWorkerStatus(workerA);
    assert.equal(statusA.workerId, workerA);
    assert.equal(statusA.taskId, 'task-a');
    assert.equal(statusA.state, WorkerStates.RUNNING);

    const statusB = projection.getWorkerStatus(workerB);
    assert.equal(statusB.workerId, workerB);
    assert.equal(statusB.taskId, 'task-b');
    assert.equal(statusB.state, WorkerStates.FAILED);

    // Stale sequence test: multiple events guarantee monotonic lastEventSequence
    env.store.recordEvent('task-a', 'task-a-att-1', 'LATER_EVENT', { step: 20 });
    const updatedA = projection.getWorkerStatus(workerA);
    assert.ok(updatedA.lastEventSequence > statusA.lastEventSequence);
  } finally {
    await env.cleanup();
  }
});

test('WorkerStatusProjection: Output contains compact safe fields with zero secret leakage', async () => {
  const env = await createTestEnv();
  try {
    const projection = new WorkerStatusProjection(env.store);
    const workerId = 'RCT-1';
    const taskId = 'task-secret-test';

    createTask(env.store, { id: taskId, agent: workerId, state: States.RUNNING });
    env.store.createAttempt({
      attemptId: 'task-secret-test-att-1',
      taskId,
      attemptNumber: 1,
      intent: Intents.DISPATCH_CALL,
      state: States.RUNNING
    });

    const status = projection.getWorkerStatus(workerId);
    const allowedKeys = new Set([
      'workerId',
      'taskId',
      'attemptId',
      'state',
      'phase',
      'verified',
      'lastEventSequence',
      'lastTimestamp',
      'heartbeat',
      'error',
      'uncertainty'
    ]);

    for (const key of Object.keys(status)) {
      assert.ok(allowedKeys.has(key), `Disallowed field in worker projection: ${key}`);
    }

    // Assert absence of any secret tokens, prompts, or provider credentials
    assert.equal(status.secret, undefined);
    assert.equal(status.apiKey, undefined);
    assert.equal(status.token, undefined);
    assert.equal(status.prompt, undefined);
  } finally {
    await env.cleanup();
  }
});

test('WorkerStatusProjection: TaskManager exposes getWorkerStatus and listWorkerStatuses', async () => {
  const env = await createTestEnv();
  try {
    const fakeAdapter = { execute: async () => ({}) };
    const manager = new TaskManager(env.store, fakeAdapter);
    await manager.init();

    createTask(env.store, { id: 'task-mgr-1', agent: 'RCT-1', state: States.RUNNING });
    env.store.createAttempt({
      attemptId: 'task-mgr-1-att-1',
      taskId: 'task-mgr-1',
      attemptNumber: 1,
      intent: Intents.DISPATCH_CALL,
      state: States.RUNNING
    });

    const status = manager.getWorkerStatus('RCT-1');
    assert.equal(status.workerId, 'RCT-1');
    assert.equal(status.state, WorkerStates.RUNNING);

    const list = manager.listWorkerStatuses({ knownWorkerIds: ['RCT-1', 'RCT-2'] });
    assert.equal(list.length, 2);
    assert.equal(list[0].workerId, 'RCT-1');
    assert.equal(list[0].state, WorkerStates.RUNNING);
    assert.equal(list[1].workerId, 'RCT-2');
    assert.equal(list[1].state, WorkerStates.IDLE);
  } finally {
    await env.cleanup();
  }
});

test('WorkerStatusProjection Negative Probe 1: Null, foreign, or malformed attempt evidence must never certify attempt', async () => {
  const env = await createTestEnv();
  try {
    const projection = new WorkerStatusProjection(env.store);
    const workerId = 'RCT-1';
    const taskId = 'task-probe-1';
    const attemptId = 'task-probe-1-att-1';
    const validSha256 = 'f'.repeat(64);

    createTask(env.store, { id: taskId, agent: workerId, state: States.COMPLETED });
    // Create foreign attempt 0 first
    env.store.createAttempt({
      attemptId: 'foreign-attempt-0',
      taskId,
      attemptNumber: 0,
      intent: Intents.NONE,
      state: States.COMPLETED
    });

    // Create target attempt 1
    env.store.createAttempt({
      attemptId,
      taskId,
      attemptNumber: 1,
      intent: Intents.NONE,
      state: States.COMPLETED
    });

    // 1. verifier_evidence with attemptId: null (MUST NEVER certify exact attempt)
    env.store.recordArtifact(taskId, null, {
      artifactType: 'verifier_evidence',
      uri: 'evidence/null-att.json',
      metadata: {
        verified: true,
        verifier: 'authoritative-rct-verifier',
        checks: [{ path: 'src/index.js', passed: true, sha256: validSha256 }]
      }
    });

    let status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.SUBMITTED, 'attemptId: null evidence must NEVER certify exact attempt');
    assert.equal(status.verified, false);

    // 2. verifier_evidence with foreign attemptId: foreign-attempt-0 (MUST NEVER certify target attempt)
    env.store.recordArtifact(taskId, 'foreign-attempt-0', {
      artifactType: 'verifier_evidence',
      uri: 'evidence/foreign-att.json',
      metadata: {
        attemptId: 'foreign-attempt-0',
        verified: true,
        verifier: 'authoritative-rct-verifier',
        checks: [{ path: 'src/index.js', passed: true, sha256: validSha256 }]
      }
    });

    status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.SUBMITTED, 'Foreign attempt evidence must NEVER certify exact attempt');
    assert.equal(status.verified, false);

    // 3. verifier_evidence matching attemptId, but missing meaningful verifier string
    env.store.recordArtifact(taskId, attemptId, {
      artifactType: 'verifier_evidence',
      uri: 'evidence/no-verifier.json',
      metadata: {
        verified: true,
        verifier: '   ', // blank
        checks: [{ path: 'src/index.js', passed: true, sha256: validSha256 }]
      }
    });

    status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.SUBMITTED, 'Blank verifier identity must fail certification');
    assert.equal(status.verified, false);

    // 4. verifier_evidence with checks lacking path or 64-char sha256 (e.g. checks: [{ passed: true }])
    env.store.recordArtifact(taskId, attemptId, {
      artifactType: 'verifier_evidence',
      uri: 'evidence/bad-check.json',
      metadata: {
        verified: true,
        verifier: 'authoritative-rct-verifier',
        checks: [{ passed: true }] // missing path and sha256
      }
    });

    status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.SUBMITTED, 'Checks lacking path or sha256 must fail certification');
    assert.equal(status.verified, false);

    // 5. verifier_evidence with invalid sha256 format (e.g. not 64-char hex)
    env.store.recordArtifact(taskId, attemptId, {
      artifactType: 'verifier_evidence',
      uri: 'evidence/bad-sha.json',
      metadata: {
        verified: true,
        verifier: 'authoritative-rct-verifier',
        checks: [{ path: 'src/index.js', passed: true, sha256: 'not-a-sha' }]
      }
    });

    status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.SUBMITTED, 'Non-hex sha256 checks must fail certification');
    assert.equal(status.verified, false);

    // 6. Valid verifier evidence, but task state is NOT COMPLETED (e.g. RUNNING or FAILED)
    const taskId2 = 'task-probe-1-uncompleted';
    const attemptId2 = 'task-probe-1-uncompleted-att-1';
    createTask(env.store, { id: taskId2, agent: 'RCT-2', state: States.RUNNING });
    env.store.createAttempt({
      attemptId: attemptId2,
      taskId: taskId2,
      attemptNumber: 1,
      intent: Intents.NONE,
      state: States.COMPLETED // attempt is completed, but task is still RUNNING
    });
    env.store.recordArtifact(taskId2, attemptId2, {
      artifactType: 'verifier_evidence',
      uri: 'evidence/valid.json',
      metadata: {
        verified: true,
        verifier: 'authoritative-rct-verifier',
        checks: [{ path: 'src/index.js', passed: true, sha256: validSha256 }]
      }
    });

    const status2 = projection.getWorkerStatus('RCT-2');
    assert.equal(status2.state, WorkerStates.SUBMITTED, 'Both task AND attempt must be COMPLETED');
    assert.equal(status2.verified, false);

    // 7. Finally, valid authoritative verifier evidence on fully completed task & attempt certifies!
    env.store.recordArtifact(taskId, attemptId, {
      artifactType: 'verifier_evidence',
      uri: 'evidence/valid-auth.json',
      metadata: {
        verified: true,
        verifier: 'authoritative-rct-verifier',
        checks: [{ path: 'src/index.js', passed: true, sha256: validSha256 }]
      }
    });

    status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.COMPLETED, 'Exact valid evidence certifies attempt');
    assert.equal(status.phase, 'verified_completed');
    assert.equal(status.verified, true);
  } finally {
    await env.cleanup();
  }
});

test('WorkerStatusProjection Negative Probe 2: Foreign attempt heartbeat and future/nonfinite timestamps must never prevent staleness', async () => {
  const env = await createTestEnv();
  try {
    const timeoutMs = 30000;
    const projection = new WorkerStatusProjection(env.store, { heartbeatTimeoutMs: timeoutMs });
    const workerId = 'RCT-1';
    const taskId = 'task-probe-2';
    const attemptA = 'task-probe-2-att-1';

    createTask(env.store, { id: taskId, agent: workerId, state: States.RUNNING });
    env.store.createAttempt({
      attemptId: attemptA,
      taskId,
      attemptNumber: 1,
      intent: Intents.DISPATCH_CALL,
      state: States.RUNNING
    });
    env.store.db.prepare('UPDATE attempts SET started_at = 1 WHERE attempt_id = ?').run(attemptA);

    // 1. Negative Probe: Attempt A startedAt 1. Heartbeat logged for foreign attempt OTHER at timestamp 100000.
    // Query projection at now = 100001 (elapsed 100,000ms > timeout 30,000ms).
    // Must project as STALE, NOT RUNNING!
    env.store.createAttempt({
      attemptId: 'OTHER',
      taskId,
      attemptNumber: 2,
      intent: Intents.NONE,
      state: States.COMPLETED
    });

    // Record heartbeat event on foreign attempt OTHER
    env.store.recordEvent(taskId, 'OTHER', 'WORKER_HEARTBEAT', {
      workerId
    });
    env.store.db.prepare('UPDATE events SET timestamp = 100000 WHERE task_id = ? AND attempt_id = ?').run(taskId, 'OTHER');

    const statusAt100001 = projection.getWorkerStatus(workerId, { now: 100001 });
    assert.equal(statusAt100001.state, WorkerStates.STALE, 'Heartbeat on foreign attempt OTHER must NOT keep attempt A running');
    assert.equal(statusAt100001.phase, 'heartbeat_timeout');
    assert.equal(statusAt100001.heartbeat.stale, true);

    // 2. Negative Probe: Future timestamp in store event (e.g. timestamp > now)
    // An event with future timestamp cannot be trusted to certify current freshness
    const now = 200000;
    env.store.recordEvent(taskId, attemptA, 'WORKER_HEARTBEAT', { workerId });
    // Simulate future event timestamp in SQLite events table
    env.store.db.prepare('UPDATE events SET timestamp = ? WHERE task_id = ? AND attempt_id = ?').run(
      now + 500000, // future timestamp
      taskId,
      attemptA
    );

    const futureStatus = projection.getWorkerStatus(workerId, { now });
    assert.equal(futureStatus.state, WorkerStates.STALE, 'Future timestamp must be rejected as untrusted');
    assert.equal(futureStatus.heartbeat.stale, true);

    // 3. Negative Probe: Non-finite timestamp (NaN / Infinity) in store event
    env.store.db.prepare('UPDATE events SET timestamp = ? WHERE task_id = ? AND attempt_id = ?').run(
      'not-a-number',
      taskId,
      attemptA
    );

    const nanStatus = projection.getWorkerStatus(workerId, { now });
    assert.equal(nanStatus.state, WorkerStates.STALE, 'Non-finite timestamp must be rejected');
    assert.equal(nanStatus.heartbeat.stale, true);
  } finally {
    await env.cleanup();
  }
});

test('WorkerStatusProjection Negative Probe 3: Raw error and uncertainty containing secrets or paths are bounded and sanitized', async () => {
  const env = await createTestEnv();
  try {
    const projection = new WorkerStatusProjection(env.store);
    const workerId = 'RCT-1';
    const taskId = 'task-leak-test';
    const attemptId = 'task-leak-test-att-1';

    createTask(env.store, { id: taskId, agent: workerId, state: States.RUNNING });
    env.store.createAttempt({
      attemptId,
      taskId,
      attemptNumber: 1,
      intent: Intents.NONE,
      state: States.RUNNING
    });

    // Injected raw error containing API keys, Windows/Unix file paths, and multi-line stack trace
    const rawError = [
      'Error: Provider Groq failed with key gsk_1234567890abcdef1234567890 and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret',
      '    at Provider.call (E:\\Veyminore\\products\\zetro\\src\\groq.js:142:15)',
      '    at file:///Users/admin/zetro/packages/rct-runtime/index.js:55:12',
      '    at async TaskManager.run (/home/runner/work/tasks.js:200:9)'
    ].join('\n');

    const rawUncertainty = 'Cancelled while reading secret configuration file at file:///E:/Veyminore/products/zetro/.env with password=supersecretpass';

    env.store.updateAttemptState(attemptId, States.FAILED, {
      error: rawError,
      uncertainty: rawUncertainty
    });
    env.store.updateTaskState(taskId, States.FAILED, {
      error: rawError,
      uncertainty: rawUncertainty
    });

    const status = projection.getWorkerStatus(workerId);
    assert.equal(status.state, WorkerStates.FAILED);

    // Assert absolute absence of leaked keys, tokens, or paths
    assert.ok(!status.error.includes('gsk_1234567890abcdef1234567890'), 'Groq API key must not leak');
    assert.ok(!status.error.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret'), 'Bearer token must not leak');
    assert.ok(!status.error.includes('E:\\Veyminore'), 'Windows file path must not leak');
    assert.ok(!status.error.includes('/Users/admin'), 'Unix file path must not leak');
    assert.ok(!status.error.includes('at Provider.call'), 'Multi-line stack traces must not leak');
    assert.ok(status.error.includes('[REDACTED]'), 'Secrets must be replaced with [REDACTED]');
    assert.ok(status.error.length <= 256, 'Error summary must be bounded to <= 256 chars');

    assert.ok(!status.uncertainty.includes('file:///E:/Veyminore'), 'File URL must not leak');
    assert.ok(!status.uncertainty.includes('supersecretpass'), 'Password token must not leak');
    assert.ok(status.uncertainty.includes('[REDACTED]'), 'Uncertainty secrets must be redacted');
    assert.ok(status.uncertainty.length <= 256, 'Uncertainty summary must be bounded to <= 256 chars');
  } finally {
    await env.cleanup();
  }
});

test('sanitizeSummary: Comprehensive standalone unit verification of redaction and bounding', () => {
  assert.equal(sanitizeSummary(null), null);
  assert.equal(sanitizeSummary(undefined), null);
  assert.equal(sanitizeSummary(''), null);
  assert.equal(sanitizeSummary('   '), null);

  // Normal clean string is preserved
  assert.equal(sanitizeSummary('Syntax error in calculator.js'), 'Syntax error in calculator.js');

  // Redaction of Groq and OpenAI keys
  const withKeys = 'Failed calling Groq with key gsk_abc1234567890abcdef1234567890 and sk-ant-api03-abcdef1234567890';
  assert.equal(sanitizeSummary(withKeys), 'Failed calling Groq with key [REDACTED] and [REDACTED]');

  // Redaction of Bearer auth
  const withBearer = 'Unauthorized request with Bearer secret_jwt_token_12345';
  assert.equal(sanitizeSummary(withBearer), 'Unauthorized request with [REDACTED]');

  // Redaction of file paths and file URIs
  const withPaths = 'Error in C:\\Users\\runner\\project\\src\\app.js and /var/log/zetro/error.log';
  assert.equal(sanitizeSummary(withPaths), 'Error in [REDACTED] and [REDACTED]');

  // Bounding long strings to <= 256 chars
  const longString = 'A'.repeat(500);
  const bounded = sanitizeSummary(longString);
  assert.ok(bounded.length <= 256);
  assert.ok(bounded.endsWith('...'));
});
