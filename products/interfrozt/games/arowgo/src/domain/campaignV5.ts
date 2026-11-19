import a from "../../content/levels/archive-v5/bloom-06.json";
import b from "../../content/levels/archive-v5/bloom-07.json";
import c from "../../content/levels/archive-v5/bloom-08.json";
import d from "../../content/levels/archive-v5/bloom-09.json";
import e from "../../content/levels/archive-v5/bloom-10.json";
import { validateLevel } from "./rules";
export const previousMildLevels = [a, b, c, d, e].map(validateLevel);
