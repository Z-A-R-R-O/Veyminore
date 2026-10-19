# worker-detail — isolated worker detail view

Read-only detail module for the ZETRO control center. Pure string renderer; the parent owns imports, routing, and DOM mounting. No dependencies, no external assets, no network/storage access, no inline handlers/styles/scripts.

## Exports (exact)

`view.js` (ESM):

```js
export function renderWorkerDetail(worker, { observedAt } = {}) // -> HTML string
```

- `worker` — existing worker object (see shape below). Missing fields render honest fallbacks ("Not recorded", "No objective is recorded…").
- `options.observedAt` — live-observation timestamp (string/number/Date). Invalid or missing → "Not available".
- Returns an HTML string scoped under `.worker-detail-view`. All worker-provided text and attribute values are HTML-escaped.

`style.css`: classes prefixed `wd-` under `.worker-detail-view`; inherits Satoshi tokens from `/style.css` with standalone fallbacks. Body/labels ≥14px, neutral surfaces, restrained green accents, responsive (single column ≤720px).

## Example worker shape

```js
{
  name: 'OCR-4',
  group: 'OCR',
  taskId: 'OCR-W1-opencode-adapter',
  objective: 'Implement the OpenCode session bridge adapter.',
  dispatch: 'Assigned — saved',
  acceptance: { evidence: 'Receipt in docs/execution/ocr/OCR-4.md.', limits: 'Tests run by coordinator.' },
  ownedPaths: ['packages/opencode-adapter/', 'docs/execution/ocr/OCR-4.md'],
  live: { state: 'busy', source: 'saved-evidence', observation: 'Writing adapter sources.', steps: ['write src', 'write tests'] }
}
```

## Integration example (parent-owned)

```js
import { renderWorkerDetail } from '/worker-detail/view.js';
// add <link rel="stylesheet" href="/worker-detail/style.css"> in index.html (parent decision)

const html = renderWorkerDetail(worker, { observedAt: data.live?.observedAt });
document.querySelector('#worker-detail').innerHTML = html; // replaces inspectWorker() markup
```

## Accessibility & containment (source-checked; author browser NOT VERIFIED)

- Muted text uses module-owned `--wd-muted: #5c6468` (host `--muted` #747b80 is only 4.30:1 on white). WCAG contrast for #5c6468: **6.04:1** on `--wd-paper` #ffffff, **5.68:1** on `--wd-canvas` #f7f8fa (timeline, tags, code backgrounds), **5.37:1** on `--wd-soft-green` #edf3ef (tag-soft). All ≥4.5:1 for normal text. Other module text: `--wd-ink` #222629 ≥14:1 on all surfaces; `--wd-green` #476b5e (panel headings, 12px) 5.94:1 on #fff / 5.59:1 on #f7f8fa; running-state #2c6b4d 6.33:1 on #fff.
- Body/labels remain ≥14px (12px only for uppercase eyebrow headings/tags per original convention, each ≥4.5:1 as above).
- 320px viewport (source check): header flex-wraps; `.wd-identity-text` min-width 0; name, task ID, code, objective, paths, and all paragraphs use `overflow-wrap: anywhere` so long unbroken IDs/text cannot overflow; grid collapses to one column ≤720px. No media query hides status, live observation, or evidence panels.
- Acceptance warning (parent-added in view.js) and the "Not connected" timeline are preserved; logs/progress are never invented.

## Guarantees

- Escapes all input text/attributes; no inline event handlers, styles, or scripts.
- Live observation is visually and textually separate from accepted evidence; observation is labeled unverified.
- Compact stage strip reflects only known fields (dispatch/live/acceptance); unknown stages say "unknown". Missing event timeline says "Not connected" — logs/progress are never invented.
- No enabled execute/approve controls are rendered.

Tests NOT RUN in this pass (coordinator verifies on integration).
