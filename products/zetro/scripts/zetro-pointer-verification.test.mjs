import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPointerStep } from './zetro-pointer-motion.mjs';

test('verifyPointerStep returns verified=true when pointer matches target exactly (dist=0)', () => {
  const result = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 100, y: 200 } },
    after: { pointer: { x: 100, y: 200 } }
  });

  assert.equal(result.verified, true);
  assert.equal(result.method, 'coordinate');
  assert.deepEqual(result.details, {
    expected: { x: 100, y: 200 },
    observed: { x: 100, y: 200 },
    rawDistance: 0,
    distance: 0,
    tolerance: 3
  });
});

test('verifyPointerStep returns verified=true when pointer is within 3px tolerance', () => {
  const result = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 500, y: 300 } },
    after: { pointer: { x: 502, y: 300 } }
  });

  assert.equal(result.verified, true);
  assert.equal(result.details.rawDistance, 2);
  assert.equal(result.details.distance, 2);
  assert.equal(result.details.tolerance, 3);
});

test('verifyPointerStep returns verified=true on exact boundary (dist=3.0)', () => {
  const result = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 1000, y: 500 } },
    after: { pointer: { x: 1003, y: 500 } }
  });

  assert.equal(result.verified, true);
  assert.equal(result.details.rawDistance, 3);
  assert.equal(result.details.distance, 3);
});

test('verifyPointerStep returns verified=false when pointer exceeds 3px tolerance', () => {
  const result = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 500, y: 300 } },
    after: { pointer: { x: 504, y: 300 } }
  });

  assert.equal(result.verified, false);
  assert.equal(result.details.rawDistance, 4);
  assert.equal(result.details.distance, 4);
  assert.deepEqual(result.details.expected, { x: 500, y: 300 });
  assert.deepEqual(result.details.observed, { x: 504, y: 300 });
});

test('negative just-over-boundary: rawDistance > 3 but rounded to 3 decimal places is 3.000 fails closed', () => {
  // Target (0, 0), observed (3.0004, 0)
  // Raw distance is 3.0004 > 3 (must NOT pass through premature rounding)
  const result = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 0, y: 0 } },
    after: { pointer: { x: 3.0004, y: 0 } }
  });

  assert.equal(result.verified, false, 'raw distance 3.0004 must not pass tolerance 3');
  assert.equal(result.details.rawDistance, 3.0004);
  assert.equal(result.details.distance, 3); // telemetry rounds to 3 decimals, but decision uses raw
  assert.equal(result.details.tolerance, 3);
});

test('negative diagonal just-over-boundary: rawDistance > 3 but rounded = 3 fails closed', () => {
  // dx = 2.1215, dy = 2.1215 => hypot(2.1215, 2.1215) = 2.1215 * sqrt(2) ≈ 3.0002543...
  // Raw distance > 3, toFixed(3) rounds to 3.000
  const result = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 0, y: 0 } },
    after: { pointer: { x: 2.1215, y: 2.1215 } }
  });

  assert.equal(result.verified, false, 'diagonal raw distance > 3 must not pass tolerance 3');
  assert.ok(result.details.rawDistance > 3, 'rawDistance must exceed 3');
  assert.equal(result.details.distance, 3, 'rounded distance telemetry is 3');
  assert.equal(result.details.tolerance, 3);
});

test('verifyPointerStep calculates diagonal Euclidean distance correctly within tolerance', () => {
  // dx = 2, dy = 2 => hypot = sqrt(8) ≈ 2.828427... bounded to 2.828 <= 3
  const withinDiagonal = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 200, y: 200 } },
    after: { pointer: { x: 202, y: 202 } }
  });
  assert.equal(withinDiagonal.verified, true);
  assert.equal(withinDiagonal.details.distance, 2.828);

  // dx = 3, dy = 3 => hypot = sqrt(18) ≈ 4.2426... bounded to 4.243 > 3
  const beyondDiagonal = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 200, y: 200 } },
    after: { pointer: { x: 203, y: 203 } }
  });
  assert.equal(beyondDiagonal.verified, false);
  assert.equal(beyondDiagonal.details.distance, 4.243);
});

test('verifyPointerStep accurately captures telemetry for the blocked target (1634, 424)', () => {
  const target = { x: 1634, y: 424 };

  // Scenario A: Pointer landed 4px off in X (e.g. SetCursorPos subpixel rounding or clip)
  const failedX = verifyPointerStep({
    action: { type: 'mouseMove', target },
    after: { pointer: { x: 1630, y: 424 } }
  });
  assert.equal(failedX.verified, false);
  assert.deepEqual(failedX.details, {
    expected: { x: 1634, y: 424 },
    observed: { x: 1630, y: 424 },
    rawDistance: 4,
    distance: 4,
    tolerance: 3
  });

  // Scenario B: Pointer landed 4px off in Y
  const failedY = verifyPointerStep({
    action: { type: 'mouseMove', target },
    after: { pointer: { x: 1634, y: 420 } }
  });
  assert.equal(failedY.verified, false);
  assert.deepEqual(failedY.details, {
    expected: { x: 1634, y: 424 },
    observed: { x: 1634, y: 420 },
    rawDistance: 4,
    distance: 4,
    tolerance: 3
  });

  // Scenario C: Pointer landed within 2px diagonally
  const successDiag = verifyPointerStep({
    action: { type: 'mouseMove', target },
    after: { pointer: { x: 1632, y: 422 } }
  });
  assert.equal(successDiag.verified, true);
  assert.equal(successDiag.details.distance, 2.828);
});

test('verifyPointerStep verifies wait actions unconditionally with wait telemetry', () => {
  const result = verifyPointerStep({
    action: { type: 'wait', durationMs: 1500 },
    after: { pointer: { x: 100, y: 100 } }
  });

  assert.equal(result.verified, true);
  assert.equal(result.method, 'coordinate');
  assert.deepEqual(result.details, {
    actionType: 'wait',
    tolerance: 3
  });
});

test('fail closed on NaN, Infinity, and missing coordinates', () => {
  // NaN in observed coordinates
  const nanObserved = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 100, y: 100 } },
    after: { pointer: { x: NaN, y: 100 } }
  });
  assert.equal(nanObserved.verified, false);
  assert.equal(nanObserved.details.observed, null);
  assert.equal(nanObserved.details.rawDistance, null);
  assert.equal(nanObserved.details.distance, null);

  // Infinity in observed coordinates
  const infObserved = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 100, y: 100 } },
    after: { pointer: { x: 100, y: Infinity } }
  });
  assert.equal(infObserved.verified, false);
  assert.equal(infObserved.details.observed, null);
  assert.equal(infObserved.details.rawDistance, null);

  // -Infinity in target coordinates
  const negInfTarget = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: -Infinity, y: 100 } },
    after: { pointer: { x: 100, y: 100 } }
  });
  assert.equal(negInfTarget.verified, false);
  assert.equal(negInfTarget.details.expected, null);

  // Missing pointer property in after
  const missingPointer = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 100, y: 100 } },
    after: {}
  });
  assert.equal(missingPointer.verified, false);
  assert.equal(missingPointer.details.observed, null);

  // Null after observation
  const nullAfter = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 100, y: 100 } },
    after: null
  });
  assert.equal(nullAfter.verified, false);
  assert.equal(nullAfter.details.observed, null);

  // Missing target in action
  const missingTarget = verifyPointerStep({
    action: { type: 'mouseMove' },
    after: { pointer: { x: 100, y: 100 } }
  });
  assert.equal(missingTarget.verified, false);
  assert.equal(missingTarget.details.expected, null);
});

test('verifyPointerStep respects tolerance argument while defaulting to 3', () => {
  // Default tolerance is 3
  const defaultTol = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 100, y: 100 } },
    after: { pointer: { x: 102, y: 100 } }
  });
  assert.equal(defaultTol.verified, true);
  assert.equal(defaultTol.details.tolerance, 3);

  // Custom tolerance = 1
  const strictTol = verifyPointerStep({
    action: { type: 'mouseMove', target: { x: 100, y: 100 } },
    after: { pointer: { x: 102, y: 100 } },
    tolerance: 1
  });
  assert.equal(strictTol.verified, false);
  assert.equal(strictTol.details.tolerance, 1);
});
