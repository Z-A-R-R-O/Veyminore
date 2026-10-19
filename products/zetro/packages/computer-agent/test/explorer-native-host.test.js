import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyFileExplorerFolder } from '../src/folder-verifier.js';
import { runExplorerFolderTask } from '../src/explorer-native-host.js';

const target = { hwnd: 10, processId: 20, generation: 'start-1', processName: 'explorer', visible: true, minimized: false };
function createFixture() {
  const parent = mkdtempSync(join(tmpdir(), 'zetro-folder-'));
  let phase = 0;
  const calls = [];
  const state = () => ({ status: 'explorer_state', window: target, location: parent, focusedEdit: phase === 1 ? 'New folder' : phase === 2 ? 'hello' : null,
    renameActive: phase === 1 || phase === 2, focusClass: 'UIRenameTextElement', displayBounds: { x: 0, y: 0, width: 1920, height: 1080 } });
  const runner = {
    downloadsPath: async () => parent,
    explorerWindows: async () => ({ stdout: JSON.stringify({ generation: '1', observedAt: Date.now(), windows: [target] }) }),
    explorerState: async () => state(),
    focusWindow: async () => { calls.push('focus'); },
    pressKeys: async spec => {
      assert.equal(spec.hwnd, target.hwnd);
      assert.equal(spec.expectedPid, target.processId);
      assert.equal(spec.expectedStart, target.generation);
      assert.ok(spec.grantExpiry > Date.now());
      calls.push(spec.keys);
      if (phase === 0) { assert.equal(spec.keys, 'Control+Shift+N'); phase = 1; }
      else { assert.equal(spec.keys, 'Enter'); mkdirSync(join(parent, 'hello')); phase = 3; }
    },
    typeFocusedText: async (hwnd, text) => { assert.equal(hwnd, 10); assert.equal(text, 'hello'); phase = 2; calls.push('type'); }
  };
  return { parent, runner, calls, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

test('folder verifier rejects fabricated success and missing observations', () => {
  assert.equal(verifyFileExplorerFolder({ expectedFolderName: 'hello' }).verified, false);
});

test('native host requires explicit input authorization before launch or helper calls', async () => {
  const result = await runExplorerFolderTask({ prompt: 'Open Explorer and create a folder named "hello" in Downloads', launcher: () => { throw new Error('must not launch'); } });
  assert.equal(result.status, 'blocked');
});

test('native host composes reactive ports and verifies real directory evidence in a disposable fixture', async () => {
  const f = createFixture();
  try {
    const result = await runExplorerFolderTask({ prompt: 'Open Explorer and create a folder named "hello" in Downloads', inputEnabled: true, overlay: false, runner: f.runner, launcher: async () => {} });
    assert.equal(result.status, 'completed');
    assert.deepEqual(f.calls, ['focus', 'Control+Shift+N', 'type', 'Enter']);
  } finally { f.cleanup(); }
});

test('existing folder is reported without replaying creation', async () => {
  const f = createFixture();
  mkdirSync(join(f.parent, 'hello'));
  try {
    const result = await runExplorerFolderTask({ prompt: 'Create a folder named "hello" in Downloads', inputEnabled: true, overlay: false, runner: f.runner, launcher: async () => {} });
    assert.equal(result.status, 'already_exists');
    assert.deepEqual(f.calls, []);
  } finally { f.cleanup(); }
});

test('folder proof requires matching directory, identity, fresh observation and absent baseline', () => {
  const f = createFixture();
  mkdirSync(join(f.parent, 'hello'));
  const request = { target, postObservation: { target, timestamp: Date.now(), location: f.parent }, expectedFolderName: 'hello', expectedParentPath: f.parent, baseline: { existed: false, observedAt: Date.now() - 20 } };
  try {
    assert.equal(verifyFileExplorerFolder(request).verified, true);
    assert.equal(verifyFileExplorerFolder({ ...request, baseline: { existed: true, observedAt: 1 } }).verified, false);
    assert.equal(verifyFileExplorerFolder({ ...request, postObservation: { ...request.postObservation, timestamp: 1 } }).verified, false);
    assert.equal(verifyFileExplorerFolder({ ...request, postObservation: { ...request.postObservation, target: { ...target, generation: 'recycled' } } }).verified, false);
    assert.equal(verifyFileExplorerFolder({ ...request, expectedFolderName: '../hello' }).verified, false);
    assert.equal(verifyFileExplorerFolder({ ...request, postObservation: { ...request.postObservation, location: tmpdir() } }).verified, false);
  } finally { f.cleanup(); }
});
