import archived from "../../content/levels/archive-before-planning.json";
import { validateLevel } from "./rules";
export const beforePlanningLevels = archived.map(validateLevel);
