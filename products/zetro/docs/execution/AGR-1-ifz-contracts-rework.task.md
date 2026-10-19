# AGR-1 IFZ contracts rework

Correct only your IFZ contract and registry slice. Do not integrate shared UI/server files.

Acceptance:
- Use the canonical route strategy identifiers exactly: parallel, sequential, review-chain, first-verified, compare, bounded-delegation. Remove underscore aliases from the public contract.
- Reject non-plain objects, accessors, unsafe prototypes, control characters in identities, NaN/Infinity, duplicate capability/action/context entries, and malformed nested arrays.
- Bound input depth, collection lengths, string UTF-8 bytes, and serialized size before deep clone/hash/freeze. Cycles must fail deterministically.
- Worker manifests must include exact identity/revision/observation, capabilities/effects/limits/delegation/qualification. Registry queries must enforce project, workspace, qualification, availability, and observation freshness.
- Task envelopes must preserve task/run/conversation/parent/source/destination IDs, Master Prompt/context versions, project/workspace, effects/scopes, time/token/provider/worker/depth/branch budgets, and cancellation ID.
- Add focused adversarial tests. Run only IFZ contract/registry tests.
- Append an honest receipt to docs/execution/AGR-1-ifz-contracts.md with changed files and exact results.
