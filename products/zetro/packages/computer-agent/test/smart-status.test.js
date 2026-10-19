import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartStatus } from '../src/smart-status.js';

test('createSmartStatus - initial state', () => {
  const status = createSmartStatus();
  const snap = status.getSnapshot();
  assert.equal(snap.taskId, null);
  assert.equal(snap.phase, 'off');
  assert.equal(snap.working, false);
  assert.equal(snap.text, 'Ready when you are');
  assert.deepEqual(snap.verifiedSteps, []);
  assert.equal(snap.currentStep, null);
  assert.equal(snap.settledReason, null);
});

test('createSmartStatus - monotonic sequence and task lifecycle', () => {
  let now = 1000;
  const status = createSmartStatus({ clock: () => now });

  const intent = {
    operation: 'create_folder',
    targetLabel: 'hello',
    destinationLabel: 'Downloads',
    allowDisplayLabels: true
  };

  // 1. Initial intention
  const ok1 = status.update({
    taskId: 'task-1',
    sequence: 1,
    phase: 'intention',
    intent
  });
  assert.equal(ok1, true);
  let snap = status.getSnapshot();
  assert.equal(snap.taskId, 'task-1');
  assert.equal(snap.sequence, 1);
  assert.equal(snap.phase, 'intention');
  assert.equal(snap.working, true);
  assert.equal(snap.text, "I'll create ‘hello’ in Downloads.");

  // 2. Reject non-monotonic sequence
  const badSeq = status.update({
    taskId: 'task-1',
    sequence: 1,
    phase: 'thinking'
  });
  assert.equal(badSeq, false);

  // 3. Reject foreign task while task-1 is active
  const badTask = status.update({
    taskId: 'task-2',
    sequence: 1,
    phase: 'intention'
  });
  assert.equal(badTask, false);

  // 4. Advance sequence
  now = 2000;
  status.update({
    taskId: 'task-1',
    sequence: 2,
    phase: 'thinking'
  });
  snap = status.getSnapshot();
  assert.equal(snap.phase, 'thinking');
  assert.equal(snap.elapsedMs, 1000);
});

test('createSmartStatus - verified step accumulation and cap at 20', () => {
  const status = createSmartStatus();
  status.update({ taskId: 't1', sequence: 1, phase: 'intention' });

  for (let i = 2; i <= 25; i++) {
    status.update({
      taskId: 't1',
      sequence: i,
      phase: 'checking',
      verified: true,
      stepId: `step-${i}`
    });
  }

  const snap = status.getSnapshot();
  assert.equal(snap.verifiedSteps.length, 20);
  assert.equal(snap.verifiedSteps[0].id, 'step-2');
  assert.equal(snap.verifiedSteps[19].id, 'step-21');
  assert.equal(snap.currentStep, null);
});

test('createSmartStatus - observing 8s dynamic phrase', () => {
  let now = 10000;
  const status = createSmartStatus({ clock: () => now });
  status.update({ taskId: 't1', sequence: 1, phase: 'intention' });

  now = 11000;
  status.update({ taskId: 't1', sequence: 2, phase: 'observing' });
  assert.equal(status.getSnapshot().text.includes('target'), true);

  // 7.9s later
  now = 18900;
  assert.notEqual(status.getSnapshot().text, 'Still locating the target…');

  // 8.0s later
  now = 19000;
  assert.equal(status.getSnapshot().text, 'Still locating the target…');
});

test('createSmartStatus - completed requires verified===true', () => {
  const status = createSmartStatus();
  status.update({ taskId: 't1', sequence: 1, phase: 'intention' });
  status.update({ taskId: 't1', sequence: 2, phase: 'acting' });

  // Unverified completion falls back to uncertain
  status.update({ taskId: 't1', sequence: 3, phase: 'completed', verified: false });
  let snap = status.getSnapshot();
  assert.equal(snap.phase, 'uncertain');
  assert.equal(snap.settledReason, 'uncertain');
  assert.equal(snap.working, false);

  // New task with verified completion
  status.update({ taskId: 't2', sequence: 1, phase: 'intention' });
  status.update({ taskId: 't2', sequence: 2, phase: 'completed', verified: true });
  snap = status.getSnapshot();
  assert.equal(snap.phase, 'completed');
  assert.equal(snap.settledReason, 'completed');
  assert.equal(snap.working, false);
});

test('createSmartStatus - terminal and pause freeze elapsed', () => {
  let now = 1000;
  const status = createSmartStatus({ clock: () => now });
  status.update({ taskId: 't1', sequence: 1, phase: 'intention' });

  now = 3500;
  status.update({ taskId: 't1', sequence: 2, phase: 'paused' });
  const snap1 = status.getSnapshot();
  assert.equal(snap1.elapsedMs, 2500);
  assert.equal(snap1.working, false);
  assert.equal(snap1.currentStep, null);

  now = 10000;
  const snap2 = status.getSnapshot();
  assert.equal(snap2.elapsedMs, 2500); // frozen
});

test('createSmartStatus - privacy preserves zero prompt or typed text leakage', () => {
  const status = createSmartStatus();
  status.update({
    taskId: 't-privacy',
    sequence: 1,
    phase: 'intention',
    intent: {
      operation: 'search',
      application: 'Chrome',
      query: 'confidential acquisition report 2026',
      typedText: 'secret_token_abc123',
      prompt: 'Search for confidential acquisition report',
      allowDisplayLabels: true
    }
  });

  const snap = status.getSnapshot();
  assert.equal(snap.text.includes('confidential'), false);
  assert.equal(snap.text.includes('secret_token'), false);
  assert.equal(snap.text.includes('acquisition'), false);
  assert.equal(snap.currentStep?.text.includes('secret_token'), false);
});

test('createSmartStatus - cleanup close is idempotent and halts updates', () => {
  let callCount = 0;
  const status = createSmartStatus({ onChange: () => { callCount++; } });

  assert.equal(status.update({ taskId: 't-close', sequence: 1, phase: 'intention' }), true);
  assert.equal(callCount, 1);

  status.close();
  status.close(); // idempotent

  assert.equal(status.update({ taskId: 't-close', sequence: 2, phase: 'acting' }), false);
  assert.equal(callCount, 1);
});

test('createSmartStatus - invalid event rejection without mutating state', () => {
  const status = createSmartStatus();
  status.update({ taskId: 't-valid', sequence: 1, phase: 'intention' });

  // null or non-object event
  assert.equal(status.update(null), false);
  assert.equal(status.update('not-an-object'), false);

  // invalid / empty taskId
  assert.equal(status.update({ taskId: '', sequence: 2, phase: 'acting' }), false);
  assert.equal(status.update({ taskId: '   ', sequence: 2, phase: 'acting' }), false);

  // invalid phase
  assert.equal(status.update({ taskId: 't-valid', sequence: 2, phase: 'invalid_phase' }), false);

  // invalid sequence
  assert.equal(status.update({ taskId: 't-valid', sequence: -1, phase: 'acting' }), false);
  assert.equal(status.update({ taskId: 't-valid', sequence: 'two', phase: 'acting' }), false);

  assert.equal(status.getSnapshot().phase, 'intention');
  assert.equal(status.getSnapshot().sequence, 1);
});

