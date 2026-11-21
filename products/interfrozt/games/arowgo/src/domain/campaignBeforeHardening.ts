import archived from "../../content/levels/before-hardening.json";
import { validateLevel } from "./rules";
export const beforeHardeningLevels = archived.map(validateLevel);
