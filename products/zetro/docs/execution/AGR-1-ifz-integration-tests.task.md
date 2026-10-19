# AGR-1 IFZ cross-slice integration tests

Create only a new pure test file packages/orchestration-core/test/ifz-integration.test.js and append docs/execution/AGR-1-ifz-integration-tests.md. Do not edit sources or shared UI/build/server files.

Exercise the accepted contracts + registry + route planner/guard + Master Prompt/context together:
- manual AGR-2 to OCR-1
- bounded parallel RCT to AGR-1..AGR-5
- sequential/review AGR-5 to AGR-1 to OCR-2 to RCT
- automatic proposal only, no dispatch
- saved workflow revalidation
- fresh-worker package exact order/version/ack admission-only
- negative stale/unavailable/unqualified/wrong workspace/cap mismatch/duplicate/cycle/all limit growth/forbidden context
Use deterministic clocks/IDs and public allowlist assertions. No network/process/native effects. Run only this file plus six focused IFZ files. Receipt exact results and limits.
