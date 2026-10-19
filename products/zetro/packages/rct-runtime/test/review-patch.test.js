import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  runAssignment,
  sha256,
  createDefaultRegistry,
  exportReviewPatch,
  validateReviewPatch,
  doesCheckMatch,
  REVIEW_PATCH_SCHEMA_VERSION
} from '../src/index.js';
import { FakeProvider } from '../src/fake-provider.js';

async function withFixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zetro-review-patch-test-'));
  const sourceRoot = path.join(root, 'source');
  const snapshotRoot = path.join(root, 'snapshot');
  await mkdir(path.join(sourceRoot, 'src'), { recursive: true });
  await mkdir(path.join(snapshotRoot, 'src'), { recursive: true });
  await writeFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'hello\n');
  await writeFile(path.join(snapshotRoot, 'src', 'greeting.txt'), 'hello\n');
  try {
    return await fn({ root, sourceRoot, snapshotRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('Reviewable Patch Export & Validation Contract (W4-AGR2)', () => {
  it('1. Valid Review Ready: exports complete manifest with hashes, exact changes, check evidence refs, and separated worker claims', () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    let turn = 0;
    const provider = {
      name: 'successful-provider',
      async next() {
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [{
              name: 'propose_patch',
              args: {
                path: 'src/greeting.txt',
                expectedSha256: sha256('hello\n'),
                content: 'hello world\n'
              }
            }],
            usage: { inputTokens: 20, outputTokens: 10 }
          };
        }
        return {
          toolCalls: [{
            name: 'submit_receipt',
            args: { summary: 'Successfully updated greeting' }
          }],
          usage: { inputTokens: 10, outputTokens: 5 }
        };
      }
    };

    const assignment = {
      id: 'task-review-export-success',
      objective: 'Update greeting to hello world',
      acceptance: 'src/greeting.txt equals hello world\n',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
    };

    const receipt = await runAssignment(assignment, provider, snapshotRoot, {
      isolated: true,
      sourceRoot
    });

    assert.equal(receipt.state, 'review_ready');
    assert.equal(receipt.diffOutcome, 'applied');
    assert.ok(receipt.reviewPatch, 'receipt.reviewPatch must be populated on review_ready');

    const manifest = receipt.reviewPatch;
    assert.equal(manifest.schemaVersion, REVIEW_PATCH_SCHEMA_VERSION);
    assert.equal(manifest.task.id, 'task-review-export-success');
    assert.deepEqual(manifest.task.allowedPaths, ['src/greeting.txt']);

    // Baseline and snapshot hashes
    assert.equal(manifest.sourceBaseline.hashes['src/greeting.txt'], sha256('hello\n'));
    assert.equal(manifest.snapshot.hashes['src/greeting.txt'], sha256('hello world\n'));

    // Exact changes
    assert.equal(manifest.changes.length, 1);
    assert.equal(manifest.changes[0].path, 'src/greeting.txt');
    assert.equal(manifest.changes[0].beforeSha256, sha256('hello\n'));
    assert.equal(manifest.changes[0].afterSha256, sha256('hello world\n'));
    assert.equal(manifest.changes[0].patchContent, 'hello world\n');
    assert.equal(manifest.changes[0].bytes, Buffer.byteLength('hello world\n'));

    // Verification evidence refs
    assert.equal(manifest.verification.verified, true);
    assert.equal(manifest.verification.checks.length, 1);
    assert.equal(manifest.verification.checks[0].passed, true);
    assert.equal(manifest.verification.checks[0].sha256, sha256('hello world\n'));

    // Worker claims kept strictly separate
    assert.equal(manifest.workerClaims.workerSummary, 'Successfully updated greeting');
    assert.equal(manifest.workerClaims.completionSource, 'worker_receipt');

    // Manifest hash integrity
    assert.ok(/^[a-f0-9]{64}$/.test(manifest.manifestHash));

    // Self-digest validation alone validates structure and integrity, but does NOT certify execution proof (verified: false)
    const selfVal = await validateReviewPatch(manifest, { sourceRoot, assignment });
    assert.equal(selfVal.valid, true);
    assert.equal(selfVal.selfDigestValid, true);
    assert.equal(selfVal.verified, false, 'Declaration alone cannot certify execution proof');

    // Complete trusted evidence certification passes and yields verified: true
    const trustedEvidence = {
      taskId: assignment.id,
      assignmentHash: receipt.assignmentHash,
      snapshotHashes: manifest.snapshot.hashes,
      checkIds: ['src/greeting.txt'],
      verified: true
    };
    const validation = await validateReviewPatch(manifest, { sourceRoot, assignment, trustedEvidence });
    assert.equal(validation.valid, true);
    assert.equal(validation.verified, true);
    assert.deepEqual(validation.changedPaths, ['src/greeting.txt']);
  }));

  it('2. Source Unchanged: execution, export, and validation guarantee zero modification to source workspace (no automatic apply)', () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    const initialSourceContent = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8');
    const initialSourceSha = sha256(initialSourceContent);

    let turn = 0;
    const provider = {
      name: 'patch-provider',
      async next() {
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [{
              name: 'propose_patch',
              args: {
                path: 'src/greeting.txt',
                expectedSha256: sha256('hello\n'),
                content: 'mutated for review\n'
              }
            }],
            usage: { inputTokens: 10, outputTokens: 5 }
          };
        }
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'Done' } }],
          usage: { inputTokens: 5, outputTokens: 2 }
        };
      }
    };

    const assignment = {
      id: 'task-source-unchanged',
      objective: 'Verify source remains untouched',
      acceptance: 'Greeting mutated',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'mutated for review\n' }]
    };

    const receipt = await runAssignment(assignment, provider, snapshotRoot, {
      isolated: true,
      sourceRoot
    });

    assert.equal(receipt.state, 'review_ready');
    assert.ok(receipt.reviewPatch);

    // Validate the exported review patch multiple times
    const val1 = await validateReviewPatch(receipt.reviewPatch, { sourceRoot, assignment });
    assert.equal(val1.valid, true);

    const val2 = await validateReviewPatch(receipt.reviewPatch, { sourceRoot, assignment });
    assert.equal(val2.valid, true);

    // Source must remain completely byte-identical
    const currentSourceContent = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8');
    assert.equal(currentSourceContent, initialSourceContent);
    assert.equal(sha256(currentSourceContent), initialSourceSha);
  }));

  it('3. No-op Proposals: produces no review patch export (receipt.reviewPatch is null)', () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    let turn = 0;
    const provider = {
      name: 'noop-provider',
      async next() {
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [{
              name: 'propose_patch',
              args: {
                path: 'src/greeting.txt',
                expectedSha256: sha256('hello\n'),
                content: 'hello\n' // Identical content: no-op
              }
            }],
            usage: { inputTokens: 10, outputTokens: 5 }
          };
        }
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'No change' } }],
          usage: { inputTokens: 5, outputTokens: 2 }
        };
      }
    };

    const assignment = {
      id: 'task-noop-no-export',
      objective: 'Propose no-op patch',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    };

    const receipt = await runAssignment(assignment, provider, snapshotRoot, {
      isolated: true,
      sourceRoot
    });

    assert.equal(receipt.diffOutcome, 'empty');
    assert.equal(receipt.reviewPatch, null, 'No-op diffOutcome: empty must produce null reviewPatch');

    // Standalone exportReviewPatch also returns null
    const exported = await exportReviewPatch({ assignment, receipt, sourceRoot, snapshotRoot });
    assert.equal(exported, null);
  }));

  it('4. Reverted Proposals: produces no review patch export', () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    let turn = 0;
    const provider = {
      name: 'reverting-provider',
      async next() {
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [{
              name: 'propose_patch',
              args: {
                path: 'src/greeting.txt',
                expectedSha256: sha256('hello\n'),
                content: 'temporary change\n'
              }
            }],
            usage: { inputTokens: 10, outputTokens: 5 }
          };
        }
        if (turn === 2) {
          return {
            toolCalls: [{
              name: 'propose_patch',
              args: {
                path: 'src/greeting.txt',
                expectedSha256: sha256('temporary change\n'),
                content: 'hello\n' // Reverts back to initial content
              }
            }],
            usage: { inputTokens: 10, outputTokens: 5 }
          };
        }
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'Reverted back' } }],
          usage: { inputTokens: 5, outputTokens: 2 }
        };
      }
    };

    const assignment = {
      id: 'task-revert-no-export',
      objective: 'Reverted patch test',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    };

    const receipt = await runAssignment(assignment, provider, snapshotRoot, {
      isolated: true,
      sourceRoot
    });

    assert.equal(receipt.diffOutcome, 'reverted');
    assert.equal(receipt.reviewPatch, null, 'Reverted proposal must produce null reviewPatch');

    const exported = await exportReviewPatch({ assignment, receipt, sourceRoot, snapshotRoot });
    assert.equal(exported, null);
  }));

  it('5. Cancellation / Abort: produces no review patch export', () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    const controller = new AbortController();
    const provider = {
      name: 'aborted-provider',
      async next() {
        controller.abort();
        return {
          toolCalls: [{
            name: 'propose_patch',
            args: {
              path: 'src/greeting.txt',
              expectedSha256: sha256('hello\n'),
              content: 'hello world\n'
            }
          }],
          usage: { inputTokens: 10, outputTokens: 5 }
        };
      }
    };

    const assignment = {
      id: 'task-abort-no-export',
      objective: 'Cancellation test',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    };

    const receipt = await runAssignment(assignment, provider, snapshotRoot, {
      isolated: true,
      signal: controller.signal,
      sourceRoot
    });

    assert.equal(receipt.state, 'unknown');
    assert.equal(receipt.failureReason, 'aborted');
    assert.equal(receipt.reviewPatch, null, 'Aborted run must produce null reviewPatch');

    const exported = await exportReviewPatch({ assignment, receipt, sourceRoot, snapshotRoot });
    assert.equal(exported, null);
  }));

  it('6. Failed Independent Checks: produces no review patch export', () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    const provider = new FakeProvider([
      { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'wrong content\n' } },
      { name: 'submit_receipt', args: { summary: 'Claimed success' } }
    ]);

    const assignment = {
      id: 'task-failed-checks-no-export',
      objective: 'Wrong patch test',
      acceptance: 'Greeting equals exact expected',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'strictly expected text\n' }]
    };

    const receipt = await runAssignment(assignment, provider, snapshotRoot, {
      isolated: true,
      sourceRoot
    });

    assert.equal(receipt.state, 'failed');
    assert.equal(receipt.reviewPatch, null, 'Failed checks must produce null reviewPatch');
  }));

  it('7. Validation Rejects Stale Baseline: detects when source file changed since baseline was hashed', () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    let turn = 0;
    const provider = {
      name: 'provider',
      async next() {
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [{
              name: 'propose_patch',
              args: {
                path: 'src/greeting.txt',
                expectedSha256: sha256('hello\n'),
                content: 'updated\n'
              }
            }],
            usage: { inputTokens: 10, outputTokens: 5 }
          };
        }
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'Done' } }],
          usage: { inputTokens: 5, outputTokens: 2 }
        };
      }
    };

    const assignment = {
      id: 'task-stale-baseline',
      objective: 'Stale baseline test',
      acceptance: 'Greeting updated',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'updated\n' }]
    };

    const receipt = await runAssignment(assignment, provider, snapshotRoot, {
      isolated: true,
      sourceRoot
    });

    assert.ok(receipt.reviewPatch);

    // Concurrently mutate sourceRoot to simulate stale baseline
    await writeFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'concurrently changed source\n');

    const validation = await validateReviewPatch(receipt.reviewPatch, { sourceRoot, assignment });
    assert.equal(validation.valid, false);
    assert.ok(validation.reason.includes('Stale baseline'), `Expected Stale baseline reason, got: ${validation.reason}`);
  }));

  it('8. Validation Rejects Paths Outside Declared Allowed Paths', () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    const manifest = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: 'task-scope-violation',
        allowedPaths: ['src/greeting.txt']
      },
      sourceBaseline: {
        hashes: { 'unauthorized/secret.txt': sha256('secret\n') }
      },
      snapshot: {
        hashes: { 'unauthorized/secret.txt': sha256('exposed\n') }
      },
      changes: [{
        path: 'unauthorized/secret.txt',
        beforeSha256: sha256('secret\n'),
        afterSha256: sha256('exposed\n'),
        bytes: 8,
        patchContent: 'exposed\n'
      }],
      verification: {
        verified: true,
        checks: [{ type: 'equals', path: 'unauthorized/secret.txt', passed: true }]
      },
      workerClaims: {
        workerSummary: 'patched unauthorized path'
      }
    };
    manifest.manifestHash = sha256(JSON.stringify(manifest));

    const validation = await validateReviewPatch(manifest, {
      assignment: { id: 'task-scope-violation', allowedPaths: ['src/greeting.txt'] }
    });
    assert.equal(validation.valid, false);
    assert.ok(validation.reason.includes('outside declared allowed paths'), validation.reason);
  }));

  it('9. Validation Rejects Tampered Patch Content and Hash Mismatches', () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    const validManifest = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: 'task-tamper-test',
        allowedPaths: ['src/greeting.txt']
      },
      sourceBaseline: {
        hashes: { 'src/greeting.txt': sha256('hello\n') }
      },
      snapshot: {
        hashes: { 'src/greeting.txt': sha256('valid new content\n') }
      },
      changes: [{
        path: 'src/greeting.txt',
        beforeSha256: sha256('hello\n'),
        afterSha256: sha256('valid new content\n'),
        bytes: Buffer.byteLength('valid new content\n'),
        patchContent: 'valid new content\n'
      }],
      verification: {
        verified: true,
        checks: [{ type: 'equals', path: 'src/greeting.txt', passed: true }]
      },
      workerClaims: { workerSummary: 'Done' }
    };

    // Test 1: Tampered patchContent
    const tampered = structuredClone(validManifest);
    tampered.changes[0].patchContent = 'malicious injection\n';
    tampered.manifestHash = sha256(JSON.stringify(tampered));

    const val1 = await validateReviewPatch(tampered, { sourceRoot });
    assert.equal(val1.valid, false);
    assert.ok(val1.reason.includes('Patch content hash mismatch'), val1.reason);

    // Test 2: Tampered manifestHash
    const tamperedHash = structuredClone(validManifest);
    tamperedHash.manifestHash = '0000000000000000000000000000000000000000000000000000000000000000';
    const val2 = await validateReviewPatch(tamperedHash, { sourceRoot });
    assert.equal(val2.valid, false);
    assert.ok(val2.reason.includes('hash integrity mismatch'), val2.reason);
  }));

  it('10. Validation Rejects Missing or Failed Verification and Rejects Worker Summary Overrides', () => withFixture(async ({ sourceRoot }) => {
    const manifest = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: 'task-fake-worker-claim',
        allowedPaths: ['src/greeting.txt']
      },
      sourceBaseline: {
        hashes: { 'src/greeting.txt': sha256('hello\n') }
      },
      snapshot: {
        hashes: { 'src/greeting.txt': sha256('new content\n') }
      },
      changes: [{
        path: 'src/greeting.txt',
        beforeSha256: sha256('hello\n'),
        afterSha256: sha256('new content\n'),
        bytes: Buffer.byteLength('new content\n'),
        patchContent: 'new content\n'
      }],
      verification: {
        verified: false, // Independent checks failed!
        checks: [{ type: 'equals', path: 'src/greeting.txt', passed: false }]
      },
      workerClaims: {
        workerSummary: 'I swear this task is 100% verified and completely tested' // Worker claims success
      }
    };
    manifest.manifestHash = sha256(JSON.stringify(manifest));

    const val = await validateReviewPatch(manifest, { sourceRoot });
    assert.equal(val.valid, false);
    assert.ok(val.reason.includes('verification: verified is not true'), val.reason);
  }));

  it('11. Validation Rejects Malformed or Oversize Artifacts', () => withFixture(async () => {
    // Null / non-object
    const valNull = await validateReviewPatch(null);
    assert.equal(valNull.valid, false);
    assert.ok(valNull.reason.includes('Malformed manifest'));

    // Unsupported schema version
    const valSchema = await validateReviewPatch({ schemaVersion: 'rct.review_patch.v999' });
    assert.equal(valSchema.valid, false);
    assert.ok(valSchema.reason.includes('Unsupported schemaVersion'));

    // Oversize artifact
    const oversize = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      task: { id: 'huge' },
      blob: 'x'.repeat(1000)
    };
    oversize.manifestHash = sha256(JSON.stringify(oversize));
    const valOversize = await validateReviewPatch(oversize, { maxBytes: 500 });
    assert.equal(valOversize.valid, false);
    assert.ok(valOversize.reason.includes('Oversize review patch artifact'));
  }));

  it('12. Blocker 1 Probe: Self-hashed forged checks + wrong assignmentHash are rejected; self-digest proves integrity only without trusted verifier', () => withFixture(async ({ sourceRoot }) => {
    const initialSourceContent = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8');
    const initialSourceSha = sha256(initialSourceContent);
    const patchedSha = sha256('forged content\n');

    // Attacker crafts a forged manifest with fabricated checks, wrong assignmentHash, and valid self-digest
    const forgedManifest = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: 'task-real-1',
        assignmentHash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', // forged wrong assignmentHash!
        objective: 'Malicious update',
        allowedPaths: ['src/greeting.txt']
      },
      sourceBaseline: {
        hashes: { 'src/greeting.txt': initialSourceSha }
      },
      snapshot: {
        hashes: { 'src/greeting.txt': patchedSha }
      },
      changes: [{
        path: 'src/greeting.txt',
        beforeSha256: initialSourceSha,
        afterSha256: patchedSha,
        bytes: Buffer.byteLength('forged content\n'),
        patchContent: 'forged content\n'
      }],
      verification: {
        verified: true, // Forged self-reported verified!
        checks: [{
          type: 'equals',
          path: 'src/greeting.txt',
          passed: true, // Forged check!
          sha256: patchedSha,
          expectedBytes: Buffer.byteLength('forged content\n'),
          actualBytes: Buffer.byteLength('forged content\n')
        }]
      },
      workerClaims: {
        workerSummary: 'Forged completion claiming verified success',
        completionSource: 'forged_worker'
      },
      usage: { wallTimeMs: 10, requests: 1, totalTokens: 50, toolCalls: 1 }
    };
    forgedManifest.manifestHash = sha256(JSON.stringify(forgedManifest));

    // Probe 1: Expected assignment with real assignmentHash strictly rejects forged wrongassignmentHash
    const expectedAssignment = {
      id: 'task-real-1',
      assignmentHash: '1111111111111111111111111111111111111111111111111111111111111111',
      allowedPaths: ['src/greeting.txt']
    };
    const valExpected = await validateReviewPatch(forgedManifest, {
      sourceRoot,
      assignment: expectedAssignment
    });
    assert.equal(valExpected.valid, false);
    assert.equal(valExpected.verified, false);
    assert.ok(valExpected.reason.includes('Assignment hash mismatch'), valExpected.reason);

    // Probe 2: Expected assignmentHash option strictly rejects forged wrongassignmentHash
    const valByOption = await validateReviewPatch(forgedManifest, {
      sourceRoot,
      expectedAssignmentHash: '1111111111111111111111111111111111111111111111111111111111111111'
    });
    assert.equal(valByOption.valid, false);
    assert.equal(valByOption.verified, false);
    assert.ok(valByOption.reason.includes('Assignment hash mismatch'), valByOption.reason);

    // Probe 3: Self-digest integrity only: without trusted verifier/evidence, verified is strictly false
    const valSelfOnly = await validateReviewPatch(forgedManifest, { sourceRoot });
    assert.equal(valSelfOnly.valid, true);
    assert.equal(valSelfOnly.selfDigestValid, true);
    assert.equal(valSelfOnly.verified, false, 'Self-digest alone must NEVER certify verified: true');

    // Probe 4: requireTrustedVerifier strictly rejects self-claimed verification
    const valRequireTrusted = await validateReviewPatch(forgedManifest, {
      sourceRoot,
      requireTrustedVerifier: true
    });
    assert.equal(valRequireTrusted.valid, false);
    assert.equal(valRequireTrusted.verified, false);
    assert.ok(valRequireTrusted.reason.includes('Trusted verifier') && valRequireTrusted.reason.includes('required'), valRequireTrusted.reason);

    // Probe 5: Source remains completely untouched (no source apply)
    const sourceContentAfter = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8');
    assert.equal(sourceContentAfter, initialSourceContent);
  }));

  it('13. Trusted Verifier & Injected Evidence Interface (AGR-3 Coordination)', () => withFixture(async ({ sourceRoot }) => {
    const initialSourceContent = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8');
    const initialSourceSha = sha256(initialSourceContent);
    const patchedContent = 'verified by supervisor\n';
    const patchedSha = sha256(patchedContent);
    const realAssignmentHash = sha256('canonical-assignment-task-agr3');

    const manifest = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: 'task-agr3-verify',
        assignmentHash: realAssignmentHash,
        objective: 'Coordinate trusted evidence',
        allowedPaths: ['src/greeting.txt']
      },
      sourceBaseline: {
        hashes: { 'src/greeting.txt': initialSourceSha }
      },
      snapshot: {
        hashes: { 'src/greeting.txt': patchedSha }
      },
      changes: [{
        path: 'src/greeting.txt',
        beforeSha256: initialSourceSha,
        afterSha256: patchedSha,
        bytes: Buffer.byteLength(patchedContent),
        patchContent: patchedContent
      }],
      verification: {
        verified: true,
        checks: [{
          name: 'check-greeting-exact',
          type: 'equals',
          path: 'src/greeting.txt',
          passed: true,
          sha256: patchedSha
        }]
      },
      workerClaims: { workerSummary: 'Completed' },
      usage: { wallTimeMs: 50, requests: 2, totalTokens: 100, toolCalls: 2 }
    };
    manifest.manifestHash = sha256(JSON.stringify(manifest));

    // Case A: Valid trusted evidence matching exact taskId, assignmentHash, snapshotHashes, checkIds
    const validEvidence = {
      taskId: 'task-agr3-verify',
      assignmentHash: realAssignmentHash,
      snapshotHashes: { 'src/greeting.txt': patchedSha },
      checkIds: ['check-greeting-exact'],
      verified: true
    };
    const valA = await validateReviewPatch(manifest, { sourceRoot, trustedEvidence: validEvidence });
    assert.equal(valA.valid, true);
    assert.equal(valA.verified, true);

    // Case B: Injected evidence taskId mismatch
    const badTaskEvidence = { ...validEvidence, taskId: 'wrong-task-id' };
    const valB = await validateReviewPatch(manifest, { sourceRoot, trustedEvidence: badTaskEvidence });
    assert.equal(valB.valid, false);
    assert.equal(valB.verified, false);
    assert.ok(valB.reason.includes('taskId mismatch'), valB.reason);

    // Case C: Injected evidence assignmentHash mismatch
    const badHashEvidence = { ...validEvidence, assignmentHash: 'wrong-assignment-hash' };
    const valC = await validateReviewPatch(manifest, { sourceRoot, trustedEvidence: badHashEvidence });
    assert.equal(valC.valid, false);
    assert.equal(valC.verified, false);
    assert.ok(valC.reason.includes('assignmentHash mismatch'), valC.reason);

    // Case D: Injected evidence snapshotHashes mismatch
    const badSnapEvidence = { ...validEvidence, snapshotHashes: { 'src/greeting.txt': 'wrong-sha' } };
    const valD = await validateReviewPatch(manifest, { sourceRoot, trustedEvidence: badSnapEvidence });
    assert.equal(valD.valid, false);
    assert.equal(valD.verified, false);
    assert.ok(valD.reason.includes('snapshotHash mismatch'), valD.reason);

    // Case E: Injected evidence unverified checkIds
    const badCheckEvidence = { ...validEvidence, checkIds: ['non-existent-check-id'] };
    const valE = await validateReviewPatch(manifest, { sourceRoot, trustedEvidence: badCheckEvidence });
    assert.equal(valE.valid, false);
    assert.equal(valE.verified, false);
    assert.ok(valE.reason.includes('missing checkId') || valE.reason.includes('not verified'), valE.reason);

    // Case F: Injected evidence verified: false
    const unverifiedEvidence = { ...validEvidence, verified: false };
    const valF = await validateReviewPatch(manifest, { sourceRoot, trustedEvidence: unverifiedEvidence });
    assert.equal(valF.valid, false);
    assert.equal(valF.verified, false);

    // Case G: Injected trustedVerifier contract function
    let verifierCalled = false;
    const trustedVerifier = async (m) => {
      verifierCalled = true;
      assert.equal(m.task.id, 'task-agr3-verify');
      return { verified: true };
    };
    const valG = await validateReviewPatch(manifest, { sourceRoot, trustedVerifier });
    assert.equal(valG.valid, true);
    assert.equal(valG.verified, true);
    assert.equal(verifierCalled, true);
  }));

  it('14. Blocker 2 Probe: Empty allowedPaths [] permits no changes (deny empty)', () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    // Probe 1: exportReviewPatch with empty allowedPaths [] returns null
    const exportedWithEmpty = await exportReviewPatch({
      assignment: { id: 'task-empty-scope', allowedPaths: [] }, // empty!
      receipt: {
        id: 'task-empty-scope',
        state: 'review_ready',
        diffOutcome: 'applied',
        changedPaths: ['src/greeting.txt'],
        metrics: { verified: true, checkRuns: 1 },
        checks: [{ type: 'equals', path: 'src/greeting.txt', passed: true, sha256: sha256('new') }],
        patches: [{ path: 'src/greeting.txt', before: sha256('hello\n'), after: sha256('new'), applied: true }]
      },
      sourceRoot,
      snapshotRoot
    });
    assert.equal(exportedWithEmpty, null, 'exportReviewPatch must return null on empty allowedPaths []');

    // Probe 2: validateReviewPatch with empty allowedPaths [] strictly rejects any change
    const manifestEmptyScope = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: 'task-empty-scope',
        allowedPaths: [] // empty!
      },
      sourceBaseline: { hashes: { 'src/greeting.txt': sha256('hello\n') } },
      snapshot: { hashes: { 'src/greeting.txt': sha256('new\n') } },
      changes: [{
        path: 'src/greeting.txt',
        beforeSha256: sha256('hello\n'),
        afterSha256: sha256('new\n'),
        bytes: 4,
        patchContent: 'new\n'
      }],
      verification: {
        verified: true,
        checks: [{ type: 'equals', path: 'src/greeting.txt', passed: true }]
      },
      workerClaims: { workerSummary: 'Done' }
    };
    manifestEmptyScope.manifestHash = sha256(JSON.stringify(manifestEmptyScope));

    const valEmpty = await validateReviewPatch(manifestEmptyScope, { sourceRoot });
    assert.equal(valEmpty.valid, false);
    assert.ok(valEmpty.reason.includes('empty scope permits no changes'), valEmpty.reason);
  }));

  it("15. Blocker 3 Probe: Out-of-scope export rejected & string 'false' / non-boolean never coerced to true", () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    // Probe 1: exportReviewPatch rejects changed path outside declared safe paths
    const exportOutOfScope = await exportReviewPatch({
      assignment: { id: 'task-safe', allowedPaths: ['src/greeting.txt'] },
      receipt: {
        id: 'task-safe',
        state: 'review_ready',
        diffOutcome: 'applied',
        changedPaths: ['etc/passwd'], // out of scope!
        metrics: { verified: true, checkRuns: 1 },
        checks: [{ type: 'equals', path: 'etc/passwd', passed: true, sha256: sha256('bad') }],
        patches: [{ path: 'etc/passwd', before: sha256('old'), after: sha256('bad'), applied: true }]
      },
      sourceRoot,
      snapshotRoot
    });
    assert.equal(exportOutOfScope, null, 'exportReviewPatch must return null for out-of-scope changedPaths');

    // Probe 2: exportReviewPatch rejects checks with string 'false' (never coerced to true)
    const exportCoercedFalse = await exportReviewPatch({
      assignment: { id: 'task-safe', allowedPaths: ['src/greeting.txt'] },
      receipt: {
        id: 'task-safe',
        state: 'review_ready',
        diffOutcome: 'applied',
        changedPaths: ['src/greeting.txt'],
        metrics: { verified: true, checkRuns: 1 },
        checks: [{ type: 'equals', path: 'src/greeting.txt', passed: 'false', sha256: sha256('new') }], // string 'false'!
        patches: [{ path: 'src/greeting.txt', before: sha256('hello\n'), after: sha256('new'), applied: true }]
      },
      sourceRoot,
      snapshotRoot
    });
    assert.equal(exportCoercedFalse, null, "exportReviewPatch must reject check with passed: 'false'");

    // Probe 3: exportReviewPatch rejects checks with string 'true' (strict literal boolean required)
    const exportCoercedTrue = await exportReviewPatch({
      assignment: { id: 'task-safe', allowedPaths: ['src/greeting.txt'] },
      receipt: {
        id: 'task-safe',
        state: 'review_ready',
        diffOutcome: 'applied',
        changedPaths: ['src/greeting.txt'],
        metrics: { verified: true, checkRuns: 1 },
        checks: [{ type: 'equals', path: 'src/greeting.txt', passed: 'true', sha256: sha256('new') }], // string 'true'!
        patches: [{ path: 'src/greeting.txt', before: sha256('hello\n'), after: sha256('new'), applied: true }]
      },
      sourceRoot,
      snapshotRoot
    });
    assert.equal(exportCoercedTrue, null, "exportReviewPatch must reject check with non-boolean passed: 'true'");

    // Probe 4: validateReviewPatch strictly rejects manifest check with passed: 'false'
    const manifestStringFalse = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: { id: 'task-safe', allowedPaths: ['src/greeting.txt'] },
      sourceBaseline: { hashes: { 'src/greeting.txt': sha256('hello\n') } },
      snapshot: { hashes: { 'src/greeting.txt': sha256('new\n') } },
      changes: [{
        path: 'src/greeting.txt',
        beforeSha256: sha256('hello\n'),
        afterSha256: sha256('new\n'),
        bytes: 4,
        patchContent: 'new\n'
      }],
      verification: {
        verified: true,
        checks: [{ type: 'equals', path: 'src/greeting.txt', passed: 'false' }] // string 'false'!
      },
      workerClaims: { workerSummary: 'Done' }
    };
    manifestStringFalse.manifestHash = sha256(JSON.stringify(manifestStringFalse));

    const valStrFalse = await validateReviewPatch(manifestStringFalse, { sourceRoot });
    assert.equal(valStrFalse.valid, false);
    assert.ok(valStrFalse.reason.includes('must be literal boolean true'), valStrFalse.reason);
  }));

  it('16. Blocker 4 Probe: Admitted baseline preserved and source drift rejected before export (no silent rebase)', () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    const admittedInitialContent = 'hello\n';
    const admittedInitialSha = sha256(admittedInitialContent);
    const patchedContent = 'hello world\n';
    const patchedSha = sha256(patchedContent);

    // Snapshot is prepared with valid patch
    await writeFile(path.join(snapshotRoot, 'src', 'greeting.txt'), patchedContent);

    const assignment = {
      id: 'task-drift-test',
      allowedPaths: ['src/greeting.txt'],
      scope: {
        sourceHashes: {
          'src/greeting.txt': admittedInitialSha // Admitted baseline hash!
        }
      }
    };

    const receipt = {
      id: 'task-drift-test',
      state: 'review_ready',
      diffOutcome: 'applied',
      changedPaths: ['src/greeting.txt'],
      metrics: { verified: true, checkRuns: 1 },
      checks: [{ type: 'equals', path: 'src/greeting.txt', passed: true, sha256: patchedSha }],
      patches: [{ path: 'src/greeting.txt', before: admittedInitialSha, after: patchedSha, applied: true }]
    };

    // DRIFT INJECTION: source on disk is externally modified before export happens!
    const driftedSourceContent = 'external drift occurred on disk!\n';
    await writeFile(path.join(sourceRoot, 'src', 'greeting.txt'), driftedSourceContent);
    const driftedSourceSha = sha256(driftedSourceContent);

    // Export must detect drift against admitted scope.sourceHashes and REJECT before export!
    // It must NEVER silently rebase beforeSha256 to driftedSourceSha!
    const exportedDrift = await exportReviewPatch({
      assignment,
      receipt,
      sourceRoot,
      snapshotRoot
    });

    assert.equal(exportedDrift, null, 'exportReviewPatch must return null on source drift against admitted baseline (no silent rebase)');

    // Verify sourceRoot on disk was not modified or overwritten by export attempt
    const finalSourceDisk = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8');
    assert.equal(finalSourceDisk, driftedSourceContent, 'Source workspace must not be modified by exporter (zero source apply)');
  }));

  it('17. No Source Apply Invariant: source workspace remains 100% byte-identical across all operations', () => withFixture(async ({ sourceRoot, snapshotRoot }) => {
    const initialGreeting = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'));
    const initialGreetingSha = sha256(initialGreeting);

    // Run valid export
    const assignment = {
      id: 'task-no-source-apply',
      allowedPaths: ['src/greeting.txt'],
      scope: { sourceHashes: { 'src/greeting.txt': initialGreetingSha } }
    };
    await writeFile(path.join(snapshotRoot, 'src', 'greeting.txt'), 'new content for no-apply test\n');
    const newSha = sha256('new content for no-apply test\n');

    const receipt = {
      id: 'task-no-source-apply',
      state: 'review_ready',
      diffOutcome: 'applied',
      changedPaths: ['src/greeting.txt'],
      metrics: { verified: true, checkRuns: 1 },
      checks: [{ type: 'equals', path: 'src/greeting.txt', passed: true, sha256: newSha }],
      patches: [{ path: 'src/greeting.txt', before: initialGreetingSha, after: newSha, applied: true }]
    };

    const manifest = await exportReviewPatch({
      assignment,
      receipt,
      sourceRoot,
      snapshotRoot
    });
    assert.ok(manifest);

    // Validate review patch repeatedly with multiple options
    await validateReviewPatch(manifest, { sourceRoot, assignment });
    await validateReviewPatch(manifest, { sourceRoot });
    await validateReviewPatch(manifest, { sourceRoot, expectedAssignmentHash: manifest.task.assignmentHash });

    // Assert that sourceRoot greeting.txt is still 100% byte-identical
    const postValidationGreeting = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'));
    assert.deepEqual(postValidationGreeting, initialGreeting);
    assert.equal(sha256(postValidationGreeting), initialGreetingSha);
  }));

  it('18. Direct Regression: requireTrustedVerifier true strictly denies declaration fallback, and denies when declared check text differs', () => withFixture(async ({ sourceRoot }) => {
    const initialSourceContent = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8');
    const initialSourceSha = sha256(initialSourceContent);
    const patchedContent = 'hello world\n';
    const patchedSha = sha256(patchedContent);

    const manifest = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: 'task-no-declaration-fallback',
        assignmentHash: sha256('real-task-digest'),
        allowedPaths: ['src/greeting.txt']
      },
      sourceBaseline: { hashes: { 'src/greeting.txt': initialSourceSha } },
      snapshot: { hashes: { 'src/greeting.txt': patchedSha } },
      changes: [{
        path: 'src/greeting.txt',
        beforeSha256: initialSourceSha,
        afterSha256: patchedSha,
        bytes: Buffer.byteLength(patchedContent),
        patchContent: patchedContent
      }],
      verification: {
        verified: true,
        checks: [{
          type: 'equals',
          path: 'src/greeting.txt',
          passed: true,
          sha256: patchedSha,
          expectedBytes: Buffer.byteLength(patchedContent),
          actualBytes: Buffer.byteLength(patchedContent)
        }]
      },
      workerClaims: { workerSummary: 'Done' }
    };
    manifest.manifestHash = sha256(JSON.stringify(manifest));

    // Part A: requireTrustedVerifier: true with assignment declaration alone must DENY (cannot fallback to declaration)
    const valFallbackDenied = await validateReviewPatch(manifest, {
      sourceRoot,
      assignment: {
        id: 'task-no-declaration-fallback',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: patchedContent }]
      },
      requireTrustedVerifier: true
    });
    assert.equal(valFallbackDenied.valid, false);
    assert.equal(valFallbackDenied.verified, false);
    assert.ok(valFallbackDenied.reason.includes('Trusted verifier or complete evidence required'), valFallbackDenied.reason);

    // Part B: Declaration check text mismatch (different expectedtext) must DENY
    const valTextMismatch = await validateReviewPatch(manifest, {
      sourceRoot,
      assignment: {
        id: 'task-no-declaration-fallback',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'completely different expected text\n' }] // different expected text!
      }
    });
    assert.equal(valTextMismatch.valid, false);
    assert.equal(valTextMismatch.verified, false);
    assert.ok(valTextMismatch.reason.includes('expected sha256'), valTextMismatch.reason);
  }));

  it('19. Direct Regression: trustedVerifier async () => ({}) or malformed callback is strictly denied', () => withFixture(async ({ sourceRoot }) => {
    const initialSourceContent = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8');
    const initialSourceSha = sha256(initialSourceContent);
    const patchedContent = 'hello world\n';
    const patchedSha = sha256(patchedContent);

    const manifest = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: 'task-verifier-callback-test',
        assignmentHash: sha256('task-verifier-digest'),
        allowedPaths: ['src/greeting.txt']
      },
      sourceBaseline: { hashes: { 'src/greeting.txt': initialSourceSha } },
      snapshot: { hashes: { 'src/greeting.txt': patchedSha } },
      changes: [{
        path: 'src/greeting.txt',
        beforeSha256: initialSourceSha,
        afterSha256: patchedSha,
        bytes: Buffer.byteLength(patchedContent),
        patchContent: patchedContent
      }],
      verification: {
        verified: true,
        checks: [{ type: 'equals', path: 'src/greeting.txt', passed: true, sha256: patchedSha }]
      },
      workerClaims: { workerSummary: 'Done' }
    };
    manifest.manifestHash = sha256(JSON.stringify(manifest));

    // Case 1: Callback returns empty object async () => ({})
    const valEmptyObj = await validateReviewPatch(manifest, {
      sourceRoot,
      trustedVerifier: async () => ({})
    });
    assert.equal(valEmptyObj.valid, false, 'Empty object from trustedVerifier must be denied');
    assert.equal(valEmptyObj.verified, false);
    assert.ok(valEmptyObj.reason.includes('must be literal boolean true'), valEmptyObj.reason);

    // Case 2: Callback returns null or undefined
    const valNull = await validateReviewPatch(manifest, {
      sourceRoot,
      trustedVerifier: async () => null
    });
    assert.equal(valNull.valid, false);
    assert.equal(valNull.verified, false);
    assert.ok(valNull.reason.includes('empty or malformed result'), valNull.reason);

    // Case 3: Callback returns string { verified: 'true' }
    const valStringTrue = await validateReviewPatch(manifest, {
      sourceRoot,
      trustedVerifier: async () => ({ verified: 'true' })
    });
    assert.equal(valStringTrue.valid, false);
    assert.equal(valStringTrue.verified, false);
    assert.ok(valStringTrue.reason.includes('must be literal boolean true'), valStringTrue.reason);

    // Case 4: Callback throws error
    const valThrows = await validateReviewPatch(manifest, {
      sourceRoot,
      trustedVerifier: async () => { throw new Error('Verifier connection failed'); }
    });
    assert.equal(valThrows.valid, false);
    assert.equal(valThrows.verified, false);
    assert.ok(valThrows.reason.includes('Trusted verifier error'), valThrows.reason);
  }));

  it('20. Direct Regression: trustedEvidence with taskId+verified:true but missing assignmentHash/snapshotHashes/checkIds is strictly denied', () => withFixture(async ({ sourceRoot }) => {
    const initialSourceContent = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8');
    const initialSourceSha = sha256(initialSourceContent);
    const patchedContent = 'hello world\n';
    const patchedSha = sha256(patchedContent);
    const assignHash = sha256('exact-task-assignment-hash');

    const manifest = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: 'task-strict-evidence-check',
        assignmentHash: assignHash,
        allowedPaths: ['src/greeting.txt']
      },
      sourceBaseline: { hashes: { 'src/greeting.txt': initialSourceSha } },
      snapshot: { hashes: { 'src/greeting.txt': patchedSha } },
      changes: [{
        path: 'src/greeting.txt',
        beforeSha256: initialSourceSha,
        afterSha256: patchedSha,
        bytes: Buffer.byteLength(patchedContent),
        patchContent: patchedContent
      }],
      verification: {
        verified: true,
        checks: [{ type: 'equals', path: 'src/greeting.txt', passed: true, sha256: patchedSha }]
      },
      workerClaims: { workerSummary: 'Done' }
    };
    manifest.manifestHash = sha256(JSON.stringify(manifest));

    // Case 1: Incomplete evidence having ONLY taskId + verified: true (missing assignmentHash, snapshotHashes, checkIds)
    const incompleteOnlyTask = {
      taskId: 'task-strict-evidence-check',
      verified: true
    };
    const valIncomplete1 = await validateReviewPatch(manifest, { sourceRoot, trustedEvidence: incompleteOnlyTask });
    assert.equal(valIncomplete1.valid, false, 'Evidence missing assignmentHash must be denied');
    assert.equal(valIncomplete1.verified, false);
    assert.ok(valIncomplete1.reason.includes('missing assignmentHash'), valIncomplete1.reason);

    // Case 2: Evidence missing snapshotHashes
    const incompleteNoSnap = {
      taskId: 'task-strict-evidence-check',
      assignmentHash: assignHash,
      checkIds: ['src/greeting.txt'],
      verified: true
    };
    const valIncomplete2 = await validateReviewPatch(manifest, { sourceRoot, trustedEvidence: incompleteNoSnap });
    assert.equal(valIncomplete2.valid, false, 'Evidence missing snapshotHashes must be denied');
    assert.equal(valIncomplete2.verified, false);
    assert.ok(valIncomplete2.reason.includes('missing snapshotHashes'), valIncomplete2.reason);

    // Case 3: Evidence missing checkIds/checks
    const incompleteNoChecks = {
      taskId: 'task-strict-evidence-check',
      assignmentHash: assignHash,
      snapshotHashes: { 'src/greeting.txt': patchedSha },
      verified: true
    };
    const valIncomplete3 = await validateReviewPatch(manifest, { sourceRoot, trustedEvidence: incompleteNoChecks });
    assert.equal(valIncomplete3.valid, false, 'Evidence missing checkIds/checks must be denied');
    assert.equal(valIncomplete3.verified, false);
    assert.ok(valIncomplete3.reason.includes('missing checkIds or checks'), valIncomplete3.reason);
  }));

  it('21. Complete Trusted Valid Path: literal independent evidence with exact task, assignment digest, snapshot, checkIds, contents, and status verified: true', () => withFixture(async ({ sourceRoot }) => {
    const initialSourceContent = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8');
    const initialSourceSha = sha256(initialSourceContent);
    const patchedContent = 'hello world\n';
    const patchedSha = sha256(patchedContent);
    const assignHash = sha256('complete-trusted-valid-path-assignment');

    const manifest = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: 'task-complete-trusted-path',
        assignmentHash: assignHash,
        allowedPaths: ['src/greeting.txt']
      },
      sourceBaseline: { hashes: { 'src/greeting.txt': initialSourceSha } },
      snapshot: { hashes: { 'src/greeting.txt': patchedSha } },
      changes: [{
        path: 'src/greeting.txt',
        beforeSha256: initialSourceSha,
        afterSha256: patchedSha,
        bytes: Buffer.byteLength(patchedContent),
        patchContent: patchedContent
      }],
      verification: {
        verified: true,
        checks: [{
          name: 'check-greeting-exact',
          type: 'equals',
          path: 'src/greeting.txt',
          passed: true,
          sha256: patchedSha,
          expectedBytes: Buffer.byteLength(patchedContent),
          actualBytes: Buffer.byteLength(patchedContent)
        }]
      },
      workerClaims: { workerSummary: 'Completed verified work' },
      usage: { wallTimeMs: 25, requests: 2, totalTokens: 90, toolCalls: 2 }
    };
    manifest.manifestHash = sha256(JSON.stringify(manifest));

    // Complete literal independent evidence with exact taskId, assignmentHash, snapshotHashes, checks with contents/status
    const completeEvidence = {
      taskId: 'task-complete-trusted-path',
      assignmentHash: assignHash,
      snapshotHashes: { 'src/greeting.txt': patchedSha },
      checkIds: ['check-greeting-exact'],
      checks: [{
        name: 'check-greeting-exact',
        path: 'src/greeting.txt',
        passed: true,
        sha256: patchedSha
      }],
      verified: true
    };

    const val = await validateReviewPatch(manifest, {
      sourceRoot,
      trustedEvidence: completeEvidence,
      requireTrustedVerifier: true
    });

    assert.equal(val.valid, true);
    assert.equal(val.verified, true);
    assert.equal(val.selfDigestValid, true);
    assert.equal(val.taskId, 'task-complete-trusted-path');
    assert.equal(val.assignmentHash, assignHash);
    assert.deepEqual(val.changedPaths, ['src/greeting.txt']);
  }));

  it('22. Exact Evidence Checkset Coverage (W4R3-AGR2): rejects unrelated/extra/missing check evidence, accepts bijective 1-to-1 evidence', () => withFixture(async ({ sourceRoot }) => {
    // Setup file a.txt in source workspace
    const aInitialContent = 'initial content of a\n';
    await writeFile(path.join(sourceRoot, 'a.txt'), aInitialContent);
    const aInitialSha = sha256(aInitialContent);

    const aPatchedContent = 'patched content of a\n';
    const aPatchedSha = sha256(aPatchedContent);
    const assignHash = sha256('checkset-coverage-assignment-digest');

    const manifest = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: 'task-exact-checkset',
        assignmentHash: assignHash,
        allowedPaths: ['a.txt']
      },
      sourceBaseline: { hashes: { 'a.txt': aInitialSha } },
      snapshot: { hashes: { 'a.txt': aPatchedSha } },
      changes: [{
        path: 'a.txt',
        beforeSha256: aInitialSha,
        afterSha256: aPatchedSha,
        bytes: Buffer.byteLength(aPatchedContent),
        patchContent: aPatchedContent
      }],
      verification: {
        verified: true,
        checks: [{
          name: 'check-a',
          type: 'equals',
          path: 'a.txt',
          passed: true,
          sha256: aPatchedSha,
          expectedBytes: Buffer.byteLength(aPatchedContent),
          actualBytes: Buffer.byteLength(aPatchedContent)
        }]
      },
      workerClaims: { workerSummary: 'Done' }
    };
    manifest.manifestHash = sha256(JSON.stringify(manifest));

    // Case 1: Coordinator Actual Fixture:
    // Patch is for a.txt, trustedEvidence has correct task/assignment/snapshot hashes,
    // but checks: [{ name: 'unrelated', path: 'different.txt', passed: true }]
    // MUST BE REJECTED!
    const evidenceUnrelatedCheck = {
      taskId: 'task-exact-checkset',
      assignmentHash: assignHash,
      snapshotHashes: { 'a.txt': aPatchedSha },
      checks: [{ name: 'unrelated', path: 'different.txt', passed: true }],
      verified: true
    };
    const valUnrelated = await validateReviewPatch(manifest, {
      sourceRoot,
      trustedEvidence: evidenceUnrelatedCheck,
      requireTrustedVerifier: true
    });
    assert.equal(valUnrelated.valid, false, 'Evidence with unrelated check path must be denied');
    assert.equal(valUnrelated.verified, false);
    assert.ok(
      valUnrelated.reason.includes('missing coverage') || valUnrelated.reason.includes('unrelated'),
      `Expected missing coverage or unrelated check reason, got: ${valUnrelated.reason}`
    );

    // Case 2: Unrelated check name with omitted path:
    const evidenceUnrelatedNameOnly = {
      taskId: 'task-exact-checkset',
      assignmentHash: assignHash,
      snapshotHashes: { 'a.txt': aPatchedSha },
      checks: [{ name: 'unrelated', passed: true }],
      verified: true
    };
    const valUnrelatedName = await validateReviewPatch(manifest, {
      sourceRoot,
      trustedEvidence: evidenceUnrelatedNameOnly,
      requireTrustedVerifier: true
    });
    assert.equal(valUnrelatedName.valid, false);
    assert.equal(valUnrelatedName.verified, false);

    // Case 3: Extra check in evidence (count mismatch: 2 in evidence vs 1 in manifest):
    const evidenceExtraCheck = {
      taskId: 'task-exact-checkset',
      assignmentHash: assignHash,
      snapshotHashes: { 'a.txt': aPatchedSha },
      checks: [
        { name: 'check-a', path: 'a.txt', passed: true, sha256: aPatchedSha },
        { name: 'check-extra', path: 'extra.txt', passed: true }
      ],
      verified: true
    };
    const valExtra = await validateReviewPatch(manifest, {
      sourceRoot,
      trustedEvidence: evidenceExtraCheck,
      requireTrustedVerifier: true
    });
    assert.equal(valExtra.valid, false, 'Extra check in evidence must be rejected on count mismatch');
    assert.equal(valExtra.verified, false);
    assert.ok(valExtra.reason.includes('count mismatch'), valExtra.reason);

    // Case 4: Evidence missing a check (manifest has 2 checks, evidence provides 1):
    const bInitialContent = 'b initial\n';
    await writeFile(path.join(sourceRoot, 'b.txt'), bInitialContent);
    const bInitialSha = sha256(bInitialContent);
    const bPatchedSha = sha256('b patched\n');

    const manifestTwoChecks = {
      schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
      createdAt: Date.now(),
      task: {
        id: 'task-two-checks',
        assignmentHash: assignHash,
        allowedPaths: ['a.txt', 'b.txt']
      },
      sourceBaseline: { hashes: { 'a.txt': aInitialSha, 'b.txt': bInitialSha } },
      snapshot: { hashes: { 'a.txt': aPatchedSha, 'b.txt': bPatchedSha } },
      changes: [
        { path: 'a.txt', beforeSha256: aInitialSha, afterSha256: aPatchedSha, bytes: Buffer.byteLength(aPatchedContent), patchContent: aPatchedContent },
        { path: 'b.txt', beforeSha256: bInitialSha, afterSha256: bPatchedSha, bytes: Buffer.byteLength('b patched\n'), patchContent: 'b patched\n' }
      ],
      verification: {
        verified: true,
        checks: [
          { name: 'check-a', type: 'equals', path: 'a.txt', passed: true, sha256: aPatchedSha },
          { name: 'check-b', type: 'equals', path: 'b.txt', passed: true, sha256: bPatchedSha }
        ]
      },
      workerClaims: { workerSummary: 'Done' }
    };
    manifestTwoChecks.manifestHash = sha256(JSON.stringify(manifestTwoChecks));

    const evidenceMissingCheck = {
      taskId: 'task-two-checks',
      assignmentHash: assignHash,
      snapshotHashes: { 'a.txt': aPatchedSha, 'b.txt': bPatchedSha },
      checks: [{ name: 'check-a', path: 'a.txt', passed: true, sha256: aPatchedSha }],
      verified: true
    };
    const valMissing = await validateReviewPatch(manifestTwoChecks, {
      sourceRoot,
      trustedEvidence: evidenceMissingCheck,
      requireTrustedVerifier: true
    });
    assert.equal(valMissing.valid, false, 'Missing check in evidence must be rejected on count mismatch');
    assert.equal(valMissing.verified, false);
    assert.ok(valMissing.reason.includes('count mismatch'), valMissing.reason);

    // Case 5: Check status not passed (passed: false):
    const evidenceFailedCheck = {
      taskId: 'task-exact-checkset',
      assignmentHash: assignHash,
      snapshotHashes: { 'a.txt': aPatchedSha },
      checks: [{ name: 'check-a', path: 'a.txt', passed: false, sha256: aPatchedSha }],
      verified: true
    };
    const valFailedCheck = await validateReviewPatch(manifest, {
      sourceRoot,
      trustedEvidence: evidenceFailedCheck,
      requireTrustedVerifier: true
    });
    assert.equal(valFailedCheck.valid, false);
    assert.equal(valFailedCheck.verified, false);
    assert.ok(valFailedCheck.reason.includes('not passed'), valFailedCheck.reason);

    // Case 6: Check sha256 mismatch in evidence:
    const evidenceHashMismatch = {
      taskId: 'task-exact-checkset',
      assignmentHash: assignHash,
      snapshotHashes: { 'a.txt': aPatchedSha },
      checks: [{ name: 'check-a', path: 'a.txt', passed: true, sha256: sha256('tampered-output') }],
      verified: true
    };
    const valHashMismatch = await validateReviewPatch(manifest, {
      sourceRoot,
      trustedEvidence: evidenceHashMismatch,
      requireTrustedVerifier: true
    });
    assert.equal(valHashMismatch.valid, false);
    assert.equal(valHashMismatch.verified, false);
    assert.ok(valHashMismatch.reason.includes('sha256 mismatch'), valHashMismatch.reason);

    // Case 7: Unrelated checkId in checkIds array:
    const evidenceUnrelatedCheckId = {
      taskId: 'task-exact-checkset',
      assignmentHash: assignHash,
      snapshotHashes: { 'a.txt': aPatchedSha },
      checkIds: ['different.txt'],
      verified: true
    };
    const valUnrelatedId = await validateReviewPatch(manifest, {
      sourceRoot,
      trustedEvidence: evidenceUnrelatedCheckId,
      requireTrustedVerifier: true
    });
    assert.equal(valUnrelatedId.valid, false);
    assert.equal(valUnrelatedId.verified, false);

    // Case 8: Bijective doesCheckMatch direct unit validation (no undefined === undefined):
    assert.equal(doesCheckMatch({ path: 'a.txt' }, { path: 'a.txt' }), true);
    assert.equal(doesCheckMatch({ path: 'a.txt' }, { path: 'different.txt' }), false);
    assert.equal(doesCheckMatch({ path: 'a.txt' }, { name: 'unrelated', path: 'different.txt' }), false);
    assert.equal(doesCheckMatch({ name: 'chk' }, { name: 'chk' }), true);
    assert.equal(doesCheckMatch({ id: 'chk' }, { id: 'chk' }), true);
    assert.equal(doesCheckMatch({}, {}), false, 'Empty objects with undefined properties must NEVER match');
    assert.equal(doesCheckMatch({ path: 'a.txt' }, {}), false);
    assert.equal(doesCheckMatch({}, { path: 'a.txt' }), false);

    // Case 9: Complete Valid Path with Exact Bijective Evidence:
    const completeEvidence = {
      taskId: 'task-exact-checkset',
      assignmentHash: assignHash,
      snapshotHashes: { 'a.txt': aPatchedSha },
      checkIds: ['check-a'],
      checks: [{
        name: 'check-a',
        path: 'a.txt',
        passed: true,
        sha256: aPatchedSha,
        expectedBytes: Buffer.byteLength(aPatchedContent),
        actualBytes: Buffer.byteLength(aPatchedContent)
      }],
      verified: true
    };
    const valComplete = await validateReviewPatch(manifest, {
      sourceRoot,
      trustedEvidence: completeEvidence,
      requireTrustedVerifier: true
    });
    assert.equal(valComplete.valid, true);
    assert.equal(valComplete.verified, true);
    assert.equal(valComplete.selfDigestValid, true);
    assert.equal(valComplete.taskId, 'task-exact-checkset');
    assert.equal(valComplete.assignmentHash, assignHash);
    assert.deepEqual(valComplete.changedPaths, ['a.txt']);
  }));
});

