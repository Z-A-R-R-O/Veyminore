# Levels 40–60: planning difficulty revision

19 November 2026 · Content version 11

All 21 puzzles retain their board geometry and arrow counts. Countdown deadlines are rebalanced, Ice Seal release counts are adjusted, and later Aurora Gates are repositioned or combined to require more deliberate sequencing. Level 40 retains Cove mechanics; ice starts at 41 and aurora at 46. No faster real-time clock or extra hearts penalty was introduced.

The deterministic candidate search is `tests/author-harder.test.ts` (opt-in `AROWGO_HARDEN=1`). It writes candidates, never live campaign files. Candidates are solver checked, then evaluated by exact enumeration of legal continuations. Each accepted puzzle has meaningful winning and losing legal choices while a countdown target is still blocked. Geometry is unchanged. Candidates and measurements are retained in `content/candidates/harder/`.

Random-legal-move win probability decreases monotonically from 1.967% at Level 40 to 0.150% at Level 60. Each revised level is below 80% of its previous probability. This is a structural planning metric, **not a human win-rate estimate**; human playtesting remains necessary to assess enjoyment, clarity and frustration.

## Save and server compatibility

`content/levels/before-hardening.json` archives Cove 40 content 9 and Frostfall 41–60 content 10. Existing earned coins, best stars and first-clear claims survive migration; changed in-progress boards restart as a fresh attempt. Original saves are retained under `.content-<version>` recovery keys. Profile currency is untouched.

Cloud restore accepts archived versions and passes them through normal local migration. Server completion verification retains the previous content definitions so already-issued attempts remain verifiable. New attempts use content 11. Reward idempotency remains per account and level, not per content revision.

## Validation

Regression coverage checks solvability, unchanged geometry, planning improvement, every intermediate save round-trip, completed-save migration, recovery copies, cloud restore and both old/new server completion proofs. Existing full Frostfall desktop/mobile campaign checks exercise all revised levels through their UI. Earlier Levels 1–39 are unchanged.
