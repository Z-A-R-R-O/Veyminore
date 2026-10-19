import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHelperMouseActionArgs,
  parseHelperMouseActionOutput,
  buildHelperPressKeysArgs,
  parseHelperPressKeysOutput,
  buildHelperCaptureScreenArgs,
  parseHelperCaptureScreenOutput,
  createWindowsProcessRunner,
  ProcessRunnerError,
  ProtocolError
} from '../src/index.js';

test('buildHelperMouseActionArgs: builds expected argument arrays', () => {
  const args = buildHelperMouseActionArgs({
    actionType: 'click',
    x: 100.4,
    y: 200.6,
    button: 'left',
    clickType: 'double',
    inputEnabled: true,
    grantExpiry: 1700000000000,
    sessionId: 'sess-1'
  });

  assert.deepEqual(args, [
    '--mouse-action',
    '--action-type', 'click',
    '--x', '100',
    '--y', '201',
    '--button', 'left',
    '--click-type', 'double',
    '--input-enabled',
    '--grant-expiry', '1700000000000',
    '--session', 'sess-1'
  ]);
});

test('buildHelperMouseActionArgs: handles drag and scroll arguments', () => {
  const dragArgs = buildHelperMouseActionArgs({
    actionType: 'drag',
    x: 10,
    y: 20,
    endX: 100,
    endY: 200,
    duration: 150
  });
  assert.ok(dragArgs.includes('--action-type') && dragArgs.includes('drag'));
  assert.ok(dragArgs.includes('--end-x') && dragArgs.includes('100'));
  assert.ok(dragArgs.includes('--duration') && dragArgs.includes('150'));

  const scrollArgs = buildHelperMouseActionArgs({
    actionType: 'scroll',
    x: 50,
    y: 50,
    deltaX: 2,
    deltaY: -5
  });
  assert.ok(scrollArgs.includes('--action-type') && scrollArgs.includes('scroll'));
  assert.ok(scrollArgs.includes('--delta-x') && scrollArgs.includes('2'));
  assert.ok(scrollArgs.includes('--delta-y') && scrollArgs.includes('-5'));
});

test('parseHelperMouseActionOutput: parses valid completed response', () => {
  const parsed = parseHelperMouseActionOutput(JSON.stringify({
    status: 'completed',
    action: 'mouse-action',
    type: 'click',
    x: 150,
    y: 250
  }));

  assert.equal(parsed.status, 'completed');
  assert.equal(parsed.type, 'click');
  assert.equal(parsed.x, 150);
  assert.equal(parsed.y, 250);
});

test('parseHelperMouseActionOutput: rejects invalid JSON or unexpected status', () => {
  assert.throws(() => parseHelperMouseActionOutput('bad json'), ProtocolError);
  assert.throws(() => parseHelperMouseActionOutput(JSON.stringify({ status: 'failed' })), ProtocolError);
});

test('buildHelperPressKeysArgs: validates keys requirement', () => {
  assert.throws(() => buildHelperPressKeysArgs({}), ProtocolError);
  assert.throws(() => buildHelperPressKeysArgs({ keys: '   ' }), ProtocolError);

  const args = buildHelperPressKeysArgs({
    keys: 'Control+c',
    inputEnabled: true,
    grantExpiry: 1700000000000,
    sessionId: 'sess-keys'
  });

  assert.deepEqual(args, [
    '--press-keys',
    '--keys', 'Control+c',
    '--input-enabled',
    '--grant-expiry', '1700000000000',
    '--session', 'sess-keys'
  ]);
});

test('parseHelperPressKeysOutput: parses valid completed response', () => {
  const parsed = parseHelperPressKeysOutput(JSON.stringify({
    status: 'completed',
    action: 'press-keys',
    keys: 'Control+c',
    count: 2
  }));

  assert.equal(parsed.status, 'completed');
  assert.equal(parsed.keys, 'Control+c');
  assert.equal(parsed.count, 2);
});

test('buildHelperCaptureScreenArgs & parseHelperCaptureScreenOutput: handles capture protocol', () => {
  const args = buildHelperCaptureScreenArgs({ outputFile: 'C:/temp/shot.png' });
  assert.deepEqual(args, ['--capture-screen', '--output-file', 'C:/temp/shot.png']);

  const parsed = parseHelperCaptureScreenOutput(JSON.stringify({
    status: 'captured',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    outputFile: 'C:/temp/shot.png'
  }));

  assert.equal(parsed.status, 'captured');
  assert.equal(parsed.bounds.width, 1920);
  assert.equal(parsed.outputFile, 'C:/temp/shot.png');
});

test('process-runner: maps exit code 13 to HUMAN_TAKEOVER_INTERRUPTED', async () => {
  const fakeExecFile = async () => {
    const err = new Error('Process exited with code 13');
    err.code = 13;
    err.status = 13;
    err.stderr = 'Human interruption detected (physical input during execution)';
    throw err;
  };

  const runner = createWindowsProcessRunner({ execFileImpl: fakeExecFile });
  await assert.rejects(
    async () => runner.mouseAction({ actionType: 'move', x: 100, y: 100 }),
    (err) => {
      assert.equal(err instanceof ProcessRunnerError, true);
      assert.equal(err.code, 'HUMAN_TAKEOVER_INTERRUPTED');
      return true;
    }
  );
});

test('process-runner: maps exit code 20 to CAPTURE_FAILED', async () => {
  const fakeExecFile = async () => {
    const err = new Error('Process exited with code 20');
    err.code = 20;
    err.status = 20;
    err.stderr = 'Screen capture failed: test error';
    throw err;
  };

  const runner = createWindowsProcessRunner({ execFileImpl: fakeExecFile });
  await assert.rejects(
    async () => runner.captureScreen(),
    (err) => {
      assert.equal(err instanceof ProcessRunnerError, true);
      assert.equal(err.code, 'CAPTURE_FAILED');
      return true;
    }
  );
});
