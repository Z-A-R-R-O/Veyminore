import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createGuardedExecutor,
  validateTargetIdentity
} from '../src/guarded-actions.js';
import { AgentErrorCode, ComputerAgentError } from '../src/types.js';

describe('Target Identity Validation', () => {
  it('accepts valid target descriptor', () => {
    const target = validateTargetIdentity({
      hwnd: 12345,
      processId: 6789,
      generation: '12345:6789:9999'
    });
    assert.strictEqual(target.hwnd, 12345);
    assert.strictEqual(target.processId, 6789);
    assert.strictEqual(target.generation, '12345:6789:9999');
  });

  it('rejects invalid HWND or PID', () => {
    assert.throws(
      () => validateTargetIdentity({ hwnd: -1, processId: 10, generation: 'gen' }),
      /positive safe integer HWND/
    );

    assert.throws(
      () => validateTargetIdentity({ hwnd: 100, processId: -5, generation: 'gen' }),
      /positive safe integer PID/
    );

    assert.throws(
      () => validateTargetIdentity({ hwnd: 100, processId: 10, generation: '' }),
      /generation \/ process-start token/
    );
  });
});

describe('Guarded Action Executor', () => {
  const validSession = {
    sessionId: 'sess-123',
    expiresAt: Date.now() + 60000,
    state: 'active'
  };

  const validTarget = {
    hwnd: 1001,
    processId: 2002,
    generation: '1001:2002:111'
  };

  it('executes typeText when authority allows and target identity matches', async () => {
    let authorityEvaluated = false;
    let providerCalled = false;

    const mockAuthority = {
      async evaluateAction({ session, target, actionType }) {
        authorityEvaluated = true;
        assert.strictEqual(actionType, 'type_text');
        return { allowed: true };
      }
    };

    const mockProvider = {
      async inspectWindow(hwnd) {
        return {
          window: {
            hwnd,
            processId: 2002,
            generation: '1001:2002:111',
            minimized: false,
            visible: true
          }
        };
      },
      async writeText({ hwnd, text }) {
        providerCalled = true;
        assert.strictEqual(hwnd, 1001);
        assert.strictEqual(text, 'Success test');
        return { method: 'UIA_ValuePattern' };
      }
    };

    const executor = createGuardedExecutor({
      authorityPort: mockAuthority,
      windowsProvider: mockProvider
    });

    const result = await executor.typeText({
      session: validSession,
      target: validTarget,
      text: 'Success test'
    });

    assert.strictEqual(authorityEvaluated, true);
    assert.strictEqual(providerCalled, true);
    assert.strictEqual(result.status, 'executed');
    assert.strictEqual(result.charsWritten, 12);
  });

  it('denies effect when authority rejects (zero provider calls)', async () => {
    let providerCalled = false;

    const denyingAuthority = {
      async evaluateAction() {
        return { allowed: false, reason: 'grant_revoked' };
      }
    };

    const mockProvider = {
      async inspectWindow() {
        return { window: { hwnd: 1001, processId: 2002, generation: '1001:2002:111', visible: true, minimized: false } };
      },
      async writeText() {
        providerCalled = true;
      }
    };

    const executor = createGuardedExecutor({
      authorityPort: denyingAuthority,
      windowsProvider: mockProvider
    });

    await assert.rejects(
      async () => {
        await executor.typeText({
          session: validSession,
          target: validTarget,
          text: 'Deny test'
        });
      },
      (err) => {
        assert.ok(err instanceof ComputerAgentError);
        assert.strictEqual(err.code, AgentErrorCode.AUTHORITY_DENIED);
        return true;
      }
    );

    assert.strictEqual(providerCalled, false);
  });

  it('denies effect when target PID or generation changed (anti-recycled PID)', async () => {
    let providerCalled = false;

    const mockAuthority = {
      async evaluateAction() {
        return { allowed: true };
      }
    };

    const recycledPidProvider = {
      async inspectWindow(hwnd) {
        return {
          window: {
            hwnd,
            processId: 9999, // Changed PID!
            generation: '1001:9999:222',
            minimized: false,
            visible: true
          }
        };
      },
      async writeText() {
        providerCalled = true;
      }
    };

    const executor = createGuardedExecutor({
      authorityPort: mockAuthority,
      windowsProvider: recycledPidProvider
    });

    await assert.rejects(
      async () => {
        await executor.typeText({
          session: validSession,
          target: validTarget,
          text: 'Recycled test'
        });
      },
      (err) => {
        assert.ok(err instanceof ComputerAgentError);
        assert.strictEqual(err.code, AgentErrorCode.TARGET_MISMATCH);
        return true;
      }
    );

    assert.strictEqual(providerCalled, false);
  });

  it('denies effect when session is expired or revoked', async () => {
    const expiredSession = {
      ...validSession,
      expiresAt: Date.now() - 5000 // In the past!
    };

    const executor = createGuardedExecutor({
      authorityPort: { async evaluateAction() { return { allowed: true }; } },
      windowsProvider: {}
    });

    await assert.rejects(
      async () => {
        await executor.typeText({
          session: expiredSession,
          target: validTarget,
          text: 'Expired test'
        });
      },
      (err) => {
        assert.ok(err instanceof ComputerAgentError);
        assert.strictEqual(err.code, AgentErrorCode.AUTHORITY_EXPIRED);
        return true;
      }
    );
  });
});
