import { expect, it } from "vitest";
import {
  guest,
  readProfile,
  claimGemGift,
  buyTimeBoost,
  openCrate,
} from "../src/storage/profile";
import { Controller } from "../src/application/controller";
import { SaveStore } from "../src/storage/save";
import { levels } from "../src/domain/campaign";
it("migrates old profiles and claims the gem gift once", () => {
  const old = { ...guest() } as Partial<ReturnType<typeof guest>>;
  delete old.gems;
  delete old.gemGiftClaimed;
  delete old.timeBoosts;
  const p = readProfile(JSON.stringify(old));
  expect(p.gems).toBe(0);
  const gift = claimGemGift(p);
  expect(gift.gems).toBe(20);
  expect(claimGemGift(gift)).toBe(gift);
  expect(readProfile(JSON.stringify(gift))).toEqual(gift);
});
it("gem chests spend and refund gems independently of coins", () => {
  const p = claimGemGift(guest());
  const one = openCrate(p, "celestial", 0, 0, 0, false, "gems");
  expect(one.gems).toBe(16);
  expect(one.spent).toBe(0);
  const two = openCrate(one, "celestial", 0, 0, 0, false, "gems");
  expect(two.gems).toBe(14);
  expect(two.lastReward).toMatchObject({ currency: "gems", refund: 2 });
  expect(readProfile(JSON.stringify(two))).toEqual(two);
  const empty = guest();
  expect(openCrate(empty, "bloom", 0, 0, 0, false, "gems")).toBe(empty);
});
it("time boost receipt is charged once and application survives reload", () => {
  const data = new Map<string, string>();
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  const c = new Controller(
    levels[0],
    new SaveStore(store, levels[0]),
    () => "attempt",
  );
  const p = buyTimeBoost(claimGemGift(guest()), c.state.attemptId);
  expect(p.gems).toBe(17);
  expect(buyTimeBoost(p, c.state.attemptId)).toBe(p);
  const before = c.state.targetMs!;
  c.applyTimeBoost();
  c.applyTimeBoost();
  expect(c.state.targetMs).toBe(before + 30000);
  const restored = new Controller(levels[0], new SaveStore(store, levels[0]));
  expect(restored.state.timeBoost).toBe(true);
  expect(restored.state.targetMs).toBe(before + 30000);
  restored.restart();
  expect(restored.state.timeBoost).toBeUndefined();
  expect(restored.state.targetMs).toBe(before);
});
