import { expect, it } from "vitest";
import { keyLesson as level } from "../src/domain/keyLesson";
import { checkExit, solve, validateLevel } from "../src/domain/rules";
import { newSession, resolve, parseSession } from "../src/application/session";
it("keeps a clear geometric exit locked until the key is removed", () => {
  const active = level.arrows.map((a) => a.id);
  expect(checkExit(level, active, "G")).toMatchObject({
    clear: false,
    reason: "locked",
    blocker: "K",
  });
  expect(
    checkExit(
      level,
      active.filter((a) => a !== "K"),
      "G",
    ).clear,
  ).toBe(true);
  const solution=solve(level)!;
  expect(solution.indexOf('K')).toBeLessThan(solution.indexOf('G'));
  expect(validateLevel({...level,solution})).toBeTruthy();
  expect(() =>
    validateLevel({
      ...level,
      arrows: level.arrows.map((a) =>
        a.id === "G" ? { ...a, requires: "missing" } : a,
      ),
    }),
  ).toThrow();
  expect(() =>
    validateLevel({
      ...level,
      arrows: level.arrows.map((a) =>
        a.id === "K" ? { ...a, requires: "G" } : a,
      ),
    }),
  ).toThrow();
});
it("persists unlocking, hints obey locks, and Erase can remove a key", () => {
  let state = newSession(level, "keys", "practice");
  expect(
    resolve(level, state, { id: "hint", attemptId: "keys", type: "hint" })
      .hints,
  ).not.toContain("G");
  state = resolve(level, state, {
    id: "erase",
    attemptId: "keys",
    type: "erase",
    arrowId: "K",
  }).state;
  expect(
    checkExit(level, parseSession(JSON.stringify(state), level).active, "G")
      .clear,
  ).toBe(true);
  state = resolve(level, state, {
    id: "gate",
    attemptId: "keys",
    type: "select",
    arrowId: "G",
  }).state;
  expect(state.mistakes).toBe(0);
});
