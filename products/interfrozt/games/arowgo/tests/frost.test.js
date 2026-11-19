import { it, expect } from "vitest";
import { levels } from "../src/domain/campaign";
import { evaluatePlanning } from "../src/domain/planning";
import { newSession, resolve } from "../src/application/session";
import { packSnapshot, unpackSnapshot } from "../server/account/cloud.mjs";
it("Frostfall puzzles have distinct geometry and consequential planning choices", () => {
  const frost = levels.slice(40);
  const signatures = new Set();
  for (const level of frost) {
    signatures.add(JSON.stringify(level.arrows.map((a) => a.points)));
    const p = evaluatePlanning(level);
    expect(p.randomLegalWinRate).toBeGreaterThan(0.012);
    expect(p.randomLegalWinRate).toBeLessThan(0.14);
    expect(p.blockedTargetDecisions).toBeGreaterThan(0);
    expect(level.arrows.some((a) => a.requires)).toBe(true);
    expect(level.arrows.some((a) => a.anchorRequires)).toBe(true);
  }
  expect(signatures.size).toBe(20);
}, 30000);
it("all sixty completed saves with recovery copies fit cloud storage and round-trip unchanged", () => {
  const entries = levels.flatMap((level, i) => {
    let state = newSession(level, `restore-${i}`);
    for (const id of level.solution)
      state = resolve(level, state, {
        id,
        attemptId: state.attemptId,
        type: "select",
        arrowId: id,
      }).state;
    const key =
      i === 0 ? "arowgo.slice.v1" : `arowgo.level.${level.levelId}.v1`;
    return [
      { key, raw: JSON.stringify(state) },
      { key: key + ".backup", raw: JSON.stringify(state) },
    ];
  });
  const snapshot = {
    schemaVersion: 1,
    gameId: "arowgo",
    trust: "unverified-local",
    entries,
  };
  const packed = packSnapshot(snapshot);
  expect(Buffer.byteLength(JSON.stringify(packed))).toBeLessThanOrEqual(8000);
  expect(unpackSnapshot(packed).entries).toEqual(
    [...entries].sort((a, b) => a.key.localeCompare(b.key)),
  );
});
