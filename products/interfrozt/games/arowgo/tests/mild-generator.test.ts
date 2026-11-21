import { beforeChallengeLevels } from "../src/domain/campaignBeforeChallenge";
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  generatePuzzle,
  evaluateDifficulty,
  evaluateLayout,
} from "../src/domain/generator";
import { levels } from "../src/domain/campaign";
import { validateLevel, checkExit } from "../src/domain/rules";
const candidates = Array.from({ length: 5 }, (_, i) =>
  JSON.parse(
    readFileSync(`content/candidates/mild/level-${i + 6}.json`, "utf8"),
  ),
);
it("stages five distinct, gradually harder puzzles with legal complete solutions", () => {
  let previous = evaluateDifficulty(beforeChallengeLevels[4]).score;
  expect(new Set(candidates.map((l) => JSON.stringify(l.arrows))).size).toBe(5);
  for (const raw of candidates) {
    const level = validateLevel(raw),
      difficulty = evaluateDifficulty(level);
    expect(difficulty.score - previous).toBeGreaterThanOrEqual(2);
    expect(difficulty.score - previous).toBeLessThanOrEqual(8);
    previous = difficulty.score;
    expect(difficulty.initialChoices).toBeGreaterThanOrEqual(2);
    expect(difficulty.initialChoices).toBeLessThanOrEqual(4);
    expect(evaluateLayout(level).isolated).toBeLessThanOrEqual(1);
    expect(evaluateLayout(level).emptyQuadrants).toBe(0);
    // Different legal choices must all eventually clear: test 20 alternate orders.
    for (let run = 0; run < 20; run++) {
      let active = level.arrows.map((a) => a.id);
      while (active.length) {
        const legal = active.filter((id) => checkExit(level, active, id).clear);
        expect(legal.length).toBeGreaterThan(0);
        const id = legal[(run + active.length) % legal.length];
        active = active.filter((a) => a !== id);
      }
    }
  }
});
it("reproduces controlled candidates and rejects invalid or impossible bounds", () => {
  const raw = candidates[0],
    g = raw.generation;
  expect(
    generatePuzzle(g.seed, g.count, g.targetScore, raw.levelId, {
      connectedPlacement: true,
      openingMoves: g.openingMoves,
      depthRange: g.depthRange,
      scoreRange: g.scoreRange,
    }),
  ).toEqual({ ...raw, generation: { ...raw.generation, version: 4 } });
  expect(() =>
    generatePuzzle(1, 10, 50, "invalid", { openingMoves: [4, 2] }),
  ).toThrow("Invalid difficulty bounds");
  expect(() =>
    generatePuzzle(1, 4, 50, "impossible", { openingMoves: [5, 6] }),
  ).toThrow("Generation budget exhausted");
}, 30000);
import { previousMildLevels } from "../src/domain/campaignV5";
import { SaveStore } from "../src/storage/save";
import { newSession, resolve } from "../src/application/session";
it.each(previousMildLevels)(
  "preserves awards and archives previous $levelId on promotion",
  (old) => {
    const next = levels.find((l) => l.levelId === old.levelId)!;
    let completed = newSession(old, "old");
    for (const id of old.solution)
      completed = resolve(old, completed, {
        id,
        attemptId: "old",
        type: "select",
        arrowId: id,
      }).state;
    for (const state of [
      completed,
      newSession(old, "replay", "story", completed),
    ]) {
      const raw = JSON.stringify(state),
        data = new Map([["save", raw]]);
      const saves = new SaveStore(
        {
          getItem: (k) => data.get(k) ?? null,
          setItem: (k, v) => {
            data.set(k, v);
          },
        },
        next,
        "save",
        old,
      );
      const migrated = saves.load().state!;
      expect(migrated).toMatchObject({
        contentVersion: next.contentVersion,
        coins: 25,
        bestStars: 3,
        claimed: true,
        status: "playing",
      });
      expect(data.get("save.content-5")).toBe(raw);
      expect(migrated.active).toHaveLength(next.arrows.length);
      let replay = migrated;
      for (const id of next.solution)
        replay = resolve(next, replay, {
          id,
          attemptId: replay.attemptId,
          type: "select",
          arrowId: id,
        }).state;
      expect(replay.status).toBe("complete");
      expect(replay.coins).toBe(25);
      expect(replay.reward).toBe(0);
    }
  },
);
