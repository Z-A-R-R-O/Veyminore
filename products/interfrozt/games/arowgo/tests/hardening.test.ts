import { it, expect } from "vitest";
import { beforeHardeningLevels } from "../src/domain/campaignBeforeHardening";
import { levels } from "../src/domain/campaign";
import { evaluatePlanning } from "../src/domain/planning";
import { newSession, resolve, parseSession } from "../src/application/session";
import { SaveStore } from "../src/storage/save";
// @ts-expect-error Server ESM is exercised directly by integration tests.
import { verifyClear } from "../server/economy/rewards.mjs";
import { validatePlayableRestore } from "../src/account/cloud-restore";
it("harder 40–60 keep geometry, require planning and preserve old rewards", () => {
  let previousRate = Infinity;
  for (const old of beforeHardeningLevels) {
    const level = levels.find((l) => l.levelId === old.levelId)!;
    expect(level.contentVersion).toBe(11);
    expect(level.arrows.map((a) => a.points)).toEqual(
      old.arrows.map((a) => a.points),
    );
    const p = evaluatePlanning(level);
    expect(p.randomLegalWinRate).toBeGreaterThan(0);
    expect(p.randomLegalWinRate).toBeLessThan(previousRate);
    previousRate = p.randomLegalWinRate;
    expect(p.randomLegalWinRate).toBeLessThan(
      evaluatePlanning(old).randomLegalWinRate * 0.8,
    );
    expect(p.blockedTargetDecisions).toBeGreaterThan(0);
    expect(verifyClear(old.levelId, old.contentVersion, old.solution)).toBe(
      true,
    );
    expect(verifyClear(level.levelId, 11, level.solution)).toBe(true);
    let state = newSession(old, "old");
    for (const id of old.solution)
      state = resolve(old, state, {
        id,
        attemptId: state.attemptId,
        type: "select",
        arrowId: id,
      }).state;
    const key = `arowgo.level.${old.levelId}.v1`,
      raw = JSON.stringify(state),
      data = new Map([[key, raw]]);
    const restored = new SaveStore(
      {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          data.set(k, v);
        },
      },
      level,
      key,
      [old],
    ).load().state!;
    expect(restored.coins).toBe(state.coins);
    expect(restored.bestStars).toBe(state.bestStars);
    expect(restored.claimed).toBe(state.claimed);
    expect(data.get(`${key}.content-${old.contentVersion}`)).toBe(raw);
    expect(
      validatePlayableRestore({
        schemaVersion: 1,
        gameId: "arowgo",
        trust: "unverified-local",
        entries: [{ key, raw }],
      }).entries[0].raw,
    ).toBe(raw);
    let current = newSession(level, "new");
    for (const id of level.solution) {
      current = resolve(level, current, {
        id,
        attemptId: current.attemptId,
        type: "select",
        arrowId: id,
      }).state;
      expect(parseSession(JSON.stringify(current), level)).toEqual(current);
    }
    expect(current.status).toBe("complete");
  }
}, 30000);
