import { expect, it } from "vitest";
import { levels } from "../src/domain/campaign";
import { checkExit, solve } from "../src/domain/rules";
import { Controller } from "../src/application/controller";
import { SaveStore } from "../src/storage/save";
it("contains three twenty-level worlds", () => {
  expect(levels).toHaveLength(60);
  expect(levels.map((level) => level.levelId)).toEqual([
    "bloom-01",
    "bloom-02",
    "bloom-03",
    "bloom-04",
    "bloom-05",
    "bloom-06",
    "bloom-07",
    "bloom-08",
    "bloom-09",
    "bloom-10",
    ...Array.from({ length: 10 }, (_, i) => `bloom-${i + 11}`),
    ...Array.from({ length: 20 }, (_, i) => `cove-${i + 21}`),
    ...Array.from({ length: 20 }, (_, i) => `frost-${i + 41}`),
  ]);
});
it.each(levels)("$levelId has a legal complete solution", (level) => {
  let active = level.arrows.map((a) => a.id);
  for (const id of level.solution) {
    expect(checkExit(level, active, id).clear).toBe(true);
    active = active.filter((v) => v !== id);
  }
  expect(active).toEqual([]);
  expect(solve(level)).toBeTruthy();
});
it("isolates sixty saves, restores attempts, and awards exactly 1500 total coins", () => {
  const values = new Map<string, string>();
  const store = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
  let total = 0;
  levels.forEach((level) => {
    const c = new Controller(level, new SaveStore(store, level, level.levelId));
    for (const id of level.solution) c.select(id);
    expect(c.state.coins).toBe(25);
    c.restart();
    for (const id of level.solution) c.select(id);
    expect(c.state.coins).toBe(25);
    const restored = new Controller(
      level,
      new SaveStore(store, level, level.levelId),
    );
    expect(restored.state.bestStars).toBe(3);
    total += restored.state.coins;
  });
  expect(total).toBe(1500);
}, 15000);
