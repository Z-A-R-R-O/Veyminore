import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTaskResult,
  isTaskResult,
  ValidationError,
  SCHEMA_VERSIONS,
  TaskState,
  VerificationStatus,
  WorkerReportedState
} from '../src/index.js';

describe('TaskResult Schema & False Verification Rejection', () => {
  const validCompletedResult = {
    schemaVersion: SCHEMA_VERSIONS.TASK_RESULT,
    taskId: 'task-101',
    attemptId: 1,
    agentId: 'AGR-1',
    status: TaskState.COMPLETED,
    workerClaim: {
      reportedState: WorkerReportedState.SUBMITTED,
      summary: 'Task completed successfully with tests passing',
      proposedPatches: [
        {
          path: 'packages/protocol/src/index.js',
          beforeHash: 'a'.repeat(64),
          afterHash: 'b'.repeat(64),
          bytesChanged: 120
        }
      ]
    },
    effects: {
      applied: true,
      changedFiles: ['packages/protocol/src/index.js'],
      patchHashes: ['b'.repeat(64)],
      diffSummary: '+120 bytes'
    },
    verification: {
      verified: true,
      status: VerificationStatus.PASSED,
      verifierId: 'coordinator_verifier',
      checkResults: [
        {
          checkId: 'check-1',
          path: 'packages/protocol/src/index.js',
          passed: true,
          details: { exitCode: 0 }
        }
      ]
    },
    uncertainty: {
      isUncertain: false,
      reasons: [],
      unconfirmedAttempts: 0
    },
    usage: {
      inputTokens: 1200,
      outputTokens: 400
    },
    completedAt: Date.now()
  };

  it('validates a verified completed TaskResult', () => {
    const res = validateTaskResult(validCompletedResult);
    assert.equal(res.status, TaskState.COMPLETED);
    assert.equal(res.verification.verified, true);
    assert.equal(isTaskResult(validCompletedResult), true);
  });

  it('rejects completed status when verification.verified is false', () => {
    assert.throws(
      () => validateTaskResult({
        ...validCompletedResult,
        status: TaskState.COMPLETED,
        verification: {
          ...validCompletedResult.verification,
          verified: false
        }
      }),
      (err) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('verification.verified is false'));
        return true;
      }
    );
  });

  it('rejects completed status when verification.status is not passed', () => {
    assert.throws(
      () => validateTaskResult({
        ...validCompletedResult,
        status: TaskState.COMPLETED,
        verification: {
          ...validCompletedResult.verification,
          status: VerificationStatus.IN_PROGRESS
        }
      }),
      ValidationError
    );
  });

  it('rejects completed status when any checkResult has failed', () => {
    assert.throws(
      () => validateTaskResult({
        ...validCompletedResult,
        status: TaskState.COMPLETED,
        verification: {
          ...validCompletedResult.verification,
          checkResults: [
            { checkId: 'c1', passed: true },
            { checkId: 'c2', passed: false }
          ]
        }
      }),
      (err) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('one or more verification checks failed'));
        return true;
      }
    );
  });

  it('rejects completed status when checkResults is empty', () => {
    assert.throws(
      () => validateTaskResult({
        ...validCompletedResult,
        status: TaskState.COMPLETED,
        verification: {
          ...validCompletedResult.verification,
          checkResults: []
        }
      }),
      ValidationError
    );
  });

  it('rejects worker claim alone fabricating completed status', () => {
    // Worker reports submitted and effects applied, but verification is not_requested
    assert.throws(
      () => validateTaskResult({
        ...validCompletedResult,
        status: TaskState.COMPLETED,
        workerClaim: {
          reportedState: WorkerReportedState.SUBMITTED,
          summary: 'Worker says: I succeeded 100%!',
          proposedPatches: []
        },
        effects: {
          applied: true,
          changedFiles: ['packages/protocol/src/index.js'],
          patchHashes: ['b'.repeat(64)]
        },
        verification: {
          verified: false,
          status: VerificationStatus.NOT_REQUESTED,
          verifierId: 'none',
          checkResults: []
        }
      }),
      ValidationError
    );
  });

  it('rejects completed status while uncertainty.isUncertain is true', () => {
    assert.throws(
      () => validateTaskResult({
        ...validCompletedResult,
        status: TaskState.COMPLETED,
        uncertainty: {
          isUncertain: true,
          reasons: ['network_timeout_after_submission'],
          unconfirmedAttempts: 1
        }
      }),
      (err) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('uncertainty.isUncertain is true'));
        return true;
      }
    );
  });

  it('requires uncertainty reason when status is unknown', () => {
    assert.throws(
      () => validateTaskResult({
        ...validCompletedResult,
        status: TaskState.UNKNOWN,
        uncertainty: {
          isUncertain: false,
          reasons: []
        }
      }),
      (err) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes("requires uncertainty.isUncertain to be true"));
        return true;
      }
    );
  });

  it('accepts valid unknown status with documented uncertainty', () => {
    const unknownResult = {
      ...validCompletedResult,
      status: TaskState.UNKNOWN,
      verification: {
        verified: false,
        status: VerificationStatus.INCONCLUSIVE,
        verifierId: 'coordinator',
        checkResults: []
      },
      uncertainty: {
        isUncertain: true,
        reasons: ['transport_timeout_waiting_for_agent'],
        unconfirmedAttempts: 1
      }
    };
    const res = validateTaskResult(unknownResult);
    assert.equal(res.status, TaskState.UNKNOWN);
    assert.equal(res.uncertainty.isUncertain, true);
  });

  it('accepts valid failed status when checks failed', () => {
    const failedResult = {
      ...validCompletedResult,
      status: TaskState.FAILED,
      verification: {
        verified: false,
        status: VerificationStatus.FAILED,
        verifierId: 'coordinator',
        checkResults: [
          { checkId: 'c1', passed: false, details: { stderr: 'AssertionError' } }
        ]
      }
    };
    const res = validateTaskResult(failedResult);
    assert.equal(res.status, TaskState.FAILED);
    assert.equal(res.verification.verified, false);
  });

  it('rejects missing or malformed attemptId', () => {
    assert.throws(
      () => validateTaskResult({
        ...validCompletedResult,
        attemptId: undefined
      }),
      ValidationError
    );
    assert.throws(
      () => validateTaskResult({
        ...validCompletedResult,
        attemptId: 'bad attempt id with spaces'
      }),
      ValidationError
    );
  });
});
