# OCR-1 task: IFZ computer session projection

Read `E:/Veyminore/products/zetro/docs/IFZ-UNIFIED-APP-ARCHITECTURE.md`.

Own only `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model/` and append a new dated IFZ section to your existing receipt.

Add a pure, tested projection that maps a bounded IFZ run and computer session into the Computer page state.

Requirements:

- Keep simulation, requested, admitted, observing, acting, paused, stopped, cancelled, disconnected, uncertain, failed, and verified completion distinct.
- Worker self-report cannot create verified completion.
- Bind task, run, conversation, worker, session, workspace, target, authority, and observation identities.
- Reject stale, future, expired, mismatched, malformed, or authority-growing updates.
- Output lifecycle state, safe public subtext, permissions, freshness, Stop/Escape availability, and evidence references only.
- Do not expose prompts, typed content, secrets, screenshots, or private reasoning.
- Pure offline tests only. No native input, provider calls, network, dependencies, or shared-file edits.

Run the package tests and record exact results and proof limits.

