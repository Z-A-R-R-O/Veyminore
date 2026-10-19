# OCR-3 IFZ projection rework

Your implementation exists, but the promised test file was not created and the focused command fails with file-not-found. Complete using existing files only.

Own:
- packages/computer-observer/src/ifz-projection.js
- packages/computer-observer/src/index.js
- packages/computer-observer/types/index.d.ts
- packages/computer-observer/test/observer.test.js
- packages/computer-observer/README.md
- docs/execution/ocr/OCR-3.md

Append focused IFZ projection tests to existing test/observer.test.js. Add adversarial coverage for accessors/non-plain/cyclic/deep objects before JSON serialization, UTF-8 byte bounds, duplicate evidence refs, exact source/project/workspace identity, stale/future/reordered/duplicate events, and proof-state rules. Do not allow connected/idle/busy/self-report to prove completion. Run node --test packages/computer-observer/test/observer.test.js and append exact results.
