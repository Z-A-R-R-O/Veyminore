# AGR-2 IFZ router rework

Harden only your route planner/guard slice. Do not integrate shared UI/server files.

Acceptance:
- Canonical strategy identifiers must exactly match contracts: parallel, sequential, review-chain, first-verified, compare, bounded-delegation.
- Manual mode preserves exact user destinations. Automatic mode returns a proposal only and cannot dispatch. Saved workflows must be revalidated at use time.
- Enforce full ancestry cycle detection, duplicate task-worker rejection, project/workspace/qualification/availability/freshness/capability compatibility, and strict authority monotonicity across allowed/write paths, context types, effects, time, tokens, provider attempts, worker count, depth, and branches.
- Reject malformed/non-plain/cyclic/deep inputs, missing dependency steps, unavailable/stale workers, unknown destinations, and budget/context growth.
- Public preview must use an explicit allowlist; never copy then redact.
- Add focused adversarial tests including AGR2 to OCR1 manual, RCT to AGR1-5 bounded parallel, AGR5 to AGR1 to OCR2 to RCT sequential/review, automatic proposal-only, saved-workflow revalidation, cycles, stale worker, wrong workspace, cap mismatch, duplicates, and all limit overflows.
- Run focused route tests and append an honest receipt to docs/execution/AGR-2-ifz-router.md.
