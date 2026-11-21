import archived from "../../content/levels/archive-before-challenge.json";
import {validateLevel} from "./rules";
export const beforeChallengeLevels=archived.map(validateLevel);
