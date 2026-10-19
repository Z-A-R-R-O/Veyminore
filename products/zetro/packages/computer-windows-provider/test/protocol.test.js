import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseHelperEnumerateOutput,
  parseHelperInspectOutput,
  buildHelperEnumerateArgs,
  buildHelperInspectArgs,
  ProtocolError
} from '../src/protocol.js';

function createValidEnumerateJson(overrides = {}) {
  const now = Date.now();
  return JSON.stringify({
    generation: String(now),
    observedAt: now,
    windows: [
      {
        hwnd: 12345,
        processId: 6789,
        processName: 'notepad.exe',
        minimized: false,
        visible: true,
        generation: '12345:6789:638640000000000000',
        title: 'Untitled - Notepad',
        bounds: { x: 100, y: 150, width: 800, height: 600 },
        dpi: 96
      }
    ],
    ...overrides
  });
}

test('parseHelperEnumerateOutput: parses valid helper JSON with bounds, dpi, and generation', () => {
  const json = createValidEnumerateJson();
  const result = parseHelperEnumerateOutput(json);

  assert.equal(typeof result.generation, 'string');
  assert.equal(typeof result.observedAt, 'number');
  assert.equal(result.windows.length, 1);

  const w = result.windows[0];
  assert.equal(w.hwnd, 12345);
  assert.equal(w.processId, 6789);
  assert.equal(w.processName, 'notepad.exe');
  assert.equal(w.minimized, false);
  assert.equal(w.visible, true);
  assert.equal(w.generation, '12345:6789:638640000000000000');
  assert.equal(w.title, 'Untitled - Notepad');
  assert.deepEqual(w.bounds, { x: 100, y: 150, width: 800, height: 600 });
  assert.equal(w.dpi, 96);
});

test('parseHelperEnumerateOutput: rejects malformed JSON, missing fields, and future timestamps', () => {
  // Malformed JSON
  assert.throws(
    () => parseHelperEnumerateOutput('{ not json'),
    ProtocolError
  );

  // Missing generation
  assert.throws(
    () => parseHelperEnumerateOutput(JSON.stringify({ observedAt: Date.now(), windows: [] })),
    /generation/i
  );

  // Missing observedAt
  assert.throws(
    () => parseHelperEnumerateOutput(JSON.stringify({ generation: '123', windows: [] })),
    /observedAt/i
  );

  // Future timestamp
  const now = Date.now();
  assert.throws(
    () => parseHelperEnumerateOutput(JSON.stringify({ generation: '123', observedAt: now + 5000, windows: [] }), { clockNow: now }),
    /future/i
  );
});

test('parseHelperInspectOutput: parses valid inspect payload with UI Automation metadata', () => {
  const inspectJson = JSON.stringify({
    status: 'inspected',
    window: {
      hwnd: 12345,
      processId: 6789,
      processName: 'notepad.exe',
      minimized: false,
      visible: true,
      generation: '12345:6789:638640000000000000',
      title: 'Untitled - Notepad',
      bounds: { x: 100, y: 150, width: 800, height: 600 },
      dpi: 96
    },
    automation: {
      supported: true,
      controlType: 'Window',
      name: 'Untitled - Notepad'
    }
  });

  const res = parseHelperInspectOutput(inspectJson);
  assert.equal(res.status, 'inspected');
  assert.equal(res.window.hwnd, 12345);
  assert.equal(res.window.bounds.width, 800);
  assert.equal(res.automation.supported, true);
  assert.equal(res.automation.controlType, 'Window');
});

test('buildHelperEnumerateArgs & buildHelperInspectArgs: constructs strict, safe argument vectors', () => {
  const defaultArgs = buildHelperEnumerateArgs();
  assert.deepEqual(defaultArgs, ['--enumerate', '--limit', '256']);

  const customArgs = buildHelperEnumerateArgs({ limit: 50, includeTitles: true });
  assert.deepEqual(customArgs, ['--enumerate', '--limit', '50', '--include-titles']);

  const inspectArgs = buildHelperInspectArgs(9999);
  assert.deepEqual(inspectArgs, ['--inspect', '9999']);

  assert.throws(() => buildHelperInspectArgs(-1), ProtocolError);
  assert.throws(() => buildHelperInspectArgs('abc'), ProtocolError);
});
