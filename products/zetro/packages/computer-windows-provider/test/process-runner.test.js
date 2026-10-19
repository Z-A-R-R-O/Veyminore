import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWindowsProcessRunner,
  ProcessRunnerError
} from '../src/process-runner.js';

test('createWindowsProcessRunner: runs enumerate spec with injected fake helper', async () => {
  const fakeStdout = JSON.stringify({
    generation: '1000',
    observedAt: Date.now(),
    windows: [
      {
        hwnd: 555,
        processId: 100,
        processName: 'calc.exe',
        minimized: false,
        visible: true,
        generation: '555:100:1',
        title: 'Calculator',
        bounds: { x: 50, y: 50, width: 400, height: 500 },
        dpi: 96
      }
    ]
  });

  let capturedArgs = null;
  let capturedOptions = null;
  const mockExecFile = async (path, args, options) => {
    capturedArgs = args;
    capturedOptions = options;
    return { stdout: fakeStdout, stderr: '' };
  };

  const runner = createWindowsProcessRunner({
    helperPath: 'fake-helper.exe',
    execFileImpl: mockExecFile,
    includeTitles: true
  });

  const result = await runner.run({ kind: 'enumerate', limit: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, fakeStdout);
  assert.deepEqual(capturedArgs, ['--enumerate', '--limit', '10', '--include-titles']);
  assert.equal(capturedOptions.shell, false);
});

test('createWindowsProcessRunner: runs inspect command on specific HWND', async () => {
  const fakeInspectStdout = JSON.stringify({
    status: 'inspected',
    window: {
      hwnd: 555,
      processId: 100,
      processName: 'calc.exe',
      minimized: false,
      visible: true,
      generation: '555:100:1',
      title: 'Calculator',
      bounds: { x: 50, y: 50, width: 400, height: 500 },
      dpi: 96
    },
    automation: { supported: true, controlType: 'Window', name: 'Calculator' }
  });

  const mockExecFile = async (path, args) => {
    assert.deepEqual(args, ['--inspect', '555']);
    return { stdout: fakeInspectStdout, stderr: '' };
  };

  const runner = createWindowsProcessRunner({
    execFileImpl: mockExecFile
  });

  const result = await runner.inspect(555);
  assert.equal(result.ok, true);
  assert.equal(result.stdout, fakeInspectStdout);
});

test('createWindowsProcessRunner: handles execution timeout and buffer overflow', async () => {
  // Timeout error
  const timeoutMock = async () => {
    const err = new Error('timed out');
    err.code = 'ETIMEDOUT';
    throw err;
  };

  const timeoutRunner = createWindowsProcessRunner({
    execFileImpl: timeoutMock
  });

  await assert.rejects(
    () => timeoutRunner.run({ kind: 'enumerate' }),
    err => err instanceof ProcessRunnerError && err.code === 'OBSERVER_TIMEOUT'
  );

  // Buffer overflow error
  const maxBufferMock = async () => {
    const err = new Error('maxBuffer exceeded');
    err.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    throw err;
  };

  const bufferRunner = createWindowsProcessRunner({
    execFileImpl: maxBufferMock
  });

  await assert.rejects(
    () => bufferRunner.run({ kind: 'enumerate' }),
    err => err instanceof ProcessRunnerError && err.code === 'RESPONSE_TOO_LARGE'
  );
});

test('createWindowsProcessRunner: abort signal cleanly cancels execution', async () => {
  const controller = new AbortController();
  controller.abort();

  const runner = createWindowsProcessRunner({
    execFileImpl: async () => ({ stdout: '', stderr: '' })
  });

  await assert.rejects(
    () => runner.run({ kind: 'enumerate' }, { signal: controller.signal }),
    /aborted/i
  );
});
