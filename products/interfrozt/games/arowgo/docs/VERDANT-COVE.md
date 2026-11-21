# Verdant Cove — World 2

Current content-9 planning update: [Planning difficulty](PLANNING-DIFFICULTY.md). One move-count barrel now begins in Bloom Level 10; two begin at Level 25. Geometry and anchor/key placements are unchanged. The expansion sequence below describes the original release.

Implemented 15 November 2026. Levels 21–40 extend Bloom Valley; existing Levels 1–20 are unchanged by this expansion.

## Art and progression

A green pirate archipelago with emerald terraces, turquoise water, palms, bridges, a sailing ship and treasure. Separate generated portrait and landscape backgrounds fill the game viewport. World selection exposes two ten-level sections per world. Cove unlocks after Level 20. The Bloom finale leads into Level 21; the Cove finale summarizes the full forty-level adventure.

## Teaching and difficulty

| Levels | Purpose |
| --- | --- |
| 21–23 | Familiar snake puzzles; keys return at 22 |
| 24 | Easier anchor introduction and interactive practice lesson |
| 25–30 | Two arrows attached to one anchor, mixed with keys and deeper dependencies |
| 31 | Easier powder-keg introduction and interactive practice lesson |
| 32–36 | One move-count keg, increasingly constrained ordering |
| 37–40 | Two kegs combined with anchors and keys |

Teaching levels deliberately reduce density. Difficulty is measured from dependency structure, opening choices and geometry; it is not a player difficulty rating. Practice blocks are sorted by measured geometry before final validation. Human playtesting is still needed to calibrate difficulty and speed-star targets.

## Rules

Snake movement is unchanged: the head must have a clear forward ray, then the body follows its path. A gold anchor marks a source arrow; attached arrows remain blocked until that source leaves. Releasing an anchor does not bypass ordinary geometry.

A powder keg displays remaining successful removals, including its own removal. Remove it before its counter reaches zero. It is a move limit, not a real-time countdown. Blocked taps and hints do not tick it. Erase removes an arrow and consumes one removal. An expired keg ends the attempt. An otherwise legal removal that makes every remaining deadline impossible also ends the attempt with a specific explanation. Practice uses the same rules with free retries and no rewards.

A hold preview warns when a geometrically clear move would strand a keg. Hints choose only moves with a complete deadline-safe continuation. Restart resets the board and counters.

## Generator and solver

Authoring entry: `tests/author-cove.test.ts`, enabled only with `AROWGO_COVE=1`. It produces candidates, not direct campaign writes. Seeds use 261115 + index × 977 + retry × 131, up to 18 attempts. Candidates use connected placement, 2–5 opening moves, bounded score ranges and 12–17 arrows. Mechanics are assigned in a proven solution order, then re-solved. The authoring pass avoids placing key and anchor attachments on the same tail. Outputs and measurements are in `content/candidates/cove/`; promoted files are in `content/levels/cove/`.

Ordinary puzzles retain the monotone dependency solver. Keg puzzles use a memoized search over active-arrow bitmasks, prune expired deadlines, and consider available arrows in earliest-deadline order. The supported maximum is 20 arrows, with a bounded search budget. Every authored solution is validated step by step. Solver failure is represented as no solution, never as a guessed route.

Content version 7 adds optional `anchorRequires` and `deadline`; rules version remains 2. Deadlines use initial-arrow-count minus active-arrow-count, so reloads preserve counters without a separate mutable clock.

## Persistence and rewards

Bloom level IDs and save keys remain intact. New IDs are `cove-21` through `cove-40`. Legacy session fields remain valid; new failure reasons are optional and checked when present. Tutorial completion is stored independently. No existing wallet, skins, best stars or first-clear flags are reset.

Each new first Story clear awards 25 coins, for 500 additional coins and 60 additional stars. The complete forty-level campaign supports 1,000 first-clear coins and 120 stars. Replays do not repeat first-clear rewards.

## Artwork provenance

Generated with the built-in image-generation tool. Packaged assets: `public/assets/verdant-cove.png` and `verdant-cove-landscape.png`.

Direction: a premium whimsical casual-game pirate archipelago, lush emerald terraces and turquoise ocean, palm framing, wooden bridges, friendly docked ship and treasure; a winding sandy route with clear areas for live level controls. No text, numbers, UI, characters, skulls or cherry blossoms. Portrait composition for phones; separately generated wide composition for desktop. Level controls remain accessible HTML, never baked into artwork.

## Verification

The full mobile campaign test starts with completed legacy Bloom saves, plays all twenty Cove levels and both interactive lessons, checks the finale, then reloads and verifies 1,000 coins and 120 stars. Unit checks cover all candidate solutions, safe hints, session round trips, deadline failure, anchor release, erase and blocked-tap semantics. Responsive map checks cover 320×568, 390×844, 844×390 and 1280×800.

Verification completed: full unit suite 168 passing before the final badge-regression assertion; targeted final Cove suite 5/5, campaign/rules regression 71/71, twenty-level mobile route passed again after promotion, Cove responsive map check passed at all four sizes, existing Bloom map/navigation regression passed, and production build passed. Existing Phaser bundle-size warning remains. These automated checks establish solvability and navigation, not human difficulty calibration.

## World collection navigation

The map has one Worlds button opening a native modal world collection. Buttons share soft lavender shading, rounded edges and short hover/press transitions. The collection is now a name-only list with current-world checks and lock icons. Locked worlds cannot be entered; their accessible labels describe the unlock condition. Frostfall Peaks and Amber Dunes are disabled future-world placeholders, with no levels or progression entries. Completing Bloom Valley enables Verdant Cove automatically. Selecting an unlocked world resumes its first available unfinished level (or its first level after completion). Compact previous/next arrows replace the two large section tabs; a centered range label identifies the ten visible levels. The modal traps focus, closes with Escape or its close control, and returns focus to the launcher. Reduced motion disables its entrance animation.

Verified the locked collection, unlocked Cove selection, arrow paging, no modal overflow and all map controls across 320×568, 390×844, 844×390 and 1280×800; Bloom map-to-play regression and production build pass. No progression or economy data changed for this presentation update.
The Worlds launcher now sits at the left of the map toolbar, alongside previous/next level controls above Play. The top heading is reserved for the current world and its progress. The toolbar keeps one row on narrow phones.

Tapping or keyboard-activating an unlocked map marker now starts that level immediately. The lower Play/Replay button remains an alternate shortcut. Locked markers stay disabled; no save format or progression rule changed.

## Dedicated Cove home illustration

The home page uses `public/assets/generated/verdant-cove-home-v1.png`, generated with the built-in image-generation tool on 15 November 2026. Original: `exec-41192556-4b5c-4511-9556-deee74451351.png`. Transparent alpha is preserved. Art direction: one compact floating tropical pirate-cove diorama, green terraces and palms, timber ship with cream sails, dock, contained turquoise lagoon, golden chest and waterfall, sculpted premium casual-game finish; no surrounding landscape, horizon, text or interface. It replaces the mistakenly reused level-map image in the hero slot. The illustration uses contain sizing without a rounded crop. The Cove home backdrop is a calm sea-green/lavender gradient; map artwork remains on the Worlds screen. Bloom's home artwork is unchanged.

Cove map markers now use dedicated portrait and landscape coordinates aligned to its sandy route. Short phone and landscape overrides keep the upper markers clear of the header. Both ten-level sections share the world-specific route. Responsive hit-target checks passed at 320×568, 390×844, 844×390 and 1280×800.

Cove home now uses a separately generated quiet tropical background (`public/assets/generated/cove-home-background-v1.png`) behind the transparent island. See AUDIT-2026-11-15.md for source provenance and complete regression results.
