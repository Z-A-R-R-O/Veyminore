import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateGrant,
  isGrant,
  evaluateGrant,
  createActionRequest,
  ValidationError,
  SCHEMA_VERSIONS,
  ActionType
} from '../src/index.js';

describe('Grant Schema & Deny-by-Default Authority Evaluation', () => {
  const baseTimestamp = 1700000000000;

  const validGrant = {
    schemaVersion: SCHEMA_VERSIONS.GRANT,
    grantId: 'grant-101',
    principalId: 'worker-1',
    sessionId: 'session-42',
    scope: {
      actionTypes: [ActionType.FILE_READ, ActionType.FILE_WRITE, ActionType.SHELL_EXEC],
      allowedPaths: ['packages/protocol/src', 'packages/protocol/test']
    },
    issuedAt: baseTimestamp,
    expiresAt: baseTimestamp + 3600000, // +1 hour
    revoked: false,
    issuerId: 'policy_coordinator'
  };

  it('validates a well-formed grant', () => {
    const res = validateGrant(validGrant);
    assert.equal(res.grantId, 'grant-101');
    assert.equal(res.scope.allowedPaths.length, 2);
    assert.equal(isGrant(validGrant), true);
  });

  it('rejects grant with expiresAt <= issuedAt', () => {
    assert.throws(
      () => validateGrant({
        ...validGrant,
        expiresAt: baseTimestamp - 1000
      }),
      (err) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('must be strictly greater than issuedAt'));
        return true;
      }
    );
  });

  it('requires revokedAt when revoked is true', () => {
    assert.throws(
      () => validateGrant({
        ...validGrant,
        revoked: true,
        revokedAt: undefined
      }),
      ValidationError
    );
  });

  it('authorizes a matching valid request within expiry and scope', () => {
    const request = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-42',
      actionType: ActionType.FILE_WRITE,
      parameters: {
        path: 'packages/protocol/src/constants.js',
        content: '// update'
      }
    });

    const evalResult = evaluateGrant(validGrant, request, {
      currentTime: baseTimestamp + 1000
    });
    assert.equal(evalResult.granted, true);
    assert.equal(evalResult.grantId, 'grant-101');
  });

  it('denies expired grant using injected clock', () => {
    const request = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-42',
      actionType: ActionType.FILE_READ,
      parameters: { path: 'packages/protocol/src/constants.js' }
    });

    const evalResult = evaluateGrant(validGrant, request, {
      currentTime: baseTimestamp + 3600001 // 1 ms after expiry
    });
    assert.equal(evalResult.granted, false);
    assert.equal(evalResult.reason, 'grant_expired');
  });

  it('denies future-dated grant when currentTime is before issuedAt', () => {
    const request = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-42',
      actionType: ActionType.FILE_READ,
      parameters: { path: 'packages/protocol/src/constants.js' }
    });

    const evalResult = evaluateGrant(validGrant, request, {
      currentTime: baseTimestamp - 5000 // before issuedAt
    });
    assert.equal(evalResult.granted, false);
    assert.equal(evalResult.reason, 'grant_not_yet_valid');
  });

  it('denies revoked grant with recorded revocation reason', () => {
    const revokedGrant = {
      ...validGrant,
      revoked: true,
      revokedAt: baseTimestamp + 500,
      revocationReason: 'Emergency stop triggered by supervisor'
    };

    const request = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-42',
      actionType: ActionType.FILE_READ,
      parameters: { path: 'packages/protocol/src/constants.js' }
    });

    const evalResult = evaluateGrant(revokedGrant, request, {
      currentTime: baseTimestamp + 600
    });
    assert.equal(evalResult.granted, false);
    assert.equal(evalResult.reason, 'grant_revoked');
    assert.equal(evalResult.details.revocationReason, 'Emergency stop triggered by supervisor');
  });

  it('denies request with principal mismatch', () => {
    const request = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-2-impostor',
      sessionId: 'session-42',
      actionType: ActionType.FILE_READ,
      parameters: { path: 'packages/protocol/src/constants.js' }
    });

    const evalResult = evaluateGrant(validGrant, request, {
      currentTime: baseTimestamp + 100
    });
    assert.equal(evalResult.granted, false);
    assert.equal(evalResult.reason, 'principal_mismatch');
  });

  it('denies request with session mismatch', () => {
    const request = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'another-session',
      actionType: ActionType.FILE_READ,
      parameters: { path: 'packages/protocol/src/constants.js' }
    });

    const evalResult = evaluateGrant(validGrant, request, {
      currentTime: baseTimestamp + 100
    });
    assert.equal(evalResult.granted, false);
    assert.equal(evalResult.reason, 'session_mismatch');
  });

  it('denies request with unpermitted action type', () => {
    const request = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-42',
      actionType: ActionType.DESKTOP_INPUT,
      parameters: { action: 'click', x: 100, y: 200 }
    });

    const evalResult = evaluateGrant(validGrant, request, {
      currentTime: baseTimestamp + 100
    });
    assert.equal(evalResult.granted, false);
    assert.equal(evalResult.reason, 'action_type_not_permitted');
  });

  it('enforces exactRequestDigest approval semantics against parameter tampering', () => {
    const request1 = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-42',
      actionType: ActionType.FILE_WRITE,
      parameters: {
        path: 'packages/protocol/src/constants.js',
        content: 'safe approved code'
      }
    });

    // Exact-request grant bound to request1's digest
    const exactGrant = {
      ...validGrant,
      scope: {
        ...validGrant.scope,
        exactRequestDigest: request1.requestDigest
      }
    };

    // 1. Exact request is approved
    const res1 = evaluateGrant(exactGrant, request1, { currentTime: baseTimestamp + 100 });
    assert.equal(res1.granted, true);

    // 2. Modified request with different arguments is denied
    const request2 = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-42',
      actionType: ActionType.FILE_WRITE,
      parameters: {
        path: 'packages/protocol/src/constants.js',
        content: 'altered code unauthorized by user'
      }
    });

    const res2 = evaluateGrant(exactGrant, request2, { currentTime: baseTimestamp + 100 });
    assert.equal(res2.granted, false);
    assert.equal(res2.reason, 'exact_request_digest_mismatch');
  });

  it('enforces path scope on file actions and shell cwd', () => {
    // Path inside allowedPaths
    const insideReq = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-42',
      actionType: ActionType.FILE_WRITE,
      parameters: {
        path: 'packages/protocol/src/new-module.js',
        content: 'export const x = 1;'
      }
    });
    const insideRes = evaluateGrant(validGrant, insideReq, { currentTime: baseTimestamp + 100 });
    assert.equal(insideRes.granted, true);

    // Path outside allowedPaths
    const outsideReq = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-42',
      actionType: ActionType.FILE_WRITE,
      parameters: {
        path: 'packages/rct-runtime/src/index.js',
        content: 'overwrite other worker'
      }
    });
    const outsideRes = evaluateGrant(validGrant, outsideReq, { currentTime: baseTimestamp + 100 });
    assert.equal(outsideRes.granted, false);
    assert.equal(outsideRes.reason, 'path_outside_grant_scope');

    // Shell cwd outside allowedPaths
    const badCwdReq = createActionRequest({
      taskId: 'task-101',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-42',
      actionType: ActionType.SHELL_EXEC,
      parameters: {
        command: ['npm', 'test'],
        cwd: 'packages/unauthorized-pkg'
      }
    });
    const badCwdRes = evaluateGrant(validGrant, badCwdReq, { currentTime: baseTimestamp + 100 });
    assert.equal(badCwdRes.granted, false);
    assert.equal(badCwdRes.reason, 'cwd_outside_grant_scope');
  });
});
