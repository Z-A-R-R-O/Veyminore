# OCR-4 IFZ worker manifest rework

Prior blocker is acknowledged. Complete this slice using existing files only because add/write is unavailable.

Own only:
- packages/opencode-adapter/src/index.js
- packages/opencode-adapter/src/index.d.ts
- packages/opencode-adapter/test/adapter.test.js
- docs/execution/ocr/OCR-4.md

Add pure exported manifest/availability functions within index.js and focused tests in adapter.test.js. Preserve opencode/mimo-v2.6-flash-free and no paid fallback. Derive effects/capabilities from explicit permissions; exact worker/session/project/workspace/model identity; bounded frozen output; reject duplicates, unsafe identities, stale observations, missing qualification, unknown effects, wrong workspace/project. Busy/idle is observed availability only, never completion. Do not read denied docs or create new files. Run the focused adapter test if shell is available and append an honest receipt.
