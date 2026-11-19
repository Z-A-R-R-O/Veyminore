export type BadgeStats = {
  completed: number;
  stars: number;
  perfect: number;
  bloom: number;
  cove: number;
  owned: number;
  styled: number;
};
type Metric = keyof BadgeStats;
export type Badge = {
  id: string;
  name: string;
  requirement: string;
  metric?: Metric;
  target: number;
  src: string;
};
const entries: [string, string, Metric | undefined, number][] = [
  ["First Bloom", "Clear your first level.", "completed", 1],
  ["Clear Path", "Clear 5 levels.", "completed", 5],
  ["Pathfinder", "Clear 10 levels.", "completed", 10],
  ["Rising Star", "Earn 10 campaign stars.", "stars", 10],
  ["Perfect Finish", "Earn 3 stars on a level.", "perfect", 1],
  ["Quick Thinker", "Finish a level within its speed target.", undefined, 1],
  ["Flawless Flow", "Earn 3 stars on 5 different levels.", "perfect", 5],
  ["Brilliant Mind", "Earn 3 stars on 10 different levels.", "perfect", 10],
  ["Chain Reaction", "Trigger a multi-arrow chain.", undefined, 1],
  ["Master Planner", "Earn 3 stars on 15 different levels.", "perfect", 15],
  ["Key Keeper", "Collect 10 keys.", undefined, 10],
  ["Lockbreaker", "Open 10 locks.", undefined, 10],
  ["Valley Explorer", "Clear 10 Bloom Valley levels.", "bloom", 10],
  ["Bloom Guardian", "Clear all 20 Bloom Valley levels.", "bloom", 20],
  ["Cove Voyager", "Clear your first Verdant Cove level.", "cove", 1],
  ["Pirate Captain", "Clear all 20 Verdant Cove levels.", "cove", 20],
  ["Horizon Seeker", "Clear 10 Verdant Cove levels.", "cove", 10],
  ["World Wanderer", "Clear all 40 launch campaign levels.", "completed", 40],
  ["Treasure Finder", "Open your first treasure chest.", undefined, 1],
  ["Arrow Collector", "Own 5 arrow skins.", "owned", 5],
  ["Style Maker", "Save a portrait with a decorative frame.", "styled", 1],
  ["Comeback", "Win a level after losing a heart.", undefined, 1],
  ["Steady Steps", "Clear 15 levels.", "completed", 15],
  ["Star Collector", "Earn 30 campaign stars.", "stars", 30],
  ["Puzzle Adept", "Clear 20 levels.", "completed", 20],
  ["Puzzle Expert", "Clear 30 levels.", "completed", 30],
  ["Puzzle Master", "Earn 3 stars on 20 different levels.", "perfect", 20],
  ["Grand Strategist", "Earn 3 stars on 30 different levels.", "perfect", 30],
  ["Mythic Mind", "Earn 100 campaign stars.", "stars", 100],
  ["Ethereal Legend", "Earn 120 campaign stars.", "stars", 120],
];
export const badges: Badge[] = entries.map(
  ([name, requirement, metric, target], i) => ({
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    requirement,
    metric,
    target,
    src: `/assets/badges/badge-${String(i + 1).padStart(2, "0")}.webp`,
  }),
);
export function badgeProgress(badge: Badge, stats: BadgeStats) {
  const current = badge.metric
    ? Math.min(badge.target, Math.max(0, stats[badge.metric]))
    : 0;
  return {
    current,
    earned: !!badge.metric && current >= badge.target,
    available: !!badge.metric,
  };
}
