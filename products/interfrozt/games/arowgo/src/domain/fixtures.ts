import type { Arrow, Level } from "./rules";
export interface RuleFixture {
  name: string;
  description: string;
  level: Level;
  selected: string;
  clear: boolean;
}
const level = (arrows: Arrow[]): Level => ({
  schemaVersion: 1,
  rulesVersion: 1,
  contentVersion: 1,
  levelId: "proof",
  board: { columns: 6, rows: 6 },
  arrows,
  solution: arrows.map((a) => a.id),
});
export const legacyFixtures: RuleFixture[] = [
  {
    name: "North",
    description: "A straight arrow exits upwards.",
    selected: "A",
    clear: true,
    level: level([
      {
        id: "A",
        points: [
          [2, 3],
          [2, 1],
        ],
      },
    ]),
  },
  {
    name: "East",
    description: "A bent arrow slides right as one rigid shape.",
    selected: "A",
    clear: true,
    level: level([
      {
        id: "A",
        points: [
          [1, 1],
          [1, 3],
          [3, 3],
        ],
      },
    ]),
  },
  {
    name: "South",
    description: "The whole path must cross the lower boundary.",
    selected: "A",
    clear: true,
    level: level([
      {
        id: "A",
        points: [
          [1, 1],
          [3, 1],
          [3, 3],
        ],
      },
    ]),
  },
  {
    name: "West",
    description: "A multi-bend path slides left without retracting.",
    selected: "A",
    clear: true,
    level: level([
      {
        id: "A",
        points: [
          [4, 1],
          [4, 2],
          [3, 2],
          [3, 4],
          [1, 4],
        ],
      },
    ]),
  },
  {
    name: "Head blocker",
    description: "B obstructs the arrowhead of A.",
    selected: "A",
    clear: false,
    level: level([
      {
        id: "A",
        points: [
          [0, 2],
          [1, 2],
        ],
      },
      {
        id: "B",
        points: [
          [3, 2],
          [3, 1],
        ],
      },
    ]),
  },
  {
    name: "Body blocker",
    description:
      "The head ray is clear. The bent body hits B, so A cannot exit.",
    selected: "A",
    clear: false,
    level: level([
      {
        id: "A",
        points: [
          [0, 1],
          [0, 3],
          [2, 3],
        ],
      },
      {
        id: "B",
        points: [
          [3, 1],
          [3, 0],
        ],
      },
    ]),
  },
  {
    name: "Multiple blockers",
    description: "Removing B alone is insufficient: C also obstructs A.",
    selected: "A",
    clear: false,
    level: level([
      {
        id: "A",
        points: [
          [0, 1],
          [0, 3],
          [2, 3],
        ],
      },
      {
        id: "B",
        points: [
          [3, 1],
          [3, 0],
        ],
      },
      {
        id: "C",
        points: [
          [5, 2],
          [5, 1],
        ],
      },
    ]),
  },
  {
    name: "Last-step blocker",
    description:
      "A body cell hits B near the far edge, after the head has left.",
    selected: "A",
    clear: false,
    level: level([
      {
        id: "A",
        points: [
          [0, 1],
          [0, 3],
          [2, 3],
        ],
      },
      {
        id: "B",
        points: [
          [5, 1],
          [5, 0],
        ],
      },
    ]),
  },
  {
    name: "Boundary",
    description:
      "The head starts at the edge, but the tail still needs to leave.",
    selected: "A",
    clear: true,
    level: level([
      {
        id: "A",
        points: [
          [3, 2],
          [5, 2],
        ],
      },
    ]),
  },
];

export const fixtures: RuleFixture[] = legacyFixtures.map((f, i) => ({
  ...f,
  name:
    i === 5
      ? "Clear beside the body"
      : i === 6
        ? "Side obstacles"
        : i === 7
          ? "Distant side obstacle"
          : f.name,
  level: { ...f.level, rulesVersion: 2 },
  clear: [5, 6, 7].includes(i) ? true : f.clear,
  description: [5, 6, 7].includes(i)
    ? "The head's forward path is clear. The bent body follows its own path past these side obstacles."
    : i === 1
      ? "The head exits right and the bent body follows its path."
      : i === 2
        ? "The head exits down; the tail follows behind."
        : f.description,
}));
