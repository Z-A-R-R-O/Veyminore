import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDesktopOverlay } from '../src/desktop-overlay.js';

function createFakeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.writable = true;
  child.stdin.writtenLines = [];
  child.stdin.ended = false;

  child.stdin.write = function (data, cb) {
    if (!this.writable) {
      const err = new Error('EPIPE: Broken pipe');
      if (typeof cb === 'function') cb(err);
      else throw err;
      return false;
    }
    this.writtenLines.push(data);
    if (typeof cb === 'function') process.nextTick(cb);
    return true;
  };

  child.stdin.end = function () {
    this.writable = false;
    this.ended = true;
  };

  child.kill = function () {
    this.exitCode = 1;
    this.emit('exit', 1, null);
  };

  return child;
}

const validDisplay = { x: 0, y: 0, width: 1920, height: 1080 };
const validEvent = {
  targetId: 'target-1',
  pointer: { x: 100, y: 200 },
  display: validDisplay
};

describe('Desktop Overlay Child Lifecycle Invariants', () => {
  // 1. Write exceptions cancel host rather than silently closing
  it('write exception (synchronous throw) cancels host rather than silently closing', () => {
    let spawnCount = 0;
    const child = createFakeChild();
    child.stdin.write = () => {
      throw new Error('Sync write failure: EPIPE');
    };

    const reasons = [];
    const bridge = createDesktopOverlay({
      sessionId: 'sess-write-err-1',
      expiresAt: Date.now() + 5000,
      enabled: true,
      spawnImpl: () => { spawnCount++; return child; },
      onStopRequested: reason => reasons.push(reason)
    });

    bridge.transition('acting', validEvent);

    assert.equal(spawnCount, 1);
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes('Sync write failure') || reasons[0].includes('Native overlay write failed'));
    assert.equal(child.stdin.ended, true);
  });

  it('write exception (async callback error) cancels host rather than silently closing', async () => {
    let spawnCount = 0;
    const child = createFakeChild();
    child.stdin.write = (_data, cb) => {
      if (typeof cb === 'function') {
        process.nextTick(() => cb(new Error('Async EPIPE')));
      }
    };

    const reasons = [];
    const bridge = createDesktopOverlay({
      sessionId: 'sess-write-err-2',
      expiresAt: Date.now() + 5000,
      enabled: true,
      spawnImpl: () => { spawnCount++; return child; },
      onStopRequested: reason => reasons.push(reason)
    });

    bridge.transition('acting', validEvent);

    await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal(spawnCount, 1);
    assert.equal(reasons.length, 1);
    assert.ok(reasons[0].includes('Async EPIPE') || reasons[0].includes('Native overlay write failed'));
  });

  it('non-writable stdin cancels host rather than silently closing', () => {
    let spawnCount = 0;
    const child = createFakeChild();
    child.stdin.writable = false; // stdin unexpectedly closed

    const reasons = [];
    const bridge = createDesktopOverlay({
      sessionId: 'sess-write-err-3',
      expiresAt: Date.now() + 5000,
      enabled: true,
      spawnImpl: () => { spawnCount++; return child; },
      onStopRequested: reason => reasons.push(reason)
    });

    bridge.transition('acting', validEvent);

    assert.equal(spawnCount, 1);
    assert.equal(reasons.length, 1);
    assert.equal(reasons[0], 'Native overlay write failed');
  });

  it('pause -> resume newchild -> oldwritecallback(error) ignores stale callback and keeps new child active', () => {
    const child1 = createFakeChild();
    const child2 = createFakeChild();
    const spawnedChildren = [];

    let child1WriteCb = null;
    child1.stdin.write = function (data, cb) {
      child1WriteCb = cb; // Capture callback without immediately invoking it
      return true;
    };

    let child2WriteCb = null;
    child2.stdin.write = function (data, cb) {
      child2WriteCb = cb;
      return true;
    };

    const reasons = [];
    const bridge = createDesktopOverlay({
      sessionId: 'sess-fenced-write-1',
      expiresAt: Date.now() + 5000,
      enabled: true,
      spawnImpl: () => {
        const next = spawnedChildren.length === 0 ? child1 : child2;
        spawnedChildren.push(next);
        return next;
      },
      onStopRequested: reason => reasons.push(reason)
    });

    // 1. Start acting -> spawns child1 and invokes send()
    bridge.transition('acting', validEvent);
    assert.equal(spawnedChildren.length, 1);
    assert.equal(spawnedChildren[0], child1);
    assert.ok(typeof child1WriteCb === 'function', 'child1 write callback should be captured');

    // 2. Pause -> stops child1
    bridge.transition('paused');
    assert.equal(child1.stdin.ended, true, 'child1 stdin should be ended on pause');

    // 3. Resume -> spawns child2
    bridge.transition('acting', validEvent);
    assert.equal(spawnedChildren.length, 2);
    assert.equal(spawnedChildren[1], child2);

    // 4. Stale write error from child1 fires NOW after resume
    child1WriteCb(new Error('EPIPE on closed child1'));

    // Verified: new child2 remains active, no cancellation occurred!
    assert.deepEqual(reasons, [], 'Stale write error from child1 must be ignored; new child must remain active');
    assert.equal(child2.stdin.ended, false, 'child2 must remain active and not ended');

    // 5. Preserved: write error from current child (child2) DOES cancel host once
    assert.ok(typeof child2WriteCb === 'function', 'child2 write callback should be captured');
    child2WriteCb(new Error('EPIPE on current child2'));

    assert.equal(reasons.length, 1, 'Current child write error cancels host once');
    assert.ok(reasons[0].includes('EPIPE on current child2') || reasons[0].includes('Native overlay write failed'));
    assert.equal(child2.stdin.ended, true, 'child2 should be ended after cancellation');
  });

  // 2. Native disconnect/stop must never respawn overlay on later events
  it('native disconnect must never respawn overlay on subsequent aura events', () => {
    let spawnCount = 0;
    const child = createFakeChild();

    const reasons = [];
    const bridge = createDesktopOverlay({
      sessionId: 'sess-no-respawn-1',
      expiresAt: Date.now() + 5000,
      enabled: true,
      spawnImpl: () => { spawnCount++; return child; },
      onStopRequested: reason => reasons.push(reason)
    });

    bridge.transition('acting', validEvent);
    assert.equal(spawnCount, 1);

    // Native child disconnects unexpectedly
    child.emit('exit', 1, null);
    assert.equal(reasons.length, 1);
    assert.equal(reasons[0], 'Native overlay disconnected');

    // Later events attempt to transition acting/observing
    bridge.transition('thinking', { targetId: 'target-1' });
    bridge.transition('acting', validEvent);

    // Overlay must NEVER respawn!
    assert.equal(spawnCount, 1, 'Child must never respawn after native disconnect');
  });

  it('native stop request (Escape) must never respawn overlay on subsequent events', () => {
    let spawnCount = 0;
    const child = createFakeChild();

    const reasons = [];
    const bridge = createDesktopOverlay({
      sessionId: 'sess-no-respawn-2',
      expiresAt: Date.now() + 5000,
      enabled: true,
      spawnImpl: () => { spawnCount++; return child; },
      onStopRequested: reason => reasons.push(reason)
    });

    bridge.transition('acting', validEvent);
    assert.equal(spawnCount, 1);

    // User pressed Escape -> native overlay requested stop
    child.stdout.emit('data', Buffer.from('{"event":"stop_requested","reason":"escape"}\n'));
    assert.equal(reasons.length, 1);
    assert.equal(reasons[0], 'escape');

    // Subsequent events attempt to activate aura
    bridge.transition('thinking', { targetId: 'target-1' });
    bridge.transition('acting', validEvent);

    // Overlay must NEVER respawn!
    assert.equal(spawnCount, 1, 'Child must never respawn after stop_requested');
  });

  it('clean close must never respawn overlay on subsequent events', () => {
    let spawnCount = 0;
    const child = createFakeChild();

    const reasons = [];
    const bridge = createDesktopOverlay({
      sessionId: 'sess-no-respawn-3',
      expiresAt: Date.now() + 5000,
      enabled: true,
      spawnImpl: () => { spawnCount++; return child; },
      onStopRequested: reason => reasons.push(reason)
    });

    bridge.transition('acting', validEvent);
    assert.equal(spawnCount, 1);

    // Host cleanly closes bridge
    bridge.close();

    // Later events attempt transition on ended bridge
    assert.throws(() => bridge.transition('acting', validEvent), /Ended overlay requires a new bridge\/session/);

    assert.equal(spawnCount, 1, 'Child must never respawn after bridge.close()');
  });

  // 3. Callback called at most once
  it('callback at most once: multiple error and exit triggers fire callback strictly once', () => {
    const child = createFakeChild();
    const reasons = [];
    const bridge = createDesktopOverlay({
      sessionId: 'sess-cb-once',
      expiresAt: Date.now() + 5000,
      enabled: true,
      spawnImpl: () => child,
      onStopRequested: reason => reasons.push(reason)
    });

    bridge.transition('acting', validEvent);

    // Simulate multiple cascading failure events
    child.emit('error', new Error('Process crash'));
    child.emit('exit', 1, null);
    child.stdin.emit('error', new Error('Stdin broken'));

    assert.equal(reasons.length, 1, 'onStopRequested must be called at most once');
    assert.equal(reasons[0], 'Native overlay disconnected');
  });

  // 4. Clean normal stop must not report false disconnect
  it('clean normal stop via bridge.close() does not report false disconnect', () => {
    const child = createFakeChild();
    const reasons = [];
    const bridge = createDesktopOverlay({
      sessionId: 'sess-clean-stop-1',
      expiresAt: Date.now() + 5000,
      enabled: true,
      spawnImpl: () => child,
      onStopRequested: reason => reasons.push(reason)
    });

    bridge.transition('acting', validEvent);

    // Host cleanly finishes session and closes overlay
    bridge.close();

    // Child process exits normally (exit code 0) after stdin closed
    child.emit('exit', 0, null);

    assert.deepEqual(reasons, [], 'Clean normal stop must not invoke onStopRequested or report disconnect');
    assert.equal(child.stdin.ended, true);
  });

  it('clean normal stop via transition("stopped") does not report false disconnect', () => {
    const child = createFakeChild();
    const reasons = [];
    const bridge = createDesktopOverlay({
      sessionId: 'sess-clean-stop-2',
      expiresAt: Date.now() + 5000,
      enabled: true,
      spawnImpl: () => child,
      onStopRequested: reason => reasons.push(reason)
    });

    bridge.transition('acting', validEvent);

    // Host transitions overlay to stopped
    bridge.transition('stopped');

    // Child process exits
    child.emit('exit', 0, null);

    assert.deepEqual(reasons, [], 'Normal stopped transition must not report disconnect');
    assert.equal(child.stdin.ended, true);
  });

  it('native stop request followed by normal child exit reports escape exactly once and no disconnect', () => {
    const child = createFakeChild();
    const reasons = [];
    const bridge = createDesktopOverlay({
      sessionId: 'sess-clean-stop-3',
      expiresAt: Date.now() + 5000,
      enabled: true,
      spawnImpl: () => child,
      onStopRequested: reason => reasons.push(reason)
    });

    bridge.transition('acting', validEvent);

    // Hotkey triggers stop_requested
    child.stdout.emit('data', Buffer.from('{"event":"stop_requested","reason":"escape"}\n'));

    // Child process then exits with code 0
    child.emit('exit', 0, null);

    assert.deepEqual(reasons, ['escape'], 'Reports escape reason without trailing false disconnect');
  });

  // 5. Intent pass-through and options validation
  it('forwards optional intent into AuthoritativeOverlayBridge', () => {
    const testIntent = { action: 'open_editor', app: 'notepad' };
    const bridge = createDesktopOverlay({
      sessionId: 'sess-intent-test',
      expiresAt: Date.now() + 5000,
      intent: testIntent
    });

    assert.deepEqual(bridge.intent, testIntent);
    bridge.close();
  });

  it('defaults intent to null when omitted', () => {
    const bridge = createDesktopOverlay({
      sessionId: 'sess-intent-null',
      expiresAt: Date.now() + 5000
    });

    assert.equal(bridge.intent, null);
    bridge.close();
  });

  it('preserves finite expiry validation', () => {
    assert.throws(
      () => createDesktopOverlay({ sessionId: 's', expiresAt: Date.now() - 100 }),
      /finite future expiry/
    );
    assert.throws(
      () => createDesktopOverlay({ sessionId: 's', expiresAt: Infinity }),
      /finite future expiry/
    );
  });

  it('default disabled: does not spawn native child when enabled is omitted', () => {
    let spawnCount = 0;
    const bridge = createDesktopOverlay({
      sessionId: 'sess-default-disabled',
      expiresAt: Date.now() + 5000,
      spawnImpl: () => { spawnCount++; return createFakeChild(); }
    });

    bridge.transition('acting', validEvent);
    assert.equal(spawnCount, 0, 'Must not spawn when enabled is false or omitted');
    bridge.close();
  });
});
