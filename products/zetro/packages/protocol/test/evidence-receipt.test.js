import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateEvidenceReceipt,
  isEvidenceReceipt,
  computeEvidenceReceiptDigest,
  ValidationError,
  SCHEMA_VERSIONS
} from '../src/index.js';

describe('EvidenceReceipt Schema & Digest Verification', () => {
  const validReceipt = {
    schemaVersion: SCHEMA_VERSIONS.EVIDENCE_RECEIPT,
    receiptId: 'rcpt-101',
    taskId: 'task-101',
    attemptId: 1,
    agentId: 'AGR-1',
    sourceBaseline: {
      sourceRoot: 'E:/Veyminore/products/zetro',
      commit: '90db896ea4efd67cb7eb086fcf81b35a1e5e1291',
      initialHashes: {
        'packages/protocol/src/index.js': 'a'.repeat(64)
      }
    },
    effects: {
      changedFiles: ['packages/protocol/src/index.js'],
      finalHashes: {
        'packages/protocol/src/index.js': 'b'.repeat(64)
      },
      diffDigest: 'd'.repeat(64)
    },
    verification: {
      verified: true,
      verifier: 'coordinator_verifier',
      checksPassed: 2,
      checksFailed: 0,
      checkDetails: [
        { checkId: 'node-test', passed: true },
        { checkId: 'lint-check', passed: true }
      ]
    },
    artifactRefs: [
      {
        path: 'artifacts/test-report.json',
        sha256: 'f'.repeat(64),
        byteLength: 2048,
        mimeType: 'application/json'
      }
    ],
    uncertainty: {
      isUncertain: false,
      reasons: []
    },
    createdAt: Date.now()
  };

  it('validates a well-formed EvidenceReceipt and attaches canonical receiptDigest', () => {
    const res = validateEvidenceReceipt(validReceipt);
    assert.equal(res.receiptId, 'rcpt-101');
    assert.equal(res.receiptDigest.length, 64);
    assert.equal(isEvidenceReceipt(validReceipt), true);
  });

  it('rejects verified=true when checksPassed is 0', () => {
    assert.throws(
      () => validateEvidenceReceipt({
        ...validReceipt,
        verification: {
          ...validReceipt.verification,
          verified: true,
          checksPassed: 0
        }
      }),
      (err) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('checksPassed === 0'));
        return true;
      }
    );
  });

  it('rejects verified=true when checksFailed > 0', () => {
    assert.throws(
      () => validateEvidenceReceipt({
        ...validReceipt,
        verification: {
          ...validReceipt.verification,
          verified: true,
          checksPassed: 2,
          checksFailed: 1
        }
      }),
      (err) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('checksFailed > 0'));
        return true;
      }
    );
  });

  it('verifies receiptDigest and detects tampering when verifyDigest=true', () => {
    const validated = validateEvidenceReceipt(validReceipt);
    const expectedDigest = validated.receiptDigest;

    // Tamper with changed files
    const tampered = {
      ...validated,
      effects: {
        ...validated.effects,
        changedFiles: ['packages/protocol/src/tampered.js']
      }
    };

    assert.throws(
      () => validateEvidenceReceipt(tampered, { verifyDigest: true }),
      (err) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('receiptDigest mismatch'));
        return true;
      }
    );
  });
});
