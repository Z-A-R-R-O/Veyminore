import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { generatePuzzle, evaluateDifficulty } from "../src/domain/generator";
import { validateLevel } from "../src/domain/rules";
it("authors snake campaign only when requested", () => {
  if (process.env.AROWGO_SNAKE !== "1") return;
  for (let n = 1; n <= 20; n++) {
    const path = `content/levels/bloom-${String(n).padStart(2, "0")}.json`;
    const old = JSON.parse(
      readFileSync(
        `content/levels/archive-before-snake/bloom-${String(n).padStart(2, "0")}.json`,
        "utf8",
      ),
    );
    let level;
    if (n <= 5)
      level = validateLevel({ ...old, rulesVersion: 2, contentVersion: 5 });
    else {
      for (let retry = 0; retry < 12; retry++) {
        try {
          level = generatePuzzle(
            51000 + n * 193 + retry * 7919,
            old.arrows.length,
            40 + n * 3,
            old.levelId,
            { keyLockPairs: [11, 14, 17, 19, 20].includes(n) ? 1 : 0 },
          );
          break;
        } catch {}
      }
      if (!level) throw new Error(`No candidate for ${n}`);
    }
    writeFileSync(path, JSON.stringify(level, null, 2) + "\n");
    console.log(n, evaluateDifficulty(level).score);
  }
  const batch = [6, 7, 8, 9, 10]
    .map((n) =>
      JSON.parse(
        readFileSync(
          `content/levels/bloom-${String(n).padStart(2, "0")}.json`,
          "utf8",
        ),
      ),
    )
    .sort(
      (a, b) => a.generation.difficulty.score - b.generation.difficulty.score,
    );
  batch.forEach((level, i) => {
    const levelId = `bloom-${String(i + 6).padStart(2, "0")}`;
    writeFileSync(
      `content/levels/${levelId}.json`,
      JSON.stringify({ ...level, levelId }, null, 2) + "\n",
    );
  });
}, 180000);
