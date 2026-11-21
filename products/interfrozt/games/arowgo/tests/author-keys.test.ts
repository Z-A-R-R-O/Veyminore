import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { generatePuzzle } from "../src/domain/generator";
it("authors gradual campaign key levels only on explicit request", () => {
  if (process.env.AROWGO_KEYS !== "1") return;
  for (const [number, count, target] of [
    [11, 10, 80],
    [14, 12, 100],
    [17, 14, 115],
    [19, 16, 125],
    [20, 18, 145],
  ]) {
    const level = generatePuzzle(
      31000 + number * 193,
      count,
      target,
      `bloom-${number}`,
      { keyLockPairs: 1 },
    );
    writeFileSync(
      `content/levels/bloom-${number}.json`,
      JSON.stringify({ ...level, contentVersion: 5 }, null, 2) + "\n",
    );
  }
}, 120000);
