import data from "../../content/levels/astral-before-hardening.json";
import { validateLevel } from "./rules";
export const beforeAstralHardeningLevels = data.map(validateLevel);
