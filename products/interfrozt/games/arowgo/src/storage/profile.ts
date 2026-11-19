import {
  readAvatarBackground,
  type AvatarBackground,
} from "./avatar-backgrounds";
import { isAvatar, type Avatar } from "./avatars";
export type { Avatar } from "./avatars";
export const PROFILE_KEY = "arowgo.profile.v1";
export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";
export const skins = [
  {
    id: "classic",
    name: "Classic",
    color: "#422563",
    rarity: "common",
    effect: "none",
    description: "The original clear path",
  },
  {
    id: "mint",
    name: "Mint",
    color: "#27755c",
    rarity: "common",
    effect: "flow",
    description: "Soft flowing highlights",
  },
  {
    id: "coral",
    name: "Coral",
    color: "#b34258",
    rarity: "common",
    effect: "flow",
    description: "Warm ribbon of light",
  },
  {
    id: "slate",
    name: "Moonstone",
    color: "#566482",
    rarity: "common",
    effect: "flow",
    description: "Silver current",
  },
  {
    id: "aurora",
    name: "Aurora",
    color: "#167a91",
    rarity: "rare",
    effect: "glow",
    description: "An icy luminous edge",
  },
  {
    id: "blossom",
    name: "Blossom",
    color: "#a52f76",
    rarity: "rare",
    effect: "glow",
    description: "Rose light along every bend",
  },
  {
    id: "glacier",
    name: "Glacier",
    color: "#315db3",
    rarity: "rare",
    effect: "glow",
    description: "A cool blue aura",
  },
  {
    id: "sunbeam",
    name: "Sunbeam",
    color: "#936114",
    rarity: "epic",
    effect: "spark",
    description: "Golden sparks in motion",
  },
  {
    id: "nebula",
    name: "Nebula",
    color: "#7131ad",
    rarity: "epic",
    effect: "spark",
    description: "Starlight racing along the path",
  },
  {
    id: "volt",
    name: "Volt",
    color: "#576b13",
    rarity: "epic",
    effect: "spark",
    description: "Quick electric pulses",
  },
  {
    id: "phoenix",
    name: "Phoenix",
    color: "#b74821",
    rarity: "legendary",
    effect: "pulse",
    description: "A breathing ember glow",
  },
  {
    id: "starlight",
    name: "Starlight",
    color: "#875699",
    rarity: "legendary",
    effect: "pulse",
    description: "A luminous violet heartbeat",
  },
  {
    id: "tide",
    name: "Celestial Tide",
    color: "#146d79",
    rarity: "legendary",
    effect: "pulse",
    description: "Rolling ocean light",
  },
  {
    id: "eclipse",
    name: "Eclipse",
    color: "#542283",
    rarity: "mythic",
    effect: "prism",
    description: "An iridescent cosmic current",
  },
  {
    id: "prism",
    name: "Prism",
    color: "#8544ae",
    rarity: "mythic",
    effect: "prism",
    description: "Shifting spectral highlights",
  },
] as const;
export type SkinId = (typeof skins)[number]["id"];
export type Skin = (typeof skins)[number];

export const rarities: Rarity[] = [
  "common",
  "rare",
  "epic",
  "legendary",
  "mythic",
];
export const crates = [
  {
    id: "bloom",
    name: "Bloom Crate",
    price: 10,
    odds: [60, 25, 10, 4, 1],
    tag: "A little discovery",
  },
  {
    id: "aurora",
    name: "Aurora Crate",
    price: 20,
    odds: [30, 40, 20, 8, 2],
    tag: "A brighter possibility",
  },
  {
    id: "celestial",
    name: "Celestial Crate",
    price: 35,
    odds: [10, 30, 35, 20, 5],
    tag: "Reach for the stars",
  },
] as const;
export type CrateId = (typeof crates)[number]["id"];
export interface Reward {
  currency?: "coins" | "gems";
  skin: SkinId;
  duplicate: boolean;
  refund: number;
  crate: CrateId;
}
export interface Profile {
  gems: number;
  gemGiftClaimed: boolean;
  timeBoosts: string[];
  version: 2;
  name: string;
  avatar: Avatar;
  avatarBackground: AvatarBackground;
  owned: SkinId[];
  equipped: SkinId;
  spent: number;
  openings: number;
  welcomeClaimed: boolean;
  lastReward: Reward | null;
}
export const guest = (): Profile => ({
  gems: 0,
  gemGiftClaimed: false,
  timeBoosts: [],
  version: 2,
  name: "Guest",
  avatar: "world",
  avatarBackground: "none",
  owned: ["classic"],
  equipped: "classic",
  spent: 0,
  openings: 0,
  welcomeClaimed: false,
  lastReward: null,
});
const legacyPrices: Record<string, number> = {
  classic: 0,
  aurora: 25,
  blossom: 35,
  sunbeam: 50,
};
export function readProfile(raw: string | null): Profile {
  try {
    const p = JSON.parse(raw ?? "null");
    if (
      !p ||
      ![1, 2].includes(p.version) ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 20 ||
      !isAvatar(p.avatar) ||
      !Array.isArray(p.owned) ||
      !p.owned.includes("classic") ||
      new Set(p.owned).size !== p.owned.length ||
      p.owned.some((id: string) => !skins.some((s) => s.id === id)) ||
      !p.owned.includes(p.equipped)
    )
      return guest();
    if (p.version === 1) {
      if (p.owned.some((id: string) => !(id in legacyPrices))) return guest();
      return {
        ...guest(),
        name: p.name,
        avatar: p.avatar,
        avatarBackground: readAvatarBackground(p.avatarBackground),
        owned: p.owned,
        equipped: p.equipped,
        spent: p.owned.reduce(
          (sum: number, id: string) => sum + legacyPrices[id],
          0,
        ),
      };
    }
    if (
      !Number.isSafeInteger(p.spent) ||
      p.spent < 0 ||
      !Number.isSafeInteger(p.openings) ||
      p.openings < 0 ||
      typeof p.welcomeClaimed !== "boolean"
    )
      return guest();
    const r = p.lastReward;
    const gems = p.gems ?? 0,
      gemGiftClaimed = p.gemGiftClaimed ?? false,
      timeBoosts = p.timeBoosts ?? [];
    if (
      !Number.isSafeInteger(gems) ||
      gems < 0 ||
      typeof gemGiftClaimed !== "boolean" ||
      !Array.isArray(timeBoosts) ||
      timeBoosts.some((id: unknown) => typeof id !== "string" || !id) ||
      new Set(timeBoosts).size !== timeBoosts.length
    )
      return guest();
    if (
      r !== null &&
      (!r ||
        (r.currency !== undefined && !["coins", "gems"].includes(r.currency)) ||
        !p.owned.includes(r.skin) ||
        !crates.some((c) => c.id === r.crate) ||
        typeof r.duplicate !== "boolean" ||
        !Number.isSafeInteger(r.refund) ||
        r.refund < 0 ||
        r.refund > 17)
    )
      return guest();
    return {
      gems,
      gemGiftClaimed,
      timeBoosts,
      version: 2,
      name: p.name,
      avatar: p.avatar,
      avatarBackground: readAvatarBackground(p.avatarBackground),
      owned: p.owned,
      equipped: p.equipped,
      spent: p.spent,
      openings: p.openings,
      welcomeClaimed: p.welcomeClaimed,
      lastReward: r,
    };
  } catch {
    return guest();
  }
}
export const spentCoins = (p: Profile) => p.spent;
export const gemPrices: Record<CrateId, number> = {
  bloom: 1,
  aurora: 2,
  celestial: 4,
};
export const TIME_BOOST_COST = 3;
export function claimGemGift(p: Profile): Profile {
  return p.gemGiftClaimed
    ? p
    : { ...p, gems: p.gems + 20, gemGiftClaimed: true };
}
export function buyTimeBoost(p: Profile, attemptId: string): Profile {
  if (
    !attemptId ||
    p.gems < TIME_BOOST_COST ||
    p.timeBoosts.includes(attemptId)
  )
    return p;
  return {
    ...p,
    gems: p.gems - TIME_BOOST_COST,
    timeBoosts: [...p.timeBoosts, attemptId],
  };
}
/** Select rarity first, then an equally likely item in that rarity. Classic never drops. */
export function rollSkin(
  crateId: CrateId,
  rarityRoll: number,
  itemRoll: number,
): SkinId {
  const crate = crates.find((c) => c.id === crateId);
  if (
    !crate ||
    ![rarityRoll, itemRoll].every((n) => Number.isFinite(n) && n >= 0 && n < 1)
  )
    throw new Error("Invalid crate roll");
  let threshold = 0;
  const rarity = rarities.find((_, i) => {
    threshold += crate.odds[i];
    return rarityRoll * 100 < threshold;
  })!;
  const pool = skins.filter((s) => s.id !== "classic" && s.rarity === rarity);
  return pool[Math.floor(itemRoll * pool.length)].id;
}
/** One atomic saved update: payment and reward precede the cosmetic animation. */
export function openCrate(
  p: Profile,
  id: CrateId,
  earned: number,
  roll: number,
  itemRoll: number,
  welcome = false,
  currency: "coins" | "gems" = "coins",
): Profile {
  const crate = crates.find((c) => c.id === id);
  if (
    !crate ||
    (welcome && (p.welcomeClaimed || id !== "bloom")) ||
    (!welcome &&
      (currency === "gems"
        ? p.gems < gemPrices[id]
        : earned - p.spent < crate.price))
  )
    return p;
  const skin = rollSkin(id, roll, itemRoll),
    duplicate = p.owned.includes(skin);
  const cost = welcome ? 0 : currency === "gems" ? gemPrices[id] : crate.price,
    refund = duplicate ? Math.floor(cost / 2) : 0;
  return {
    ...p,
    spent: p.spent + (currency === "coins" ? cost - refund : 0),
    gems: p.gems - (currency === "gems" ? cost - refund : 0),
    openings: p.openings + 1,
    welcomeClaimed: p.welcomeClaimed || welcome,
    owned: duplicate ? p.owned : [...p.owned, skin],
    lastReward: { skin, duplicate, refund, crate: id, currency },
  };
}
export function randomUnit(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}
