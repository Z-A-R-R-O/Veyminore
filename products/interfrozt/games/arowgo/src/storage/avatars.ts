export const adventureAvatars = [
  {
    id: "adventure-01",
    name: "Fox Explorer",
    src: "/assets/avatars/adventure-01.webp",
  },
  {
    id: "adventure-02",
    name: "Happy Bear",
    src: "/assets/avatars/adventure-02.webp",
  },
  {
    id: "adventure-03",
    name: "Rabbit Pilot",
    src: "/assets/avatars/adventure-03.webp",
  },
  {
    id: "adventure-04",
    name: "Wise Owl",
    src: "/assets/avatars/adventure-04.webp",
  },
  {
    id: "adventure-05",
    name: "Raccoon Scout",
    src: "/assets/avatars/adventure-05.webp",
  },
  {
    id: "adventure-06",
    name: "Adventure Cat",
    src: "/assets/avatars/adventure-06.webp",
  },
  {
    id: "adventure-07",
    name: "Pirate Captain",
    src: "/assets/avatars/adventure-07.webp",
  },
  {
    id: "adventure-08",
    name: "Cheerful Parrot",
    src: "/assets/avatars/adventure-08.webp",
  },
  {
    id: "adventure-09",
    name: "Sailor Otter",
    src: "/assets/avatars/adventure-09.webp",
  },
  {
    id: "adventure-10",
    name: "Sea Dragon",
    src: "/assets/avatars/adventure-10.webp",
  },
  {
    id: "adventure-11",
    name: "Pirate Rabbit",
    src: "/assets/avatars/adventure-11.webp",
  },
  {
    id: "adventure-12",
    name: "Shark Captain",
    src: "/assets/avatars/adventure-12.webp",
  },
  {
    id: "adventure-13",
    name: "Moon Wizard",
    src: "/assets/avatars/adventure-13.webp",
  },
  {
    id: "adventure-14",
    name: "Lavender Ghost",
    src: "/assets/avatars/adventure-14.webp",
  },
  {
    id: "adventure-15",
    name: "Crystal Golem",
    src: "/assets/avatars/adventure-15.webp",
  },
  {
    id: "adventure-16",
    name: "Baby Phoenix",
    src: "/assets/avatars/adventure-16.webp",
  },
  {
    id: "adventure-17",
    name: "Star Spirit",
    src: "/assets/avatars/adventure-17.webp",
  },
  {
    id: "adventure-18",
    name: "Forest Dragon",
    src: "/assets/avatars/adventure-18.webp",
  },
  {
    id: "adventure-19",
    name: "Snow Leopard",
    src: "/assets/avatars/adventure-19.webp",
  },
  {
    id: "adventure-20",
    name: "Penguin Explorer",
    src: "/assets/avatars/adventure-20.webp",
  },
  {
    id: "adventure-21",
    name: "Polar Bear",
    src: "/assets/avatars/adventure-21.webp",
  },
  {
    id: "adventure-22",
    name: "Ice Dragon",
    src: "/assets/avatars/adventure-22.webp",
  },
  {
    id: "adventure-23",
    name: "Arctic Fox",
    src: "/assets/avatars/adventure-23.webp",
  },
  {
    id: "adventure-24",
    name: "Winter Deer",
    src: "/assets/avatars/adventure-24.webp",
  },
  {
    id: "adventure-25",
    name: "Fennec Fox",
    src: "/assets/avatars/adventure-25.webp",
  },
  {
    id: "adventure-26",
    name: "Desert Adventurer",
    src: "/assets/avatars/adventure-26.webp",
  },
  {
    id: "adventure-27",
    name: "Golden Robot",
    src: "/assets/avatars/adventure-27.webp",
  },
  {
    id: "adventure-28",
    name: "Little Astronaut",
    src: "/assets/avatars/adventure-28.webp",
  },
  {
    id: "adventure-29",
    name: "Alien Explorer",
    src: "/assets/avatars/adventure-29.webp",
  },
  {
    id: "adventure-30",
    name: "Celestial Dragon",
    src: "/assets/avatars/adventure-30.webp",
  },
] as const;
export type Avatar =
  | "world"
  | "modes"
  | "trophy"
  | (typeof adventureAvatars)[number]["id"];
export const isAvatar = (value: unknown): value is Avatar =>
  ["world", "modes", "trophy"].includes(value as string) ||
  adventureAvatars.some((a) => a.id === value);
