import { expect, it } from "vitest";
import { levels } from "../src/domain/campaign";
import {
  newSession,
  resolve,
  stars,
  parseSession,
} from "../src/application/session";
it("awards completion, accuracy and time independently and persists timing", () => {
  const level = levels[0];
  let state = newSession(level, "timed");
  for (const [i, id] of level.solution.entries()) {
    state = resolve(level, state, {
      id,
      attemptId: "timed",
      type: "select",
      arrowId: id,
      now: 1000 + i * 1000,
    }).state;
  }
  expect(stars(state)).toBe(3);
  expect(parseSession(JSON.stringify(state), level).elapsedMs).toBe(9000);
  expect(stars({ ...state, mistakes: 1 })).toBe(2);
  expect(stars({ ...state, elapsedMs: state.targetMs! + 1 })).toBe(2);
  expect(stars({ ...state, mistakes: 2, elapsedMs: state.targetMs! + 1 })).toBe(
    1,
  );
  expect(stars({ ...state, elapsedMs: state.targetMs! })).toBe(3);
  expect(stars({ ...state, mode: "practice" })).toBe(0);
  const legacy = { ...state, scoringVersion: undefined, assisted: true };
  expect(stars(parseSession(JSON.stringify(legacy), level))).toBe(1);
  const replay = newSession(level, "replay", "story", state);
  expect(replay.bestStars).toBe(3);
  expect(replay.elapsedMs).toBe(0);
  expect(replay.startedAt).toBeUndefined();
});
