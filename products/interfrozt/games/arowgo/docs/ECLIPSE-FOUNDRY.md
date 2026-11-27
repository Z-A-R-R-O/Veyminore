# Eclipse Foundry — World 8

Levels 181–220, one forty-level world, unlocked after Level 180. Four ten-stop map pages. Implemented 27 November 2026; see the audit below for measured results and verification.

## Switch contract

A diamond badge is a switch; a square badge is a gate. Match the number (1 or 2), not just the jade/amber colour. Removing a switch flips every remaining gate in its group. An open gate still requires a clear head ray. A closed gate cannot slide. Ordinary removals never toggle gates. Erase removes a switch and therefore toggles its group; blocked taps and Hint do not. Removing the second switch flips the group again. With no switches left, a closed gate strands the puzzle and ends the attempt. Erase can bypass a gate while an attempt is still active; it cannot revive an already failed attempt.

Gate state is derived from the parity of removed matching switches and each gate's initial state. There is no independently saved toggle flag. Restoring an attempt reconstructs the same state. Switches and gates cannot share another attachment or serve as a key/anchor source. This keeps each badge legible and avoids ambiguous compound rules.

The interactive Rules lesson demonstrates first switch → open, ordinary move → unchanged, second switch → closed. It can be reopened. Hold preview shows linked gates and their immediate open/closed changes, never whether a choice wins. Gate changes fade, and reduced motion removes the transition.

## Progression and authoring

| Levels | Constraint progression | Target structural rating |
| --- | --- | --- |
| 181–190 | One numbered group, two switches/two gates; keys, anchors, two kegs and ice | 700–789 |
| 191–200 | Two independent groups; three kegs, ice and alternating timing | 790–849 |
| 201–210 | Three gates per group, including initially open gates; narrow opening window | 850–899 |
| 211–220 | Two windows, four kegs and three-beat timing alongside both switch groups | 900–1000 |

All puzzles have 28 arrows on a 10×10 board with at least 89 occupied cells. Ratings use the unchanged frozen calibration, not a new switch bonus. Within Foundry, accepted levels are globally ordered by measured rating. The first band intentionally introduces a new rule below the previous world's final rating; this is not a claim that every Foundry puzzle exceeds Astral's hardest score. Structural ratings are not IQ scores, human win rates or guaranteed completion times.

`tests/author-foundry.test.ts` is an opt-in, deterministic offline author (`AROWGO_FOUNDRY=1`). It records seed/trial, metrics and a trap witness for every group. Each witness starts on a solvable prefix, removes a legal switch and strands a remaining gate closed after the last matching switch is gone. The stored solution proves a winning alternative. The exact solver and planner both evaluate switch parity from active-arrow masks; static geometry dependencies do not pretend toggles are monotone.

No generation runs during play. Canonical content is `content/levels/foundry/level-181.json` through `level-220.json`, content version 15 and movement rules version 2. Normal tests never regenerate levels.

## Progress safety and rewards

Levels 1–180 and their versions are unchanged. No save migration, reset, balance import or currency merge is introduced. The same stable keys continue to load existing attempts. New IDs append to both client and server reward manifests. The campaign totals 220 levels, 660 available stars and 5,500 first-clear coins; replays remain unrewarded. Development sandbox testing must not write campaign progress or currency.

The existing 10,700-byte packed legacy cloud limit remains a known separate gap. Large-history uploads must fail safely without truncating saves. This world does not enable a new cloud mode or claim to fix that capacity limit.

## Assets

Generated with the built-in image-generation tool: portrait and landscape maps plus a transparent home island. Emerald crystals, obsidian cliffs, gold forge architecture and an eclipse distinguish the new world. Runtime files: `eclipse-foundry-map-v1.webp`, `eclipse-foundry-wide-v1.webp`, `eclipse-foundry-home-v1.png`. Map marker positions are specific to each composition. The play background is washed out for readability; Home uses the isolated island on a quiet gradient.

## Verification

See [Foundry audit](ECLIPSE-FOUNDRY-AUDIT.md). Human difficulty playtesting and physical-device performance remain separate from automated desktop/mobile-browser checks.
