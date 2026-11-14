import { expect, it } from "vitest";
import { levels } from "../src/domain/campaign";
import { checkExit, solve } from "../src/domain/rules";
import { Controller } from "../src/application/controller";
import { SaveStore } from "../src/storage/save";
it.each(levels)("$levelId has a legal complete solution", (level) => {
  let active = level.arrows.map((a) => a.id);
  for (const id of level.solution) {
    expect(checkExit(level, active, id).clear).toBe(true);
    active = active.filter((v) => v !== id);
  }
  expect(active).toEqual([]);
  expect(solve(level)).toBeTruthy();
});
it("isolates five saves, restores attempts, and awards exactly 125 total coins", () => {
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
  expect(total).toBe(125);
});
