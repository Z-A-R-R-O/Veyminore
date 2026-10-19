import test from 'node:test';
import assert from 'node:assert/strict';
import { RiskLevel } from '@zetro/model-gateway';
import {
  createActionDispatcher,
  ActionDispatchError
} from '../src/index.js';

test('createActionDispatcher: requires valid runner instance', () => {
  assert.throws(() => createActionDispatcher({}), ActionDispatchError);
});

test('ActionDispatcher: dispatches observe action', async () => {
  let captureCalled = false;
  const mockRunner = {
    captureScreen: async (spec) => {
      captureCalled = true;
      return { status: 'captured', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, outputFile: spec.outputFile };
    }
  };

  const dispatcher = createActionDispatcher({ runner: mockRunner, policy: { inputEnabled: true } });
  const res = await dispatcher.dispatch({
    id: 'act-obs-1',
    kind: 'observe',
    outputFile: 'shot.png'
  });

  assert.equal(res.status, 'succeeded');
  assert.equal(captureCalled, true);
  assert.equal(res.result.outputFile, 'shot.png');
});

test('ActionDispatcher: dispatches click action', async () => {
  let mouseActionParams = null;
  const mockRunner = {
    mouseAction: async (params) => {
      mouseActionParams = params;
      return { status: 'completed', action: 'mouse-action', type: 'click', x: params.x, y: params.y };
    }
  };

  const dispatcher = createActionDispatcher({ runner: mockRunner, policy: { inputEnabled: true } });
  const res = await dispatcher.dispatch({
    id: 'act-click-1',
    kind: 'click',
    x: 450,
    y: 320,
    button: 'left',
    clickType: 'single'
  }, { sessionId: 'sess-test', grantExpiry: 1800000000000 });

  assert.equal(res.status, 'succeeded');
  assert.equal(mouseActionParams.actionType, 'click');
  assert.equal(mouseActionParams.x, 450);
  assert.equal(mouseActionParams.y, 320);
  assert.equal(mouseActionParams.sessionId, 'sess-test');
});

test('ActionDispatcher: dispatches mouseMove and drag', async () => {
  const calls = [];
  const mockRunner = {
    mouseAction: async (params) => {
      calls.push(params);
      return { status: 'completed' };
    }
  };

  const dispatcher = createActionDispatcher({ runner: mockRunner, policy: { inputEnabled: true } });

  await dispatcher.dispatch({
    id: 'act-move-1',
    kind: 'mouseMove',
    x: 100,
    y: 100,
    durationMs: 250
  });

  await dispatcher.dispatch({
    id: 'act-drag-1',
    kind: 'drag',
    startX: 100,
    startY: 100,
    endX: 300,
    endY: 300,
    button: 'left',
    durationMs: 300
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].actionType, 'move');
  assert.equal(calls[0].duration, 250);
  assert.equal(calls[1].actionType, 'drag');
  assert.equal(calls[1].endX, 300);
});

test('ActionDispatcher: dispatches pressKeys', async () => {
  let keysParams = null;
  const mockRunner = {
    pressKeys: async (params) => {
      keysParams = params;
      return { status: 'completed', action: 'press-keys', keys: params.keys, count: 2 };
    }
  };

  const dispatcher = createActionDispatcher({ runner: mockRunner, policy: { inputEnabled: true } });
  const res = await dispatcher.dispatch({
    id: 'act-keys-1',
    kind: 'pressKeys',
    keys: ['Control', 'v']
  });

  assert.equal(res.status, 'succeeded');
  assert.equal(keysParams.keys, 'Control+v');
});

test('ActionDispatcher: handles wait action', async () => {
  const dispatcher = createActionDispatcher({ runner: {} });
  const start = Date.now();
  const res = await dispatcher.dispatch({
    id: 'act-wait-1',
    kind: 'wait',
    durationMs: 50
  });

  assert.equal(res.status, 'succeeded');
  assert.equal(res.result.waitedMs, 50);
  assert.ok(Date.now() - start >= 40);
});

test('ActionDispatcher: enforces approval gate for consequential actions', async () => {
  const mockRunner = {
    pressKeys: async () => ({ status: 'completed' })
  };

  const dispatcher = createActionDispatcher({ runner: mockRunner, policy: { inputEnabled: true } });

  // Unapproved consequential action -> approval_required
  const unapprovedRes = await dispatcher.dispatch({
    id: 'act-conseq-1',
    kind: 'pressKeys',
    keys: ['Alt', 'F4'],
    riskLevel: RiskLevel.CONSEQUENTIAL
  }, { isApproved: false });

  assert.equal(unapprovedRes.status, 'approval_required');

  // Pre-approved consequential action -> succeeds
  const approvedRes = await dispatcher.dispatch({
    id: 'act-conseq-2',
    kind: 'pressKeys',
    keys: ['Alt', 'F4'],
    riskLevel: RiskLevel.CONSEQUENTIAL
  }, { isApproved: true });

  assert.equal(approvedRes.status, 'succeeded');
});

test('ActionDispatcher: rejects input when policy inputEnabled is false', async () => {
  const dispatcher = createActionDispatcher({
    runner: {},
    policy: { inputEnabled: false }
  });

  const res = await dispatcher.dispatch({
    id: 'act-click-denied',
    kind: 'click',
    x: 10,
    y: 10
  });

  assert.equal(res.status, 'failed');
  assert.ok(res.error.includes('Input actions are disabled'));
});

test('ActionDispatcher: notifies on human takeover interruption', async () => {
  let takeoverNotified = false;
  const mockRunner = {
    mouseAction: async () => {
      const err = new Error('Human interruption detected');
      err.code = 'HUMAN_TAKEOVER_INTERRUPTED';
      throw err;
    }
  };

  const dispatcher = createActionDispatcher({
    runner: mockRunner,
    policy: { inputEnabled: true },
    onTakeover: () => {
      takeoverNotified = true;
    }
  });

  const res = await dispatcher.dispatch({
    id: 'act-takeover',
    kind: 'click',
    x: 100,
    y: 100
  });

  assert.equal(res.status, 'failed');
  assert.equal(res.code, 'HUMAN_TAKEOVER_INTERRUPTED');
  assert.equal(takeoverNotified, true);
});


test('ActionDispatcher: defaults to observation-only with zero input calls', async () => {
  let calls = 0;
  const dispatcher = createActionDispatcher({ runner: { mouseAction: async () => { calls++; } } });
  const result = await dispatcher.dispatch({ type: 'click', target: { kind: 'point', x: 1, y: 1 } });
  assert.equal(result.status, 'failed');
  assert.equal(calls, 0);
});
