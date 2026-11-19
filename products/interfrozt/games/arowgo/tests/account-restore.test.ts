import { it, expect } from "vitest";
import { accountRestorePlan } from "../src/account/account-restore";
import {
  restoreAccountCopy,
  recoverAccountRestore,
  ACCOUNT_RESTORE_JOURNAL,
  ACCOUNT_RESTORE_BACKUP,
} from "../src/account/account-restore-store";
import { captureLegacyBackup } from "../src/account/legacy-backup";
import { levels } from "../src/domain/campaign";
function storage() {
  const m = new Map<string, string>([["arowgo.profile.v1", '{"gems":99}']]);
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}
const remote = () => ({
  accountId: "ABC",
  wallet: { coins: 50, gems: 20, revision: 3 },
  migration: { backupHash: "a".repeat(64) },
  cleared: [levels[0].levelId],
  progress: [{ levelId: levels[0].levelId, bestStars: 3 }],
  inventory: ["classic"],
  claims: [],
  preference: { equipped: "classic", revision: 0 },
});
it("restores completion metadata into fresh boards without importing spending balances", () => {
  const plan = accountRestorePlan("ABC", remote());
  expect(plan.completed).toBe(1);
  expect(plan.stars).toBe(3);
  const state = JSON.parse(
    plan.entries.find((e) => e.key === "arowgo.slice.v1")!.raw,
  );
  expect(state.claimed).toBe(true);
  expect(state.bestStars).toBe(3);
  expect(state.moveLog).toEqual([]);
  expect(JSON.parse(plan.entries[0].raw).gems).toBe(0);
});
it("rejects wrong owners and invalid progress", () => {
  expect(() => accountRestorePlan("DEF", remote())).toThrow();
  const r = remote();
  r.progress[0].bestStars = 4;
  expect(() => accountRestorePlan("ABC", r)).toThrow();
});
it("backs up legacy bytes and binds only the isolated restored copy", () => {
  const s = storage(),
    before = captureLegacyBackup(s);
  restoreAccountCopy(
    s,
    "ABC",
    before,
    accountRestorePlan("ABC", remote()).entries,
  );
  expect(captureLegacyBackup(s)).toEqual(before);
  expect(s.getItem("arowgo.economy.binding.v1")).toBe("ABC");
  expect(JSON.parse(s.getItem(ACCOUNT_RESTORE_BACKUP)!).legacy).toEqual(before);
  expect(s.getItem(ACCOUNT_RESTORE_JOURNAL)).toBeNull();
  expect(() => restoreAccountCopy(s, "ABC", before, [])).toThrow(
    "device-already-connected",
  );
});
it("rejects changed local saves before writing a backup", () => {
  const s = storage(),
    before = captureLegacyBackup(s);
  s.setItem("arowgo.profile.v1", "changed");
  expect(() => restoreAccountCopy(s, "ABC", before, [])).toThrow(
    "local-save-changed",
  );
  expect(s.getItem(ACCOUNT_RESTORE_BACKUP)).toBeNull();
});
it("retains a journal on disk failure and recovers before retry", () => {
  const s = storage(),
    before = captureLegacyBackup(s),
    set = s.setItem;
  const key = "arowgo.economy.ABC.save.arowgo.profile.v1";
  set(key, "old");
  s.setItem = (k, v) => {
    if (k.includes(".save.")) throw Error("disk");
    set(k, v);
  };
  expect(() =>
    restoreAccountCopy(
      s,
      "ABC",
      before,
      accountRestorePlan("ABC", remote()).entries,
    ),
  ).toThrow("disk");
  expect(s.getItem(ACCOUNT_RESTORE_JOURNAL)).not.toBeNull();
  s.setItem = set;
  recoverAccountRestore(s);
  expect(s.getItem(key)).toBe("old");
  expect(s.getItem("arowgo.economy.binding.v1")).toBeNull();
  expect(captureLegacyBackup(s)).toEqual(before);
  restoreAccountCopy(
    s,
    "ABC",
    before,
    accountRestorePlan("ABC", remote()).entries,
  );
  expect(s.getItem("arowgo.economy.binding.v1")).toBe("ABC");
});
it("never starts replacement when backup cannot be persisted", () => {
  const s = storage(),
    before = captureLegacyBackup(s);
  s.setItem = () => {
    throw Error("disk");
  };
  expect(() => restoreAccountCopy(s, "ABC", before, [])).toThrow();
  expect(captureLegacyBackup(s)).toEqual(before);
  expect(s.getItem(ACCOUNT_RESTORE_JOURNAL)).toBeNull();
});
