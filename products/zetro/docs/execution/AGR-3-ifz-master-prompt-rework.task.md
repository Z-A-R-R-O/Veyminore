# AGR-3 IFZ Master Prompt rework

Correct only your Master Prompt/context/preset slice. Do not integrate shared UI/server files.

Acceptance:
- Treat forbidden material structurally: reject credential/secret fields, .env material, private reasoning/model-thinking fields, and full-transcript payloads at every nested level. Regex redaction may be defense-in-depth only.
- Reject cycles, accessors, unsafe prototypes, excessive nesting, oversized arrays/objects, and values over strict UTF-8 byte limits before serialization.
- Preserve four immutable, versioned layers and exact boot order.
- Presets and context packages must never widen destination, project/workspace, paths, effects, time/tokens/provider attempts/worker count/depth/branches, or delegation authority.
- Acknowledgment is admission evidence only; never represent it as dispatch, completion, or verification.
- Add adversarial tests for all cases above and run only focused Master Prompt/context tests.
- Append an honest receipt to docs/execution/AGR-3-ifz-master-prompt.md.
