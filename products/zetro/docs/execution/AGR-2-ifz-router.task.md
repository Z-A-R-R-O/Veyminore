# AGR-2 task: IFZ route planner and guard

Read `docs/IFZ-UNIFIED-APP-ARCHITECTURE.md` first.

Implement an isolated route-planning slice. AGR-1 owns contracts and the registry, so do not edit its files.

Own only:

- `packages/orchestration-core/src/ifz/route-planner.js`
- `packages/orchestration-core/src/ifz/route-guard.js`
- `packages/orchestration-core/test/ifz-route-planner.test.js`
- `packages/orchestration-core/test/ifz-route-guard.test.js`
- `docs/execution/AGR-2-ifz-router.md`

Requirements:

- Support manual, automatic-proposal, and saved-workflow route plans.
- Support parallel, sequential, review-chain, first-verified, compare, and bounded-delegation strategies.
- Planning is pure and offline. Automatic mode proposes a route from supplied manifests. It does not dispatch.
- Enforce exact destinations, capability compatibility, workspace binding, maximum workers, maximum active branches, maximum depth, and remaining budgets.
- Reject circular routes and repeated worker-task pairs.
- Reject manual destinations that are unavailable, unqualified for the requested capability, or outside scope.
- A child route cannot increase authority, context, time, tokens, provider attempts, or effect classes.
- Produce a public route preview without prompt text, private reasoning, secrets, or unapproved file contents.
- Do not implement adapter sends or network access.
- Do not use new dependencies.

Run only the new focused tests. Record files, commands, results, and limits in the receipt.

