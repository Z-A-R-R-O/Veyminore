import amber0 from "../../content/levels/amber/level-61.json";
import amber1 from "../../content/levels/amber/level-62.json";
import amber2 from "../../content/levels/amber/level-63.json";
import amber3 from "../../content/levels/amber/level-64.json";
import amber4 from "../../content/levels/amber/level-65.json";
import amber5 from "../../content/levels/amber/level-66.json";
import amber6 from "../../content/levels/amber/level-67.json";
import amber7 from "../../content/levels/amber/level-68.json";
import amber8 from "../../content/levels/amber/level-69.json";
import amber9 from "../../content/levels/amber/level-70.json";
import amber10 from "../../content/levels/amber/level-71.json";
import amber11 from "../../content/levels/amber/level-72.json";
import amber12 from "../../content/levels/amber/level-73.json";
import amber13 from "../../content/levels/amber/level-74.json";
import amber14 from "../../content/levels/amber/level-75.json";
import amber15 from "../../content/levels/amber/level-76.json";
import amber16 from "../../content/levels/amber/level-77.json";
import amber17 from "../../content/levels/amber/level-78.json";
import amber18 from "../../content/levels/amber/level-79.json";
import amber19 from "../../content/levels/amber/level-80.json";
import frost0 from "../../content/levels/frost/level-41.json";
import frost1 from "../../content/levels/frost/level-42.json";
import frost2 from "../../content/levels/frost/level-43.json";
import frost3 from "../../content/levels/frost/level-44.json";
import frost4 from "../../content/levels/frost/level-45.json";
import frost5 from "../../content/levels/frost/level-46.json";
import frost6 from "../../content/levels/frost/level-47.json";
import frost7 from "../../content/levels/frost/level-48.json";
import frost8 from "../../content/levels/frost/level-49.json";
import frost9 from "../../content/levels/frost/level-50.json";
import frost10 from "../../content/levels/frost/level-51.json";
import frost11 from "../../content/levels/frost/level-52.json";
import frost12 from "../../content/levels/frost/level-53.json";
import frost13 from "../../content/levels/frost/level-54.json";
import frost14 from "../../content/levels/frost/level-55.json";
import frost15 from "../../content/levels/frost/level-56.json";
import frost16 from "../../content/levels/frost/level-57.json";
import frost17 from "../../content/levels/frost/level-58.json";
import frost18 from "../../content/levels/frost/level-59.json";
import frost19 from "../../content/levels/frost/level-60.json";
import cove0 from "../../content/levels/cove/level-21.json";
import cove1 from "../../content/levels/cove/level-22.json";
import cove2 from "../../content/levels/cove/level-23.json";
import cove3 from "../../content/levels/cove/level-24.json";
import cove4 from "../../content/levels/cove/level-25.json";
import cove5 from "../../content/levels/cove/level-26.json";
import cove6 from "../../content/levels/cove/level-27.json";
import cove7 from "../../content/levels/cove/level-28.json";
import cove8 from "../../content/levels/cove/level-29.json";
import cove9 from "../../content/levels/cove/level-30.json";
import cove10 from "../../content/levels/cove/level-31.json";
import cove11 from "../../content/levels/cove/level-32.json";
import cove12 from "../../content/levels/cove/level-33.json";
import cove13 from "../../content/levels/cove/level-34.json";
import cove14 from "../../content/levels/cove/level-35.json";
import cove15 from "../../content/levels/cove/level-36.json";
import cove16 from "../../content/levels/cove/level-37.json";
import cove17 from "../../content/levels/cove/level-38.json";
import cove18 from "../../content/levels/cove/level-39.json";
import cove19 from "../../content/levels/cove/level-40.json";
import one from "../../content/levels/bloom-01.json";
import two from "../../content/levels/bloom-02.json";
import three from "../../content/levels/bloom-03.json";
import four from "../../content/levels/bloom-04.json";
import five from "../../content/levels/bloom-05.json";
import six from "../../content/levels/bloom-06.json";
import seven from "../../content/levels/bloom-07.json";
import eight from "../../content/levels/bloom-08.json";
import nine from "../../content/levels/bloom-09.json";
import ten from "../../content/levels/bloom-10.json";
import eleven from "../../content/levels/bloom-11.json";
import twelve from "../../content/levels/bloom-12.json";
import thirteen from "../../content/levels/bloom-13.json";
import fourteen from "../../content/levels/bloom-14.json";
import fifteen from "../../content/levels/bloom-15.json";
import sixteen from "../../content/levels/bloom-16.json";
import seventeen from "../../content/levels/bloom-17.json";
import eighteen from "../../content/levels/bloom-18.json";
import nineteen from "../../content/levels/bloom-19.json";
import twenty from "../../content/levels/bloom-20.json";
import { levelNames as originalNames } from "./legacyCampaign";
export const LEVELS_PER_WORLD = 20;
import { validateLevel } from "./rules";
export const levels = [
  ...[one, two, three, four, five].map(validateLevel),
  ...[six, seven, eight, nine, ten].map(validateLevel),
  ...[
    eleven,
    twelve,
    thirteen,
    fourteen,
    fifteen,
    sixteen,
    seventeen,
    eighteen,
    nineteen,
    twenty,
  ].map(validateLevel),
  ...[
    cove0,
    cove1,
    cove2,
    cove3,
    cove4,
    cove5,
    cove6,
    cove7,
    cove8,
    cove9,
    cove10,
    cove11,
    cove12,
    cove13,
    cove14,
    cove15,
    cove16,
    cove17,
    cove18,
    cove19,
  ].map(validateLevel),
  ...[
    frost0,
    frost1,
    frost2,
    frost3,
    frost4,
    frost5,
    frost6,
    frost7,
    frost8,
    frost9,
    frost10,
    frost11,
    frost12,
    frost13,
    frost14,
    frost15,
    frost16,
    frost17,
    frost18,
    frost19,
  ].map(validateLevel),
  ...[
    amber0,
    amber1,
    amber2,
    amber3,
    amber4,
    amber5,
    amber6,
    amber7,
    amber8,
    amber9,
    amber10,
    amber11,
    amber12,
    amber13,
    amber14,
    amber15,
    amber16,
    amber17,
    amber18,
    amber19,
  ].map(validateLevel),
];
export const levelNames = [
  ...originalNames,
  "Morning mist",
  "Winding grove",
  "Petal weave",
  "Quiet bridges",
  "Golden canopy",
  "Twilight turns",
  "Hidden terraces",
  "Starlit branches",
  "Valley summit",
  "Full bloom",
  "Land ahoy",
  "Emerald shore",
  "Hidden inlet",
  "Weigh anchor",
  "Twin moorings",
  "Jungle passage",
  "Smuggler trail",
  "Rope bridges",
  "Captain’s course",
  "Green lagoon",
  "Powder crossing",
  "Careful cargo",
  "Reef runners",
  "Timber turns",
  "Tidewatch",
  "Treasure route",
  "Double cargo",
  "Storm passage",
  "Captain’s riddle",
  "Verdant treasure",
  "Snowbound arrival",
  "Crystal crossing",
  "Frozen moorings",
  "Aurora trail",
  "Icebound keys",
  "Glacier passage",
  "Winter cargo",
  "Shimmering ridge",
  "Silent avalanche",
  "Frostfire crossing",
  "Twin summits",
  "Crystal labyrinth",
  "Narrow escape",
  "Polar current",
  "Hidden crevasse",
  "Aurora ascent",
  "Frozen clockwork",
  "Summit strategy",
  "Last light",
  "Crown of winter",
  "Golden arrival",
  "Oasis crossing",
  "Sunlit locks",
  "Dune currents",
  "Saffron steps",
  "Mirage passage",
  "Sandstone rhythm",
  "Caravan crossing",
  "Amber hour",
  "Oasis sentinel",
  "Temple approach",
  "Shifting shadows",
  "Sun and moon",
  "Hidden aqueduct",
  "Gilded maze",
  "Sands of time",
  "Solar ascent",
  "Last caravan",
  "Temple strategy",
  "Crown of the dunes",
];
