import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
  SqliteTaskStore,
  States,
  Intents,
  DEFAULT_WORKER_ID,
  WorkerStates
} from '../src/index.js';
import { sha256 } from '../../rct-runtime/src/index.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = resolve(fileURLToPath(import.meta.url), '../../src/cli.js');
const SUBPROCESS_WORKER_PATH = resolve(fileURLToPath(import.meta.url), '../../src/helpers/writer-subprocess.js');

function computeFileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function createSyntheticWorkspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-cli-ws-'));
  const filePath = 'src/calc.js';
  const initialContent = 'export function add(a, b) {\n  return 0;\n}\n';
  const fullPath = join(dir, filePath);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(fullPath, initialContent, 'utf8');
  const initialHash = sha256(Buffer.from(initialContent));

  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  return {
    sourceRoot: dir,
    filePath,
    initialContent,
    initialHash,
    fullPath,
    async readSource() {
      return await readFile(fullPath, 'utf8');
    }
  };
}

async function createTempDataDir(t, prefix = 'zetro-cli-data-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  return dir;
}

function createSampleEnvelope(id, ws, overrides = {}) {
  const filePath = ws?.filePath || 'src/calc.js';
  const initialHash = ws?.initialHash || 'a'.repeat(64);
  return {
    id,
    agent: DEFAULT_WORKER_ID,
    objective: 'Implement addition function in isolated snapshot',
    allowedPaths: [filePath],
    contextRefs: ['README.md'],
    acceptance: 'calc.js exports add(a, b) returning a + b',
    verification: filePath,
    declaredChecks: [filePath],
    workspaceRoot: ws?.sourceRoot || 'E:/Veyminore/products/zetro',
    sourceHash: initialHash,
    sourceHashes: { [filePath]: initialHash },
    assignmentDigest: 'd'.repeat(64),
    deadlineMs: 30000,
    budget: { maxContextChars: 10000, maxReplyChars: 5000 },
    checks: [
      {
        type: 'contains',
        path: filePath,
        text: 'return a + b;'
      }
    ],
    ...overrides
  };
}

test('CLI help: prints usage instructions and exits 0', async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [CLI_PATH, '--help'],
    { timeout: 5000 }
  );
  assert.equal(stderr, '');
  assert.match(stdout, /ZETRO Orchestration Core CLI/);
  assert.match(stdout, /run \[envelope\]/);
  assert.match(stdout, /status \[taskId\]/);
  assert.match(stdout, /events \[taskId\]/);
  assert.match(stdout, /worker-status \[workerId\]/);
  assert.match(stdout, /cancel \[taskId\]/);
  assert.match(stdout, /--data-dir/);
});

test('CLI run: executes TaskEnvelope offline on single worker RCT-1, retains tasks.db on disk, produces COMPLETED with verifier evidence', async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');

  const envelope = createSampleEnvelope('task-cli-run-1', ws);
  const envelopePath = join(dataDir, 'envelope.json');
  await writeFile(envelopePath, JSON.stringify(envelope, null, 2), 'utf8');

  const patches = [
    {
      path: 'src/calc.js',
      expectedSha256: ws.initialHash,
      content: 'export function add(a, b) {\n  return a + b;\n}\n'
    }
  ];

  // Spawn CLI run
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      CLI_PATH,
      'run',
      envelopePath,
      '--data-dir',
      dataDir,
      '--patches',
      JSON.stringify(patches),
      '--json'
    ],
    { timeout: 10000 }
  );

  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.id, 'task-cli-run-1');
  assert.equal(result.state, States.COMPLETED);
  assert.equal(result.agent, DEFAULT_WORKER_ID);
  assert.equal(result.latestAttempt?.state, States.COMPLETED);

  // 1. Persistent retention: tasks.db remains on disk after process exit
  assert.equal(existsSync(dbPath), true, 'SQLite database must remain on disk upon CLI exit');
  const dbStat = statSync(dbPath);
  assert.ok(dbStat.size > 0, 'Database file must have non-zero size');

  // 2. Original workspace source immutability: byte-identical to initial content
  const currentContent = await ws.readSource();
  assert.equal(currentContent, ws.initialContent, 'Baseline source files must remain 100% byte-identical');
  assert.equal(sha256(Buffer.from(currentContent)), ws.initialHash);
});

test('CLI status: queries retained tasks.db in strictly read-only mode, preserves byte & mtime immutability', async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');

  // Seed DB with completed task
  const store = new SqliteTaskStore(dbPath);
  await store.init();
  const envelope = createSampleEnvelope('task-cli-status-1', ws, { state: States.COMPLETED });
  store.createTask(envelope);
  store.createAttempt({
    attemptId: 'att-status-1',
    taskId: envelope.id,
    attemptNumber: 1,
    state: States.COMPLETED,
    intent: Intents.NONE
  });
  store.close();

  // Snapshot database bytes and mtime before query
  const hashBefore = computeFileSha256(dbPath);
  const statBefore = statSync(dbPath);

  // Spawn CLI status
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      CLI_PATH,
      'status',
      'task-cli-status-1',
      '--data-dir',
      dataDir,
      '--json'
    ],
    { timeout: 5000 }
  );

  assert.equal(stderr, '');
  const status = JSON.parse(stdout);
  assert.equal(status.id, 'task-cli-status-1');
  assert.equal(status.state, States.COMPLETED);
  assert.equal(status.latestAttempt?.attemptId, 'att-status-1');

  // Assert 100% byte & mtime immutability
  const hashAfter = computeFileSha256(dbPath);
  const statAfter = statSync(dbPath);
  assert.equal(hashAfter, hashBefore, 'Database SHA-256 must remain strictly identical');
  assert.equal(statAfter.mtimeMs, statBefore.mtimeMs, 'Database mtime must remain strictly identical');
  assert.equal(statAfter.size, statBefore.size, 'Database size must remain strictly identical');

  // Fail-closed on missing database: zero files created
  const missingDir = join(dataDir, 'non-existent-sub');
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        CLI_PATH,
        'status',
        'task-cli-status-1',
        '--data-dir',
        missingDir,
        '--json'
      ],
      { timeout: 5000 }
    ),
    (err) => {
      assert.ok(err.message.includes('Read-only SQLite database file does not exist'));
      assert.equal(existsSync(missingDir), false, 'Non-existent directory must never be created');
      return true;
    }
  );
});

test('CLI events: queries audit event trail in strictly read-only mode', async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');

  const store = new SqliteTaskStore(dbPath);
  await store.init();
  const envelope = createSampleEnvelope('task-cli-events-1', ws);
  store.createTask(envelope);
  store.createAttempt({
    attemptId: 'att-events-1',
    taskId: 'task-cli-events-1',
    attemptNumber: 1,
    state: States.RUNNING,
    intent: Intents.DISPATCH_CALL
  });
  store.recordEvent('task-cli-events-1', 'att-events-1', 'DISPATCH_INVOKED', { turn: 1 });
  store.recordEvent('task-cli-events-1', 'att-events-1', 'VERIFIER_PASSED', { verified: true });
  store.close();

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      CLI_PATH,
      'events',
      'task-cli-events-1',
      '--data-dir',
      dataDir,
      '--json'
    ],
    { timeout: 5000 }
  );

  assert.equal(stderr, '');
  const events = JSON.parse(stdout);
  assert.ok(Array.isArray(events), 'Events must be an array');
  assert.ok(events.length >= 4, `Expected at least 4 events, got ${events.length}`);
  const eventTypes = events.map(e => e.eventType);
  assert.ok(eventTypes.includes('TASK_CREATED'));
  assert.ok(eventTypes.includes('ATTEMPT_STARTED'));
  assert.ok(eventTypes.includes('DISPATCH_INVOKED'));
  assert.ok(eventTypes.includes('VERIFIER_PASSED'));
});

test('CLI evidence: retrieves verifier evidence and artifacts in read-only mode', async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');

  const store = new SqliteTaskStore(dbPath);
  await store.init();
  const envelope = createSampleEnvelope('task-cli-evidence-1', ws);
  store.createTask(envelope);
  store.createAttempt({
    attemptId: 'att-ev-1',
    taskId: 'task-cli-evidence-1',
    attemptNumber: 1,
    state: States.COMPLETED,
    intent: Intents.NONE
  });
  store.recordArtifact('task-cli-evidence-1', 'att-ev-1', {
    artifactType: 'verifier_evidence',
    uri: 'evidence/verifier.json',
    hash: 'e'.repeat(64),
    metadata: { verified: true, checks: [{ name: 'unit-test', passed: true }] }
  });
  store.close();

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      CLI_PATH,
      'evidence',
      'task-cli-evidence-1',
      '--data-dir',
      dataDir,
      '--json'
    ],
    { timeout: 5000 }
  );

  assert.equal(stderr, '');
  const evidence = JSON.parse(stdout);
  assert.equal(evidence.taskId, 'task-cli-evidence-1');
  assert.ok(Array.isArray(evidence.artifacts));
  assert.equal(evidence.artifacts[0].artifactType, 'verifier_evidence');
  assert.equal(evidence.artifacts[0].hash, 'e'.repeat(64));
});

test('CLI worker-status: queries single-worker status projection in read-only mode', async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');

  const store = new SqliteTaskStore(dbPath);
  await store.init();
  const envelope = createSampleEnvelope('task-cli-ws-1', ws);
  store.createTask(envelope);
  store.createAttempt({
    attemptId: 'att-ws-1',
    taskId: 'task-cli-ws-1',
    attemptNumber: 1,
    state: States.RUNNING,
    intent: Intents.DISPATCH_CALL
  });
  store.recordEvent('task-cli-ws-1', 'att-ws-1', 'WORKER_HEARTBEAT', {
    workerId: 'RCT-1',
    activeAttemptId: 'att-ws-1',
    timestamp: new Date().toISOString()
  });
  store.close();

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      CLI_PATH,
      'worker-status',
      'RCT-1',
      '--data-dir',
      dataDir,
      '--json'
    ],
    { timeout: 5000 }
  );

  assert.equal(stderr, '');
  const workerStatus = JSON.parse(stdout);
  assert.equal(workerStatus.workerId, 'RCT-1');
  assert.equal(workerStatus.state, WorkerStates.RUNNING);
  assert.equal(workerStatus.taskId, 'task-cli-ws-1');
  assert.equal(workerStatus.attemptId, 'att-ws-1');
});

test('CLI cancel: cancels active task in persistent DB and transitions state', async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');

  const store = new SqliteTaskStore(dbPath);
  await store.init();
  const envelope = createSampleEnvelope('task-cli-cancel-1', ws);
  store.createTask(envelope);
  store.createAttempt({
    attemptId: 'att-cancel-1',
    taskId: 'task-cli-cancel-1',
    attemptNumber: 1,
    state: States.RUNNING,
    intent: Intents.DISPATCH_CALL
  });
  store.close();

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      CLI_PATH,
      'cancel',
      'task-cli-cancel-1',
      '--data-dir',
      dataDir,
      '--reason',
      'Cancelled by operator test',
      '--json'
    ],
    { timeout: 5000 }
  );

  assert.equal(stderr, '');
  const cancelResult = JSON.parse(stdout);
  assert.equal(cancelResult.cancelled, true);

  // Check state via read-only status query
  const statusOut = await execFileAsync(
    process.execPath,
    [
      CLI_PATH,
      'status',
      'task-cli-cancel-1',
      '--data-dir',
      dataDir,
      '--json'
    ],
    { timeout: 5000 }
  );
  const status = JSON.parse(statusOut.stdout);
  assert.equal(status.state, States.CANCELLED);
  assert.equal(status.latestAttempt?.state, States.CANCELLED);
});

test('CLI crash recovery: reconciles interrupted in-flight attempts on startup with zero duplicate dispatch', async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');

  // Simulate an interrupted host: task and attempt left in RUNNING with open intent window
  const store = new SqliteTaskStore(dbPath);
  await store.init();
  const envelope = createSampleEnvelope('task-crashed-1', ws, {
    state: States.RUNNING,
    objective: 'Interrupted task before host crashed'
  });
  store.createTask(envelope);
  store.createAttempt({
    attemptId: 'att-crashed-1',
    taskId: 'task-crashed-1',
    attemptNumber: 1,
    state: States.RUNNING,
    intent: Intents.DISPATCH_CALL,
    intentData: { note: 'Interrupted during model execution' }
  });
  store.close();

  // 1. Run reconcile command
  const { stdout: recStdout } = await execFileAsync(
    process.execPath,
    [
      CLI_PATH,
      'reconcile',
      '--data-dir',
      dataDir,
      '--json'
    ],
    { timeout: 5000 }
  );
  const recResult = JSON.parse(recStdout);
  assert.deepEqual(recResult.reconciledTaskIds, ['task-crashed-1']);

  // 2. Query status: state must be UNKNOWN
  const { stdout: statusStdout } = await execFileAsync(
    process.execPath,
    [
      CLI_PATH,
      'status',
      'task-crashed-1',
      '--data-dir',
      dataDir,
      '--json'
    ],
    { timeout: 5000 }
  );
  const status = JSON.parse(statusStdout);
  assert.equal(status.state, States.UNKNOWN);
  assert.equal(status.latestAttempt?.state, States.UNKNOWN);
  assert.match(status.uncertainty, /Interrupted in-flight during crash\/restart/);

  // 3. Worker slot must report INTERRUPTED (reflecting interrupted crash recovery)
  const { stdout: wsStdout } = await execFileAsync(
    process.execPath,
    [
      CLI_PATH,
      'worker-status',
      'RCT-1',
      '--data-dir',
      dataDir,
      '--json'
    ],
    { timeout: 5000 }
  );
  const workerStatus = JSON.parse(wsStdout);
  assert.equal(workerStatus.state, WorkerStates.INTERRUPTED);
  assert.equal(workerStatus.taskId, 'task-crashed-1');
});

test('Single-worker capacity constraint: rejects concurrent dispatch when worker slot is busy', { timeout: 10000 }, async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);

  // Slow provider that stays in RUNNING until released
  let finishTask;
  let finished = false;
  let turn = 0;
  const slowProvider = {
    name: 'slow-test-provider',
    async next() {
      turn++;
      if (turn === 1) {
        if (!finished) {
          await new Promise(resolve => { finishTask = resolve; });
        }
        return {
          toolCalls: [{
            name: 'propose_patch',
            args: {
              path: ws.filePath,
              expectedSha256: ws.initialHash,
              content: 'export function add(a, b) {\n  return a + b;\n}\n'
            }
          }],
          usage: { inputTokens: 50, outputTokens: 20 }
        };
      }
      return {
        toolCalls: [{
          name: 'submit_receipt',
          args: { summary: 'Finished' }
        }],
        usage: { inputTokens: 50, outputTokens: 20 }
      };
    }
  };

  const { RctHost } = await import('../src/index.js');
  const host = new RctHost({
    dataDir,
    workerId: 'RCT-1',
    provider: slowProvider,
    sourceRoot: ws.sourceRoot
  });
  await host.init();

  const env1 = createSampleEnvelope('task-concurrent-1', ws, { deadlineMs: 10000 });
  const env2 = createSampleEnvelope('task-concurrent-2', ws, { deadlineMs: 10000 });

  try {
    // 1. Dispatch first task
    const run1Promise = host.runTask(env1);

    // Give host time to transition task to RUNNING
    await new Promise(r => setTimeout(r, 50));

    // Verify worker status is RUNNING
    const workerStatus = host.getWorkerStatus();
    assert.equal(workerStatus.state, WorkerStates.RUNNING);
    assert.equal(workerStatus.taskId, 'task-concurrent-1');

    // 2. Concurrent dispatch on same single-worker host MUST reject immediately
    await assert.rejects(
      host.runTask(env2),
      /single-worker capacity guard rejects concurrent dispatch/
    );

    // 3. Complete first task cleanly
    finished = true;
    if (finishTask) finishTask();
    const res1 = await run1Promise;
    assert.equal(res1.state, States.COMPLETED);
  } finally {
    finished = true;
    if (finishTask) finishTask();
    host.close();
  }
});

test('Two-host same-SQLite overlapping provider barrier: proves at most 1 physical provider runs', { timeout: 10000 }, async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');

  let releaseHost1Barrier;
  let host1TurnStarted = false;
  let host1Turn = 0;
  let host1ProviderCalls = 0;
  let barrierResolve, barrierReject;
  const host1EnteredBarrier = new Promise((resolve, reject) => {
    barrierResolve = resolve;
    barrierReject = reject;
  });

  const slowProviderHost1 = {
    name: 'host1-slow-provider',
    async next() {
      try {
        host1Turn++;
        if (host1Turn === 1) {
          host1ProviderCalls++;
          host1TurnStarted = true;
          barrierResolve();
          await new Promise(resolve => { releaseHost1Barrier = resolve; });
          return {
            toolCalls: [
              {
                name: 'propose_patch',
                args: {
                  path: ws.filePath,
                  expectedSha256: ws.initialHash,
                  content: 'export function add(a, b) {\n  return a + b;\n}\n'
                }
              }
            ],
            usage: { inputTokens: 50, outputTokens: 20 }
          };
        }
        return {
          toolCalls: [
            {
              name: 'submit_receipt',
              args: { summary: 'Host 1 completed successfully' }
            }
          ],
          usage: { inputTokens: 50, outputTokens: 20 }
        };
      } catch (err) {
        barrierReject(err);
        throw err;
      }
    }
  };

  let host2Turn = 0;
  let host2ProviderCalls = 0;
  const providerHost2 = {
    name: 'host2-provider',
    async next() {
      host2Turn++;
      if (host2Turn === 1) {
        host2ProviderCalls++;
        return {
          toolCalls: [
            {
              name: 'propose_patch',
              args: {
                path: ws.filePath,
                expectedSha256: ws.initialHash,
                content: 'export function add(a, b) {\n  return a + b;\n}\n'
              }
            }
          ],
          usage: { inputTokens: 50, outputTokens: 20 }
        };
      }
      return {
        toolCalls: [
          {
            name: 'submit_receipt',
            args: { summary: 'Host 2 completed successfully' }
          }
        ],
        usage: { inputTokens: 50, outputTokens: 20 }
      };
    }
  };

  const { RctHost } = await import('../src/index.js');

  // Create two separate host instances pointing to the EXACT same SQLite database file
  const host1 = new RctHost({
    dbPath,
    workerId: 'RCT-1',
    provider: slowProviderHost1,
    sourceRoot: ws.sourceRoot
  });
  await host1.init();

  const host2 = new RctHost({
    dbPath,
    workerId: 'RCT-1',
    provider: providerHost2,
    sourceRoot: ws.sourceRoot
  });
  await host2.init();

  const env1 = createSampleEnvelope('task-barrier-1', ws, { deadlineMs: 10000 });
  const env2 = createSampleEnvelope('task-barrier-2', ws, { deadlineMs: 10000 });

  let run1Promise;
  try {
    // 1. Start Host 1 task in background
    run1Promise = host1.runTask(env1);

    // Bounded barrier wait with early error propagation if Host 1 fails to enter
    await Promise.race([
      host1EnteredBarrier,
      run1Promise.then(() => { throw new Error('Host 1 task finished prematurely without waiting at barrier'); }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for Host 1 barrier entry')), 4000))
    ]);

    assert.equal(host1ProviderCalls, 1, 'Host 1 must be inside active provider execution');

    // 2. While Host 1 is active, Host 2 attempts to run on the SAME SQLite DB
    await assert.rejects(
      host2.runTask(env2),
      (err) => {
        assert.match(
          err.message,
          /single-worker capacity guard rejects concurrent dispatch/
        );
        return true;
      }
    );

    // CRITICAL INVARIANT: Host 2's physical provider was NEVER called!
    assert.equal(host2ProviderCalls, 0, 'Host 2 provider must NOT be invoked while Host 1 holds the slot');

    // 3. Release Host 1 barrier and wait for completion
    if (releaseHost1Barrier) releaseHost1Barrier();
    const res1 = await run1Promise;
    assert.equal(res1.state, States.COMPLETED);

    // 4. Now that Host 1 finished and released the lease, Host 2 can run
    const res2 = await host2.runTask(env2);
    assert.equal(res2.state, States.COMPLETED);
    assert.equal(host2ProviderCalls, 1, 'Host 2 provider runs exactly once now that slot is free');
  } finally {
    if (releaseHost1Barrier) releaseHost1Barrier();
    host1.close();
    host2.close();
  }
});

test('Stale-running attempt negative test: stale telemetry never means slot free', { timeout: 10000 }, async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');

  const store = new SqliteTaskStore(dbPath);
  await store.init();

  // Create an active attempt with past/expired heartbeat (stale telemetry)
  const env1 = createSampleEnvelope('task-stale-telemetry', ws, { state: States.RUNNING });
  store.createTask(env1);
  const staleAttemptId = 'att-stale-1';
  store.createAttempt({
    attemptId: staleAttemptId,
    taskId: env1.id,
    attemptNumber: 1,
    state: States.RUNNING,
    intent: Intents.NONE,
    startedAt: Date.now() - 120000
  });

  // Record an expired heartbeat 90 seconds ago (heartbeat timeout is 30s)
  store.recordEvent(env1.id, staleAttemptId, 'WORKER_HEARTBEAT', {
    workerId: 'RCT-1',
    activeAttemptId: staleAttemptId,
    timestamp: new Date(Date.now() - 90000).toISOString()
  });
  store.close();

  // Verify WorkerStatusProjection projects STALE
  const { WorkerStatusProjection, RctHost } = await import('../src/index.js');
  const projection = await WorkerStatusProjection.openReadOnly(dbPath);
  const projectedStatus = projection.getWorkerStatus('RCT-1');
  assert.equal(projectedStatus.state, WorkerStates.STALE);
  projection.close();

  // Host attempts to dispatch a new task without running recovery
  const host = new RctHost({
    dbPath,
    workerId: 'RCT-1',
    sourceRoot: ws.sourceRoot
  });
  await host.init();

  const env2 = createSampleEnvelope('task-second-attempt', ws);

  try {
    // Dispatch MUST reject: stale telemetry does NOT free the slot!
    await assert.rejects(
      host.runTask(env2),
      (err) => {
        assert.match(
          err.message,
          /single-worker capacity guard rejects concurrent dispatch \(stale telemetry does not free the slot\)/
        );
        return true;
      }
    );
  } finally {
    host.close();
  }
});

test('Concurrent run admission: separate host init protects live writer from auto-reconciliation', { timeout: 10000 }, async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');

  let releaseHost1;
  let host1Entered = false;
  let liveTurn = 0;
  let barrierResolve, barrierReject;
  const host1EnteredBarrier = new Promise((resolve, reject) => {
    barrierResolve = resolve;
    barrierReject = reject;
  });

  const liveProvider = {
    name: 'live-writer-provider',
    async next() {
      try {
        liveTurn++;
        if (liveTurn === 1) {
          host1Entered = true;
          barrierResolve();
          await new Promise(r => { releaseHost1 = r; });
          return {
            toolCalls: [
              {
                name: 'propose_patch',
                args: {
                  path: ws.filePath,
                  expectedSha256: ws.initialHash,
                  content: 'export function add(a, b) {\n  return a + b;\n}\n'
                }
              }
            ],
            usage: { inputTokens: 50, outputTokens: 20 }
          };
        }
        return {
          toolCalls: [
            {
              name: 'submit_receipt',
              args: { summary: 'Live writer completed' }
            }
          ],
          usage: { inputTokens: 50, outputTokens: 20 }
        };
      } catch (err) {
        barrierReject(err);
        throw err;
      }
    }
  };

  const { RctHost } = await import('../src/index.js');

  const host1 = new RctHost({
    dbPath,
    workerId: 'RCT-1',
    provider: liveProvider,
    sourceRoot: ws.sourceRoot
  });
  await host1.init();

  const host2 = new RctHost({
    dbPath,
    workerId: 'RCT-1',
    sourceRoot: ws.sourceRoot
  });

  const env1 = createSampleEnvelope('task-live-writer', ws, { deadlineMs: 10000 });
  let run1Promise;

  try {
    run1Promise = host1.runTask(env1);

    // Bounded wait with early error propagation if Host 1 fails to enter
    await Promise.race([
      host1EnteredBarrier,
      run1Promise.then(() => { throw new Error('Host 1 task finished prematurely without waiting at barrier'); }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for Live Writer barrier entry')), 4000))
    ]);

    // Host 2 starts up against the same SQLite database while Host 1 is alive
    // Host 2 calls init()
    // CRITICAL INVARIANT: Host 2 MUST NOT reconcile Host 1's active running task!
    const { reconciledTaskIds } = await host2.init();
    assert.deepEqual(reconciledTaskIds, [], 'Host 2 init must NOT reconcile active live writer');

    // Verify task-live-writer in SQLite is STILL RUNNING (not corrupted to UNKNOWN)
    const store = await SqliteTaskStore.openReadOnly(dbPath);
    const task = store.getTask('task-live-writer');
    assert.equal(task.state, States.RUNNING, 'Live writer task must remain in RUNNING state');
    const attempt = store.getLatestAttempt('task-live-writer');
    assert.equal(attempt.state, States.RUNNING, 'Live writer attempt must remain in RUNNING state');
    store.close();

    // Release Host 1 and assert successful completion
    if (releaseHost1) releaseHost1();
    const res1 = await run1Promise;
    assert.equal(res1.state, States.COMPLETED);
  } finally {
    if (releaseHost1) releaseHost1();
    host1.close();
    host2.close();
  }
});

test('Live lease safety: duplicate call cannot release live lease and explicit recovery cannot disrupt original', { timeout: 10000 }, async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');

  let releaseBarrier;
  let hostEntered = false;
  let turn = 0;
  let barrierResolve, barrierReject;
  const hostEnteredBarrier = new Promise((resolve, reject) => {
    barrierResolve = resolve;
    barrierReject = reject;
  });

  const liveProvider = {
    name: 'live-writer-provider',
    async next() {
      try {
        turn++;
        if (turn === 1) {
          hostEntered = true;
          barrierResolve();
          await new Promise(r => { releaseBarrier = r; });
          return {
            toolCalls: [
              {
                name: 'propose_patch',
                args: {
                  path: ws.filePath,
                  expectedSha256: ws.initialHash,
                  content: 'export function add(a, b) {\n  return a + b;\n}\n'
                }
              }
            ],
            usage: { inputTokens: 50, outputTokens: 20 }
          };
        }
        return {
          toolCalls: [
            {
              name: 'submit_receipt',
              args: { summary: 'Completed successfully' }
            }
          ],
          usage: { inputTokens: 50, outputTokens: 20 }
        };
      } catch (err) {
        barrierReject(err);
        throw err;
      }
    }
  };

  const { RctHost } = await import('../src/index.js');

  const host = new RctHost({
    dbPath,
    workerId: 'RCT-1',
    provider: liveProvider,
    sourceRoot: ws.sourceRoot
  });
  await host.init();

  const env = createSampleEnvelope('task-live-lease-probe', ws, { deadlineMs: 10000 });
  let runPromise;

  try {
    runPromise = host.runTask(env);

    await Promise.race([
      hostEnteredBarrier,
      runPromise.then(() => { throw new Error('Task finished prematurely without waiting at barrier'); }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for barrier entry')), 4000))
    ]);

    const store = await SqliteTaskStore.openReadOnly(dbPath);
    const leaseBefore = store.getWorkerLease('RCT-1');
    assert.ok(leaseBefore, 'Lease must exist in SQLite');
    assert.equal(leaseBefore.released_at, null, 'Lease must be unreleased while active');
    assert.equal(leaseBefore.task_id, 'task-live-lease-probe');
    assert.ok(leaseBefore.invocation_token, 'Lease must have non-empty invocation token');
    store.close();

    // 1. Duplicate same host.runTask(sameenv) call MUST reject
    await assert.rejects(
      host.runTask(env),
      /single-worker capacity guard rejects concurrent dispatch/
    );

    // 2. CRITICAL REGRESSION ASSERTION: Duplicate rejection MUST NOT release the live lease!
    const storeAfter = await SqliteTaskStore.openReadOnly(dbPath);
    const leaseAfterDup = storeAfter.getWorkerLease('RCT-1');
    assert.equal(leaseAfterDup.released_at, null, 'Lease must remain unreleased after duplicate call rejection');
    assert.equal(leaseAfterDup.task_id, 'task-live-lease-probe');
    assert.equal(leaseAfterDup.invocation_token, leaseBefore.invocation_token, 'Invocation token must remain strictly unchanged');

    // 3. Explicit recovery MUST NOT disrupt the original active writer
    const { reconciledTaskIds } = await host.reconcile();
    assert.deepEqual(reconciledTaskIds, [], 'Explicit recovery must not reconcile live writer');

    const taskInDb = storeAfter.getTask('task-live-lease-probe');
    assert.equal(taskInDb.state, States.RUNNING, 'Original task must remain RUNNING');
    const leaseAfterRec = storeAfter.getWorkerLease('RCT-1');
    assert.equal(leaseAfterRec.released_at, null, 'Lease must remain unreleased after explicit recovery');
    storeAfter.close();

    // 4. Release barrier and verify original completes cleanly
    if (releaseBarrier) releaseBarrier();
    const result = await runPromise;
    assert.equal(result.state, States.COMPLETED);

    // 5. Once original completes, lease is released
    const storeFinal = await SqliteTaskStore.openReadOnly(dbPath);
    const leaseFinal = storeFinal.getWorkerLease('RCT-1');
    assert.ok(leaseFinal.released_at != null, 'Lease must be released once original completes');
    storeFinal.close();
  } finally {
    if (releaseBarrier) releaseBarrier();
    host.close();
  }
});

test('Lease renewal failure abort: lost lease immediately aborts active execution to prevent split-brain', { timeout: 10000 }, async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');

  let releaseBarrier;
  let hostEntered = false;
  let turn = 0;
  let barrierResolve, barrierReject;
  const hostEnteredBarrier = new Promise((resolve, reject) => {
    barrierResolve = resolve;
    barrierReject = reject;
  });

  const longProvider = {
    name: 'long-hanging-provider',
    async next() {
      try {
        turn++;
        if (turn === 1) {
          hostEntered = true;
          barrierResolve();
          await new Promise(r => { releaseBarrier = r; });
          return {
            toolCalls: [{
              name: 'submit_receipt',
              args: { summary: 'Done' }
            }],
            usage: { inputTokens: 50, outputTokens: 20 }
          };
        }
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'Done' } }],
          usage: { inputTokens: 50, outputTokens: 20 }
        };
      } catch (err) {
        barrierReject(err);
        throw err;
      }
    }
  };

  const { RctHost } = await import('../src/index.js');

  const host = new RctHost({
    dbPath,
    workerId: 'RCT-1',
    provider: longProvider,
    sourceRoot: ws.sourceRoot
  });
  await host.init();

  const env = createSampleEnvelope('task-renewal-abort', ws, { deadlineMs: 15000 });
  let runPromise;

  try {
    runPromise = host.runTask(env);

    await Promise.race([
      hostEnteredBarrier,
      runPromise.then(() => { throw new Error('Task finished prematurely without waiting at barrier'); }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for barrier entry')), 4000))
    ]);

    // Force lease usurpation / loss in SQLite by changing invocation_token behind the scenes
    const rawStore = new SqliteTaskStore(dbPath);
    await rawStore.init();
    rawStore.db.prepare(`
      UPDATE worker_leases
      SET invocation_token = 'foreign-token'
      WHERE worker_id = 'RCT-1'
    `).run();
    rawStore.close();

    // Next renewal heartbeat (runs every 1000ms) will fail because invocation_token no longer matches!
    // Active execution MUST be aborted cleanly (cancelled)
    const result = await runPromise;
    assert.equal(result.state, States.CANCELLED, 'Execution must be cancelled upon lease renewal failure');
    assert.match(result.uncertainty || result.error || '', /lease/i);
  } finally {
    if (releaseBarrier) releaseBarrier();
    host.close();
  }
});

test('Cross-process concurrency barrier: spawned writer subprocesses against same SQLite, only 1 provider enters, loser denied, source unchanged, readonly status reflects active task, explicit recovery while live denied', { timeout: 15000 }, async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');
  const barrierDir = await createTempDataDir(t, 'zetro-barrier-');

  const children = [];
  t.after(() => {
    for (const child of children) {
      if (!child.killed && child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    }
  });

  // 1. Spawn Writer 1 subprocess
  const child1 = fork(
    SUBPROCESS_WORKER_PATH,
    [
      '--db', dbPath,
      '--worker', 'RCT-1',
      '--task', 'task-proc-1',
      '--source-root', ws.sourceRoot,
      '--barrier-dir', barrierDir,
      '--file-path', ws.filePath,
      '--initial-hash', ws.initialHash
    ],
    { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] }
  );
  children.push(child1);

  // Finite wait for Child 1 to enter provider barrier
  const enteredFile1 = join(barrierDir, 'task-proc-1.entered');
  const startWait = Date.now();
  while (!existsSync(enteredFile1)) {
    await new Promise(r => setTimeout(r, 40));
    if (Date.now() - startWait > 6000) {
      throw new Error('Timed out waiting for Child 1 to enter provider barrier');
    }
  }

  // 2. While Child 1 is holding the barrier inside its provider, spawn Writer 2
  const child2 = fork(
    SUBPROCESS_WORKER_PATH,
    [
      '--db', dbPath,
      '--worker', 'RCT-1',
      '--task', 'task-proc-2',
      '--source-root', ws.sourceRoot,
      '--barrier-dir', barrierDir,
      '--file-path', ws.filePath,
      '--initial-hash', ws.initialHash
    ],
    { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] }
  );
  children.push(child2);

  // Await Child 2 exit (must exit with failure / denied)
  const [child2ExitCode] = await Promise.race([
    new Promise(resolve => child2.on('exit', (code, signal) => resolve([code, signal]))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Child 2 did not terminate promptly')), 6000))
  ]);

  assert.notEqual(child2ExitCode, 0, 'Child 2 must exit non-zero due to capacity guard denial');

  // Verify Child 2 error file exists and confirms capacity denial with 0 provider calls
  const errorFile2 = join(barrierDir, 'task-proc-2.error');
  assert.ok(existsSync(errorFile2), 'Child 2 error file must exist');
  const errorData2 = JSON.parse(readFileSync(errorFile2, 'utf8'));
  assert.match(errorData2.message, /single-worker capacity guard rejects concurrent dispatch|busy: active lease held/);
  assert.equal(errorData2.providerCalls, 0, 'Child 2 physical provider must NEVER be invoked');

  // Verify Child 2 entered file does NOT exist
  assert.equal(existsSync(join(barrierDir, 'task-proc-2.entered')), false, 'Child 2 must never enter provider');

  // 3. Source Root Unchanged assertion
  const currentSource = await ws.readSource();
  assert.equal(currentSource, ws.initialContent, 'Workspace source must remain 100% byte-identical');

  // 4. Read-only status reflects actual active task
  const { RctHost } = await import('../src/index.js');
  const status1 = await RctHost.getStatus(dbPath, 'task-proc-1');
  assert.ok(status1, 'Task 1 status must exist in SQLite');
  assert.equal(status1.state, States.RUNNING, 'Active task state must be RUNNING');
  assert.equal(status1.latestAttempt.state, States.RUNNING, 'Active attempt state must be RUNNING');

  // 5. Explicit recovery while live denied
  const host = new RctHost({ dbPath, workerId: 'RCT-1' });
  await host.init();
  const { reconciledTaskIds } = await host.reconcile();
  assert.deepEqual(reconciledTaskIds, [], 'Explicit recovery must NOT reconcile active live writer');

  const status1AfterRec = await RctHost.getStatus(dbPath, 'task-proc-1');
  assert.equal(status1AfterRec.state, States.RUNNING, 'Active task must remain RUNNING after reconcile attempt');
  host.close();

  // 6. Release Child 1 barrier and wait for clean completion
  const releaseFile1 = join(barrierDir, 'task-proc-1.release');
  await writeFile(releaseFile1, 'release');

  const [child1ExitCode] = await Promise.race([
    new Promise(resolve => child1.on('exit', (code, signal) => resolve([code, signal]))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Child 1 timed out completing after barrier release')), 6000))
  ]);
  assert.equal(child1ExitCode, 0, 'Child 1 must exit cleanly with code 0');

  const finalStatus1 = await RctHost.getStatus(dbPath, 'task-proc-1');
  assert.equal(finalStatus1.state, States.COMPLETED, 'Child 1 task must transition to COMPLETED');
});

test('Cross-process crash owner and valid recovery after expiry: killing active owner leaves unclosed attempt, recovery reconciles to UNKNOWN once lease expires', { timeout: 15000 }, async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');
  const barrierDir = await createTempDataDir(t, 'zetro-barrier-');

  const children = [];
  t.after(() => {
    for (const child of children) {
      if (!child.killed && child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    }
  });

  // 1. Spawn Writer 1 with a short lease TTL (600ms)
  const child1 = fork(
    SUBPROCESS_WORKER_PATH,
    [
      '--db', dbPath,
      '--worker', 'RCT-1',
      '--task', 'task-crash-1',
      '--source-root', ws.sourceRoot,
      '--barrier-dir', barrierDir,
      '--lease-ttl-ms', '600',
      '--file-path', ws.filePath,
      '--initial-hash', ws.initialHash
    ],
    { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] }
  );
  children.push(child1);

  // Wait for Child 1 to enter provider
  const enteredFile = join(barrierDir, 'task-crash-1.entered');
  const startWait = Date.now();
  while (!existsSync(enteredFile)) {
    await new Promise(r => setTimeout(r, 40));
    if (Date.now() - startWait > 6000) {
      throw new Error('Timed out waiting for Child 1 to enter provider barrier');
    }
  }

  // Verify task is RUNNING in SQLite
  const { RctHost } = await import('../src/index.js');
  const statusBeforeCrash = await RctHost.getStatus(dbPath, 'task-crash-1');
  assert.equal(statusBeforeCrash.state, States.RUNNING);

  // 2. CRASH OWNER: kill Child 1 process abruptly
  child1.kill('SIGTERM');
  await new Promise(resolve => child1.on('exit', () => resolve()));

  // 3. Before lease expires, an unclosed attempt exists on disk
  // Stale telemetry / crashed process does NOT mean slot free yet
  const host = new RctHost({ dbPath, workerId: 'RCT-1' });
  await host.init();

  // Wait for lease TTL (600ms) to expire
  await new Promise(r => setTimeout(r, 750));

  // 4. Valid recovery after expiry:
  // Reconcile detects owner process is gone and heartbeat is past expiry
  const { reconciledTaskIds } = await host.reconcile();
  assert.ok(reconciledTaskIds.includes('task-crash-1'), 'Reconcile must successfully recover expired crashed task');

  const statusAfterRec = await RctHost.getStatus(dbPath, 'task-crash-1');
  assert.equal(statusAfterRec.state, States.UNKNOWN, 'Crashed task must transition to UNKNOWN');
  assert.match(statusAfterRec.uncertainty, /Interrupted in-flight during crash\/restart/);

  // 5. Worker slot is now freed: a new task can run on the slot
  const child2 = fork(
    SUBPROCESS_WORKER_PATH,
    [
      '--db', dbPath,
      '--worker', 'RCT-1',
      '--task', 'task-recovery-2',
      '--source-root', ws.sourceRoot,
      '--barrier-dir', barrierDir,
      '--file-path', ws.filePath,
      '--initial-hash', ws.initialHash
    ],
    { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] }
  );
  children.push(child2);

  // Release immediately for Child 2 so it runs to completion
  const releaseFile2 = join(barrierDir, 'task-recovery-2.release');
  await writeFile(releaseFile2, 'release');

  const [child2ExitCode] = await Promise.race([
    new Promise(resolve => child2.on('exit', (code, signal) => resolve([code, signal]))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Child 2 did not complete')), 6000))
  ]);
  assert.equal(child2ExitCode, 0, 'New writer must succeed once slot was recovered');

  const status2 = await RctHost.getStatus(dbPath, 'task-recovery-2');
  assert.equal(status2.state, States.COMPLETED);
  host.close();
});

test('Cross-process lease-loss abort: usurping lease token in SQLite triggers immediate abort of active execution to CANCELLED', { timeout: 15000 }, async (t) => {
  const ws = await createSyntheticWorkspace(t);
  const dataDir = await createTempDataDir(t);
  const dbPath = join(dataDir, 'tasks.db');
  const barrierDir = await createTempDataDir(t, 'zetro-barrier-');

  const children = [];
  t.after(() => {
    for (const child of children) {
      if (!child.killed && child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    }
  });

  // Spawn Writer 1 with default 1000ms heartbeat
  const child1 = fork(
    SUBPROCESS_WORKER_PATH,
    [
      '--db', dbPath,
      '--worker', 'RCT-1',
      '--task', 'task-leaseloss-1',
      '--source-root', ws.sourceRoot,
      '--barrier-dir', barrierDir,
      '--file-path', ws.filePath,
      '--initial-hash', ws.initialHash
    ],
    { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] }
  );
  children.push(child1);

  // Wait for Child 1 to enter provider
  const enteredFile = join(barrierDir, 'task-leaseloss-1.entered');
  const startWait = Date.now();
  while (!existsSync(enteredFile)) {
    await new Promise(r => setTimeout(r, 40));
    if (Date.now() - startWait > 6000) {
      throw new Error('Timed out waiting for Child 1 to enter provider barrier');
    }
  }

  // Usurp lease token in SQLite behind the scenes
  const rawStore = new SqliteTaskStore(dbPath);
  await rawStore.init();
  rawStore.db.prepare(`
    UPDATE worker_leases
    SET invocation_token = 'stolen-token'
    WHERE worker_id = 'RCT-1'
  `).run();
  rawStore.close();

  // Next heartbeat renewal in Child 1 will fail and abort active execution
  await Promise.race([
    new Promise(resolve => child1.on('exit', (code, signal) => resolve([code, signal]))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Child 1 did not abort after lease loss')), 8000))
  ]);

  // Verify in SQLite that the task was transitioned to CANCELLED with lease uncertainty
  const { RctHost } = await import('../src/index.js');
  const status = await RctHost.getStatus(dbPath, 'task-leaseloss-1');
  assert.ok(status, 'Task status must exist');
  assert.equal(status.state, States.CANCELLED, 'Task must be in CANCELLED state due to lease loss abort');
  assert.match(status.uncertainty || status.error || '', /lease/i);
});

test('CLI persistent synthetic demo usage: runs demo with --data-dir, retains tasks.db, and verifies read-only query subcommands', { timeout: 15000 }, async (t) => {
  const dataDir = await createTempDataDir(t, 'zetro-demo-persistent-');
  const dbPath = join(dataDir, 'tasks.db');

  // 1. Run demo with explicit --data-dir and --json
  const { stdout: demoStdout, stderr: demoStderr } = await execFileAsync(
    process.execPath,
    [CLI_PATH, 'demo', '--data-dir', dataDir, '--json'],
    { timeout: 10000 }
  );
  assert.equal(demoStderr, '');
  const demoResult = JSON.parse(demoStdout);
  assert.equal(demoResult.scenarioA.state, States.COMPLETED);
  assert.equal(demoResult.scenarioB.state, States.CANCELLED);
  assert.equal(demoResult.retained, true);

  // 2. Assert SQLite database file was retained on disk
  assert.ok(existsSync(dbPath), 'tasks.db must be retained in specified data-dir upon demo completion');
  const initialStat = statSync(dbPath);
  const initialHash = computeFileSha256(dbPath);

  // 3. Query status via CLI
  const { stdout: statusOut } = await execFileAsync(
    process.execPath,
    [CLI_PATH, 'status', 'task-demo-success-1', '--data-dir', dataDir, '--json'],
    { timeout: 5000 }
  );
  const statusObj = JSON.parse(statusOut);
  assert.equal(statusObj.id, 'task-demo-success-1');
  assert.equal(statusObj.state, States.COMPLETED);

  // 4. Query events via CLI
  const { stdout: eventsOut } = await execFileAsync(
    process.execPath,
    [CLI_PATH, 'events', 'task-demo-success-1', '--data-dir', dataDir, '--json'],
    { timeout: 5000 }
  );
  const eventsArr = JSON.parse(eventsOut);
  assert.ok(Array.isArray(eventsArr) && eventsArr.length >= 6);

  // 5. Query evidence via CLI
  const { stdout: evidenceOut } = await execFileAsync(
    process.execPath,
    [CLI_PATH, 'evidence', 'task-demo-success-1', '--data-dir', dataDir, '--json'],
    { timeout: 5000 }
  );
  const evidenceObj = JSON.parse(evidenceOut);
  assert.ok(evidenceObj.artifacts.length >= 3);

  // 6. Query worker-status via CLI
  const { stdout: workerOut } = await execFileAsync(
    process.execPath,
    [CLI_PATH, 'worker-status', 'RCT-1', '--data-dir', dataDir, '--json'],
    { timeout: 5000 }
  );
  const workerObj = JSON.parse(workerOut);
  assert.equal(workerObj.workerId, 'RCT-1');

  // 7. Strictly Read-Only Invariant: database file unchanged
  const postStat = statSync(dbPath);
  const postHash = computeFileSha256(dbPath);
  assert.equal(postStat.size, initialStat.size, 'Database file size must not change during read queries');
  assert.equal(postHash, initialHash, 'Database SHA256 must remain 100% byte-identical after read queries');
});

test('CLI status-snapshot: status identity, known workers RCT-1 through RCT-5, bounded events, safe artifact summaries', { timeout: 15000 }, async (t) => {
  const dataDir = await createTempDataDir(t, 'zetro-snapshot-ident-');
  const dbPath = join(dataDir, 'tasks.db');

  // Populate persistent database via offline demo
  await execFileAsync(
    process.execPath,
    [CLI_PATH, 'demo', '--data-dir', dataDir, '--json'],
    { timeout: 10000 }
  );

  // Execute status-snapshot CLI command
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [CLI_PATH, 'status-snapshot', '--db', dbPath],
    { timeout: 5000 }
  );

  assert.equal(stderr, '');
  const snapshot = JSON.parse(stdout);

  // 1. JSON Schema Version & Metadata
  assert.equal(snapshot.schemaVersion, 1, 'Schema version must be 1');
  assert.ok(typeof snapshot.observedAt === 'string', 'observedAt must be ISO timestamp string');
  assert.equal(snapshot.databasePath, dbPath);
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.status, 'connected');
  assert.equal(snapshot.error, null);

  // 2. Known Workers RCT-1 through RCT-5
  assert.ok(Array.isArray(snapshot.workers));
  assert.equal(snapshot.workers.length, 5);
  const workerIds = snapshot.workers.map(w => w.workerId);
  assert.deepEqual(workerIds, ['RCT-1', 'RCT-2', 'RCT-3', 'RCT-4', 'RCT-5']);
  for (const w of snapshot.workers) {
    assert.ok(['idle', 'running', 'completed', 'submitted', 'failed', 'interrupted', 'stale', 'unknown'].includes(w.state));
    assert.ok(w.heartbeat && typeof w.heartbeat === 'object');
  }

  // 3. Bounded events (max 100)
  assert.ok(Array.isArray(snapshot.recentEvents));
  assert.ok(snapshot.recentEvents.length > 0);
  assert.ok(snapshot.recentEvents.length <= 100);
  for (const ev of snapshot.recentEvents) {
    assert.ok(typeof ev.id === 'number');
    assert.ok(typeof ev.eventType === 'string');
    assert.ok(typeof ev.timestamp === 'number');
    assert.ok(ev.payload && typeof ev.payload === 'object');
  }

  // 4. Safe artifact summaries (no raw file code)
  assert.ok(Array.isArray(snapshot.artifacts));
  assert.ok(snapshot.artifacts.length > 0);
  assert.ok(snapshot.artifacts.length <= 100);
  for (const art of snapshot.artifacts) {
    assert.ok(typeof art.id === 'number');
    assert.ok(typeof art.artifactType === 'string');
    assert.ok(typeof art.uri === 'string');
    // Ensure no raw source content dumps in artifacts
    assert.equal(art.content, undefined);
  }
});

test('CLI status-snapshot: readonly db hash and mtime strictly unchanged', { timeout: 15000 }, async (t) => {
  const dataDir = await createTempDataDir(t, 'zetro-snapshot-readonly-');
  const dbPath = join(dataDir, 'tasks.db');

  // Populate persistent database
  await execFileAsync(
    process.execPath,
    [CLI_PATH, 'demo', '--data-dir', dataDir, '--json'],
    { timeout: 10000 }
  );

  const preStat = statSync(dbPath);
  const preHash = computeFileSha256(dbPath);

  // Execute status-snapshot CLI command multiple times
  for (let i = 0; i < 3; i++) {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_PATH, 'status-snapshot', '--db', dbPath],
      { timeout: 5000 }
    );
    const snapshot = JSON.parse(stdout);
    assert.equal(snapshot.connected, true);
  }

  const postStat = statSync(dbPath);
  const postHash = computeFileSha256(dbPath);

  assert.equal(postStat.size, preStat.size, 'Database file size must not change during status-snapshot queries');
  assert.equal(postHash, preHash, 'Database SHA256 hash must remain 100% byte-identical');
});

test('CLI status-snapshot: missing path not created, returns honest disconnected payload', { timeout: 15000 }, async (t) => {
  const dataDir = await createTempDataDir(t, 'zetro-snapshot-missing-');
  const missingDbPath = join(dataDir, 'nested', 'does-not-exist.db');

  assert.equal(existsSync(missingDbPath), false);

  // Run status-snapshot against missing path - must exit non-zero
  let exitCode = 0;
  let stdoutData = '';
  try {
    await execFileAsync(
      process.execPath,
      [CLI_PATH, 'status-snapshot', '--db', missingDbPath],
      { timeout: 5000 }
    );
  } catch (err) {
    exitCode = err.code;
    stdoutData = err.stdout;
  }

  assert.notEqual(exitCode, 0, 'CLI must exit with non-zero code on missing database');

  // Critical Invariant: zero files and zero directories created!
  assert.equal(existsSync(missingDbPath), false, 'Missing database file must NOT be created');
  assert.equal(existsSync(join(dataDir, 'nested')), false, 'Nested parent directory must NOT be created');

  // Parse honest disconnected JSON payload
  const snapshot = JSON.parse(stdoutData);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.connected, false);
  assert.equal(snapshot.status, 'disconnected');
  assert.match(snapshot.error, /does not exist/);
  assert.deepEqual(snapshot.recentEvents, []);
  assert.deepEqual(snapshot.artifacts, []);
});

test('CLI status-snapshot: malformed args exit non-zero', { timeout: 15000 }, async (t) => {
  // Run status-snapshot without --db or --data-dir
  let exitCode = 0;
  let stdoutData = '';
  try {
    await execFileAsync(
      process.execPath,
      [CLI_PATH, 'status-snapshot'],
      { timeout: 5000 }
    );
  } catch (err) {
    exitCode = err.code;
    stdoutData = err.stdout;
  }

  assert.notEqual(exitCode, 0, 'CLI must exit non-zero when --db is omitted');
  const payload = JSON.parse(stdoutData);
  assert.equal(payload.connected, false);
  assert.match(payload.error, /Explicit database location required/);
});



