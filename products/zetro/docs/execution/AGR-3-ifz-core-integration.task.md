# AGR-3 IFZ core integration

Integrate accepted IFZ core slices only. Own:
- packages/orchestration-core/src/index.js
- packages/orchestration-core/package.json only if script/export is needed
- packages/orchestration-core/test/ifz-runtime-integration.test.js
- docs/execution/AGR-3-ifz-core-integration.md

Export canonical contracts, registry, route planner/guard, Master Prompt/context/presets through the package entry point without duplicate public types. Reconcile route guard with canonical contracts: do not maintain a weaker public manifest schema or default missing availability/qualification. At the route effect boundary all modes must reject stale/unavailable/unqualified/wrong workspace/project destinations.

Build a pure fake-adapter lifecycle integration harness: admit context acknowledgment, propose/validate route, submitted/uncertain/completed/cancelled/late-result transitions, explicit reconciliation and no blind resend. Test manual AGR2→OCR1, bounded parallel RCT→AGR1-5, AGR5→AGR1→OCR2→RCT review chain, automatic proposal-only, saved revalidation, stale/cap/wrong-workspace/duplicate/cycle/all budget negatives. No network/process/provider/native effects. Run focused IFZ tests. Append exact receipt.
