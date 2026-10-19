import test from 'node:test';
import assert from 'node:assert/strict';

import { createWindowsObserver } from '../src/observer-adapter.js';

function createMockHelperOutput() {
  const now = Date.now();
  const gen = String(now);
  return JSON.stringify({
    generation: gen,
    observedAt: now,
    windows: [
      {
        hwnd: 4242,
        processId: 1337,
        processName: 'testapp.exe',
        minimized: false,
        visible: true,
        generation: gen,
        title: 'Test Application Window',
        bounds: { x: 200, y: 150, width: 1024, height: 768 },
        dpi: 144
      }
    ]
  });
}

function createMockInspectOutput(hwnd) {
  return JSON.stringify({
    status: 'inspected',
    window: {
      hwnd,
      processId: 1337,
      processName: 'testapp.exe',
      minimized: false,
      visible: true,
      generation: `${hwnd}:1337:99999`,
      title: 'Test Application Window',
      bounds: { x: 200, y: 150, width: 1024, height: 768 },
      dpi: 144
    },
    automation: {
      supported: true,
      controlType: 'Window',
      name: 'Test Application Window'
    }
  });
}

test('createWindowsObserver: integrates with @zetro/computer-observer and enumerates windows', async () => {
  const mockExecFile = async (path, args) => {
    if (args[0] === '--enumerate') {
      return { stdout: createMockHelperOutput(), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };

  const observer = createWindowsObserver({
    execFileImpl: mockExecFile,
    includeTitles: true
  });

  const snapshot = await observer.enumerate();
  assert.ok(snapshot);
  assert.equal(typeof snapshot.generation, 'string');
  assert.equal(typeof snapshot.observedAt, 'number');
  assert.equal(snapshot.windows.length, 1);

  const w = snapshot.windows[0];
  assert.equal(w.hwnd, 4242);
  assert.equal(w.processId, 1337);
  assert.equal(w.processName, 'testapp.exe');
  assert.equal(w.minimized, false);
  assert.equal(w.visible, true);
  assert.equal(w.generation, snapshot.generation);
});

test('createWindowsObserver: observes specific target window and verifies identity', async () => {
  let capturedGen = null;
  const mockExecFile = async (path, args) => {
    if (args[0] === '--enumerate') {
      const output = createMockHelperOutput();
      capturedGen = JSON.parse(output).generation;
      return { stdout: output, stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };

  const observer = createWindowsObserver({
    execFileImpl: mockExecFile
  });

  const result = await observer.observeWindow({
    hwnd: 4242,
    expectedProcessId: 1337
  });

  assert.equal(result.status, 'observed');
  assert.equal(result.window.hwnd, 4242);
  assert.equal(result.capture.status, 'not_requested');
});

test('createWindowsObserver: honest capabilities report unsupported capture and zero effects', () => {
  const observer = createWindowsObserver({
    execFileImpl: async () => ({ stdout: '', stderr: '' })
  });

  const caps = observer.getCapabilities();
  assert.equal(caps.nativeCapture, 'unsupported');
  assert.deepEqual(caps.effects, {
    mouse: false,
    keyboard: false,
    clipboard: false,
    shell: false
  });
  assert.equal(caps.read.enumerateWindows, true);
});

test('createWindowsObserver: requireCapture fails closed honestly with CAPTURE_UNSUPPORTED', async () => {
  const mockExecFile = async (path, args) => {
    return { stdout: createMockHelperOutput(), stderr: '' };
  };

  const observer = createWindowsObserver({
    execFileImpl: mockExecFile
  });

  await assert.rejects(
    () => observer.observeWindow({ hwnd: 4242, capture: true, requireCapture: true }),
    err => err.code === 'CAPTURE_UNSUPPORTED'
  );
});

test('createWindowsObserver: inspectWindow retrieves native bounds, DPI, and UIAutomation metadata', async () => {
  const mockExecFile = async (path, args) => {
    if (args[0] === '--inspect') {
      return { stdout: createMockInspectOutput(4242), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };

  const observer = createWindowsObserver({
    execFileImpl: mockExecFile
  });

  const inspectRes = await observer.inspectWindow(4242);
  assert.equal(inspectRes.status, 'inspected');
  assert.equal(inspectRes.window.hwnd, 4242);
  assert.deepEqual(inspectRes.window.bounds, { x: 200, y: 150, width: 1024, height: 768 });
  assert.equal(inspectRes.window.dpi, 144);
  assert.equal(inspectRes.automation.supported, true);
  assert.equal(inspectRes.automation.controlType, 'Window');
});
