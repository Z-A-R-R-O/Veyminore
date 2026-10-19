/**
 * @file test/native-computer-policy.test.js
 * Comprehensive unit and integration test suite for Native Computer policy adaptation.
 *
 * Verifies:
 * 1. Deny-by-default on proposed input actions (move, click, scroll, key, text) pending native qualification.
 * 2. Stale generation rejection for targeted window handles (HWND).
 * 3. Strict literal boolean allowed typing (no truthy coercion, fail closed).
 * 4. Exact expiry boundary enforcement (currentTime >= expiresAt).
 * 5. Identity and scope confinement (principal, session, display, admitted workspace).
 * 6. Revocation enforcement (session, principal, grant).
 * 7. Authorized observation operations (enumerate, inspect, capture).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PolicyService,
  OcrComputerAuthorityAdapter
} from '../src/index.js';
import {
  SCHEMA_VERSIONS,
  ComputerOperation,
  UNQUALIFIED_INPUT_OPERATIONS,
  createComputerActionRequest,
  createWorkspaceAdmission
} from '../../protocol/src/index.js';

describe('Native Computer Policy Adaptation (@zetro/policy)', () => {
  let currentTime;
  let policyService;
  let sampleAdmission;
  let adapter;

  const validTarget = {
    hwnd: 100200,
    processId: 4321,
    processStartTimestamp: 1713000000000,
    processName: 'notepad.exe',
    displayId: 0,
    dpi: 96,
    generation: 'gen-init'
  };

  beforeEach(() => {
    currentTime = 1713000500000;
    policyService = new PolicyService({ clock: () => currentTime });

    sampleAdmission = createWorkspaceAdmission({
      workspaceId: 'ws-native-01',
      taskId: 'task-native-01',
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

    adapter = new OcrComputerAuthorityAdapter(policyService, {
      principalId: 'worker-notepad',
      sessionId: 'session-notepad-01',
      taskId: 'task-native-01',
      attemptId: 1,
      workspaceAdmission: sampleAdmission,
      allowedDisplays: [0]
    });

    adapter.setTargetGeneration(validTarget.hwnd, validTarget.generation);

    // Issue baseline observation grant
    adapter.createObservationGrant({
      principalId: 'worker-notepad',
      sessionId: 'session-notepad-01',
      allowedDisplays: [0],
      ttlMs: 300000
    });
  });

  describe('1. Input Actions Disabled Pending Qualification', () => {
    for (const op of UNQUALIFIED_INPUT_OPERATIONS) {
      it(`fails closed for proposed input action '${op}' with 'input_actions_disabled_pending_qualification'`, () => {
        let params = {};
        if (op === ComputerOperation.MOVE) params = { x: 100, y: 200 };
        else if (op === ComputerOperation.CLICK) params = { button: 'left' };
        else if (op === ComputerOperation.SCROLL) params = { deltaX: 0, deltaY: -100 };
        else if (op === ComputerOperation.KEY) params = { key: 'Enter' };
        else if (op === ComputerOperation.TEXT) params = { text: 'test input' };

        const req = createComputerActionRequest({
          taskId: 'task-native-01',
          attemptId: 1,
          sessionId: 'session-notepad-01',
          principalId: 'worker-notepad',
          operation: op,
          target: validTarget,
          parameters: params,
          requestedAt: currentTime,
          ttlMs: 30000
        });

        const res = adapter.evaluateComputerAction(req);

        assert.equal(typeof res.allowed, 'boolean');
        assert.equal(res.allowed, false);
        assert.equal(res.reason, 'input_actions_disabled_pending_qualification');
        assert.equal(res.details?.operation, op);
      });
    }
  });

  describe('2. Stale Generation Rejection', () => {
    it('fails closed with stale_generation when target generation mismatches known target generation', () => {
      // Known generation is 'gen-init'
      const staleTarget = {
        ...validTarget,
        generation: 'gen-stale-002'
      };

      const req = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: staleTarget,
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res = adapter.evaluateComputerAction(req);

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'stale_generation');
      assert.equal(res.details?.hwnd, validTarget.hwnd);
      assert.equal(res.details?.expectedGeneration, 'gen-init');
      assert.equal(res.details?.receivedGeneration, 'gen-stale-002');
    });

    it('permits observation when target generation matches registered generation', () => {
      const req = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: validTarget,
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res = adapter.evaluateComputerAction(req);

      assert.equal(res.allowed, true);
      assert.equal(res.reason, 'authorized');
    });

    it('updates known generation via registerWindowTarget', () => {
      adapter.registerWindowTarget({
        hwnd: validTarget.hwnd,
        generation: 'gen-updated-003'
      });

      const req = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: { ...validTarget, generation: 'gen-updated-003' },
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res = adapter.evaluateComputerAction(req);

      assert.equal(res.allowed, true);
    });
  });

  describe('3. Strict Literal Boolean Allowed Typing', () => {
    it('always returns literal boolean allowed property and rejects malformed requests', () => {
      const nullRes = adapter.evaluateComputerAction(null);
      assert.equal(typeof nullRes.allowed, 'boolean');
      assert.equal(nullRes.allowed, false);
      assert.equal(nullRes.reason, 'invalid_request');

      const nonObjRes = adapter.evaluateComputerAction('invalid-string');
      assert.equal(typeof nonObjRes.allowed, 'boolean');
      assert.equal(nonObjRes.allowed, false);

      const emptyRes = adapter.evaluateComputerAction({});
      assert.equal(typeof emptyRes.allowed, 'boolean');
      assert.equal(emptyRes.allowed, false);
    });
  });

  describe('4. Expiry Boundary Enforcement', () => {
    it('fails closed with grant_expired when currentTime >= expiresAt', () => {
      const req = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: validTarget,
        requestedAt: currentTime,
        ttlMs: 10000 // expiresAt = currentTime + 10000
      });

      // Advance clock past expiration
      currentTime += 10001;

      const res = adapter.evaluateComputerAction(req);

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'grant_expired');
      assert.equal(res.details?.expiresAt, req.expiresAt);
    });

    it('fails closed at exact millisecond boundary (currentTime === expiresAt)', () => {
      const req = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: validTarget,
        requestedAt: currentTime,
        ttlMs: 10000
      });

      // Set clock to exact expiration millisecond
      currentTime = req.expiresAt;

      const res = adapter.evaluateComputerAction(req);

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'grant_expired');
    });

    it('authorizes 1ms before expiration boundary (currentTime === expiresAt - 1)', () => {
      const req = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: validTarget,
        requestedAt: currentTime,
        ttlMs: 10000
      });

      currentTime = req.expiresAt - 1;

      const res = adapter.evaluateComputerAction(req);

      assert.equal(res.allowed, true);
    });
  });

  describe('5. Identity & Scope Confinement', () => {
    it('fails closed with principal_mismatch when principalId does not match adapter', () => {
      const req = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-imposter',
        operation: ComputerOperation.CAPTURE,
        target: validTarget,
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res = adapter.evaluateComputerAction(req);

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'principal_mismatch');
      assert.equal(res.details?.expected, 'worker-notepad');
      assert.equal(res.details?.received, 'worker-imposter');
    });

    it('fails closed with session_mismatch when sessionId does not match adapter', () => {
      const req = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-other-99',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: validTarget,
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res = adapter.evaluateComputerAction(req);

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'session_mismatch');
      assert.equal(res.details?.expected, 'session-notepad-01');
      assert.equal(res.details?.received, 'session-other-99');
    });

    it('fails closed with unadmitted_session when taskId or attemptId mismatches WorkspaceAdmission', () => {
      const taskMismatchReq = createComputerActionRequest({
        taskId: 'task-unadmitted',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: validTarget,
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res1 = adapter.evaluateComputerAction(taskMismatchReq);
      assert.equal(res1.allowed, false);
      assert.equal(res1.reason, 'unadmitted_session');

      const attemptMismatchReq = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 2,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: validTarget,
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res2 = adapter.evaluateComputerAction(attemptMismatchReq);
      assert.equal(res2.allowed, false);
      assert.equal(res2.reason, 'unadmitted_session');
    });

    it('fails closed with target_outside_grant_scope when display is not in allowedDisplays', () => {
      const unallowedDisplayTarget = {
        ...validTarget,
        displayId: 2 // Display 2 is not in allowedDisplays: [0]
      };

      const req = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: unallowedDisplayTarget,
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res = adapter.evaluateComputerAction(req);

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'target_outside_grant_scope');
    });
  });

  describe('6. Revocation Enforcement', () => {
    it('fails closed with grant_revoked when session is revoked in PolicyService', () => {
      policyService.revokeSession('session-notepad-01', 'emergency_stop');

      const req = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: validTarget,
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res = adapter.evaluateComputerAction(req);

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'grant_revoked');
    });

    it('fails closed with grant_revoked when principal is revoked in PolicyService', () => {
      policyService.revokePrincipal('worker-notepad', 'compromised_credential');

      const req = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: validTarget,
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res = adapter.evaluateComputerAction(req);

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'grant_revoked');
    });
  });

  describe('7. Authorized Observation Operations', () => {
    it('authorizes ENUMERATE operation under active observation grant', () => {
      const enumReq = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.ENUMERATE,
        target: { displayId: 0, dpi: 96 },
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res = adapter.evaluateComputerAction(enumReq);

      assert.equal(res.allowed, true);
      assert.equal(res.reason, 'authorized');
      assert.equal(res.requestDigest, enumReq.requestDigest);
    });

    it('authorizes INSPECT operation targeting registered window', () => {
      const inspectReq = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.INSPECT,
        target: validTarget,
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res = adapter.evaluateComputerAction(inspectReq);

      assert.equal(res.allowed, true);
      assert.equal(res.reason, 'authorized');
    });

    it('authorizes CAPTURE operation targeting registered window', () => {
      const capReq = createComputerActionRequest({
        taskId: 'task-native-01',
        attemptId: 1,
        sessionId: 'session-notepad-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: validTarget,
        parameters: { format: 'png' },
        requestedAt: currentTime,
        ttlMs: 30000
      });

      const res = adapter.evaluateComputerAction(capReq);

      assert.equal(res.allowed, true);
      assert.equal(res.reason, 'authorized');
    });
  });
});
