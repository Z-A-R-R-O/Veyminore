import one from "../../content/levels/bloom-01.json";
import two from "../../content/levels/bloom-02.json";
import three from "../../content/levels/bloom-03.json";
import four from "../../content/levels/bloom-04.json";
import five from "../../content/levels/bloom-05.json";
import { validateLevel } from "./rules";
export const levels = [one, two, three, four, five].map(validateLevel);
export const levelNames = [
  "First bloom",
  "Gentle turns",
  "Crossing paths",
  "Hidden rhythm",
  "Valley in harmony",
];
