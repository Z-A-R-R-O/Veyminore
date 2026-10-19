# AGR-1 task: IFZ contracts and worker registry

Read `docs/IFZ-UNIFIED-APP-ARCHITECTURE.md` first.

Implement the first isolated backend slice for the approved IFZ architecture.

Own only:

- `packages/orchestration-core/src/ifz/contracts.js`
- `packages/orchestration-core/src/ifz/worker-registry.js`
- `packages/orchestration-core/test/ifz-contracts.test.js`
- `packages/orchestration-core/test/ifz-worker-registry.test.js`
- `docs/execution/AGR-1-ifz-contracts.md`

Do not modify shared exports, existing dispatcher files, package manifests, control-center files, or another worker's paths.

Requirements:

- Define validated worker manifest, task envelope, route request, context reference, public event, and delivery receipt shapes.
- Require exact worker, adapter, project, workspace, task, run, and conversation identities.
- Keep read, write, create, execute, external-send, inference, and computer effects separate.
- Reject malformed booleans, empty identities, unknown effect classes, duplicate worker identities, and authority growth.
- Implement a registry with register, replace-by-exact-revision, list, get, capability query, and availability projection.
- Registry results must be immutable copies.
- Availability must include observation time and cannot imply completion.
- Do not store secrets, prompt text, source, credentials, or raw private reasoning in receipts.
- Use deterministic unit tests. Do not use network, live inference, native input, Git mutation, or new dependencies.

Run only the new focused tests. Record files, commands, results, and limits in the receipt.

