import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeComputerAction,
  validateComputerActionRequest,
  validateComputerTarget,
  validateComputerSession,
  ComputerActionPort,
  COMPUTER_ACTION_SCHEMA_VERSION,
  COMPUTER_RECEIPT_SCHEMA_VERSION
} from '../src/index.js';

describe('Injected Computer Action-Execution Port Contract', () => {
  const createValidTarget = (overrides = {}) => ({
    targetId: 'win-calc-101',
    processId: 1234,
    windowHandle: '0x0012ABCD',
    title: 'Calculator',
    displayId: 'disp-primary',
    ...overrides
  });

  const createValidRequest = (overrides = {}) => ({
    schemaVersion: COMPUTER_ACTION_SCHEMA_VERSION,
    actionId: 'act-click-001',
    actionType: 'mouse_click',
    target: createValidTarget(),
    parameters: { x: 150, y: 220, button: 'left' },
    sessionId: 'sess-alpha-001',
    taskId: 'task-calc-eval',
    attemptId: 1,
    ...overrides
  });

  const createValidSession = (overrides = {}) => ({
    sessionId: 'sess-alpha-001',
    taskId: 'task-calc-eval',
    attemptId: 1,
    status: 'active',
    expiresAt: Date.now() + 60000,
    principal: 'worker',
    target: createValidTarget(),
    ...overrides
  });

  const createMockAuthority = (granted = true, overrides = {}) => ({
    evaluateAction: async () => ({
      granted,
      grantId: 'grant-001',
      reason: granted ? 'authorized' : 'policy_denied',
      ...overrides
    }),
    isRevoked: () => false
  });

  const createMockObserver = (observationOverrides = {}) => ({
    observeTarget: async (target) => ({
      observedAt: Date.now(),
      targetId: target.targetId,
      processId: target.processId,
      windowHandle: target.windowHandle,
      title: target.title || 'Calculator',
      displayId: target.displayId || 'disp-primary',
      active: true,
      bounds: { x: 100, y: 100, width: 400, height: 600 },
      snapshotHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
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

  const createMockVerifier = (verified = true, overrides = {}) => ({
    verifyEffect: async () => ({
      verified,
      reason: verified ? 'Effect confirmed by UI automation state check' : 'Effect not detected',
      evidenceHash: 'a'.repeat(64),
      checks: [{ type: 'button_state', passed: verified }],
      ...overrides
    })
  });

  // 1. Explicit nativeInputEnabled gate
  it('1. nativeInputEnabled defaults to false: throws and denies 0 executor calls when omitted or false', async () => {
    const executor = createMockExecutor();
    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest(),
          session: createValidSession(),
          authorityPort: createMockAuthority(),
          observer: createMockObserver(),
          executor,
          verifier: createMockVerifier(),
          options: {} // nativeInputEnabled omitted
        });
      },
      (err) => {
        assert.equal(err.name, 'NativeInputDisabledError');
        assert.ok(err.message.includes('options.nativeInputEnabled must be literal true'));
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  it('2. nativeInputEnabled must be literal true: rejects truthy non-booleans with 0 executor calls', async () => {
    const executor = createMockExecutor();
    for (const invalidVal of ['true', 1, {}, [], '1']) {
      await assert.rejects(
        async () => {
          await executeComputerAction({
            actionRequest: createValidRequest(),
            session: createValidSession(),
            authorityPort: createMockAuthority(),
            observer: createMockObserver(),
            executor,
            verifier: createMockVerifier(),
            options: { nativeInputEnabled: invalidVal }
          });
        },
        (err) => {
          assert.equal(err.name, 'NativeInputDisabledError');
          assert.equal(executor.callCount, 0);
          return true;
        }
      );
    }
  });

  // 2. Cancellation and Session Status Pre-checks
  it('3. Pre-aborted signal denies execution with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest(),
          session: createValidSession(),
          authorityPort: createMockAuthority(),
          observer: createMockObserver(),
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true, signal: controller.signal }
        });
      },
      (err) => {
        assert.equal(err.name, 'AbortError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  it('4. Rejects inactive session (paused, stopped, expired) with 0 executor calls', async () => {
    const executor = createMockExecutor();
    for (const status of ['paused', 'stopped', 'expired']) {
      await assert.rejects(
        async () => {
          await executeComputerAction({
            actionRequest: createValidRequest(),
            session: createValidSession({ status }),
            authorityPort: createMockAuthority(),
            observer: createMockObserver(),
            executor,
            verifier: createMockVerifier(),
            options: { nativeInputEnabled: true }
          });
        },
        (err) => {
          assert.equal(err.name, 'InactiveSessionError');
          assert.equal(executor.callCount, 0);
          return true;
        }
      );
    }
  });

  it('5. Rejects session whose expiresAt timestamp is in the past with 0 executor calls', async () => {
    const executor = createMockExecutor();
    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest(),
          session: createValidSession({ expiresAt: Date.now() - 1000 }),
          authorityPort: createMockAuthority(),
          observer: createMockObserver(),
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'SessionExpiredError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  it('6. Rejects stale attemptId (attempt 1 vs session attempt 2) with 0 executor calls', async () => {
    const executor = createMockExecutor();
    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest({ attemptId: 1 }),
          session: createValidSession({ attemptId: 2 }),
          authorityPort: createMockAuthority(),
          observer: createMockObserver(),
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'AttemptMismatchError');
        assert.ok(err.message.includes('stale attempt rejection'));
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  it('7. Rejects taskId or sessionId mismatch with 0 executor calls', async () => {
    const executor = createMockExecutor();
    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest({ taskId: 'wrong-task' }),
          session: createValidSession({ taskId: 'task-calc-eval' }),
          authorityPort: createMockAuthority(),
          observer: createMockObserver(),
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'TaskMismatchError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest({ sessionId: 'wrong-sess' }),
          session: createValidSession({ sessionId: 'sess-alpha-001' }),
          authorityPort: createMockAuthority(),
          observer: createMockObserver(),
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'SessionMismatchError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  // 3. Authority evaluation
  it('8. Authority denial halts execution immediately with 0 executor calls', async () => {
    const executor = createMockExecutor();
    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest(),
          session: createValidSession(),
          authorityPort: createMockAuthority(false, { reason: 'restricted_window' }),
          observer: createMockObserver(),
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'AuthorityDenialError');
        assert.ok(err.message.includes('restricted_window'));
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  // 4. Pre-effect Target Observation and Identity Verification
  it('9. Rejects target identity mismatch on processId with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const observer = createMockObserver({ processId: 9999 }); // Changed process ID

    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest({ target: createValidTarget({ processId: 1234 }) }),
          session: createValidSession({ target: createValidTarget({ processId: 1234 }) }),
          authorityPort: createMockAuthority(),
          observer,
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'TargetIdentityMismatchError');
        assert.ok(err.message.includes('processId'));
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  it('10. Rejects target identity mismatch on windowHandle with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const observer = createMockObserver({ windowHandle: '0x0099FFFF' });

    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest({ target: createValidTarget({ windowHandle: '0x0012ABCD' }) }),
          session: createValidSession({ target: createValidTarget({ windowHandle: '0x0012ABCD' }) }),
          authorityPort: createMockAuthority(),
          observer,
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'TargetIdentityMismatchError');
        assert.ok(err.message.includes('windowHandle'));
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  it('11. Rejects inactive or minimized target window with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const observer = createMockObserver({ active: false });

    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest(),
          session: createValidSession(),
          authorityPort: createMockAuthority(),
          observer,
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'InactiveTargetWindowError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  it('12. Rejects stale observation older than maxObservationAgeMs with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const observer = createMockObserver({ observedAt: Date.now() - 10000 }); // 10s old

    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest(),
          session: createValidSession(),
          authorityPort: createMockAuthority(),
          observer,
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true, maxObservationAgeMs: 5000 }
        });
      },
      (err) => {
        assert.equal(err.name, 'StaleObservationError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  // 5. Immediate Pre-effect Recheck (Grant Revocation)
  it('13. Immediate pre-effect grant revocation halts with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const authority = {
      evaluateAction: async () => ({ granted: true, grantId: 'grant-rev-1' }),
      isRevoked: (grantId) => grantId === 'grant-rev-1' // Revoked right after evaluation
    };

    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest(),
          session: createValidSession(),
          authorityPort: authority,
          observer: createMockObserver(),
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'GrantRevokedError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  // 6. Uncertain Input Handling - NO RETRY
  it('14. NO RETRY on uncertain input: executor reporting uncertain returns uncertain status and never retries', async () => {
    const executor = createMockExecutor({ ok: false, uncertain: true });

    const receipt = await executeComputerAction({
      actionRequest: createValidRequest(),
      session: createValidSession(),
      authorityPort: createMockAuthority(),
      observer: createMockObserver(),
      executor,
      verifier: createMockVerifier(),
      options: { nativeInputEnabled: true }
    });

    assert.equal(receipt.status, 'uncertain');
    assert.equal(receipt.uncertain, true);
    assert.equal(receipt.verified, false);
    assert.ok(receipt.failureReason.includes('no retry allowed on uncertain input'));
    assert.equal(executor.callCount, 1, 'Executor must be invoked exactly once; NO RETRIES on uncertain input');
    assert.ok(receipt.evidenceHash);
  });

  // 7. Bounded Execution Timeout
  it('15. Executor timeout settles without hanging and marks uncertain with 0 retries', async () => {
    let callCount = 0;
    const hangingExecutor = {
      executeAction: async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { ok: true };
      }
    };

    const receipt = await executeComputerAction({
      actionRequest: createValidRequest(),
      session: createValidSession(),
      authorityPort: createMockAuthority(),
      observer: createMockObserver(),
      executor: hangingExecutor,
      verifier: createMockVerifier(),
      options: { nativeInputEnabled: true, timeoutMs: 50 } // 50ms ceiling
    });

    assert.equal(receipt.status, 'timeout');
    assert.equal(receipt.uncertain, true);
    assert.equal(receipt.verified, false);
    assert.equal(callCount, 1);
  });

  // 8. Positive Execution & Trusted Verification
  it('16. Positive execution: invokes observer before/after, executes bounded action, and verifies with trusted verifier', async () => {
    let preObserved = false;
    let postObserved = false;
    const observer = {
      observeTarget: async (target) => {
        if (!preObserved) {
          preObserved = true;
          return {
            observedAt: Date.now(),
            targetId: target.targetId,
            processId: target.processId,
            windowHandle: target.windowHandle,
            active: true,
            snapshotHash: '1111'.repeat(16)
          };
        } else {
          postObserved = true;
          return {
            observedAt: Date.now(),
            targetId: target.targetId,
            processId: target.processId,
            windowHandle: target.windowHandle,
            active: true,
            snapshotHash: '2222'.repeat(16)
          };
        }
      }
    };

    const executor = createMockExecutor();
    const verifier = createMockVerifier(true, { reason: 'Button clicked and text displayed' });

    const receipt = await executeComputerAction({
      actionRequest: createValidRequest(),
      session: createValidSession(),
      authorityPort: createMockAuthority(),
      observer,
      executor,
      verifier,
      options: { nativeInputEnabled: true }
    });

    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.verified, true);
    assert.equal(receipt.uncertain, false);
    assert.equal(executor.callCount, 1);
    assert.equal(preObserved, true);
    assert.equal(postObserved, true);
    assert.equal(receipt.preObservation.snapshotHash, '1111'.repeat(16));
    assert.equal(receipt.postObservation.snapshotHash, '2222'.repeat(16));
    assert.ok(receipt.evidenceHash);
  });

  it('17. Verifier rejection: receipt marks verified false even when executor ok is true', async () => {
    const executor = createMockExecutor({ ok: true });
    const verifier = createMockVerifier(false, { reason: 'Expected UI element change did not manifest' });

    const receipt = await executeComputerAction({
      actionRequest: createValidRequest(),
      session: createValidSession(),
      authorityPort: createMockAuthority(),
      observer: createMockObserver(),
      executor,
      verifier,
      options: { nativeInputEnabled: true }
    });

    assert.equal(receipt.status, 'unverified_effect');
    assert.equal(receipt.verified, false);
    assert.equal(receipt.executionResult.ok, true);
    assert.equal(receipt.verification.verified, false);
    assert.equal(receipt.verification.reason, 'Expected UI element change did not manifest');
    assert.equal(executor.callCount, 1);
  });

  it('18. Executor ok alone cannot certify verified status without trusted verifier', async () => {
    const executor = createMockExecutor({ ok: true });

    const receipt = await executeComputerAction({
      actionRequest: createValidRequest(),
      session: createValidSession(),
      authorityPort: createMockAuthority(),
      observer: createMockObserver(),
      executor,
      verifier: null, // No verifier
      options: { nativeInputEnabled: true }
    });

    assert.equal(receipt.status, 'unverified_effect');
    assert.equal(receipt.verified, false);
    assert.equal(receipt.verification.verified, false);
  });

  // 9. ComputerActionPort Class Wrapper
  it('19. ComputerActionPort class wrapper executes and propagates bound dependencies', async () => {
    const executor = createMockExecutor();
    const port = new ComputerActionPort({
      session: createValidSession(),
      authorityPort: createMockAuthority(),
      observer: createMockObserver(),
      executor,
      verifier: createMockVerifier(true),
      defaultOptions: { nativeInputEnabled: true }
    });

    const receipt = await port.execute(createValidRequest());
    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.verified, true);
    assert.equal(executor.callCount, 1);
  });

  // 10. Exact Expiry Boundary (>=)
  it('20. Exact expiry boundary >=: session.expiresAt === Date.now() is denied with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const now = Date.now();
    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest(),
          session: createValidSession({ expiresAt: now }),
          authorityPort: createMockAuthority(),
          observer: createMockObserver(),
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'SessionExpiredError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  // 11. Recycled PID Prevention (processStartedAt & generation)
  it('21. Recycled PID prevention: processStartedAt mismatch denies execution with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const targetWithStart = createValidTarget({ processStartedAt: 100000 });
    const observer = createMockObserver({ processStartedAt: 200000 }); // New process with same PID

    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest({ target: targetWithStart }),
          session: createValidSession({ target: targetWithStart }),
          authorityPort: createMockAuthority(),
          observer,
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
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

  it('22. Target generation mismatch denies execution with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const targetWithGen = createValidTarget({ generation: 'gen-001' });
    const observer = createMockObserver({ generation: 'gen-002' }); // New window generation

    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest({ target: targetWithGen }),
          session: createValidSession({ target: targetWithGen }),
          authorityPort: createMockAuthority(),
          observer,
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'TargetIdentityMismatchError');
        assert.ok(err.message.includes('generation'));
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  // 12. Foreground Changed Checks
  it('23. Target isForeground false in pre-observation denies execution with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const observer = createMockObserver({ isForeground: false });

    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest(),
          session: createValidSession(),
          authorityPort: createMockAuthority(),
          observer,
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'ForegroundChangedError');
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });

  it('24. Immediate pre-effect foreground change via observer.isForeground denies with 0 executor calls', async () => {
    const executor = createMockExecutor();
    const observer = {
      ...createMockObserver(),
      isForeground: () => false // Focus shifted right before executor dispatch
    };

    await assert.rejects(
      async () => {
        await executeComputerAction({
          actionRequest: createValidRequest(),
          session: createValidSession(),
          authorityPort: createMockAuthority(),
          observer,
          executor,
          verifier: createMockVerifier(),
          options: { nativeInputEnabled: true }
        });
      },
      (err) => {
        assert.equal(err.name, 'ForegroundChangedError');
        assert.ok(err.message.includes('Foreground window changed immediately before effect execution'));
        assert.equal(executor.callCount, 0);
        return true;
      }
    );
  });
});
