import six from "../../content/levels/archive-v2/bloom-06.json";
import seven from "../../content/levels/archive-v2/bloom-07.json";
import eight from "../../content/levels/archive-v2/bloom-08.json";
import nine from "../../content/levels/archive-v2/bloom-09.json";
import ten from "../../content/levels/archive-v2/bloom-10.json";
import { validateLevel } from "./rules";
export const previousGeneratedLevels = [six, seven, eight, nine, ten].map(
  validateLevel,
);
