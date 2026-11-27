import { it, expect } from "vitest";
import { levels } from "../src/domain/campaign";
import {
  measureDifficulty,
  rateDifficulty,
} from "../src/domain/difficultyRating";
import calibration from "../content/difficulty-calibration-v1.json";
import ratings from "../content/difficulty-ratings.json";
import candidates from "../content/chapter6-preview.json";
import { validateLevel, solve, checkExit } from "../src/domain/rules";
import { evaluatePlanning } from "../src/domain/planning";
it("reproduces every exported rating and covers the 180-level campaign", () => {
  expect(levels).toHaveLength(180);
  for (const level of [...levels, ...candidates.map(validateLevel)]) {
    const rating = ratings.find((r) => r.levelId === level.levelId)!;
    expect(rating).toBeDefined();
    expect(rating.contentVersion).toBe(level.contentVersion);
    const actual = rateDifficulty(measureDifficulty(level), calibration);
    expect(rating.score).toBe(actual.score);
    expect(rating.contributions).toEqual(actual.contributions);
    expect(rating.openingWinning + rating.openingLosing).toBe(
      rating.openingLegal,
    );
    expect(rating.score).toBeGreaterThanOrEqual(0);
    expect(rating.score).toBeLessThanOrEqual(1000);
  }
}, 120000);
it("does not confuse density with planning risk", () => {
  const l = structuredClone(levels[0]);
  l.arrows = l.arrows.map(({ id, points }) => ({ id, points }));
  const measurement = measureDifficulty(l);
  expect(measurement.randomLegalWinRate).toBe(1);
  expect(measurement.failureHorizon).toBe(0);
  expect(rateDifficulty(measurement, calibration).contributions.risk).toBe(0);
});
it("retains the historical five candidates distinct from the original campaign", () => {
  expect(candidates).toHaveLength(5);
  const scores = candidates.map(
    (c) => ratings.find((r) => r.levelId === c.levelId)!.score,
  );
  expect(scores).toEqual([...scores].sort((a, b) => a - b));
  const signatures = new Set(
    levels
      .slice(0, 100)
      .map((l) => JSON.stringify(l.arrows.map((a) => a.points))),
  );
  for (const [i, raw] of candidates.entries()) {
    const l = validateLevel(raw);
    expect(l.levelId).toBe(`chapter6-${101 + i}`);
    expect(l.arrows).toHaveLength(28);
    expect(solve(l)).not.toBeNull();
    let active = l.arrows.map((a) => a.id);
    for (const id of l.solution) {
      expect(
        checkExit(l, active, id).clear,
        `${l.levelId} stored move ${id}`,
      ).toBe(true);
      active = active.filter((x) => x !== id);
    }
    const m = measureDifficulty(l);
    expect(m.occupiedCells).toBeGreaterThanOrEqual(89);
    expect(evaluatePlanning(l).blockedTargetDecisions).toBeGreaterThan(0);
    const signature = JSON.stringify(l.arrows.map((a) => a.points));
    expect(signatures.has(signature)).toBe(false);
    signatures.add(signature);
  }
}, 120000);
