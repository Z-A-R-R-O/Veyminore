import { it, expect } from "vitest";
import { guest } from "../src/storage/profile";
import { levels, levelNames } from "../src/domain/campaign";
import { evaluatePlanning } from "../src/domain/planning";
import { evaluateLayout, evaluateDifficulty } from "../src/domain/generator";
import { solve, checkExit } from "../src/domain/rules";
import { newSession, resolve, parseSession } from "../src/application/session";
import { validatePlayableRestore } from "../src/account/cloud-restore";
import { beforeDensityLevels } from "../src/domain/campaignBeforeDensity";
// @ts-expect-error Server ESM integration.
import { verifyClear } from "../server/economy/rewards.mjs";
// @ts-expect-error Server ESM integration.
import { packSnapshot, unpackSnapshot } from "../server/account/cloud.mjs";

it("Sanctum has twenty unique dense puzzles with a verified harder planning curve", () => {
  expect(levelNames.slice(0, 100)).toHaveLength(100);
  const signatures = new Set(
    levels
      .slice(0, 80)
      .map((l) => JSON.stringify(l.arrows.map((a) => a.points))),
  );
  let previous = evaluatePlanning(levels[79]).randomLegalWinRate;
  for (const [i, l] of levels.slice(80, 100).entries()) {
    expect(l.levelId).toBe(`sanctum-${81 + i}`);
    const signature = JSON.stringify(l.arrows.map((a) => a.points));
    expect(signatures.has(signature)).toBe(false);
    signatures.add(signature);
    expect(l.arrows).toHaveLength(28);
    expect(evaluateLayout(l).occupiedCells).toBeGreaterThanOrEqual(80);
    expect(evaluateDifficulty(l).depth).toBeGreaterThanOrEqual(9);
    const p = evaluatePlanning(l);
    expect(p.randomLegalWinRate).toBeGreaterThan(0);
    expect(p.randomLegalWinRate).toBeLessThan(previous);
    previous = p.randomLegalWinRate;
    expect(p.blockedTargetDecisions).toBeGreaterThan(0);
    expect(l.arrows.filter((a) => a.deadline !== undefined)).toHaveLength(
      i < 10 ? 2 : 3,
    );
    const d = p.exampleDecision!;
    expect(checkExit(l, d.active, d.unsafeMove).clear).toBe(true);
    expect(
      solve(
        l,
        d.active.filter((id) => id !== d.unsafeMove),
      ),
    ).toBeNull();
    expect(
      solve(
        l,
        d.active.filter((id) => id !== d.safeMove),
      ),
    ).not.toBeNull();
    let state = newSession(l, "sanctum-proof");
    for (const id of l.solution) {
      state = resolve(l, state, {
        id,
        attemptId: state.attemptId,
        type: "select",
        arrowId: id,
      }).state;
      expect(parseSession(JSON.stringify(state), l)).toEqual(state);
    }
    expect(state.status).toBe("complete");
    expect(state.coins).toBe(25);
    expect(verifyClear(l.levelId, l.contentVersion, l.solution)).toBe(true);
    expect(() =>
      verifyClear(l.levelId, l.contentVersion, l.solution.slice(1)),
    ).toThrow();
    let replay = newSession(l, "replay", "story", state);
    for (const id of l.solution)
      replay = resolve(l, replay, {
        id,
        attemptId: replay.attemptId,
        type: "select",
        arrowId: id,
      }).state;
    expect(replay.coins).toBe(25);
    expect(replay.reward).toBe(0);
  }
}, 120000);

it("restores 100 completed saves and recovery copies without losing earlier history", () => {
  const entries: { key: string; raw: string }[] = [];
  for (const [i, l] of levels.slice(0, 100).entries()) {
    let state = newSession(l, `restore-${i}`);
    let previous = state;
    for (const id of l.solution) {
      previous = state;
      state = resolve(l, state, {
        id,
        attemptId: state.attemptId,
        type: "select",
        arrowId: id,
      }).state;
    }
    const key = i === 0 ? "arowgo.slice.v1" : `arowgo.level.${l.levelId}.v1`;
    entries.push(
      { key, raw: JSON.stringify(state) },
      { key: key + ".backup", raw: JSON.stringify(previous) },
    );
  }
  for (const l of beforeDensityLevels) {
    const state = newSession(l, "archived-attempt");
    entries.push({
      key: `arowgo.level.${l.levelId}.v1.content-${l.contentVersion}`,
      raw: JSON.stringify(state),
    });
  }
  entries.push({
    key: "arowgo.profile.v1",
    raw: JSON.stringify({ ...guest(), gems: 19, spent: 125 }),
  });
  const snapshot = {
    schemaVersion: 1 as const,
    gameId: "arowgo" as const,
    trust: "unverified-local" as const,
    entries,
  };
  const before = JSON.stringify(snapshot);
  const restored = validatePlayableRestore(JSON.parse(before));
  // Cloud capacity resolved: 100-level histories with recovery copies fit and unpack losslessly.
  const packed = packSnapshot(snapshot);
  expect(typeof packed.data).toBe("string");
  const unpacked = unpackSnapshot(packed);
  expect(unpacked.entries).toEqual(restored.entries);
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(restored.entries).toEqual(
    [...entries].sort((a, b) => a.key.localeCompare(b.key)),
  );
}, 120000);
