# Dense planning campaign — Levels 30–80

This revision replaces the geometry of Levels 30–80 with content version 12. Levels 1–29, campaign IDs, world unlock order, currencies and first-clear reward amounts are unchanged.

## Difficulty design

Arrow count rises from 20 at Level 30 to 28 at Level 80. The board remains 10 × 10, so grid cells and arrow rendering do not shrink. Reverse construction produces connected, solvable geometry. Key and anchor prerequisites, two move-count deadlines, and the existing progressively introduced ice/phase mechanics create consequential removal-order choices.

A second packing pass extends tails into spare cells only when the entire dependency graph remains identical. It validates each extension against self-crossing head rays and the saved solution. The target grows from 70 to 85 occupied cells; all 51 promoted boards meet that target. This adds path tracing and visual density without corrupting previously verified timing decisions.

Each accepted candidate must have a lower exact random-legal-play completion probability than both its old version and the previous new level. It must contain a demonstrated winning and losing legal continuation, including decisions while a countdown target is blocked. These measurements are **not human win rates or IQ scores**. Human completion times, enjoyment and fairness still need playtesting.

| Level | Arrows | Occupied grid cells |
| --- | ---: | ---: |
| 30 | 20 | 70 / 100 |
| 40 | 21 | 73 / 100 |
| 50 | 23 | 76 / 100 |
| 60 | 24 | 79 / 100 |
| 70 | 26 | 82 / 100 |
| 80 | 28 | 85 / 100 |

## Authoring and reproduction

- `tests/author-dense.test.ts`, enabled with `AROWGO_DENSE=1`, writes candidates to `content/candidates/dense`. It resumes validated existing candidates. It does not replace live levels.
- `tests/promote-dense.test.ts`, enabled with `AROWGO_PROMOTE_DENSE=1`, verifies the full candidate set exists, packs paths without changing dependencies, checks metrics, and copies candidates into the campaign.
- `content/candidates/dense/report.json` records arrow counts, occupied cells, dependency depths, opening choices and exact planning measurements.
- Normal test runs never regenerate or overwrite campaign content.

The generator now accepts up to 28 arrows and an optional minimum occupied-cell requirement. Its work is bounded. Exact planning analysis is capped at 1.1 million memoized states; rejected authoring candidates cannot silently pass on a partial estimate.

## Solver and performance

Timing masks support at most 28 arrows, below JavaScript's signed bit-mask boundary. The solver prioritizes prerequisites of urgent countdowns and rejects states with insufficient moves remaining to clear an active target's prerequisites. Removed intermediate blockers are excluded, including arrows erased with a booster. Exhaustive small-board oracle tests check the pruning against independent legal-play search. Search retains its existing bounded failure behavior. A per-level cache stores at most 512 timing results, checks a full board/rules fingerprint before reuse, and returns copies so callers cannot mutate cached solutions.

## Existing saves and rewards

`content/levels/before-density.json` archives all 51 replaced definitions. Local migration recognizes the old definition, retains coins, best stars and claimed-first-clear flags, archives the original raw save, and starts a fresh attempt on the new geometry. An in-progress old layout cannot be continued on a different board. The player sees the existing new-puzzle migration notice.

Cloud restore accepts the archived definitions, and server reward verification retains old completion proofs alongside the new definitions. Account-level per-level reward idempotency remains unchanged. Tests use isolated storage and synthetic accounts; they do not alter the player's live balances.

## Cloud capacity and deployment

Keeping 80 saves, backups and the 51 content-recovery archives exceeded the former single-record upload budget. Packing still uses gzip and Brotli quality 6 first; oversized saves get a quality-11 Brotli pass. Packed snapshots remain bounded at 10,700 bytes and decompression at 512 KB. No entries are dropped.

When a full record exceeds 8,000 bytes, its base64 data is split after 7,000 characters. A third overflow object holds the tails for the current and previous operation IDs. Current, previous and overflow records are submitted in the **same SetObjects request with the same ExpectedProfileVersion**. Every individual object remains under the existing 8,000-byte budget. Reads reconstruct the current payload and verify its original SHA-256 hash; missing or corrupt tails fail closed. Older unsplit gzip/Brotli records remain readable. Probe objects use their own overflow namespace.

This stays within the [three-object free-tier example](https://learn.microsoft.com/en-us/xbox/playfab/live-service-management/game-configuration/entities/entity-objects) per normal-save namespace and uses PlayFab's [version precondition](https://learn.microsoft.com/en-us/rest/api/playfab/data/object/set-objects?view=playfab-rest). Actual title quotas still govern provider acceptance. Deploy the updated backend before the updated client; old backends cannot read fragmented records. Local fake-provider tests cover this path; a live PlayFab overflow upload has not been performed against the player's account.

## Verification

All 51 solutions and every intermediate session must validate. Tests check unique geometry, density/count progression, actual losing choices, old in-progress/completed migration, no repeated first-clear rewards, server proof acceptance, and cloud round-trips including recovery archives. Browser checks complete Levels 30–80 on desktop and phone, then reload and verify campaign rewards. Screenshots of representative boards are reviewed for readability.

Verified 20 November 2026: the complete unit/integration suite passed, as did the additional cache-mutation and all-legal-alternatives regressions. Both desktop and Pixel 7 browser runs completed all 51 revised levels and reloaded with 2,000 coins and 240 stars. Separate mouse/touch checks passed for Levels 30, 60 and 80 at 320×568, 390×844 and 844×390. Representative screenshots were visually reviewed. The production build passes with the existing large-chunk warnings; this is browser/emulation validation, not native Android device certification.
