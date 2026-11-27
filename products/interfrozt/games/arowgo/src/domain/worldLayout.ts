/** Zero-based indices. Existing worlds retain their original boundaries. */
export const worldNames = [
  "Bloom Valley",
  "Verdant Cove",
  "Frostfall Peaks",
  "Amber Dunes",
  "Amber Sanctum",
  "Clockwork Citadel",
  "Astral Observatory",
];
export const worldStart = (world: number) =>
  world < 5 ? world * 20 : 100 + (world - 5) * 40;
export const worldSize = (world: number) => (world < 5 ? 20 : 40);
export const worldForLevel = (index: number) =>
  index < 100 ? Math.floor(index / 20) : 5 + Math.floor((index - 100) / 40);
