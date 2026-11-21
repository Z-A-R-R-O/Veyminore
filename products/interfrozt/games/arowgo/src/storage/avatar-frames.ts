export const avatarFrames = [
  {
    id: "frame-01",
    name: "Ruby Laurel",
    src: "/assets/avatars/frames/frame-01.webp",
  },
  {
    id: "frame-02",
    name: "Sapphire Ice",
    src: "/assets/avatars/frames/frame-02.webp",
  },
  {
    id: "frame-03",
    name: "Moon Magic",
    src: "/assets/avatars/frames/frame-03.webp",
  },
  {
    id: "frame-04",
    name: "Ocean Shell",
    src: "/assets/avatars/frames/frame-04.webp",
  },
  {
    id: "frame-05",
    name: "Pirate Captain",
    src: "/assets/avatars/frames/frame-05.webp",
  },
  {
    id: "frame-06",
    name: "Royal Crown",
    src: "/assets/avatars/frames/frame-06.webp",
  },
  {
    id: "frame-07",
    name: "Frozen Crystal",
    src: "/assets/avatars/frames/frame-07.webp",
  },
  {
    id: "frame-08",
    name: "Forest Wreath",
    src: "/assets/avatars/frames/frame-08.webp",
  },
  {
    id: "frame-09",
    name: "Molten Ember",
    src: "/assets/avatars/frames/frame-09.webp",
  },
  {
    id: "frame-10",
    name: "Angel Wings",
    src: "/assets/avatars/frames/frame-10.webp",
  },
  {
    id: "frame-11",
    name: "Clockwork",
    src: "/assets/avatars/frames/frame-11.webp",
  },
  {
    id: "frame-12",
    name: "Cosmic Orbit",
    src: "/assets/avatars/frames/frame-12.webp",
  },
  {
    id: "frame-13",
    name: "Tidal Wave",
    src: "/assets/avatars/frames/frame-13.webp",
  },
  {
    id: "frame-14",
    name: "Cherry Blossom",
    src: "/assets/avatars/frames/frame-14.webp",
  },
  {
    id: "frame-15",
    name: "Sunburst",
    src: "/assets/avatars/frames/frame-15.webp",
  },
  {
    id: "frame-16",
    name: "Dragon Guard",
    src: "/assets/avatars/frames/frame-16.webp",
  },
  {
    id: "frame-17",
    name: "Emerald Ruins",
    src: "/assets/avatars/frames/frame-17.webp",
  },
  {
    id: "frame-18",
    name: "Arctic Wolf",
    src: "/assets/avatars/frames/frame-18.webp",
  },
  {
    id: "frame-19",
    name: "Dream Clouds",
    src: "/assets/avatars/frames/frame-19.webp",
  },
  {
    id: "frame-20",
    name: "Silver Shield",
    src: "/assets/avatars/frames/frame-20.webp",
  },
  {
    id: "frame-21",
    name: "Verdant Vines",
    src: "/assets/avatars/frames/frame-21.webp",
  },
  {
    id: "frame-22",
    name: "Amethyst",
    src: "/assets/avatars/frames/frame-22.webp",
  },
  {
    id: "frame-23",
    name: "Phoenix Flame",
    src: "/assets/avatars/frames/frame-23.webp",
  },
  {
    id: "frame-24",
    name: "Pearl Shell",
    src: "/assets/avatars/frames/frame-24.webp",
  },
  {
    id: "frame-25",
    name: "Rose Heart",
    src: "/assets/avatars/frames/frame-25.webp",
  },
  {
    id: "frame-26",
    name: "Ancient Gold",
    src: "/assets/avatars/frames/frame-26.webp",
  },
  {
    id: "frame-27",
    name: "Galaxy Swirl",
    src: "/assets/avatars/frames/frame-27.webp",
  },
  {
    id: "frame-28",
    name: "Snowfall",
    src: "/assets/avatars/frames/frame-28.webp",
  },
  {
    id: "frame-29",
    name: "Desert Wrap",
    src: "/assets/avatars/frames/frame-29.webp",
  },
  {
    id: "frame-30",
    name: "Shadow Crystal",
    src: "/assets/avatars/frames/frame-30.webp",
  },
] as const;
export type AvatarFrame = "none" | (typeof avatarFrames)[number]["id"];
export const readAvatarFrame = (value: unknown): AvatarFrame =>
  avatarFrames.some((f) => f.id === value) ? (value as AvatarFrame) : "none";
