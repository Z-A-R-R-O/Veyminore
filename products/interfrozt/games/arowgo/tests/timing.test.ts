import { it, expect } from "vitest";
import {
  validateLevel,
  checkExit,
  solve,
  safeArrows,
  timingOpen,
  type Level,
} from "../src/domain/rules";
import { parseSession, newSession, resolve } from "../src/application/session";
import { beforeTimingLevels } from "../src/domain/campaignBeforeTiming";
import { levels } from "../src/domain/campaign";
import { SaveStore } from "../src/storage/save";
const base: Level = {
  schemaVersion: 1,
  rulesVersion: 2,
  contentVersion: 10,
  levelId: "timing-test",
  board: { columns: 3, rows: 3 },
  arrows: [
    {
      id: "A",
      points: [
        [0, 1],
        [0, 0],
      ],
    },
    {
      id: "B",
      points: [
        [2, 1],
        [2, 0],
      ],
    },
  ],
  solution: ["A", "B"],
};
it("gates toggle on successful moves and solver detects a stranded gate without deadlines", () => {
  const l = structuredClone(base);
  l.arrows[0].phase = 0;
  validateLevel(l);
  expect(timingOpen(l.arrows[0], 0)).toBe(true);
  expect(timingOpen(l.arrows[0], 1)).toBe(false);
  expect(safeArrows(l, ["A", "B"])).toEqual(["A"]);
  expect(solve(l, ["A"])).toBeNull();
  const s = newSession(l, "x");
  const result = resolve(l, s, {
    id: "1",
    attemptId: "x",
    type: "select",
    arrowId: "B",
  });
  expect(result.state.failureReason).toBe("stranded");
});
it("ice blocks without advancing on mistakes and thaws on removal", () => {
  const l = structuredClone(base);
  l.arrows[0].thawAfter = 1;
  l.solution = ["B", "A"];
  validateLevel(l);
  let s = newSession(l, "x");
  s = resolve(l, s, {
    id: "1",
    attemptId: "x",
    type: "select",
    arrowId: "A",
  }).state;
  expect(s.active).toHaveLength(2);
  expect(s.mistakes).toBe(1);
  expect(checkExit(l, s.active, "A").clear).toBe(false);
  s = resolve(l, s, {
    id: "2",
    attemptId: "x",
    type: "select",
    arrowId: "B",
  }).state;
  expect(checkExit(l, s.active, "A").clear).toBe(true);
  expect(solve(l)).toEqual(["B", "A"]);
});
it("rejects malformed timing content", () => {
  for (const patch of [{ phase: 2 }, { thawAfter: -1 }, { thawAfter: 2 }]) {
    const l = structuredClone(base);
    Object.assign(l.arrows[0], patch);
    expect(() => validateLevel(l)).toThrow();
  }
});
it("migrates every Frostfall clear without losing rewards or best stars and archives old data", () => {
  for (const [i, old] of beforeTimingLevels.entries()) {
    let s = newSession(old, "old");
    for (const id of old.solution)
      s = resolve(old, s, {
        id,
        attemptId: "old",
        type: "select",
        arrowId: id,
      }).state;
    const key = `arowgo.level.${old.levelId}.v1`,
      raw = JSON.stringify(s),
      data = new Map([[key, raw]]);
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    };
    const result = new SaveStore(storage, levels[40 + i], key, [old]).load();
    expect(result.state?.coins).toBe(25);
    expect(result.state?.bestStars).toBe(3);
    expect(result.state?.claimed).toBe(true);
    expect(result.state?.contentVersion).toBe(levels[40 + i].contentVersion);
    expect(data.get(key + ".content-9")).toBe(raw);
  }
});

it("reloads every intermediate and completed timing state; rejects a forged move record", () => {
  for (const level of levels.slice(40)) {
    let state = newSession(level, "reload");
    for (const id of level.solution) {
      state = resolve(level, state, {
        id,
        attemptId: "reload",
        type: "select",
        arrowId: id,
      }).state;
      expect(parseSession(JSON.stringify(state), level)).toEqual(state);
    }
    const fake = { ...state, moveLog: [] };
    expect(() => parseSession(JSON.stringify(fake), level)).toThrow();
  }
});
