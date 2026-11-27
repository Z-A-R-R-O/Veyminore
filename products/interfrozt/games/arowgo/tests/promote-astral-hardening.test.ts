import { it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { validateLevel } from "../src/domain/rules";
import {
  measureDifficulty,
  rateDifficulty,
} from "../src/domain/difficultyRating";
import { evaluateLayout, evaluateDifficulty } from "../src/domain/generator";
import { evaluatePlanning } from "../src/domain/planning";
import calibration from "../content/difficulty-calibration-v1.json";
import originals from "../content/levels/astral-before-hardening.json";
it("promotes only a complete verified Astral hardening set", () => {
  if (process.env.AROWGO_PROMOTE_ASTRAL !== "1") return;
  const candidates = Array.from({ length: 40 }, (_, i) =>
    JSON.parse(readFileSync(`tmp/astral-hardening/${141 + i}.json`, "utf8")),
  );
  for (const [i, raw] of candidates.entries()) {
    const l = validateLevel(raw),
      m = measureDifficulty(l),
      old = measureDifficulty(validateLevel(originals[i]));
    const score = rateDifficulty(m, calibration).score;
    expect(score).toBeGreaterThanOrEqual(
      Math.max(860, rateDifficulty(old, calibration).score),
    );
    expect(m.failureHorizon).toBeGreaterThanOrEqual(12);
    expect(m.randomLegalWinRate).toBeLessThanOrEqual(old.randomLegalWinRate);
    expect(m.solvable).toBe(true);
    expect(l.contentVersion).toBe(14);
    expect(raw.generation.sourceLevelId).toBe(originals[i].levelId);
  }
  candidates.sort((a, b) => a.generation.rating - b.generation.rating);
  const report = [];
  for (const [i, raw] of candidates.entries()) {
    raw.levelId = `astral-${141 + i}`;
    const metrics = {
      level: 141 + i,
      count: raw.arrows.length,
      ...evaluateLayout(raw),
      ...evaluateDifficulty(raw),
      rate: evaluatePlanning(raw).randomLegalWinRate,
      rating: raw.generation.rating,
      sourceLevelId: raw.generation.sourceLevelId,
    };
    raw.generation.metrics = metrics;
    writeFileSync(
      `content/levels/astral/level-${141 + i}.json`,
      JSON.stringify(raw, null, 2) + "\n",
    );
    report.push(metrics);
  }
  writeFileSync(
    "content/levels/astral/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}, 180000);
