import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictBoolean, parseStrictBooleanFlag, isStrictTrue, isStrictFalse } from '../src/boolean.js';

test('parseStrictBooleanFlag flag evaluation and restrictive default retention', async (t) => {
  await t.test('evaluates valid true strings and numbers', () => {
    for (const val of ['1', 'true', 'TRUE', '  true  ', '  1  ', true, 1]) {
      const res = parseStrictBooleanFlag(val, 'TEST_FLAG', false);
      assert.strictEqual(res.value, true, `Expected true for ${JSON.stringify(val)}`);
      assert.strictEqual(res.isValid, true, `Expected isValid true for ${JSON.stringify(val)}`);
      assert.strictEqual(res.isDefault, false);
      assert.strictEqual(res.error, undefined);
    }
  });

  await t.test('evaluates valid false strings and numbers without JS truthiness bug', () => {
    // Critical: in JS, Boolean('0') === true. parseStrictBooleanFlag must evaluate strictly to false.
    for (const val of ['0', 'false', 'FALSE', '  false  ', '  0  ', false, 0]) {
      const res = parseStrictBooleanFlag(val, 'TEST_FLAG', true); // defaultValue true
      assert.strictEqual(res.value, false, `Expected false for ${JSON.stringify(val)}`);
      assert.strictEqual(res.isValid, true, `Expected isValid true for ${JSON.stringify(val)}`);
      assert.strictEqual(res.isDefault, false);
      assert.strictEqual(res.error, undefined);
    }
  });

  await t.test('unset or empty values retain the provided default cleanly', () => {
    for (const val of [undefined, null, '', '   ']) {
      const resFalse = parseStrictBooleanFlag(val, 'TEST_FLAG', false);
      assert.strictEqual(resFalse.value, false);
      assert.strictEqual(resFalse.isValid, true);
      assert.strictEqual(resFalse.isDefault, true);

      const resTrue = parseStrictBooleanFlag(val, 'TEST_FLAG', true);
      assert.strictEqual(resTrue.value, true);
      assert.strictEqual(resTrue.isValid, true);
      assert.strictEqual(resTrue.isDefault, true);
    }
  });

  await t.test('rejected values: invalid/typo flags retain restrictive default and flag error', () => {
    // Regression test for review finding: ZETRO_FREE_ONLY=typo must NOT disable protection!
    const rejectedInputs = ['typo', '2', '-1', 'yes', 'no', 'on', 'off', 'truthy', 'enabled', 'disabled', 'None'];

    for (const rejected of rejectedInputs) {
      // When default is true (e.g. ZETRO_FREE_ONLY), must retain true!
      const resWithTrueDefault = parseStrictBooleanFlag(rejected, 'ZETRO_FREE_ONLY', true);
      assert.strictEqual(
        resWithTrueDefault.value,
        true,
        `Rejected input '${rejected}' must retain restrictive default true`
      );
      assert.strictEqual(resWithTrueDefault.isValid, false, `Rejected input '${rejected}' must be marked invalid`);
      assert.ok(resWithTrueDefault.error, `Error message required for rejected input '${rejected}'`);
      assert.match(resWithTrueDefault.error, /Invalid boolean value/);

      // When default is false (e.g. ZETRO_ALLOW_LIVE), must retain false!
      const resWithFalseDefault = parseStrictBooleanFlag(rejected, 'ZETRO_ALLOW_LIVE', false);
      assert.strictEqual(
        resWithFalseDefault.value,
        false,
        `Rejected input '${rejected}' must retain restrictive default false`
      );
      assert.strictEqual(resWithFalseDefault.isValid, false);
    }
  });
});

test('parseStrictBoolean helper retains restrictive defaults', () => {
  assert.strictEqual(parseStrictBoolean('typo', true), true); // Retains restrictive true
  assert.strictEqual(parseStrictBoolean('typo', false), false); // Retains restrictive false
  assert.strictEqual(parseStrictBoolean('1', false), true);
  assert.strictEqual(parseStrictBoolean('0', true), false);
});

test('isStrictTrue and isStrictFalse exact predicate assertions', () => {
  assert.strictEqual(isStrictTrue('1'), true);
  assert.strictEqual(isStrictTrue('true'), true);
  assert.strictEqual(isStrictTrue(true), true);
  assert.strictEqual(isStrictTrue(1), true);

  assert.strictEqual(isStrictTrue('0'), false);
  assert.strictEqual(isStrictTrue('false'), false);
  assert.strictEqual(isStrictTrue('typo'), false);
  assert.strictEqual(isStrictTrue(undefined), false);

  assert.strictEqual(isStrictFalse('0'), true);
  assert.strictEqual(isStrictFalse('false'), true);
  assert.strictEqual(isStrictFalse(false), true);
  assert.strictEqual(isStrictFalse(0), true);

  assert.strictEqual(isStrictFalse('1'), false);
  assert.strictEqual(isStrictFalse('true'), false);
  assert.strictEqual(isStrictFalse('typo'), false);
  assert.strictEqual(isStrictFalse(undefined), false);
});
