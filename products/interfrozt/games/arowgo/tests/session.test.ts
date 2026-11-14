import { describe, expect, it } from "vitest";
import data from "../content/levels/bloom-01.json";
import { validateLevel } from "../src/domain/rules";
import {
  newSession,
  parseSession,
  resolve,
  stars,
  type Session,
} from "../src/application/session";
import { Controller } from "../src/application/controller";
import { SAVE_KEY, SaveStore, type Store } from "../src/storage/save";
const level = validateLevel(data);
const command = (s: Session, id: string, arrowId: string) => ({
  id,
  attemptId: s.attemptId,
  type: "select" as const,
  arrowId,
});
function complete(s: Session) {
  for (const id of level.solution)
    s = resolve(level, s, command(s, `move-${id}`, id)).state;
  return s;
}
class Memory implements Store {
  values = new Map<string, string>();
  fail = false;
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.fail) throw new Error("quota");
    this.values.set(k, v);
  }
}
describe("attempts, progression and persistence", () => {
  it("a blocked action preserves occupancy, costs one heart and deduplicates its command", () => {
    const start = newSession(level, "one"),
      cmd = command(start, "tap", "B");
    const after = resolve(level, start, cmd).state;
    expect(after.active).toEqual(start.active);
    expect(after.mistakes).toBe(1);
    expect(start.mistakes).toBe(0);
    expect(resolve(level, after, cmd).state).toBe(after);
  });
  it("fails at exactly three mistakes and ignores further input", () => {
    let s = newSession(level, "one");
    for (let i = 0; i < 3; i++)
      s = resolve(level, s, command(s, `${i}`, "B")).state;
    expect(s.status).toBe("failed");
    expect(resolve(level, s, command(s, "4", "A")).state).toBe(s);
  });
  it("practice tolerates more than three mistakes and never grants campaign rewards", () => {
    let s = newSession(level, "one", "practice");
    for (let i = 0; i < 5; i++)
      s = resolve(level, s, command(s, `${i}`, "B")).state;
    s = complete(s);
    expect(s.status).toBe("complete");
    expect(s.coins).toBe(0);
    expect(stars(s)).toBe(0);
    expect(s.bestStars).toBe(0);
  });
  it("completion grants one first-clear reward; repeated completion and replay do not farm coins", () => {
    const won = complete(newSession(level, "one"));
    expect(won.coins).toBe(25);
    expect(stars(won)).toBe(3);
    expect(resolve(level, won, command(won, "again", "J")).state).toBe(won);
    const replay = complete(newSession(level, "two", "story", won));
    expect(replay.coins).toBe(25);
    expect(replay.reward).toBe(0);
  });
  it("hints reveal a legal arrow without removing it and mark the result assisted", () => {
    const s = newSession(level, "one"),
      r = resolve(level, s, { id: "hint", attemptId: "one", type: "hint" });
    expect(r.hints).toEqual(["A"]);
    expect(r.state.active).toEqual(s.active);
    expect(stars(complete(r.state))).toBe(1);
  });
  it("restart rejects stale commands from the old attempt", () => {
    const s = newSession(level, "new");
    expect(
      resolve(level, s, {
        id: "old",
        attemptId: "old",
        type: "select",
        arrowId: "A",
      }).state,
    ).toBe(s);
  });
  it("cold reload restores the committed move, and completed reward survives reload exactly once", () => {
    const memory = new Memory(),
      saves = new SaveStore(memory, level);
    let id = 0;
    const controller = new Controller(level, saves, () => `id${++id}`);
    controller.select("A");
    const restored = new Controller(level, saves, () => `id${++id}`);
    expect(restored.state.active).not.toContain("A");
    for (const id of level.solution.slice(1)) restored.select(id);
    const after = new Controller(level, saves, () => `id${++id}`);
    expect(after.state.coins).toBe(25);
    expect(after.state.status).toBe("complete");
    after.restart();
    for (const id of level.solution) after.select(id);
    expect(after.state.coins).toBe(25);
  });
  it("a damaged primary recovers a valid previous checkpoint and reports rollback", () => {
    const memory = new Memory(),
      saves = new SaveStore(memory, level),
      s = newSession(level, "one");
    saves.save(s);
    saves.save(resolve(level, s, command(s, "a", "A")).state);
    memory.values.set(SAVE_KEY, "{broken");
    expect(saves.load().state).toEqual(s);
    expect(saves.load().notice).toContain("recovered");
  });
  it("corrupt or incompatible data is preserved until the next explicit action", () => {
    const memory = new Memory();
    memory.values.set(SAVE_KEY, '{"schemaVersion":9}');
    const loaded = new SaveStore(memory, level).load();
    expect(loaded.state).toBeUndefined();
    expect(loaded.notice).toContain("cannot be read");
    expect(memory.getItem(SAVE_KEY)).toBe('{"schemaVersion":9}');
  });
  it("failed writes leave the old snapshot intact and report memory-only play", () => {
    const memory = new Memory(),
      saves = new SaveStore(memory, level);
    let id = 0;
    const c = new Controller(level, saves, () => `${++id}`);
    c.select("A");
    const checkpoint = memory.getItem(SAVE_KEY);
    memory.fail = true;
    c.select("B");
    expect(c.notice).toContain("memory only");
    expect(memory.getItem(SAVE_KEY)).toBe(checkpoint);
    expect(new SaveStore(memory, level).load().state?.active).toContain("B");
  });
  it("rejects impossible occupancy, invalid currencies and inconsistent completion", () => {
    const start = newSession(level, "one");
    for (const bad of [
      { ...start, active: start.active.filter((id) => id !== "B") },
      { ...start, coins: 99 },
      { ...start, status: "complete" },
      { ...start, mistakes: -1 },
      { ...start, active: ["A", "A"] },
    ])
      expect(() => parseSession(JSON.stringify(bad), level)).toThrow();
  });
});
