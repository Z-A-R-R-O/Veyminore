import { describe, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { openWalletLedger } from "../server/economy/wallet.mjs";
import { rewardLevels } from "../server/economy/rewards.mjs";
import { validateSnapshot } from "../server/account/cloud.mjs";
const backup = {
  schemaVersion: 1,
  gameId: "arowgo",
  trust: "unverified-local",
  entries: [{ key: "arowgo.profile.v1", raw: '{"gems":19}' }],
};
const manifest = (overrides = {}) => ({
  accountId: "ABC",
  approvalId: "review-test",
  backupHash: createHash("sha256")
    .update(JSON.stringify(validateSnapshot(backup)))
    .digest("hex"),
  coins: 410,
  gems: 19,
  cleared: [],
  owned: ["classic"],
  gemGiftClaimed: true,
  welcomeClaimed: true,
  ...overrides,
});
function fixture(fn, options = {}) {
  const w = openWalletLedger(":memory:", options);
  try {
    fn(w);
  } finally {
    w.close();
  }
}
describe("atomic economy purchases and migration", () => {
  it("imports exact reviewed balances and archives source; retries never add balances", () =>
    fixture((w) => {
      const op = randomUUID(),
        m = manifest();
      const result = w.importReviewedLegacy("ABC", op, m, backup);
      expect(result.wallet).toMatchObject({ coins: 410, gems: 19 });
      expect(w.migrationBackup("ABC")).toEqual(validateSnapshot(backup));
      expect(w.importReviewedLegacy("ABC", op, m, backup)).toEqual(result);
      expect(() =>
        w.importReviewedLegacy("ABC", randomUUID(), m, backup),
      ).toThrow("import-conflict");
      expect(w.gift("ABC", randomUUID()).awarded).toBe(0);
      expect(() =>
        w.chest("ABC", randomUUID(), "bloom", "coins", true),
      ).toThrow("already-claimed");
    }));
  it("rejects wrong backup or owner without creating any wallet", () =>
    fixture((w) => {
      for (const m of [
        manifest({ backupHash: "bad" }),
        manifest({ accountId: "DEF" }),
      ])
        expect(() =>
          w.importReviewedLegacy("ABC", randomUUID(), m, backup),
        ).toThrow("invalid-import");
      expect(w.get("ABC")).toBeNull();
      expect(w.migrationBackup("ABC")).toBeNull();
    }));
  it("never overwrites an existing earned balance", () =>
    fixture((w) => {
      w.gift("ABC", randomUUID());
      expect(() =>
        w.importReviewedLegacy("ABC", randomUUID(), manifest(), backup),
      ).toThrow("import-conflict");
      expect(w.get("ABC").gems).toBe(20);
    }));
  it("grants gift and welcome chest once across distinct requests", () =>
    fixture((w) => {
      expect(w.gift("ABC", randomUUID()).awarded).toBe(20);
      expect(w.gift("ABC", randomUUID()).awarded).toBe(0);
      const op = randomUUID(),
        r = w.chest("ABC", op, "bloom", "coins", true);
      expect(w.chest("ABC", op, "bloom", "coins", true)).toEqual(r);
      expect(() =>
        w.chest("ABC", randomUUID(), "bloom", "coins", true),
      ).toThrow("already-claimed");
    }));
  it("charges server prices and refunds duplicates; replay does not reroll", () => {
    let rolls = 0;
    fixture(
      (w) => {
        w.importReviewedLegacy("ABC", randomUUID(), manifest(), backup);
        const op = randomUUID(),
          r = w.chest("ABC", op, "bloom", "coins");
        expect(r.wallet.coins).toBe(400);
        expect(rolls).toBe(2);
        expect(w.chest("ABC", op, "bloom", "coins")).toEqual(r);
        expect(rolls).toBe(2);
        const d = w.chest("ABC", randomUUID(), "bloom", "coins");
        expect(d.reward.duplicate).toBe(true);
        expect(d.reward.refund).toBe(5);
        expect(d.wallet.coins).toBe(395);
        const g = w.chest("ABC", randomUUID(), "bloom", "gems");
        expect(g.wallet.gems).toBe(18);
        expect(g.reward.refund).toBe(0);
      },
      {
        random: () => {
          rolls++;
          return 0;
        },
      },
    );
  });
  it("rejects unaffordable purchase before rolling or creating a wallet", () => {
    let rolls = 0;
    fixture(
      (w) => {
        expect(() => w.chest("ABC", randomUUID(), "celestial", "gems")).toThrow(
          "insufficient-funds",
        );
        expect(w.get("ABC")).toBeNull();
        expect(rolls).toBe(0);
      },
      {
        random: () => {
          rolls++;
          return 0;
        },
      },
    );
  });
  it("charges boost once per owned active attempt and rejects finished attempts", () =>
    fixture((w) => {
      w.gift("ABC", randomUUID());
      const a = w.begin("ABC", randomUUID(), rewardLevels[0].levelId);
      expect(() => w.boost("DEF", randomUUID(), a.attemptId)).toThrow(
        "invalid-attempt",
      );
      expect(w.boost("ABC", randomUUID(), a.attemptId).wallet.gems).toBe(17);
      expect(w.boost("ABC", randomUUID(), a.attemptId).wallet.gems).toBe(17);
      w.complete("ABC", randomUUID(), a.attemptId, rewardLevels[0].solution);
      expect(() => w.boost("ABC", randomUUID(), a.attemptId)).toThrow(
        "invalid-attempt",
      );
    }));
  it("rolls back reward and receipt together when balance limit fails", () =>
    fixture(
      (w) => {
        w.importReviewedLegacy(
          "ABC",
          randomUUID(),
          manifest({ coins: 1000000000 }),
          backup,
        );
        const a = w.begin("ABC", randomUUID(), rewardLevels[0].levelId),
          op = randomUUID();
        expect(() =>
          w.complete("ABC", op, a.attemptId, rewardLevels[0].solution),
        ).toThrow();
        expect(w.history("ABC")).toHaveLength(1);
        w.chest("ABC", randomUUID(), "celestial", "coins");
        expect(
          w.complete("ABC", op, a.attemptId, rewardLevels[0].solution).awarded,
        ).toBe(25);
      },
      { random: () => 0 },
    ));
});
