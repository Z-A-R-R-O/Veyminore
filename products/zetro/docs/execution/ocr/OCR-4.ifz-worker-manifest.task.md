# OCR-4 task: IFZ OpenCode worker manifest adapter

Read `E:/Veyminore/products/zetro/docs/IFZ-UNIFIED-APP-ARCHITECTURE.md`.

Own only `E:/Veyminore/products/zetro/packages/opencode-adapter/` and append a new dated IFZ section to your existing receipt.

Implement a pure manifest and availability projection for OCR workers.

Requirements:

- Bind exact session, worker, adapter, project, directory, Git root, model provider, model, permission revision, and observation time.
- Report capabilities and effect classes from validated session permissions. Do not infer them from names.
- Report availability and last observation without inferring completion.
- Preserve the pinned `opencode/mimo-v2.6-flash-free` identity. Do not add fallback or make network calls.
- Reject changed project/directory/session/model, stale observations, malformed permissions, duplicate identities, and unknown effects.
- Return immutable bounded public objects without credentials, prompts, source, or raw errors.
- Reuse existing adapter conventions. No global settings, dependencies, live bridge sends, or shared-file edits.

Run focused package tests and record exact results and limits.

