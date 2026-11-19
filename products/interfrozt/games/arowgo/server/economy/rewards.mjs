import { readFileSync } from "node:fs";
import {
  validateLevel,
  checkExit,
  expiredKeg,
  solve,
} from "../../src/domain/rules.ts";
const paths = [
  ...Array.from(
    { length: 20 },
    (_, i) => `bloom-${String(i + 1).padStart(2, "0")}.json`,
  ),
  ...Array.from({ length: 20 }, (_, i) => `cove/level-${i + 21}.json`),
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
/** Server-owned content; neither balances nor a client's completion flag are accepted. */
export function verifyClear(levelId, contentVersion, moves, details = false) {
  const level = rewardLevels.find((l) => l.levelId === levelId);
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
      (expiredKeg(level, active) ||
        (level.arrows.some((a) => a.deadline !== undefined) &&
          !solve(level, active)))
    )
      throw Error("invalid-completion");
  }
  if (active.length) throw Error("incomplete-level");
  return details ? { mistakes } : true;
}
