import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthoritativeOverlayBridge } from '../src/overlay-bridge.js';
import { createSmartStatus } from '../src/smart-status.js';
import { runUniversalComputerAgent } from '../src/universal/universal-loop.js';
import { createReactiveComputingSkill } from '../src/reactive-skill.js';

function createSmartStatusFixture({
  actions = [],
  verifyStep = true,
  verifyGoal = true,
  intent = null,
  clock = Date.now,
  attachSmartStatus = true,
  customSmartStatus = null
} = {}) {
  const events = [];
  const target = { targetId: 'window-1', hwnd: 101, processId: 404, processStartedAt: 1000 };
  const smartStatus = attachSmartStatus ? (customSmartStatus || createSmartStatus({ clock })) : null;
  const session = {
    sessionId: 'session-smart-101',
    taskId: 'task-smart-101',
    targetId: 'window-1',
    target,
    expiresAt: Date.now() + 60000,
    intent,
    smartStatus
  };

  const overlayBridge = new AuthoritativeOverlayBridge({
    ...session,
    clock,
    smartStatus,
    emitEvent: (_, event) => events.push(event)
  });

  const actionsQueue = [...actions];
  const options = {
    goal: 'Automate folder reorganization safely',
    session,
    overlayBridge,
    observer: {
      observe: async () => ({
        timestamp: Date.now(),
        target,
        pointer: { x: 40, y: 80 }
      })
    },
    router: {
      proposeWithFallback: async () => ({
        action: actionsQueue.shift() || { type: 'finish', success: true },
        modelId: 'test-smart-planner'
      })
    },
    policyGate: { evaluate: async () => ({ allowed: true }) },
    actionDispatcher: { dispatch: async () => ({ success: true }) },
    verifier: {
      verifyStep: async () => ({ verified: typeof verifyStep === 'function' ? verifyStep() : verifyStep }),
      verifyGoal: async () => ({ verified: typeof verifyGoal === 'function' ? verifyGoal() : verifyGoal })
    }
  };

  return { events, options, session, overlayBridge, smartStatus };
}

test('SmartStatus: Full lifecycle accumulation of verified steps and verified completion', async () => {
  let virtualTime = 1000;
  const clock = () => virtualTime;

  const intent = {
    operation: 'create_folder',
    targetLabel: 'Archive2026',
    destinationLabel: 'Documents',
    allowDisplayLabels: true
  };

  const { events, options, overlayBridge, smartStatus } = createSmartStatusFixture({
    clock,
    intent,
    actions: [
      { type: 'mouseMove', target: { kind: 'point', x: 100, y: 150 } },
      { type: 'click', target: { kind: 'point', x: 100, y: 150 }, button: 'left' },
      { type: 'finish', success: true }
    ],
    verifyStep: true,
    verifyGoal: true
  });

  const result = await runUniversalComputerAgent(options);
  assert.equal(result.status, 'completed');

  const snap = overlayBridge.getSnapshot().smartStatus;
  assert.ok(snap, 'smartStatus snapshot must be present');
  assert.equal(snap.taskId, 'task-smart-101');
  assert.equal(snap.phase, 'completed');
  assert.equal(snap.settledReason, 'completed');
  assert.equal(snap.working, false);
  assert.equal(snap.currentStep, null);

  // Exactly two verified execution steps accumulated before finish
  assert.equal(snap.verifiedSteps.length, 2);
  assert.equal(snap.verifiedSteps[0].id, 'step-1');
  assert.equal(snap.verifiedSteps[1].id, 'step-2');
  assert.ok(snap.verifiedSteps[0].text);

  // Overlay bridge snapshot contains nested smartStatus
  const bridgeSnap = overlayBridge.getSnapshot();
  assert.equal(bridgeSnap.smartStatus.phase, 'completed');
});

test('SmartStatus: Independent verifier rejection prevents false completion and blocks execution', async () => {
  const { options, overlayBridge } = createSmartStatusFixture({
    actions: [{ type: 'finish', success: true }],
    verifyGoal: false
  });

  const result = await runUniversalComputerAgent(options);
  assert.equal(result.status, 'blocked');

  const snap = overlayBridge.getSnapshot().smartStatus;
  assert.equal(snap.phase, 'blocked');
  assert.equal(snap.settledReason, 'blocked');
  assert.equal(snap.working, false);
  assert.deepEqual(snap.verifiedSteps, []);
});

test('SmartStatus: Unverified intermediate step prevents step accumulation and blocks run', async () => {
  const { options, overlayBridge } = createSmartStatusFixture({
    actions: [
      { type: 'mouseMove', target: { kind: 'point', x: 10, y: 10 } },
      { type: 'finish', success: true }
    ],
    verifyStep: false
  });

  const result = await runUniversalComputerAgent(options);
  assert.equal(result.status, 'blocked');

  const snap = overlayBridge.getSnapshot().smartStatus;
  assert.equal(snap.phase, 'blocked');
  assert.equal(snap.settledReason, 'blocked');
  assert.equal(snap.verifiedSteps.length, 0);
});

test('SmartStatus: Verified steps are capped at 20 (cap20)', async () => {
  // Directly test capacity cap with 25 checking events
  const status = createSmartStatus();
  status.update({ taskId: 'cap20-task', sequence: 0, phase: 'intention' });

  for (let i = 1; i <= 25; i++) {
    status.update({
      taskId: 'cap20-task',
      sequence: i,
      phase: 'checking',
      verified: true,
      stepId: `step-${i}`
    });
  }

  const snap = status.getSnapshot();
  assert.equal(snap.verifiedSteps.length, 20);
  assert.equal(snap.verifiedSteps[0].id, 'step-1');
  assert.equal(snap.verifiedSteps[19].id, 'step-20');
});

test('SmartStatus: Monotonic sequence enforcement and foreign task isolation', async () => {
  const status = createSmartStatus();
  const ok1 = status.update({ taskId: 'task-isolated', sequence: 1, phase: 'intention' });
  assert.equal(ok1, true);

  // Equal sequence number rejected
  assert.equal(status.update({ taskId: 'task-isolated', sequence: 1, phase: 'thinking' }), false);

  // Lower sequence number rejected
  assert.equal(status.update({ taskId: 'task-isolated', sequence: 0, phase: 'thinking' }), false);

  // Foreign task while active task-isolated is running rejected
  assert.equal(status.update({ taskId: 'task-foreign', sequence: 2, phase: 'intention' }), false);

  // Monotonic step on same task accepted
  assert.equal(status.update({ taskId: 'task-isolated', sequence: 2, phase: 'thinking' }), true);
});

test('SmartStatus: Honest terminal states freeze elapsed times and clear currentStep', async () => {
  let currentTime = 5000;
  const clock = () => currentTime;
  const status = createSmartStatus({ clock });

  status.update({ taskId: 'freeze-test', sequence: 1, phase: 'intention' });
  currentTime = 6500;
  status.update({ taskId: 'freeze-test', sequence: 2, phase: 'acting' });

  const activeSnap = status.getSnapshot();
  assert.equal(activeSnap.working, true);
  assert.ok(activeSnap.currentStep);
  assert.equal(activeSnap.elapsedMs, 1500);

  // Terminal state: completed with verification
  currentTime = 8000;
  status.update({ taskId: 'freeze-test', sequence: 3, phase: 'completed', verified: true });

  const termSnap1 = status.getSnapshot();
  assert.equal(termSnap1.working, false);
  assert.equal(termSnap1.currentStep, null);
  assert.equal(termSnap1.elapsedMs, 3000);
  assert.equal(termSnap1.settledReason, 'completed');

  // Advance time by 10 seconds: elapsed must NOT grow (frozen)
  currentTime = 18000;
  const termSnap2 = status.getSnapshot();
  assert.equal(termSnap2.elapsedMs, 3000);
  assert.equal(termSnap2.phaseElapsedMs, 0);
  assert.equal(termSnap2.currentStep, null);
});

test('SmartStatus: Zero sensitive text, typed secrets, or raw prompt leakage', async () => {
  const rawSecret = 'SUPER_SECRET_TOKEN_XYZ';
  const rawPrompt = 'Transfer all company funds secretly';

  const intent = {
    operation: 'search',
    query: rawSecret,
    prompt: rawPrompt,
    typedText: rawSecret,
    allowDisplayLabels: false
  };

  const { options, overlayBridge } = createSmartStatusFixture({
    intent,
    actions: [
      { type: 'typeText', text: rawSecret },
      { type: 'finish', success: true }
    ],
    verifyStep: true,
    verifyGoal: true
  });

  await runUniversalComputerAgent(options);
  const snap = overlayBridge.getSnapshot().smartStatus;
  const serialized = JSON.stringify(snap);

  assert.equal(serialized.includes(rawSecret), false, 'Snapshot must not contain typed secret');
  assert.equal(serialized.includes(rawPrompt), false, 'Snapshot must not contain raw prompt');
});

test('SmartStatus: Backward compatibility when smartStatus is omitted', async () => {
  const { events, options, overlayBridge } = createSmartStatusFixture({
    attachSmartStatus: false,
    actions: [
      { type: 'mouseMove', target: { kind: 'point', x: 25, y: 50 } },
      { type: 'finish', success: true }
    ],
    verifyStep: true,
    verifyGoal: true
  });

  const result = await runUniversalComputerAgent(options);
  assert.equal(result.status, 'completed');

  // Exact 12 events sequence preserved for legacy runs
  const phases = events.map(e => e.activity.phase);
  assert.deepEqual(phases, [
    'observing',
    'observing',
    'thinking',
    'acting',
    'observing',
    'observing',
    'checking',
    'thinking',
    'checking',
    'completed',
    'stopped',
    'stopped'
  ]);

  // Snapshot has no smartStatus field
  assert.equal(overlayBridge.getSnapshot().smartStatus, undefined);
});

test('SmartStatus: Reactive computing skill forwards smartStatus and taskId', async () => {
  const target = { targetId: 'window-rx', hwnd: 88, processId: 99, processStartedAt: 500 };
  let virtualTime = 2000;
  const clock = () => virtualTime;
  const smartStatus = createSmartStatus({ clock });

  let capturedOverlayArgs = null;
  const mockOverlayFactory = (args) => {
    capturedOverlayArgs = args;
    return new AuthoritativeOverlayBridge({
      ...args,
      clock,
      smartStatus: args.smartStatus
    });
  };

  const actionsQueue = [{ type: 'finish', success: true }];
  const ports = {
    observer: { observe: async () => ({ timestamp: Date.now(), target }) },
    router: { proposeWithFallback: async () => ({ action: actionsQueue.shift(), modelId: 'm1' }) },
    policyGate: { evaluate: async () => ({ allowed: true }) },
    actionDispatcher: { dispatch: async () => ({ success: true }) },
    verifier: {
      verifyStep: async () => ({ verified: true }),
      verifyGoal: async () => ({ verified: true })
    }
  };

  const session = {
    sessionId: 'session-rx-1',
    taskId: 'task-rx-custom',
    targetId: 'window-rx',
    target,
    expiresAt: clock() + 30000,
    smartStatus
  };

  const skill = createReactiveComputingSkill({
    ports,
    session,
    overlayFactory: mockOverlayFactory
  });

  const runResult = await skill.run('Verify reactive wiring');
  assert.equal(runResult.status, 'completed');
  assert.equal(capturedOverlayArgs.taskId, 'task-rx-custom');
  assert.equal(capturedOverlayArgs.smartStatus, smartStatus);

  const finalSnap = smartStatus.getSnapshot();
  assert.equal(finalSnap.phase, 'completed');
  assert.equal(finalSnap.settledReason, 'completed');
});
