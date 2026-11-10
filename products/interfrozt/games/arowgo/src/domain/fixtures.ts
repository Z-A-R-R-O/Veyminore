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
export const fixtures: RuleFixture[] = [
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
