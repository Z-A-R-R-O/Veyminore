import data from "../../content/levels/before-density.json";
import { validateLevel } from "./rules";
export const beforeDensityLevels = data.map(validateLevel);
