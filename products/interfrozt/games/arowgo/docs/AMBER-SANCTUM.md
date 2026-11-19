# Amber Sanctum — Levels 81–100

The fifth twenty-level chapter continues the desert-temple setting using the existing Amber artwork. It unlocks after Level 80, appears in the Worlds list, has two ten-stop map pages and is available in the isolated developer level picker. Level 100 leads to the campaign finale. The full campaign offers 300 stars and 2,500 first-clear coins.

## Difficulty and authoring

These are twenty distinct, freshly generated 10 × 10 boards with 28 arrows each. Keeping the same cell scale preserves mobile readability. Difficulty comes from connected dependency chains, a key/lock pair, anchor prerequisites, three ice seals, four phase gates and two countdown targets. Levels 91–100 increase that to five phase gates and three countdown targets. All use the existing taught rules; there is no surprise mechanic or real-time countdown.

The offline authoring command is `AROWGO_SANCTUM=1 pnpm exec vitest run tests/author-sanctum.test.ts --maxWorkers=1` (set the environment variable with the shell's native syntax). It searches deterministic seeds and timing variants, writes candidates under `content/candidates/sanctum`, and resumes from already accepted files. A geometry depth of at least nine is required. Tail packing targets 85–89 occupied cells while preserving the entire dependency graph.

Every accepted candidate must be solvable, have winning and losing legal alternatives, and contain a planning decision while a countdown target is still blocked. Its exact random-legal-play completion probability must be lower than the preceding level's, starting from Level 80. This is a structural comparison, not a prediction of human completion rates or an IQ score. Human playtesting remains necessary for perceived difficulty and fairness.

Promotion is separate: `AROWGO_PROMOTE_SANCTUM=1 pnpm exec vitest run tests/promote-sanctum.test.ts --maxWorkers=1`. All twenty candidates are validated before any campaign file is written. Runtime content is static JSON, with independent IDs `sanctum-81` through `sanctum-100` and content version 12. Measurements are retained in the candidate report and each level's generation metadata.

### Accepted board measurements

| Level | Arrows | Occupied cells | Dependency depth | Random-legal-play completion probability |
| --- | ---: | ---: | ---: | ---: |
| 81 | 28 | 85 / 100 | 9 | 2.2967327e-05 |
| 90 | 28 | 87 / 100 | 10 | 5.8735233e-06 |
| 91 | 28 | 87 / 100 | 12 | 5.0424556e-06 |
| 99 | 28 | 89 / 100 | 9 | 1.0542912e-06 |
| 100 | 28 | 89 / 100 | 11 | 3.0941345e-08 |

Level 100 is a deliberately sharper capstone: it is substantially less forgiving of arbitrary removal order than Level 99. This needs particular attention in human playtesting.

## Saves, rewards and verification

Levels 1–80 are unchanged. No migration, balance grant or save reset occurs when installing this expansion. New levels use separate save keys. The server reward manifest includes the new IDs; each first clear awards the existing 25 coins once and replays do not repeat that reward. Deploy the updated reward backend with the expanded client.

Coverage includes all solutions, intermediate save parsing, replay reward idempotency, server completion proofs, distinct geometry, planning witnesses, 100-level local snapshot restoration and compact cloud fixtures, map locks, responsive board/map layouts and browser campaign completion. Browser tests use isolated profiles, never the player's live save.

### Existing cloud capacity limitation

A separate capacity probe during this work found that realistic UUID-rich move histories already exceed the cloud packer's 10,700-byte limit at 80 completed levels (approximately 61 KB base64 at Brotli quality 6, before historic migration copies). Compact synthetic test fixtures fit; that does not establish capacity for a real full campaign. Normal sync rejects an oversized upload and retains the local save; it must not truncate history or overwrite cloud data with a partial save. This expansion does not change the cloud format or enable additional cloud features. Larger-history cloud storage needs a separate backend update and live-provider verification before full-campaign sync can be certified.

## Verification result — 20 November 2026

- 393 unit tests pass across 56 files, including all 100 canonical solutions and server reward proofs.
- 10 Playwright checks pass on Desktop Chrome and emulated Pixel 7. Both complete all twenty new levels; the phone run uses touch input. Earlier 80 save strings remain byte-for-byte identical after the run, and reload shows 2,500 coins and 300 stars in the isolated fixture.
- Board/map checks cover 320 × 568, 390 × 844 and 844 × 390; map checks also cover 1280 × 800. Checks include direct marker hit testing, locked chapters, Level 80 → 81 and the Level 100 finale.
- Type checking and production build pass. Physical-device testing, human difficulty review and large-history live cloud verification remain open; the cloud limitation above is not a passed acceptance gate.
