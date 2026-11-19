import { it, expect } from "vitest";
import { verifyClear } from "../server/economy/rewards.mjs";
import { beforeTimingLevels } from "../src/domain/campaignBeforeTiming";
import { levels } from "../src/domain/campaign";
import { newSession, resolve } from "../src/application/session";
import {
  validatePlayableRestore,
  describeSave,
} from "../src/account/cloud-restore";
it("accepts authenticated old-version attempt replays and validates new timing completions", () => {
  for (const old of beforeTimingLevels)
    expect(verifyClear(old.levelId, 9, old.solution)).toBe(true);
  for (const level of levels.slice(40))
    expect(verifyClear(level.levelId, level.contentVersion, level.solution)).toBe(true);
  expect(() => verifyClear("frost-41", 8, [])).toThrow();
});
it("old cloud save remains restorable with its earned coins and stars", () => {
  const old = beforeTimingLevels[0];
  let s = newSession(old, "cloud-old");
  for (const id of old.solution)
    s = resolve(old, s, {
      id,
      attemptId: "cloud-old",
      type: "select",
      arrowId: id,
    }).state;
  const snapshot = {
    schemaVersion: 1,
    gameId: "arowgo",
    trust: "unverified-local",
    entries: [{ key: "arowgo.level.frost-41.v1", raw: JSON.stringify(s) }],
  };
  expect(validatePlayableRestore(snapshot).entries).toEqual(snapshot.entries);
  expect(describeSave(snapshot)).toContain(
    "1 levels cleared · 3 stars · 25 coins",
  );
});
