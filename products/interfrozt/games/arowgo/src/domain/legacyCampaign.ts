import one from "../../content/levels/archive-before-snake/bloom-01.json";
import two from "../../content/levels/archive-before-snake/bloom-02.json";
import three from "../../content/levels/archive-before-snake/bloom-03.json";
import four from "../../content/levels/archive-before-snake/bloom-04.json";
import five from "../../content/levels/archive-before-snake/bloom-05.json";
import { validateLevel } from "./rules";
type SourceLevel =
  | typeof one
  | typeof two
  | typeof three
  | typeof four
  | typeof five;

const mirrorHorizontally = (level: SourceLevel, levelId: string) => ({
  ...level,
  levelId,
  arrows: level.arrows.map((arrow) => ({
    ...arrow,
    points: arrow.points.map(([x, y]) => [level.board.columns - 1 - x, y]),
  })),
});

const mirrorVertically = (level: SourceLevel, levelId: string) => ({
  ...level,
  levelId,
  arrows: level.arrows.map((arrow) => ({
    ...arrow,
    points: arrow.points.map(([x, y]) => [x, level.board.rows - 1 - y]),
  })),
});

export const levels = [
  one,
  two,
  three,
  four,
  five,
  mirrorHorizontally(one, "bloom-06"),
  mirrorVertically(two, "bloom-07"),
  mirrorHorizontally(three, "bloom-08"),
  mirrorVertically(four, "bloom-09"),
  mirrorHorizontally(five, "bloom-10"),
].map(validateLevel);
export const levelNames = [
  "First bloom",
  "Gentle turns",
  "Crossing paths",
  "Hidden rhythm",
  "Valley in harmony",
  "Petal passage",
  "Lantern crossing",
  "Cloudstep turns",
  "Sunlit cascade",
  "Bloom crown",
];
