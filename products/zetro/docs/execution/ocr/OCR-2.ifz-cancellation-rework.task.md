# OCR-2 IFZ cancellation rework

Your first pass is rejected: independent command node --test packages/computer-runtime/test/route-cancellation.test.js produced 10 pass and 4 fail.

Fix only packages/computer-runtime/src/route-cancellation.js, its exports/types, test/route-cancellation.test.js, and your receipt.
Failures:
1. late completion test
2. inputLease fake/API mismatch
3. branchControl stop fake/API mismatch
4. branch_cancelled audit lacks sessionId
Correct implementation and test doubles; do not weaken assertions. Validate full stable identity on every transition, not only runId/branchId. Preserve uncertain delivery no-blind-resend behavior.
Run the focused test yourself. Append exact output and limitations to docs/execution/ocr/OCR-2.md.
