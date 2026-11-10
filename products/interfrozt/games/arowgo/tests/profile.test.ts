import { expect, it } from "vitest";
import {
  guest,
  readProfile,
  buySkin,
  spentCoins,
} from "../src/storage/profile";
it("defaults to guest and rejects invalid profile ownership", () => {
  expect(readProfile(null)).toEqual(guest());
  expect(readProfile("{")).toEqual(guest());
  expect(
    readProfile(JSON.stringify({ ...guest(), equipped: "aurora" })),
  ).toEqual(guest());
});
it("purchases once, equips, and never allows an unaffordable purchase", () => {
  const p = guest();
  expect(buySkin(p, "aurora", 24)).toBe(p);
  const owned = buySkin(p, "aurora", 25);
  expect(owned.equipped).toBe("aurora");
  expect(spentCoins(owned)).toBe(25);
  expect(buySkin(owned, "aurora", 125)).toBe(owned);
  expect(buySkin(owned, "blossom", 50)).toBe(owned);
  expect(readProfile(JSON.stringify(owned))).toEqual(owned);
});
