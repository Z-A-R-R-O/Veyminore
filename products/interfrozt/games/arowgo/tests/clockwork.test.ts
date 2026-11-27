import { it, expect } from "vitest";
import { levels, levelNames } from "../src/domain/campaign";
import { validateLevel, solve, checkExit } from "../src/domain/rules";
import { evaluatePlanning } from "../src/domain/planning";
import {
  measureDifficulty,
  rateDifficulty,
} from "../src/domain/difficultyRating";
import calibration from "../content/difficulty-calibration-v1.json";
import { newSession, resolve, parseSession } from "../src/application/session";
// @ts-expect-error Server ESM integration.
import { verifyClear, rewardLevels } from "../server/economy/rewards.mjs";
it("audits all forty Clockwork levels, decisions, restores and rewards", () => {
  expect(levels).toHaveLength(140);
  expect(levelNames).toHaveLength(140);
  expect(rewardLevels).toHaveLength(140);
  const signatures = new Set(
    levels
      .slice(0, 100)
      .map((l) => JSON.stringify(l.arrows.map((a) => a.points))),
  );
  let lastScore = 0;
  for (const [i, l] of levels.slice(100).entries()) {
    expect(validateLevel(l)).toBe(l);
    expect(l.levelId).toBe(`clockwork-${101 + i}`);
    const signature = JSON.stringify(l.arrows.map((a) => a.points));
    expect(signatures.has(signature)).toBe(false);
    signatures.add(signature);
    const m = measureDifficulty(l),
      rating = rateDifficulty(m, calibration);
    expect(m.occupiedCells).toBeGreaterThanOrEqual(89);
    expect(l.arrows).toHaveLength(28);
    const sources = new Set(
      l.arrows.flatMap((a) => [a.requires, a.anchorRequires]),
    );
    for (const a of l.arrows.filter(
      (a) => a.pulse !== undefined || a.window !== undefined,
    ))
      expect(sources.has(a.id)).toBe(false);
    if (i % 10 === 0) lastScore = 0;
    expect(rating.score).toBeGreaterThanOrEqual(lastScore);
    lastScore = rating.score;
    expect(l.arrows.filter((a) => a.pulse !== undefined)).toHaveLength(
      1 + Math.floor(i / 10),
    );
    expect(l.arrows.filter((a) => a.window !== undefined)).toHaveLength(
      Math.floor(i / 10),
    );
    const p = evaluatePlanning(l);
    expect(p.randomLegalWinRate).toBeGreaterThan(0);
    expect(p.randomLegalWinRate).toBeLessThan(0.001);
    expect(p.blockedTargetDecisions).toBeGreaterThan(0);
    const d = p.exampleDecision!;
    expect(checkExit(l, d.active, d.unsafeMove).clear).toBe(true);
    expect(
      solve(
        l,
        d.active.filter((id) => id !== d.unsafeMove),
      ),
    ).toBeNull();
    expect(
      solve(
        l,
        d.active.filter((id) => id !== d.safeMove),
      ),
    ).not.toBeNull();
    let state = newSession(l, "audit");
    for (const id of l.solution) {
      state = resolve(l, state, {
        id,
        attemptId: state.attemptId,
        type: "select",
        arrowId: id,
      }).state;
      expect(parseSession(JSON.stringify(state), l)).toEqual(state);
    }
    expect(state.status).toBe("complete");
    expect(state.coins).toBe(25);
    expect(verifyClear(l.levelId, l.contentVersion, l.solution)).toBe(true);
    let replay = newSession(l, "replay", "story", state);
    for (const id of l.solution)
      replay = resolve(l, replay, {
        id,
        attemptId: replay.attemptId,
        type: "select",
        arrowId: id,
      }).state;
    expect(replay.coins).toBe(25);
    expect(replay.reward).toBe(0);
  }
}, 240000);
