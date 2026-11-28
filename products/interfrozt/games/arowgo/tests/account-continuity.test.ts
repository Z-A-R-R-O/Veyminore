import { describe, it, expect } from "vitest";
// @ts-expect-error Server ESM integration.
import { openWalletLedger } from "../server/economy/wallet.mjs";
import { accountRestorePlan } from "../src/account/account-restore";
import { restoreAccountCopy } from "../src/account/account-restore-store";
import { captureLegacyBackup } from "../src/account/legacy-backup";
import { levels } from "../src/domain/campaign";

function createMockStorage() {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

describe("Account Continuity and Conflict Policy", () => {
  it("synchronizes custom avatar, frame, and name to server and restores on second device", () => {
    let now = 10000;
    const ledger = openWalletLedger(":memory:", { now: () => now });
    const accountId = "A1B2C3D4";

    try {
      // 1. Initial starter gift
      ledger.gift(accountId, "00000000-0000-4000-8000-000000000001");
      const initialOverview = ledger.overview(accountId);
      expect(initialOverview.preference.revision).toBe(0);

      // 2. Player customizes appearance on Device 1
      const appearanceOp = "00000000-0000-4000-8000-000000000002";
      const updatedPref = ledger.appearance(accountId, appearanceOp, {
        avatar: "adventure-04",
        frame: "frame-02",
        name: "Starlight",
        expectedRevision: 0,
      });

      expect(updatedPref.avatar).toBe("adventure-04");
      expect(updatedPref.frame).toBe("frame-02");
      expect(updatedPref.name).toBe("Starlight");
      expect(updatedPref.revision).toBe(1);

      // 3. Device 2 fetches account overview and plans restore
      const overviewDevice2 = ledger.overview(accountId);
      expect(overviewDevice2.preference.avatar).toBe("adventure-04");
      expect(overviewDevice2.preference.frame).toBe("frame-02");
      expect(overviewDevice2.preference.name).toBe("Starlight");

      // Seed a dummy migration backupHash for restore plan
      const plan = accountRestorePlan(accountId, {
        ...overviewDevice2,
        migration: { backupHash: "a".repeat(64) },
      });

      expect(plan.avatar).toBe("adventure-04");
      expect(plan.avatarFrame).toBe("frame-02");
      expect(plan.name).toBe("Starlight");

      const profileEntry = plan.entries.find((e) => e.key === "arowgo.profile.v1");
      expect(profileEntry).toBeDefined();
      const restoredProfile = JSON.parse(profileEntry!.raw);
      expect(restoredProfile.avatar).toBe("adventure-04");
      expect(restoredProfile.avatarFrame).toBe("frame-02");
      expect(restoredProfile.name).toBe("Starlight");
    } finally {
      ledger.close();
    }
  });

  it("enforces optimistic concurrency on appearance updates and rejects stale revisions", () => {
    let now = 20000;
    const ledger = openWalletLedger(":memory:", { now: () => now });
    const accountId = "A1B2C3D4";

    try {
      ledger.gift(accountId, "00000000-0000-4000-8000-000000000003");

      // Device A commits appearance change with expectedRevision: 0
      ledger.appearance(accountId, "00000000-0000-4000-8000-000000000004", {
        avatar: "scholar",
        frame: "verdant",
        name: "DeviceA_Name",
        expectedRevision: 0,
      });

      // Device B attempts to commit with stale expectedRevision: 0
      expect(() =>
        ledger.appearance(accountId, "00000000-0000-4000-8000-000000000005", {
          avatar: "seeker",
          frame: "gold",
          name: "DeviceB_Name",
          expectedRevision: 0,
        }),
      ).toThrow("preference-conflict");

      // Device B fetches latest revision (1) and retries successfully
      const overview = ledger.overview(accountId);
      expect(overview.preference.revision).toBe(1);

      const resolved = ledger.appearance(accountId, "00000000-0000-4000-8000-000000000006", {
        avatar: "seeker",
        frame: "gold",
        name: "DeviceB_Name",
        expectedRevision: 1,
      });

      expect(resolved.avatar).toBe("seeker");
      expect(resolved.revision).toBe(2);
    } finally {
      ledger.close();
    }
  });

  it("handles concurrent level completions: awards first-clear coins once and takes max stars", () => {
    let now = 30000;
    const ledger = openWalletLedger(":memory:", { now: () => now });
    const accountId = "A1B2C3D4";

    try {
      ledger.gift(accountId, "00000000-0000-4000-8000-000000000007");

      // Both devices start level 1 independently
      const levelId = levels[0].levelId;
      const attempt1 = ledger.begin(accountId, "00000000-0000-4000-8000-000000000008", levelId);
      const attempt2 = ledger.begin(accountId, "00000000-0000-4000-8000-000000000009", levelId);

      expect(attempt1.attemptId).not.toBe(attempt2.attemptId);

      const solutionMoves = levels[0].solution.map((arrowId) => ({
        type: "select",
        arrowId,
      }));

      // Device 1 submits completion first (elapsed: 1000ms -> 3 stars: finish + no mistakes + speed)
      const res1 = ledger.complete(
        accountId,
        "00000000-0000-4000-8000-000000000010",
        attempt1.attemptId,
        solutionMoves,
        1000,
      );

      expect(res1.awarded).toBe(25);
      expect(res1.stars).toBe(3);
      expect(ledger.get(accountId).coins).toBe(25);

      // Device 2 submits completion second (elapsed: 90000ms -> 2 stars: finish + no mistakes, speed missed)
      const res2 = ledger.complete(
        accountId,
        "00000000-0000-4000-8000-000000000011",
        attempt2.attemptId,
        solutionMoves,
        90000,
      );

      // First-clear reward is 0 (already awarded to Device 1)
      expect(res2.awarded).toBe(0);
      expect(res2.stars).toBe(2);
      expect(res2.bestStars).toBe(3); // Best stars remains 3 (monotonically non-decreasing)
      expect(ledger.get(accountId).coins).toBe(25); // Coins unchanged at 25
    } finally {
      ledger.close();
    }
  });

  it("restarts in-progress boards cleanly without importing corrupted partial move states", () => {
    const accountId = "A1B2C3D4";
    const remoteData = {
      accountId,
      wallet: { coins: 25, gems: 20, revision: 2 },
      migration: { backupHash: "b".repeat(64) },
      cleared: [levels[0].levelId],
      progress: [{ levelId: levels[0].levelId, bestStars: 3 }],
      inventory: ["classic"],
      claims: ["welcome-chest"],
      preference: {
        equipped: "classic",
        avatar: "scholar",
        frame: "default",
        name: "ContinuityPlayer",
        revision: 1,
      },
    };

    const plan = accountRestorePlan(accountId, remoteData);

    // Cleared level 01 is reconstructed with claimed: true and 25 coins
    const level1Entry = plan.entries.find((e) => e.key === "arowgo.slice.v1")!;
    const level1State = JSON.parse(level1Entry.raw);
    expect(level1State.claimed).toBe(true);
    expect(level1State.bestStars).toBe(3);
    expect(level1State.coins).toBe(25);
    expect(level1State.moveLog).toEqual([]);

    // Uncleared level 02 is reconstructed with claimed: false, coins: 0, and empty moves
    const level2Entry = plan.entries.find((e) => e.key === `arowgo.level.${levels[1].levelId}.v1`)!;
    const level2State = JSON.parse(level2Entry.raw);
    expect(level2State.claimed).toBe(false);
    expect(level2State.coins).toBe(0);
    expect(level2State.moveLog).toEqual([]);
    expect(typeof level2State.attemptId).toBe("string");
  });

  it("strictly isolates account-bound storage from guest storage and other accounts", () => {
    const storage = createMockStorage();
    const legacyBefore = { "arowgo.profile.v1": JSON.stringify({ gems: 100 }) };
    storage.setItem("arowgo.profile.v1", legacyBefore["arowgo.profile.v1"]);

    const capturedLegacy = captureLegacyBackup(storage);
    const targetEntries = [
      { key: "arowgo.profile.v1", raw: JSON.stringify({ gems: 5 }) },
      { key: "arowgo.slice.v1", raw: JSON.stringify({ claimed: true }) },
    ];

    // Restore Account A
    restoreAccountCopy(storage, "AAAA1111", capturedLegacy, targetEntries);

    // Verify Account A saved under its isolated namespace
    expect(storage.getItem("arowgo.economy.AAAA1111.save.arowgo.profile.v1")).toBe(
      JSON.stringify({ gems: 5 }),
    );
    // Legacy guest storage is untouched
    expect(storage.getItem("arowgo.profile.v1")).toBe(legacyBefore["arowgo.profile.v1"]);

    // Attempting to connect a second account without disconnecting first throws
    expect(() =>
      restoreAccountCopy(storage, "BBBB2222", capturedLegacy, targetEntries),
    ).toThrow("device-already-connected");
  });
});
