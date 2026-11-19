import { describe, it, expect } from "vitest";
import { captureLegacyBackup } from "../src/account/legacy-backup";
import {
  restoreBackup,
  recoverInterruptedRestore,
  validateBackup,
  JOURNAL_KEY,
  RECOVERY_KEY,
} from "../src/account/cloud-local";
function store(initial: Record<string, string>) {
  const values = { ...initial };
  let writes = 0;
  let failAt = -1;
  return {
    get length() {
      return Object.keys(values).length;
    },
    key: (i: number) => Object.keys(values)[i] ?? null,
    getItem: (k: string) => values[k] ?? null,
    setItem(k: string, v: string) {
      if (++writes === failAt) throw Error("quota");
      values[k] = v;
    },
    removeItem(k: string) {
      delete values[k];
    },
    failNext(n: number) {
      failAt = writes + n;
    },
  };
}
const original = {
  "arowgo.profile.v1": '{"gems":19,"spent":35,"owned":["classic","mint"]}',
  "arowgo.slice.v1": '{"bestStars":3,"coins":410}',
  unrelated: "untouched",
};
const other = captureLegacyBackup(
  store({
    "arowgo.profile.v1": '{"gems":5,"spent":80}',
    "arowgo.slice.v1": '{"bestStars":2,"coins":200}',
  }),
);
describe("cloud restore safety", () => {
  it("replaces the whole snapshot without adding balances and retains original bytes", () => {
    const s = store(original),
      before = captureLegacyBackup(s);
    restoreBackup(s, before, other, "ABC");
    expect(captureLegacyBackup(s)).toEqual(other);
    expect(s.getItem("unrelated")).toBe("untouched");
    expect(JSON.parse(s.getItem(RECOVERY_KEY)!).before).toEqual(before);
    expect(s.getItem(JOURNAL_KEY)).toBeNull();
  });
  it.each([1, 2, 3, 4])(
    "survives failure at write %i without losing original currency",
    (n) => {
      const s = store(original),
        before = captureLegacyBackup(s);
      s.failNext(n);
      expect(() => restoreBackup(s, before, other, "ABC")).toThrow();
      expect(captureLegacyBackup(s)).toEqual(before);
    },
  );
  it("recovers an interrupted multi-key restore before game startup", () => {
    const s = store(original),
      before = captureLegacyBackup(s);
    s.setItem(JOURNAL_KEY, JSON.stringify({ schemaVersion: 1, before }));
    s.setItem("arowgo.profile.v1", "partial");
    recoverInterruptedRestore(s);
    expect(captureLegacyBackup(s)).toEqual(before);
    expect(s.getItem(JOURNAL_KEY)).toBeNull();
  });
  it("rejects local changes since preview", () => {
    const s = store(original),
      before = captureLegacyBackup(s);
    s.setItem("arowgo.slice.v1", "newer");
    expect(() => restoreBackup(s, before, other, "ABC")).toThrow(
      "local-save-changed",
    );
    expect(s.getItem("arowgo.slice.v1")).toBe("newer");
  });
  it("rejects unknown keys, duplicate keys and wrong schema", () => {
    for (const bad of [
      { ...other, schemaVersion: 2 },
      { ...other, entries: [{ key: "auth.token", raw: "secret" }] },
      { ...other, entries: [other.entries[0], other.entries[0]] },
    ])
      expect(() => validateBackup(bad)).toThrow();
  });
  it("fails closed on damaged recovery journal", () => {
    const s = store(original);
    s.setItem(JOURNAL_KEY, "damaged");
    expect(() => recoverInterruptedRestore(s)).toThrow();
    expect(s.getItem("arowgo.profile.v1")).toBe(original["arowgo.profile.v1"]);
  });
});
