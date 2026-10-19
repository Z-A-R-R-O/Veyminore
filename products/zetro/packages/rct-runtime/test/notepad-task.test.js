import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runNotepadSuccessTask,
  runPromptDrivenTask,
  NOTEPAD_SUCCESS_SENTENCE,
  SUPPORTED_INTENT_SUBSET,
  APPLICATION_REGISTRY,
  resolveApplication,
  parseComputingPromptIntent,
  planComputingSkill,
  createWindowsProviderObserverAdapter,
  createNotepadTextVerifier
} from '../src/index.js';

describe('Prompt-Driven ZETRO Computing Skill & Notepad Task Adapter', () => {
  const createValidTarget = (overrides = {}) => ({
    targetId: 'win-notepad-001',
    processId: 4321,
    windowHandle: '0x000A1234',
    title: 'Untitled - Notepad',
    processStartedAt: 1700000000000,
    generation: 'notepad-gen-1',
    ...overrides
  });

  const createValidSession = (overrides = {}) => ({
    sessionId: 'sess-notepad-001',
    taskId: 'task-notepad-proof',
    attemptId: 1,
    status: 'active',
    expiresAt: Date.now() + 60000,
    principal: 'AGR-2',
    target: createValidTarget(),
    ...overrides
  });

  const createMockAuthority = (granted = true, overrides = {}) => ({
    evaluateAction: async () => ({
      granted,
      grantId: 'grant-notepad-001',
      reason: granted ? 'authorized' : 'policy_denied',
      ...overrides
    }),
    isRevoked: () => false
  });

  const createMockWindowsProvider = (observationOverrides = {}) => ({
    inspectWindow: async (hwnd) => ({
      status: 'inspected',
      observedAt: Date.now(),
      isForeground: true,
      window: {
        hwnd,
        processId: 4321,
        processName: 'notepad.exe',
        minimized: false,
        visible: true,
        processStartedAt: 1700000000000,
        generation: 'notepad-gen-1',
        title: 'Untitled - Notepad',
        bounds: { x: 50, y: 50, width: 800, height: 600 }
      },
      automation: {
        supported: true,
        controlType: 'Document',
        name: 'Text Editor',
        value: ''
      },
      ...observationOverrides
    })
  });

  const createMockExecutor = (resultOverrides = {}) => {
    let callCount = 0;
    return {
      get callCount() { return callCount; },
      executeAction: async () => {
        callCount++;
        return {
          ok: true,
          effectAt: Date.now(),
          uncertain: false,
          ...resultOverrides
        };
      }
    };
  };

  // 1. Explicit nativeInputEnabled and fixtureOptIn gates
  it('1. Default disabled: throws and denies 0 executor calls when nativeInputEnabled is omitted or false', async () => {
    const executor = createMockExecutor();
    await assert.rejects(
      async () => {
        await runNotepadSuccessTask({
          windowsProvider: createMockWindowsProvider(),
          authorityPort: createMockAuthority(),
          executor,
          target: createValidTarget(),
          session: createValidSession(),
          options: { fixtureOptIn: true } // nativeInputEnabled omitted
        });
      },
      (err) => {
        assert.equal(err.name, 'NativeInputDisabledError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  it('2. Default disabled: throws and denies 0 executor calls when fixtureOptIn is omitted or false', async () => {
    const executor = createMockExecutor();
    await assert.rejects(
      async () => {
        await runNotepadSuccessTask({
          windowsProvider: createMockWindowsProvider(),
          authorityPort: createMockAuthority(),
          executor,
          target: createValidTarget(),
          session: createValidSession(),
          options: { nativeInputEnabled: true } // fixtureOptIn omitted
        });
      },
      (err) => {
        assert.equal(err.name, 'FixtureOptInRequiredError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  // 2. Application Registry & Resolution
  it('3. Application registry: allows notepad and aliases, rejects unsupported applications', () => {
    assert.ok(resolveApplication('notepad').resolved);
    assert.ok(resolveApplication('Notepad').resolved);
    assert.ok(resolveApplication('notepad.exe').resolved);
    assert.ok(resolveApplication('text editor').resolved);

    const unsupported = resolveApplication('calculator');
    assert.equal(unsupported.resolved, false);
    assert.equal(unsupported.reason, 'unsupported_application');
  });

  it('4. Application registry security: rejects shell metacharacters and path traversal', () => {
    for (const malicious of ['notepad; calc.exe', 'notepad && rm -rf /', '../notepad.exe', 'notepad|cmd', '-arg']) {
      const result = resolveApplication(malicious);
      assert.equal(result.resolved, false);
      assert.equal(result.reason, 'malicious_arguments');
    }
  });

  // 3. Prompt Intent Parser & Paraphrases
  it('5. Prompt parser: extracts application and exact text for standard prompt and paraphrases', () => {
    const p1 = parseComputingPromptIntent('Open a new Notepad document and type "Success — AGR-1 completed this task using ZETRO Computing."');
    assert.equal(p1.ok, true);
    assert.equal(p1.application.appId, 'notepad');
    assert.equal(p1.text, 'Success — AGR-1 completed this task using ZETRO Computing.');

    const p2 = parseComputingPromptIntent('Launch Notepad and write "Success — Codex, AGR, and OCR completed this sentence using ZETRO Computing."');
    assert.equal(p2.ok, true);
    assert.equal(p2.text, NOTEPAD_SUCCESS_SENTENCE);

    const p3 = parseComputingPromptIntent('Please open a new Notepad file and enter: "Hello from OCR-2"');
    assert.equal(p3.ok, true);
    assert.equal(p3.text, 'Hello from OCR-2');

    const p4 = parseComputingPromptIntent('Start Notepad, then type "Sample text" into the document');
    assert.equal(p4.ok, true);
    assert.equal(p4.text, 'Sample text');

    const p5 = parseComputingPromptIntent('In Notepad, type \'Testing single quotes\'');
    assert.equal(p5.ok, true);
    assert.equal(p5.text, 'Testing single quotes');

    // Typographic unicode quotes
    const p6 = parseComputingPromptIntent('Open notepad and type “Unicode typographic quotes”');
    assert.equal(p6.ok, true);
    assert.equal(p6.text, 'Unicode typographic quotes');
  });

  it('6. Prompt parser: blocks ambiguous or unsupported requests without guessing', () => {
    // Missing app
    const b1 = parseComputingPromptIntent('Type "hello world" into the window');
    assert.equal(b1.ok, false);
    assert.equal(b1.blocked, true);
    assert.equal(b1.reason, 'ambiguous_prompt');

    // Missing text
    const b2 = parseComputingPromptIntent('Open notepad and type');
    assert.equal(b2.ok, false);
    assert.equal(b2.blocked, true);
    assert.equal(b2.reason, 'ambiguous_prompt');

    // Unsupported application
    const b3 = parseComputingPromptIntent('Open Calculator and type "123"');
    assert.equal(b3.ok, false);
    assert.equal(b3.blocked, true);
    assert.equal(b3.reason, 'unsupported_application');

    // Unsupported intent
    const b4 = parseComputingPromptIntent('Browse the web for news');
    assert.equal(b4.ok, false);
    assert.equal(b4.blocked, true);
    assert.equal(b4.reason, 'unsupported_intent');

    // Malicious shell injection
    const b5 = parseComputingPromptIntent('Open notepad; rm -rf / and type "pwnd"');
    assert.equal(b5.ok, false);
    assert.equal(b5.blocked, true);
    assert.equal(b5.reason, 'malicious_arguments');
  });

  // 4. Deterministic Skill Planner
  it('7. planComputingSkill: generates structured plan without external inference', () => {
    const plan = planComputingSkill({
      prompt: 'Open a new Notepad document and type "Hello World"',
      operatorId: 'AGR-1',
      taskId: 'task-agr1-01',
      sessionId: 'sess-agr1-01',
      attemptId: 1
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.operatorId, 'AGR-1');
    assert.equal(plan.application.appId, 'notepad');
    assert.equal(plan.expectedText, 'Hello World');
    assert.equal(plan.plan.length, 3);
    assert.equal(plan.plan[0].action, 'resolve_target');
    assert.equal(plan.plan[1].action, 'type_text');
    assert.equal(plan.plan[2].action, 'verify_readback');
  });

  // 5. Separate Operator Runs
  it('8. Separate operator runs: Codex, AGR-1, and OCR-3 execute distinct sessions and dynamic text', async () => {
    const operators = [
      { id: 'Codex', text: NOTEPAD_SUCCESS_SENTENCE },
      { id: 'AGR-1', text: 'Success — AGR-1 completed this task using ZETRO Computing.' },
      { id: 'OCR-3', text: 'Success — OCR-3 completed this task using ZETRO Computing.' }
    ];

    const receipts = [];

    for (const op of operators) {
      let readbackText = '';
      const executor = {
        executeAction: async () => {
          readbackText = op.text; // Native input injects text
          return { ok: true };
        }
      };

      const windowsProvider = {
        inspectWindow: async (hwnd) => ({
          status: 'inspected',
          observedAt: Date.now(),
          isForeground: true,
          window: {
            hwnd,
            processId: 5000,
            processName: 'notepad.exe',
            minimized: false,
            visible: true,
            processStartedAt: 1700000000000,
            generation: `gen-${op.id}`,
            title: 'Untitled - Notepad'
          },
          text: readbackText // Readback reflects actual document text
        })
      };

      const receipt = await runPromptDrivenTask({
        prompt: `Open a new Notepad document and type "${op.text}"`,
        operatorId: op.id,
        windowsProvider,
        authorityPort: createMockAuthority(),
        executor,
        target: createValidTarget({ processId: 5000, generation: `gen-${op.id}` }),
        session: createValidSession({
          sessionId: `sess-${op.id}`,
          taskId: `task-${op.id}`,
          principal: op.id,
          target: createValidTarget({ processId: 5000, generation: `gen-${op.id}` })
        }),
        options: { nativeInputEnabled: true, fixtureOptIn: true }
      });

      assert.equal(receipt.status, 'completed');
      assert.equal(receipt.verified, true);
      assert.equal(receipt.sessionId, `sess-${op.id}`);
      assert.equal(receipt.taskId, `task-${op.id}`);
      assert.ok(receipt.evidenceHash);
      receipts.push(receipt);
    }

    // Every operator run produces a unique, distinct evidence hash and session
    assert.notEqual(receipts[0].evidenceHash, receipts[1].evidenceHash);
    assert.notEqual(receipts[1].evidenceHash, receipts[2].evidenceHash);
    assert.notEqual(receipts[0].sessionId, receipts[1].sessionId);
  });

  // 6. Blocked prompt denies execution with 0 executor calls
  it('9. Blocked prompt halts immediately with BlockedPromptError and 0 executor calls', async () => {
    const executor = createMockExecutor();
    await assert.rejects(
      async () => {
        await runNotepadSuccessTask({
          prompt: 'Open calculator and type "123"', // Unsupported app
          windowsProvider: createMockWindowsProvider(),
          authorityPort: createMockAuthority(),
          executor,
          target: createValidTarget(),
          session: createValidSession(),
          options: { nativeInputEnabled: true, fixtureOptIn: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'BlockedPromptError');
        assert.equal(err.reason, 'unsupported_application');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  // 7. Negative Invariants & Guards (All produce 0 executor calls)
  it('10. Recycled PID prevention: processStartedAt mismatch denies execution with 0 executor calls', async () => {
    const executor = createMockExecutor();
    // Target expects start time 1000, but provider reports newly recycled process at 2000
    const provider = {
      inspectWindow: async (hwnd) => ({
        status: 'inspected',
        observedAt: Date.now(),
        isForeground: true,
        window: {
          hwnd,
          processId: 4321,
          processStartedAt: 2000000000000, // Different process launch time
          generation: 'notepad-gen-1',
          minimized: false,
          visible: true
        }
      })
    };

    await assert.rejects(
      async () => {
        await runNotepadSuccessTask({
          windowsProvider: provider,
          authorityPort: createMockAuthority(),
          executor,
          target: createValidTarget({ processStartedAt: 1000000000000 }),
          session: createValidSession({ target: createValidTarget({ processStartedAt: 1000000000000 }) }),
          options: { nativeInputEnabled: true, fixtureOptIn: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'TargetIdentityMismatchError');
        assert.ok(err.message.includes('recycled PID detected'));
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  it('11. Foreground changed before executor dispatch denies execution with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const provider = {
      inspectWindow: async (hwnd) => ({
        status: 'inspected',
        observedAt: Date.now(),
        isForeground: false, // Window is not in foreground!
        window: {
          hwnd,
          processId: 4321,
          processStartedAt: 1700000000000,
          generation: 'notepad-gen-1',
          minimized: false,
          visible: true
        }
      })
    };

    await assert.rejects(
      async () => {
        await runNotepadSuccessTask({
          windowsProvider: provider,
          authorityPort: createMockAuthority(),
          executor,
          target: createValidTarget(),
          session: createValidSession(),
          options: { nativeInputEnabled: true, fixtureOptIn: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'ForegroundChangedError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  it('12. Grant revocation immediately before executor dispatch denies with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const authority = {
      evaluateAction: async () => ({ granted: true, grantId: 'grant-rev-1' }),
      isRevoked: (grantId) => grantId === 'grant-rev-1' // Revoked right after evaluation
    };

    await assert.rejects(
      async () => {
        await runNotepadSuccessTask({
          windowsProvider: createMockWindowsProvider(),
          authorityPort: authority,
          executor,
          target: createValidTarget(),
          session: createValidSession(),
          options: { nativeInputEnabled: true, fixtureOptIn: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'GrantRevokedError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  it('13. Boundary expiry (Date.now() === expiresAt) denies execution with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const now = Date.now();

    await assert.rejects(
      async () => {
        await runNotepadSuccessTask({
          windowsProvider: createMockWindowsProvider(),
          authorityPort: createMockAuthority(),
          executor,
          target: createValidTarget(),
          session: createValidSession({ expiresAt: now }),
          options: { nativeInputEnabled: true, fixtureOptIn: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'SessionExpiredError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  // 8. Independent Readback Verifier vs Echoed Text
  it('14. Echoed text alone CANNOT certify verification: fails unverified_effect if postObservation text does not match', async () => {
    // Executor untruthfully claims it typed the sentence in echoed result
    const executor = createMockExecutor({
      ok: true,
      text: NOTEPAD_SUCCESS_SENTENCE,
      echoed: NOTEPAD_SUCCESS_SENTENCE
    });

    // Observer's post-observation reveals actual document is still empty
    let observeCount = 0;
    const provider = {
      inspectWindow: async (hwnd) => {
        observeCount++;
        return {
          status: 'inspected',
          observedAt: Date.now(),
          isForeground: true,
          window: {
            hwnd,
            processId: 4321,
            processStartedAt: 1700000000000,
            generation: 'notepad-gen-1',
            minimized: false,
            visible: true
          },
          text: '' // Still empty!
        };
      }
    };

    const receipt = await runNotepadSuccessTask({
      windowsProvider: provider,
      authorityPort: createMockAuthority(),
      executor,
      target: createValidTarget(),
      session: createValidSession(),
      options: { nativeInputEnabled: true, fixtureOptIn: true }
    });

    assert.equal(receipt.status, 'unverified_effect');
    assert.equal(receipt.verified, false);
    assert.equal(receipt.verification.verified, false);
    assert.equal(executor.callCount, 1);
  });

  it('15. Positive execution: typed sentence confirmed by independent post-observation readback', async () => {
    let currentDocText = '';
    const executor = {
      executeAction: async () => {
        currentDocText = NOTEPAD_SUCCESS_SENTENCE;
        return { ok: true };
      }
    };

    const provider = {
      inspectWindow: async (hwnd) => ({
        status: 'inspected',
        observedAt: Date.now(),
        isForeground: true,
        window: {
          hwnd,
          processId: 4321,
          processStartedAt: 1700000000000,
          generation: 'notepad-gen-1',
          minimized: false,
          visible: true
        },
        text: currentDocText
      })
    };

    const receipt = await runNotepadSuccessTask({
      windowsProvider: provider,
      authorityPort: createMockAuthority(),
      executor,
      target: createValidTarget(),
      session: createValidSession(),
      options: { nativeInputEnabled: true, fixtureOptIn: true }
    });

    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.verified, true);
    assert.equal(receipt.verification.verified, true);
    assert.ok(receipt.verification.reason.includes('Independent UIAutomation readback confirmed'));
    assert.ok(receipt.evidenceHash);
  });
});
