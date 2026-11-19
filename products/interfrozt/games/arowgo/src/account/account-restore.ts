import { levels } from "../domain/campaign";
import { newSession, parseSession } from "../application/session";
import { guest, skins, type SkinId } from "../storage/profile";
export function accountRestorePlan(accountId: string, value: unknown) {
  const v = value as {
    accountId: string;
    wallet: { coins: number; gems: number; revision: number };
    migration: { backupHash: string };
    cleared: string[];
    progress: Array<{ levelId: string; bestStars: number }>;
    inventory: SkinId[];
    claims: string[];
    preference: { equipped: SkinId; revision: number };
  };
  const int = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
  if (
    !v ||
    v.accountId !== accountId ||
    !v.wallet ||
    ![v.wallet.coins, v.wallet.gems, v.wallet.revision].every(int) ||
    !v.migration ||
    !/^[a-f0-9]{64}$/i.test(v.migration.backupHash) ||
    !Array.isArray(v.cleared) ||
    !Array.isArray(v.progress) ||
    !Array.isArray(v.inventory) ||
    !Array.isArray(v.claims) ||
    !v.preference ||
    !int(v.preference.revision)
  )
    throw Error("invalid-account-progress");
  if (
    new Set(v.cleared).size !== v.cleared.length ||
    v.cleared.some((id) => !levels.some((l) => l.levelId === id)) ||
    new Set(v.progress.map((p) => p?.levelId)).size !== v.progress.length ||
    v.progress.length !== v.cleared.length ||
    v.progress.some(
      (p) =>
        !p ||
        !v.cleared.includes(p.levelId) ||
        !Number.isInteger(p.bestStars) ||
        p.bestStars < 1 ||
        p.bestStars > 3,
    ) ||
    !v.inventory.includes("classic") ||
    new Set(v.inventory).size !== v.inventory.length ||
    v.inventory.some((id) => !skins.some((s) => s.id === id)) ||
    !v.inventory.includes(v.preference.equipped)
  )
    throw Error("invalid-account-progress");
  const profile = {
    ...guest(),
    owned: v.inventory,
    equipped: v.preference.equipped,
    gemGiftClaimed: v.claims.includes("gem-gift"),
    welcomeClaimed: v.claims.includes("welcome-chest"),
  };
  const entries = [
    { key: "arowgo.profile.v1", raw: JSON.stringify(profile) },
    ...levels.map((level, i) => {
      const state = newSession(level, crypto.randomUUID());
      const progress = v.progress.find((p) => p.levelId === level.levelId);
      if (progress) {
        state.claimed = true;
        state.bestStars = progress.bestStars;
        state.coins = 25;
      }
      // Fresh boards carry completion metadata, not an invented successful attempt.
      const raw = JSON.stringify(state);
      parseSession(raw, level);
      return {
        key: i === 0 ? "arowgo.slice.v1" : `arowgo.level.${level.levelId}.v1`,
        raw,
      };
    }),
  ];
  return {
    entries,
    revision: v.wallet.revision,
    coins: v.wallet.coins,
    gems: v.wallet.gems,
    completed: v.cleared.length,
    stars: v.progress.reduce((s, p) => s + p.bestStars, 0),
    equipped: v.preference.equipped,
  };
}
