import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ReviewPort,
  ReviewStates,
  TERMINAL_REVIEW_STATES,
  Intents,
  States,
  SqliteTaskStore,
  TaskManager
} from '../src/index.js';
import {
  exportReviewPatch,
  validateReviewPatch,
  REVIEW_PATCH_SCHEMA_VERSION,
  sha256
} from '../../rct-runtime/src/index.js';

async function createFixture() {
  const wsDir = await mkdtemp(join(tmpdir(), 'zetro-rev-ws-'));
  const dbDir = await mkdtemp(join(tmpdir(), 'zetro-rev-db-'));
  const filePath = 'src/calc.js';
  const initialContent = 'export function calc() { return 1; }\n';
  const patchedContent = 'export function calc() { return 42; }\n';

  await mkdir(join(wsDir, 'src'), { recursive: true });
  await writeFile(join(wsDir, filePath), initialContent, 'utf8');

  const initialHash = sha256(Buffer.from(initialContent));
  const patchedHash = sha256(Buffer.from(patchedContent));

  const dbPath = join(dbDir, 'tasks.db');
  const store = new SqliteTaskStore(dbPath);
  await store.init();

  const taskId = 'task-rev-test-1';
  const attemptId = 'task-rev-test-1-att-1';

  store.createTask({
    id: taskId,
    agent: 'worker-rct-1',
    objective: 'Update calc to return 42',
    allowedPaths: [filePath],
    contextRefs: ['docs/SPEC.md'],
    acceptance: 'calc returns 42',
    verification: filePath,
    workspaceRoot: wsDir,
    sourceHash: initialHash,
    sourceHashes: { [filePath]: initialHash },
    assignmentDigest: 'hash-abc',
    state: States.COMPLETED,
    deadlineMs: 30000,
    budget: { maxContextChars: 1000, maxReplyChars: 500 }
  });

  store.createAttempt({
    attemptId,
    taskId,
    attemptNumber: 1,
    intent: Intents.NONE,
    state: States.COMPLETED,
    startedAt: Date.now() - 1000,
    finishedAt: Date.now()
  });

  function seedVerifierEvidence(attId = attemptId, checks = null) {
    store.recordArtifact(taskId, attId, {
      artifactType: 'verifier_evidence',
      uri: `evidence/${taskId}-${attId}-verifier.json`,
      metadata: {
        verified: true,
        checks: checks || [
          {
            type: 'equals',
            path: filePath,
            passed: true,
            sha256: patchedHash,
            expectedBytes: Buffer.byteLength(patchedContent, 'utf8'),
            actualBytes: Buffer.byteLength(patchedContent, 'utf8')
          }
        ],
        verifier: 'independent-verifier'
      }
    });
  }

  seedVerifierEvidence(attemptId);

  function buildValidManifest(overrides = {}) {
    const body = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: taskId,
        assignmentHash: 'hash-abc',
        objective: 'Update calc to return 42',
        allowedPaths: [filePath]
      },
      sourceBaseline: {
        hashes: { [filePath]: initialHash }
      },
      snapshot: {
        hashes: { [filePath]: patchedHash }
      },
      changes: [
        {
          path: filePath,
          beforeSha256: initialHash,
          afterSha256: patchedHash,
          bytes: Buffer.byteLength(patchedContent, 'utf8'),
          patchContent: patchedContent
        }
      ],
      verification: {
        verified: true,
        checkRuns: 1,
        checks: [
          {
            type: 'equals',
            path: filePath,
            passed: true,
            sha256: patchedHash,
            expectedBytes: Buffer.byteLength(patchedContent, 'utf8'),
            actualBytes: Buffer.byteLength(patchedContent, 'utf8')
          }
        ]
      },
      workerClaims: {
        workerSummary: 'Implemented 42 in calc',
        completionSource: 'independent_checks'
      },
      usage: {
        wallTimeMs: 120,
        requests: 1,
        totalTokens: 200,
        toolCalls: 1
      },
      ...overrides
    };

    const manifestHash = sha256(JSON.stringify(body));
    return {
      ...body,
      manifestHash
    };
  }

  async function cleanup() {
    store.close();
    await rm(wsDir, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  }

  return {
    wsDir,
    dbDir,
    dbPath,
    store,
    filePath,
    initialContent,
    patchedContent,
    initialHash,
    patchedHash,
    taskId,
    attemptId,
    seedVerifierEvidence,
    buildValidManifest,
    cleanup
  };
}

test('ReviewPort: Valid manifest ingestion binds exact task/attempt/baseline/patch/verification references', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });
    const manifest = f.buildValidManifest();

    const review = await port.ingestReviewPatch(manifest, { attemptId: f.attemptId });

    assert.equal(review.id, `rev-${f.taskId}-${f.attemptId}`);
    assert.equal(review.taskId, f.taskId);
    assert.equal(review.attemptId, f.attemptId);
    assert.equal(review.state, ReviewStates.PENDING);
    assert.equal(review.patchDigest, manifest.manifestHash);
    assert.deepEqual(review.sourceBaseline, { hashes: { [f.filePath]: f.initialHash } });
    assert.equal(review.verification.verified, true);
    assert.equal(review.verification.checks[0].sha256, f.patchedHash);

    // Audit trail & artifact persisted
    const events = f.store.getEvents(f.taskId);
    assert.ok(events.some(e => e.eventType === 'REVIEW_INGESTED' && e.payload?.reviewId === review.id));

    const artifacts = f.store.getArtifacts(f.taskId);
    const reviewArtifact = artifacts.find(a => a.artifactType === 'review_patch');
    assert.ok(reviewArtifact);
    assert.equal(reviewArtifact.hash, manifest.manifestHash);
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Consuming runtime exportReviewPatch output through injected contract', async () => {
  const f = await createFixture();
  try {
    // Generate manifest via rct-runtime exportReviewPatch
    const assignment = {
      id: f.taskId,
      objective: 'Update calc to return 42',
      allowedPaths: [f.filePath],
      scope: { sourceHashes: { [f.filePath]: f.initialHash } }
    };
    const receipt = {
      id: f.taskId,
      state: 'review_ready',
      diffOutcome: 'applied',
      changedPaths: [f.filePath],
      metrics: { verified: true, checkRuns: 1 },
      checks: [{ type: 'equals', path: f.filePath, passed: true, sha256: f.patchedHash }],
      patches: [{ path: f.filePath, before: f.initialHash, after: f.patchedHash, content: f.patchedContent, applied: true }]
    };

    const exportedManifest = await exportReviewPatch({
      assignment,
      receipt,
      sourceRoot: f.wsDir
    });
    assert.ok(exportedManifest, 'exportReviewPatch must produce valid manifest');

    f.store.db.prepare('UPDATE tasks SET assignment_digest = ? WHERE id = ?').run(
      exportedManifest.task.assignmentHash,
      f.taskId
    );

    // Ingest via ReviewPort with injected validator contract
    let injectedValidatorCalled = false;
    const injectedValidator = async (manifest, opts) => {
      injectedValidatorCalled = true;
      return validateReviewPatch(manifest, opts);
    };

    const port = new ReviewPort(f.store, {
      validator: injectedValidator,
      sourceRoot: f.wsDir
    });

    const review = await port.ingestReviewPatch(exportedManifest, { attemptId: f.attemptId });
    assert.equal(injectedValidatorCalled, true);
    assert.equal(review.state, ReviewStates.PENDING);
    assert.equal(review.patchDigest, exportedManifest.manifestHash);
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: One-use approval intent records immutable intent and preserves source', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });
    const manifest = f.buildValidManifest();
    const review = await port.ingestReviewPatch(manifest, { attemptId: f.attemptId });

    // 1. Approve review
    const approved = await port.approve(review.id, {
      operator: 'coordinator-codex',
      reason: 'Verified against specification'
    });

    assert.equal(approved.state, ReviewStates.APPROVED);
    assert.equal(approved.approvalIntent, Intents.APPROVE_PATCH);
    assert.equal(approved.approvalData?.operator, 'coordinator-codex');
    assert.ok(approved.approvedAt > 0);

    // 2. Intent recorded in TaskStore
    const attempt = f.store.getAttempt(f.attemptId);
    assert.equal(attempt.intent, Intents.APPROVE_PATCH);
    assert.equal(attempt.intentData?.operator, 'coordinator-codex');

    // 3. One-use enforcement: re-approval MUST fail
    await assert.rejects(
      async () => {
        await port.approve(review.id, { operator: 'intruder' });
      },
      /One-use approval rejection.*already APPROVED/
    );

    // 4. Source root MUST remain completely unapplied (no source apply yet)
    const sourceContent = await readFile(join(f.wsDir, f.filePath), 'utf8');
    assert.equal(sourceContent, f.initialContent, 'Source root must remain unmodified (no source apply yet)');
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Immutable review states prevent terminal overwrite across approved, rejected, and discarded', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });

    // Review 1: APPROVED cannot be rejected or discarded
    const m1 = f.buildValidManifest();
    const r1 = await port.ingestReviewPatch(m1, { attemptId: f.attemptId, reviewId: 'rev-term-1' });
    await port.approve(r1.id);

    await assert.rejects(
      async () => port.reject(r1.id),
      /Terminal overwrite rejection.*terminal state 'APPROVED'/
    );
    await assert.rejects(
      async () => port.discard(r1.id),
      /Terminal overwrite rejection.*terminal state 'APPROVED'/
    );

    // Create Attempt 2 for testing REJECTED
    const att2 = 'task-rev-test-1-att-2';
    f.store.createAttempt({
      attemptId: att2,
      taskId: f.taskId,
      attemptNumber: 2,
      intent: Intents.NONE,
      state: States.COMPLETED
    });
    f.seedVerifierEvidence(att2);

    const m2 = f.buildValidManifest({ task: { id: f.taskId, assignmentHash: 'hash-abc', allowedPaths: [f.filePath], objective: 'attempt 2' } });
    const r2 = await port.ingestReviewPatch(m2, { attemptId: att2, reviewId: 'rev-term-2' });
    await port.reject(r2.id);

    await assert.rejects(
      async () => port.approve(r2.id),
      /Terminal overwrite rejection.*terminal state 'REJECTED'/
    );
    await assert.rejects(
      async () => port.discard(r2.id),
      /Terminal overwrite rejection.*terminal state 'REJECTED'/
    );

    // Create Attempt 3 for testing DISCARDED
    const att3 = 'task-rev-test-1-att-3';
    f.store.createAttempt({
      attemptId: att3,
      taskId: f.taskId,
      attemptNumber: 3,
      intent: Intents.NONE,
      state: States.COMPLETED
    });
    f.seedVerifierEvidence(att3);

    const m3 = f.buildValidManifest({ task: { id: f.taskId, assignmentHash: 'hash-abc', allowedPaths: [f.filePath], objective: 'attempt 3' } });
    const r3 = await port.ingestReviewPatch(m3, { attemptId: att3, reviewId: 'rev-term-3' });
    await port.discard(r3.id);

    await assert.rejects(
      async () => port.approve(r3.id),
      /Terminal overwrite rejection.*terminal state 'DISCARDED'/
    );
    await assert.rejects(
      async () => port.reject(r3.id),
      /Terminal overwrite rejection.*terminal state 'DISCARDED'/
    );
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Replay rejection blocks duplicate ingestion for same attempt and patch', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });
    const manifest = f.buildValidManifest();

    await port.ingestReviewPatch(manifest, { attemptId: f.attemptId });

    // Second ingestion with same manifest and attempt MUST fail
    await assert.rejects(
      async () => {
        await port.ingestReviewPatch(manifest, { attemptId: f.attemptId, reviewId: 'rev-dup' });
      },
      /Replay rejection.*already ingested/
    );
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Strict rejection of worker-claimed evidence without independent verification', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });

    // 1. Missing verification (verified is false)
    const bad1 = f.buildValidManifest({
      verification: {
        verified: false,
        checks: []
      }
    });
    await assert.rejects(
      async () => port.ingestReviewPatch(bad1, { attemptId: f.attemptId }),
      /Worker claim rejection|validation failed/
    );

    // 2. Worker claimed alone without independent verification
    const bad2 = f.buildValidManifest({
      verification: {
        verified: true,
        checks: [{ type: 'equals', path: f.filePath, passed: false }] // failing check
      }
    });
    await assert.rejects(
      async () => port.ingestReviewPatch(bad2, { attemptId: f.attemptId }),
      /Worker claim rejection|validation failed/
    );

    // 3. Worker summary claiming completion alone
    const bad3 = f.buildValidManifest({
      workerClaims: {
        workerSummary: 'I finished the task myself',
        completionSource: 'worker_claim_alone'
      }
    });
    await assert.rejects(
      async () => port.ingestReviewPatch(bad3, { attemptId: f.attemptId }),
      /Worker claim rejection|Worker claim alone/
    );
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Stale baseline rejection when source file modified on disk', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });
    const manifest = f.buildValidManifest();

    // Mutate source file on disk before ingestion
    await writeFile(join(f.wsDir, f.filePath), 'mutated outside orchestration!\n', 'utf8');

    // Ingestion MUST fail with stale baseline
    await assert.rejects(
      async () => {
        await port.ingestReviewPatch(manifest, { attemptId: f.attemptId });
      },
      /Stale baseline/
    );
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Stale baseline rejection before approval when source modified post-ingestion', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });
    const manifest = f.buildValidManifest();

    // 1. Ingest successfully with intact source
    const review = await port.ingestReviewPatch(manifest, { attemptId: f.attemptId });
    assert.equal(review.state, ReviewStates.PENDING);

    // 2. Corrupt source root before approval
    await writeFile(join(f.wsDir, f.filePath), 'stale corruption right before approve\n', 'utf8');

    // 3. Approval MUST reject stale baseline
    await assert.rejects(
      async () => {
        await port.approve(review.id);
      },
      /Stale baseline rejection/
    );

    // State remains PENDING (not approved)
    const fresh = port.getReview(review.id);
    assert.equal(fresh.state, ReviewStates.PENDING);
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Mismatch rejection for wrong task, invalid attempt, or baseline divergence', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });

    // 1. Task ID mismatch
    const badTaskManifest = f.buildValidManifest({
      task: { id: 'wrong-task-id', allowedPaths: [f.filePath] }
    });
    await assert.rejects(
      async () => port.ingestReviewPatch(badTaskManifest, { attemptId: f.attemptId }),
      /Task 'wrong-task-id' not found in authoritative TaskStore/
    );

    // 2. Attempt does not belong to task
    const otherTaskId = 'task-other-2';
    f.store.createTask({
      id: otherTaskId,
      agent: 'worker-2',
      objective: 'other',
      allowedPaths: [f.filePath],
      contextRefs: [],
      acceptance: '',
      verification: '',
      deadlineMs: 10000,
      budget: { maxContextChars: 100, maxReplyChars: 100 }
    });
    const badAttId = 'other-att-1';
    f.store.createAttempt({
      attemptId: badAttId,
      taskId: otherTaskId,
      attemptNumber: 1,
      intent: Intents.NONE,
      state: States.COMPLETED
    });

    const manifest = f.buildValidManifest();
    await assert.rejects(
      async () => port.ingestReviewPatch(manifest, { attemptId: badAttId }),
      /Attempt ownership mismatch/
    );

    // 3. Ingesting for CANCELLED or FAILED attempt is rejected
    const cancelAttId = 'task-rev-test-1-att-cancel';
    f.store.createAttempt({
      attemptId: cancelAttId,
      taskId: f.taskId,
      attemptNumber: 4,
      intent: Intents.CANCEL_REQUESTED,
      state: States.CANCELLED
    });
    await assert.rejects(
      async () => port.ingestReviewPatch(manifest, { attemptId: cancelAttId }),
      /Unverified attempt rejection.*CANCELLED/
    );

    // 4. Baseline mismatch against task envelope
    const badBaselineManifest = f.buildValidManifest({
      sourceBaseline: {
        hashes: { [f.filePath]: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }
      }
    });
    await assert.rejects(
      async () => port.ingestReviewPatch(badBaselineManifest, { attemptId: f.attemptId }),
      /Baseline.*mismatch/i
    );
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Malformed manifest rejection across invalid hash, schema, or missing changes', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });

    // Non-object
    await assert.rejects(
      async () => port.ingestReviewPatch(null),
      /Malformed manifest: expected non-null object/
    );

    // Tampered manifestHash
    const tampered = f.buildValidManifest();
    tampered.manifestHash = '0000000000000000000000000000000000000000000000000000000000000000';
    await assert.rejects(
      async () => port.ingestReviewPatch(tampered, { attemptId: f.attemptId }),
      /Manifest hash integrity mismatch|validation failed/
    );

    // Empty changes
    const noChanges = f.buildValidManifest({ changes: [] });
    await assert.rejects(
      async () => port.ingestReviewPatch(noChanges, { attemptId: f.attemptId }),
      /No changes declared|validation failed/
    );
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Persistence and immutability survive store restart (crash recovery)', async () => {
  const f = await createFixture();
  try {
    const port1 = new ReviewPort(f.store, { sourceRoot: f.wsDir });
    const manifest = f.buildValidManifest();

    const review1 = await port1.ingestReviewPatch(manifest, { attemptId: f.attemptId });
    await port1.approve(review1.id, { operator: 'codex-verifier', reason: 'Verified' });

    // Simulate system shutdown: close store
    f.store.close();

    // Session 2: new store instance initialized on same database file
    const store2 = new SqliteTaskStore(f.dbPath);
    await store2.init();
    const port2 = new ReviewPort(store2, { sourceRoot: f.wsDir });

    // Verify review persists with exact state and hashes
    const restored = port2.getReview(review1.id);
    assert.ok(restored, 'Review must exist after store restart');
    assert.equal(restored.id, review1.id);
    assert.equal(restored.state, ReviewStates.APPROVED);
    assert.equal(restored.patchDigest, manifest.manifestHash);
    assert.equal(restored.approvalIntent, Intents.APPROVE_PATCH);
    assert.equal(restored.approvalData?.operator, 'codex-verifier');
    assert.deepEqual(restored.sourceBaseline, { hashes: { [f.filePath]: f.initialHash } });

    // Immutability preserved after restart: cannot re-approve
    await assert.rejects(
      async () => port2.approve(review1.id),
      /One-use approval rejection.*already APPROVED/
    );

    store2.close();
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Forged manifest rejected when stored verifier evidence check sha256 does not match patch digest', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });

    // Build manifest where afterSha256 is forged/altered compared to stored verifier evidence
    const forgedPatchedContent = 'export function calc() { return 999; }\n';
    const forgedHash = sha256(Buffer.from(forgedPatchedContent));

    const forgedManifest = f.buildValidManifest({
      changes: [
        {
          path: f.filePath,
          beforeSha256: f.initialHash,
          afterSha256: forgedHash,
          bytes: Buffer.byteLength(forgedPatchedContent, 'utf8'),
          patchContent: forgedPatchedContent
        }
      ],
      snapshot: {
        hashes: { [f.filePath]: forgedHash }
      },
      verification: {
        verified: true,
        checkRuns: 1,
        checks: [
          {
            type: 'equals',
            path: f.filePath,
            passed: true,
            sha256: forgedHash,
            expectedBytes: Buffer.byteLength(forgedPatchedContent, 'utf8'),
            actualBytes: Buffer.byteLength(forgedPatchedContent, 'utf8')
          }
        ]
      }
    });

    // Ingestion MUST be rejected because stored verifier evidence in TaskStore has patchedHash (42), NOT forgedHash (999)
    await assert.rejects(
      async () => port.ingestReviewPatch(forgedManifest, { attemptId: f.attemptId }),
      /Forged manifest rejection.*stored verifier check sha256.*does not match patch change afterSha256/
    );
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Forged manifest rejected when assignmentHash does not match task assignmentDigest', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });
    const forgedManifest = f.buildValidManifest({
      task: {
        id: f.taskId,
        assignmentHash: 'completely-different-assignment-digest',
        objective: 'Update calc to return 42',
        allowedPaths: [f.filePath]
      }
    });

    await assert.rejects(
      async () => port.ingestReviewPatch(forgedManifest, { attemptId: f.attemptId }),
      /Forged manifest rejection: manifest assignmentHash.*does not match task assignmentDigest/
    );
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Unverified attempt rejected when attempt is SUBMITTED with no stored verifier evidence', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });

    // Create an unverified attempt in SUBMITTED state (worker claimed completion, no verifier ran)
    const unverifiedAttId = 'task-rev-test-1-att-sub';
    f.store.createAttempt({
      attemptId: unverifiedAttId,
      taskId: f.taskId,
      attemptNumber: 10,
      intent: Intents.NONE,
      state: States.SUBMITTED
    });

    // Manifest self-declares verified: true
    const manifest = f.buildValidManifest();

    await assert.rejects(
      async () => port.ingestReviewPatch(manifest, { attemptId: unverifiedAttId }),
      /Unverified attempt rejection:.*is not in COMPLETED state/
    );
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Stale source fallback rejected at approval when source changed on disk via workspaceRoot fallback', async () => {
  const f = await createFixture();
  try {
    // Note: port instantiated WITHOUT sourceRoot option; relies on task.workspaceRoot / review.sourceRoot fallback
    const port = new ReviewPort(f.store);
    const manifest = f.buildValidManifest();

    // Ingests using task.workspaceRoot fallback
    const review = await port.ingestReviewPatch(manifest, { attemptId: f.attemptId });
    assert.equal(review.state, ReviewStates.PENDING);
    assert.equal(review.sourceRoot, f.wsDir);

    // Mutate source file on disk
    await writeFile(join(f.wsDir, f.filePath), 'mutated on disk after review ingestion\n', 'utf8');

    // Calling approve without options.sourceRoot MUST still detect disk freshness via fallback and reject!
    await assert.rejects(
      async () => port.approve(review.id),
      /Stale baseline rejection: source file 'src\/calc\.js' changed on disk before approval/
    );

    // Review remains PENDING
    const fresh = port.getReview(review.id);
    assert.equal(fresh.state, ReviewStates.PENDING);
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Missing admitted source identity fails closed during ingestion and approval', async () => {
  const f = await createFixture();
  try {
    // Create task with NO workspaceRoot
    const noRootTaskId = 'task-no-root';
    const noRootAttId = 'task-no-root-att-1';
    f.store.createTask({
      id: noRootTaskId,
      agent: 'worker-1',
      objective: 'no root test',
      allowedPaths: [f.filePath],
      contextRefs: [],
      acceptance: '',
      verification: '',
      workspaceRoot: null, // explicitly missing
      assignmentDigest: 'hash-abc',
      sourceHash: f.initialHash,
      sourceHashes: { [f.filePath]: f.initialHash },
      state: States.COMPLETED,
      deadlineMs: 10000,
      budget: { maxContextChars: 100, maxReplyChars: 100 }
    });
    f.store.createAttempt({
      attemptId: noRootAttId,
      taskId: noRootTaskId,
      attemptNumber: 1,
      intent: Intents.NONE,
      state: States.COMPLETED
    });
    f.store.recordArtifact(noRootTaskId, noRootAttId, {
      artifactType: 'verifier_evidence',
      uri: `evidence/${noRootTaskId}-verifier.json`,
      metadata: {
        verified: true,
        checks: [
          {
            type: 'equals',
            path: f.filePath,
            passed: true,
            sha256: f.patchedHash,
            expectedBytes: Buffer.byteLength(f.patchedContent, 'utf8'),
            actualBytes: Buffer.byteLength(f.patchedContent, 'utf8')
          }
        ],
        verifier: 'independent-verifier'
      }
    });

    const port = new ReviewPort(f.store); // no sourceRoot
    const manifest = f.buildValidManifest({
      task: {
        id: noRootTaskId,
        assignmentHash: 'hash-abc',
        objective: 'no root test',
        allowedPaths: [f.filePath]
      }
    });

    // Ingest without sourceRoot option must fail closed
    await assert.rejects(
      async () => port.ingestReviewPatch(manifest, { attemptId: noRootAttId }),
      /Missing admitted source identity \(fail closed\)/
    );
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Partial transaction atomic rollback on failure injection guarantees zero partial state', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });
    const manifest = f.buildValidManifest();
    const review = await port.ingestReviewPatch(manifest, { attemptId: f.attemptId });

    assert.equal(review.state, ReviewStates.PENDING);

    // Verify baseline state before approval attempt
    const initialAttempt = f.store.getAttempt(f.attemptId);
    assert.equal(initialAttempt.intent, Intents.NONE);
    const initialEvents = f.store.getEvents(f.taskId);
    assert.equal(initialEvents.filter(e => e.eventType === 'REVIEW_APPROVED').length, 0);

    // 1. Injected failure after intent recording
    await assert.rejects(
      async () => port.approve(review.id, { _injectFailure: 'after_intent' }),
      /Injected failure after intent recording/
    );

    // ATOMIC ROLLBACK VERIFICATION:
    // Attempt intent MUST be rolled back to NONE (zero partial intent state)
    const rolledBackAttempt = f.store.getAttempt(f.attemptId);
    assert.equal(rolledBackAttempt.intent, Intents.NONE, 'Attempt intent must be rolled back to NONE');
    assert.equal(rolledBackAttempt.intentData, null);

    // Review state MUST remain PENDING (not APPROVED)
    const rolledBackReview = f.store.getReview(review.id);
    assert.equal(rolledBackReview.state, ReviewStates.PENDING, 'Review state must remain PENDING');
    assert.equal(rolledBackReview.approvedAt, null);
    assert.equal(rolledBackReview.approvalIntent, null);

    // Zero REVIEW_APPROVED events recorded
    const rolledBackEvents = f.store.getEvents(f.taskId);
    assert.equal(rolledBackEvents.filter(e => e.eventType === 'REVIEW_APPROVED').length, 0);

    // 2. Injected failure after review state update
    await assert.rejects(
      async () => port.approve(review.id, { _injectFailure: 'after_review_update' }),
      /Injected failure after review state update/
    );

    const rolledBackReview2 = f.store.getReview(review.id);
    assert.equal(rolledBackReview2.state, ReviewStates.PENDING);
    assert.equal(f.store.getAttempt(f.attemptId).intent, Intents.NONE);

    // 3. Normal approval succeeds cleanly after rollbacks
    const approved = await port.approve(review.id, { operator: 'coordinator-codex' });
    assert.equal(approved.state, ReviewStates.APPROVED);
    assert.equal(f.store.getAttempt(f.attemptId).intent, Intents.APPROVE_PATCH);
    assert.equal(f.store.getEvents(f.taskId).filter(e => e.eventType === 'REVIEW_APPROVED').length, 1);
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Negative regression - re-rooting bypass to alternate root rejected with zero writes', async () => {
  const f = await createFixture();
  const altDir = await mkdtemp(join(tmpdir(), 'zetro-alt-ws-'));
  try {
    // 1. Ingest valid review bound to canonical wsDir
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });
    const manifest = f.buildValidManifest();
    const review = await port.ingestReviewPatch(manifest, { attemptId: f.attemptId });
    assert.equal(review.state, ReviewStates.PENDING);
    assert.equal(review.sourceRoot, f.wsDir);

    // 2. Setup alternateRoot with original unmutated bytes
    await mkdir(join(altDir, 'src'), { recursive: true });
    await writeFile(join(altDir, f.filePath), f.initialContent, 'utf8');

    // 3. Mutate the actual canonical wsDir source file
    await writeFile(join(f.wsDir, f.filePath), 'mutated actual source on disk!\n', 'utf8');

    // 4. Attempt re-rooting bypass: approve with alternateRoot override
    await assert.rejects(
      async () => port.approve(review.id, { sourceRoot: altDir }),
      /Source identity mismatch rejection.*differs from canonical admitted review sourceRoot/
    );

    // 5. Attempt re-rooting bypass via new port instance with alternateRoot
    const altPort = new ReviewPort(f.store, { sourceRoot: altDir });
    await assert.rejects(
      async () => altPort.approve(review.id),
      /Source identity mismatch rejection.*differs from canonical admitted review sourceRoot/
    );

    // 6. Attempt approval with no options: must check canonical wsDir and reject stale baseline
    await assert.rejects(
      async () => port.approve(review.id),
      /Stale baseline rejection/
    );

    // 7. Critical: assert NO approval intent, state transition, or audit event writes occurred on denial
    const unapprovedReview = f.store.getReview(review.id);
    assert.equal(unapprovedReview.state, ReviewStates.PENDING, 'Review must remain PENDING');
    assert.equal(unapprovedReview.approvalIntent, null);
    assert.equal(unapprovedReview.approvalData, null);
    assert.equal(unapprovedReview.approvedAt, null);

    const attempt = f.store.getAttempt(f.attemptId);
    assert.equal(attempt.intent, Intents.NONE, 'Attempt intent must remain NONE');
    assert.equal(attempt.intentData, null);

    const events = f.store.getEvents(f.taskId);
    assert.equal(events.filter(e => e.eventType === 'REVIEW_APPROVED').length, 0, 'Zero REVIEW_APPROVED events on denial');
  } finally {
    await rm(altDir, { recursive: true, force: true });
    await f.cleanup();
  }
});

test('ReviewPort: Exact identity gate rejects manifest omitting task.assignmentHash', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });
    const manifest = f.buildValidManifest();
    delete manifest.task.assignmentHash;
    const { manifestHash, ...body } = manifest;
    manifest.manifestHash = sha256(JSON.stringify(body));

    await assert.rejects(
      async () => port.ingestReviewPatch(manifest, { attemptId: f.attemptId }),
      /Forged manifest rejection: Manifest omits required task.assignmentHash/
    );
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Exact identity gate rejects manifest omitting sourceBaseline hash for declared change', async () => {
  const f = await createFixture();
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });
    const manifest = f.buildValidManifest();
    delete manifest.sourceBaseline.hashes[f.filePath];
    const { manifestHash, ...body } = manifest;
    manifest.manifestHash = sha256(JSON.stringify(body));

    await assert.rejects(
      async () => port.ingestReviewPatch(manifest, { attemptId: f.attemptId }),
      /Missing baseline hash: Manifest omits sourceBaseline.hashes/
    );
  } finally {
    await f.cleanup();
  }
});

test('ReviewPort: Ingestion sourceRoot mismatch against task workspaceRoot rejected', async () => {
  const f = await createFixture();
  const altDir = await mkdtemp(join(tmpdir(), 'zetro-alt-ingest-'));
  try {
    const port = new ReviewPort(f.store, { sourceRoot: f.wsDir });
    const manifest = f.buildValidManifest();

    await assert.rejects(
      async () => port.ingestReviewPatch(manifest, { attemptId: f.attemptId, sourceRoot: altDir }),
      /Source identity mismatch rejection: Ingestion sourceRoot '.*' differs from task workspaceRoot/
    );
  } finally {
    await rm(altDir, { recursive: true, force: true });
    await f.cleanup();
  }
});
