# Astral Observatory — World 7

Implemented 27 November 2026. Levels 141–180 form one forty-level world, with four ten-stop map pages. World 7 unlocks after Level 140. Existing level IDs and content remain unchanged.

## Progression

All boards have 28 arrows on 10×10 grids, using dense unique geometry and existing taught mechanics. The exact planner rejects unsolvable candidates and requires meaningful legal choices with both winning and losing continuations. No new hidden movement rule is introduced.

The content-14 revision removes the ten-level score resets. All forty puzzles are sorted by the same frozen structural rating, with a minimum of 860, above the previous campaign peak of 856. The source layouts retain or increase their score, preserve or reduce random-legal-play success, and retain a witnessed delayed losing choice. See [hardening measurements and verification](ASTRAL-HARDENING.md).

The world combines three-beat gates, opening windows, ice seals, alternating gates, key/lock pairs, anchor links and removal-count deadlines. Counts vary by puzzle rather than by a fixed ten-level template. Timing attachments stay off key and anchor sources. Arrows retain the same head-ray snake movement. Successful removals advance timing, including Erase; blocked taps and Hint do not.

Ratings measure structural constraints, not IQ, human completion time or enjoyment. Human playtesting remains an acceptance step.

## Art and presentation

New generated portrait and landscape observatory maps, with amethyst cliffs, cyan crystal edges, gold star bridges and brass observatories. Map markers use artwork-specific coordinates. Play scenery is softened behind the board; the home illustration is a matching isolated island. These are distinct assets, not replacements for previous world art.

## Content and saves

Canonical JSON: `content/levels/astral/level-141.json` through `level-180.json`. Content version 14, existing rules version 2. The server reward manifest consumes the same files. Campaign totals: 180 levels, 540 stars and 4,500 first-clear coins; replay rewards remain zero. Levels 1–140 are unchanged. Original Astral content is archived for save migration and server reward validation; coins, best stars and first-clear claims are preserved. Changed boards start a fresh attempt.

## Authoring and checks

The original `tests/author-astral.test.ts` records content-13 authoring. Use the [hardening workflow](ASTRAL-HARDENING.md) for the current revision. Normal test runs do not generate content.

`tests/astral.test.ts` audits all forty levels, geometry, global rating order, planner decisions, per-move restoration and backend rewards. `tests/astral-hardening.test.ts` covers migration, old reward proofs and comparisons with earlier content. Browser tests cover representative desktop/mobile gameplay plus world navigation, legacy saves and the content-13 migration.

Legacy cloud packed-size limits and production backend deployment remain separate unresolved work. Do not trim save history or merge currencies to make a larger campaign fit.

## Asset provenance

Generated with the built-in image generation tool on 27 November 2026. Portrait and landscape maps were generated as companion compositions; the home island was generated with transparency. Runtime assets live in `public/assets/astral-observatory-*`; original generated files remain in the Codex image library. Maps are WebP exports of the generated PNGs, without compositional edits. No lettering or level nodes are baked into the artwork.
