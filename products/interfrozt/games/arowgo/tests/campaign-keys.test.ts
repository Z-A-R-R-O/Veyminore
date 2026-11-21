import { expect, it } from "vitest";
import { levels } from "../src/domain/campaign";
import { previousPlainLevels } from "../src/domain/campaignV3";
import { newSession, resolve } from "../src/application/session";
import { SaveStore } from "../src/storage/save";

it("introduces single key pairs gradually in five later levels", () => {
  expect(
    levels.slice(0,20).flatMap((l, i) => (l.arrows.some((a) => a.requires) ? [i + 1] : [])),
  ).toEqual([11, 14, 17, 19, 20]);
  for (const l of levels.filter(
    (l) => l.arrows.some((a) => a.requires),
  ))
    expect(l.arrows.filter((a) => a.requires)).toHaveLength(1);
});
for (const old of previousPlainLevels) {
  it.each(["playing", "complete", "replay", "backup"])(
    `${old.levelId}: migrates %s safely`,
    (status) => {
      const next = levels.find((l) => l.levelId === old.levelId)!;
      let state = newSession(old, "old");
      const moves =
        status === "playing" ? old.solution.slice(0, 3) : old.solution;
      for (const id of moves)
        state = resolve(old, state, {
          id,
          attemptId: state.attemptId,
          type: "select",
          arrowId: id,
        }).state;
      if (status === "replay")
        state = newSession(old, "replay", "practice", state);
      const raw = JSON.stringify(state);
      const data = new Map(
        status === "backup"
          ? [
              ["save", "broken"],
              ["save.backup", raw],
            ]
          : [["save", raw]],
      );
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
        coins: state.coins,
        bestStars: state.bestStars,
        claimed: state.claimed,
        mode: state.mode,
        status: "playing",
      });
      expect(migrated.active).toHaveLength(next.arrows.length);
      expect(data.get("save.content-3")).toBe(raw);
      expect(saves.save(migrated)).toBe(true);
      expect(saves.load().state).toEqual(migrated);
      let replay = newSession(next, "finish", "story", migrated);
      for (const id of next.solution)
        replay = resolve(next, replay, {
          id,
          attemptId: "finish",
          type: "select",
          arrowId: id,
        }).state;
      expect(replay.status).toBe("complete");
      expect(replay.coins).toBe(25);
      expect(replay.reward).toBe(state.claimed ? 0 : 25);
    },
  );
}
