# Amber Dunes — World 4, Levels 61–80

Original expansion implemented 19 November 2026. **Current difficulty revision:** Levels 30–80 now use the denser content-12 boards described in [DENSE-CAMPAIGN.md](DENSE-CAMPAIGN.md). The original content-11 generation details below are retained as history. The campaign now contains 80 levels, 240 possible stars and 2,000 first-clear coins. Existing Levels 1–60 and their save identities are unchanged.

## Player experience

Amber Dunes unlocks when Level 60 is cleared. The world picker lists it by name and explains the Frostfall unlock requirement. Its two map sections show 61–70 and 71–80, with direct level launching. Golden sandstone terraces, oasis water and a sun temple replace the winter setting. Portrait and landscape map artwork have separate marker positions; the home screen has a dedicated floating-island illustration. Level 80 now leads to [Amber Sanctum, Levels 81–100](AMBER-SANCTUM.md); the earlier 80-level finale has moved to Level 100. Developer mode automatically includes all 80 levels in its isolated sandbox selector.

## Puzzle design

Twenty freshly generated board layouts; no mirrored/reused campaign boards. Boards contain 17–18 arrows. Existing keys, anchors, move-count kegs, Ice Seals and Sun/Moon phases are combined; this release adds no new mechanic. Familiar ice/aurora symbols and rule explanations are intentionally retained across the world transition.

`tests/author-amber.test.ts` is the opt-in authoring entry point (`AROWGO_AMBER=1`). It generates deterministic connected geometry and a key pair, adds anchor prerequisites and meaningful countdown pressure, then searches bounded timing variants. Candidates are written to `content/candidates/amber/`, validated and solver checked before promotion into `content/levels/amber/`. Seeds and per-level measurements are recorded in `report.json`.

Exact random-legal-play completion probability falls from approximately 0.1264% at Level 61 to 0.0354% at Level 80, below Level 60's 0.1501%. Every level contains both winning and losing legal continuations, including choices while a countdown target remains blocked. These are structural difficulty metrics, **not predicted human success rates**. Human playtesting remains needed for fairness and enjoyment.

## Persistence and backend

New saves use independent `amber-61` through `amber-80` IDs, content version 11. Earlier saves are not rewritten by adding this world. Server-owned reward content includes all 80 levels; existing authentication, conflict detection and per-level first-clear idempotency remain in place.

An 80-level save with recovery copies exceeded the existing 8,000-byte compressed payload budget. Cloud packing now tries maximum gzip compression, then Brotli quality 6 only if necessary. Both encodings are decoded with the existing 512 KB decompression bound and SHA-256 integrity validation. Older gzip saves remain readable; no save entries or recovery copies are dropped. Oversized payloads still fail safely. Deploy the updated backend before publishing the expanded client; older backends do not understand Brotli cloud payloads.

## Assets

Generated with the built-in image-generation tool:

- `public/assets/amber-dunes.webp`: portrait world map and gameplay scenery.
- `public/assets/amber-dunes-wide.webp`: landscape map and gameplay scenery.
- `public/assets/generated/amber-home.webp`: transparent home illustration.

Generated source images are exported as WebP without repainting their content.

## Verification

Campaign tests cover all 80 solutions, independent saves, exactly 25 coins per first clear and no replay duplication. Amber-specific tests check unique geometry, a strictly decreasing measured probability curve, winning/losing decision witnesses and every intermediate save round-trip. Cloud tests cover exact restoration of the expanded campaign with recovery copies. Browser checks play all 20 new levels on desktop and phone, verify rewards after reload, test the locked world picker and check map controls at narrow, portrait, landscape and desktop sizes. Tests use isolated browser profiles, never the player's real save.
