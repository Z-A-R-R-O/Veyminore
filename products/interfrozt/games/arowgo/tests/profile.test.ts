import { expect, it } from "vitest";
import {
  guest,
  readProfile,
  spentCoins,
  openCrate,
  rollSkin,
  crates,
  skins,
} from "../src/storage/profile";
it("defaults to guest and rejects malformed ownership and ledgers", () => {
  expect(readProfile(null)).toEqual(guest());
  expect(readProfile("{")).toEqual(guest());
  for (const change of [
    { equipped: "aurora" },
    { spent: -1 },
    { spent: Infinity },
    { openings: 0.5 },
    { lastReward: { skin: "unknown" } },
    { owned: ["classic", "classic"] },
  ])
    expect(readProfile(JSON.stringify({ ...guest(), ...change }))).toEqual(
      guest(),
    );
});
it("migrates legacy purchases without charging newly unlocked arrows", () => {
  const p = readProfile(
    JSON.stringify({
      version: 1,
      name: "Zarro",
      avatar: "trophy",
      owned: ["classic", "aurora", "blossom"],
      equipped: "aurora",
    }),
  );
  expect(p.version).toBe(2);
  expect(spentCoins(p)).toBe(60);
  expect(p.owned).toContain("blossom");
  expect(p.equipped).toBe("aurora");
  const opened = openCrate(p, "bloom", 125, 0.999, 0);
  expect(opened.owned).toContain("eclipse");
  expect(spentCoins(opened)).toBe(70);
  expect(readProfile(JSON.stringify(opened))).toEqual(opened);
});
it("enforces affordability, one free gift, and exact duplicate refunds", () => {
  const p = guest();
  expect(openCrate(p, "bloom", 9, 0, 0)).toBe(p);
  expect(openCrate(p, "aurora", 0, 0, 0, true)).toBe(p);
  const free = openCrate(p, "bloom", 0, 0, 0, true);
  expect(free.owned).toContain("mint");
  expect(free.spent).toBe(0);
  expect(free.openings).toBe(1);
  expect(openCrate(free, "bloom", 100, 0, 0, true)).toBe(free);
  const duplicate = openCrate(free, "bloom", 10, 0, 0);
  expect(duplicate.spent).toBe(5);
  expect(duplicate.lastReward).toMatchObject({ duplicate: true, refund: 5 });
  expect(duplicate.owned).toEqual(free.owned);
  expect(openCrate(duplicate, "bloom", 10, 0, 0)).toBe(duplicate);
  expect(free.equipped).toBe("classic");
});
it("all crates use published rarity boundaries and every collectible is reachable", () => {
  expect(skins).toHaveLength(15);
  for (const c of crates) {
    expect(c.odds.reduce((sum, n) => sum + n, 0)).toBe(100);
    let boundary = 0;
    const expected = ["common", "rare", "epic", "legendary", "mythic"];
    const reached = new Set<string>();
    for (let i = 0; i < 5; i++) {
      for (const item of [0, 0.4, 0.8, 0.999]) {
        const id = rollSkin(c.id, (boundary + 0.01) / 100, item);
        reached.add(id);
        expect(skins.find((s) => s.id === id)!.rarity).toBe(expected[i]);
      }
      boundary += c.odds[i];
    }
    expect(reached.size).toBe(14);
    expect(reached.has("classic")).toBe(false);
  }
  expect(() => rollSkin("bloom", 1, 0)).toThrow();
  expect(() => rollSkin("bloom", 0, -1)).toThrow();
});
