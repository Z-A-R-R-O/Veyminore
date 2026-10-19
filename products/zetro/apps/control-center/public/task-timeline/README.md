# task-timeline — isolated task event timeline

Read-only event timeline module for the ZETRO control center. Pure string renderer; the parent owns imports, routing, and DOM mounting. No dependencies, no external assets, no network/storage access, no inline handlers/styles/scripts.

## Exports (exact)

`view.js` (ESM):

```js
export function renderTaskTimeline(events, { connected = false } = {}) // -> HTML string
```

### Input contract

- `events` — array of explicit event objects. Required per event (missing/invalid rendered honestly, never invented):

  ```js
  { id, taskId, attemptId, type, timestamp, summary }
  ```

  - `id` — used only for stable sorting and tie-breaking (string/number).
  - `taskId`, `attemptId` — identity; missing/invalid (empty, non-scalar) renders the label `Unavailable`.
  - `type` — the concise event name; missing renders `Unnamed event`.
  - `timestamp` — trusted provided value (epoch ms number, Date, or parseable string). Unusable → `Not available` in the UI, sorted after usable timestamps.
  - `summary` — one-line description; missing renders `No summary reported.`.
  - Non-object array entries are omitted (documented; nothing is fabricated to replace them).
- `options.connected` — `false` (default). Empty input renders `Not connected` when disconnected, `No events reported` when `connected: true`.
- Returns an HTML string scoped under `.task-timeline-view`. All provided text and attribute values are HTML-escaped.

### Ordering and bounds

- Stable sort on the provided `timestamp`, then `id`, then original array order. No re-timestamping.
- Bounded to 100 rendered events (earliest first); a note discloses the cap when exceeded.

`style.css`: classes prefixed `tt-` under `.task-timeline-view`; inherits Satoshi tokens from `/style.css` with standalone fallbacks. Readable 14px Satoshi, neutral surfaces, restrained green accents, responsive padding ≤580px.

## Integration example (parent-owned)

```js
import { renderTaskTimeline } from '/task-timeline/view.js';
// add <link rel="stylesheet" href="/task-timeline/style.css"> in index.html (parent decision)

const html = renderTaskTimeline(events, { connected: socketIsOpen });
document.querySelector('#task-timeline').innerHTML = html;
```

## Guarantees

- Escapes all input text/attributes; no inline event handlers, styles, or scripts.
- No invented logs, stages, or percentages — only the provided events are rendered.
- Empty disconnected state says `Not connected`; empty connected state says `No events reported`.
- Invalid/missing identity shows `Unavailable`; invalid timestamps show `Not available`.
- No execute/control inputs are rendered.

## IFZ run timeline (source module extension)

```js
export function renderIfzRunTimeline(run, { connected = false } = {}) // -> HTML string (scoped under .ifz-run-view)
export const IFZ_EVENT_KINDS   // the 11 contract kinds
export const IFZ_LIMITS        // render bounds
```

`ifz-fixtures.js` exports `IFZ_FIXTURES` / `IFZ_FIXTURE_NAMES` — the eight reference states: `empty`, `loading`, `disconnected`, `running`, `partial_failure`, `uncertain`, `cancelled`, `complete`.

### Input contract (`run`)

- `state` — one of `loading | disconnected | running | partial_failure | uncertain | cancelled | complete` (badge label; unknown states show no badge).
- `promptRef: { id, preview }` — reference only; preview is bounded (140 chars) and the full prompt text is never rendered.
- `route: { steps: [{ label, target }] }` — route plan, bounded to 12 steps.
- `events[]` — `{ id, kind, timestamp, summary, producingWorker, requestingWorker, branchId?, claim?, verification?, delegated? }`
  - `kind` — one of `IFZ_EVENT_KINDS`; unknown kinds render as `Unknown event — unrecognized kind`.
  - `claim` — the producing worker's own claim (string or `{workerId, summary}`) → **Worker claim** badge (warm neutral).
  - `verification` — `{verifier, status, summary}` → **Independent verification** badge (green), visually and structurally distinct from claims.
  - `delegated: { summary, steps[], toolOutput }` — collapsed behind native `<details>/<summary>` (keyboard expandable), all fields bounded (detail 240, steps 12×120, tool output 160).
  - `branchId` — parallel branches render as separate labeled sections; `main` first.

### Guarantees (IFZ)

- Escapes everything; raw HTML from input is never emitted. Whitelisted fields only — private reasoning, secrets, and unknown fields are dropped; secret-shaped tokens are additionally masked to `[redacted]`.
- No full prompt text, no unbounded tool output, no invented logs/stages/percentages.
- Empty copy: `Not connected` (default/disconnected), `Loading…` (with `aria-busy="true"`), `No events reported` (connected, no events).
- Semantic markup (`section/ol/li/time/details/summary`), native keyboard expansion, visible `:focus-visible` outlines, `prefers-reduced-motion` honored; bounded to 100 events with a disclosure note.

### Browser-integration limits

- Standalone only: the live app was not touched — no imports wired into `index.html`/`app.js`, no stylesheet link added, no fixtures mounted. Parent must add `<link rel="stylesheet" href="/task-timeline/style.css">` and mount the returned HTML itself.
- No runtime behavior (sockets, loaders) ships here; `connected`/`loading` states are decided by the caller.
- Author could not execute tests (no shell in authoring environment) — see `test/ifz-timeline.test.js`; coordinator runs `node --test apps/control-center/public/task-timeline/test/`.

Tests NOT RUN in this pass (author has no shell; coordinator verifies on integration).
