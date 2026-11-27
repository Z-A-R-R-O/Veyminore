import { beforeAstralHardeningLevels } from "../domain/campaignBeforeAstralHardening";
import { beforeDensityLevels } from "../domain/campaignBeforeDensity";
import { beforeHardeningLevels } from "../domain/campaignBeforeHardening";
import { beforeTimingLevels } from "../domain/campaignBeforeTiming";
import type { Level } from "../domain/rules";
import { levels } from "../domain/campaign";
import { parseSession } from "../application/session";
import { readProfile } from "../storage/profile";
import { validateBackup } from "./cloud-local";
import type { LegacyBackup } from "./legacy-backup";
function compatibleSession(raw: string, level: Level) {
  try {
    return parseSession(raw, level);
  } catch (error) {
    for (const old of [
      ...beforeAstralHardeningLevels,
      ...beforeDensityLevels,
      ...beforeHardeningLevels,
      ...beforeTimingLevels,
    ].filter((l) => l.levelId === level.levelId)) {
      try {
        return parseSession(raw, old);
      } catch {}
    }
    throw error;
  }
}
/** Never let a corrupt or incompatible primary save silently fall back to a new game. */
export function validatePlayableRestore(snapshot: LegacyBackup) {
  const clean = validateBackup(snapshot);
  for (const { key, raw } of clean.entries) {
    if (key === "arowgo.profile.v1") {
      const value = JSON.parse(raw),
        parsed = readProfile(raw);
      if (
        !value ||
        value.version !== 2 ||
        Object.entries(parsed).some(
          ([k, v]) => JSON.stringify(value[k]) !== JSON.stringify(v),
        )
      )
        throw Error("incompatible-profile-save");
    }
    if (
      key === "arowgo.slice.v1" ||
      /^arowgo\.level\.[a-z0-9-]+\.v1$/.test(key)
    ) {
      const level =
        key === "arowgo.slice.v1"
          ? levels[0]
          : levels.find((l) => key === `arowgo.level.${l.levelId}.v1`);
      if (!level) throw Error("incompatible-level-save");
      compatibleSession(raw, level);
    }
  }
  return clean;
}

export function describeSave(snapshot: LegacyBackup): string {
  try {
    const clean = validatePlayableRestore(snapshot);
    const profileEntry = clean.entries.find(
      (e) => e.key === "arowgo.profile.v1",
    );
    const profile = readProfile(profileEntry?.raw ?? null);
    let coins = 0,
      stars = 0,
      cleared = 0;
    for (const { key, raw } of clean.entries) {
      const level =
        key === "arowgo.slice.v1"
          ? levels[0]
          : levels.find((l) => key === `arowgo.level.${l.levelId}.v1`);
      if (level) {
        const state = compatibleSession(raw, level);
        coins += state.coins;
        stars += state.bestStars;
        if (state.bestStars > 0) cleared++;
      }
    }
    return `${cleared} levels cleared · ${stars} stars · ${Math.max(0, coins - profile.spent)} coins · ${profile.gems} gems`;
  } catch {
    return "Older or unreadable save — retained for recovery; cannot restore automatically.";
  }
}
