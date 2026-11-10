export const PROFILE_KEY = "arowgo.profile.v1";
export const skins = [
  { id: "classic", name: "Classic", price: 0, color: "#422563" },
  { id: "aurora", name: "Aurora", price: 25, color: "#167a91" },
  { id: "blossom", name: "Blossom", price: 35, color: "#a52f76" },
  { id: "sunbeam", name: "Sunbeam", price: 50, color: "#936114" },
] as const;
export type SkinId = (typeof skins)[number]["id"];
export type Avatar = "world" | "modes" | "trophy";
export interface Profile {
  version: 1;
  name: string;
  avatar: Avatar;
  owned: SkinId[];
  equipped: SkinId;
}
export const guest = (): Profile => ({
  version: 1,
  name: "Guest",
  avatar: "world",
  owned: ["classic"],
  equipped: "classic",
});
export function readProfile(raw: string | null): Profile {
  try {
    const p = JSON.parse(raw ?? "null") as Profile;
    if (
      !p ||
      p.version !== 1 ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 20 ||
      !["world", "modes", "trophy"].includes(p.avatar) ||
      !Array.isArray(p.owned) ||
      !p.owned.includes("classic") ||
      new Set(p.owned).size !== p.owned.length ||
      p.owned.some((id) => !skins.some((s) => s.id === id)) ||
      !p.owned.includes(p.equipped)
    )
      return guest();
    return p;
  } catch {
    return guest();
  }
}
export const spentCoins = (p: Profile) =>
  skins
    .filter((s) => p.owned.includes(s.id))
    .reduce((sum, s) => sum + s.price, 0);
export function buySkin(p: Profile, id: SkinId, earned: number): Profile {
  const skin = skins.find((s) => s.id === id);
  if (!skin || p.owned.includes(id) || earned - spentCoins(p) < skin.price)
    return p;
  return { ...p, owned: [...p.owned, id], equipped: id };
}
