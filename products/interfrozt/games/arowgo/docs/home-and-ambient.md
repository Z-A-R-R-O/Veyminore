# Home and shared ambient motion — 13 November 2026

## Home

`src/ui/Home.tsx` separates the Home presentation from campaign routing. A welcome label (Guest by default), title, floating generated island, next-level title and prominent Play button establish the visual hierarchy. Three shortcuts open Worlds, Modes and Profile. The Bloom Valley card reports real cleared levels and stars and opens Worlds. Completing the campaign changes the message and Play again label without adding rewards.

The existing generated island and icon atlas are reused. The supplied before screenshot is retained at `references/2026-11-13-home/before.png`. Short phones use compact spacing; landscape places the island alongside the actions. No page scrolling is required at the checked viewports.

## Shared ambient motion

The existing Bloom Valley background, petals, fireflies, rays and mist remain intact. Scenery now adds three low-opacity light blooms with a slow 24-second transform/opacity cycle. They sit behind UI and never receive pointer events; the puzzle uses reduced opacity for focus. Subtle effects omit them.

Home adds a seven-second island float, a soft halo, two decorative sparkles and an occasional Play-button sheen. These effects use CSS transforms/opacity except the small button sheen. No new runtime dependency or generated raster is needed.

The hub now applies the same in-app Reduce Motion behavior as gameplay, disabling all decorative animation/transitions. Operating-system reduced motion is respected. Hidden tabs pause hub animations using the existing visibility hook; gameplay already had this behavior. Decorative layers are aria-hidden. Reduced motion and Subtle effects remove the additional light blooms and sparkles.

## Verification

The focused Home test checks four viewport sizes (320×568, 390×844, 844×390, 1280×800), control bounds and hit sizes, visible island space, no content overflow and persisted reduced-motion behavior. Campaign tests cover Home Play, all five levels, rewards and navigation. Screenshots live in `docs/verification/home-refresh-*.png`.

No puzzle rules, shop prices, profile schema or saved-progress schema changed.

Final local results: 51 unit tests, six campaign/navigation browser cases and two focused Home cases passed. The Home cases each check all four viewport sizes and reduced-motion persistence. Build, formatting and Capacitor asset sync passed. Initial short-landscape overflow was corrected and both Home cases reran successfully. Native/physical-device checks remain separate.
