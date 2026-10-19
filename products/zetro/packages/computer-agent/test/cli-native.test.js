import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('CLI native input is opt-in and reports blocked without launching a desktop task', () => {
  try {
    execFileSync(process.execPath, [cli, '--native', '--no-input', '--json', '--prompt', 'Create a folder named "hello" in Downloads'], { encoding: 'utf8', windowsHide: true });
    assert.fail('Expected disabled input exit');
  } catch (error) {
    assert.equal(error.status, 1);
    assert.equal(JSON.parse(error.stdout).status, 'blocked');
  }
});

test('CLI never silently falls back to simulated desktop success', () => {
  try {
    execFileSync(process.execPath, [cli, '--prompt', 'Open Notepad and write "hello"'], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
    assert.fail('Expected missing qualified host exit');
  } catch (error) {
    assert.equal(error.status, 2);
    assert.match(error.stderr, /qualified native host is required/);
    assert.equal(error.stdout, '');
  }
});
