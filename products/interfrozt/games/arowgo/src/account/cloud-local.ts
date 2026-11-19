import { captureLegacyBackup, type LegacyBackup } from "./legacy-backup";
export const SAVE_LOCK = "arowgo-save-access-v1";
export const JOURNAL_KEY = "arowgo.cloud.restore-journal.v1";
export const RECOVERY_KEY = "arowgo.cloud.recovery.v1";
type StorageLike = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;
export function validateBackup(value: unknown): LegacyBackup {
  const v = value as LegacyBackup;
  if (
    !v ||
    v.schemaVersion !== 1 ||
    v.gameId !== "arowgo" ||
    v.trust !== "unverified-local" ||
    !Array.isArray(v.entries) ||
    v.entries.length > 500
  )
    throw Error("invalid-save");
  const map = new Map<string, string>();
  for (const entry of v.entries) {
    if (
      !entry ||
      typeof entry.key !== "string" ||
      typeof entry.raw !== "string" ||
      map.has(entry.key)
    )
      throw Error("invalid-save");
    map.set(entry.key, entry.raw);
  }
  const keys = [...map.keys()];
  const clean = captureLegacyBackup({
    length: keys.length,
    key: (i) => keys[i] ?? null,
    getItem: (key) => map.get(key) ?? null,
  });
  if (
    clean.entries.length !== keys.length ||
    new TextEncoder().encode(JSON.stringify(clean)).length > 512 * 1024
  )
    throw Error("invalid-save");
  return clean;
}
export function sameBackup(a: LegacyBackup, b: LegacyBackup) {
  return (
    JSON.stringify(validateBackup(a)) === JSON.stringify(validateBackup(b))
  );
}
function replace(storage: StorageLike, target: LegacyBackup) {
  const desired = new Map(target.entries.map((e) => [e.key, e.raw]));
  for (const { key } of captureLegacyBackup(storage).entries)
    if (!desired.has(key)) storage.removeItem(key);
  for (const { key, raw } of target.entries) storage.setItem(key, raw);
  if (!sameBackup(captureLegacyBackup(storage), target))
    throw Error("restore-verification-failed");
}
/** Caller holds the exclusive Web Lock. Recovery is completed before loading game modules. */
export function recoverInterruptedRestore(storage: StorageLike) {
  const raw = storage.getItem(JOURNAL_KEY);
  if (!raw) return;
  const journal = JSON.parse(raw);
  if (journal.schemaVersion !== 1) throw Error("invalid-recovery-journal");
  replace(storage, validateBackup(journal.before));
  storage.removeItem(JOURNAL_KEY);
}
export function restoreBackup(
  storage: StorageLike,
  expected: LegacyBackup,
  target: LegacyBackup,
  accountId: string,
) {
  const clean = validateBackup(target),
    before = captureLegacyBackup(storage);
  if (!sameBackup(before, expected)) throw Error("local-save-changed");
  // Both copies must be durably readable before touching any gameplay key.
  const journal = JSON.stringify({ schemaVersion: 1, accountId, before });
  storage.setItem(RECOVERY_KEY, journal);
  if (storage.getItem(RECOVERY_KEY) !== journal) throw Error("backup-failed");
  storage.setItem(JOURNAL_KEY, journal);
  if (storage.getItem(JOURNAL_KEY) !== journal) throw Error("backup-failed");
  try {
    replace(storage, clean);
    storage.removeItem(JOURNAL_KEY);
  } catch (error) {
    recoverInterruptedRestore(storage);
    throw error;
  }
}
