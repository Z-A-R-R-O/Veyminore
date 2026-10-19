/**
 * @file view.js
 * Isolated worker-detail front-end module for the ZETRO control center.
 * Pure string renderer: escapes all worker-provided text/attributes, emits no
 * inline handlers/styles/scripts, performs no network or storage access.
 * Parent owns integration (imports, routes, DOM mounting).
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function has(value) {
  return value !== undefined && value !== null && value !== '';
}

function text(value, fallback) {
  return has(value) ? esc(value) : esc(fallback);
}

function formatObservedAt(observedAt) {
  if (!has(observedAt)) return 'Not available';
  try {
    const date = new Date(observedAt);
    if (Number.isNaN(date.getTime())) return 'Not available';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Not available';
  }
}

function liveStateLabel(live) {
  const raw = String(live?.state ?? '').toLowerCase();
  if (!raw) return 'Unavailable';
  if (raw === 'not_connected' || raw === 'not-connected') return 'Not connected';
  if (raw === 'unavailable') return 'Unavailable';
  const active = ['busy', 'running', 'working', 'in_progress', 'in-progress'].includes(raw);
  if (active) return 'Running — unverified';
  return raw.replaceAll('_', ' ');
}

function liveStateKey(live) {
  const raw = String(live?.state ?? 'unavailable').toLowerCase();
  return esc(raw.replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'unavailable');
}

function isActiveLive(live) {
  const raw = String(live?.state ?? '').toLowerCase();
  return ['busy', 'running', 'working', 'in_progress', 'in-progress'].includes(raw);
}

function stageStrip(worker) {
  const stages = [
    ['Dispatch', has(worker?.dispatch)],
    ['Live', has(worker?.live)],
    ['Review', has(worker?.acceptance)],
  ];
  return `<ol class="wd-stages" aria-label="Task stages from known fields only">${stages
    .map(
      ([label, known]) =>
        `<li class="wd-stage" data-known="${known ? 'true' : 'false'}">${known ? esc(label) : `${esc(label)} — unknown`}</li>`,
    )
    .join('')}</ol>`;
}

function stepsList(live) {
  const steps = live?.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return '<p class="wd-empty">No steps reported.</p>';
  }
  const items = steps
    .slice(0, 50)
    .map((step) => {
      if (typeof step === 'string' || typeof step === 'number') return `<li>${esc(step)}</li>`;
      if (step && typeof step === 'object') {
        const label = step.text ?? step.message ?? step.title ?? step.label;
        return `<li>${has(label) ? esc(label) : 'Unnamed step'}</li>`;
      }
      return '<li>Unnamed step</li>';
    })
    .join('');
  return `<ol class="wd-steps">${items}</ol>`;
}

function ownedPathsList(ownedPaths) {
  if (!Array.isArray(ownedPaths) || ownedPaths.length === 0) {
    return '<p class="wd-empty">Not recorded.</p>';
  }
  const items = ownedPaths
    .slice(0, 100)
    .map((path) => `<li><code>${esc(path)}</code></li>`)
    .join('');
  return `<ul class="wd-paths">${items}</ul>`;
}

/**
 * Render the worker-detail view as an HTML string.
 * @param {object} [worker] existing worker shape: name, group, taskId,
 *        objective, dispatch, acceptance, ownedPaths, live {state, source, observation, steps}
 * @param {object} [options]
 * @param {string|number|Date} [options.observedAt] live-observation timestamp
 * @returns {string} HTML string scoped under .worker-detail-view
 */
export function renderWorkerDetail(worker, { observedAt } = {}) {
  if (!worker || typeof worker !== 'object') {
    return `<section class="worker-detail-view" aria-label="Worker detail"><div class="wd-panel"><h2 class="wd-name">Worker details unavailable</h2><p class="wd-empty">No worker record was supplied to this view.</p></div></section>`;
  }

  const live = worker.live && typeof worker.live === 'object' ? worker.live : null;
  const acceptance = worker.acceptance && typeof worker.acceptance === 'object' ? worker.acceptance : null;
  const group = has(worker.group) ? String(worker.group) : '—';
  const avatarLetter = esc(group.trim().charAt(0).toUpperCase() || '?');

  return `<section class="worker-detail-view" aria-label="Worker detail">
  <header class="wd-header">
    <div class="wd-identity">
      <span class="wd-avatar" aria-hidden="true">${avatarLetter}</span>
      <div class="wd-identity-text">
        <h2 class="wd-name">${text(worker.name, 'Unnamed worker')}</h2>
        <p class="wd-sub"><span class="wd-group">${esc(group)}</span>${has(worker.taskId) ? ` · <code class="wd-task">${esc(worker.taskId)}</code>` : ''}</p>
      </div>
    </div>
    <span class="wd-live${isActiveLive(live) ? ' is-running' : ''}" data-state="${liveStateKey(live)}"><span class="wd-dot" aria-hidden="true"></span>${esc(liveStateLabel(live))}</span>
  </header>
  <p class="wd-observed">Observed ${esc(formatObservedAt(observedAt))} · live observation is unverified and separate from accepted evidence</p>

  ${stageStrip(worker)}

  <div class="wd-grid">
    <section class="wd-panel wd-assignment" aria-labelledby="wd-h-assignment">
      <h3 id="wd-h-assignment" class="wd-h">Current assignment</h3>
      ${has(worker.taskId) ? `<p class="wd-lead"><code>${esc(worker.taskId)}</code></p>` : ''}
      <p>${text(worker.objective, 'No objective is recorded for this worker in saved coordination records.')}</p>
    </section>

    <section class="wd-panel wd-live-panel" aria-labelledby="wd-h-live">
      <h3 id="wd-h-live" class="wd-h">Live observation <span class="wd-tag">Unverified</span></h3>
      <p class="wd-meta"><span class="wd-meta-label">State</span> ${esc(liveStateLabel(live))}</p>
      <p class="wd-meta"><span class="wd-meta-label">Source</span> ${text(live?.source, 'Not connected')}</p>
      <p>${text(live?.observation, 'No live observation is available for this worker.')}</p>
      ${stepsList(live)}
    </section>

    <section class="wd-panel wd-evidence" aria-labelledby="wd-h-evidence">
      <h3 id="wd-h-evidence" class="wd-h">Previously accepted evidence <span class="wd-tag wd-tag-soft">Saved review</span></h3>
      <p class="wd-note">${acceptance?.taskId ? `Accepted task: ${esc(acceptance.taskId)}. ` : ''}This can describe an earlier increment; it does not accept the current assignment.</p>
      <p>${text(acceptance?.evidence, 'No independently accepted increment is recorded for this worker.')}</p>
      ${has(acceptance?.limits) ? `<p class="wd-note">${esc(acceptance.limits)}</p>` : ''}
    </section>

    <section class="wd-panel wd-scope" aria-labelledby="wd-h-scope">
      <h3 id="wd-h-scope" class="wd-h">Owned scope</h3>
      ${ownedPathsList(worker.ownedPaths)}
    </section>

    <section class="wd-panel wd-review" aria-labelledby="wd-h-review">
      <h3 id="wd-h-review" class="wd-h">Saved review / dispatch</h3>
      <p>${text(worker.dispatch, 'No saved dispatch state is recorded.')}</p>
      <p class="wd-note">Review acceptance is separate from the live observation above.</p>
    </section>

    <section class="wd-panel wd-timeline" aria-labelledby="wd-h-timeline">
      <h3 id="wd-h-timeline" class="wd-h">Event timeline</h3>
      <p class="wd-empty">Not connected</p>
      <p class="wd-note">This preview shows saved coordination records only. It never invents logs or progress.</p>
    </section>
  </div>
</section>`;
}
