import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  runComputerAgent,
  createApplicationRegistryPort,
  createPlannerPort,
  createGuardedExecutor,
  createVerifierPort,
  AuthoritativeOverlayBridge,
  OverlayState,
  AgentStatus,
  AgentErrorCode,
  ComputerAgentError
} from '../src/index.js';

describe('POST-BUILD-STRESS-TEST-PLAN: Fault & Resilience Campaign', () => {
  function createFaultInjectableFixture(faults = {}) {
    let effectCount = 0;
    let observerCount = 0;
    let currentText = '';

    const mockAppRegistry = createApplicationRegistryPort({
      spawnProcess: () => ({ pid: 8888, unref() {} })
    });

    const mockPlanner = createPlannerPort({
      llmPlanner: faults.malformedPlanner
        ? async () => ({ plan: 'not an array' }) // Malformed planner output
        : null
    });

    const mockObservation = {
      async enumerate() {
        observerCount += 1;
        if (faults.staleObservation) {
          return { windows: [] }; // Window disappeared / stale
        }
        return {
          windows: [
            {
              hwnd: 1001,
              processId: 8888,
              processName: 'notepad.exe',
              title: 'Untitled - Notepad',
              generation: '1001:8888:1000',
              minimized: faults.windowMinimized || false,
              visible: faults.windowHidden ? false : true,
              bounds: { x: 50, y: 50, width: 800, height: 600 }
            }
          ]
        };
      },
      async inspectWindow(hwnd) {
        observerCount += 1;
        if (faults.uiDisconnect) {
          throw new Error('RPC_S_SERVER_UNAVAILABLE: UI disconnect');
        }
        return {
          window: {
            hwnd,
            processId: faults.wrongPid ? 9999 : 8888,
            generation: faults.reusedPidGeneration ? '1001:8888:NEW_GEN' : '1001:8888:1000',
            title: 'Untitled - Notepad',
            text: currentText,
            minimized: faults.windowMinimized || false,
            visible: faults.windowHidden ? false : true
          }
        };
      }
    };

    const mockAuthority = {
      async evaluateAction({ session }) {
        if (faults.revocationDuringAwait) {
          session.state = 'revoked';
          return { allowed: false, reason: 'revocation_during_await' };
        }
        if (faults.expiryDuringAwait) {
          session.expiresAt = Date.now() - 1000;
          return { allowed: false, reason: 'grant_expired' };
        }
        return { allowed: true };
      }
    };

    const mockWindowsProvider = {
      async inspectWindow(hwnd, opts) {
        return await mockObservation.inspectWindow(hwnd, opts);
      },
      async writeText({ text }) {
        if (faults.crashDuringNativeEffect) {
          throw new Error('CRASH_WINDOW: Process died during native SendInput effect');
        }
        effectCount += 1;
        currentText += text;
        return { charsWritten: text.length };
      },
      async focusWindow() {
        return true;
      }
    };

    const mockExecutor = createGuardedExecutor({
      authorityPort: mockAuthority,
      windowsProvider: mockWindowsProvider
    });

    const mockVerifier = createVerifierPort();
    const overlay = new AuthoritativeOverlayBridge();

    return {
      ports: {
        appRegistry: mockAppRegistry,
        planner: mockPlanner,
        observation: mockObservation,
        authority: mockAuthority,
        executor: mockExecutor,
        verifier: mockVerifier,
        overlay
      },
      overlay,
      getEffectCount: () => effectCount,
      getObserverCount: () => observerCount
    };
  }

  it('fault: wrong / reused PID fails closed before effect (0 effects)', async () => {
    const fixture = createFaultInjectableFixture({ wrongPid: true });
    const session = { sessionId: 'sess-fault-1', expiresAt: Date.now() + 60000, state: 'active' };

    const result = await runComputerAgent({
      prompt: 'Open Notepad and type "Test text"',
      operatorId: 'AGR-6',
      taskId: 'fault-wrong-pid',
      attemptId: 1,
      session,
      ports: fixture.ports
    });

    assert.strictEqual(result.status, AgentStatus.FAILED);
    assert.strictEqual(result.errorCode, AgentErrorCode.TARGET_MISMATCH);
    assert.strictEqual(fixture.getEffectCount(), 0);
  });

  it('fault: generation mismatch (reused PID prevention) halts with zero effect', async () => {
    const fixture = createFaultInjectableFixture({ reusedPidGeneration: true });
    const session = { sessionId: 'sess-fault-2', expiresAt: Date.now() + 60000, state: 'active' };

    const result = await runComputerAgent({
      prompt: 'Open Notepad and type "Test text"',
      operatorId: 'AGR-6',
      taskId: 'fault-reused-gen',
      attemptId: 1,
      session,
      ports: fixture.ports
    });

    assert.strictEqual(result.status, AgentStatus.FAILED);
    assert.strictEqual(result.errorCode, AgentErrorCode.TARGET_REPLACED);
    assert.strictEqual(fixture.getEffectCount(), 0);
  });

  it('fault: minimized window rejects input without blindly typing', async () => {
    const fixture = createFaultInjectableFixture({ windowMinimized: true });
    const session = { sessionId: 'sess-fault-3', expiresAt: Date.now() + 60000, state: 'active' };

    const result = await runComputerAgent({
      prompt: 'Open Notepad and type "Test text"',
      operatorId: 'AGR-6',
      taskId: 'fault-minimized',
      attemptId: 1,
      session,
      ports: fixture.ports
    });

    assert.strictEqual(result.status, AgentStatus.FAILED);
    assert.strictEqual(result.errorCode, AgentErrorCode.TARGET_MINIMIZED);
    assert.strictEqual(fixture.getEffectCount(), 0);
  });

  it('fault: hidden window rejects input explicitly', async () => {
    const fixture = createFaultInjectableFixture({ windowHidden: true });
    const session = { sessionId: 'sess-fault-4', expiresAt: Date.now() + 60000, state: 'active' };

    const result = await runComputerAgent({
      prompt: 'Open Notepad and type "Test text"',
      operatorId: 'AGR-6',
      taskId: 'fault-hidden',
      attemptId: 1,
      session,
      ports: fixture.ports
    });

    assert.strictEqual(result.status, AgentStatus.FAILED);
    assert.strictEqual(result.errorCode, AgentErrorCode.TARGET_NOT_VISIBLE);
    assert.strictEqual(fixture.getEffectCount(), 0);
  });

  it('fault: revocation during await denies action and halts cleanly', async () => {
    const fixture = createFaultInjectableFixture({ revocationDuringAwait: true });
    const session = { sessionId: 'sess-fault-5', expiresAt: Date.now() + 60000, state: 'active' };

    const result = await runComputerAgent({
      prompt: 'Open Notepad and type "Test text"',
      operatorId: 'AGR-6',
      taskId: 'fault-revocation',
      attemptId: 1,
      session,
      ports: fixture.ports
    });

    assert.strictEqual(result.status, AgentStatus.BLOCKED);
    assert.strictEqual(result.errorCode, AgentErrorCode.AUTHORITY_DENIED);
    assert.strictEqual(fixture.getEffectCount(), 0);
  });

  it('fault: expiry during await denies action and halts cleanly', async () => {
    const fixture = createFaultInjectableFixture({ expiryDuringAwait: true });
    const session = { sessionId: 'sess-fault-6', expiresAt: Date.now() + 60000, state: 'active' };

    const result = await runComputerAgent({
      prompt: 'Open Notepad and type "Test text"',
      operatorId: 'AGR-6',
      taskId: 'fault-expiry',
      attemptId: 1,
      session,
      ports: fixture.ports
    });

    assert.strictEqual(result.status, AgentStatus.BLOCKED);
    assert.strictEqual(result.errorCode, AgentErrorCode.AUTHORITY_DENIED);
    assert.strictEqual(fixture.getEffectCount(), 0);
  });

  it('fault: crash during native effect records uncertainty and does not retry blindly', async () => {
    const fixture = createFaultInjectableFixture({ crashDuringNativeEffect: true });
    const session = { sessionId: 'sess-fault-7', expiresAt: Date.now() + 60000, state: 'active' };

    const result = await runComputerAgent({
      prompt: 'Open Notepad and type "Uncertain crash test"',
      operatorId: 'AGR-6',
      taskId: 'fault-crash',
      attemptId: 1,
      session,
      ports: fixture.ports
    });

    assert.strictEqual(result.status, AgentStatus.UNCERTAIN);
    assert.strictEqual(result.errorCode, AgentErrorCode.UNCERTAIN_EFFECT);
    assert.strictEqual(result.metrics.unknownCostEvents, 1);
  });

  it('fault: malformed planner output fails closed safely', async () => {
    const fixture = createFaultInjectableFixture({ malformedPlanner: true });
    const session = { sessionId: 'sess-fault-8', expiresAt: Date.now() + 60000, state: 'active' };

    const result = await runComputerAgent({
      prompt: 'Open Notepad and type "Malformed plan test"',
      operatorId: 'AGR-6',
      taskId: 'fault-malformed-plan',
      attemptId: 1,
      session,
      ports: fixture.ports
    });

    assert.strictEqual(result.status, AgentStatus.BLOCKED);
    assert.strictEqual(fixture.getEffectCount(), 0);
  });

  it('stress: multiple concurrent requests handle isolation without state leakage', async () => {
    const sessions = [1, 2, 3, 4, 5].map(i => ({
      sessionId: `sess-concurrent-${i}`,
      expiresAt: Date.now() + 60000,
      state: 'active'
    }));

    const promises = sessions.map((sess, idx) => {
      const fixture = createFaultInjectableFixture();
      return runComputerAgent({
        prompt: `Open Notepad and type "Concurrent wave ${idx}"`,
        operatorId: `AGR-6-worker-${idx}`,
        taskId: `concurrent-task-${idx}`,
        attemptId: 1,
        session: sess,
        ports: fixture.ports
      });
    });

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 5);
    for (const r of results) {
      assert.strictEqual(r.status, AgentStatus.COMPLETED);
      assert.ok(r.evidence);
    }
  });
});
