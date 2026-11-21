import { validateLevel } from "./rules";
export const previousKeyLesson = validateLevel({
  schemaVersion: 1,
  rulesVersion: 1,
  contentVersion: 3,
  levelId: "lesson-keys",
  board: { columns: 6, rows: 6 },
  arrows: [
    {
      id: "B",
      points: [
        [1, 0],
        [2, 0],
      ],
    },
    {
      id: "K",
      points: [
        [1, 3],
        [1, 1],
      ],
    },
    {
      id: "L",
      points: [
        [2, 4],
        [2, 3],
      ],
    },
    {
      id: "G",
      points: [
        [4, 4],
        [4, 2],
      ],
      requires: "K",
    },
  ],
  solution: ["B", "K", "L", "G"],
});

export const keyLesson = validateLevel({
  ...previousKeyLesson,
  rulesVersion: 2,
  contentVersion: 5,
});
