import { describe, it, expect } from "vitest";
import { badges, badgeProgress, type BadgeStats } from "../src/storage/badges";
const empty: BadgeStats = {
  completed: 0,
  stars: 0,
  perfect: 0,
  bloom: 0,
  cove: 0,
  owned: 1,
  styled: 0,
};
describe("achievement badges", () => {
  it("has thirty unique assets and no automatic awards for a new player", () => {
    expect(badges).toHaveLength(30);
    expect(new Set(badges.map((b) => b.src)).size).toBe(30);
    expect(badges.some((b) => badgeProgress(b, empty).earned)).toBe(false);
  });
  it("unlocks at exact thresholds and keeps unsupported events pending", () => {
    for (const b of badges) {
      if (b.metric) {
        expect(
          badgeProgress(b, { ...empty, [b.metric]: b.target - 1 }).earned,
        ).toBe(false);
        expect(
          badgeProgress(b, { ...empty, [b.metric]: b.target }).earned,
        ).toBe(true);
      } else
        expect(
          badgeProgress(b, {
            completed: 40,
            stars: 120,
            perfect: 40,
            bloom: 20,
            cove: 20,
            owned: 20,
            styled: 1,
          }),
        ).toEqual({ current: 0, earned: false, available: false });
    }
  });
  it("does not award world achievements for progress in a different world", () => {
    const b = badges.find((b) => b.id === "pirate-captain")!;
    expect(
      badgeProgress(b, { ...empty, bloom: 20, completed: 20 }).earned,
    ).toBe(false);
    expect(badgeProgress(b, { ...empty, cove: 20, completed: 20 }).earned).toBe(
      true,
    );
  });
});
