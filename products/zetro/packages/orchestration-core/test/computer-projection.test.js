import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SqliteTaskStore,
  ComputerSessionProjection,
  ComputerSessionStates,
  COMPUTER_SESSION_SCHEMA_VERSION,
  NATIVE_LIMITATION_NOTICE
} from '../src/index.js';

async function createTestEnv() {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-comp-proj-'));
  const dbPath = join(dir, 'tasks.db');
  const store = new SqliteTaskStore(dbPath);
  await store.init();
  const projection = new ComputerSessionProjection(store);
  return {
    dir,
    dbPath,
    store,
    projection,
    async cleanup() {
      store.close();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

test('ComputerSession: Registration and initial observed projection', async () => {
  const env = await createTestEnv();
  try {
    const session = env.projection.registerSession({
      sessionId: 'csess-reg-1',
      targetId: 'window-hwnd-001',
      targetKind: 'window',
      taskId: 'task-w9-001',
      attemptId: 'att-01',
      expiresInMs: 1800000,
      metadata: { title: 'Notepad' }
    });

    assert.equal(session.sessionId, 'csess-reg-1');
    assert.equal(session.targetId, 'window-hwnd-001');
    assert.equal(session.targetKind, 'window');
    assert.equal(session.taskId, 'task-w9-001');
    assert.equal(session.attemptId, 'att-01');
    assert.equal(session.state, ComputerSessionStates.OBSERVED);
    assert.equal(session.phase, 'registered');
    assert.equal(session.indicators.acting, false);
    assert.equal(session.indicators.granted, false);
    assert.equal(session.indicators.paused, false);
    assert.equal(session.indicators.verified, false);
    assert.equal(session.indicators.isNative, false);
    assert.equal(session.lastSequence, 1);
    assert.equal(session.limitations, NATIVE_LIMITATION_NOTICE);

    const events = env.store.getComputerEvents('csess-reg-1');
    assert.equal(events.length, 1);
    assert.equal(events[0].sequence, 1);
    assert.equal(events[0].eventType, 'session_registered');
    assert.equal(events[0].targetId, 'window-hwnd-001');
  } finally {
    await env.cleanup();
  }
});

test('ComputerSession: Monotonic sequence enforcement rejects replay and regression', async () => {
  const env = await createTestEnv();
  try {
    env.projection.registerSession({
      sessionId: 'csess-seq-1',
      targetId: 'desktop-main',
      targetKind: 'desktop'
    });

    // Sequence 2: grant
    const updated = env.projection.recordEvent('csess-seq-1', {
      sequence: 2,
      eventType: 'grant',
      payload: { scope: 'input' }
    });
    assert.equal(updated.lastSequence, 2);
    assert.equal(updated.state, ComputerSessionStates.GRANTED);

    // Replay sequence 2 -> must throw
    assert.throws(() => {
      env.projection.recordEvent('csess-seq-1', {
        sequence: 2,
        eventType: 'grant',
        payload: { scope: 'replay' }
      });
    }, /Sequence regression or replay detected/);

    // Sequence regression (1 < 2) -> must throw
    assert.throws(() => {
      env.projection.recordEvent('csess-seq-1', {
        sequence: 1,
        eventType: 'pause'
      });
    }, /Sequence regression or replay detected/);

    // Non-integer sequence -> must throw
    assert.throws(() => {
      env.projection.recordEvent('csess-seq-1', {
        sequence: 'three',
        eventType: 'pause'
      });
    }, /Sequence regression or replay detected/);
  } finally {
    await env.cleanup();
  }
});

test('ComputerSession: Exact identity binding enforcement (wrong session, target, task, attempt fail closed)', async () => {
  const env = await createTestEnv();
  try {
    env.projection.registerSession({
      sessionId: 'csess-ident-1',
      targetId: 'surface-123',
      targetKind: 'control',
      taskId: 'task-ident-A',
      attemptId: 'att-ident-1'
    });

    // Wrong session ID in input
    assert.throws(() => {
      env.projection.recordEvent('csess-ident-1', {
        sessionId: 'csess-wrong',
        sequence: 2,
        eventType: 'grant'
      });
    }, /Event sessionId mismatch/);

    // Wrong target ID in input
    assert.throws(() => {
      env.projection.recordEvent('csess-ident-1', {
        targetId: 'surface-foreign',
        sequence: 2,
        eventType: 'grant'
      });
    }, /Event targetId mismatch/);

    // Wrong task ID in input
    assert.throws(() => {
      env.projection.recordEvent('csess-ident-1', {
        taskId: 'task-foreign',
        sequence: 2,
        eventType: 'grant'
      });
    }, /Event taskId mismatch/);

    // Wrong attempt ID in input
    assert.throws(() => {
      env.projection.recordEvent('csess-ident-1', {
        attemptId: 'att-foreign',
        sequence: 2,
        eventType: 'grant'
      });
    }, /Event attemptId mismatch/);
  } finally {
    await env.cleanup();
  }
});

test('ComputerSession: Future timestamp rejection fails closed beyond 5000ms skew', async () => {
  const env = await createTestEnv();
  try {
    env.projection.registerSession({
      sessionId: 'csess-skew-1',
      targetId: 'window-01',
      targetKind: 'window'
    });

    // Skew + 10 seconds -> rejected
    assert.throws(() => {
      env.projection.recordEvent('csess-skew-1', {
        sequence: 2,
        eventType: 'grant',
        timestamp: Date.now() + 10000
      });
    }, /Event timestamp cannot be in the future/);

    // Skew + 1 second -> accepted within 5000ms tolerance
    const valid = env.projection.recordEvent('csess-skew-1', {
      sequence: 2,
      eventType: 'grant',
      timestamp: Date.now() + 1000
    });
    assert.equal(valid.lastSequence, 2);
  } finally {
    await env.cleanup();
  }
});

test('ComputerSession: Grant, acting lifecycle and companion pointer visibility contract', async () => {
  const env = await createTestEnv();
  try {
    env.projection.registerSession({
      sessionId: 'csess-ptr-1',
      targetId: 'window-02',
      targetKind: 'window'
    });

    // Action cannot start without granted control
    assert.throws(() => {
      env.projection.recordEvent('csess-ptr-1', {
        sequence: 2,
        eventType: 'start_action'
      });
    }, /Cannot start action without granted control/);

    // 1. Grant control
    env.projection.recordEvent('csess-ptr-1', {
      sequence: 2,
      eventType: 'grant'
    });

    // In granted state: acting is false -> pointer must be hidden
    let feed = env.projection.getOverlayFeed('csess-ptr-1');
    assert.equal(feed.state, ComputerSessionStates.GRANTED);
    assert.equal(feed.indicators.acting, false);
    assert.equal(feed.pointer.visible, false);

    // 2. Start action with coordinates
    env.projection.recordEvent('csess-ptr-1', {
      sequence: 3,
      eventType: 'start_action',
      payload: {
        x: 450,
        y: 600,
        action: 'mouse_move'
      }
    });

    // In acting state: acting is true -> pointer is VISIBLE with coordinates
    feed = env.projection.getOverlayFeed('csess-ptr-1');
    assert.equal(feed.state, ComputerSessionStates.ACTING);
    assert.equal(feed.indicators.acting, true);
    assert.equal(feed.pointer.visible, true);
    assert.equal(feed.pointer.x, 450);
    assert.equal(feed.pointer.y, 600);

    // 3. Pause session
    env.projection.recordEvent('csess-ptr-1', {
      sequence: 4,
      eventType: 'pause'
    });
    feed = env.projection.getOverlayFeed('csess-ptr-1');
    assert.equal(feed.state, ComputerSessionStates.PAUSED);
    assert.equal(feed.indicators.acting, false);
    assert.equal(feed.pointer.visible, false); // pointer hidden on pause

    // 4. Resume
    env.projection.recordEvent('csess-ptr-1', {
      sequence: 5,
      eventType: 'resume'
    });
    feed = env.projection.getOverlayFeed('csess-ptr-1');
    assert.equal(feed.state, ComputerSessionStates.GRANTED);
    assert.equal(feed.pointer.visible, false);

    // 5. Complete action (end_action)
    env.projection.recordEvent('csess-ptr-1', {
      sequence: 6,
      eventType: 'end_action'
    });
    feed = env.projection.getOverlayFeed('csess-ptr-1');
    assert.equal(feed.indicators.acting, false);
    assert.equal(feed.pointer.visible, false);
  } finally {
    await env.cleanup();
  }
});

test('ComputerSession: Terminal states for effects (stop and revoke reject subsequent active transitions)', async () => {
  const env = await createTestEnv();
  try {
    env.projection.registerSession({
      sessionId: 'csess-term-1',
      targetId: 'window-03',
      targetKind: 'window'
    });

    env.projection.recordEvent('csess-term-1', {
      sequence: 2,
      eventType: 'grant'
    });

    // Stop session
    const stopped = env.projection.stopSession('csess-term-1', 'Manual operator abort');
    assert.equal(stopped.state, ComputerSessionStates.STOPPED);
    assert.equal(stopped.indicators.acting, false);
    assert.equal(stopped.indicators.granted, false);
    assert.ok(typeof stopped.stoppedAt === 'number');

    // Attempting active transitions on stopped session must fail closed
    assert.throws(() => {
      env.projection.recordEvent('csess-term-1', {
        sequence: 4,
        eventType: 'grant'
      });
    }, /Cannot record event on terminal session \(stopped\)/);

    assert.throws(() => {
      env.projection.recordEvent('csess-term-1', {
        sequence: 4,
        eventType: 'start_action'
      });
    }, /Cannot record event on terminal session \(stopped\)/);

    // Test revoke on a second session
    env.projection.registerSession({
      sessionId: 'csess-term-2',
      targetId: 'window-04',
      targetKind: 'window'
    });

    const revoked = env.projection.revokeSession('csess-term-2', 'Access permission revoked');
    assert.equal(revoked.state, ComputerSessionStates.REVOKED);
    assert.equal(revoked.indicators.acting, false);
    assert.equal(revoked.indicators.granted, false);
    assert.ok(typeof revoked.revokedAt === 'number');

    // Attempting active transitions on revoked session must fail closed
    assert.throws(() => {
      env.projection.recordEvent('csess-term-2', {
        sequence: 3,
        eventType: 'grant'
      });
    }, /Cannot record event on terminal session \(revoked\)/);
  } finally {
    await env.cleanup();
  }
});

test('ComputerSession: Disconnect clears active flags (acting=false, granted=false)', async () => {
  const env = await createTestEnv();
  try {
    env.projection.registerSession({
      sessionId: 'csess-disc-1',
      targetId: 'window-05',
      targetKind: 'window'
    });

    env.projection.recordEvent('csess-disc-1', {
      sequence: 2,
      eventType: 'grant'
    });
    env.projection.recordEvent('csess-disc-1', {
      sequence: 3,
      eventType: 'start_action',
      payload: { x: 100, y: 100 }
    });

    const disc = env.projection.disconnectSession('csess-disc-1', 'Network socket dropped');
    assert.equal(disc.state, ComputerSessionStates.DISCONNECTED);
    assert.equal(disc.indicators.acting, false);
    assert.equal(disc.indicators.granted, false);

    const feed = env.projection.getOverlayFeed('csess-disc-1');
    assert.equal(feed.state, ComputerSessionStates.DISCONNECTED);
    assert.equal(feed.indicators.acting, false);
    assert.equal(feed.indicators.granted, false);
    assert.equal(feed.pointer.visible, false);
  } finally {
    await env.cleanup();
  }
});

test('ComputerSession: Invariant: no actor claim can establish verified or native access', async () => {
  const env = await createTestEnv();
  try {
    // 1. Actor attempts claim in register params
    const s1 = env.projection.registerSession({
      sessionId: 'csess-actor-1',
      targetId: 'win-native',
      targetKind: 'window',
      verified: true,
      isNative: true
    });
    assert.equal(s1.indicators.verified, false);
    assert.equal(s1.indicators.isNative, false);

    // 2. Actor attempts claim in event payload
    const s2 = env.projection.recordEvent('csess-actor-1', {
      sequence: 2,
      eventType: 'grant',
      payload: {
        verified: true,
        isNative: true,
        claim: 'actor claims native access'
      }
    });
    assert.equal(s2.indicators.verified, false);
    assert.equal(s2.indicators.isNative, false);

    // 3. Raw store update cannot override invariants
    const s3 = env.store.updateComputerSession('csess-actor-1', {
      verified: true,
      isNative: true
    });
    assert.equal(s3.verified, false);
    assert.equal(s3.isNative, false);

    // 4. Overlay feed strictly denies claims
    const feed = env.projection.getOverlayFeed('csess-actor-1');
    assert.equal(feed.indicators.verified, false);
    assert.equal(feed.indicators.isNative, false);
  } finally {
    await env.cleanup();
  }
});

test('ComputerSession: Read-only overlay feed bounding and secret redaction', async () => {
  const env = await createTestEnv();
  try {
    env.projection.registerSession({
      sessionId: 'csess-feed-1',
      targetId: 'win-overlay',
      targetKind: 'window'
    });

    // Record events containing secrets and paths
    for (let i = 2; i <= 10; i++) {
      env.projection.recordEvent('csess-feed-1', {
        sequence: i,
        eventType: 'heartbeat',
        payload: {
          summary: `Step ${i} Bearer sk-ant-api03-abcdefghijklmnop C:\\secret\\path.txt`,
          x: i * 10,
          y: i * 20
        }
      });
    }

    // Query overlay feed with limit: 3 and sinceSequence: 1 to inspect heartbeat events
    const feed = env.projection.getOverlayFeed('csess-feed-1', { sinceSequence: 1, limit: 3 });
    assert.equal(feed.events.length, 3);
    for (const ev of feed.events) {
      assert.ok(!ev.summary.includes('sk-ant-api03'));
      assert.ok(!ev.summary.includes('C:\\secret'));
      assert.ok(ev.summary.includes('[REDACTED]'));
    }
  } finally {
    await env.cleanup();
  }
});

test('ComputerSession: SQLite restart survival across close and reopen in read-only mode', async () => {
  const env = await createTestEnv();
  const dbPath = env.dbPath;
  try {
    env.projection.registerSession({
      sessionId: 'csess-restart-1',
      targetId: 'win-persist',
      targetKind: 'window',
      taskId: 'task-pers-1',
      attemptId: 'att-pers-1'
    });

    env.projection.recordEvent('csess-restart-1', {
      sequence: 2,
      eventType: 'grant'
    });
    env.projection.recordEvent('csess-restart-1', {
      sequence: 3,
      eventType: 'start_action',
      payload: { x: 777, y: 888 }
    });

    // Close the store
    env.store.close();

    // Reopen using ComputerSessionProjection.openReadOnly
    const roProjection = await ComputerSessionProjection.openReadOnly(dbPath);
    try {
      const proj = roProjection.getSessionProjection('csess-restart-1');
      assert.ok(proj);
      assert.equal(proj.sessionId, 'csess-restart-1');
      assert.equal(proj.targetId, 'win-persist');
      assert.equal(proj.taskId, 'task-pers-1');
      assert.equal(proj.attemptId, 'att-pers-1');
      assert.equal(proj.state, ComputerSessionStates.ACTING);
      assert.equal(proj.indicators.acting, true);
      assert.equal(proj.indicators.granted, true);
      assert.equal(proj.lastSequence, 3);

      const feed = roProjection.getOverlayFeed('csess-restart-1');
      assert.equal(feed.pointer.visible, true);
      assert.equal(feed.pointer.x, 777);
      assert.equal(feed.pointer.y, 888);
      assert.equal(feed.events.length, 3);

      // Mutating on read-only projection must fail closed
      assert.throws(() => {
        roProjection.registerSession({
          sessionId: 'csess-ro-fail',
          targetId: 'win-x',
          targetKind: 'window'
        });
      }, /Cannot register session in read-only ComputerSessionProjection/);

      assert.throws(() => {
        roProjection.recordEvent('csess-restart-1', {
          sequence: 4,
          eventType: 'end_action'
        });
      }, /Cannot record event in read-only ComputerSessionProjection/);
    } finally {
      roProjection.close();
    }
  } finally {
    await env.cleanup();
  }
});
