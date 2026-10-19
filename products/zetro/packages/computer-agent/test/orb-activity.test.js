import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthoritativeOverlayBridge } from '../src/overlay-bridge.js';
import { activityLabel } from '../src/activity-label.js';
import { runUniversalComputerAgent } from '../src/universal/universal-loop.js';

function fixture(actions, verifyGoal = true) {
  const events = [];
  const target = { targetId: 'window', hwnd: 1, processId: 42, processStartedAt: 123 };
  const session = { sessionId: 'orb-test', targetId: 'window', target, expiresAt: Date.now() + 5000 };
  const overlayBridge = new AuthoritativeOverlayBridge({ ...session, emitEvent: (_, event) => events.push(event) });
  return { events, options: {
    goal: 'Perform a task', session, overlayBridge,
    observer: { observe: async () => ({ timestamp: Date.now(), target, pointer: { x: 10, y: 20 } }) },
    router: { proposeWithFallback: async () => ({ action: actions.shift(), modelId: 'test' }) },
    policyGate: { evaluate: async () => ({ allowed: true }) },
    actionDispatcher: { dispatch: async () => ({ success: true }) },
    verifier: { verifyStep: async () => ({ verified: true }), verifyGoal: async () => ({ verified: verifyGoal }) }
  } };
}

test('activity follows observation, planning, effect and independent verification', async () => {
  const { events, options } = fixture([{ type: 'mouseMove', target: { kind: 'point', x: 12, y: 24 } }, { type: 'finish', success: true }]);
  const result = await runUniversalComputerAgent(options);
  assert.equal(result.status, 'completed');
  const phases = events.map(event => event.activity.phase);
  assert.deepEqual(phases, ['observing', 'observing', 'thinking', 'acting', 'observing', 'observing', 'checking', 'thinking', 'checking', 'completed', 'stopped', 'stopped']);
  assert.equal(events.find(event => event.state === 'acting').activity.text, 'Moving mouse…');
  assert.equal(events.at(-1).activity.text, 'Stopped');
});

test('planner completion cannot claim completion without verifier evidence', async () => {
  const { events, options } = fixture([{ type: 'finish', success: true }], false);
  assert.equal((await runUniversalComputerAgent(options)).status, 'blocked');
  assert.ok(!events.some(event => event.activity.phase === 'completed'));
  assert.ok(events.some(event => event.activity.phase === 'blocked'));
});

test('typed content and planner strings never enter activity payloads', async () => {
  const secret = 'private text not for display';
  const { events, options } = fixture([{ type: 'typeText', text: secret }, { type: 'finish', success: true }]);
  await runUniversalComputerAgent(options);
  assert.ok(!JSON.stringify(events).includes(secret));
  assert.equal(events.find(event => event.state === 'acting').activity.text, 'Typing…');
  assert.equal(activityLabel('acting', 'pressKeys').text, 'Pressing keys\u2026');
  assert.deepEqual(activityLabel(secret, secret), { phase: 'stopped', text: 'Stopped' });
});

test('thinking preserves admitted display and pointer and expires on time', async () => {
  const events = [];
  const bridge = new AuthoritativeOverlayBridge({ sessionId: 'orb', expiresAt: Date.now() + 30, emitEvent: (_, event) => events.push(event) });
  const display = { x: 0, y: 0, width: 100, height: 100 };
  bridge.transition('acting', { targetId: 'window', display, pointer: { x: 20, y: 30 } });
  const thinking = bridge.transition('thinking', { targetId: 'window' });
  assert.equal(thinking.auraActive, true);
  assert.equal(thinking.pointer.visible, true);
  assert.deepEqual(thinking.controlledDisplay, display);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(events.at(-1).state, 'expired');
  assert.equal(events.at(-1).pointer.visible, false);
  bridge.close();
});

test('cancellation during planning clears thinking without executing an effect', async () => {
  const { events, options } = fixture([]);
  const controller = new AbortController();
  let dispatches = 0;
  options.signal = controller.signal;
  options.router.proposeWithFallback = async () => { controller.abort(new Error('Escape')); return new Promise(() => {}); };
  options.actionDispatcher.dispatch = async () => { dispatches++; return { success: true }; };
  const result = await runUniversalComputerAgent(options);
  assert.equal(result.status, 'cancelled');
  assert.equal(dispatches, 0);
  assert.ok(events.some(event => event.state === 'thinking'));
  assert.equal(events.at(-1).state, 'stopped');
  assert.equal(events.at(-1).auraActive, false);
  assert.ok(!events.some(event => event.activity.phase === 'completed'));
});
