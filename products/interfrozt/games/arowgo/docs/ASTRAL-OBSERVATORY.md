# Astral Observatory — World 7

Implemented 27 November 2026. Levels 141–180 form one forty-level world, with four ten-stop map pages. World 7 unlocks after Level 140. Existing level IDs and content remain unchanged.

## Progression

All boards have 28 arrows on 10×10 grids, using dense unique geometry and existing taught mechanics. The exact planner rejects unsolvable candidates and requires meaningful legal choices with both winning and losing continuations. No new hidden movement rule is introduced.

| Levels | Three-beat gates | Opening windows | Window slack around author solution | Minimum structural score |
| --- | --- | --- | --- | --- |
| 141–150 | 4 | 3 | ±1 removal | 700 |
| 151–160 | 4 | 4 | ±1 removal | 720 |
| 161–170 | 5 | 4 | Exact removal | 740 |
| 171–180 | 5 | 4 | Exact removal, higher rating floor | 760 |

Two ice seals, three alternating gates, a key/lock pair, anchor links and removal-count deadlines add competing schedules. Pulse/window attachments are kept off key and anchor sources to prevent overlapping badges. Arrows retain the same head-ray snake movement. Every successful removal advances timing, including Erase; blocked taps and Hint do not.

Each ten-level block is sorted by frozen version-one structural rating. A lower score at a block boundary is possible; this is not a strictly increasing 40-step score sequence. Ratings measure structural constraints, not IQ, human completion time or enjoyment. Human playtesting remains an acceptance step.

## Art and presentation

New generated portrait and landscape observatory maps, with amethyst cliffs, cyan crystal edges, gold star bridges and brass observatories. Map markers use artwork-specific coordinates. Play scenery is softened behind the board; the home illustration is a matching isolated island. These are distinct assets, not replacements for previous world art.

## Content and saves

Canonical JSON: `content/levels/astral/level-141.json` through `level-180.json`. Content version 13, existing rules version 2. The server reward manifest consumes the same files. Campaign totals: 180 levels, 540 stars and 4,500 first-clear coins; replay rewards remain zero. No previous saves, balances or content are rewritten.

## Authoring and checks

Opt-in author: set `AROWGO_ASTRAL=1`, then run `pnpm exec vitest run tests/author-astral.test.ts`. Files resume from disk, so this is an intentional content authoring operation. Set `AROWGO_RATE=1` and run `tests/export-difficulty.test.ts` to update offline ratings. Normal test runs do not generate content.

`tests/astral.test.ts` audits all forty levels, geometric uniqueness, rating floors/order, planner decisions, per-move save restoration and backend rewards. Browser tests cover the first/last puzzle of each block on desktop and mobile emulation, plus world navigation and unchanged legacy saves. See the [audit report](ASTRAL-AUDIT-2026-11-27.md) for measurements and verification.

Legacy cloud packed-size limits and production backend deployment remain separate unresolved work. Do not trim save history or merge currencies to make a larger campaign fit.

## Asset provenance

Generated with the built-in image generation tool on 27 November 2026. Portrait and landscape maps were generated as companion compositions; the home island was generated with transparency. Runtime assets live in `public/assets/astral-observatory-*`; original generated files remain in the Codex image library. Maps are WebP exports of the generated PNGs, without compositional edits. No lettering or level nodes are baked into the artwork.
