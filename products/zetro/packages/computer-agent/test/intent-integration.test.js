import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AuthoritativeOverlayBridge } from '../src/overlay-bridge.js';
import { runUniversalComputerAgent } from '../src/universal/universal-loop.js';
import { createReactiveComputingSkill } from '../src/reactive-skill.js';
import { activityLabel } from '../src/activity-label.js';
import { createIntentStatus } from '../src/intent-status.js';

const nativeOverlayExe = fileURLToPath(new URL('../native-overlay/ZetroAccessOverlay.exe', import.meta.url));

function createTestFixture({ actions = [], verifyGoal = true, intent = null } = {}) {
  const events = [];
  const target = { targetId: 'window', hwnd: 1, processId: 42, processStartedAt: 123 };
  const session = {
    sessionId: 'intent-test-session',
    targetId: 'window',
    target,
    expiresAt: Date.now() + 10000,
    intent
  };
  const overlayBridge = new AuthoritativeOverlayBridge({
    ...session,
    emitEvent: (_, event) => events.push(event)
  });

  const actionsQueue = [...actions];
  const options = {
    goal: 'Create folder task',
    session,
    overlayBridge,
    observer: { observe: async () => ({ timestamp: Date.now(), target, pointer: { x: 10, y: 20 } }) },
    router: { proposeWithFallback: async () => ({ action: actionsQueue.shift(), modelId: 'test-model' }) },
    policyGate: { evaluate: async () => ({ allowed: true }) },
    actionDispatcher: { dispatch: async () => ({ success: true }) },
    verifier: {
      verifyStep: async () => ({ verified: true }),
      verifyGoal: async () => ({ verified: verifyGoal })
    }
  };

  return { events, options, session, overlayBridge };
}

test('SmartIntent: Full event sequence with intention and independent verification', async () => {
  const intent = {
    operation: 'create_folder',
    targetLabel: 'hello',
    destinationLabel: 'Downloads',
    allowDisplayLabels: true
  };
  const { events, options } = createTestFixture({
    actions: [
      { type: 'mouseMove', target: { kind: 'point', x: 50, y: 50 } },
      { type: 'finish', success: true }
    ],
    verifyGoal: true,
    intent
  });

  const result = await runUniversalComputerAgent(options);
  assert.equal(result.status, 'completed');

  const phases = events.map(e => e.activity.phase);
  assert.deepEqual(phases, [
    'observing',
    'observing',
    'intention',
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

  // Verify exact text progression matching the shared contract
  const intentionEvent = events.find(e => e.activity.phase === 'intention');
  assert.equal(intentionEvent.activity.text, "I'll create \u2018hello\u2019 in Downloads.");

  const observingEvent = events.find(e => e.activity.phase === 'observing');
  assert.equal(observingEvent.activity.text, 'Finding Downloads\u2026');

  const actingEvent = events.find(e => e.activity.phase === 'acting');
  assert.equal(actingEvent.activity.text, 'Creating \u2018hello\u2019\u2026');

  const checkingEvent = events.find(e => e.activity.phase === 'checking');
  assert.equal(checkingEvent.activity.text, 'Checking the folder\u2026');

  const completedEvent = events.find(e => e.activity.phase === 'completed');
  assert.equal(completedEvent.activity.text, '\u2018hello\u2019 is ready.');
});

test('SmartIntent: Independent verifier failure prevents false completion', async () => {
  const intent = {
    operation: 'create_folder',
    targetLabel: 'hello',
    destinationLabel: 'Downloads',
    allowDisplayLabels: true
  };
  const { events, options } = createTestFixture({
    actions: [{ type: 'finish', success: true }],
    verifyGoal: false, // verifier rejects goal
    intent
  });

  const result = await runUniversalComputerAgent(options);
  assert.equal(result.status, 'blocked');

  // Completed text must NEVER appear if verifyGoal is false
  assert.ok(!events.some(e => e.activity.phase === 'completed'));
  assert.ok(events.some(e => e.activity.phase === 'blocked'));
  const blockedEvent = events.find(e => e.activity.phase === 'blocked');
  assert.equal(blockedEvent.activity.text, 'Folder creation needs attention');
});

test('SmartIntent: Existing fixed-label behavior unchanged without valid intent', async () => {
  // Session without intent
  const { events, options } = createTestFixture({
    actions: [
      { type: 'mouseMove', target: { kind: 'point', x: 10, y: 10 } },
      { type: 'finish', success: true }
    ],
    verifyGoal: true,
    intent: null
  });

  const result = await runUniversalComputerAgent(options);
  assert.equal(result.status, 'completed');

  const phases = events.map(e => e.activity.phase);
  // Matches exact original phase sequence with zero intention event
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
  assert.ok(!events.some(e => e.activity.phase === 'intention'));
  assert.equal(events.find(e => e.state === 'acting').activity.text, 'Moving mouse\u2026');
  assert.equal(events.find(e => e.activity.phase === 'completed').activity.text, 'Completed');
});

test('SmartIntent: Display labels suppressed when allowDisplayLabels is not literal true', async () => {
  const intent = {
    operation: 'create_folder',
    targetLabel: 'PrivateFolder',
    destinationLabel: 'ConfidentialPath',
    allowDisplayLabels: false // suppressed
  };
  const { events, options } = createTestFixture({
    actions: [{ type: 'finish', success: true }],
    verifyGoal: true,
    intent
  });

  await runUniversalComputerAgent(options);

  const eventText = JSON.stringify(events);
  assert.ok(!eventText.includes('PrivateFolder'), 'Target label must not be displayed');
  assert.ok(!eventText.includes('ConfidentialPath'), 'Destination label must not be displayed');

  const intentionEvent = events.find(e => e.activity.phase === 'intention');
  assert.equal(intentionEvent.activity.text, "I'll create the folder.");
});

test('SmartIntent: Zero sensitive text, typed text, or raw prompt leakage', async () => {
  const secret = 'super-secret-password-xyz';
  const intent = {
    operation: 'create_folder',
    targetLabel: 'work',
    destinationLabel: 'Documents',
    allowDisplayLabels: true
  };
  const { events, options } = createTestFixture({
    actions: [
      { type: 'typeText', text: secret },
      { type: 'finish', success: true }
    ],
    verifyGoal: true,
    intent
  });
  options.goal = `Sensitive prompt with auth: ${secret}`;

  await runUniversalComputerAgent(options);

  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes(secret), 'Secret must never enter activity or event streams');
});

test('SmartIntent: Stale observation blocks execution before planning or intention effects', async () => {
  const intent = {
    operation: 'create_folder',
    targetLabel: 'test',
    destinationLabel: 'Desktop',
    allowDisplayLabels: true
  };
  const { events, options } = createTestFixture({
    actions: [{ type: 'finish', success: true }],
    intent
  });
  // Observer returns stale observation (10s old)
  options.observer = {
    observe: async () => ({
      timestamp: Date.now() - 10000,
      target: { targetId: 'window', hwnd: 1, processId: 42, processStartedAt: 123 }
    })
  };

  const result = await runUniversalComputerAgent(options);
  assert.equal(result.status, 'failed');
  assert.ok(!events.some(e => e.activity.phase === 'completed'));
  assert.ok(!events.some(e => e.activity.phase === 'acting'));
});

test('SmartIntent: Reactive computing skill wires session.intent through overlay bridge', async () => {
  const events = [];
  const target = { targetId: 'win-reactive', hwnd: 99, processId: 101, processStartedAt: 1 };
  const session = {
    sessionId: 'reactive-intent-sess',
    targetId: 'win-reactive',
    target,
    expiresAt: Date.now() + 10000,
    intent: {
      operation: 'create_folder',
      targetLabel: 'hello',
      destinationLabel: 'Downloads',
      allowDisplayLabels: true
    }
  };

  const customOverlayFactory = ({ sessionId, expiresAt }) => {
    return new AuthoritativeOverlayBridge({
      sessionId,
      expiresAt,
      emitEvent: (_, ev) => events.push(ev)
    });
  };

  const skill = createReactiveComputingSkill({
    session,
    overlayFactory: customOverlayFactory,
    ports: {
      observer: { observe: async () => ({ timestamp: Date.now(), target, pointer: { x: 5, y: 5 } }) },
      router: { proposeWithFallback: async () => ({ action: { type: 'finish', success: true }, modelId: 'test' }) },
      policyGate: { evaluate: async () => ({ allowed: true }) },
      actionDispatcher: { dispatch: async () => ({ success: true }) },
      verifier: {
        verifyStep: async () => ({ verified: true }),
        verifyGoal: async () => ({ verified: true })
      }
    }
  });

  const result = await skill.run('Create hello folder');
  assert.equal(result.status, 'completed');

  const intentionEvent = events.find(e => e.activity.phase === 'intention');
  assert.ok(intentionEvent, 'Intention event should be emitted');
  assert.equal(intentionEvent.activity.text, "I'll create \u2018hello\u2019 in Downloads.");
  assert.equal(events.find(e => e.activity.phase === 'completed').activity.text, '\u2018hello\u2019 is ready.');
});

test('NativeProtocol: ZetroAccessOverlay admits intention state without clearing visual and admits text up to 120 chars', async () => {
  if (process.platform !== 'win32') return;

  const child = spawn(nativeOverlayExe, ['--session', 'native-proto-sess'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  const stdoutLines = [];
  child.stdout.on('data', chunk => {
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
    stdoutLines.push(...lines);
  });

  // Step 1: Send 'intention' state with a 115-character activity phrase
  const longIntentText = "I'll create \u2018hello\u2019 in Downloads folder with a comprehensive descriptive text phrase under 120 characters.";
  assert.ok(longIntentText.length <= 120, 'Text must be <= 120 chars');

  const event1 = JSON.stringify({
    sessionId: 'native-proto-sess',
    sequence: 1,
    state: 'intention',
    expiresAt: Date.now() + 5000,
    controlledDisplay: { x: 100, y: 100, width: 400, height: 300 },
    activity: { phase: 'intention', text: longIntentText }
  }) + '\n';

  child.stdin.write(event1);

  // Allow native process to process the line
  await new Promise(resolve => setTimeout(resolve, 300));

  // Verify kill switch ready and frame presented for intention phase
  assert.ok(stdoutLines.some(l => l.includes('"kill_switch_ready"')), 'Kill switch must be ready');
  const presented1 = stdoutLines.map(l => { try { return JSON.parse(l); } catch { return {}; } })
    .find(p => p.event === 'presented' && p.sequence === 1);
  assert.ok(presented1, 'Sequence 1 (intention) must be presented');
  assert.equal(presented1.activityPhase, 'intention');

  // Verify intention state DID NOT emit 'cleared'
  assert.ok(!stdoutLines.some(l => l.includes('"cleared"')), 'Intention must not clear visual');

  // Step 2: Clean close
  child.stdin.end();
  const exitCode = await new Promise(resolve => child.on('exit', resolve));
  assert.equal(exitCode, 0, 'Overlay helper must exit with 0 on stdin close');
});

test('NativeProtocol: ZetroAccessOverlay rejects activity text exceeding 120 chars (fails closed)', async () => {
  if (process.platform !== 'win32') return;

  const child = spawn(nativeOverlayExe, ['--session', 'native-fail-sess'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  const stderrLines = [];
  child.stderr.on('data', chunk => {
    stderrLines.push(chunk.toString());
  });

  // Over-limit text (135 chars)
  const overLimitText = 'A'.repeat(135);

  const eventOver = JSON.stringify({
    sessionId: 'native-fail-sess',
    sequence: 1,
    state: 'intention',
    expiresAt: Date.now() + 5000,
    controlledDisplay: { x: 100, y: 100, width: 400, height: 300 },
    activity: { phase: 'intention', text: overLimitText }
  }) + '\n';

  child.stdin.write(eventOver);

  await new Promise(resolve => setTimeout(resolve, 300));

  // Verify that an exception was caught and logged to stderr
  const allStderr = stderrLines.join('');
  assert.ok(allStderr.includes('Overlay presentation failed'), 'Over-limit text must fail closed');

  child.stdin.end();
  await new Promise(resolve => child.on('exit', resolve));
});
