import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  SqliteTaskStore,
  TaskManager,
  WorkerStatusProjection,
  WorkerStates,
  States,
  Intents,
  ReviewStates
} from '../src/index.js';

function computeFileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function sampleTaskEnvelope(id, agent = 'RCT-1') {
  return {
    id,
    agent,
    objective: 'Implement feature in isolated workspace',
    allowedPaths: ['src/index.js'],
    contextRefs: ['docs/SPEC.md'],
    acceptance: 'All tests pass',
    verification: 'npm test',
    workspaceRoot: 'E:/Veyminore/products/zetro',
    sourceHash: 'a'.repeat(64),
    assignmentDigest: 'b'.repeat(64),
    deadlineMs: 30000,
    budget: { maxContextChars: 50000, maxReplyChars: 10000 }
  };
}

async function createPopulatedTestDatabase(t) {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-ro-test-'));
  const dbPath = join(dir, 'tasks.db');

  // Writer populates DB
  const writer = new SqliteTaskStore(dbPath);
  await writer.init();

  const task = sampleTaskEnvelope('task-ro-1', 'RCT-1');
  writer.createTask(task);

  const attemptId = 'task-ro-1-att-1';
  writer.createAttempt({
    attemptId,
    taskId: task.id,
    attemptNumber: 1,
    intent: Intents.NONE,
    state: States.RUNNING
  });

  writer.recordEvent(task.id, attemptId, 'WORKER_HEARTBEAT', {
    workerId: 'RCT-1'
  });

  writer.finalizeTaskAttempt(task.id, attemptId, {
    state: States.COMPLETED,
    summary: 'Task completed successfully with verifier evidence',
    uncertainty: 'None',
    artifacts: [
      {
        artifactType: 'verifier_evidence',
        uri: 'evidence/task-ro-1-verifier.json',
        hash: 'c'.repeat(64),
        metadata: {
          verified: true,
          verifier: 'independent-verifier',
          checks: [{ name: 'src/index.js', passed: true, sha256: 'd'.repeat(64), path: 'src/index.js' }]
        }
      }
    ]
  });

  writer.close();

  if (t && typeof t.after === 'function') {
    t.after(async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    });
  }

  return { dir, dbPath, taskId: task.id, attemptId };
}

test('Read-only SqliteTaskStore: Reopen existing DB, verify correct WorkerStatusProjection, and assert 100% byte & mtime immutability', async (t) => {
  const { dbPath, taskId, attemptId } = await createPopulatedTestDatabase(t);

  // 1. Record stats and sha256 of the writer database BEFORE read-only opening
  const beforeStat = statSync(dbPath);
  const beforeHash = computeFileSha256(dbPath);

  // 2. Open via SqliteTaskStore.openReadOnly()
  const reader = await SqliteTaskStore.openReadOnly(dbPath);
  assert.equal(reader.readOnly, true, 'Store must report readOnly === true');

  // 3. Query records through TaskStore APIs
  const task = reader.getTask(taskId);
  assert.ok(task, 'Task must be retrievable in read-only mode');
  assert.equal(task.id, taskId);
  assert.equal(task.state, States.COMPLETED);

  const attempt = reader.getAttempt(attemptId);
  assert.ok(attempt, 'Attempt must be retrievable in read-only mode');
  assert.equal(attempt.state, States.COMPLETED);

  const events = reader.getEvents(taskId);
  assert.ok(events.length >= 3, 'Events must be retrievable in read-only mode');

  const artifacts = reader.getArtifacts(taskId);
  assert.equal(artifacts.length, 1, 'Artifacts must be retrievable in read-only mode');
  assert.equal(artifacts[0].artifactType, 'verifier_evidence');

  // 4. Expose WorkerStatusProjection via read-only store queries
  const projection = await reader.createWorkerStatusProjection({ heartbeatTimeoutMs: 30000 });
  const status1 = projection.getWorkerStatus('RCT-1');
  assert.equal(status1.workerId, 'RCT-1');
  assert.equal(status1.state, WorkerStates.COMPLETED);
  assert.equal(status1.phase, 'verified_completed');
  assert.equal(status1.verified, true);
  assert.equal(status1.taskId, taskId);
  assert.equal(status1.attemptId, attemptId);

  // Bounded knownworker projection
  const allStatuses = projection.listWorkerStatuses({ knownWorkerIds: ['RCT-1', 'RCT-2', 'RCT-3'] });
  assert.equal(allStatuses.length, 3);
  const rct1 = allStatuses.find(s => s.workerId === 'RCT-1');
  const rct2 = allStatuses.find(s => s.workerId === 'RCT-2');
  assert.equal(rct1.state, WorkerStates.COMPLETED);
  assert.equal(rct1.verified, true);
  assert.equal(rct2.state, WorkerStates.IDLE);
  assert.equal(rct2.phase, 'unassigned');

  // Close reader
  reader.close();

  // 5. Assert database file bytes, hash, and mtime remain 100% UNCHANGED
  const afterStat = statSync(dbPath);
  const afterHash = computeFileSha256(dbPath);

  assert.equal(afterHash, beforeHash, 'Database file SHA-256 hash must remain 100% byte-identical');
  assert.equal(afterStat.size, beforeStat.size, 'Database file size must remain identical');
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs, 'Database file mtime must remain identical');
});

test('WorkerStatusProjection.openReadOnly: One-liner convenience factory for frontend observation', async (t) => {
  const { dbPath, taskId } = await createPopulatedTestDatabase(t);

  const beforeHash = computeFileSha256(dbPath);
  const beforeMtime = statSync(dbPath).mtimeMs;

  const projection = await WorkerStatusProjection.openReadOnly(dbPath, { heartbeatTimeoutMs: 20000 });
  assert.equal(projection.store.readOnly, true);

  const status = projection.getWorkerStatus('RCT-1');
  assert.equal(status.workerId, 'RCT-1');
  assert.equal(status.state, WorkerStates.COMPLETED);
  assert.equal(status.verified, true);
  assert.equal(status.taskId, taskId);

  projection.close();

  assert.equal(computeFileSha256(dbPath), beforeHash, 'Hash unchanged after WorkerStatusProjection queries');
  assert.equal(statSync(dbPath).mtimeMs, beforeMtime, 'mtime unchanged after WorkerStatusProjection queries');
});

test('Read-only SqliteTaskStore: Non-existent database path fails closed without creating files or directories', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'zetro-ro-absent-'));
  t.after(async () => await rm(tempDir, { recursive: true, force: true }).catch(() => {}));

  const absentDir = join(tempDir, 'never_created_dir');
  const absentDbPath = join(absentDir, 'missing_database.db');

  // Attempting to open non-existent DB in read-only mode must fail closed
  await assert.rejects(
    SqliteTaskStore.openReadOnly(absentDbPath),
    /Read-only SQLite database file does not exist/
  );

  // Absent path MUST remain absent on disk: zero directories or files created
  assert.equal(existsSync(absentDbPath), false, 'Non-existent DB file must not be created');
  assert.equal(existsSync(absentDir), false, 'Parent directory must not be created');
});

test('Read-only SqliteTaskStore: :memory: and invalid paths rejected in read-only mode', () => {
  assert.throws(
    () => new SqliteTaskStore(':memory:', { readOnly: true }),
    /Read-only SqliteTaskStore requires an existing database file path/
  );

  assert.throws(
    () => new SqliteTaskStore('', { readOnly: true }),
    /Read-only SqliteTaskStore requires an existing database file path/
  );

  assert.throws(
    () => new SqliteTaskStore(null, { readOnly: true }),
    /Read-only SqliteTaskStore requires an existing database file path/
  );
});

test('Read-only SqliteTaskStore: Incompatible or missing schema fails closed without modification', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'zetro-ro-incompat-'));
  t.after(async () => await rm(tempDir, { recursive: true, force: true }).catch(() => {}));

  // Case A: Raw SQLite DB missing required tables
  const emptyDbPath = join(tempDir, 'empty.db');
  const rawDb = new DatabaseSync(emptyDbPath);
  rawDb.exec('CREATE TABLE some_random_table (id INT);');
  rawDb.close();

  await assert.rejects(
    SqliteTaskStore.openReadOnly(emptyDbPath),
    /Incompatible or missing SQLite schema in read-only database: required table 'schema_migrations' not found/
  );

  // Case B: Database with obsolete schema version (e.g. version 1 instead of required 2)
  const v1DbPath = join(tempDir, 'v1.db');
  const v1Db = new DatabaseSync(v1DbPath);
  v1Db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER, description TEXT);
    INSERT INTO schema_migrations VALUES (1, 1, 'Initial');
    CREATE TABLE tasks (id TEXT PRIMARY KEY);
    CREATE TABLE attempts (attempt_id TEXT PRIMARY KEY);
    CREATE TABLE events (id INTEGER PRIMARY KEY);
    CREATE TABLE artifacts (id INTEGER PRIMARY KEY);
    CREATE TABLE reviews (id TEXT PRIMARY KEY, source_root TEXT);
  `);
  v1Db.close();

  await assert.rejects(
    SqliteTaskStore.openReadOnly(v1DbPath),
    /Incompatible SQLite schema in read-only database: expected schema version 2, found 1/
  );

  // Case C: Reviews table missing required column (e.g. source_root)
  const noColDbPath = join(tempDir, 'nocol.db');
  const noColDb = new DatabaseSync(noColDbPath);
  noColDb.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER, description TEXT);
    INSERT INTO schema_migrations VALUES (2, 1, 'v2');
    CREATE TABLE tasks (id TEXT PRIMARY KEY);
    CREATE TABLE attempts (attempt_id TEXT PRIMARY KEY);
    CREATE TABLE events (id INTEGER PRIMARY KEY);
    CREATE TABLE artifacts (id INTEGER PRIMARY KEY);
    CREATE TABLE reviews (id TEXT PRIMARY KEY);
  `);
  noColDb.close();

  await assert.rejects(
    SqliteTaskStore.openReadOnly(noColDbPath),
    /Incompatible SQLite schema in read-only database: required column 'source_root' missing from 'reviews'/
  );
});

test('Read-only SqliteTaskStore: ALL mutating methods strictly reject with zero DB writes', async (t) => {
  const { dbPath, taskId, attemptId } = await createPopulatedTestDatabase(t);

  const beforeHash = computeFileSha256(dbPath);
  const beforeMtime = statSync(dbPath).mtimeMs;

  const reader = await SqliteTaskStore.openReadOnly(dbPath);
  const projection = new WorkerStatusProjection(reader);

  // 1. Transaction
  assert.throws(() => reader.transaction(() => {}), /Cannot execute transaction in read-only SqliteTaskStore/);

  // 2. Task mutations
  assert.throws(() => reader.createTask(sampleTaskEnvelope('task-new')), /Cannot create task in read-only SqliteTaskStore/);
  assert.throws(() => reader.updateTaskState(taskId, States.RUNNING), /Cannot update task state in read-only SqliteTaskStore/);

  // 3. Attempt mutations
  assert.throws(() => reader.createAttempt({ attemptId: 'att-new', taskId, attemptNumber: 2 }), /Cannot create attempt in read-only SqliteTaskStore/);
  assert.throws(() => reader.updateAttemptState(attemptId, States.FAILED), /Cannot update attempt state in read-only SqliteTaskStore/);
  assert.throws(() => reader.recordIntent(taskId, attemptId, Intents.DISPATCH_CALL), /Cannot record intent in read-only SqliteTaskStore/);
  assert.throws(() => reader.finalizeTaskAttempt(taskId, attemptId, { state: States.FAILED }), /Cannot finalize task attempt in read-only SqliteTaskStore/);
  assert.throws(() => reader.cancelTaskAttempt(taskId, attemptId), /Cannot cancel task attempt in read-only SqliteTaskStore/);

  // 4. Events & Artifacts mutations
  assert.throws(() => reader.recordEvent(taskId, attemptId, 'CUSTOM_EVENT', {}), /Cannot record event in read-only SqliteTaskStore/);
  assert.throws(() => reader.recordArtifact(taskId, attemptId, { artifactType: 'patch', uri: 'uri.patch' }), /Cannot record artifact in read-only SqliteTaskStore/);

  // 5. Crash recovery reconciliation mutation
  assert.throws(() => reader.reconcileInterruptedWork(), /Cannot reconcile interrupted work in read-only SqliteTaskStore/);

  // 6. Review mutations
  assert.throws(() => reader.createReview({ id: 'rev-new' }), /Cannot create review in read-only SqliteTaskStore/);
  assert.throws(() => reader.updateReviewState('rev-1', ReviewStates.APPROVED), /Cannot update review state in read-only SqliteTaskStore/);
  assert.throws(() => reader.finalizeReviewApproval('rev-1'), /Cannot finalize review approval in read-only SqliteTaskStore/);
  assert.throws(() => reader.finalizeReviewRejection('rev-1'), /Cannot finalize review rejection in read-only SqliteTaskStore/);
  assert.throws(() => reader.finalizeReviewDiscard('rev-1'), /Cannot finalize review discard in read-only SqliteTaskStore/);

  // 7. WorkerStatusProjection heartbeat recording mutation
  assert.throws(() => projection.recordHeartbeat('RCT-1', taskId, attemptId), /Cannot record event in read-only SqliteTaskStore/);

  reader.close();

  // Final confirmation: exactly zero mutations occurred on disk
  assert.equal(computeFileSha256(dbPath), beforeHash, 'Database file SHA-256 hash must remain identical after all rejected mutations');
  assert.equal(statSync(dbPath).mtimeMs, beforeMtime, 'Database file mtime must remain identical after all rejected mutations');
});

test('TaskManager: Initialized with read-only store operates in observer mode without reconcile writes', async (t) => {
  const { dbPath, taskId } = await createPopulatedTestDatabase(t);

  const beforeHash = computeFileSha256(dbPath);
  const beforeMtime = statSync(dbPath).mtimeMs;

  const reader = await SqliteTaskStore.openReadOnly(dbPath);
  const manager = new TaskManager(reader, null);

  // TaskManager.init() should succeed cleanly without running reconcileInterruptedWork
  const reconciled = await manager.init();
  assert.deepEqual(reconciled, [], 'Read-only store init must return empty array without reconciling');

  // Read-only observer APIs must work
  const status = manager.status(taskId);
  assert.equal(status.id, taskId);
  assert.equal(status.state, States.COMPLETED);

  const events = manager.events(taskId);
  assert.ok(events.length >= 3);

  const evidence = manager.evidence(taskId);
  assert.equal(evidence.artifacts.length, 1);

  const workerStatus = manager.getWorkerStatus('RCT-1');
  assert.equal(workerStatus.workerId, 'RCT-1');
  assert.equal(workerStatus.verified, true);

  const workerList = manager.listWorkerStatuses({ knownWorkerIds: ['RCT-1', 'RCT-2'] });
  assert.equal(workerList.length, 2);

  // Mutating actions fail closed
  await assert.rejects(
    manager.run(sampleTaskEnvelope('task-mut-1')),
    /Cannot create task in read-only SqliteTaskStore/
  );

  manager.close();

  assert.equal(computeFileSha256(dbPath), beforeHash, 'Database file SHA-256 hash must remain identical');
  assert.equal(statSync(dbPath).mtimeMs, beforeMtime, 'Database file mtime must remain identical');
});
