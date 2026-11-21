export const avatarBackgrounds = [
  {
    id: "background-01",
    name: "Lilac Pearl",
    src: "/assets/avatars/backgrounds/background-01.webp",
  },
  {
    id: "background-02",
    name: "Ocean Teal",
    src: "/assets/avatars/backgrounds/background-02.webp",
  },
  {
    id: "background-03",
    name: "Crystal Ice",
    src: "/assets/avatars/backgrounds/background-03.webp",
  },
  {
    id: "background-04",
    name: "Golden Sand",
    src: "/assets/avatars/backgrounds/background-04.webp",
  },
  {
    id: "background-05",
    name: "Cosmic Night",
    src: "/assets/avatars/backgrounds/background-05.webp",
  },
  {
    id: "background-06",
    name: "Ivory Pearl",
    src: "/assets/avatars/backgrounds/background-06.webp",
  },
  {
    id: "background-07",
    name: "Bloom Petals",
    src: "/assets/avatars/backgrounds/background-07.webp",
  },
  {
    id: "background-08",
    name: "Pirate Compass",
    src: "/assets/avatars/backgrounds/background-08.webp",
  },
  {
    id: "background-09",
    name: "Winter Frost",
    src: "/assets/avatars/backgrounds/background-09.webp",
  },
  {
    id: "background-10",
    name: "Desert Dunes",
    src: "/assets/avatars/backgrounds/background-10.webp",
  },
  {
    id: "background-11",
    name: "Starlight",
    src: "/assets/avatars/backgrounds/background-11.webp",
  },
  {
    id: "background-12",
    name: "Pastel Aurora",
    src: "/assets/avatars/backgrounds/background-12.webp",
  },
] as const;
export type AvatarBackground =
  | "none"
  | (typeof avatarBackgrounds)[number]["id"];
export const readAvatarBackground = (value: unknown): AvatarBackground =>
  avatarBackgrounds.some((b) => b.id === value)
    ? (value as AvatarBackground)
    : "none";
