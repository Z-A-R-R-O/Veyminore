# AGR-3 task: IFZ Master Prompt and fresh-worker package

Read `docs/IFZ-UNIFIED-APP-ARCHITECTURE.md` first.

Implement the versioned Master Prompt and context-package domain slice.

Own only:

- `packages/orchestration-core/src/ifz/master-prompt.js`
- `packages/orchestration-core/src/ifz/context-package.js`
- `packages/orchestration-core/src/ifz/presets.js`
- `packages/orchestration-core/test/ifz-master-prompt.test.js`
- `packages/orchestration-core/test/ifz-context-package.test.js`
- `docs/execution/AGR-3-ifz-master-prompt.md`

Requirements:

- Model the Charter, Worker Knowledge, Project Context, and Task Package as separate versioned layers.
- Provide ZETRO Standard, ECO, Build, Review, Design, Qualification, and Recovery presets.
- A preset may narrow work. It cannot weaken authority, security, destination, or usage limits.
- Build a bounded fresh-worker package in the documented order.
- Bind every package to worker, adapter, project, workspace, task, route position, and context versions.
- Require an acknowledgment object for identity, workspace, task, scope, and context version.
- Exclude secrets, `.env` content, credentials, full uncontrolled transcripts, and private reasoning.
- Apply strict byte and entry bounds before output.
- Keep the module pure and offline. Do not read arbitrary files, call providers, or add dependencies.

Run only the new focused tests. Record files, commands, results, and limits in the receipt.

