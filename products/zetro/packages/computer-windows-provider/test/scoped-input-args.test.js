import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildHelperMouseActionArgs, buildHelperPressKeysArgs } from '../src/index.js';

for (const [name, build, base] of [
  ['mouse', buildHelperMouseActionArgs, { actionType: 'click', x: 1, y: 2 }],
  ['keyboard', buildHelperPressKeysArgs, { keys: 'Control+Shift+N' }]
]) {
  test(`${name} arguments default to disabled and preserve exact target fields`, () => {
    assert.equal(build(base).includes('--input-enabled'), false);
    const args = build({ ...base, inputEnabled: true, hwnd: 123, expectedPid: 456, expectedStart: 'start-1', sessionId: 's', grantExpiry: 1900000000000 });
    assert.equal(args.includes('--input-enabled'), true);
    assert.equal(args[args.indexOf('--hwnd') + 1], '123');
    assert.equal(args[args.indexOf('--expected-pid') + 1], '456');
    assert.equal(args[args.indexOf('--expected-start') + 1], 'start-1');
  });
}
