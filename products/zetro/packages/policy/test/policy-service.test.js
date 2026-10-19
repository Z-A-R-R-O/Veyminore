/**
 * @file test/policy-service.test.js
 * Unit and lifecycle tests for PolicyService.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyService } from '../src/policy-service.js';
import {
  ActionType,
  SCHEMA_VERSIONS,
  createActionRequest
} from '../../protocol/src/index.js';
import { PolicyError, PolicyValidationError } from '../src/errors.js';

describe('PolicyService Lifecycle & Authority Management', () => {
  let currentTime = 1700000000000;
  let policy;

  beforeEach(() => {
    currentTime = 1700000000000;
    policy = new PolicyService({ clock: () => currentTime });
  });

  const baseGrant = {
    schemaVersion: SCHEMA_VERSIONS.GRANT,
    grantId: 'grant-01',
    principalId: 'worker-1',
    sessionId: 'session-alpha',
    scope: {
      actionTypes: [ActionType.FILE_READ, ActionType.FILE_WRITE],
      allowedPaths: ['packages/policy', 'src']
    },
    issuedAt: 1700000000000,
    expiresAt: 1700000060000, // +60s
    revoked: false,
    issuerId: 'policy_coordinator'
  };

  it('issues a valid grant and retrieves it by ID', () => {
    const grant = policy.issueGrant(baseGrant);
    assert.equal(grant.grantId, 'grant-01');

    const retrieved = policy.getGrant('grant-01');
    assert.deepEqual(retrieved.scope.allowedPaths, ['packages/policy', 'src']);
  });

  it('rejects malformed grant with PolicyValidationError', () => {
    assert.throws(
      () => policy.issueGrant({ grantId: 'bad-grant' }),
      (err) => {
        assert(err instanceof PolicyValidationError);
        assert(err.errors.length > 0);
        return true;
      }
    );
  });

  it('rejects duplicate active grant ID to prevent ambiguous override', () => {
    policy.issueGrant(baseGrant);
    assert.throws(
      () => policy.issueGrant(baseGrant),
      (err) => {
        assert(err instanceof PolicyError);
        assert(err.message.includes('Active grant already exists'));
        return true;
      }
    );
  });

  it('authorizes a matching valid ActionRequest', () => {
    policy.issueGrant(baseGrant);

    const req = createActionRequest({
      taskId: 'task-1',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-alpha',
      actionType: ActionType.FILE_READ,
      parameters: { path: 'src/index.js' }
    });

    const res = policy.evaluate(req);
    assert.equal(res.granted, true);
    assert.equal(res.grantId, 'grant-01');
    assert.equal(res.reason, 'authorized');
  });

  it('atomically authorizes and consumes approval in a single operation', () => {
    policy.issueGrant(baseGrant);

    const req = createActionRequest({
      taskId: 'task-1',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-alpha',
      actionType: ActionType.FILE_READ,
      parameters: { path: 'src/index.js' }
    });

    assert.equal(policy.isRequestConsumed(req.requestId), false);

    // Consume once
    const res = policy.authorizeAndConsume(req);
    assert.equal(res.granted, true);
    assert.equal(res.reason, 'authorized_and_consumed');
    assert.equal(policy.isRequestConsumed(req.requestId), true);

    // Replay fails closed
    const replayRes = policy.evaluate(req);
    assert.equal(replayRes.granted, false);
    assert.equal(replayRes.reason, 'request_already_consumed');
  });

  it('revokes a single grant by ID and records reason and timestamp', () => {
    policy.issueGrant(baseGrant);
    currentTime = 1700000010000;

    const revoked = policy.revokeGrant('grant-01', 'user_revoked');
    assert.equal(revoked, true);

    const stored = policy.getGrant('grant-01');
    assert.equal(stored.revoked, true);
    assert.equal(stored.revocationReason, 'user_revoked');
    assert.equal(stored.revokedAt, 1700000010000);

    const req = createActionRequest({
      taskId: 'task-1',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-alpha',
      actionType: ActionType.FILE_READ,
      parameters: { path: 'src/index.js' }
    });

    const res = policy.evaluate(req);
    assert.equal(res.granted, false);
    assert.equal(res.reason, 'grant_revoked');
  });

  it('revokes an entire session across multiple grants', () => {
    policy.issueGrant(baseGrant);
    policy.issueGrant({
      ...baseGrant,
      grantId: 'grant-02',
      scope: {
        actionTypes: [ActionType.SHELL_EXEC],
        allowedPaths: ['packages/policy'],
        allowedCommands: ['npm']
      }
    });

    const revokedCount = policy.revokeSession('session-alpha', 'session_expired');
    assert.equal(revokedCount, 2);

    assert.equal(policy.getGrant('grant-01').revoked, true);
    assert.equal(policy.getGrant('grant-02').revoked, true);
  });

  it('revokes an entire principal across multiple sessions', () => {
    policy.issueGrant(baseGrant);
    policy.issueGrant({
      ...baseGrant,
      grantId: 'grant-sess-beta',
      sessionId: 'session-beta'
    });

    const revokedCount = policy.revokePrincipal('worker-1', 'compromised');
    assert.equal(revokedCount, 2);

    assert.equal(policy.getGrant('grant-01').revoked, true);
    assert.equal(policy.getGrant('grant-sess-beta').revoked, true);
  });

  it('emergency stop (revokeAll) revokes all grants immediately', () => {
    policy.issueGrant(baseGrant);
    policy.issueGrant({
      ...baseGrant,
      grantId: 'grant-worker-2',
      principalId: 'worker-2',
      sessionId: 'session-other'
    });

    const count = policy.revokeAll('emergency_halt');
    assert.equal(count, 2);
    assert.equal(policy.getGrant('grant-01').revoked, true);
    assert.equal(policy.getGrant('grant-worker-2').revoked, true);
  });
});

describe('Immutability & Authority Confinement (Deep Clone & Deep Freeze)', () => {
  let currentTime = 1700000000000;
  let policy;

  beforeEach(() => {
    currentTime = 1700000000000;
    policy = new PolicyService({ clock: () => currentTime });
  });

  const baseGrant = {
    schemaVersion: SCHEMA_VERSIONS.GRANT,
    grantId: 'grant-frozen-01',
    principalId: 'worker-1',
    sessionId: 'session-alpha',
    scope: {
      actionTypes: [ActionType.FILE_READ],
      allowedPaths: ['src/app.js']
    },
    issuedAt: 1700000000000,
    expiresAt: 1700000060000,
    revoked: false,
    issuerId: 'policy_coordinator'
  };

  it('returned grant from getGrant is deeply frozen and throws TypeError on mutation in strict mode', () => {
    policy.issueGrant(baseGrant);
    const retrieved = policy.getGrant('grant-frozen-01');

    assert.equal(Object.isFrozen(retrieved), true);
    assert.equal(Object.isFrozen(retrieved.scope), true);
    assert.equal(Object.isFrozen(retrieved.scope.allowedPaths), true);
    assert.equal(Object.isFrozen(retrieved.scope.actionTypes), true);

    // Attempting to push to allowedPaths throws
    assert.throws(
      () => { retrieved.scope.allowedPaths.push('secrets'); },
      TypeError
    );

    // Attempting to mutate property throws
    assert.throws(
      () => { retrieved.scope.allowedPaths[0] = 'secrets'; },
      TypeError
    );

    // Attempting to push actionType throws
    assert.throws(
      () => { retrieved.scope.actionTypes.push(ActionType.SHELL_EXEC); },
      TypeError
    );
  });

  it('adversarial mutation attempt on returned grant cannot widen stored authority', () => {
    policy.issueGrant(baseGrant);
    const retrieved = policy.getGrant('grant-frozen-01');

    try {
      retrieved.scope.allowedPaths.push('secrets');
    } catch {
      // Ignored if thrown
    }

    // Evaluate an ActionRequest for secrets
    const req = createActionRequest({
      taskId: 'task-1',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-alpha',
      actionType: ActionType.FILE_READ,
      parameters: { path: 'secrets' }
    });

    const res = policy.evaluate(req);
    assert.equal(res.granted, false);
    assert.equal(res.reason, 'path_outside_grant_scope');

    // Stored grant remains strictly unmutated
    const current = policy.getGrant('grant-frozen-01');
    assert.deepEqual(current.scope.allowedPaths, ['src/app.js']);
  });

  it('mutating caller original grantInput after issuance cannot widen stored authority (ingress isolation)', () => {
    const maliciousInput = {
      ...baseGrant,
      grantId: 'grant-tamper-input',
      scope: {
        actionTypes: [ActionType.FILE_READ],
        allowedPaths: ['src/app.js']
      }
    };

    policy.issueGrant(maliciousInput);

    // Caller maliciously tampers with original object references after issuance
    maliciousInput.scope.allowedPaths.push('secrets');
    maliciousInput.scope.allowedPaths.push('etc/passwd');
    maliciousInput.scope.actionTypes.push(ActionType.SHELL_EXEC);

    // Stored grant in policy service is unaffected
    const stored = policy.getGrant('grant-tamper-input');
    assert.deepEqual(stored.scope.allowedPaths, ['src/app.js']);
    assert.deepEqual(stored.scope.actionTypes, [ActionType.FILE_READ]);

    // Action request for tampered path fails closed
    const req = createActionRequest({
      taskId: 'task-1',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-alpha',
      actionType: ActionType.FILE_READ,
      parameters: { path: 'secrets' }
    });

    const res = policy.evaluate(req);
    assert.equal(res.granted, false);
    assert.equal(res.reason, 'path_outside_grant_scope');
  });

  it('returned collection from getActiveGrants is frozen and items cannot widen authority', () => {
    policy.issueGrant(baseGrant);
    const activeGrants = policy.getActiveGrants();

    assert.equal(Object.isFrozen(activeGrants), true);
    assert.throws(
      () => { activeGrants.push({ fake: true }); },
      TypeError
    );

    assert.equal(Object.isFrozen(activeGrants[0]), true);
    assert.equal(Object.isFrozen(activeGrants[0].scope.allowedPaths), true);

    assert.throws(
      () => { activeGrants[0].scope.allowedPaths.push('secrets'); },
      TypeError
    );

    // Stored grant in policy service remains unmodified
    assert.deepEqual(policy.getGrant('grant-frozen-01').scope.allowedPaths, ['src/app.js']);
  });

  it('authoritative mutable revocation state cannot be un-revoked via returned object tampering', () => {
    policy.issueGrant(baseGrant);
    policy.revokeGrant('grant-frozen-01', 'security_stop');

    const stored = policy.getGrant('grant-frozen-01');
    assert.equal(stored.revoked, true);

    assert.throws(
      () => { stored.revoked = false; },
      TypeError
    );

    const storedAgain = policy.getGrant('grant-frozen-01');
    assert.equal(storedAgain.revoked, true);

    const req = createActionRequest({
      taskId: 'task-1',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'session-alpha',
      actionType: ActionType.FILE_READ,
      parameters: { path: 'src/app.js' }
    });

    const res = policy.evaluate(req);
    assert.equal(res.granted, false);
    assert.equal(res.reason, 'grant_revoked');
  });
});
