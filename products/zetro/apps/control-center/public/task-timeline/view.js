/**
 * @file view.js
 * Isolated task-timeline front-end module for the ZETRO control center.
 * Pure string renderer: escapes all provided text/attributes, emits no inline
 * handlers/styles/scripts, performs no network or storage access. Renders only
 * the events it is given — never invents logs, stages, or progress percentages.
 * Parent owns integration (imports, stylesheet link, DOM mounting).
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const MAX_EVENTS = 100;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function has(value) {
  return value !== undefined && value !== null && value !== '';
}

function isIdentityValue(value) {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/** Missing/invalid identity -> the literal label "Unavailable" (escaped). */
function identity(value) {
  if (!isIdentityValue(value)) return 'Unavailable';
  const str = String(value).trim();
  if (str === '') return 'Unavailable';
  return esc(str);
}

/** Trusted numeric epoch-ms view of a provided timestamp; null when unusable. */
function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function formatTimestamp(ms) {
  if (ms === null) return 'Not available';
  try {
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return 'Not available';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Not available';
  }
}

function typeKey(type) {
  const raw = String(type ?? '').toLowerCase();
  return esc(raw.replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'unspecified');
}

/**
 * Stable sort on trusted provided timestamp, then id. Non-object entries and
 * entries without a usable timestamp sort after those with one (stable order kept).
 */
function sortEvents(events) {
  return events
    .filter((event) => event && typeof event === 'object' && !Array.isArray(event))
    .map((event, index) => ({ event, index, ms: timestampMs(event.timestamp) }))
    .sort((a, b) => {
      const aMs = a.ms ?? Number.POSITIVE_INFINITY;
      const bMs = b.ms ?? Number.POSITIVE_INFINITY;
      if (aMs !== bMs) return aMs - bMs;
      const aId = isIdentityValue(a.event.id) ? String(a.event.id) : '';
      const bId = isIdentityValue(b.event.id) ? String(b.event.id) : '';
      if (aId !== bId) return aId < bId ? -1 : 1;
      return a.index - b.index; // stable tie-break on provided order
    });
}

function eventItem(entry) {
  const event = entry.event;
  const ms = entry.ms;
  const type = isIdentityValue(event.type) && String(event.type).trim() !== '' ? esc(event.type) : 'Unnamed event';
  const summary = has(event.summary) ? esc(event.summary) : 'No summary reported.';
  const timeText = formatTimestamp(ms);

  return `<li class="tt-item" data-type="${typeKey(event.type)}">
    <div class="tt-meta">
      <span class="tt-id"><span class="tt-meta-label">Task</span> <code class="tt-task">${identity(event.taskId)}</code></span>
      <span class="tt-id"><span class="tt-meta-label">Attempt</span> <code class="tt-attempt">${identity(event.attemptId)}</code></span>
      <time class="tt-time"${ms !== null ? ` datetime="${esc(new Date(ms).toISOString())}"` : ''}>${esc(timeText)}</time>
    </div>
    <p class="tt-event">${type}</p>
    <p class="tt-summary">${summary}</p>
  </li>`;
}

function emptyState(connected) {
  const message = connected ? 'No events reported' : 'Not connected';
  return `<p class="tt-empty" data-state="${connected ? 'connected-empty' : 'disconnected'}">${esc(message)}</p>`;
}

/**
 * Render the task timeline as an HTML string.
 * @param {unknown[]} events explicit events: { id, taskId, attemptId, type, timestamp, summary }
 * @param {object} [options]
 * @param {boolean} [options.connected=false] false (default) shows "Not connected" when empty
 * @returns {string} HTML string scoped under .task-timeline-view
 */
export function renderTaskTimeline(events, { connected = false } = {}) {
  const isConnected = connected === true;
  const list = Array.isArray(events) ? events : [];

  if (list.length === 0) {
    return `<section class="task-timeline-view" aria-label="Task timeline">
  <div class="tt-head"><h3 class="tt-title">Task timeline</h3></div>
  ${emptyState(isConnected)}
</section>`;
  }

  const sorted = sortEvents(list);
  const shown = sorted.slice(0, MAX_EVENTS);
  const overflow = sorted.length > MAX_EVENTS;

  return `<section class="task-timeline-view" aria-label="Task timeline">
  <div class="tt-head">
    <h3 class="tt-title">Task timeline</h3>
    <span class="tt-count">${shown.length} of ${sorted.length} event${sorted.length === 1 ? '' : 's'}</span>
  </div>
  <ol class="tt-list">${shown.map(eventItem).join('')}</ol>
  ${overflow ? `<p class="tt-note">Showing the first ${MAX_EVENTS} events by timestamp; later events are not rendered.</p>` : ''}
</section>`;
}

/* ============ IFZ run timeline (source module extension, standalone) ============ */

/** Render bounds — every text field is truncated to these caps before escaping. */
export const IFZ_LIMITS = Object.freeze({
  promptPreview: 140,
  summary: 200,
  detail: 240,
  toolOutput: 160,
  routeSteps: 12,
  delegationSteps: 12,
  totalEvents: 100
});

export const IFZ_EVENT_KINDS = Object.freeze([
  'prompt_reference',
  'route_plan',
  'worker_request',
  'public_status',
  'result',
  'verification',
  'handoff',
  'question',
  'failure',
  'cancellation',
  'uncertain_delivery'
]);

const IFZ_KIND_LABELS = Object.freeze({
  prompt_reference: 'Prompt reference',
  route_plan: 'Route plan',
  worker_request: 'Worker request',
  public_status: 'Public status',
  result: 'Result',
  verification: 'Verification',
  handoff: 'Handoff',
  question: 'Question',
  failure: 'Failure',
  cancellation: 'Cancellation',
  uncertain_delivery: 'Uncertain delivery'
});

const IFZ_STATE_LABELS = Object.freeze({
  loading: 'Loading…',
  disconnected: 'Not connected',
  running: 'Running',
  partial_failure: 'Partial failure',
  uncertain: 'Uncertain',
  cancelled: 'Cancelled',
  complete: 'Complete'
});

const IFZ_TONE_KINDS = Object.freeze(['failure', 'cancellation', 'uncertain_delivery']);

/** Defense-in-depth secret masking applied before escaping (contract also whitelists fields). */
const IFZ_SECRET_RE = /\b(?:sk|api|tok|key|secret|pass|auth|bearer)[-_:= ][A-Za-z0-9/+._-]{6,}\b/gi;

function ifzText(value, max) {
  if (!has(value)) return '';
  let str = String(value).replace(/\s+/g, ' ').trim().replace(IFZ_SECRET_RE, '[redacted]');
  if (str.length > max) str = `${str.slice(0, max)}…`;
  return esc(str);
}

function ifzKind(kind) {
  const raw = isIdentityValue(kind) ? String(kind).trim() : '';
  if (Object.prototype.hasOwnProperty.call(IFZ_KIND_LABELS, raw)) {
    return { key: raw, label: IFZ_KIND_LABELS[raw], known: true };
  }
  return { key: 'unknown', label: 'Unknown event', known: false };
}

function ifzStatusKey(value) {
  const raw = String(value ?? '').toLowerCase();
  return esc(raw.replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'unspecified');
}

function ifzWorkers(event) {
  return `<div class="ifz-workers">
      <span class="ifz-worker"><span class="ifz-meta-label">Produced by</span> ${identity(event.producingWorker)}</span>
      <span class="ifz-worker"><span class="ifz-meta-label">Requested by</span> ${identity(event.requestingWorker)}</span>
    </div>`;
}

function ifzClaim(event) {
  const claim = event.claim;
  if (claim === undefined || claim === null || claim === '') return '';
  if (typeof claim === 'object' && !Array.isArray(claim)) {
    const who = identity(claim.workerId);
    const text = ifzText(claim.summary, IFZ_LIMITS.summary) || 'No claim text reported.';
    const whoBit = who === 'Unavailable' ? '' : `<span class="ifz-claim-who">${who}</span> `;
    return `<p class="ifz-claim"><span class="ifz-badge ifz-badge-claim">Worker claim</span><span class="ifz-claim-src">${whoBit}${text}</span></p>`;
  }
  return `<p class="ifz-claim"><span class="ifz-badge ifz-badge-claim">Worker claim</span><span class="ifz-claim-src">${ifzText(claim, IFZ_LIMITS.summary)}</span></p>`;
}

function ifzVerification(event) {
  const v = event.verification;
  if (v === undefined || v === null || v === '') return '';
  const badge = '<span class="ifz-badge ifz-badge-verified">Independent verification</span>';
  if (typeof v === 'object' && !Array.isArray(v)) {
    const status = isIdentityValue(v.status) && String(v.status).trim() !== ''
      ? esc(String(v.status).trim().toLowerCase().slice(0, 32))
      : 'not recorded';
    const verifier = identity(v.verifier);
    const text = ifzText(v.summary, IFZ_LIMITS.summary);
    return `<p class="ifz-verification">${badge}<span class="ifz-verif-meta"><span class="ifz-verif-status" data-status="${ifzStatusKey(v.status)}">Status: ${status}</span> · Verifier: ${verifier}</span>${text ? `<span class="ifz-verif-text">${text}</span>` : ''}</p>`;
  }
  return `<p class="ifz-verification">${badge} ${ifzText(v, IFZ_LIMITS.summary)}</p>`;
}

function ifzDelegation(event) {
  const d = event.delegated;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return '';
  const parts = [];
  if (has(d.summary)) parts.push(`<p class="ifz-deleg-summary">${ifzText(d.summary, IFZ_LIMITS.detail)}</p>`);
  if (Array.isArray(d.steps) && d.steps.length > 0) {
    const items = d.steps
      .slice(0, IFZ_LIMITS.delegationSteps)
      .map((step) => {
        const label =
          typeof step === 'string' || typeof step === 'number'
            ? ifzText(step, 120)
            : ifzText(step && (step.label ?? step.step ?? step.text), 120);
        return `<li>${label || 'Unnamed step'}</li>`;
      })
      .join('');
    parts.push(`<ol class="ifz-deleg-steps">${items}</ol>`);
  }
  if (has(d.toolOutput)) {
    parts.push(
      `<p class="ifz-deleg-output"><span class="ifz-meta-label">Tool output (bounded)</span> ${ifzText(d.toolOutput, IFZ_LIMITS.toolOutput) || 'Not reported.'}</p>`
    );
  }
  if (parts.length === 0) parts.push('<p class="ifz-deleg-summary">No delegation details reported.</p>');
  return `<details class="ifz-delegation"><summary>Delegation details</summary>${parts.join('')}</details>`;
}

function ifzEventItem(entry) {
  const event = entry.event;
  const kind = ifzKind(event.kind);
  const ms = entry.ms;
  const tone = IFZ_TONE_KINDS.includes(kind.key) ? kind.key.replace(/_/g, '-') : '';
  const summary = ifzText(event.summary, IFZ_LIMITS.summary) || 'No summary reported.';
  const kindLabel = kind.known ? esc(kind.label) : `${esc(kind.label)} — unrecognized kind`;
  return `<li class="ifz-event" data-kind="${esc(kind.key)}"${tone ? ` data-tone="${esc(tone)}"` : ''}>
      <div class="ifz-event-head">
        <span class="ifz-kind">${kindLabel}</span>
        <time class="ifz-time"${ms !== null ? ` datetime="${esc(new Date(ms).toISOString())}"` : ''}>${esc(formatTimestamp(ms))}</time>
      </div>
      ${ifzWorkers(event)}
      <p class="ifz-summary">${summary}</p>
      ${ifzClaim(event)}
      ${ifzVerification(event)}
      ${ifzDelegation(event)}
    </li>`;
}

function ifzOrderedEntries(objects) {
  return objects
    .map((event, index) => ({ event, index, ms: timestampMs(event.timestamp) }))
    .sort((a, b) => {
      const aMs = a.ms ?? Number.POSITIVE_INFINITY;
      const bMs = b.ms ?? Number.POSITIVE_INFINITY;
      if (aMs !== bMs) return aMs - bMs;
      const aId = isIdentityValue(a.event.id) ? String(a.event.id) : '';
      const bId = isIdentityValue(b.event.id) ? String(b.event.id) : '';
      if (aId !== bId) return aId < bId ? -1 : 1;
      return a.index - b.index;
    });
}

function ifzStateBadge(state, label) {
  if (!label) return '';
  const busy = state === 'loading' ? ' aria-busy="true"' : '';
  return `<span class="ifz-state" data-state="${esc(state)}"${busy} aria-live="polite">${esc(label)}</span>`;
}

function ifzPromptBlock(source) {
  const prompt = source.promptRef && typeof source.promptRef === 'object' && !Array.isArray(source.promptRef)
    ? source.promptRef
    : null;
  if (!prompt) return '';
  const preview = has(prompt.preview)
    ? `<span class="ifz-prompt-preview">${ifzText(prompt.preview, IFZ_LIMITS.promptPreview)}</span>`
    : '';
  return `<p class="ifz-prompt"><span class="ifz-meta-label">Prompt reference</span> <code class="ifz-prompt-id">${identity(prompt.id)}</code> ${preview}<span class="ifz-note-inline">Reference only — full prompt text is never rendered.</span></p>`;
}

function ifzRouteBlock(source) {
  const route = source.route;
  const steps = Array.isArray(route)
    ? route
    : route && typeof route === 'object' && Array.isArray(route.steps)
      ? route.steps
      : null;
  if (!steps || steps.length === 0) return '';
  const items = steps
    .slice(0, IFZ_LIMITS.routeSteps)
    .map((step) => {
      const s = step && typeof step === 'object' && !Array.isArray(step) ? step : { label: step };
      const label = ifzText(s.label, 120) || 'Unnamed step';
      const target = has(s.target) ? ` <code class="ifz-route-target">${ifzText(s.target, 80)}</code>` : '';
      return `<li><span class="ifz-route-label">${label}</span>${target}</li>`;
    })
    .join('');
  return `<section class="ifz-route" aria-label="IFZ route plan"><h4 class="ifz-subhead">Route plan</h4><ol class="ifz-route-list">${items}</ol></section>`;
}

/**
 * Render the IFZ run timeline as an HTML string (standalone source module).
 * Semantic markup only; expansion uses native <details> (keyboard accessible);
 * all input is escaped, whitelisted, bounded, and secret-masked. Never renders
 * raw HTML, private reasoning, secrets, full prompt text, or unbounded output.
 * @param {object} [run] { state, promptRef:{id,preview}, route:{steps:[{label,target}]},
 *   events:[{ id, kind, timestamp, summary, producingWorker, requestingWorker,
 *     branchId?, claim?, verification?, delegated? }] }
 * @param {object} [options]
 * @param {boolean} [options.connected=false] empty/disconnected copy selection
 * @returns {string} HTML string scoped under .ifz-run-view
 */
export function renderIfzRunTimeline(run, { connected = false } = {}) {
  const isConnected = connected === true;
  const source = run && typeof run === 'object' && !Array.isArray(run) ? run : null;
  const state = source && isIdentityValue(source.state) ? String(source.state).trim().toLowerCase() : '';
  const rawEvents = source && Array.isArray(source.events) ? source.events : [];
  const stateLabel = IFZ_STATE_LABELS[state] || null;
  const title = '<h3 class="ifz-title">IFZ run timeline</h3>';

  if (rawEvents.length === 0) {
    let message;
    let emptyState;
    if (state === 'loading') {
      message = 'Loading…';
      emptyState = 'loading';
    } else if (!isConnected || state === 'disconnected') {
      message = 'Not connected';
      emptyState = 'disconnected';
    } else {
      message = 'No events reported';
      emptyState = 'empty';
    }
    return `<section class="ifz-run-view" aria-label="IFZ run timeline">
  <div class="ifz-head">${title}${ifzStateBadge(state, stateLabel)}</div>
  <p class="ifz-empty" data-state="${esc(emptyState)}">${esc(message)}</p>
</section>`;
  }

  const objects = rawEvents.filter((event) => event && typeof event === 'object' && !Array.isArray(event));
  const ordered = ifzOrderedEntries(objects);
  const shown = ordered.slice(0, IFZ_LIMITS.totalEvents);
  const truncated = ordered.length > IFZ_LIMITS.totalEvents;

  const groups = new Map();
  for (const entry of shown) {
    const rawBranch = entry.event.branchId;
    const branchId =
      isIdentityValue(rawBranch) && String(rawBranch).trim() !== ''
        ? String(rawBranch).trim().slice(0, 64)
        : 'main';
    if (!groups.has(branchId)) groups.set(branchId, []);
    groups.get(branchId).push(entry);
  }
  const branchKeys = [...groups.keys()].sort((a, b) => {
    if (a === 'main') return -1;
    if (b === 'main') return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const branchHtml = branchKeys
    .map((key) => {
      const title_ = key === 'main' ? 'Main' : `Branch ${key}`;
      return `<section class="ifz-branch" data-branch="${esc(key)}" aria-label="${esc(title_)}">
      <h4 class="ifz-subhead">${esc(title_)}</h4>
      <ol class="ifz-events">${groups.get(key).map(ifzEventItem).join('')}</ol>
    </section>`;
    })
    .join('');

  const count = `<span class="ifz-count">${shown.length} of ${ordered.length} event${ordered.length === 1 ? '' : 's'}</span>`;

  return `<section class="ifz-run-view" aria-label="IFZ run timeline">
  <div class="ifz-head">
    ${title}
    ${ifzStateBadge(state, stateLabel)}
    ${count}
  </div>
  ${ifzPromptBlock(source)}
  ${ifzRouteBlock(source)}
  ${branchHtml}
  ${truncated ? `<p class="ifz-note">Showing the first ${IFZ_LIMITS.totalEvents} events; later events are not rendered.</p>` : ''}
</section>`;
}
