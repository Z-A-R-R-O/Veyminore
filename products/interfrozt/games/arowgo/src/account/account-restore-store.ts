import { captureLegacyBackup, type LegacyBackup } from "./legacy-backup";
import { sameBackup } from "./cloud-local";
export const ACCOUNT_RESTORE_JOURNAL = "arowgo.economy.restore-journal.v1";
export const ACCOUNT_RESTORE_BACKUP = "arowgo.economy.restore-recovery.v1";
const BINDING = "arowgo.economy.binding.v1";
type Store = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;
type Entry = { key: string; raw: string };
function namespace(account: string) {
  if (!/^[A-F0-9]{1,64}$/i.test(account)) throw Error("invalid-account");
  return `arowgo.economy.${account}.save.`;
}
function read(store: Store, prefix: string): Entry[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  return keys.sort().map((key) => {
    const raw = store.getItem(key);
    if (raw === null) throw Error("local-save-changed");
    return { key, raw };
  });
}
function replace(store: Store, prefix: string, target: Entry[]) {
  for (const e of read(store, prefix)) store.removeItem(e.key);
  for (const e of target) store.setItem(e.key, e.raw);
  if (
    JSON.stringify(read(store, prefix)) !==
    JSON.stringify(
      [...target].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    )
  )
    throw Error("restore-verification-failed");
}
/** Called with the exclusive save lock, before loading game modules. */
export function recoverAccountRestore(store: Store) {
  const raw = store.getItem(ACCOUNT_RESTORE_JOURNAL);
  if (!raw) return;
  const j = JSON.parse(raw),
    prefix = namespace(j.accountId);
  if (
    j.version !== 1 ||
    !Array.isArray(j.before) ||
    j.before.length > 1000 ||
    j.before.some(
      (e: Entry) =>
        typeof e?.key !== "string" ||
        !e.key.startsWith(prefix) ||
        typeof e.raw !== "string",
    ) ||
    new Set(j.before.map((e: Entry) => e.key)).size !== j.before.length
  )
    throw Error("invalid-account-recovery");
  const bound = store.getItem(BINDING);
  if (bound && bound !== j.accountId) throw Error("account-changed");
  replace(store, prefix, j.before);
  store.removeItem(BINDING);
  store.removeItem(ACCOUNT_RESTORE_JOURNAL);
}
/** New-device activation only. Existing bound account saves are never overwritten. */
export function restoreAccountCopy(
  store: Store,
  accountId: string,
  expected: LegacyBackup,
  target: Entry[],
) {
  if (store.getItem(ACCOUNT_RESTORE_JOURNAL)) throw Error("recovery-required");
  if (store.getItem(BINDING)) throw Error("device-already-connected");
  const prefix = namespace(accountId);
  if (
    target.some(
      (e) =>
        !/^arowgo\.(profile\.v1|slice\.v1|level\.[a-z0-9-]+\.v1)$/.test(
          e.key,
        ) || typeof e.raw !== "string",
    ) ||
    new Set(target.map((e) => e.key)).size !== target.length
  )
    throw Error("invalid-restore");
  const legacy = captureLegacyBackup(store);
  if (!sameBackup(legacy, expected)) throw Error("local-save-changed");
  const before = read(store, prefix),
    journal = JSON.stringify({ version: 1, accountId, before });
  const recovery = JSON.stringify({ version: 1, accountId, legacy, before });
  store.setItem(ACCOUNT_RESTORE_BACKUP, recovery);
  if (store.getItem(ACCOUNT_RESTORE_BACKUP) !== recovery)
    throw Error("backup-failed");
  store.setItem(ACCOUNT_RESTORE_JOURNAL, journal);
  if (store.getItem(ACCOUNT_RESTORE_JOURNAL) !== journal)
    throw Error("backup-failed");
  try {
    replace(
      store,
      prefix,
      target.map((e) => ({ key: prefix + e.key, raw: e.raw })),
    );
    if (!sameBackup(captureLegacyBackup(store), legacy))
      throw Error("local-save-changed");
    store.setItem(BINDING, accountId);
    if (store.getItem(BINDING) !== accountId) throw Error("binding-failed");
    store.removeItem(ACCOUNT_RESTORE_JOURNAL);
  } catch (error) {
    recoverAccountRestore(store);
    throw error;
  }
}
