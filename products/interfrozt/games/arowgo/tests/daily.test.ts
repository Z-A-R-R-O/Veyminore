import { describe, expect, it } from "vitest";
import {
  dateToSeed,
  dayDifference,
  defaultDailyProgress,
  formatDailyDate,
  getDailyLevel,
  getTodayDateString,
  readDailyProgress,
  recordDailyCompletion,
  DAILY_REWARD_COINS,
  DAILY_REWARD_GEMS,
} from "../src/storage/daily";
import { solve } from "../src/domain/rules";

describe("daily challenge & streak system", () => {
  it("generates deterministic seeds and format strings", () => {
    const seed1 = dateToSeed("2026-11-21");
    const seed2 = dateToSeed("2026-11-21");
    const seed3 = dateToSeed("2026-11-22");

    expect(seed1).toBe(seed2);
    expect(seed1).not.toBe(seed3);
    expect(seed1).toBeGreaterThan(0);

    expect(formatDailyDate("2026-11-21")).toBe("Nov 21, 2026");
    expect(getTodayDateString(new Date(2026, 10, 21))).toBe("2026-11-21");
  });

  it("calculates exact calendar day differences", () => {
    expect(dayDifference("2026-11-20", "2026-11-21")).toBe(1);
    expect(dayDifference("2026-11-19", "2026-11-21")).toBe(2);
    expect(dayDifference("2026-11-21", "2026-11-21")).toBe(0);
    expect(dayDifference("2026-11-22", "2026-11-21")).toBe(-1);
  });

  it("generates a solvable daily level deterministically", () => {
    const level1 = getDailyLevel("2026-11-21");
    const level2 = getDailyLevel("2026-11-21");

    expect(level1).toBe(level2); // Memoized instance
    expect(level1.levelId).toBe("daily-2026-11-21");
    expect(level1.arrows.length).toBeGreaterThanOrEqual(10);
    expect(level1.arrows.length).toBeLessThanOrEqual(13);

    const solution = solve(level1);
    expect(solution).toBeTruthy();
    expect(solution?.length).toBe(level1.arrows.length);

    // Specifically test 2026-11-28
    const todayLevel = getDailyLevel("2026-11-28");
    expect(todayLevel).toBeDefined();
    expect(solve(todayLevel)).toBeTruthy();
  });

  it("handles empty and malformed daily progress gracefully", () => {
    expect(readDailyProgress(null)).toEqual(defaultDailyProgress());
    expect(readDailyProgress("invalid json")).toEqual(defaultDailyProgress());
    expect(readDailyProgress("{}")).toEqual(defaultDailyProgress());

    const valid = {
      lastCompletedDate: "2026-11-20",
      currentStreak: 3,
      maxStreak: 5,
      completedDates: ["2026-11-18", "2026-11-19", "2026-11-20"],
    };
    expect(readDailyProgress(JSON.stringify(valid))).toEqual(valid);
  });

  it("tracks streak progression and awards daily first-clear prizes", () => {
    const initial = defaultDailyProgress();

    // 1. First day completion -> streak 1
    const day1 = recordDailyCompletion(initial, "2026-11-20");
    expect(day1.isFirstClearToday).toBe(true);
    expect(day1.coinsEarned).toBe(DAILY_REWARD_COINS);
    expect(day1.gemsEarned).toBe(DAILY_REWARD_GEMS);
    expect(day1.progress.currentStreak).toBe(1);
    expect(day1.progress.maxStreak).toBe(1);
    expect(day1.progress.lastCompletedDate).toBe("2026-11-20");

    // 2. Replay on same day -> no additional streak or duplicate coins
    const sameDay = recordDailyCompletion(day1.progress, "2026-11-20");
    expect(sameDay.isFirstClearToday).toBe(false);
    expect(sameDay.coinsEarned).toBe(0);
    expect(sameDay.gemsEarned).toBe(0);
    expect(sameDay.progress.currentStreak).toBe(1);

    // 3. Consecutive day (yesterday -> today) -> streak 2
    const day2 = recordDailyCompletion(day1.progress, "2026-11-21");
    expect(day2.isFirstClearToday).toBe(true);
    expect(day2.progress.currentStreak).toBe(2);
    expect(day2.progress.maxStreak).toBe(2);

    // 4. Broken streak (missed day: 2026-11-21 -> 2026-11-23) -> streak resets to 1, maxStreak preserved
    const broken = recordDailyCompletion(day2.progress, "2026-11-23");
    expect(broken.isFirstClearToday).toBe(true);
    expect(broken.progress.currentStreak).toBe(1);
    expect(broken.progress.maxStreak).toBe(2);
    expect(broken.progress.completedDates).toContain("2026-11-23");
  });
});
