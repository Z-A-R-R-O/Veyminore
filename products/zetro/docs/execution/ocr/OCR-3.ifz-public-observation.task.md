# OCR-3 task: IFZ truthful public observation projection

Read `E:/Veyminore/products/zetro/docs/IFZ-UNIFIED-APP-ARCHITECTURE.md`.

Own only `E:/Veyminore/products/zetro/packages/computer-observer/` and append a new dated IFZ section to your existing receipt.

Implement a pure projection from admitted observer events to bounded IFZ public status.

Requirements:

- Produce lifecycle state, safe public subtext, observation age, source, and evidence references.
- Distinguish available, idle, running, reported complete, verified complete, unavailable, interrupted, and uncertain.
- Idle, connected, busy, or worker text cannot prove completion.
- Reject stale, future, mismatched, reordered, duplicated, malformed, and oversized events.
- Exclude prompts, typed content, window content, secrets, source text, and private reasoning.
- Use strict UTF-8 byte bounds and injected time.
- Pure offline tests only. No capture, native input, network, providers, dependencies, or shared-file edits.

Run focused package tests and record exact results and limits.

