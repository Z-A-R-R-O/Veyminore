import { validateBackup } from "./cloud-local";
import type { LegacyBackup } from "./legacy-backup";
import { guest, readProfile } from "../storage/profile";
export async function backupHash(snapshot: LegacyBackup) {
  const clean = validateBackup(snapshot);
  const ordered = {
    ...clean,
    entries: [...clean.entries].sort((a, b) => a.key.localeCompare(b.key)),
  };
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(ordered)),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function migrationPacket(
  accountId: string,
  snapshot: LegacyBackup,
) {
  if (!/^[a-f0-9]{1,64}$/i.test(accountId)) throw Error("Invalid account");
  const backup = validateBackup(snapshot);
  const raw = backup.entries.find((e) => e.key === "arowgo.profile.v1")?.raw;
  const profile = raw ? readProfile(raw) : guest();
  if (raw) {
    const p = JSON.parse(raw);
    if (
      p.version !== 2 ||
      Object.entries(profile).some(
        ([k, v]) =>
          JSON.stringify(
            k in p
              ? p[k]
              : ["gems", "timeBoosts", "gemGiftClaimed"].includes(k)
                ? guest()[k as keyof typeof profile]
                : undefined,
          ) !== JSON.stringify(v),
      )
    )
      throw Error("Profile needs recovery before migration.");
  }
  let earned = 0;
  const cleared: string[] = [];
  for (const entry of backup.entries) {
    if (
      entry.key !== "arowgo.slice.v1" &&
      !/^arowgo\.level\.[a-z0-9-]+\.v1$/.test(entry.key)
    )
      continue;
    const save = JSON.parse(entry.raw);
    if (
      typeof save.levelId !== "string" ||
      typeof save.claimed !== "boolean" ||
      save.coins !== (save.claimed ? 25 : 0) ||
      !Number.isInteger(save.bestStars) ||
      save.bestStars < 0 ||
      save.bestStars > 3 ||
      save.claimed !== save.bestStars > 0
    )
      throw Error("A level save needs recovery before migration.");
    if (save.claimed) {
      if (cleared.includes(save.levelId)) throw Error("Duplicate level save");
      cleared.push(save.levelId);
      earned += 25;
    }
  }
  if (profile.spent > earned)
    throw Error(
      "Spending exceeds verified local reward records. Review the recovery backup first.",
    );
  return {
    manifest: {
      accountId,
      approvalId: crypto.randomUUID(),
      backupHash: await backupHash(backup),
      coins: earned - profile.spent,
      gems: profile.gems,
      cleared,
      owned: profile.owned,
      gemGiftClaimed: profile.gemGiftClaimed,
      welcomeClaimed: profile.welcomeClaimed,
    },
    backup,
  };
}
/** Marker is written last. Partial copies cannot switch the running game to account storage. */
export function activateAccountCopy(
  storage: Pick<Storage, "getItem" | "setItem">,
  accountId: string,
  snapshot: LegacyBackup,
) {
  if (!/^[a-f0-9]{1,64}$/i.test(accountId)) throw Error("Invalid account");
  const existing = storage.getItem("arowgo.economy.binding.v1");
  if (existing && existing !== accountId)
    throw Error("Another account is bound to this device.");
  if (existing === accountId) return;
  storage.setItem(
    `arowgo.economy.${accountId}.recovery`,
    JSON.stringify(snapshot),
  );
  for (const e of snapshot.entries)
    storage.setItem(`arowgo.economy.${accountId}.save.${e.key}`, e.raw);
  storage.setItem("arowgo.economy.binding.v1", accountId);
}
