# OCR-2 task: IFZ route-wide computer cancellation contract

Read `E:/Veyminore/products/zetro/docs/IFZ-UNIFIED-APP-ARCHITECTURE.md`.

Own only `E:/Veyminore/products/zetro/packages/computer-runtime/` and append a new dated IFZ section to your existing receipt.

Implement an isolated, pure route-cancellation coordinator for computer-session branches.

Requirements:

- Accept exact run, task, branch, session, worker, workspace, cancellation, and attempt identities.
- Fan cancellation to active admitted branches once.
- Prevent queued branches from starting after cancellation.
- Treat timeout after a possible send as uncertain and require reconciliation by stable identity.
- Never blindly retry uncertain delivery.
- Reject late completion from changing cancelled or stopped state.
- Keep native effects behind the existing session authority and input lease.
- Use injected clock and fake ports for deterministic tests.
- No actual process, network, native input, provider call, new dependency, or shared-file edit.

Run only focused package tests and record exact results and limits.

