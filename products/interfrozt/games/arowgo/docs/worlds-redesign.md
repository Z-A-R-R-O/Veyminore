# Worlds redesign — 13 November 2026

The supplied screenshot is preserved in `references/2026-11-13-worlds/before.png`. It shows the previous stacked-card map. The earlier six-screen reference collection remains the art direction: floating islands, a luminous winding path, raised level discs, and a clear Play action.

## Implemented behavior

- `src/ui/Worlds.tsx` owns map presentation and local selection. Campaign availability, saved stars, rewards, and launch logic remain in Prototype.
- Five accessible level buttons sit along a decorative SVG trail. Locked levels are disabled; completed levels show earned stars; the next level has a sparkle. Selection highlights a disc and updates the bottom panel. The separate Play/Replay button opens the selected level.
- The heading reports actual cleared levels and saved stars (maximum 15). There are no invented rewards or additional worlds.
- Generated `bloom-island-v1.png` and the existing trophy atlas are reused. The existing Scenery component, background images and ambient animation are unchanged. No new raster generation was necessary.
- CSS adapts the scene to remaining viewport height. Short phones get a compact horizontal launch panel; short landscape uses a side panel. The page and bottom navigation remain within the viewport.
- Decorative images and trail are hidden from assistive technology. Nodes retain descriptive names, disabled/pressed state, keyboard focus and earned-star descriptions. Reduced motion disables the new sparkle movement.

## Verification

Production build and TypeScript passed. Browser checks cover 320×568, 390×844, 844×390 and 1280×800, node hit sizes and viewport bounds, locked levels, selection and launch. Existing campaign tests cover all five clears, reward persistence, Practice isolation and page layouts. Results are recorded after the final test run; screenshots are under `docs/verification/worlds-*.png`.

No gameplay rules, coin prices or persistence schemas changed.

Final results: 51 unit tests passed; six existing campaign/page-flow browser cases passed; both final Worlds browser cases passed (desktop and phone projects, each checking four viewport sizes). Formatting, production build and Capacitor web-asset sync passed. Physical-device/native compilation remains unverified. The first desktop map run caught decorative overflow in landscape; clipping artwork to the map resolved it and the final rerun passed.

Published to https://arowgo.vercel.app/#worlds. Live smoke returned HTTP 200 and launched Level 01 without page errors; capture: verification/worlds-live.png.
