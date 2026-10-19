/**
 * @file test/ocr-computer-port.test.js
 * Comprehensive unit and integration test suite for OcrComputerAuthorityAdapter (Wave 5 AGR-1).
 *
 * Covers:
 * 1. Denied identity (missing workspace admission, unadmitted task, principal/session mismatch, root mismatch).
 * 2. Revoked grant (prior revocation, session revocation, principal revocation, emergency stop, effect-time recheck).
 * 3. Expiry boundaries (exact millisecond boundary, 1ms before, 1ms after, future issuedAt).
 * 4. Parallel quota & atomic consume (single-use grants, replay protection returning request_already_consumed).
 * 5. Target display / window scoping (target_outside_grant_scope).
 * 6. Malformed allow & fail-closed guardrails (strict literal boolean `allowed === true`).
 * 7. Real ComputerSession compatibility fixture (@zetro/computer-runtime).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PolicyService,
  OcrComputerAuthorityAdapter,
  PolicyDeniedError
} from '../src/index.js';
import {
  ActionType,
  SCHEMA_VERSIONS,
  createActionRequest,
  createWorkspaceAdmission
} from '../../protocol/src/index.js';
import {
  ComputerSession,
  SessionErrorCode,
  AuditEventType
} from '../../computer-runtime/src/index.js';

describe('OcrComputerAuthorityAdapter (@zetro/policy)', () => {
  let currentTime;
  let policyService;
  let sampleAdmission;

  beforeEach(() => {
    currentTime = 1700000000000;
    policyService = new PolicyService({ clock: () => currentTime });

    sampleAdmission = createWorkspaceAdmission({
      workspaceId: 'ws-ocr-01',
      taskId: 'task-ocr-01',
      attemptId: 1,
      canonicalRoot: 'E:/Veyminore/products/zetro/snapshot',
      sourceBaselineRoot: 'E:/Veyminore/products/zetro/baseline',
      sourceBaselineHash: 'a'.repeat(64),
      scope: {
        readPaths: ['src'],
        writePaths: ['src'],
        createPaths: []
      },
      admittedAt: currentTime - 1000,
      admittedBy: 'coordinator'
    });
  });

  // =========================================================================
  // 1. Denied Identity & Workspace Admission Confinement
  // =========================================================================
  describe('Fixture 1: Denied Identity & Workspace Admission Confinement', () => {
    it('fails closed with missing_workspace_admission when requireAdmission=true and no admission is bound', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        requireAdmission: true,
        principalId: 'worker-1'
      });

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0,
        frames: 1
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'missing_workspace_admission');
    });

    it('fails closed with unadmitted_session when taskId mismatches admitted workspace contract', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        taskId: 'unadmitted-foreign-task',
        attemptId: 1,
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'unadmitted_session');
      assert.equal(res.details.expected, 'task-ocr-01');
    });

    it('fails closed with unadmitted_session when attemptId mismatches admitted workspace contract', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        attemptId: 99,
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'unadmitted_session');
      assert.equal(res.details.expected, 1);
    });

    it('fails closed with workspace_root_mismatch when workspaceRoot mismatches admitted canonicalRoot', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        workspaceRoot: 'E:/Veyminore/products/zetro/baseline', // Substituted root!
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'workspace_root_mismatch');
    });

    it('fails closed with principal_mismatch when principalId mismatches bound principal', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-alice',
        sessionId: 'sess-1'
      });

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-bob', // Mismatch
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'principal_mismatch');
      assert.equal(res.details.expected, 'worker-alice');
      assert.equal(res.details.received, 'worker-bob');
    });

    it('fails closed with session_mismatch when sessionId mismatches bound session', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-alpha'
      });

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-beta', // Mismatch
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'session_mismatch');
      assert.equal(res.details.expected, 'sess-alpha');
      assert.equal(res.details.received, 'sess-beta');
    });

    it('authorizes when admission and identities match active grant', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        ttlMs: 60000
      });

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(res.allowed, true);
      assert.equal(res.reason, 'authorized');
      assert.ok(res.grantId);
    });
  });

  // =========================================================================
  // 2. Revoked Grant & Effect-Time Protection
  // =========================================================================
  describe('Fixture 2: Revoked Grant & Effect-Time Protection', () => {
    it('fails closed with grant_revoked when underlying grant was revoked before evaluation', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      const grant = adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        ttlMs: 60000
      });

      // Revoke grant prior to observation
      policyService.revokeGrant(grant.grantId, 'admin_intervention');

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'grant_revoked');
    });

    it('fails closed with grant_revoked when entire session is revoked', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        ttlMs: 60000
      });

      policyService.revokeSession('sess-1', 'session_terminated');

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'grant_revoked');
    });

    it('fails closed with grant_revoked when principal is revoked', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        ttlMs: 60000
      });

      policyService.revokePrincipal('worker-1', 'compromised_credential');

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'grant_revoked');
    });

    it('fails closed when emergency stop (revokeAll) is triggered', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        ttlMs: 60000
      });

      policyService.revokeAll('system_lockdown');

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'grant_revoked');
    });

    it('executeGuardedEffect aborts and throws PolicyDeniedError if grant is revoked before effect', async () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      const grant = adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        ttlMs: 60000
      });

      const actionRequest = createActionRequest({
        taskId: sampleAdmission.taskId,
        attemptId: sampleAdmission.attemptId,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        actionType: ActionType.SCREEN_CAPTURE,
        parameters: {
          displayId: 0,
          frames: 1,
          workspaceRoot: sampleAdmission.canonicalRoot
        }
      });

      // Revoke grant while capture is queued
      policyService.revokeGrant(grant.grantId, 'revoked_in_flight');

      let effectExecuted = false;
      await assert.rejects(
        async () => {
          await adapter.executeGuardedEffect(actionRequest, grant.grantId, async () => {
            effectExecuted = true;
            return { captured: true };
          });
        },
        (err) => {
          assert(err instanceof PolicyDeniedError);
          assert.equal(err.reason, 'grant_revoked');
          return true;
        }
      );

      assert.equal(effectExecuted, false, 'Effect executor must never be invoked after revocation');
    });
  });

  // =========================================================================
  // 3. Expiry Boundaries
  // =========================================================================
  describe('Fixture 3: Expiry Boundaries', () => {
    it('fails closed at exact millisecond of expiration (currentTime === expiresAt)', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      const grant = adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        ttlMs: 1000
      });

      // Jump clock to exact expiration boundary
      currentTime = grant.expiresAt;

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'grant_expired');
      assert.equal(res.details.currentTime, grant.expiresAt);
    });

    it('authorizes 1ms before expiration boundary (currentTime === expiresAt - 1)', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      const grant = adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        ttlMs: 1000
      });

      // 1ms before expiration
      currentTime = grant.expiresAt - 1;

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(res.allowed, true);
      assert.equal(res.reason, 'authorized');
    });

    it('fails closed 1ms after expiration boundary (currentTime === expiresAt + 1)', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      const grant = adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        ttlMs: 1000
      });

      // 1ms after expiration
      currentTime = grant.expiresAt + 1;

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'grant_expired');
    });

    it('fails closed when grant is future-dated (currentTime < issuedAt)', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        issuedAt: currentTime + 5000,
        expiresAt: currentTime + 10000
      });

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'grant_not_yet_valid');
    });
  });

  // =========================================================================
  // 4. Atomic Consume & Parallel Quota / Replay Protection
  // =========================================================================
  describe('Fixture 4: Atomic Consume & Parallel Quota / Replay Protection', () => {
    it('authorizes once and prevents double-observe under one-use grant with consume: true', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        consumeByDefault: true
      });

      const grant = adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        oneUse: true,
        ttlMs: 60000
      });

      // First observation call: succeeds and consumes the approval
      const first = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(first.allowed, true);
      assert.equal(first.grantId, grant.grantId);

      // Immediate second observation call: fails closed due to one-use consumption
      const second = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(second.allowed, false);
      assert.equal(second.reason, 'request_already_consumed');
    });

    it('prevents replay when exactRequestDigest is consumed', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        consumeByDefault: true
      });

      // Construct request digest upfront
      const dummyReq = createActionRequest({
        taskId: sampleAdmission.taskId,
        attemptId: sampleAdmission.attemptId,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        actionType: ActionType.SCREEN_CAPTURE,
        parameters: {
          displayId: 0,
          frames: 1,
          workspaceRoot: sampleAdmission.canonicalRoot
        }
      });

      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        exactRequestDigest: dummyReq.requestDigest,
        ttlMs: 60000
      });

      // First call authorizes and consumes digest
      const first = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });
      assert.equal(first.allowed, true);

      // Second call fails closed with request_already_consumed
      const second = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });
      assert.equal(second.allowed, false);
      assert.equal(second.reason, 'request_already_consumed');
    });

    it('permits repeated non-consuming evaluations under standard multi-use grant', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        consumeByDefault: false
      });

      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        oneUse: false,
        ttlMs: 60000
      });

      const first = adapter.evaluateScreenCapture({ principalId: 'worker-1', sessionId: 'sess-1', displayId: 0 });
      assert.equal(first.allowed, true);

      const second = adapter.evaluateScreenCapture({ principalId: 'worker-1', sessionId: 'sess-1', displayId: 0 });
      assert.equal(second.allowed, true);
    });
  });

  // =========================================================================
  // 5. Target Window & Display Boundary Scoping
  // =========================================================================
  describe('Fixture 5: Target Window & Display Boundary Scoping', () => {
    it('fails closed with target_outside_grant_scope when requesting displayId outside grant allowedDisplays', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      // Grant restricted strictly to display 1
      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        allowedDisplays: [1],
        ttlMs: 60000
      });

      // Request display 0 (target escape)
      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'target_outside_grant_scope');
    });

    it('fails closed with target_outside_grant_scope when adapter is bound to targetDisplayId', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        targetDisplayId: 1
      });

      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        ttlMs: 60000
      });

      // Request display 0 (differs from bound targetDisplayId)
      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'target_outside_grant_scope');
    });

    it('authorizes when requested display matches allowedDisplays in grant scope', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        allowedDisplays: [1],
        ttlMs: 60000
      });

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 1
      });

      assert.equal(res.allowed, true);
      assert.equal(res.reason, 'authorized');
    });
  });

  // =========================================================================
  // 6. Malformed Allow & Fail-Closed Guardrails
  // =========================================================================
  describe('Fixture 6: Malformed Allow & Fail-Closed Guardrails', () => {
    it('always outputs a strict literal boolean allowed (typeof allowed === "boolean")', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'sess-1'
      });

      const deniedRes = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });
      assert.strictEqual(deniedRes.allowed, false);
      assert.strictEqual(typeof deniedRes.allowed, 'boolean');

      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        ttlMs: 60000
      });

      const allowedRes = adapter.evaluateScreenCapture({
        principalId: 'worker-1',
        sessionId: 'sess-1',
        displayId: 0
      });
      assert.strictEqual(allowedRes.allowed, true);
      assert.strictEqual(typeof allowedRes.allowed, 'boolean');
    });

    it('fails closed when params is null or not an object', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission
      });

      assert.equal(adapter.evaluateScreenCapture(null).allowed, false);
      assert.equal(adapter.evaluateScreenCapture(undefined).allowed, false);
      assert.equal(adapter.evaluateScreenCapture('bad').allowed, false);
    });

    it('fails closed when no matching grant exists in PolicyService', () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-unregistered',
        sessionId: 'sess-none'
      });

      const res = adapter.evaluateScreenCapture({
        principalId: 'worker-unregistered',
        sessionId: 'sess-none',
        displayId: 0
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'no_matching_grant');
    });
  });

  // =========================================================================
  // 7. Real ComputerSession Compatibility Fixture (@zetro/computer-runtime)
  // =========================================================================
  describe('Fixture 7: Real ComputerSession Integration Compatibility', () => {
    function createSessionHarness({ authorityAdapter, startDisplay = 0, clockOffset = 0 }) {
      const clock = {
        now: () => currentTime + clockOffset
      };

      const tokens = {
        'token-worker-1': 'worker-1',
        'token-worker-alice': 'worker-alice'
      };

      const tokenVerifier = {
        verify({ token, principalId }) {
          const resolved = tokens[token];
          if (!resolved) return { valid: false, reason: 'invalid_token' };
          return { valid: true, principalId: resolved, claims: { token } };
        }
      };

      const capturedFrames = [];
      const observer = {
        async capture({ sessionId, displayId, frames, signal }) {
          capturedFrames.push({ sessionId, displayId, frames });
          return {
            frames: [{ id: 'f-1', data: 'fake_window_metadata', metadata: { capturedAt: clock.now() } }],
            bytes: 64
          };
        }
      };

      const auditRecords = [];
      const auditSink = {
        write(event) {
          auditRecords.push(event);
        }
      };

      const session = new ComputerSession({
        clock,
        tokenVerifier,
        authorityPort: authorityAdapter,
        observer,
        auditSink,
        limits: {
          sessionTtlMs: 60000,
          authorityTimeoutMs: 500,
          observerTimeoutMs: 1000
        }
      });

      return { session, clock, observer, auditSink, auditRecords, capturedFrames };
    }

    it('executes successful end-to-end observe() through real ComputerSession with OcrComputerAuthorityAdapter', async () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        sessionId: 'csession-1'
      });

      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: 'csession-1',
        ttlMs: 60000
      });

      const { session, capturedFrames, auditRecords } = createSessionHarness({
        authorityAdapter: adapter
      });

      // Start session
      const startRes = await session.start({
        token: 'token-worker-1',
        principalId: 'worker-1',
        targetDisplayId: 0,
        ttlMs: 30000
      });
      assert.equal(startRes.ok, true);
      const activeSessionId = startRes.session.sessionId;

      // Bind sessionId to adapter to match started session
      adapter.bindSession(activeSessionId, 'worker-1');
      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: activeSessionId,
        ttlMs: 60000
      });

      // Execute observe()
      const obsRes = await session.observe({
        token: 'token-worker-1',
        principalId: 'worker-1',
        sessionId: activeSessionId,
        displayId: 0
      });

      assert.equal(obsRes.ok, true);
      assert.equal(capturedFrames.length, 1);
      assert.equal(capturedFrames[0].displayId, 0);

      // Verify audit emission recorded grantId
      const obsAudit = auditRecords.find(e => e.type === AuditEventType.OBSERVATION_DELIVERED);
      assert.ok(obsAudit);
      assert.ok(obsAudit.grantId);
    });

    it('ComputerSession.observe() fails closed with AUTHORITY_DENIED when grant is revoked in PolicyService', async () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1'
      });

      const { session, auditRecords } = createSessionHarness({
        authorityAdapter: adapter
      });

      const startRes = await session.start({
        token: 'token-worker-1',
        principalId: 'worker-1',
        targetDisplayId: 0,
        ttlMs: 30000
      });
      assert.equal(startRes.ok, true);
      const activeSessionId = startRes.session.sessionId;

      adapter.bindSession(activeSessionId, 'worker-1');
      const grant = adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: activeSessionId,
        ttlMs: 60000
      });

      // Revoke grant in PolicyService
      policyService.revokeGrant(grant.grantId, 'admin_emergency_revocation');

      // Attempt observe()
      const obsRes = await session.observe({
        token: 'token-worker-1',
        principalId: 'worker-1',
        sessionId: activeSessionId,
        displayId: 0
      });

      assert.equal(obsRes.ok, false);
      assert.equal(obsRes.code, SessionErrorCode.AUTHORITY_DENIED);
      assert.equal(obsRes.details.reason, 'grant_revoked');

      // Verify audit event OBSERVATION_DENIED emitted
      const denyAudit = auditRecords.find(e => e.type === AuditEventType.OBSERVATION_DENIED);
      assert.ok(denyAudit);
      assert.equal(denyAudit.reason, 'grant_revoked');
    });

    it('ComputerSession.observe() fails closed with AUTHORITY_DENIED when grant expires', async () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1'
      });

      const { session } = createSessionHarness({
        authorityAdapter: adapter
      });

      const startRes = await session.start({
        token: 'token-worker-1',
        principalId: 'worker-1',
        targetDisplayId: 0,
        ttlMs: 30000
      });
      assert.equal(startRes.ok, true);
      const activeSessionId = startRes.session.sessionId;

      adapter.bindSession(activeSessionId, 'worker-1');
      const grant = adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: activeSessionId,
        ttlMs: 1000
      });

      // Advance clock past grant expiration
      currentTime = grant.expiresAt + 1;

      const obsRes = await session.observe({
        token: 'token-worker-1',
        principalId: 'worker-1',
        sessionId: activeSessionId,
        displayId: 0
      });

      assert.equal(obsRes.ok, false);
      assert.equal(obsRes.code, SessionErrorCode.AUTHORITY_DENIED);
      assert.equal(obsRes.details.reason, 'grant_expired');
    });

    it('ComputerSession.observe() fails closed on second call under one-use grant with consumeByDefault: true', async () => {
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        workspaceAdmission: sampleAdmission,
        principalId: 'worker-1',
        consumeByDefault: true
      });

      const { session } = createSessionHarness({
        authorityAdapter: adapter
      });

      const startRes = await session.start({
        token: 'token-worker-1',
        principalId: 'worker-1',
        targetDisplayId: 0,
        ttlMs: 30000
      });
      assert.equal(startRes.ok, true);
      const activeSessionId = startRes.session.sessionId;

      adapter.bindSession(activeSessionId, 'worker-1');
      adapter.createObservationGrant({
        principalId: 'worker-1',
        sessionId: activeSessionId,
        oneUse: true,
        ttlMs: 60000
      });

      // First call succeeds and consumes one-time grant
      const obs1 = await session.observe({
        token: 'token-worker-1',
        principalId: 'worker-1',
        sessionId: activeSessionId,
        displayId: 0
      });
      assert.equal(obs1.ok, true);

      // Immediate second call fails closed with AUTHORITY_DENIED / request_already_consumed
      const obs2 = await session.observe({
        token: 'token-worker-1',
        principalId: 'worker-1',
        sessionId: activeSessionId,
        displayId: 0
      });
      assert.equal(obs2.ok, false);
      assert.equal(obs2.code, SessionErrorCode.AUTHORITY_DENIED);
      assert.equal(obs2.details.reason, 'request_already_consumed');
    });

    it('ComputerSession.observe() fails closed when unadmitted session requests capture', async () => {
      // Adapter requiring admission, but instantiated without admission
      const adapter = new OcrComputerAuthorityAdapter(policyService, {
        requireAdmission: true,
        principalId: 'worker-1'
      });

      const { session } = createSessionHarness({
        authorityAdapter: adapter
      });

      const startRes = await session.start({
        token: 'token-worker-1',
        principalId: 'worker-1',
        targetDisplayId: 0,
        ttlMs: 30000
      });
      const activeSessionId = startRes.session.sessionId;

      const obsRes = await session.observe({
        token: 'token-worker-1',
        principalId: 'worker-1',
        sessionId: activeSessionId,
        displayId: 0
      });

      assert.equal(obsRes.ok, false);
      assert.equal(obsRes.code, SessionErrorCode.AUTHORITY_DENIED);
      assert.equal(obsRes.details.reason, 'missing_workspace_admission');
    });
  });
});
