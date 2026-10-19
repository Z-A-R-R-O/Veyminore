import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictInteger, parseStrictCost } from '../src/numeric.js';

test('parseStrictInteger complete parsing and explicit bounds', async (t) => {
  await t.test('accepts valid bounded integers', () => {
    assert.deepStrictEqual(parseStrictInteger('1', 'WORKERS', { min: 1, max: 5 }), {
      value: 1,
      isValid: true,
      isDefault: false
    });
    assert.deepStrictEqual(parseStrictInteger('5', 'WORKERS', { min: 1, max: 5 }), {
      value: 5,
      isValid: true,
      isDefault: false
    });
    assert.deepStrictEqual(parseStrictInteger(3, 'WORKERS', { min: 1, max: 5 }), {
      value: 3,
      isValid: true,
      isDefault: false
    });
  });

  await t.test('rejects partial numeric strings (e.g. parseInt 1abc hazard)', () => {
    // In JavaScript, parseInt('1abc', 10) returns 1! parseStrictInteger must reject partial tokens.
    const partialInputs = ['1abc', '2 workers', '1.5', '3.0', '1_000', '1e2'];
    for (const input of partialInputs) {
      const res = parseStrictInteger(input, 'WORKERS', { min: 1, max: 5, defaultValue: 1 });
      assert.strictEqual(res.value, 1, `Partial input '${input}' must fall back to default`);
      assert.strictEqual(res.isValid, false, `Partial input '${input}' must be invalid`);
      assert.match(res.error, /Malformed integer string/);
    }
  });

  await t.test('rejects negative, zero, and out-of-bounds integers', () => {
    const outOfBounds = ['-1', '-5', '0', '6', '10', '99999', '999999999999999999999'];
    for (const input of outOfBounds) {
      const res = parseStrictInteger(input, 'WORKERS', { min: 1, max: 5, defaultValue: 1 });
      assert.strictEqual(res.value, 1);
      assert.strictEqual(res.isValid, false, `Out of bounds input '${input}' must be invalid`);
      assert.ok(res.error);
    }
  });

  await t.test('rejects non-finite values (NaN, Infinity)', () => {
    for (const input of ['NaN', 'Infinity', '-Infinity', NaN, Infinity, -Infinity]) {
      const res = parseStrictInteger(input, 'WORKERS', { min: 1, max: 5, defaultValue: 1 });
      assert.strictEqual(res.value, 1);
      assert.strictEqual(res.isValid, false, `Non-finite input '${input}' must be invalid`);
    }
  });
});

test('parseStrictCost complete float parsing, freeOnly enforcement, and ceiling bounds', async (t) => {
  await t.test('accepts strictly zero cost under freeOnly policy', () => {
    assert.strictEqual(parseStrictCost('0', 'COST', { freeOnly: true }).value, 0);
    assert.strictEqual(parseStrictCost('0.00', 'COST', { freeOnly: true }).value, 0);
    assert.strictEqual(parseStrictCost(0, 'COST', { freeOnly: true }).value, 0);
    assert.strictEqual(parseStrictCost(undefined, 'COST', { freeOnly: true }).value, 0);
  });

  await t.test('rejects non-zero cost when freeOnly is enabled', () => {
    const res = parseStrictCost('1.50', 'ZETRO_MAX_COST_USD', { freeOnly: true });
    assert.strictEqual(res.value, 0);
    assert.strictEqual(res.isValid, false);
    assert.match(res.error, /Non-zero cost.*rejected.*freeOnly policy/);
  });

  await t.test('accepts valid float cost when freeOnly is disabled', () => {
    const res = parseStrictCost('12.50', 'ZETRO_MAX_COST_USD', { freeOnly: false, maxLimit: 100.0 });
    assert.strictEqual(res.value, 12.5);
    assert.strictEqual(res.isValid, true);
  });

  await t.test('rejects negative, malformed, or ceiling-exceeding cost values', () => {
    const invalidCosts = ['-1', '-0.01', '$10', '10.5.5', 'abc', '1000', 'NaN', 'Infinity'];
    for (const input of invalidCosts) {
      const res = parseStrictCost(input, 'ZETRO_MAX_COST_USD', { freeOnly: false, maxLimit: 100.0 });
      assert.strictEqual(res.value, 0);
      assert.strictEqual(res.isValid, false, `Cost '${input}' must be invalid`);
      assert.ok(res.error);
    }
  });
});
