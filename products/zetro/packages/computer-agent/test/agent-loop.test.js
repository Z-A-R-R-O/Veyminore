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
  AgentErrorCode
} from '../src/index.js';

describe('Production Computer Agent Loop End-to-End', () => {
  function createTestFixture({
    initialText = '',
    targetApp = 'notepad',
    allowAuthority = true,
    inspectOverrides = {}
  } = {}) {
    let currentDocumentText = initialText;

    const mockAppRegistry = createApplicationRegistryPort({
      spawnProcess: (cmd, args, opts) => ({
        pid: 3001,
        unref() {}
      })
    });

    const mockPlanner = createPlannerPort();

    const mockObservation = {
      async enumerate({ limit = 100 } = {}) {
        return {
          windows: [
            {
              hwnd: 1001,
              processId: 3001,
              processName: 'notepad.exe',
              title: 'Untitled - Notepad',
              generation: '1001:3001:1000',
              minimized: false,
              visible: true,
              bounds: { x: 50, y: 50, width: 800, height: 600 },
              dpi: 96
            }
          ]
        };
      },
      async inspectWindow(hwnd) {
        return {
          window: {
            hwnd,
            processId: 3001,
            generation: '1001:3001:1000',
            title: 'Untitled - Notepad',
            text: currentDocumentText,
            minimized: false,
            visible: true,
            bounds: { x: 50, y: 50, width: 800, height: 600 },
            dpi: 96,
            ...inspectOverrides
          },
          automation: {
            name: 'Text Editor',
            controlType: 'Edit'
          }
        };
      }
    };

    const mockAuthority = {
      async evaluateAction({ session, target, actionType }) {
        if (!allowAuthority) {
          return { allowed: false, reason: 'grant_revoked' };
        }
        return { allowed: true };
      }
    };

    const mockWindowsProvider = {
      async inspectWindow(hwnd, opts) {
        return await mockObservation.inspectWindow(hwnd, opts);
      },
      async writeText({ hwnd, text }) {
        currentDocumentText += text;
        return { method: 'UIA_ValuePattern', charsWritten: text.length };
      },
      async focusWindow(hwnd) {
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
      getCurrentText: () => currentDocumentText
    };
  }

  it('runs Workflow A (Editor) end-to-end: prompt -> plan -> authorize -> act -> verify -> evidence', async () => {
    const fixture = createTestFixture();
    const session = {
      sessionId: 'sess-test-001',
      expiresAt: Date.now() + 60000,
      state: 'active'
    };

    const prompt = 'Open Notepad and type "Success — Codex completed this sentence using ZETRO Computing."';

    const result = await runComputerAgent({
      prompt,
      operatorId: 'Codex',
      taskId: 'task-editor-01',
      attemptId: 1,
      session,
      ports: fixture.ports
    });

    assert.strictEqual(result.status, AgentStatus.COMPLETED);
    assert.strictEqual(result.operatorId, 'Codex');
    assert.strictEqual(result.workflow, 'editor_text');
    assert.ok(result.steps.length >= 3);
    assert.ok(result.evidence);
    assert.strictEqual(result.evidence.type, 'editor_text_readback');
    assert.ok(fixture.getCurrentText().includes('Success — Codex completed this sentence using ZETRO Computing.'));

    // Check overlay ended in stopped state with aura inactive
    const overlaySnap = fixture.overlay.getSnapshot();
    assert.strictEqual(overlaySnap.state, OverlayState.STOPPED);
    assert.strictEqual(overlaySnap.auraActive, false);
    assert.strictEqual(overlaySnap.pointer.visible, false);
  });

  it('proves separate operator runs for Codex, AGR-1..6, and OCR-1..5 with unique identities', async () => {
    const operators = ['Codex', 'AGR-1', 'AGR-2', 'AGR-3', 'AGR-4', 'AGR-5', 'AGR-6', 'OCR-1', 'OCR-2', 'OCR-3', 'OCR-4', 'OCR-5'];

    for (const op of operators) {
      const fixture = createTestFixture();
      const session = {
        sessionId: `sess-${op.toLowerCase()}-1`,
        expiresAt: Date.now() + 60000,
        state: 'active'
      };

      const prompt = `Open a new Notepad document and type "Success — ${op} completed this sentence using ZETRO Computing."`;

      const result = await runComputerAgent({
        prompt,
        operatorId: op,
        taskId: `task-${op.toLowerCase()}-01`,
        attemptId: 1,
        session,
        ports: fixture.ports
      });

      assert.strictEqual(result.status, AgentStatus.COMPLETED, `Operator ${op} should have completed`);
      assert.strictEqual(result.operatorId, op);
      assert.strictEqual(result.sessionId, `sess-${op.toLowerCase()}-1`);
      assert.ok(result.evidence);
      assert.ok(fixture.getCurrentText().includes(`Success — ${op} completed this sentence using ZETRO Computing.`));
    }
  });

  it('blocks execution when authority denies action (zero effects written)', async () => {
    const fixture = createTestFixture({ allowAuthority: false });
    const session = {
      sessionId: 'sess-deny-001',
      expiresAt: Date.now() + 60000,
      state: 'active'
    };

    const result = await runComputerAgent({
      prompt: 'Open Notepad and type "Should never be typed"',
      operatorId: 'AGR-6',
      taskId: 'task-deny-01',
      attemptId: 1,
      session,
      ports: fixture.ports
    });

    assert.strictEqual(result.status, AgentStatus.BLOCKED);
    assert.strictEqual(result.errorCode, AgentErrorCode.AUTHORITY_DENIED);
    assert.strictEqual(fixture.getCurrentText(), '');
  });

  it('fails execution when post-observation UI text differs (independent verification failure)', async () => {
    // Override inspectWindow text to be wrong
    const fixture = createTestFixture({
      inspectOverrides: { text: 'Wrong text entered by external factor' }
    });
    const session = {
      sessionId: 'sess-verify-fail-001',
      expiresAt: Date.now() + 60000,
      state: 'active'
    };

    const result = await runComputerAgent({
      prompt: 'Open Notepad and type "Expected sentence"',
      operatorId: 'AGR-6',
      taskId: 'task-verify-fail-01',
      attemptId: 1,
      session,
      ports: fixture.ports
    });

    assert.strictEqual(result.status, AgentStatus.FAILED);
    assert.strictEqual(result.errorCode, AgentErrorCode.VERIFICATION_FAILED);
    assert.match(result.error, /Independent verification failed/);
  });

  it('aborts cleanly when cancellation signal is triggered', async () => {
    const fixture = createTestFixture();
    const controller = new AbortController();
    controller.abort(); // Pre-aborted

    const session = {
      sessionId: 'sess-cancel-001',
      expiresAt: Date.now() + 60000,
      state: 'active'
    };

    const result = await runComputerAgent({
      prompt: 'Open Notepad and type "Cancelled test"',
      operatorId: 'AGR-6',
      taskId: 'task-cancel-01',
      attemptId: 1,
      session,
      signal: controller.signal,
      ports: fixture.ports
    });

    assert.strictEqual(result.status, AgentStatus.BLOCKED);
    assert.strictEqual(result.errorCode, AgentErrorCode.PLANNER_BLOCKED);
  });
});
