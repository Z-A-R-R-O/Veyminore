import archived from "../../content/levels/frost-before-timing.json";
import { validateLevel } from "./rules";
export const beforeTimingLevels = archived.map(validateLevel);
