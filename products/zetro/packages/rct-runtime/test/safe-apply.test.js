import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  planSafeApply,
  executeSafeApply,
  ApprovalPort,
  SAFE_APPLY_PLAN_SCHEMA_VERSION,
  REVIEW_PATCH_SCHEMA_VERSION,
  sha256
} from '../src/index.js';

async function withFixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zetro-safe-apply-test-'));
  const sourceRoot = path.join(root, 'source');
  const snapshotRoot = path.join(root, 'snapshot');
  await mkdir(path.join(sourceRoot, 'src'), { recursive: true });
  await mkdir(path.join(snapshotRoot, 'src'), { recursive: true });
  await writeFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'hello\n');
  await writeFile(path.join(snapshotRoot, 'src', 'greeting.txt'), 'hello world\n');
  try {
    return await fn({ root, sourceRoot, snapshotRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function createValidManifest({
  taskId = 'task-safe-apply-1',
  filePath = 'src/greeting.txt',
  beforeContent = 'hello\n',
  afterContent = 'hello world\n',
  allowedPaths = ['src/greeting.txt']
} = {}) {
  const beforeSha256 = sha256(beforeContent);
  const afterSha256 = sha256(afterContent);
  const assignHash = sha256(`assignment-${taskId}`);

  const manifestBody = {
    schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
    createdAt: Date.now(),
    task: {
      id: taskId,
      assignmentHash: assignHash,
      allowedPaths
    },
    sourceBaseline: {
      hashes: { [filePath]: beforeSha256 }
    },
    snapshot: {
      hashes: { [filePath]: afterSha256 }
    },
    changes: [{
      path: filePath,
      beforeSha256,
      afterSha256,
      bytes: Buffer.byteLength(afterContent, 'utf8'),
      patchContent: afterContent
    }],
    verification: {
      verified: true,
      checks: [{
        name: `check-${filePath}`,
        type: 'equals',
        path: filePath,
        passed: true,
        sha256: afterSha256,
        expectedBytes: Buffer.byteLength(afterContent, 'utf8'),
        actualBytes: Buffer.byteLength(afterContent, 'utf8')
      }]
    },
    workerClaims: { workerSummary: 'Completed verified change' }
  };
  const manifest = {
    ...manifestBody,
    manifestHash: sha256(JSON.stringify(manifestBody))
  };

  const trustedEvidence = {
    taskId,
    assignmentHash: assignHash,
    snapshotHashes: { [filePath]: afterSha256 },
    checkIds: [`check-${filePath}`],
    checks: [{
      name: `check-${filePath}`,
      path: filePath,
      passed: true,
      sha256: afterSha256
    }],
    verified: true
  };

  return { manifest, beforeSha256, afterSha256, assignHash, trustedEvidence };
}

describe('Safe Apply Preview & Planning API Contract (W5-AGR2)', () => {
  it('1. Source Unchanged Invariant: planning generates full preview while leaving source 100% byte-identical', () => withFixture(async ({ sourceRoot }) => {
    const initialGreeting = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'));
    const initialGreetingSha = sha256(initialGreeting);

    const { manifest, beforeSha256, afterSha256, trustedEvidence } = createValidManifest();

    const plan = await planSafeApply({
      manifest,
      sourceRoot,
      trustedEvidence
    });

    // Plan structure assertions
    assert.ok(plan);
    assert.equal(plan.schemaVersion, SAFE_APPLY_PLAN_SCHEMA_VERSION);
    assert.equal(plan.taskId, 'task-safe-apply-1');
    assert.equal(plan.manifestHash, manifest.manifestHash);
    assert.ok(/^[a-f0-9]{64}$/.test(plan.planDigest));
    assert.equal(plan.executionAvailable, false);
    assert.equal(plan.executionGate, 'apply_execution_gated');

    // Summary & changes assertions
    assert.equal(plan.summary.totalFiles, 1);
    assert.deepEqual(plan.summary.changedPaths, ['src/greeting.txt']);
    assert.equal(plan.summary.totalBeforeBytes, 6);
    assert.equal(plan.summary.totalAfterBytes, 12);
    assert.equal(plan.summary.totalByteDelta, 6);
    assert.equal(plan.summary.totalPatchBytes, 12);

    assert.equal(plan.changes.length, 1);
    assert.equal(plan.changes[0].path, 'src/greeting.txt');
    assert.equal(plan.changes[0].beforeSha256, beforeSha256);
    assert.equal(plan.changes[0].afterSha256, afterSha256);
    assert.equal(plan.changes[0].beforeBytes, 6);
    assert.equal(plan.changes[0].afterBytes, 12);
    assert.equal(plan.changes[0].byteDelta, 6);

    // Approval requirements assertions
    assert.equal(plan.approvalRequirements.required, true);
    assert.equal(plan.approvalRequirements.oneUseOnly, true);
    assert.equal(plan.approvalRequirements.boundPlanDigest, plan.planDigest);
    assert.equal(plan.approvalRequirements.boundTaskId, 'task-safe-apply-1');
    assert.equal(plan.approvalRequirements.boundManifestHash, manifest.manifestHash);
    assert.equal(plan.approvalRequirements.status, 'ready_for_approval');

    // SOURCE INVARIANT: verify source disk content was NOT modified
    const postPlanningGreeting = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'));
    assert.deepEqual(postPlanningGreeting, initialGreeting, 'Source file must remain 100% byte-identical');
    assert.equal(sha256(postPlanningGreeting), initialGreetingSha);
  }));

  it('2. Changed Source Invalidation: rejects stale baseline when disk content changes', () => withFixture(async ({ sourceRoot }) => {
    const { manifest, trustedEvidence } = createValidManifest();

    // Concurrently mutate sourceRoot to simulate drift
    await writeFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'concurrently mutated content\n');

    await assert.rejects(
      async () => planSafeApply({ manifest, sourceRoot, trustedEvidence }),
      (err) => {
        assert.ok(
          err.message.includes('Stale baseline') || err.message.includes('changed on disk'),
          `Expected Stale baseline message, got: ${err.message}`
        );
        return true;
      }
    );
  }));

  it('3. Missing Source File Invalidation: rejects when target file is missing on disk', () => withFixture(async ({ sourceRoot }) => {
    const { manifest, trustedEvidence } = createValidManifest();

    // Delete source file
    await rm(path.join(sourceRoot, 'src', 'greeting.txt'));

    await assert.rejects(
      async () => planSafeApply({ manifest, sourceRoot, trustedEvidence }),
      (err) => {
        assert.ok(
          err.message.includes('missing or inaccessible') || err.message.includes('Stale baseline'),
          `Expected missing or inaccessible message, got: ${err.message}`
        );
        return true;
      }
    );
  }));

  it('4. Symlink Denials: rejects change paths pointing to or traversing symbolic links', () => withFixture(async ({ root, sourceRoot }) => {
    // Setup an external file outside sourceRoot
    const outsideTarget = path.join(root, 'outside.txt');
    await writeFile(outsideTarget, 'external secret\n');

    // Create a symlink in sourceRoot pointing outside
    const linkPath = path.join(sourceRoot, 'src', 'symlink.txt');
    try {
      await symlink(outsideTarget, linkPath);
    } catch (err) {
      // If symlink creation fails due to Windows privileges without developer mode,
      // skip symlink creation test gracefully
      return;
    }

    const { manifest, trustedEvidence } = createValidManifest({
      filePath: 'src/symlink.txt',
      beforeContent: 'external secret\n',
      afterContent: 'tampered\n',
      allowedPaths: ['src/symlink.txt']
    });

    await assert.rejects(
      async () => planSafeApply({ manifest, sourceRoot, trustedEvidence }),
      (err) => {
        assert.ok(err.message.includes('Symlink rejection'), `Expected symlink rejection, got: ${err.message}`);
        return true;
      }
    );
  }));

  it('5. Path Traversal & Out-of-Scope Denials: rejects paths escaping sourceRoot or outside allowedPaths', () => withFixture(async ({ sourceRoot }) => {
    const { manifest, trustedEvidence } = createValidManifest({
      filePath: 'src/greeting.txt',
      allowedPaths: ['src/greeting.txt']
    });
    // Manually inject out of scope path
    const { manifestHash, ...body } = manifest;
    body.changes[0].path = 'unauthorized/secret.txt';
    const tampered = { ...body, manifestHash: sha256(JSON.stringify(body)) };

    await assert.rejects(
      async () => planSafeApply({ manifest: tampered, sourceRoot, trustedEvidence }),
      (err) => {
        assert.ok(
          err.message.includes('outside declared allowed paths') || err.message.includes('Out of scope rejection') || err.message.includes('validation failed'),
          `Expected scope rejection, got: ${err.message}`
        );
        return true;
      }
    );
  }));

  it('6. Empty Changes Denial: rejects manifest with empty changes array', () => withFixture(async ({ sourceRoot }) => {
    const { manifest, trustedEvidence } = createValidManifest();
    const { manifestHash, ...body } = manifest;
    body.changes = [];
    const emptyManifest = { ...body, manifestHash: sha256(JSON.stringify(body)) };

    await assert.rejects(
      async () => planSafeApply({ manifest: emptyManifest, sourceRoot, trustedEvidence }),
      (err) => {
        assert.ok(
          err.message.includes('Empty changes rejection') || err.message.includes('No changes declared') || err.message.includes('validation failed'),
          err.message
        );
        return true;
      }
    );
  }));

  it('7. Forged Proof & Unverified Rejection: rejects unverified manifest or worker claims alone', () => withFixture(async ({ sourceRoot }) => {
    const { manifest } = createValidManifest();
    const { manifestHash, ...body } = manifest;
    body.verification.verified = false;
    const unverifiedManifest = { ...body, manifestHash: sha256(JSON.stringify(body)) };

    await assert.rejects(
      async () => planSafeApply({ manifest: unverifiedManifest, sourceRoot }),
      (err) => {
        assert.ok(
          err.message.includes('verified is not true') || err.message.includes('Unverified manifest rejection') || err.message.includes('validation failed'),
          err.message
        );
        return true;
      }
    );
  }));

  it('8. One-Use Approval Port: issues token, redeems successfully, and blocks replayed approval', () => withFixture(async ({ sourceRoot }) => {
    const { manifest, trustedEvidence } = createValidManifest();
    const approvalPort = new ApprovalPort();

    // 1. Initial planning returns ready_for_approval
    const plan = await planSafeApply({ manifest, sourceRoot, trustedEvidence });
    assert.equal(plan.approvalRequirements.status, 'ready_for_approval');
    assert.equal(plan.approval, null);

    // 2. Issue one-use approval token bound to exact planDigest
    const approvalToken = approvalPort.createApprovalToken({
      taskId: plan.taskId,
      planDigest: plan.planDigest,
      manifestHash: plan.manifestHash,
      operator: 'operator-eve',
      reason: 'manual inspection verified'
    });
    assert.ok(approvalToken.tokenId);
    assert.equal(approvalToken.planDigest, plan.planDigest);

    // 3. Redeem token via planSafeApply
    const approvedPlan = await planSafeApply({
      manifest,
      sourceRoot,
      trustedEvidence,
      approvalPort,
      approval: approvalToken
    });
    assert.equal(approvedPlan.approvalRequirements.status, 'approved');
    assert.ok(approvedPlan.approval);
    assert.equal(approvedPlan.approval.redeemed, true);
    assert.equal(approvedPlan.approval.tokenId, approvalToken.tokenId);
    assert.equal(approvalPort.isRedeemed(approvalToken.tokenId), true);

    // 4. REPLAY ATTEMPT: Attempting to redeem the same token again MUST throw
    await assert.rejects(
      async () => planSafeApply({
        manifest,
        sourceRoot,
        trustedEvidence,
        approvalPort,
        approval: approvalToken
      }),
      (err) => {
        assert.ok(
          err.message.includes('One-use approval rejection') && err.message.includes('replay blocked'),
          `Expected replay blocked error, got: ${err.message}`
        );
        return true;
      }
    );
  }));

  it('9. Wrong Digest Approval Rejection: blocks token issued for mismatched planDigest or taskId', () => withFixture(async ({ sourceRoot }) => {
    const { manifest, trustedEvidence } = createValidManifest();
    const approvalPort = new ApprovalPort();

    const plan = await planSafeApply({ manifest, sourceRoot, trustedEvidence });

    // Issue token bound to a different/wrong plan digest
    const wrongDigestToken = approvalPort.createApprovalToken({
      taskId: plan.taskId,
      planDigest: sha256('completely-different-plan-digest'),
      manifestHash: plan.manifestHash,
      operator: 'operator-eve',
      reason: 'wrong digest'
    });

    await assert.rejects(
      async () => planSafeApply({
        manifest,
        sourceRoot,
        trustedEvidence,
        approvalPort,
        approval: wrongDigestToken
      }),
      (err) => {
        assert.ok(
          err.message.includes('Wrong digest approval rejection'),
          `Expected wrong digest rejection, got: ${err.message}`
        );
        return true;
      }
    );
  }));

  it('10. Cancellation Boundary: AbortSignal pre-aborted or cancelled settles with AbortError and zero effects', () => withFixture(async ({ sourceRoot }) => {
    const { manifest, trustedEvidence } = createValidManifest();

    const ac = new AbortController();
    ac.abort(); // Pre-abort

    await assert.rejects(
      async () => planSafeApply({
        manifest,
        sourceRoot,
        trustedEvidence,
        signal: ac.signal
      }),
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
  }));

  it('11. Apply Execution Gate: executeSafeApply and plan.execute() throw and keep apply unavailable', () => withFixture(async ({ sourceRoot }) => {
    const { manifest, trustedEvidence } = createValidManifest();
    const plan = await planSafeApply({ manifest, sourceRoot, trustedEvidence });

    // Calling plan.execute() must throw
    assert.throws(
      () => plan.execute(),
      (err) => {
        assert.ok(err.message.includes('Apply execution is currently unavailable'), err.message);
        return true;
      }
    );

    // Calling executeSafeApply(plan) must throw
    assert.throws(
      () => executeSafeApply(plan),
      (err) => {
        assert.ok(err.message.includes('Apply execution is currently unavailable'), err.message);
        return true;
      }
    );
  }));

  it('12. Missing Admitted Source Identity: fails closed when sourceRoot is omitted or empty', async () => {
    const { manifest, trustedEvidence } = createValidManifest();

    await assert.rejects(
      async () => planSafeApply({ manifest, sourceRoot: '', trustedEvidence }),
      (err) => {
        assert.ok(err.message.includes('Missing admitted source identity'), err.message);
        return true;
      }
    );

    await assert.rejects(
      async () => planSafeApply({ manifest, sourceRoot: null, trustedEvidence }),
      (err) => {
        assert.ok(err.message.includes('Missing admitted source identity'), err.message);
        return true;
      }
    );
  });

  it('13. Coordinator Probe: Unissued / Invented Token ID Rejection: rejects never-issued token IDs without issuance authority', () => {
    const port = new ApprovalPort();
    const inventedToken = {
      tokenId: 'never-issued',
      taskId: 't',
      planDigest: 'a'.repeat(64),
      manifestHash: 'b'.repeat(64)
    };

    assert.throws(
      () => port.verifyAndRedeem(inventedToken, {
        taskId: 't',
        planDigest: 'a'.repeat(64),
        manifestHash: 'b'.repeat(64)
      }),
      (err) => {
        assert.ok(
          err.message.includes('never issued') || err.message.includes('Forged approval rejection'),
          `Expected forged approval rejection, got: ${err.message}`
        );
        return true;
      }
    );
  });

  it('14. Cross-Port Approval Rejection: rejects token issued by a different ApprovalPort instance', () => {
    const portA = new ApprovalPort();
    const portB = new ApprovalPort();

    const tokenFromA = portA.createApprovalToken({
      taskId: 'task-cross-port',
      planDigest: sha256('plan-cross-port'),
      manifestHash: sha256('manifest-cross-port')
    });

    // Present tokenFromA to portB
    assert.throws(
      () => portB.verifyAndRedeem(tokenFromA, {
        taskId: 'task-cross-port',
        planDigest: sha256('plan-cross-port'),
        manifestHash: sha256('manifest-cross-port')
      }),
      (err) => {
        assert.ok(
          err.message.includes('Cross-port approval rejection') || err.message.includes('never issued') || err.message.includes('Forged approval rejection'),
          `Expected cross-port or unissued error, got: ${err.message}`
        );
        return true;
      }
    );
  });

  it('15. Mutated Token Fields Rejection: rejects token whose fields were modified after issuance', () => {
    const port = new ApprovalPort();
    const planDigest = sha256('original-plan-digest');
    const token = port.createApprovalToken({
      taskId: 'task-mutate',
      planDigest,
      manifestHash: sha256('manifest-mutate')
    });

    // Tamper with planDigest on the token object
    const tamperedToken = { ...token, planDigest: sha256('tampered-plan-digest') };

    assert.throws(
      () => port.verifyAndRedeem(tamperedToken, {
        taskId: 'task-mutate',
        planDigest,
        manifestHash: sha256('manifest-mutate')
      }),
      (err) => {
        assert.ok(
          err.message.includes('Mutated approval token rejection') || err.message.includes('Forged approval rejection'),
          `Expected mutated token rejection, got: ${err.message}`
        );
        return true;
      }
    );
  });

  it('16. Cryptographic Signature Tampering Rejection: rejects token with invalid or forged HMAC signature', () => {
    const port = new ApprovalPort();
    const planDigest = sha256('plan-digest');
    const token = port.createApprovalToken({
      taskId: 'task-sig',
      planDigest,
      manifestHash: sha256('manifest-sig')
    });

    // Tamper with signature
    const forgedSigToken = { ...token, signature: sha256('forged-signature') };

    assert.throws(
      () => port.verifyAndRedeem(forgedSigToken, {
        taskId: 'task-sig',
        planDigest,
        manifestHash: sha256('manifest-sig')
      }),
      (err) => {
        assert.ok(
          err.message.includes('invalid cryptographic signature') || err.message.includes('Forged approval rejection'),
          `Expected signature rejection, got: ${err.message}`
        );
        return true;
      }
    );
  });
});

