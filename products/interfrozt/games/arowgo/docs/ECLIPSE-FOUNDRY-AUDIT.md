# Eclipse Foundry acceptance — 27 November 2026

World 8 appends forty puzzles (181–220) without modifying Levels 1–180. Content version 15; movement rules version 2. The frozen rating calibration is unchanged.

## Measured campaign

| Levels | Structural rating | Occupied cells out of 100 |
| --- | --- | --- |
| 181–190 | 710–789 | 89–93 |
| 191–200 | 800–843 | 89–94 |
| 201–210 | 853–889 | 89–95 |
| 211–220 | 900–947 | 89–95 |

All forty boards contain 28 arrows, have unique geometry against the earlier campaign, have a verified complete solution, and are globally sorted by rating. There are 70 verified switch-group trap witnesses (one group per first-band puzzle; two per later puzzle). Each starts in a solvable state and demonstrates a legal switch removal that leaves a gate permanently closed. The failure horizon ranges from 7–27 removals; this measures possible legal survival after a losing choice, not required human lookahead. The largest analyzed state graph contains 51,764 states.

Foundry introduces a new mechanic, so its first band deliberately starts below Astral's last score. It is not a claim that every new puzzle exceeds the previous world's hardest score. Human playtesting is still required to assess enjoyment, readability under pressure and completion times.

## Final results

- `pnpm test --maxWorkers 2`: **940 tests, 71 files passed** (full suite).
- `pnpm build`: TypeScript and production bundle passed; existing large-chunk warning remains.
- `foundry.spec.ts`: **4 browser tests passed**, eight complete levels on Desktop Chrome and eight on emulated Pixel 7, plus the short-phone lesson in both projects.
- `foundry-worlds.spec.ts`: **1 browser test passed**, all four map pages at three viewport sizes, prior-save and currency checks, and loaded Home art.
- Earlier prototype touch pass: five generated puzzles completed on Pixel 7 before final score ordering.
- All 185 pre-existing difficulty records (180 campaign plus five historical candidates) match the previous revision exactly; no prior campaign JSON changed.

Browser runs used the existing isolated preview at `http://127.0.0.1:4186` with separate test-output directories. Reproduce against this checkout with `pnpm exec playwright test tests/e2e/foundry.spec.ts tests/e2e/foundry-worlds.spec.ts`; the repository default starts/uses port 4173, so ensure it belongs to the intended checkout. Browser tests use fresh contexts, not the user's live browser storage.

## Verification scope

- Switch-only fixture: independent parity and recursive win-probability checks across all 256 active masks; second-toggle closure; independent groups; ordinary/blocked moves; Erase; restart; full history restoration and malformed-history rejection.
- All forty Foundry levels: validation, exact solving, rating order/bands, real legal losing choices, per-move save restoration, server acceptance of valid clears and rejection of witnessed bad orders, and no repeat coin reward.
- Existing campaign regression: independent cell-by-cell movement simulation, historical content migration, storage, accounts, rewards and UI-domain behavior.
- Browser coverage: representative first/last levels of each band on desktop and Pixel 7 emulation, real touch hold/release and tapping, gate updates after ordinary and switch moves, tutorial demonstration and completion without sandbox writes.
- Map/Home coverage: 320×568, 390×844 and 1280×800, four map pages, no overlapping/offscreen level targets, loaded home artwork, 180 prior completion saves unchanged, 4,500 existing coins and 73 gems preserved.
- Short-phone lesson: readable scrollable dialog, reopening from the top, and reduced-motion transition suppression.

## Findings fixed during implementation

The first broad regression exposed that switch-only restores were entering the static-board validation path. They now replay move history like other non-monotone mechanics. A dedicated regression covers completion and invalid histories. The independent movement oracle now computes switch parity independently. Whole-campaign tests were split into per-level cases where appropriate to retain useful failure diagnostics as the campaign grows.

## Limits

Tests use isolated browser storage; they do not sign into or modify the user's real account. Existing campaign JSON, save keys and currency formats are unchanged. The known legacy cloud packed-size limit and production backend deployment are not changed by this work. The build's existing large-chunk warning remains. Browser device emulation does not replace physical-phone performance and human difficulty testing.

[Rules and authoring](ECLIPSE-FOUNDRY.md) · [Artwork](assets/eclipse-foundry.md).
