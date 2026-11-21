import { describe, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openWalletLedger } from "../server/economy/wallet.mjs";
import { rewardLevels } from "../server/economy/rewards.mjs";
import { validateSnapshot } from "../server/account/cloud.mjs";
const level = rewardLevels[0];
function run(w, elapsed = 1000, moves = level.solution) {
  const a = w.begin("ABC", randomUUID(), level.levelId);
  const op = randomUUID();
  return { a, op, result: w.complete("ABC", op, a.attemptId, moves, elapsed) };
}
function using(fn) {
  const w = openWalletLedger(":memory:", { random: () => 0 });
  try {
    fn(w);
  } finally {
    w.close();
  }
}
describe("account progression and equipped skin", () => {
  it("saves stars, upgrades on replay, never downgrades or repeats first-clear coins", () =>
    using((w) => {
      expect(run(w, 999999).result.stars).toBe(2);
      expect(run(w).result).toMatchObject({
        stars: 3,
        bestStars: 3,
        awarded: 0,
      });
      expect(run(w, 999999).result.bestStars).toBe(3);
      expect(w.overview("ABC").progress).toEqual([
        { levelId: level.levelId, bestStars: 3 },
      ]);
      expect(w.get("ABC").coins).toBe(25);
      expect(w.history("ABC")).toHaveLength(1);
    }));
  it("holds the first submitted score for an attempt even if timing is changed", () =>
    using((w) => {
      const { a, op, result } = run(w, 999999);
      expect(
        w.complete("ABC", op, a.attemptId, level.solution, 999999),
      ).toEqual(result);
      expect(() =>
        w.complete("ABC", op, a.attemptId, level.solution, 0),
      ).toThrow("operation-conflict");
      expect(
        w.complete("ABC", randomUUID(), a.attemptId, level.solution, 0).stars,
      ).toBe(2);
    }));
  it("rejects invalid timing without partial currency or progress writes", () =>
    using((w) => {
      const a = w.begin("ABC", randomUUID(), level.levelId);
      for (const time of [-1, 0.5, "100", Infinity])
        expect(() =>
          w.complete("ABC", randomUUID(), a.attemptId, level.solution, time),
        ).toThrow("invalid-completion");
      expect(w.get("ABC").coins).toBe(0);
      expect(w.overview("ABC").progress).toEqual([]);
    }));
  it("uses mistake count from replay and only paid server boosts for the time target", () =>
    using((w) => {
      const oneMistake = ["B", ...level.solution];
      expect(run(w, 999999, oneMistake).result.stars).toBe(1);
      w.gift("ABC", randomUUID());
      const a = w.begin("ABC", randomUUID(), level.levelId);
      w.boost("ABC", randomUUID(), a.attemptId);
      expect(
        w.complete("ABC", randomUUID(), a.attemptId, level.solution, 100000)
          .stars,
      ).toBe(3);
      expect(w.get("ABC").gems).toBe(17);
      expect(w.get("ABC").coins).toBe(25);
    }));
  it("enforces inventory and preference revision without spending currency", () =>
    using((w) => {
      run(w);
      const skin = w.chest("ABC", randomUUID(), "bloom", "coins").reward.skin;
      const before = w.get("ABC");
      const op = randomUUID();
      const chosen = w.equip("ABC", op, skin, 0);
      expect(chosen).toEqual({ equipped: skin, revision: 1 });
      expect(w.equip("ABC", op, skin, 0)).toEqual(chosen);
      expect(() => w.equip("ABC", randomUUID(), "classic", 0)).toThrow(
        "preference-conflict",
      );
      expect(() => w.equip("DEF", randomUUID(), skin, 0)).toThrow(
        "skin-not-owned",
      );
      expect(w.get("DEF")).toBeNull();
      expect(w.get("ABC")).toMatchObject({
        coins: before.coins,
        gems: before.gems,
      });
      expect(w.overview("ABC").preference).toEqual(chosen);
    }));
  it("upgrades old databases from the reviewed backup and preserves later choices on reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "arowgo-progress-"));
    const file = join(dir, "wallet.sqlite");
    let w;
    try {
      w = openWalletLedger(file);
      const backup = validateSnapshot({
        schemaVersion: 1,
        gameId: "arowgo",
        trust: "unverified-local",
        entries: [
          {
            key: "arowgo.slice.v1",
            raw: JSON.stringify({
              levelId: level.levelId,
              claimed: true,
              bestStars: 3,
            }),
          },
          {
            key: "arowgo.profile.v1",
            raw: JSON.stringify({ equipped: "mint" }),
          },
        ],
      });
      const m = {
        accountId: "ABC",
        approvalId: "review",
        backupHash: createHash("sha256")
          .update(JSON.stringify(backup))
          .digest("hex"),
        coins: 410,
        gems: 19,
        cleared: [level.levelId],
        owned: ["classic", "mint"],
        gemGiftClaimed: true,
        welcomeClaimed: true,
      };
      w.importReviewedLegacy("ABC", randomUUID(), m, backup);
      w.close();
      w = undefined;
      const old = new DatabaseSync(file);
      old.exec(
        "DROP TABLE progress;DROP TABLE preferences;DROP TABLE attempt_scores;",
      );
      old.close();
      w = openWalletLedger(file);
      expect(w.overview("ABC")).toMatchObject({
        progress: [{ levelId: level.levelId, bestStars: 3 }],
        preference: { equipped: "mint", revision: 0 },
      });
      expect(w.get("ABC")).toMatchObject({ coins: 410, gems: 19 });
      w.equip("ABC", randomUUID(), "classic", 0);
      w.close();
      w = undefined;
      w = openWalletLedger(file);
      expect(w.overview("ABC").preference.equipped).toBe("classic");
      expect(w.get("ABC")).toMatchObject({ coins: 410, gems: 19 });
    } finally {
      w?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
