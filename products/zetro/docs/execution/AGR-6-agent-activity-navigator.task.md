# AGR-6 task: Agent activity navigator

The user delegated implementation to AGR; Codex documents and reviews only. Read `docs/AGENT-ACTIVITY-NAVIGATOR.md` and inspect the current Control Center before editing.

Implement the left agent navigator in `apps/control-center`. Own only scoped Control Center source, styles, markup, and focused tests plus `docs/execution/AGR-6-agent-activity-navigator.md` as a receipt. Do not edit unrelated dirty docs, scripts, or verification screenshots. Do not change the three bottom docks, right tool rail behavior, dispatch authority, backend contracts, or provider connections.

Use actual `/api/status` worker data. Keep status, timestamps, and priority honest. Reuse the existing worker detail action. Preserve accessibility and reduced-motion behavior. Build and run the Control Center tests, then perform desktop and narrow browser checks. Record exact changes, test results, and remaining limitations in the receipt. Do not commit or push; Codex will review the diff and handle the commit.
