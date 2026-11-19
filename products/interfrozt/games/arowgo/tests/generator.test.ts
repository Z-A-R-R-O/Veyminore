import { expect, it } from "vitest";
import { generatePuzzle, evaluateDifficulty } from "../src/domain/generator";
import { levels } from "../src/domain/campaign";
import { levels as legacy } from "../src/domain/legacyCampaign";
import { validateLevel, checkExit } from "../src/domain/rules";
import { newSession, resolve } from "../src/application/session";
import { SaveStore } from "../src/storage/save";
import { previousGeneratedLevels } from "../src/domain/campaignV2";
it("reproduces seeds and verifies solutions against swept collisions", () => {
  expect(generatePuzzle(42, 12, 60)).toEqual(generatePuzzle(42, 12, 60));
  for (let seed = 0; seed < 20; seed++) {
    const level = generatePuzzle(seed, 10, 50);
    expect(level.generation.difficulty.initialChoices).toBeLessThanOrEqual(5);
    expect(level.generation.quality.isolated).toBeLessThanOrEqual(1);
    expect(level.generation.quality.emptyQuadrants).toBe(0);
    expect(validateLevel(level)).toBe(level);
    let active = level.arrows.map((a) => a.id);
    for (const id of level.solution) {
      expect(checkExit(level, active, id).clear).toBe(true);
      active = active.filter((a) => a !== id);
    }
  }
}, 30000);
it("bounds generation and increases campaign grades", () => {
  expect(() => generatePuzzle(1, 100, 50)).toThrow();
  const scores = levels.slice(5, 10).map((l) => evaluateDifficulty(l).score);
  expect(scores.every((s, i) => i === 0 || s >= scores[i - 1])).toBe(true);
  expect(levels.slice(0, 4).map((l) => l.arrows)).toEqual(
    legacy.slice(0, 4).map((l) => l.arrows),
  );
  expect(
    new Set(levels.slice(5, 10).map((l) => JSON.stringify(l.arrows))).size,
  ).toBe(5);
});
it.each(["playing", "complete"] as const)(
  "migrates legacy %s with awards intact",
  (status) => {
    const old = legacy[5],
      next = levels[5];
    let state = newSession(old, "old");
    for (const id of old.solution)
      state = resolve(old, state, {
        id,
        attemptId: "old",
        type: "select",
        arrowId: id,
      }).state;
    if (status === "playing") state = newSession(old, "replay", "story", state);
    const raw = JSON.stringify(state),
      values = new Map([["save", raw]]);
    const store = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
    };
    const saves = new SaveStore(store, next, "save", old),
      loaded = saves.load();
    expect(loaded.state).toMatchObject({
      contentVersion: next.contentVersion,
      bestStars: 3,
      coins: 25,
      claimed: true,
      status: "playing",
    });
    expect(loaded.state!.active).toHaveLength(next.arrows.length);
    expect(values.get("save.content-1")).toBe(raw);
    expect(saves.save(loaded.state!)).toBe(true);
    expect(saves.load().state).toEqual(loaded.state);
    let replay = loaded.state!;
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
  },
);
it("also migrates version-2 generated attempts through a list of known layouts", () => {
  const previous = previousGeneratedLevels[0];
  const raw = JSON.stringify(newSession(previous, "v2"));
  const values = new Map([["save", raw]]);
  const saves = new SaveStore(
    {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => {
        values.set(k, v);
      },
    },
    levels[5],
    "save",
    [legacy[5], previous],
  );
  expect(saves.load().state).toMatchObject({
    contentVersion: levels[5].contentVersion,
    claimed: false,
    coins: 0,
    bestStars: 0,
  });
  expect(values.get("save.content-2")).toBe(raw);
});

it("generates reproducible, meaningful key locks with complete legal solutions", () => {
  const options = { keyLockPairs: 1 } as const;
  expect(generatePuzzle(42, 10, 70, "keys", options)).toEqual(
    generatePuzzle(42, 10, 70, "keys", options),
  );
  for (let seed = 0; seed < 12; seed++) {
    const level = generatePuzzle(seed, 10, 70, `keys-${seed}`, options);
    validateLevel(level);
    const locks = level.arrows.filter((a) => a.requires);
    expect(locks).toHaveLength(1);
    const lock = locks[0];
    let active = level.arrows.map((a) => a.id);
    expect(checkExit(level, active, lock.id)).toMatchObject({
      clear: false,
      reason: "locked",
      blocker: lock.requires,
    });
    for (const id of level.solution) {
      expect(checkExit(level, active, id).clear).toBe(true);
      active = active.filter((a) => a !== id);
    }
    expect(active).toHaveLength(0);
    expect(level.solution.indexOf(lock.requires!)).toBeLessThan(
      level.solution.indexOf(lock.id),
    );
    // Without the lock, its geometry can be cleared while retaining the key:
    // the generated prerequisite adds a real constraint rather than duplicating geometry.
    const plain = {
      ...level,
      arrows: level.arrows.map((a) => ({ ...a, requires: undefined })),
    };
    active = plain.arrows.map((a) => a.id);
    for (;;) {
      const next = active.find(
        (id) => id !== lock.requires && checkExit(plain, active, id).clear,
      );
      if (!next) break;
      active = active.filter((id) => id !== next);
    }
    expect(active).toContain(lock.requires);
    expect(active).not.toContain(lock.id);
  }
}, 30000);

it("keeps key generation opt-in and rejects unsupported pair counts", () => {
  expect(generatePuzzle(42, 10, 70).arrows.every((a) => !a.requires)).toBe(
    true,
  );
  expect(() =>
    generatePuzzle(42, 10, 70, "invalid", { keyLockPairs: 2 as 1 }),
  ).toThrow("Invalid generation options");
});
