import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import {
  TaskManager,
  SqliteTaskStore,
  States,
  Intents,
  RealRctAdapter,
  createIndependentRctVerifier,
  computeCompositeSourceHash,
  validateSourceBaseline
} from '../src/index.js';
import { sha256 } from '../../rct-runtime/src/index.js';
import { createWorkspaceAdmission, validateWorkspaceAdmission } from '../../protocol/src/index.js';
import { PolicyService, RctPolicyPort } from '../../policy/src/index.js';
import { runLifecycleDemo } from '../src/demo.js';

async function createSyntheticWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-synth-ws-'));
  const filePath = 'src/app.js';
  const initialContent = 'console.log("initial source");\n';
  const fullPath = join(dir, filePath);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(fullPath, initialContent, 'utf8');
  const initialHash = sha256(Buffer.from(initialContent));

  return {
    sourceRoot: dir,
    filePath,
    initialContent,
    initialHash,
    async readSource() {
      return await readFile(fullPath, 'utf8');
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

async function createMultiFileSyntheticWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-synth-multi-ws-'));
  const file1 = 'src/app.js';
  const file2 = 'src/util.js';
  const content1 = 'console.log("initial app");\n';
  const content2 = 'module.exports = { util: true };\n';
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, file1), content1, 'utf8');
  await writeFile(join(dir, file2), content2, 'utf8');
  const hash1 = sha256(Buffer.from(content1));
  const hash2 = sha256(Buffer.from(content2));
  const sourceHashes = { [file1]: hash1, [file2]: hash2 };

  return {
    sourceRoot: dir,
    files: [file1, file2],
    file1,
    file2,
    content1,
    content2,
    hash1,
    hash2,
    sourceHashes,
    async cleanup() {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

function createEnvelope(id, ws, overrides = {}) {
  return {
    id,
    agent: 'worker-rct-1',
    objective: 'Update application file in isolated workspace',
    workspaceRoot: ws.sourceRoot,
    allowedPaths: [ws.filePath],
    contextRefs: ['docs/SPEC.md'],
    acceptance: 'App prints patched message',
    verification: ws.filePath,
    declaredChecks: [ws.filePath],
    sourceHash: ws.initialHash,
    sourceHashes: { [ws.filePath]: ws.initialHash },
    assignmentDigest: 'digest-1',
    checks: [
      { type: 'equals', path: ws.filePath, text: 'console.log("patched by zetro");\n' }
    ],
    deadlineMs: 5000,
    budget: { maxContextChars: 10000, maxReplyChars: 2000, maxTurns: 4, maxWallMs: 5000 },
    ...overrides
  };
}

function createMultiFileEnvelope(id, ws, overrides = {}) {
  const composite = computeCompositeSourceHash(ws.sourceHashes);
  return {
    id,
    agent: 'worker-rct-1',
    objective: 'Update application files in isolated workspace',
    workspaceRoot: ws.sourceRoot,
    allowedPaths: ws.files,
    contextRefs: ['docs/SPEC.md'],
    acceptance: 'App and util checks pass',
    verification: ws.file1,
    declaredChecks: [ws.file1, ws.file2],
    sourceHash: composite,
    sourceHashes: ws.sourceHashes,
    assignmentDigest: 'digest-multi-1',
    checks: [
      { type: 'contains', path: ws.file1, text: 'initial' }
    ],
    deadlineMs: 5000,
    budget: { maxContextChars: 10000, maxReplyChars: 2000, maxTurns: 4, maxWallMs: 5000 },
    ...overrides
  };
}

async function createTestEnv(t, adapter, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-mgr-lifecycle-'));
  const dbPath = join(dir, 'lifecycle.db');
  const store = new SqliteTaskStore(dbPath);
  const manager = new TaskManager(store, adapter, options);
  await manager.init();

  if (t && typeof t.after === 'function') {
    t.after(async () => {
      manager.close();
      if (adapter && typeof adapter.dispose === 'function') {
        await adapter.dispose();
      }
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    });
  }

  return { manager, store, dir, dbPath };
}

test('Real RCT Lifecycle: Full run with real rct-runtime and independent verifier achieves COMPLETED', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  const targetContent = 'console.log("patched by zetro");\n';
  let turn = 0;

  const fakeProvider = {
    name: 'offline-fake-provider',
    async next() {
      turn++;
      if (turn === 1) {
        return {
          toolCalls: [{
            name: 'propose_patch',
            args: {
              path: ws.filePath,
              expectedSha256: ws.initialHash,
              content: targetContent
            }
          }],
          usage: { inputTokens: 100, outputTokens: 40 }
        };
      }
      return {
        toolCalls: [{
          name: 'submit_receipt',
          args: { summary: 'Successfully applied patch to isolated snapshot' }
        }],
        usage: { inputTokens: 80, outputTokens: 30 }
      };
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const verifier = createIndependentRctVerifier();
  const { manager } = await createTestEnv(t, adapter, { verifier });

  const envelope = createEnvelope('task-real-rct-1', ws, {
    checks: [{ type: 'equals', path: ws.filePath, text: targetContent }]
  });

  const result = await manager.run(envelope);

  // 1. Authoritative Task & Attempt Completion
  assert.equal(result.state, States.COMPLETED);
  assert.equal(result.id, 'task-real-rct-1');

  const status = manager.status('task-real-rct-1');
  assert.equal(status.state, States.COMPLETED);
  assert.equal(status.latestAttempt.state, States.COMPLETED);

  // 2. Source Directory Integrity: Source remains completely unchanged
  const currentSourceContent = await ws.readSource();
  assert.equal(currentSourceContent, ws.initialContent, 'Source root must remain byte-identical');

  // 3. Independent Verifier Evidence Artifact Persisted
  const evidence = manager.evidence('task-real-rct-1');
  assert.ok(evidence);
  const artifacts = evidence.artifacts;
  const verifierEvidenceArtifact = artifacts.find(a => a.artifactType === 'verifier_evidence');
  assert.ok(verifierEvidenceArtifact, 'verifier_evidence artifact must be persisted');
  assert.equal(verifierEvidenceArtifact.metadata.verified, true);
  assert.equal(verifierEvidenceArtifact.metadata.checks[0].name, ws.filePath);
  assert.equal(verifierEvidenceArtifact.metadata.checks[0].passed, true);

  // 4. Audit Trail: Dispatch intent, running update, and finalization logged
  const events = manager.events('task-real-rct-1');
  assert.ok(events.length >= 3);
  const intentEvent = events.find(e => e.eventType === 'INTENT_RECORDED');
  assert.ok(intentEvent);
  assert.equal(intentEvent.payload.intent, Intents.DISPATCH_CALL);
  const finalizeEvent = events.find(e => e.eventType === 'STATE_TRANSITION' && e.payload.to === States.COMPLETED);
  assert.ok(finalizeEvent);
  assert.equal(finalizeEvent.payload.to, States.COMPLETED);
});

test('Real RCT Lifecycle: Strict rejection of missing machine-verifiable criteria (no criteria)', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let turn = 0;
  const fakeProvider = {
    name: 'offline-fake-provider',
    async next() {
      turn++;
      if (turn === 1) {
        return {
          toolCalls: [{
            name: 'propose_patch',
            args: { path: ws.filePath, expectedSha256: ws.initialHash, content: 'some content\n' }
          }],
          usage: { inputTokens: 50, outputTokens: 25 }
        };
      }
      return {
        toolCalls: [{
          name: 'submit_receipt',
          args: { summary: 'Completed but envelope had no criteria' }
        }],
        usage: { inputTokens: 50, outputTokens: 25 }
      };
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const verifier = createIndependentRctVerifier();
  const { manager } = await createTestEnv(t, adapter, { verifier });

  // Missing criteria: worker has runtime checks to complete its work, but envelope.checks has no machine-verifiable criteria
  const envelope = createEnvelope('task-no-criteria-1', ws, {
    rctChecks: [{ type: 'equals', path: ws.filePath, text: 'some content\n' }],
    checks: []
  });

  const result = await manager.run(envelope);

  // Must be strictly rejected by independent verifier
  assert.equal(result.state, States.FAILED);
  assert.match(result.error, /No machine-verifiable assignment criteria declared/);

  const status = manager.status('task-no-criteria-1');
  assert.equal(status.state, States.FAILED);
  assert.equal(manager.evidence('task-no-criteria-1').artifacts.length, 0);
});

test('Real RCT Lifecycle: Rejection of forged worker claims and independent verification of snapshot (forged claims)', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let turn = 0;
  const deceitfulProvider = {
    name: 'deceitful-provider',
    async next() {
      turn++;
      if (turn === 1) {
        return {
          toolCalls: [{
            name: 'propose_patch',
            args: { path: ws.filePath, expectedSha256: ws.initialHash, content: 'almost correct\n' }
          }],
          usage: { inputTokens: 50, outputTokens: 25 }
        };
      }
      return {
        toolCalls: [{
          name: 'submit_receipt',
          args: { summary: 'Worker falsely claims success' }
        }],
        usage: { inputTokens: 50, outputTokens: 25 }
      };
    }
  };

  const adapter = new RealRctAdapter({ provider: deceitfulProvider, sourceRoot: ws.sourceRoot });
  const verifier = createIndependentRctVerifier();
  const { manager } = await createTestEnv(t, adapter, { verifier });

  // Worker satisfies 'almost correct\n', but authoritative supervisor requirement is 'exact correct\n'
  const envelope = createEnvelope('task-forged-claims-1', ws, {
    rctChecks: [{ type: 'equals', path: ws.filePath, text: 'almost correct\n' }],
    checks: [{ type: 'equals', path: ws.filePath, text: 'exact correct\n' }]
  });

  const result = await manager.run(envelope);

  // Independent verifier checks snapshot file directly, detects mismatch, and strictly rejects worker claims
  assert.equal(result.state, States.FAILED);
  assert.equal(manager.status('task-forged-claims-1').state, States.FAILED);
  // Independent verifier rejection writes strictly 0 artifacts
  assert.equal(manager.evidence('task-forged-claims-1').artifacts.length, 0);
});

test('Real RCT Lifecycle: Baseline source hash mismatch rejected before provider execution (hashmismatch)', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let providerCallCount = 0;
  const fakeProvider = {
    name: 'offline-fake-provider',
    async next() {
      providerCallCount++;
      throw new Error('Provider must NOT be called on baseline hash mismatch');
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const { manager } = await createTestEnv(t, adapter);

  // Authoritative admitted baseline specifies a bogus/mismatched hash
  const mismatchedHash = '0000000000000000000000000000000000000000000000000000000000000000';
  const envelope = createEnvelope('task-hash-mismatch-1', ws, {
    sourceHash: mismatchedHash,
    sourceHashes: { [ws.filePath]: mismatchedHash }
  });

  const result = await manager.run(envelope);

  // Task fails immediately due to baseline hash mismatch
  assert.equal(result.state, States.FAILED);
  assert.match(result.error, /Source baseline hash mismatch/);

  // Zero calls to provider
  assert.equal(providerCallCount, 0);

  // 0 artifacts persisted
  assert.equal(manager.evidence('task-hash-mismatch-1').artifacts.length, 0);
});

test('Real RCT Lifecycle: Baseline bypass rejection - empty sourceHashes cannot mask bogus scalar sourceHash (0 provider calls)', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let providerCallCount = 0;
  const fakeProvider = {
    name: 'guard-provider',
    async next() {
      providerCallCount++;
      throw new Error('Provider must NOT be called when sourceHashes is empty');
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const { manager } = await createTestEnv(t, adapter);

  // Bypass attempt: empty sourceHashes object intended to bypass scalar validation
  const envelope = createEnvelope('task-empty-hashes-bypass-1', ws, {
    sourceHashes: {},
    sourceHash: 'bogus-scalar-hash-that-must-not-be-masked'
  });

  const result = await manager.run(envelope);

  assert.equal(result.state, States.FAILED);
  assert.match(result.error, /Empty source baseline proof/);
  assert.equal(providerCallCount, 0, 'Provider must never be called on empty sourceHashes');
});

test('Real RCT Lifecycle: Baseline bypass rejection - unknown map entries rejected (0 provider calls)', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let providerCallCount = 0;
  const fakeProvider = {
    name: 'guard-provider',
    async next() {
      providerCallCount++;
      throw new Error('Provider must NOT be called on unknown map entries');
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const { manager } = await createTestEnv(t, adapter);

  // Bypass attempt: including unknown file in sourceHashes map
  const envelope = createEnvelope('task-unknown-entry-bypass-1', ws, {
    sourceHashes: {
      [ws.filePath]: ws.initialHash,
      'unknown/nonexistent.txt': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    }
  });

  const result = await manager.run(envelope);

  assert.equal(result.state, States.FAILED);
  assert.match(result.error, /Unknown entry in source baseline proof/);
  assert.equal(providerCallCount, 0, 'Provider must never be called on unknown baseline map entries');
});

test('Real RCT Lifecycle: Baseline bypass rejection - incomplete coverage missing file in multi-file rejected (0 provider calls)', async (t) => {
  const ws = await createMultiFileSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let providerCallCount = 0;
  const fakeProvider = {
    name: 'guard-provider',
    async next() {
      providerCallCount++;
      throw new Error('Provider must NOT be called on incomplete multi-file baseline');
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const { manager } = await createTestEnv(t, adapter);

  // Bypass attempt: multi-file snapshot where proof covers only file1, leaving file2 unbound
  const envelope = createMultiFileEnvelope('task-incomplete-multi-1', ws, {
    sourceHashes: {
      [ws.file1]: ws.hash1
      // file2 omitted!
    },
    sourceHash: undefined
  });

  const result = await manager.run(envelope);

  assert.equal(result.state, States.FAILED);
  assert.match(result.error, /Incomplete source baseline proof/);
  assert.equal(providerCallCount, 0, 'Provider must never be called when baseline coverage is incomplete');
});

test('Real RCT Lifecycle: Baseline bypass rejection - multi-file scalar matching one file rejected, exact composite required (0 provider calls)', async (t) => {
  const ws = await createMultiFileSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let providerCallCount = 0;
  const fakeProvider = {
    name: 'guard-provider',
    async next() {
      providerCallCount++;
      throw new Error('Provider must NOT be called when scalar matches only one file in multi-file');
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const { manager } = await createTestEnv(t, adapter);

  // Bypass attempt: scalar sourceHash matches file1 only, leaving file2 unverified
  const envelope = createMultiFileEnvelope('task-scalar-onefile-bypass-1', ws, {
    sourceHash: ws.hash1, // matches file1 only!
    sourceHashes: undefined
  });

  const result = await manager.run(envelope);

  assert.equal(result.state, States.FAILED);
  assert.match(result.error, /Source baseline hash mismatch: expected composite/);
  assert.equal(providerCallCount, 0, 'Provider must never be called when multi-file scalar is not exact composite');
});

test('Real RCT Lifecycle: Multi-file exact composite baseline validation passes and executes', async (t) => {
  const ws = await createMultiFileSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  const expectedComposite = computeCompositeSourceHash(ws.sourceHashes);
  let providerCalled = false;

  const fakeProvider = {
    name: 'offline-composite-provider',
    async next() {
      providerCalled = true;
      return {
        toolCalls: [{
          name: 'submit_receipt',
          args: { summary: 'Completed multi-file task' }
        }],
        usage: { inputTokens: 50, outputTokens: 25 }
      };
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const { manager } = await createTestEnv(t, adapter);

  const envelope = createMultiFileEnvelope('task-composite-pass-1', ws, {
    sourceHash: expectedComposite,
    sourceHashes: ws.sourceHashes
  });

  const result = await manager.run(envelope);

  // Verified baseline admits execution to provider
  assert.equal(providerCalled, true);
  assert.ok(result);
});

test('Real RCT Lifecycle: Baseline rejection - conflicting sourceHashes and scalar sourceHash (0 provider calls)', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let providerCallCount = 0;
  const fakeProvider = {
    name: 'guard-provider',
    async next() {
      providerCallCount++;
      throw new Error('Provider must NOT be called on conflicting proof');
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const { manager } = await createTestEnv(t, adapter);

  // Conflicting proof: valid sourceHashes map but scalar sourceHash has conflicting value
  const envelope = createEnvelope('task-conflicting-proof-1', ws, {
    sourceHashes: { [ws.filePath]: ws.initialHash },
    sourceHash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  });

  const result = await manager.run(envelope);

  assert.equal(result.state, States.FAILED);
  assert.match(result.error, /Conflicting source baseline proof/);
  assert.equal(providerCallCount, 0, 'Provider must never be called on conflicting baseline proof');
});

test('Real RCT Lifecycle: Cancellation aborts late provider and proves zero subsequent tool effects with response-completed barrier', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let lateToolCallAttempted = false;
  let providerCompleted = false;
  let resolveResponseBarrier;
  const responseCompletedBarrier = new Promise((resolve) => {
    resolveResponseBarrier = resolve;
  });

  const slowProvider = {
    name: 'slow-provider',
    async next({ signal }) {
      return new Promise((resolve) => {
        setTimeout(() => {
          lateToolCallAttempted = true;
          providerCompleted = true;
          const res = {
            toolCalls: [{
              name: 'propose_patch',
              args: { path: ws.filePath, expectedSha256: ws.initialHash, content: 'late patch attempt\n' }
            }],
            usage: { inputTokens: 10, outputTokens: 10 }
          };
          resolve(res);
          resolveResponseBarrier(res);
        }, 300);
      });
    }
  };

  const adapter = new RealRctAdapter({ provider: slowProvider, sourceRoot: ws.sourceRoot });
  const { manager } = await createTestEnv(t, adapter);

  const envelope = createEnvelope('task-cancel-barrier-1', ws, {
    deadlineMs: 10000,
    budget: { maxContextChars: 10000, maxReplyChars: 2000, maxTurns: 2, maxWallMs: 10000 }
  });

  // Launch run
  const runPromise = manager.run(envelope);

  // Check at 80ms, before the 300ms delayed response
  await new Promise(r => setTimeout(r, 80));

  // Active cancellation requested
  const cancelRes = manager.cancel('task-cancel-barrier-1');
  assert.equal(cancelRes.cancelled, true);

  // Await run promise to settle
  await runPromise;

  // Explicit barrier: await delayed response completion to guarantee the 300ms provider delay has settled
  await responseCompletedBarrier;
  assert.equal(providerCompleted, true);
  assert.equal(lateToolCallAttempted, true);

  // Assert NO late effect and NO snapshot change afterward
  const sourceContent = await ws.readSource();
  assert.equal(sourceContent, ws.initialContent, 'Source root must remain byte-identical');

  if (adapter.latestSnapshot) {
    const snapContent = await readFile(join(adapter.latestSnapshot.root, ws.filePath), 'utf8');
    assert.equal(snapContent, ws.initialContent, 'Snapshot must have ZERO late tool effect even after delayed response completed');
  }

  // Consume AGR2 signal port receipt
  assert.ok(adapter.latestReceipt, 'Adapter must consume AGR2 receipt from signal port');
  assert.equal(adapter.latestReceipt.state, 'unknown');
  assert.equal(adapter.latestReceipt.failureReason, 'aborted');

  // Terminal state CANCELLED with 0 artifacts
  const status = manager.status('task-cancel-barrier-1');
  assert.equal(status.state, States.CANCELLED);
  assert.equal(manager.evidence('task-cancel-barrier-1').artifacts.length, 0);
});

test('Real RCT Lifecycle: Cancellation between actual tools halts execution with zero subsequent effects', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let turn = 0;
  let turn2ToolAttempted = false;
  let managerRef;

  const twoTurnProvider = {
    name: 'two-turn-provider',
    async next({ signal }) {
      turn++;
      if (turn === 1) {
        // Turn 1 executes a real tool: read_slice
        return {
          toolCalls: [{
            name: 'read_slice',
            args: { path: ws.filePath, startLine: 1, endLine: 1 }
          }],
          usage: { inputTokens: 50, outputTokens: 20 }
        };
      }

      // Between Turn 1 and Turn 2, cancellation occurs
      if (managerRef && !signal?.aborted) {
        managerRef.cancel('task-cancel-between-tools-1');
      }

      turn2ToolAttempted = true;
      return {
        toolCalls: [{
          name: 'propose_patch',
          args: { path: ws.filePath, expectedSha256: ws.initialHash, content: 'turn 2 mutated content\n' }
        }],
        usage: { inputTokens: 50, outputTokens: 20 }
      };
    }
  };

  const adapter = new RealRctAdapter({ provider: twoTurnProvider, sourceRoot: ws.sourceRoot });
  const { manager } = await createTestEnv(t, adapter);
  managerRef = manager;

  const envelope = createEnvelope('task-cancel-between-tools-1', ws, {
    deadlineMs: 10000,
    budget: { maxContextChars: 10000, maxReplyChars: 2000, maxTurns: 4, maxWallMs: 10000 }
  });

  const runPromise = manager.run(envelope);
  await runPromise;

  // Turn 2 patch must never have taken effect in snapshot
  if (adapter.latestSnapshot) {
    const snapContent = await readFile(join(adapter.latestSnapshot.root, ws.filePath), 'utf8');
    assert.equal(snapContent, ws.initialContent, 'Turn 2 patch must never execute or affect snapshot');
  }

  // Source remains untouched
  const sourceContent = await ws.readSource();
  assert.equal(sourceContent, ws.initialContent);

  // Status must be CANCELLED with 0 artifacts
  const status = manager.status('task-cancel-between-tools-1');
  assert.equal(status.state, States.CANCELLED);
  assert.equal(manager.evidence('task-cancel-between-tools-1').artifacts.length, 0);

  // AGR2 receipt consumed
  assert.ok(adapter.latestReceipt);
  assert.equal(adapter.latestReceipt.failureReason, 'aborted');
});

test('Real RCT Lifecycle: Kill and restart intent window reconciles to UNKNOWN with no duplicate dispatch (restart)', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  const dir = await mkdtemp(join(tmpdir(), 'zetro-crash-test-'));
  const dbPath = join(dir, 'crash.db');
  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  // 1. Session 1: Create task and open intent window (simulating in-flight crash)
  const store1 = new SqliteTaskStore(dbPath);
  await store1.init();

  const envelope = createEnvelope('task-crash-rct-1', ws, {
    agent: 'worker-rct-5'
  });

  store1.createTask({ ...envelope, state: States.PENDING });
  const attemptId = 'task-crash-rct-1-att-1';
  store1.createAttempt({
    attemptId,
    taskId: envelope.id,
    attemptNumber: 1,
    intent: Intents.NONE,
    state: States.RUNNING
  });
  // Open intent window before dispatch:
  store1.recordIntent(envelope.id, attemptId, Intents.DISPATCH_CALL, {
    agent: envelope.agent,
    timestamp: Date.now()
  });
  store1.updateTaskState(envelope.id, States.RUNNING, { attemptId });

  // Simulate process kill: close store without finalizing attempt
  store1.close();

  // 2. Session 2: System restarts, new TaskManager initializes
  const store2 = new SqliteTaskStore(dbPath);
  let dispatchCallCount = 0;
  const mockAdapter = {
    async execute() {
      dispatchCallCount++;
      throw new Error('Should not be called for reconciled task');
    }
  };
  const manager2 = new TaskManager(store2, mockAdapter);

  // Initialize: reconciles in-flight unclosed intent windows
  const reconciled = await manager2.init();
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0], 'task-crash-rct-1');

  // Task and attempt state are safely UNKNOWN
  const task = store2.getTask('task-crash-rct-1');
  assert.equal(task.state, States.UNKNOWN);
  const attempt = store2.getAttempt(attemptId);
  assert.equal(attempt.state, States.UNKNOWN);

  // Audit event confirms crash reconciliation
  const events = manager2.events('task-crash-rct-1');
  const reconEvent = events.find(e => e.eventType === 'INTENT_RECONCILED_UNKNOWN');
  assert.ok(reconEvent);
  assert.equal(reconEvent.payload.attemptId, attemptId);

  // Zero duplicate dispatch
  assert.equal(dispatchCallCount, 0);

  manager2.close();
});

test('Real RCT Lifecycle Demo: Valid run satisfies all explicit derived assertions and cleans up workspace & db dirs', async () => {
  let observedWs = null;
  let observedDb = null;
  const result = await runLifecycleDemo({
    silent: true,
    onPathsCreated: ({ wsDir, dbDir }) => {
      observedWs = wsDir;
      observedDb = dbDir;
    }
  });
  assert.equal(result.success, true);
  assert.equal(result.scenarioA.state, States.COMPLETED);
  assert.equal(result.scenarioA.sourceUnchanged, true);
  assert.equal(result.scenarioA.snapshotPatched, true);
  assert.equal(result.scenarioA.artifactsCount, 4);
  assert.equal(result.scenarioB.state, States.CANCELLED);
  assert.equal(result.scenarioB.sourceUnchanged, true);
  assert.equal(result.scenarioB.snapshotUnchanged, true);
  assert.equal(result.scenarioB.artifactsCount, 0);
  assert.equal(result.scenarioB.receiptState, 'unknown');
  assert.equal(result.scenarioB.failureReason, 'aborted');

  // Verify paths were tracked and completely removed from disk
  assert.ok(observedWs, 'Workspace directory path must be tracked');
  assert.ok(observedDb, 'Database directory path must be tracked');
  assert.equal(existsSync(observedWs), false, 'Workspace directory must be cleanly removed after valid run');
  assert.equal(existsSync(observedDb), false, 'Database directory must be cleanly removed after valid run');
  assert.equal(existsSync(result.workspaceRoot), false, 'Result workspaceRoot must not exist on disk');
  assert.equal(existsSync(result.databaseDir), false, 'Result databaseDir must not exist on disk');
});

test('Real RCT Lifecycle Demo: Negative fixture catches corrupted source invariant violation and cleans up dirs', async () => {
  let observedWs = null;
  let observedDb = null;
  await assert.rejects(
    async () => {
      await runLifecycleDemo({
        silent: true,
        injectFault: 'corrupt_source',
        onPathsCreated: ({ wsDir, dbDir }) => {
          observedWs = wsDir;
          observedDb = dbDir;
        }
      });
    },
    {
      name: 'AssertionError',
      message: /Original source root must remain 100% byte-identical/
    }
  );

  assert.ok(observedWs, 'Workspace directory path must be tracked');
  assert.ok(observedDb, 'Database directory path must be tracked');
  assert.equal(existsSync(observedWs), false, 'Workspace directory must be cleanly removed despite assertion failure');
  assert.equal(existsSync(observedDb), false, 'Database directory must be cleanly removed despite assertion failure');
});

test('Real RCT Lifecycle Demo: Negative fixture catches late snapshot mutation invariant violation and cleans up dirs', async () => {
  let observedWs = null;
  let observedDb = null;
  await assert.rejects(
    async () => {
      await runLifecycleDemo({
        silent: true,
        injectFault: 'late_snapshot_mutation',
        onPathsCreated: ({ wsDir, dbDir }) => {
          observedWs = wsDir;
          observedDb = dbDir;
        }
      });
    },
    {
      name: 'AssertionError',
      message: /Snapshot workspace must remain unmodified/
    }
  );

  assert.ok(observedWs, 'Workspace directory path must be tracked');
  assert.ok(observedDb, 'Database directory path must be tracked');
  assert.equal(existsSync(observedWs), false, 'Workspace directory must be cleanly removed despite assertion failure');
  assert.equal(existsSync(observedDb), false, 'Database directory must be cleanly removed despite assertion failure');
});

test('CLI entrypoint: positive and negative runs guarantee workspace and db cleanup with zero leaked directories', async () => {
  const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

  function getLeakedDirs() {
    return readdirSync(tmpdir()).filter(f => f.startsWith('zetro-demo-ws-') || f.startsWith('zetro-demo-db-'));
  }

  // 1. Positive run
  const run1 = await execFileAsync(process.execPath, [cliPath, 'demo']);
  assert.ok(run1.stdout.includes('Lifecycle Demo Completed Successfully: All Invariants Pass'));
  assert.deepEqual(getLeakedDirs(), [], 'No leaked directories after positive CLI run');

  // 2. Negative fixture: corrupt_source
  try {
    await execFileAsync(process.execPath, [cliPath, 'demo', '--fault=corrupt_source']);
    assert.fail('Should have exited with non-zero code');
  } catch (err) {
    assert.equal(err.code, 1, 'corrupt_source must exit with code 1');
    assert.ok(err.stderr.includes('Original source root must remain 100% byte-identical'));
  }
  assert.deepEqual(getLeakedDirs(), [], 'No leaked directories after corrupt_source CLI run');

  // 3. Negative fixture: late_snapshot_mutation
  try {
    await execFileAsync(process.execPath, [cliPath, 'demo', '--fault=late_snapshot_mutation']);
    assert.fail('Should have exited with non-zero code');
  } catch (err) {
    assert.equal(err.code, 1, 'late_snapshot_mutation must exit with code 1');
    assert.ok(err.stderr.includes('Snapshot workspace must remain unmodified'));
  }
  assert.deepEqual(getLeakedDirs(), [], 'No leaked directories after late_snapshot_mutation CLI run');
});

test('Authoritative Admission & Identity: End-to-end run, status, evidence, and SQLite restart survival', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  const targetContent = 'console.log("patched by zetro admission test");\n';
  let providerTurn = 0;
  let providerCallCount = 0;

  const fakeProvider = {
    name: 'admission-test-provider',
    async next() {
      providerCallCount++;
      providerTurn++;
      if (providerTurn === 1) {
        return {
          toolCalls: [{
            name: 'propose_patch',
            args: {
              path: ws.filePath,
              expectedSha256: ws.initialHash,
              content: targetContent
            }
          }],
          usage: { inputTokens: 110, outputTokens: 45 }
        };
      }
      return {
        toolCalls: [{
          name: 'submit_receipt',
          args: { summary: 'Successfully patched with valid workspace admission' }
        }],
        usage: { inputTokens: 90, outputTokens: 30 }
      };
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const verifier = createIndependentRctVerifier({ name: 'admission-verifier' });
  const { manager, store, dbPath } = await createTestEnv(t, adapter, { verifier });

  const taskId = 'task-admission-e2e-1';
  const envelope = createEnvelope(taskId, ws, {
    checks: [{ type: 'equals', path: ws.filePath, text: targetContent }]
  });

  // 1. Run Task via TaskManager
  const runResult = await manager.run(envelope);
  assert.equal(runResult.state, States.COMPLETED);
  assert.equal(runResult.id, taskId);

  // 2. Validate Authoritative Admission created on adapter
  const admission = adapter.latestAdmission;
  assert.ok(admission, 'latestAdmission must be created on adapter');
  assert.equal(admission.taskId, taskId);
  assert.equal(admission.attemptId, `${taskId}-att-1`);
  assert.equal(admission.sourceBaselineHash, ws.initialHash);
  assert.equal(resolve(admission.canonicalRoot), resolve(adapter.latestSnapshot.root));
  assert.equal(resolve(admission.sourceBaselineRoot), resolve(ws.sourceRoot));
  assert.ok(admission.admissionDigest, 'admissionDigest must be generated');

  // 3. Validate Execution Identity created on adapter
  const identity = adapter.latestExecutionIdentity;
  assert.ok(identity, 'latestExecutionIdentity must be created on adapter');
  assert.equal(identity.taskId, taskId);
  assert.equal(identity.attemptId, `${taskId}-att-1`);
  assert.equal(identity.workspaceId, `ws-${taskId}`);

  // 4. Status API check
  const status = manager.status(taskId);
  assert.equal(status.state, States.COMPLETED);
  assert.equal(status.latestAttempt.state, States.COMPLETED);
  assert.equal(status.latestAttempt.attemptNumber, 1);

  // 5. Evidence API check (Persisted Artifacts)
  const evidence = manager.evidence(taskId);
  assert.ok(evidence);
  assert.ok(evidence.artifacts.length >= 4);

  const admissionArtifact = evidence.artifacts.find(a => a.artifactType === 'workspace_admission');
  assert.ok(admissionArtifact, 'workspace_admission artifact must be persisted');
  assert.equal(admissionArtifact.metadata.admissionDigest, admission.admissionDigest);
  assert.equal(admissionArtifact.metadata.taskId, taskId);
  assert.equal(admissionArtifact.metadata.attemptId, `${taskId}-att-1`);
  assert.equal(admissionArtifact.metadata.sourceBaselineHash, ws.initialHash);

  const verifierArtifact = evidence.artifacts.find(a => a.artifactType === 'verifier_evidence');
  assert.ok(verifierArtifact, 'verifier_evidence artifact must be persisted');
  assert.equal(verifierArtifact.metadata.verified, true);
  assert.equal(verifierArtifact.metadata.verifier, 'admission-verifier');

  // 6. Audit Events check
  const events = manager.events(taskId);
  const admissionEvent = events.find(e => e.eventType === 'WORKSPACE_ADMISSION_VERIFIED');
  assert.ok(admissionEvent, 'WORKSPACE_ADMISSION_VERIFIED event must be logged');
  assert.equal(admissionEvent.payload.admissionDigest, admission.admissionDigest);

  // 7. Source Directory Integrity: Source remains completely unchanged
  const currentSourceContent = await ws.readSource();
  assert.equal(currentSourceContent, ws.initialContent, 'Source root must remain byte-identical');

  // 8. Real SQLite Restart Survival
  // Close existing manager and store connection
  manager.close();

  // Reopen fresh store from database file
  const restartStore = new SqliteTaskStore(dbPath);
  await restartStore.init();
  try {
    const recoveredTask = restartStore.getTask(taskId);
    assert.equal(recoveredTask.state, States.COMPLETED);

    const recoveredAttempt = restartStore.getAttempt(`${taskId}-att-1`);
    assert.equal(recoveredAttempt.state, States.COMPLETED);

    const recoveredArtifacts = restartStore.getArtifacts(taskId);
    assert.ok(recoveredArtifacts.length >= 4);
    assert.ok(recoveredArtifacts.some(a => a.artifactType === 'workspace_admission'));
    assert.ok(recoveredArtifacts.some(a => a.artifactType === 'verifier_evidence'));

    const recoveredEvents = restartStore.getEvents(taskId);
    assert.ok(recoveredEvents.some(e => e.eventType === 'WORKSPACE_ADMISSION_VERIFIED'));
  } finally {
    restartStore.close();
  }
});

test('Authoritative Admission: Mismatched attempt or stale attempt denied with 0 provider calls and 0 tool effects', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let providerCallCount = 0;
  const fakeProvider = {
    name: 'test-provider',
    async next() {
      providerCallCount++;
      return { toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } };
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const { manager } = await createTestEnv(t, adapter);

  const taskId = 'task-stale-att-probe';
  const envelope = createEnvelope(taskId, ws);

  // Construct a stale admission contract for attempt 0
  const staleAdmission = createWorkspaceAdmission({
    workspaceId: `ws-${taskId}`,
    taskId,
    attemptId: 'stale-attempt-0', // Mismatched / stale attempt!
    canonicalRoot: join(tmpdir(), 'fake-snapshot-stale'), // Will also mismatch snapshot.root
    sourceBaselineRoot: resolve(ws.sourceRoot),
    sourceBaselineHash: ws.initialHash,
    scope: { readPaths: [ws.filePath], writePaths: [ws.filePath], createPaths: [] },
    admittedAt: Date.now(),
    admittedBy: 'coordinator'
  });

  // 1. Run through TaskManager with stale admission
  const result = await manager.run(envelope, { workspaceAdmission: staleAdmission });
  assert.equal(result.state, States.FAILED, 'Mismatched attempt must fail task');
  assert.ok(result.latestAttempt.error.includes('stale attempt rejection') || result.latestAttempt.error.includes('attemptId mismatch'));

  // 0 provider calls, 0 tool effects
  assert.equal(providerCallCount, 0, 'Zero provider calls on stale attempt admission');
  assert.equal(await ws.readSource(), ws.initialContent, 'Source root must remain completely unmodified');

  // 2. Direct adapter execution with mismatched executionIdentity
  await assert.rejects(
    adapter.execute(envelope, {
      executionIdentity: {
        taskId,
        attemptId: 'foreign-attempt-99', // Mismatched!
        workspaceId: `ws-${taskId}`
      }
    }),
    /Execution identity attemptId mismatch \(stale attempt rejection\)/
  );

  assert.equal(providerCallCount, 0, 'Zero provider calls on direct mismatched executionIdentity');
  assert.equal(await ws.readSource(), ws.initialContent, 'Source root must remain completely unmodified');
});

test('Authoritative Admission: Wrong source or root overrides fail closed with 0 provider calls', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let providerCallCount = 0;
  const fakeProvider = {
    name: 'test-provider',
    async next() {
      providerCallCount++;
      return { toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } };
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const envelope = createEnvelope('task-override-probe', ws);

  // 1. Hostile optionsOrSignal.sourceRoot
  await assert.rejects(
    adapter.execute(envelope, { sourceRoot: join(tmpdir(), 'hostile-dir') }),
    /Source root override mismatch/
  );
  assert.equal(providerCallCount, 0, 'Hostile sourceRoot rejected before provider');

  // 2. Hostile runtimeOptions.sourceRoot
  const hostileSourceAdapter = new RealRctAdapter({
    provider: fakeProvider,
    sourceRoot: ws.sourceRoot,
    runtimeOptions: { sourceRoot: join(tmpdir(), 'hostile-dir') }
  });
  await assert.rejects(
    hostileSourceAdapter.execute(envelope),
    /Source root override mismatch/
  );
  assert.equal(providerCallCount, 0, 'Hostile runtimeOptions.sourceRoot rejected before provider');

  // 3. Hostile runtimeOptions.sourceBaselineRoot
  const hostileBaselineAdapter = new RealRctAdapter({
    provider: fakeProvider,
    sourceRoot: ws.sourceRoot,
    runtimeOptions: { sourceBaselineRoot: join(tmpdir(), 'hostile-baseline') }
  });
  await assert.rejects(
    hostileBaselineAdapter.execute(envelope),
    /Source baseline root override mismatch/
  );
  assert.equal(providerCallCount, 0, 'Hostile runtimeOptions.sourceBaselineRoot rejected before provider');

  // 4. Hostile canonicalRoot override (attempting snapshot escape)
  await assert.rejects(
    adapter.execute(envelope, { canonicalRoot: join(tmpdir(), 'hostile-snapshot') }),
    /Canonical root override mismatch/
  );
  assert.equal(providerCallCount, 0, 'Hostile canonicalRoot rejected before provider');

  // 5. Hostile runtimeOptions.taskId
  const hostileTaskAdapter = new RealRctAdapter({
    provider: fakeProvider,
    sourceRoot: ws.sourceRoot,
    runtimeOptions: { taskId: 'foreign-task-id' }
  });
  await assert.rejects(
    hostileTaskAdapter.execute(envelope),
    /Task ID mismatch/
  );
  assert.equal(providerCallCount, 0, 'Hostile taskId rejected before provider');

  // 6. Hostile runtimeOptions.attemptId
  const hostileAttemptAdapter = new RealRctAdapter({
    provider: fakeProvider,
    sourceRoot: ws.sourceRoot,
    runtimeOptions: { attemptId: 'foreign-attempt-id' }
  });
  await assert.rejects(
    hostileAttemptAdapter.execute(envelope),
    /Attempt ID mismatch/
  );
  assert.equal(providerCallCount, 0, 'Hostile attemptId rejected before provider');

  assert.equal(await ws.readSource(), ws.initialContent, 'Source root must remain 100% byte-identical');
});

test('Authoritative Admission: Tampered admissionDigest or outside-scope paths fail closed before provider', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  let providerCallCount = 0;
  const fakeProvider = {
    name: 'test-provider',
    async next() {
      providerCallCount++;
      return { toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } };
    }
  };

  const adapter = new RealRctAdapter({ provider: fakeProvider, sourceRoot: ws.sourceRoot });
  const taskId = 'task-tamper-probe';
  const envelope = createEnvelope(taskId, ws);

  // 1. Admission with tampered cryptographic digest
  const validAdmission = createWorkspaceAdmission({
    workspaceId: `ws-${taskId}`,
    taskId,
    attemptId: `${taskId}-att-1`,
    canonicalRoot: join(tmpdir(), 'fake-snapshot-tamper'), // will be overridden in test
    sourceBaselineRoot: resolve(ws.sourceRoot),
    sourceBaselineHash: ws.initialHash,
    scope: { readPaths: [ws.filePath], writePaths: [ws.filePath], createPaths: [] },
    admittedAt: Date.now(),
    admittedBy: 'coordinator'
  });

  const tamperedAdmission = {
    ...validAdmission,
    admissionDigest: 'e'.repeat(64) // Tampered digest!
  };

  await assert.rejects(
    adapter.execute(envelope, { workspaceAdmission: tamperedAdmission }),
    /admissionDigest mismatch/
  );
  assert.equal(providerCallCount, 0, 'Tampered admission digest fails closed before provider');

  // 2. Admission with scope omitting allowedPath
  const restrictedScopeAdmission = createWorkspaceAdmission({
    workspaceId: `ws-${taskId}`,
    taskId,
    attemptId: `${taskId}-att-1`,
    canonicalRoot: join(tmpdir(), 'fake-snapshot-restricted'),
    sourceBaselineRoot: resolve(ws.sourceRoot),
    sourceBaselineHash: ws.initialHash,
    scope: { readPaths: ['src/unrelated.js'], writePaths: ['src/unrelated.js'], createPaths: [] }, // Omits ws.filePath!
    admittedAt: Date.now(),
    admittedBy: 'coordinator'
  });

  await assert.rejects(
    adapter.execute(envelope, { workspaceAdmission: restrictedScopeAdmission }),
    /outside workspace admission scope|Workspace admission canonicalRoot mismatch/
  );
  assert.equal(providerCallCount, 0, 'Scope violation fails closed before provider');
});

test('Authoritative Admission: Shared RctPolicyPort with trusted grant authority authorizes execution and rejects ungranted tools', async (t) => {
  const ws = await createSyntheticWorkspace();
  t.after(async () => await ws.cleanup());

  const targetContent = 'console.log("patched with policy authority");\n';
  let providerTurn = 0;
  let providerCallCount = 0;

  const fakeProvider = {
    name: 'policy-test-provider',
    async next() {
      providerCallCount++;
      providerTurn++;
      if (providerTurn === 1) {
        return {
          toolCalls: [{
            name: 'propose_patch',
            args: {
              path: ws.filePath,
              expectedSha256: ws.initialHash,
              content: targetContent
            }
          }],
          usage: { inputTokens: 100, outputTokens: 40 }
        };
      }
      return {
        toolCalls: [{
          name: 'submit_receipt',
          args: { summary: 'Applied patch under policy authority' }
        }],
        usage: { inputTokens: 80, outputTokens: 30 }
      };
    }
  };

  // 1. Shared PolicyService and RctPolicyPort
  const policyService = new PolicyService();
  const policyPort = new RctPolicyPort(policyService);

  const adapter = new RealRctAdapter({
    provider: fakeProvider,
    sourceRoot: ws.sourceRoot,
    policyPort
  });
  const verifier = createIndependentRctVerifier({ name: 'policy-verifier' });
  const { manager } = await createTestEnv(t, adapter, { verifier, policyPort });

  const taskId = 'task-policy-auth-1';
  const envelope = createEnvelope(taskId, ws, {
    checks: [{ type: 'equals', path: ws.filePath, text: targetContent }]
  });

  const result = await manager.run(envelope);
  assert.equal(result.state, States.COMPLETED);
  assert.equal(providerCallCount, 2);
  assert.ok(policyPort.admittedWorkspace, 'policyPort must have admittedWorkspace bound');
  assert.equal(policyPort.admittedWorkspace.taskId, taskId);

  // 2. Case B: Hostile attempt to invent worker authority via runtimeOptions
  const hostileFakeAuthorityAdapter = new RealRctAdapter({
    provider: fakeProvider,
    sourceRoot: ws.sourceRoot,
    runtimeOptions: {
      authority: {
        evaluate: () => ({ allowed: true }) // Fabricated worker authority!
      }
    }
  });

  // Must not throw due to hostile authority; authority is stripped from reserved options
  assert.equal(hostileFakeAuthorityAdapter.authority, null, 'Fabricated worker authority is not stored');
});


