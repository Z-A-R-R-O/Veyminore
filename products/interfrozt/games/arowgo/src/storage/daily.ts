import { generatePuzzle } from "../domain/generator";
import { type Level } from "../domain/rules";
import { levels } from "../domain/campaign";

export const DAILY_STORAGE_KEY = "arowgo.daily.v1";
export const DAILY_REWARD_COINS = 50;
export const DAILY_REWARD_GEMS = 5;

export interface DailyProgress {
  lastCompletedDate: string | null;
  currentStreak: number;
  maxStreak: number;
  completedDates: string[];
}

export function defaultDailyProgress(): DailyProgress {
  return {
    lastCompletedDate: null,
    currentStreak: 0,
    maxStreak: 0,
    completedDates: [],
  };
}

/** Formats a date to YYYY-MM-DD in local time */
export function getTodayDateString(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Pretty formats date for UI, e.g. "Nov 21, 2026" */
export function formatDailyDate(dateStr: string): string {
  try {
    const parts = dateStr.split("-").map(Number);
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  } catch {}
  return dateStr;
}

/** Deterministic 32-bit unsigned integer hash from string */
export function dateToSeed(dateStr: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Computes whole calendar days between two YYYY-MM-DD dates (d2 - d1) */
export function dayDifference(d1Str: string, d2Str: string): number {
  const [y1, m1, day1] = d1Str.split("-").map(Number);
  const [y2, m2, day2] = d2Str.split("-").map(Number);
  const date1 = new Date(y1, m1 - 1, day1);
  const date2 = new Date(y2, m2 - 1, day2);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((date2.getTime() - date1.getTime()) / msPerDay);
}

/** In-memory cache for generated daily levels */
const dailyLevelCache = new Map<string, Level>();

/** Generates a balanced, solvable daily puzzle for the given date */
export function getDailyLevel(dateStr = getTodayDateString()): Level {
  const cached = dailyLevelCache.get(dateStr);
  if (cached) return cached;

  const baseSeed = dateToSeed(dateStr);
  // Arrow count 10..12, balanced targetScore ~50
  const arrowCount = 10 + (baseSeed % 3);
  const targetScore = 50 + (baseSeed % 10);

  // Deterministically try salted seeds if a specific seed exhausts generation budget
  for (let attempt = 0; attempt < 50; attempt++) {
    const currentSeed = (baseSeed + attempt * 1013904223) >>> 0;
    try {
      const level = generatePuzzle(
        currentSeed,
        arrowCount,
        targetScore,
        `daily-${dateStr}`,
      );
      dailyLevelCache.set(dateStr, level);
      return level;
    } catch {
      // Advance to next deterministic salt if candidate budget exhausted
    }
  }

  // Safe fallback to campaign level 5 if all 50 generation attempts fail
  const fallback = { ...levels[4], levelId: `daily-${dateStr}` };
  dailyLevelCache.set(dateStr, fallback);
  return fallback;
}

/** Reads and validates stored daily progress */
export function readDailyProgress(raw: string | null): DailyProgress {
  if (!raw) return defaultDailyProgress();
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return defaultDailyProgress();
    const currentStreak =
      typeof data.currentStreak === "number" && data.currentStreak >= 0
        ? Math.floor(data.currentStreak)
        : 0;
    const maxStreak =
      typeof data.maxStreak === "number" && data.maxStreak >= 0
        ? Math.floor(data.maxStreak)
        : currentStreak;
    const lastCompletedDate =
      typeof data.lastCompletedDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(data.lastCompletedDate)
        ? data.lastCompletedDate
        : null;
    const completedDates = Array.isArray(data.completedDates)
      ? data.completedDates.filter(
          (d: unknown) =>
            typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
        )
      : [];

    return {
      lastCompletedDate,
      currentStreak,
      maxStreak: Math.max(maxStreak, currentStreak),
      completedDates,
    };
  } catch {
    return defaultDailyProgress();
  }
}

/**
 * Records completion of today's daily puzzle and advances the streak.
 */
export function recordDailyCompletion(
  prev: DailyProgress,
  todayStr = getTodayDateString(),
): {
  progress: DailyProgress;
  isFirstClearToday: boolean;
  coinsEarned: number;
  gemsEarned: number;
} {
  // If already completed today, streak remains unchanged, no duplicate first-clear rewards
  if (
    prev.completedDates.includes(todayStr) ||
    (prev.lastCompletedDate !== null &&
      dayDifference(prev.lastCompletedDate, todayStr) <= 0)
  ) {
    return {
      progress: prev,
      isFirstClearToday: false,
      coinsEarned: 0,
      gemsEarned: 0,
    };
  }

  let nextStreak = 1;
  if (prev.lastCompletedDate) {
    const diff = dayDifference(prev.lastCompletedDate, todayStr);
    if (diff === 1) {
      // Completed yesterday: increment streak!
      nextStreak = prev.currentStreak + 1;
    } else if (diff <= 0) {
      // Clock anomaly or same day
      nextStreak = prev.currentStreak;
    } else {
      // Missed one or more days: reset streak to 1
      nextStreak = 1;
    }
  }

  const nextMax = Math.max(prev.maxStreak, nextStreak);
  const nextCompleted = prev.completedDates.includes(todayStr)
    ? prev.completedDates
    : [...prev.completedDates, todayStr];

  return {
    progress: {
      lastCompletedDate: todayStr,
      currentStreak: nextStreak,
      maxStreak: nextMax,
      completedDates: nextCompleted,
    },
    isFirstClearToday: true,
    coinsEarned: DAILY_REWARD_COINS,
    gemsEarned: DAILY_REWARD_GEMS,
  };
}
