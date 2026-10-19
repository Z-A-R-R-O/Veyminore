import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runUniversalComputerAgent, AuthoritativeOverlayBridge, createDesktopOverlay, createReactiveComputingSkill } from '../src/index.js';

function fixture(actions = [{ type: 'click', target: { kind: 'point', x: 40, y: 50 } }, { type: 'finish', success: true }]) {
  let effects = 0, reads = 0, proposals = 0;
  const target = { targetId: 'window-1', hwnd: 100, processId: 40, processStartedAt: 1000 };
  const observation = () => ({ timestamp: Date.now(), target, text: reads++ ? 'changed' : 'before' });
  return {
    goal: 'Use the current application',
    session: { sessionId: 'session-1', targetId: 'window-1', target, expiresAt: Date.now() + 10000 },
    observer: { observe: async () => observation() },
    router: { proposeWithFallback: async context => {
      if (proposals) assert.equal(context.observation.text, 'changed');
      return { modelId: 'fixture', action: actions[proposals++] };
    } },
    policyGate: { evaluate: async () => ({ allowed: true }) },
    actionDispatcher: { dispatch: async () => { effects++; return { success: true }; } },
    verifier: { verifyStep: async ({ after }) => ({ verified: after.text === 'changed' }), verifyGoal: async () => ({ verified: true }) },
    counts: () => ({ effects, reads, proposals })
  };
}

test('reactive loop uses actual post-effect observation before planning again', async () => {
  const f = fixture();
  const result = await runUniversalComputerAgent(f);
  assert.equal(result.status, 'completed');
  assert.deepEqual(f.counts(), { effects: 1, reads: 2, proposals: 2 });
});

test('planner finish cannot certify itself', async () => {
  const f = fixture([{ type: 'finish', success: true }]);
  f.verifier = null;
  assert.equal((await runUniversalComputerAgent(f)).status, 'blocked');
  assert.equal(f.counts().effects, 0);
});

test('stale observation prevents any model or effect call', async () => {
  const f = fixture();
  f.observer.observe = async () => ({ timestamp: 1 });
  assert.equal((await runUniversalComputerAgent(f)).status, 'failed');
  assert.equal(f.counts().effects, 0);
  assert.equal(f.counts().proposals, 0);
});

test('denied authority prevents effects', async () => {
  const f = fixture();
  f.policyGate.evaluate = async () => ({ allowed: false });
  assert.equal((await runUniversalComputerAgent(f)).status, 'blocked');
  assert.equal(f.counts().effects, 0);
});

test('unverified effect prevents subsequent actions', async () => {
  const f = fixture();
  f.verifier.verifyStep = async () => ({ verified: false });
  assert.equal((await runUniversalComputerAgent(f)).status, 'blocked');
  assert.equal(f.counts().effects, 1);
  assert.equal(f.counts().proposals, 1);
});

test('effect timeout is uncertain and never retried; overlay is cleared', async () => {
  const f = fixture();
  f.actionDispatcher.dispatch = () => new Promise(() => {});
  f.portTimeoutMs = 10;
  f.overlayBridge = new AuthoritativeOverlayBridge({ sessionId: f.session.sessionId, expiresAt: f.session.expiresAt });
  assert.equal((await runUniversalComputerAgent(f)).status, 'uncertain');
  assert.equal(f.counts().proposals, 1);
  assert.equal(f.overlayBridge.getSnapshot().auraActive, false);
});

test('overlay binds identity, clears pointer on pause and expires automatically', async () => {
  const bridge = new AuthoritativeOverlayBridge({ sessionId: 's', expiresAt: Date.now() + 25 });
  assert.throws(() => bridge.transition('acting', { sessionId: 'foreign', targetId: 't' }));
  bridge.transition('acting', { targetId: 't', pointer: { x: 4, y: 6 } });
  assert.equal(bridge.getSnapshot().pointer.visible, true);
  bridge.transition('paused');
  assert.equal(bridge.getSnapshot().pointer.visible, false);
  bridge.transition('observing', { targetId: 't' });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(bridge.getSnapshot().state, 'expired');
  assert.equal(bridge.getSnapshot().auraActive, false);
});

test('native presentation is opt-in, receives real coordinates and closes on stop', () => {
  const lines = [];
  let starts = 0, ended = false;
  const spawnImpl = (_path, args, options) => {
    starts++;
    assert.equal(options.shell, false);
    assert.deepEqual(args, ['--session', 's']);
    const child = new EventEmitter();
    child.exitCode = 0;
    child.stdin = new EventEmitter();
    child.stdin.writable = true;
    child.stdin.write = line => lines.push(JSON.parse(line));
    child.stdin.end = () => { ended = true; };
    return child;
  };
  const settings = { sessionId: 's', expiresAt: Date.now() + 1000, spawnImpl };
  const event = { targetId: 't', pointer: { x: 123, y: 456 }, display: { x: 0, y: 0, width: 1920, height: 1080 } };
  const disabled = createDesktopOverlay(settings);
  disabled.transition('acting', event);
  disabled.close();
  assert.equal(starts, 0);
  const enabled = createDesktopOverlay({ ...settings, enabled: true });
  enabled.transition('acting', event);
  assert.equal(starts, 1);
  assert.equal(lines.at(-1).pointer.x, 123);
  enabled.close();
  assert.equal(ended, true);
});

test('skill stop aborts pending observation and clears its active state', async () => {
  const f = fixture();
  f.observer.observe = () => new Promise(() => {});
  const skill = createReactiveComputingSkill({ ports: f, session: f.session, overlay: false });
  const run = skill.run('Observe application');
  assert.equal(skill.active, true);
  skill.stop();
  assert.equal((await run).status, 'cancelled');
  assert.equal(skill.active, false);
});

test('presentation expiry cannot be extended or restarted after ending', () => {
  const bridge = new AuthoritativeOverlayBridge({ sessionId: 's', expiresAt: Date.now() + 1000 });
  assert.throws(() => bridge.transition('acting', { targetId: 't', expiresAt: Date.now() + 5000 }), /extended/);
  bridge.transition('stopped');
  assert.throws(() => bridge.transition('acting', { targetId: 't' }), /Ended/);
});

test('authority delay past expiry prevents dispatch', async () => {
  const f = fixture();
  f.session.expiresAt = Date.now() + 10;
  f.policyGate.evaluate = async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    return { allowed: true };
  };
  assert.equal((await runUniversalComputerAgent(f)).status, 'failed');
  assert.equal(f.counts().effects, 0);
});

test('target substitution is rejected before dispatch', async () => {
  const f = fixture();
  f.observer.observe = async () => ({ timestamp: Date.now(), target: { ...f.session.target, processId: 999 } });
  assert.equal((await runUniversalComputerAgent(f)).status, 'blocked');
  assert.equal(f.counts().effects, 0);
});

test('post-effect observation failure preserves intent and reports uncertainty', async () => {
  const f = fixture();
  let reads = 0;
  const observe = f.observer.observe;
  f.observer.observe = async () => {
    if (reads++) throw new Error('Observation disconnected');
    return observe();
  };
  const result = await runUniversalComputerAgent(f);
  assert.equal(result.status, 'uncertain');
  assert.equal(f.counts().effects, 1);
  assert.ok(result.journal.getEntries().some(entry => entry.status === 'intent'));
  assert.ok(result.journal.getEntries().some(entry => entry.status === 'executed'));
});

test('active observation retains the pointer between effects but pause and target change clear it', () => {
  const bridge = new AuthoritativeOverlayBridge({ sessionId: 's', expiresAt: Date.now() + 1000 });
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  bridge.transition('acting', { targetId: 't', display, pointer: { x: 30, y: 40 } });
  bridge.transition('observing', { targetId: 't' });
  assert.equal(bridge.getSnapshot().pointer.visible, true);
  assert.deepEqual(bridge.getSnapshot().controlledDisplay, display);
  bridge.transition('observing', { targetId: 't', pointer: { x: 50, y: 60 } });
  assert.equal(bridge.getSnapshot().pointer.x, 50);
  bridge.transition('observing', { targetId: 'different' });
  assert.equal(bridge.getSnapshot().pointer.visible, false);
  bridge.transition('acting', { targetId: 'different', display, pointer: { x: 1, y: 2 } });
  bridge.transition('paused');
  assert.equal(bridge.getSnapshot().pointer.visible, false);
  bridge.close();
});


test('native Escape stops the host once and closes presentation', () => {
  const child = new EventEmitter();
  child.exitCode = 0;
  child.stdout = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.writable = true;
  child.stdin.write = () => {};
  let ended = false;
  child.stdin.end = () => { ended = true; };
  const reasons = [];
  const bridge = createDesktopOverlay({ sessionId: 'escape-test', expiresAt: Date.now() + 5000,
    enabled: true, spawnImpl: () => child, onStopRequested: reason => reasons.push(reason) });
  bridge.transition('acting', { targetId: 't', display: { x: 0, y: 0, width: 800, height: 600 } });
  child.stdout.emit('data', Buffer.from('{"event":"stop_req'));
  child.stdout.emit('data', Buffer.from('uested","reason":"escape"}\n'));
  child.emit('exit', 0);
  assert.deepEqual(reasons, ['escape']);
  assert.equal(ended, true);
  bridge.close();
});

test('native stop callback cancels a pending reactive session without effects', async () => {
  const f = fixture();
  f.observer.observe = () => new Promise(() => {});
  let nativeStop;
  const skill = createReactiveComputingSkill({ ports: f, session: f.session,
    overlayFactory: options => { nativeStop = options.onStopRequested; return { close() {} }; } });
  const run = skill.run('Observe');
  nativeStop('escape');
  assert.equal((await run).status, 'cancelled');
  assert.equal(f.counts().effects, 0);
  assert.equal(skill.active, false);
});
