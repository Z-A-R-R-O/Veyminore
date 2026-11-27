import { readFileSync } from "node:fs";
import {
  validateLevel,
  checkExit,
  expiredKeg,
  solve,
  hasTiming,
} from "../../src/domain/rules.ts";
const paths = [
  ...Array.from(
    { length: 20 },
    (_, i) => `bloom-${String(i + 1).padStart(2, "0")}.json`,
  ),
  ...Array.from({ length: 20 }, (_, i) => `cove/level-${i + 21}.json`),
  ...Array.from({ length: 20 }, (_, i) => `frost/level-${i + 41}.json`),
  ...Array.from({ length: 20 }, (_, i) => `amber/level-${i + 61}.json`),
  ...Array.from({ length: 20 }, (_, i) => `sanctum/level-${i + 81}.json`),
  ...Array.from({ length: 40 }, (_, i) => `clockwork/level-${i + 101}.json`),
  ...Array.from({ length: 40 }, (_, i) => `astral/level-${i + 141}.json`),
];
export const rewardLevels = paths.map((path) =>
  validateLevel(
    JSON.parse(
      readFileSync(
        new URL(`../../content/levels/${path}`, import.meta.url),
        "utf8",
      ),
    ),
  ),
);
const archivedFrost = JSON.parse(
  readFileSync(
    new URL("../../content/levels/frost-before-timing.json", import.meta.url),
    "utf8",
  ),
).map(validateLevel);
const archivedHardening = JSON.parse(
  readFileSync(
    new URL("../../content/levels/before-hardening.json", import.meta.url),
    "utf8",
  ),
).map(validateLevel);
const archivedDensity = JSON.parse(
  readFileSync(
    new URL("../../content/levels/before-density.json", import.meta.url),
    "utf8",
  ),
).map(validateLevel);
const archivedAstral = JSON.parse(
  readFileSync(
    new URL(
      "../../content/levels/astral-before-hardening.json",
      import.meta.url,
    ),
    "utf8",
  ),
).map(validateLevel);
/** Server-owned content; neither balances nor a client's completion flag are accepted. */
export function verifyClear(levelId, contentVersion, moves, details = false) {
  const level = [
    ...rewardLevels,
    ...archivedAstral,
    ...archivedDensity,
    ...archivedFrost,
    ...archivedHardening,
  ].find((l) => l.levelId === levelId && l.contentVersion === contentVersion);
  if (
    !level ||
    level.contentVersion !== contentVersion ||
    !Array.isArray(moves) ||
    moves.length > level.arrows.length + 2
  )
    throw Error("invalid-completion");
  let active = level.arrows.map((a) => a.id),
    mistakes = 0;
  for (const move of moves) {
    const id = typeof move === "string" ? move : move?.arrowId;
    const erase = typeof move === "object" && move?.type === "erase";
    if (typeof move !== "string" && !["select", "erase"].includes(move?.type))
      throw Error("invalid-completion");
    if (typeof id !== "string" || !active.includes(id))
      throw Error("invalid-completion");

    if (!erase && !checkExit(level, active, id).clear) {
      if (++mistakes >= 3) throw Error("invalid-completion");
      continue;
    }
    active = active.filter((a) => a !== id);
    if (
      active.length &&
      (expiredKeg(level, active) || (hasTiming(level) && !solve(level, active)))
    )
      throw Error("invalid-completion");
  }
  if (active.length) throw Error("incomplete-level");
  return details ? { mistakes } : true;
}
