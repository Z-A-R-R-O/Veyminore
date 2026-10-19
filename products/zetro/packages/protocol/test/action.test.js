import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createActionRequest,
  validateActionRequest,
  isActionRequest,
  validateActionResult,
  isActionResult,
  ValidationError,
  SCHEMA_VERSIONS,
  ActionType,
  ActionStatus
} from '../src/index.js';

describe('ActionRequest and ActionResult', () => {
  it('creates and validates an ActionRequest with automatic requestDigest', () => {
    const req = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-xyz',
      actionType: ActionType.FILE_WRITE,
      parameters: {
        path: 'packages/protocol/src/index.js',
        content: 'hello world'
      }
    });

    assert.equal(req.schemaVersion, SCHEMA_VERSIONS.ACTION_REQUEST);
    assert.equal(req.actionType, ActionType.FILE_WRITE);
    assert.equal(req.parameters.path, 'packages/protocol/src/index.js');
    assert.equal(req.requestDigest.length, 64);
    assert.equal(isActionRequest(req), true);
  });

  it('rejects file action with invalid or traversal path', () => {
    assert.throws(
      () => createActionRequest({
        taskId: 'task-101',
        attemptId: 1,
        principalId: 'worker-1',
        actionType: ActionType.FILE_READ,
        parameters: { path: '../escape.js' }
      }),
      ValidationError
    );
  });

  it('rejects shell_exec with bare string command instead of array', () => {
    assert.throws(
      () => createActionRequest({
        taskId: 'task-101',
        attemptId: 1,
        principalId: 'worker-1',
        actionType: ActionType.SHELL_EXEC,
        parameters: { command: 'rm -rf /' }
      }),
      (err) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('parameters.command to be an array'));
        return true;
      }
    );
  });

  it('detects parameter tampering via requestDigest mismatch when verifyDigest=true', () => {
    const req = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      actionType: ActionType.FILE_WRITE,
      parameters: {
        path: 'safe/file.txt',
        content: 'original content'
      }
    });

    // Tamper with the parameters without updating requestDigest
    const tampered = {
      ...req,
      parameters: {
        path: 'safe/file.txt',
        content: 'malicious payload injected!'
      }
    };

    assert.throws(
      () => validateActionRequest(tampered, { verifyDigest: true }),
      (err) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('requestDigest mismatch'));
        return true;
      }
    );
  });

  it('validates a well-formed ActionResult', () => {
    const actionResult = {
      schemaVersion: SCHEMA_VERSIONS.ACTION_RESULT,
      requestId: 'req-001',
      grantId: 'grant-001',
      actionType: ActionType.FILE_WRITE,
      status: ActionStatus.SUCCESS,
      effectObserved: true,
      output: {
        bytesWritten: 128,
        sha256: 'e'.repeat(64)
      },
      durationMs: 15,
      executedAt: Date.now()
    };

    const res = validateActionResult(actionResult);
    assert.equal(res.status, ActionStatus.SUCCESS);
    assert.equal(res.effectObserved, true);
    assert.equal(isActionResult(actionResult), true);
  });

  it('rejects ActionResult with invalid status or non-boolean effectObserved', () => {
    assert.throws(
      () => validateActionResult({
        schemaVersion: SCHEMA_VERSIONS.ACTION_RESULT,
        requestId: 'req-001',
        grantId: 'grant-001',
        actionType: ActionType.FILE_WRITE,
        status: 'almost_done',
        effectObserved: true
      }),
      ValidationError
    );

    assert.throws(
      () => validateActionResult({
        schemaVersion: SCHEMA_VERSIONS.ACTION_RESULT,
        requestId: 'req-001',
        grantId: 'grant-001',
        actionType: ActionType.FILE_WRITE,
        status: ActionStatus.SUCCESS,
        effectObserved: 'yes'
      }),
      ValidationError
    );
  });
});
