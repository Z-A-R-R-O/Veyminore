import eleven from "../../content/levels/archive-v3/bloom-11.json";
import fourteen from "../../content/levels/archive-v3/bloom-14.json";
import seventeen from "../../content/levels/archive-v3/bloom-17.json";
import nineteen from "../../content/levels/archive-v3/bloom-19.json";
import twenty from "../../content/levels/archive-v3/bloom-20.json";
import { validateLevel } from "./rules";
export const previousPlainLevels = [
  eleven,
  fourteen,
  seventeen,
  nineteen,
  twenty,
].map(validateLevel);
