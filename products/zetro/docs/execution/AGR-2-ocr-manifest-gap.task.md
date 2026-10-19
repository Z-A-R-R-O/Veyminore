# AGR-2 OCR manifest gap closure

OCR-4 is definitively blocked by its package write/edit permissions and changed no package files. Close only that isolated gap; do not touch your route files or shared integration files.

Own:
- packages/opencode-adapter/src/index.js
- packages/opencode-adapter/src/index.d.ts
- packages/opencode-adapter/test/adapter.test.js
- docs/execution/AGR-2-ocr-manifest-gap.md

Implement pure OCR worker manifest/availability projection:
- exact worker/session/project/workspace/model identity
- model pinned to opencode/mimo-v2.6-flash-free; no paid fallback
- effects/capabilities derived only from explicit permission input
- qualification and observation freshness required
- bounded, deeply frozen, credential-free public output
- reject duplicates, unsafe/control identities, unknown effects, wrong project/workspace, stale observations, missing qualification
- busy/idle means observed availability only and never completion
Add focused tests in existing adapter.test.js and run only that test. Read OCR-4.md for blocker/apply notes. Append honest receipt.
