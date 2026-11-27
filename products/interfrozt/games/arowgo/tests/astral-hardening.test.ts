import { readFileSync } from "node:fs";
import {
  measureDifficulty,
  rateDifficulty,
} from "../src/domain/difficultyRating";
import calibration from "../content/difficulty-calibration-v1.json";
import { it, expect } from "vitest";
import { levels } from "../src/domain/campaign";
import { beforeAstralHardeningLevels as oldLevels } from "../src/domain/campaignBeforeAstralHardening";
import { SaveStore } from "../src/storage/save";
import { newSession, resolve } from "../src/application/session";
import { validatePlayableRestore } from "../src/account/cloud-restore";
import ratings from "../content/difficulty-ratings.json";
// @ts-expect-error Server ESM integration.
import { verifyClear } from "../server/economy/rewards.mjs";
it("keeps every older Astral reward, star and recovery copy through hardening", () => {
  for (const old of oldLevels) {
    const level = levels.find((l) => l.levelId === old.levelId)!;
    for (const complete of [false, true]) {
      let previous = newSession(old, "original");
      for (const id of complete ? old.solution : old.solution.slice(0, 4))
        previous = resolve(old, previous, {
          id,
          type: "select",
          arrowId: id,
          attemptId: previous.attemptId,
        }).state;
      const key = `arowgo.level.${old.levelId}.v1`,
        raw = JSON.stringify(previous),
        profile = '{"gems":73}';
      const data = new Map([
        [key, raw],
        ["arowgo.profile.v1", profile],
      ]);
      const store = new SaveStore(
        {
          getItem: (k) => data.get(k) ?? null,
          setItem: (k, v) => {
            data.set(k, v);
          },
        },
        level,
        key,
        old,
      );
      const migrated = store.load().state!;
      expect(migrated.contentVersion).toBe(14);
      expect(migrated.coins).toBe(previous.coins);
      expect(migrated.bestStars).toBe(previous.bestStars);
      expect(migrated.claimed).toBe(previous.claimed);
      expect(data.get(`${key}.content-13`)).toBe(raw);
      expect(data.get(key)).toBe(raw);
      expect(data.get("arowgo.profile.v1")).toBe(profile);
      expect(() =>
        validatePlayableRestore({
          schemaVersion: 1,
          gameId: "arowgo",
          trust: "unverified-local",
          entries: [{ key, raw }],
        }),
      ).not.toThrow();
      let state = migrated;
      for (const id of level.solution)
        state = resolve(level, state, {
          id,
          type: "select",
          arrowId: id,
          attemptId: state.attemptId,
        }).state;
      expect(state.status).toBe("complete");
      expect(state.coins).toBe(25);
      expect(state.reward).toBe(complete ? 0 : 25);
    }
    expect(verifyClear(old.levelId, old.contentVersion, old.solution)).toBe(
      true,
    );
  }
}, 120000);
it("places every new world puzzle above the previous world's peak structural score", () => {
  const oldPeak = Math.max(
    ...ratings
      .filter((r) => r.levelId.startsWith("clockwork-"))
      .map((r) => r.score),
  );
  const current = ratings.filter((r) => r.levelId.startsWith("astral-"));
  expect(current).toHaveLength(40);
  for (const r of current) expect(r.score).toBeGreaterThan(oldPeak);
  expect(current.map((r) => r.score)).toEqual(
    current.map((r) => r.score).sort((a, b) => a - b),
  );
});

it("keeps a verified step up for every retuned source puzzle", () => {
  for (const l of levels.slice(140, 180)) {
    const raw = JSON.parse(
      readFileSync(
        `content/levels/astral/level-${Number(l.levelId.split("-")[1])}.json`,
        "utf8",
      ),
    );
    const old = oldLevels.find(
      (x) => x.levelId === raw.generation.sourceLevelId,
    )!;
    expect(old).toBeDefined();
    const before = measureDifficulty(old),
      after = measureDifficulty(l);
    expect(after.randomLegalWinRate).toBeLessThanOrEqual(
      before.randomLegalWinRate,
    );
    expect(rateDifficulty(after, calibration).score).toBeGreaterThanOrEqual(
      rateDifficulty(before, calibration).score,
    );
  }
}, 120000);
