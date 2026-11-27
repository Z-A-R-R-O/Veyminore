import { switchTraps } from "./foundry-helpers";
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
it("audits all forty Foundry levels, decisions, restores and rewards", () => {
  expect(levels).toHaveLength(220);
  expect(levelNames).toHaveLength(220);
  expect(rewardLevels).toHaveLength(220);
  const signatures = new Set(
    levels
      .slice(0, 180)
      .map((l) => JSON.stringify(l.arrows.map((a) => a.points))),
  );
  let lastScore = 0;
  for (const [i, l] of levels.slice(180).entries()) {
    expect(validateLevel(l)).toBe(l);
    expect(l.levelId).toBe(`foundry-${181 + i}`);
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

    expect(rating.score).toBeGreaterThanOrEqual(lastScore);
    const band = Math.floor(i / 10);
    expect(rating.score).toBeGreaterThanOrEqual([700, 790, 850, 900][band]);
    expect(rating.score).toBeLessThanOrEqual([789, 849, 899, 1000][band]);
    lastScore = rating.score;
    expect(l.contentVersion).toBe(15);
    expect(m.failureHorizon).toBeGreaterThanOrEqual(i < 10 ? 5 : 10);
    const groups = i < 10 ? 1 : 2;
    expect(
      new Set(l.arrows.flatMap((a) => (a.switchGroup ? [a.switchGroup] : [])))
        .size,
    ).toBe(groups);
    const traps = switchTraps(l);
    expect(traps).toHaveLength(groups);
    for (const trap of traps) {
      expect(solve(l, trap.active)).not.toBeNull();
      expect(checkExit(l, trap.active, trap.move).clear).toBe(true);
      expect(
        solve(
          l,
          trap.active.filter((id) => id !== trap.move),
        ),
      ).toBeNull();
    }
    for (const trap of traps) {
      const prefix = l.solution.slice(0, l.arrows.length - trap.active.length);
      const wrong = [
        ...prefix,
        trap.move,
        ...l.solution.slice(prefix.length).filter((id) => id !== trap.move),
      ];
      expect(() => verifyClear(l.levelId, l.contentVersion, wrong)).toThrow();
    }
    const p = evaluatePlanning(l);
    expect(p.randomLegalWinRate).toBeGreaterThan(0);
    expect(p.randomLegalWinRate).toBeLessThan(0.05);
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
