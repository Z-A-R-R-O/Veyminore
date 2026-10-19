import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteTaskStore, isSqliteSupported } from '../src/task-store.js';
import { States, Intents } from '../src/types.js';

async function createTestStore(t) {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-store-test-'));
  const dbPath = join(dir, 'test-tasks.db');
  const store = new SqliteTaskStore(dbPath);
  await store.init();
  if (t && typeof t.after === 'function') {
    t.after(async () => {
      store.close();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    });
  }
  return { store, dir, dbPath };
}

function sampleTask(id) {
  return {
    id,
    agent: 'worker-1',
    objective: 'Implement feature X',
    allowedPaths: ['src/core.js'],
    contextRefs: ['docs/SPEC.md'],
    acceptance: 'All unit tests pass',
    verification: 'npm test',
    workspaceRoot: 'E:/Veyminore/products/zetro',
    sourceHash: 'commit-hash-abc123',
    assignmentDigest: 'digest-sha256-xyz',
    deadlineMs: 30000,
    budget: { maxContextChars: 50000, maxReplyChars: 10000 }
  };
}

test('Capability detection: node:sqlite availability', () => {
  const supported = isSqliteSupported();
  assert.equal(typeof supported, 'boolean');
  assert.equal(supported, true, 'node:sqlite should be supported in this runtime (Node >= 22.5.0)');
});

test('Schema migration: versioning and table initialization', async (t) => {
  const { store } = await createTestStore(t);

  const row = store.db.prepare('SELECT version, description FROM schema_migrations WHERE version = 1').get();
  assert.equal(row.version, 1);
  assert.match(row.description, /Initial TaskStore schema/);

  // Tables exist and are queryable
  const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name ASC").all();
  const tableNames = tables.map(r => r.name);
  assert.ok(tableNames.includes('tasks'));
  assert.ok(tableNames.includes('attempts'));
  assert.ok(tableNames.includes('events'));
  assert.ok(tableNames.includes('artifacts'));
  assert.ok(tableNames.includes('schema_migrations'));
});

test('Task CRUD and workspace/source identity persistence', async (t) => {
  const { store } = await createTestStore(t);

  const task = sampleTask('task-crud-1');
  const created = store.createTask(task);

  assert.equal(created.id, 'task-crud-1');
  assert.equal(created.workspaceRoot, 'E:/Veyminore/products/zetro');
  assert.equal(created.sourceHash, 'commit-hash-abc123');
  assert.equal(created.assignmentDigest, 'digest-sha256-xyz');
  assert.equal(created.state, States.PENDING);
  assert.deepEqual(created.allowedPaths, ['src/core.js']);
  assert.deepEqual(created.budget, { maxContextChars: 50000, maxReplyChars: 10000 });

  // Duplicate task ID rejection
  assert.throws(() => store.createTask(task), /Duplicate Task ID/);

  // Retrieve by ID
  const retrieved = store.getTask('task-crud-1');
  assert.deepEqual(retrieved, created);

  // List tasks
  const allTasks = store.listTasks();
  assert.equal(allTasks.length, 1);
  assert.equal(allTasks[0].id, 'task-crud-1');
});

test('Attempt lifecycle and intent window recording', async (t) => {
  const { store } = await createTestStore(t);

  store.createTask(sampleTask('task-att-1'));

  // Create attempt 1
  const attempt = store.createAttempt({
    attemptId: 'task-att-1-attempt-1',
    taskId: 'task-att-1',
    attemptNumber: 1,
    intent: Intents.NONE,
    state: States.RUNNING
  });

  assert.equal(attempt.attemptId, 'task-att-1-attempt-1');
  assert.equal(attempt.intent, Intents.NONE);
  assert.equal(attempt.state, States.RUNNING);

  // Record dispatch intent (intent window start)
  const withIntent = store.recordIntent(
    'task-att-1',
    'task-att-1-attempt-1',
    Intents.DISPATCH_CALL,
    { destination: 'worker-1', attemptSeq: 1 }
  );

  assert.equal(withIntent.intent, Intents.DISPATCH_CALL);
  assert.equal(withIntent.intentData.destination, 'worker-1');

  // Finish attempt
  const finished = store.updateAttemptState('task-att-1-attempt-1', States.COMPLETED, {
    uncertainty: 'None'
  });
  assert.equal(finished.state, States.COMPLETED);
  assert.ok(finished.finishedAt > 0);
});

test('Terminal state immutability in TaskStore', async (t) => {
  const { store } = await createTestStore(t);

  store.createTask(sampleTask('task-term-1'));
  store.updateTaskState('task-term-1', States.COMPLETED);

  const afterComplete = store.getTask('task-term-1');
  assert.equal(afterComplete.state, States.COMPLETED);

  // Attempting to transition from terminal COMPLETED to CANCELLED must no-op
  store.updateTaskState('task-term-1', States.CANCELLED);
  const afterAttempt = store.getTask('task-term-1');
  assert.equal(afterAttempt.state, States.COMPLETED);
});

test('Events and Artifacts recording', async (t) => {
  const { store } = await createTestStore(t);

  store.createTask(sampleTask('task-event-1'));

  store.recordEvent('task-event-1', null, 'CUSTOM_LOG', { step: 1, message: 'Step 1 done' });
  store.recordEvent('task-event-1', null, 'CUSTOM_LOG', { step: 2, message: 'Step 2 done' });

  const events = store.getEvents('task-event-1');
  assert.ok(events.length >= 3); // TASK_CREATED + 2 custom logs
  assert.equal(events[events.length - 1].payload.message, 'Step 2 done');

  // Artifact recording
  const artifactId = store.recordArtifact('task-event-1', null, {
    artifactType: 'patch',
    uri: 'evidence/patch.diff',
    hash: 'sha256-hash123',
    metadata: { linesAdded: 5 }
  });

  assert.ok(artifactId > 0);
  const artifacts = store.getArtifacts('task-event-1');
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].uri, 'evidence/patch.diff');
  assert.equal(artifacts[0].metadata.linesAdded, 5);
});

test('Crash reconciliation: unclosed intent window becomes UNKNOWN', async (t) => {
  const { store } = await createTestStore(t);

  // 1. Create a task and start an attempt with DISPATCH_CALL intent (simulating in-flight crash)
  store.createTask(sampleTask('task-crash-1'));
  store.createAttempt({
    attemptId: 'task-crash-1-att-1',
    taskId: 'task-crash-1',
    attemptNumber: 1,
    intent: Intents.NONE,
    state: States.RUNNING
  });
  store.recordIntent('task-crash-1', 'task-crash-1-att-1', Intents.DISPATCH_CALL, {
    target: 'remote-worker'
  });
  store.updateTaskState('task-crash-1', States.RUNNING);

  // 2. Reconcile interrupted work (simulating restart)
  const reconciled = store.reconcileInterruptedWork();
  assert.ok(reconciled.includes('task-crash-1'));

  // Task and attempt MUST be UNKNOWN
  const task = store.getTask('task-crash-1');
  assert.equal(task.state, States.UNKNOWN);
  assert.match(task.uncertainty, /Interrupted in-flight/);

  const attempt = store.getAttempt('task-crash-1-att-1');
  assert.equal(attempt.state, States.UNKNOWN);
  assert.equal(attempt.intent, Intents.RECONCILED_UNKNOWN);
  assert.ok(attempt.finishedAt > 0);

  // Events must reflect reconciliation
  const events = store.getEvents('task-crash-1');
  assert.ok(events.some(e => e.eventType === 'INTENT_RECONCILED_UNKNOWN'));
});

test('Store: enforces immutable terminal states for attempts (COMPLETED -> RUNNING is blocked)', async (t) => {
  const { store } = await createTestStore(t);

  store.createTask(sampleTask('task-att-term-1'));
  store.createAttempt({
    attemptId: 'task-att-term-1-att-1',
    taskId: 'task-att-term-1',
    attemptNumber: 1,
    intent: Intents.NONE,
    state: States.RUNNING
  });

  // Complete attempt
  const comp = store.updateAttemptState('task-att-term-1-att-1', States.COMPLETED);
  assert.equal(comp.state, States.COMPLETED);

  // Illegal transition: attempt to change COMPLETED -> RUNNING must be blocked by terminal immutability
  const afterIllegal = store.updateAttemptState('task-att-term-1-att-1', States.RUNNING);
  assert.equal(afterIllegal.state, States.COMPLETED);

  // Illegal transition: attempt to change COMPLETED -> CANCELLED must be blocked
  const afterCancel = store.updateAttemptState('task-att-term-1-att-1', States.CANCELLED);
  assert.equal(afterCancel.state, States.COMPLETED);

  const fresh = store.getAttempt('task-att-term-1-att-1');
  assert.equal(fresh.state, States.COMPLETED);
});

test('Store: rejects unknown states across task and attempt APIs', async (t) => {
  const { store } = await createTestStore(t);

  // 1. createTask with unknown state
  assert.throws(() => {
    store.createTask({ ...sampleTask('task-bad-state-1'), state: 'UNKNOWN_BOGUS_STATE' });
  }, /Invalid or unknown task state/);

  // 2. createAttempt with unknown state
  store.createTask(sampleTask('task-valid-1'));
  assert.throws(() => {
    store.createAttempt({
      attemptId: 'task-valid-1-att-1',
      taskId: 'task-valid-1',
      attemptNumber: 1,
      state: 'BOGUS_ATTEMPT_STATE'
    });
  }, /Invalid or unknown attempt state/);

  // 3. updateTaskState with unknown state
  assert.throws(() => {
    store.updateTaskState('task-valid-1', 'BOGUS_TASK_STATE');
  }, /Invalid or unknown task state/);

  // 4. updateAttemptState with unknown state
  store.createAttempt({
    attemptId: 'task-valid-1-att-2',
    taskId: 'task-valid-1',
    attemptNumber: 2,
    state: States.RUNNING
  });
  assert.throws(() => {
    store.updateAttemptState('task-valid-1-att-2', 'BOGUS_ATTEMPT_STATE');
  }, /Invalid or unknown attempt state/);

  // 5. finalizeTaskAttempt with unknown state
  assert.throws(() => {
    store.finalizeTaskAttempt('task-valid-1', 'task-valid-1-att-2', {
      state: 'BOGUS_FINAL_STATE'
    });
  }, /Invalid or unknown state/);
});

test('Store: finalizeTaskAttempt executes atomic state transition, artifact persistence, and event logging', async (t) => {
  const { store } = await createTestStore(t);

  store.createTask(sampleTask('task-atomic-final-1'));
  store.createAttempt({
    attemptId: 'task-atomic-final-1-att-1',
    taskId: 'task-atomic-final-1',
    attemptNumber: 1,
    state: States.RUNNING
  });

  const res = store.finalizeTaskAttempt('task-atomic-final-1', 'task-atomic-final-1-att-1', {
    state: States.COMPLETED,
    summary: 'All done',
    uncertainty: 'None',
    artifacts: [
      { artifactType: 'patch', uri: 'src/patch.diff', hash: 'sha256-abc', metadata: {} },
      { artifactType: 'evidence', uri: 'evidence/log.txt', hash: null, metadata: {} }
    ]
  });

  assert.equal(res.task.state, States.COMPLETED);
  assert.equal(res.attempt.state, States.COMPLETED);
  assert.ok(res.attempt.finishedAt > 0);

  const artifacts = store.getArtifacts('task-atomic-final-1');
  assert.equal(artifacts.length, 2);

  const events = store.getEvents('task-atomic-final-1');
  assert.ok(events.some(e => e.eventType === 'ATTEMPT_STATE_CHANGED'));
  assert.ok(events.some(e => e.eventType === 'STATE_TRANSITION'));
  assert.ok(events.some(e => e.eventType === 'ARTIFACT_RECORDED'));
});

test('Store: cancelTaskAttempt executes atomic cancellation of task and attempt', async (t) => {
  const { store } = await createTestStore(t);

  store.createTask(sampleTask('task-atomic-cancel-1'));
  store.createAttempt({
    attemptId: 'task-atomic-cancel-1-att-1',
    taskId: 'task-atomic-cancel-1',
    attemptNumber: 1,
    state: States.RUNNING
  });

  const res = store.cancelTaskAttempt('task-atomic-cancel-1', 'task-atomic-cancel-1-att-1');
  assert.equal(res.cancelled, true);
  assert.equal(res.state, States.CANCELLED);

  const task = store.getTask('task-atomic-cancel-1');
  const attempt = store.getAttempt('task-atomic-cancel-1-att-1');
  assert.equal(task.state, States.CANCELLED);
  assert.equal(attempt.state, States.CANCELLED);
  assert.equal(attempt.intent, Intents.CANCEL_REQUESTED);

  // Subsequent cancel on already terminal task returns false
  const retryCancel = store.cancelTaskAttempt('task-atomic-cancel-1', 'task-atomic-cancel-1-att-1');
  assert.equal(retryCancel.cancelled, false);
});

test('Store: cross-task mutation prevention and atomic transaction rollback', async (t) => {
  const { store } = await createTestStore(t);

  // Set up Task A with attempt A1
  store.createTask(sampleTask('task-A'));
  store.createAttempt({
    attemptId: 'attempt-A1',
    taskId: 'task-A',
    attemptNumber: 1,
    state: States.RUNNING
  });

  // Set up Task B with attempt B1
  store.createTask(sampleTask('task-B'));
  store.createAttempt({
    attemptId: 'attempt-B1',
    taskId: 'task-B',
    attemptNumber: 1,
    state: States.RUNNING
  });

  // 1. Cross-task finalizeTaskAttempt('task-A', 'attempt-B1') MUST throw mismatch
  assert.throws(() => {
    store.finalizeTaskAttempt('task-A', 'attempt-B1', {
      state: States.COMPLETED,
      summary: 'Cross-task malicious finalize',
      artifacts: [{ artifactType: 'patch', uri: 'evil.diff' }]
    });
  }, /Attempt ownership mismatch: attempt 'attempt-B1' belongs to task 'task-B', not 'task-A'/);

  // Both tasks and attempts must remain completely unmodified
  const taskA = store.getTask('task-A');
  const attemptA1 = store.getAttempt('attempt-A1');
  const taskB = store.getTask('task-B');
  const attemptB1 = store.getAttempt('attempt-B1');

  assert.equal(taskA.state, States.PENDING);
  assert.equal(attemptA1.state, States.RUNNING);
  assert.equal(taskB.state, States.PENDING);
  assert.equal(attemptB1.state, States.RUNNING);
  assert.equal(store.getArtifacts('task-A').length, 0);
  assert.equal(store.getArtifacts('task-B').length, 0);

  // 2. Cross-task cancelTaskAttempt('task-A', 'attempt-B1') MUST throw mismatch
  assert.throws(() => {
    store.cancelTaskAttempt('task-A', 'attempt-B1');
  }, /Attempt ownership mismatch/);

  assert.equal(store.getTask('task-A').state, States.PENDING);
  assert.equal(store.getAttempt('attempt-B1').state, States.RUNNING);

  // 3. Cross-task recordIntent('task-A', 'attempt-B1', ...) MUST throw mismatch
  assert.throws(() => {
    store.recordIntent('task-A', 'attempt-B1', Intents.DISPATCH_CALL);
  }, /Attempt ownership mismatch/);

  // 4. Cross-task recordArtifact('task-A', 'attempt-B1', ...) MUST throw mismatch
  assert.throws(() => {
    store.recordArtifact('task-A', 'attempt-B1', { artifactType: 'patch', uri: 'a.diff' });
  }, /Attempt ownership mismatch/);

  // 5. Cross-task recordEvent('task-A', 'attempt-B1', ...) MUST throw mismatch
  assert.throws(() => {
    store.recordEvent('task-A', 'attempt-B1', 'TEST_EVENT', {});
  }, /Attempt ownership mismatch/);

  // 6. Cross-task updateAttemptState('attempt-B1', ..., { taskId: 'task-A' }) MUST throw mismatch
  assert.throws(() => {
    store.updateAttemptState('attempt-B1', States.COMPLETED, { taskId: 'task-A' });
  }, /Attempt ownership mismatch/);
});

test('Store: rejects orphaned attempt creation on non-existent parent task', async (t) => {
  const { store } = await createTestStore(t);

  assert.throws(() => {
    store.createAttempt({
      attemptId: 'orphan-att-1',
      taskId: 'non-existent-task',
      attemptNumber: 1,
      state: States.RUNNING
    });
  }, /Parent task not found: non-existent-task/);
});

test('Store: safe handling of malformed or omitted inputs across public APIs', async (t) => {
  const { store } = await createTestStore(t);

  // Queries with omitted/non-string IDs return null or empty array safely
  assert.equal(store.getTask(null), null);
  assert.equal(store.getTask(undefined), null);
  assert.equal(store.getTask(123), null);

  assert.equal(store.getAttempt(null), null);
  assert.equal(store.getAttempt(undefined), null);
  assert.equal(store.getLatestAttempt(null), null);

  assert.deepEqual(store.getEvents(null), []);
  assert.deepEqual(store.getArtifacts(null), []);

  // Mutation APIs reject invalid/omitted arguments
  assert.throws(() => store.createTask(null), /Task must be a valid object/);
  assert.throws(() => store.createTask({}), /Task id is required/);
  assert.throws(() => store.createAttempt(null), /Attempt must be a valid object/);
  assert.throws(() => store.updateTaskState(null, States.RUNNING), /Task id is required/);
  assert.throws(() => store.updateAttemptState(null, States.RUNNING), /Attempt id is required/);
  assert.throws(() => store.recordIntent(null, 'att-1', Intents.NONE), /Task id is required/);
  assert.throws(() => store.recordEvent(null, null, 'EV', {}), /Task id is required/);
  assert.throws(() => store.recordArtifact(null, null, {}), /Task id is required/);
  assert.throws(() => store.finalizeTaskAttempt(null, 'att-1', { state: States.COMPLETED }), /Task id is required/);
  assert.throws(() => store.cancelTaskAttempt(null, 'att-1'), /Task id is required/);
});

test('SqliteTaskStore: init is idempotent and preserves single connection lifecycle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-store-idem-'));
  const dbPath = join(dir, 'test.db');
  const store = new SqliteTaskStore(dbPath);

  // 1. First init establishes connection
  await store.init();
  const initialDb = store.db;
  assert.ok(initialDb, 'Initial db connection must be established');

  // 2. Subsequent init calls are idempotent no-ops
  await store.init();
  assert.strictEqual(store.db, initialDb, 'Subsequent init() must preserve the existing connection reference');
  await store.init();
  assert.strictEqual(store.db, initialDb, 'Multiple init() calls must not overwrite connection');

  // 3. Single close cleanly releases database lock
  store.close();
  assert.equal(store.db, null, 'store.db must be null after close()');

  // Close is also safe to call repeatedly
  store.close();

  // 4. Directory can be removed immediately without EBUSY/EPERM
  await rm(dir, { recursive: true, force: true });
});

test('SqliteTaskStore: store restart behavior is preserved across close and re-init', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-store-restart-'));
  const dbPath = join(dir, 'test.db');
  const store = new SqliteTaskStore(dbPath);

  // Session 1: init and write task
  await store.init();
  store.createTask(sampleTask('task-restart-1'));
  store.close();

  // Session 2: re-init same store instance (restart simulation)
  await store.init();
  const task1 = store.getTask('task-restart-1');
  assert.ok(task1, 'Task written in session 1 must be present after re-init');
  assert.equal(task1.id, 'task-restart-1');

  // Insert another task in session 2
  store.createTask(sampleTask('task-restart-2'));
  store.close();

  // Session 3: init with separate store instance against same db file
  const storeNew = new SqliteTaskStore(dbPath);
  await storeNew.init();
  const task2 = storeNew.getTask('task-restart-2');
  assert.ok(task2, 'Task written in session 2 must be present in new store instance');
  storeNew.close();

  await rm(dir, { recursive: true, force: true });
});

