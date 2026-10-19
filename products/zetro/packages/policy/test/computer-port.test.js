/**
 * @file test/computer-port.test.js
 * Unit tests for ComputerPolicyPort (ZETRO Computer M6/M7 operations).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyService } from '../src/policy-service.js';
import { ComputerPolicyPort } from '../src/ports/computer-port.js';
import { ActionType, createActionRequest } from '../../protocol/src/index.js';
import { PolicyDeniedError } from '../src/errors.js';

describe('ComputerPolicyPort (ZETRO Computer M6/M7)', () => {
  let currentTime = 1700000000000;
  let policy;
  let computerPort;

  const computerSession = {
    principalId: 'supervisor-1',
    sessionId: 'comp-sess-01'
  };

  beforeEach(() => {
    currentTime = 1700000000000;
    policy = new PolicyService({ clock: () => currentTime });
    computerPort = new ComputerPolicyPort(policy);

    computerPort.createComputerGrant({
      ...computerSession,
      allowedPaths: ['packages', 'src', 'output'],
      allowedCommands: ['npm', 'node', 'dir', 'git']
    });
  });

  it('authorizes screen capture request with display metadata', () => {
    const res = computerPort.evaluateScreenCapture({
      ...computerSession,
      displayId: 0,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 }
    });

    assert.equal(res.allowed, true);
    assert.equal(res.reason, 'authorized');
    assert(res.requestDigest.length === 64);
  });

  it('authorizes desktop input for mouse and keyboard actions', () => {
    const clickRes = computerPort.evaluateDesktopInput({
      ...computerSession,
      action: 'mouse_click',
      coordinates: { x: 450, y: 320 }
    });
    assert.equal(clickRes.allowed, true);

    const typeRes = computerPort.evaluateDesktopInput({
      ...computerSession,
      action: 'type_text',
      text: 'hello zetro'
    });
    assert.equal(typeRes.allowed, true);
  });

  it('authorizes shell execution for permitted commands within allowedPaths', () => {
    const res = computerPort.evaluateShellExecution({
      ...computerSession,
      command: ['node', '-v'],
      cwd: 'src'
    });

    assert.equal(res.allowed, true);
  });

  it('fails closed when shell command is outside allowedCommands', () => {
    const res = computerPort.evaluateShellExecution({
      ...computerSession,
      command: ['powershell', '-Command', 'Invoke-WebRequest'],
      cwd: 'src'
    });

    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'command_not_permitted');
  });

  it('authorizes file operations within allowed paths', () => {
    const res = computerPort.evaluateFileAccess({
      ...computerSession,
      actionType: ActionType.FILE_READ,
      path: 'src/index.js'
    });

    assert.equal(res.allowed, true);
  });

  it('fails closed when file operation is outside allowed paths', () => {
    const res = computerPort.evaluateFileAccess({
      ...computerSession,
      actionType: ActionType.FILE_WRITE,
      path: 'secret/credentials.json',
      content: 'malicious'
    });

    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'path_outside_grant_scope');
  });

  it('fails closed when file operation specifies dangerous absolute path', () => {
    const res = computerPort.evaluateFileAccess({
      ...computerSession,
      actionType: ActionType.FILE_WRITE,
      path: 'C:/Windows/System32/drivers/etc/hosts',
      content: 'malicious'
    });

    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'invalid_request');
  });

  it('executeGuardedEffect rechecks authority and executes effect', async () => {
    const actionReq = createActionRequest({
      taskId: 'comp-task',
      attemptId: 1,
      principalId: 'supervisor-1',
      sessionId: 'comp-sess-01',
      actionType: ActionType.SCREEN_CAPTURE,
      parameters: { displayId: 0, bounds: null }
    });

    const grant = policy.getActiveGrants({ sessionId: 'comp-sess-01' })[0];
    let executed = false;

    const result = await computerPort.executeGuardedEffect(actionReq, grant.grantId, () => {
      executed = true;
      return 'capture_buffer_simulated';
    });

    assert.equal(executed, true);
    assert.equal(result, 'capture_buffer_simulated');
  });

  it('executeGuardedEffect throws PolicyDeniedError when grant was revoked before execution', async () => {
    const actionReq = createActionRequest({
      taskId: 'comp-task',
      attemptId: 1,
      principalId: 'supervisor-1',
      sessionId: 'comp-sess-01',
      actionType: ActionType.DESKTOP_INPUT,
      parameters: { action: 'mouse_click', coordinates: { x: 100, y: 100 }, text: null }
    });

    const grant = policy.getActiveGrants({ sessionId: 'comp-sess-01' })[0];

    // Revoke grant before effect execution
    policy.revokeGrant(grant.grantId, 'emergency_stop');

    let executed = false;
    await assert.rejects(
      async () => {
        await computerPort.executeGuardedEffect(actionReq, grant.grantId, () => {
          executed = true;
        });
      },
      (err) => {
        assert(err instanceof PolicyDeniedError);
        assert.equal(err.reason, 'grant_revoked');
        return true;
      }
    );

    assert.equal(executed, false, 'Effect must never execute after revocation');
  });
});
