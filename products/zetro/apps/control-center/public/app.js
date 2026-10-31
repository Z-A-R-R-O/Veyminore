import { renderWorkerDetail } from '/worker-detail/view.js';
import { mountDock } from '/dock.js';
import { mountMagicBento } from '/bento.js';
import { mountComputerPreview, getComputerPreviewHtml } from '/computer-preview/app.js';
import { mountIfzWorkPage } from '/work.js';
import { mountAgentNav } from '/agent-nav.js';

const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  terminal: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.2 7a7 7 0 0 1 11.6-1L20 9M4 15l2.2 3A7 7 0 0 0 17.8 17"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  check: '<path d="m6 12 4 4 8-9"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  sliders: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.layers}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const labels = {
  work: 'Work',
  overview: 'Work',
  conversations: 'Conversations',
  workers: 'Workers',
  runs: 'Runs',
  activity: 'Runs',
  computer: 'Computer',
  evidence: 'Evidence',
  readiness: 'Evidence',
  settings: 'Settings',
  requirements: 'Roadmap'
};

const initialHash = window.location.hash.replace(/^#\/?/, '');
const defaultView = labels[initialHash] ? initialHash : (initialHash === 'computer-preview' ? 'computer' : 'work');
const state = { data:null, view:defaultView, group:'all', detail:'focused', error:false, selectedWorker:null };
const content = document.querySelector('#content');

const ACCENTS = {
  mint: { id: 'mint', label: 'Mint', hex: '#8ce6b8', rgb: '140, 230, 184', beacon: '#3fb950', soft: 'rgba(62, 115, 88, 0.2)' },
  cyan: { id: 'cyan', label: 'Cyan', hex: '#38bdf8', rgb: '56, 189, 248', beacon: '#0ea5e9', soft: 'rgba(14, 116, 144, 0.25)' },
  violet: { id: 'violet', label: 'Violet', hex: '#a78bfa', rgb: '167, 139, 250', beacon: '#8b5cf6', soft: 'rgba(109, 40, 217, 0.25)' },
  amber: { id: 'amber', label: 'Amber', hex: '#fbbf24', rgb: '251, 191, 36', beacon: '#f59e0b', soft: 'rgba(180, 83, 9, 0.25)' },
  rose: { id: 'rose', label: 'Rose', hex: '#fb7185', rgb: '251, 113, 133', beacon: '#f43f5e', soft: 'rgba(190, 18, 60, 0.25)' },
  silver: { id: 'silver', label: 'Silver', hex: '#e2e8f0', rgb: '226, 232, 240', beacon: '#cbd5e1', soft: 'rgba(148, 163, 184, 0.2)' }
};

let currentAccentId = 'mint';
try {
  currentAccentId = localStorage.getItem('zetro_accent') || 'mint';
} catch {}
if (!ACCENTS[currentAccentId]) currentAccentId = 'mint';

function applyAccent(accentId) {
  const accent = ACCENTS[accentId] || ACCENTS.mint;
  currentAccentId = accent.id;
  try {
    localStorage.setItem('zetro_accent', accent.id);
  } catch {}

  const root = document.documentElement;
  root.style.setProperty('--mb-glow-rgb', accent.rgb);
  root.style.setProperty('--accent', accent.beacon);
  root.style.setProperty('--green', accent.hex);
  root.style.setProperty('--soft-green', accent.soft);
  root.style.setProperty('--dock-badge', accent.beacon);
  root.style.setProperty('--dock-badge-ink', accent.id === 'silver' ? '#090a0c' : '#ffffff');
  root.setAttribute('data-accent', accent.id);
  document.body.setAttribute('data-accent', accent.id);

  document.querySelectorAll('.accent-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.accent === accent.id);
  });

  if (bentoController?.setGlowColor) {
    bentoController.setGlowColor(accent.hex);
  }

  dock?.setAccent?.(accent.id);
}

function badge(label, variant = '') { return `<span class="badge ${variant}">${escape(label)}</span>`; }
function classification(worker) {
  if (worker.group === 'RCT') return ['Not connected', 'neutral'];
  if (worker.paused) return ['Paused', 'neutral'];
  if (worker.dispatch.includes('unknown')) return ['Reconcile delivery', 'amber'];
  if (worker.dispatch.includes('review')) return ['Under review', 'amber'];
  if (worker.acceptance && !worker.dispatch.includes('submitted')) return ['Reviewed increment', ''];
  return ['Assigned -- saved', 'neutral'];
}
function liveBadge(worker) {
  const live = worker.live || {state:'unavailable'};
  const raw = String(live.state).toLowerCase();
  const active = ['busy','running','working','in_progress'].includes(raw);
  const label = raw === 'not_connected' ? 'Not connected' : raw === 'unavailable' ? 'Unavailable' : active ? 'Running - unverified' : raw.replaceAll('_',' ');
  return `<span class="live-observation ${active ? 'is-running' : ''}"><span class="status-dot"></span>${escape(label)}</span>`;
}
function metricsCards(data, reviews) {
  const planWorkers = data.workers.filter(w => w.group !== 'RCT').length;
  return `<div class="metrics-bento-grid">
    <div class="metric-card">
      <div class="magic-bento__header">
        <span class="magic-bento__icon">${icon('users')}</span>
        <span class="magic-bento__label">PLAN ASSIGNMENTS</span>
      </div>
      <div class="metric-card__value">${planWorkers}</div>
      <div class="metric-card__title">Connected to the plan</div>
      <div class="metric-card__desc">Assigned AGR & OCR workers operating in active workspace.</div>
    </div>
    <div class="metric-card">
      <div class="magic-bento__header">
        <span class="magic-bento__icon">${icon('shield')}</span>
        <span class="magic-bento__label">EVIDENCE AUDIT</span>
      </div>
      <div class="metric-card__value">${reviews}</div>
      <div class="metric-card__title">Independent acceptance</div>
      <div class="metric-card__desc">Workers with verified, independently reviewed increments.</div>
    </div>
    <div class="metric-card">
      <div class="magic-bento__header">
        <span class="magic-bento__icon">${icon('lock')}</span>
        <span class="magic-bento__label">SECURITY GATE</span>
      </div>
      <div class="metric-card__value">Read-only</div>
      <div class="metric-card__title">Preview execution mode</div>
      <div class="metric-card__desc">Protected read-only authority with zero model inference calls.</div>
    </div>
  </div>`;
}

function livePreview() {
  const data = state.data;
  return `<section class="fleet-preview">
    <div class="section-heading">
      <div>
        <span class="eyebrow">LIVE WORKSPACE</span>
        <h2>Three teams. One clear view.</h2>
      </div>
      <span class="count-pill">Refreshes every 10 seconds</span>
    </div>
    <div class="fleet-grid">${['RCT','AGR','OCR'].map(group => {
      const workers = data.workers.filter(worker => worker.group === group);
      const teamTitle = group === 'RCT' ? 'RCT Coding Fleet' : group === 'AGR' ? 'AGR Engineering Fleet' : 'OCR Computing Fleet';
      const teamDesc = group === 'RCT' ? 'Built-in synthetic coding team' : group === 'AGR' ? 'Antigravity — RCT engineering' : 'OpenCode — Native computing';
      return `<article class="fleet-team">
        <div class="magic-bento__header fleet-heading-bento">
          <span class="worker-avatar ${group.toLowerCase()}">${group[0]}</span>
          <span class="magic-bento__label">${group} FLEET</span>
          <span class="count-pill" style="margin-left:auto">${workers.length} slots</span>
        </div>
        <div class="fleet-team-info">
          <h3>${teamTitle}</h3>
          <p>${teamDesc}</p>
        </div>
        <div class="fleet-workers-list">${workers.map(worker => `
          <button class="fleet-worker" data-worker="${escape(worker.name)}">
            <span class="worker-name">
              <span class="worker-avatar ${worker.group === 'OCR' ? 'ocr' : worker.group === 'RCT' ? 'rct' : 'agr'}">${worker.group[0]}</span>
              ${escape(worker.name)}
            </span>
            ${liveBadge(worker)}
          </button>
        `).join('')}</div>
      </article>`;
    }).join('')}</div>
    <p class="section-intro">Observed activity is separate from verified completion. RCT slots stay disconnected until a persistent runtime reports their state.</p>
  </section>`;
}
function readableTask(id) {
  return String(id).replace(/^W\d+R?\d*[-_](AGR|OCR)\d*[-_]?/i, '').replace(/^W\d+[-_]/, '').replace(/[-_]/g, ' ');
}
function heading(title, description, action = '') {
  return `<section class="hero"><div><span class="eyebrow">ZETRO CONTROL CENTER</span><h1>${title}</h1><p>${description}</p></div>${action}</section>`;
}
function streamRow(name, type, description, status, track) {
  return `<div class="stream-row"><span class="stream-icon">${icon(type)}</span><div class="stream-main"><div class="stream-title">${name}</div><div class="stream-desc">${description}</div><div class="track" aria-hidden="true">${track.map(part => `<span class="${part}"></span>`).join('')}</div></div>${badge(status[0], status[1])}</div>`;
}
function workerTable(workers) {
  return `<div class="panel worker-table-panel"><div class="panel-heading"><div class="magic-bento__header"><span class="magic-bento__icon">${icon('users')}</span><span class="magic-bento__label">WORKER ROSTER</span></div><span class="count-pill">${workers.length} active</span></div><table class="worker-table"><thead><tr><th>Worker</th><th>Current assignment</th><th>Live observation</th><th>Review / dispatch</th><th aria-label="Details"></th></tr></thead><tbody>${workers.map(worker => {
    const status = classification(worker);
    return `<tr data-worker="${escape(worker.name)}" tabindex="0" role="button" aria-label="Inspect ${escape(worker.name)}"><td><span class="worker-name"><span class="worker-avatar ${worker.group === 'OCR' ? 'ocr' : ''}">${worker.group[0]}</span>${escape(worker.name)}</span></td><td><span class="task-label" title="${escape(worker.taskId)}">${escape(readableTask(worker.taskId))}</span></td><td>${liveBadge(worker)}</td><td>${badge(...status)}</td><td class="chev">${icon('chevron')}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function overview() {
  const data = state.data;
  const reviews = data.workers.filter(worker => worker.acceptance).length;
  return heading('Your agents.<br>In clear view.', 'A quieter place to follow the work.<br>Real assignments, reviewed results, and what comes next.', `<div class="hero-right"><span class="mode-label">${icon('lock')}Read-only workspace preview</span><button class="primary" data-view="readiness">Explore RCT readiness${icon('arrow')}</button></div>`) +
    livePreview() +
    metricsCards(data, reviews) +
    `<div class="section-heading"><h2>Platform capabilities</h2><span class="count-pill">Interactive Magic Bento</span></div><div id="bento-root" class="bento-showcase"></div>` +
    `<div class="columns">
      <section class="panel">
        <div class="panel-heading">
          <div class="magic-bento__header">
            <span class="magic-bento__icon">${icon('layers')}</span>
            <span class="magic-bento__label">WORKSTREAMS</span>
          </div>
          <span class="count-pill">3 active tracks</span>
        </div>
        <div class="stream">
          ${streamRow('RCT — the coding agent', 'terminal', 'Integrated offline work passes. Provider qualification<br class="wide-break"> and trusted patch review are the next gates.', ['In development','amber'], ['done','done','done','current','',''])}
          ${streamRow('Computer — controlled observation', 'screen', 'Contracts, sessions and observation have reviewed<br class="wide-break"> increments. Full integration comes next.', ['Offline foundations',''], ['done','done','current','','',''])}
          ${streamRow('Desktop — a clearer workspace', 'grid', 'You’re looking at the first local preview.<br>Task controls and native packaging are planned.', ['Preview','neutral'], ['done','current','','','',''])}
        </div>
        <div class="panel-note">${icon('shield')}Reviewed increments do not mean release-ready. Bars show sequence, not percentages.</div>
      </section>
      <aside class="panel next-panel">
        <div class="magic-bento__header">
          <span class="magic-bento__icon">${icon('layers')}</span>
          <span class="magic-bento__label">NEXT TO UNLOCK</span>
        </div>
        <div class="next-content">
          <h3>One complete<br>coding workflow.</h3>
          <p>From a clear request to a verified patch, with every step accounted for.</p>
        </div>
        <div class="next-steps-list">
          <div class="next-step"><span class="step-number">1</span><span>Bind review evidence to exact task and source.</span></div>
          <div class="next-step"><span class="step-number">2</span><span>Qualify a currently eligible free model.</span></div>
          <div class="next-step"><span class="step-number">3</span><span>Run the working demo and document its limits.</span></div>
        </div>
        <div class="next-bottom">Live qualification is still pending.</div>
      </aside>
    </div>` +
    `<div class="section-heading"><h2>Worker assignments</h2><button class="text-button" data-view="workers">View all workers${icon('arrow')}</button></div>${workerTable(data.workers.filter(worker => ['AGR-2','AGR-5','OCR-5'].includes(worker.name)))}`;
}
function readiness() {
  const items = state.data.requirements;
  return heading('A capable agent.<br>A clear path.', 'What RCT needs to operate alongside AGR and OCR. Each requirement has a boundary and an independent acceptance gate.') +
    `<div class="notice">${items.filter(item => item.state === 'reviewed').length} capability areas have reviewed increments. This is a requirements view, not a release completion percentage. Safe apply and live provider qualification remain unavailable.</div>` +
    `<section class="panel requirement-panel"><div class="panel-heading"><div class="magic-bento__header"><span class="magic-bento__icon">${icon('shield')}</span><span class="magic-bento__label">CAPABILITY REGISTER</span></div><span class="count-pill">${items.length} requirements</span></div><div class="requirement-list">${items.map(item => `
      <article class="requirement">
        <div class="requirement-header">
          <span class="requirement-id">${item.id}</span>
          ${badge(item.state === 'reviewed' ? 'Reviewed increment' : item.state === 'progress' ? 'In progress' : 'Planned', item.state === 'reviewed' ? '' : item.state === 'progress' ? 'amber' : 'neutral')}
        </div>
        <div class="requirement-content">
          <h3>${item.title}</h3>
          <p>${item.detail}</p>
        </div>
      </article>`).join('')}</div></section>`;
}
function workers() {
  const data = state.data.workers.filter(worker => state.group === 'all' || worker.group === state.group);
  return heading('Every worker.<br>In the picture.', 'RCT, AGR and OCR in one workspace. Live observations and saved review evidence are shown separately.') +
    `<div class="section-heading"><h2>Assignments <span class="count-pill">${data.length}</span></h2><div class="group-tabs" aria-label="Filter workers">${['all','RCT','AGR','OCR'].map(group => `<button data-group="${group}" class="${state.group === group ? 'active' : ''}" aria-pressed="${state.group === group}">${group === 'all' ? 'All workers' : group}</button>`).join('')}</div></div>${workerTable(data)}<p class="section-intro">Select a worker to inspect its live observation, saved task and accepted evidence. Assigned, idle, or acknowledged does not establish completion.</p>`;
}
function activity() {
  return heading('The work,<br>with a paper trail.', 'Coordinator notes explain what was reviewed, what failed, and the next bounded step. Newest saved notes appear first within each team.') +
    `<section class="panel timeline-panel"><div class="panel-heading"><div class="magic-bento__header"><span class="magic-bento__icon">${icon('activity')}</span><span class="magic-bento__label">COORDINATOR LOGS</span></div><span class="count-pill">${state.data.activity.length} entries</span></div><div class="timeline">${state.data.activity.map(item => `
      <article class="timeline-item">
        <div class="magic-bento__header">
          <span class="timeline-node"></span>
          <span class="magic-bento__label">${escape(item.team)}</span>
        </div>
        <div class="timeline-content">
          <h3>${escape(item.title)}</h3>
          <p>${escape(item.text)}</p>
        </div>
      </article>`).join('') || '<p class="section-intro">No saved coordinator notes are available.</p>'}</div></section>`;
}
function plan() {
  const phases = [
    ['01 -- FOUNDATIONS','Make one worker dependable.','Finish exact authority, independent checks, durable recovery and honest accounting.','Current focus','amber'],
    ['02 -- QUALIFICATION','Prove the complete workflow.','Accept the bounded runner, qualify the free route, then demonstrate a real synthetic coding task.','Next gate','amber'],
    ['03 -- REVIEW & EXPERIENCE','Put you in control.','Connect authenticated task controls and digest-bound patch review. Safe apply is a separate gate.','Planned','neutral'],
    ['04 -- DESKTOP & COMPUTER','Bring the workspace together.','Integrate the Computing packages, verify native Windows observation, then package the desktop app.','Planned','neutral']
  ];
  return heading('Built deliberately.<br>One gate at a time.', 'The plan is written before implementation. Current backend assignments continue independently of this front-end preview.') +
    `<div class="plan-grid">${phases.map(([label,title,detail,status,variant]) => `
      <article class="panel plan-phase">
        <div class="magic-bento__header">
          <span class="magic-bento__label">${label}</span>
          ${badge(status,variant)}
        </div>
        <div class="plan-phase-content">
          <h3>${title}</h3>
          <p>${detail}</p>
        </div>
      </article>`).join('')}</div><div class="section-heading"><h2>Definition of usable</h2></div><div class="notice">Start a scoped task. See truthful progress. Cancel safely. Recover after restart. Inspect independent evidence and review a patch. Keys stay in the backend. Source stays unchanged until a separately accepted apply operation.</div><p class="section-intro">Saved plans: docs/RCT-AGENT-REQUIREMENTS.md and docs/DESKTOP-FRONTEND-PLAN.md. Native packaging, research tools and scaled execution each have their own verification gates.</p>`;
}

let dock = null;
let currentPreviewController = null;
let bentoController = null;
let workPageController = null;
let lastAnimatedView = null;
const agentNav = mountAgentNav(document.querySelector('#agent-nav'), inspectWorker);

function render() {
  if (!state.data) return;

  if (state.view === 'computer') {
    if (workPageController) {
      workPageController.destroy();
      workPageController = null;
    }
    if (!currentPreviewController) {
      document.body.dataset.view = 'computer';
      content.innerHTML = getComputerPreviewHtml();
      currentPreviewController = mountComputerPreview(content);
    }
  } else if (state.view === 'work') {
    if (currentPreviewController) {
      currentPreviewController.destroy();
      currentPreviewController = null;
    }
    document.body.dataset.view = 'work';
    if (!workPageController) {
      content.innerHTML = '<div class="work-mount-container"></div>';
      const mountEl = content.querySelector('.work-mount-container');
      const searchParams = new URLSearchParams(window.location.search);
      const fixtureParam = searchParams.get('fixture');
      workPageController = mountIfzWorkPage(mountEl, {
        initialFixture: fixtureParam || null,
        devLab: window.location.search.includes('dev=true') || window.location.hash.startsWith('#lab')
      });
    }
  } else {
    if (currentPreviewController) {
      currentPreviewController.destroy();
      currentPreviewController = null;
    }
    if (workPageController) {
      workPageController.destroy();
      workPageController = null;
    }
    document.body.dataset.view = state.view;
    const viewRenderers = {
      overview,
      conversations: overview,
      workers,
      runs: activity,
      activity,
      computer: getComputerPreviewHtml,
      evidence: readiness,
      readiness,
      settings: overview,
      requirements: plan
    };
    content.innerHTML = (viewRenderers[state.view] || overview)();
  }

  // Handle MagicBento Mount/Unmount
  const bentoContainer = document.querySelector('#bento-root');
  if (bentoContainer) {
    if (bentoController) {
      bentoController.destroy();
      bentoController = null;
    }
    bentoController = mountMagicBento(bentoContainer, {
      glowColor: (ACCENTS[currentAccentId] || ACCENTS.mint).hex,
      onItemClick: item => {
        if (item.title?.includes('Computer Agent')) {
          state.view = 'computer';
          window.location.hash = 'computer';
          render();
          dock?.setView('computer');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (item.title?.includes('Observation') || item.title?.includes('Orchestration')) {
          state.view = 'workers';
          window.location.hash = 'workers';
          render();
          dock?.setView('workers');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (item.title?.includes('Policy') || item.title?.includes('Containment')) {
          state.view = 'readiness';
          window.location.hash = 'readiness';
          render();
          dock?.setView('readiness');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    });
  } else if (bentoController) {
    bentoController.destroy();
    bentoController = null;
  }

  const breadcrumbEl = document.querySelector('#breadcrumb');
  if (breadcrumbEl) breadcrumbEl.textContent = labels[state.view] || 'Overview';
  const breadcrumbPill = document.querySelector('#breadcrumb-pill');
  if (breadcrumbPill) {
    breadcrumbPill.classList.remove('view-switching');
    void breadcrumbPill.offsetWidth;
    breadcrumbPill.classList.add('view-switching');
  }
  if (dock) {
    dock.setView(state.view);
  }
  const updatedEl = document.querySelector('#updated');
  if (updatedEl) {
    updatedEl.textContent = `Saved evidence -- ${state.data.evidenceUpdatedAt ? new Date(state.data.evidenceUpdatedAt).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : 'not available'}`;
  }
  updateIcons();
  if (lastAnimatedView !== state.view) {
    animateViewIntro(content);
    lastAnimatedView = state.view;
  }
}

let isFirstRender = true;
function animateViewIntro(container) {
  if (!container) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const baseOffset = isFirstRender ? 140 : 0;
  isFirstRender = false;

  const hero = container.querySelector('.hero');
  if (hero) {
    const eyebrow = hero.querySelector('.eyebrow');
    const h1 = hero.querySelector('h1');
    const p = hero.querySelector('p');
    const right = hero.querySelector('.hero-right');

    const heroElements = [eyebrow, h1, p, right].filter(Boolean);
    heroElements.forEach((el, index) => {
      el.animate(
        [
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ],
        { duration: 680, delay: baseOffset + index * 55, easing: EASE_OUT, fill: 'backwards' }
      );
    });
  }

  const sectionHeadings = container.querySelectorAll('.section-heading, .notice, .group-tabs');
  sectionHeadings.forEach((heading, index) => {
    heading.animate(
      [
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ],
      { duration: 620, delay: baseOffset + 90 + index * 45, easing: EASE_OUT, fill: 'backwards' }
    );
  });

  const cards = Array.from(container.querySelectorAll('.fleet-team, .metric-card, .panel, .plan-phase'));
  cards.forEach((card, index) => {
    const cardDelay = baseOffset + 100 + Math.min(index * 55, 330);
    card.animate(
      [
        {
          opacity: 0,
          transform: 'translateY(14px) scale(0.99)'
        },
        {
          opacity: 1,
          transform: 'translateY(0) scale(1)'
        }
      ],
      { duration: 720, delay: cardDelay, easing: EASE_OUT, fill: 'backwards' }
    );

    const tiles = Array.from(card.querySelectorAll('.fleet-worker, .stream-row, .requirement, .timeline-item, .next-step'));
    tiles.forEach((tile, tileIndex) => {
      tile.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ],
        { duration: 540, delay: cardDelay + 110 + Math.min(tileIndex * 24, 240), easing: EASE_OUT, fill: 'backwards' }
      );
    });
  });

  const workerTable = container.querySelector('.worker-table');
  if (workerTable) {
    const rows = Array.from(workerTable.querySelectorAll('tbody tr'));
    rows.forEach((row, index) => {
      row.animate(
        [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ],
        { duration: 520, delay: baseOffset + 180 + Math.min(index * 24, 240), easing: EASE_OUT, fill: 'backwards' }
      );
    });
  }

  const intros = container.querySelectorAll('.section-intro');
  intros.forEach((introEl, index) => {
    introEl.animate(
      [
        { opacity: 0 },
        { opacity: 1 }
      ],
      { duration: 560, delay: baseOffset + 260 + index * 40, easing: EASE_OUT, fill: 'backwards' }
    );
  });
}

function inspectWorker(name) {
  const worker = state.data?.workers.find(item => item.name === name);
  if (!worker) return;
  state.selectedWorker = name;
  const dialog = document.querySelector('#worker-dialog');
  document.querySelector('#worker-detail').innerHTML = renderWorkerDetail(worker, {observedAt:state.data.live?.observedAt});
  if (!dialog.open) {
    dialog.showModal();
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      dialog.animate(
        [
          { opacity: 0, transform: 'translate(-50%, -46%) scale(0.96)', clipPath: 'inset(2% 4% round 20px)' },
          { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', clipPath: 'inset(0 0 round 20px)' }
        ],
        { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    }
  }
}

async function refresh() {
  const button = document.querySelector('#refresh');
  if (button && button.disabled) return;
  if (button) button.disabled = true;
  try {
    const response = await fetch('/api/status', { signal:AbortSignal.timeout(30000), cache:'no-store' });
    if (!response.ok) throw new Error('Evidence unavailable');
    const next = await response.json();
    const changed = !state.data || JSON.stringify(next.workers) !== JSON.stringify(state.data.workers);
    state.data = next;
    state.error = false;
    agentNav.update(next);
    const connEl = document.querySelector('#connection');
    if (connEl) {
      const textSpan = connEl.querySelector('.connection-text') || connEl;
      textSpan.textContent = next.live.sources.every(source => source.available) ? 'Live workspace' : 'Partial connection';
      connEl.classList.remove('offline');
    }
    const allSourcesAvailable = next.live.sources.every(source => source.available);
    dock?.setConnectionStatus?.({ connected: allSourcesAvailable, label: allSourcesAvailable ? 'Connected' : 'Partial connection' });
    if (next.workspace) dock?.setWorkspace?.(next.workspace);
    if (changed) render();
    if (document.querySelector('#worker-dialog').open && state.selectedWorker) inspectWorker(state.selectedWorker);
    const updatedEl = document.querySelector('#updated');
    if (updatedEl) {
      updatedEl.textContent = `Checked ${new Date(next.live.observedAt).toLocaleTimeString()} - auto refresh 10s`;
    }
  } catch (err) {
    console.error('[REFRESH CAUGHT ERROR]:', err);
    state.error = true;
    agentNav.update(state.data, true);
    dock?.setConnectionStatus?.({ connected: false, label: 'Connection unavailable' });
    const connEl = document.querySelector('#connection');
    if (connEl) {
      const textSpan = connEl.querySelector('.connection-text') || connEl;
      textSpan.textContent = 'Connection unavailable';
      connEl.classList.add('offline');
    }
    if (!state.data) content.innerHTML = '<section class="notice"><h2>Your workspace is unavailable.</h2><p>The local evidence service could not be reached. Refresh to try again. No tasks have been launched.</p></section>';
    const annEl = document.querySelector('#announcement');
    if (annEl) annEl.textContent = 'Evidence refresh failed. Previously displayed data may be stale.';
  } finally {
    if (button) button.disabled = false;
  }
}

function updateIcons() {
  document.querySelectorAll('[data-icon]').forEach(element => {
    element.innerHTML = icon(element.dataset.icon);
  });
}

// Mount the unified bottom navigation.
try {
  const dockRoot = document.querySelector('#dock-root');
  if (dockRoot) {
    dock = mountDock(dockRoot, {
      initialView: state.view,
      onViewChange: targetView => {
        if (state.view !== targetView) {
          state.view = targetView;
          window.location.hash = targetView;
          render();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      },
      onGroupFilter: group => {
        state.view = 'workers';
        state.group = group;
        window.location.hash = 'workers';
        render();
        dock?.setView('workers');
      },
      onRefresh: () => {
        refresh();
      },
      onAppearanceChange: (setting, value) => {
        if (setting === 'density') {
          document.body.classList.toggle('compact', value === 'compact');
          const select = document.querySelector('#density');
          if (select) select.value = value;
        } else if (setting === 'detail') {
          document.body.classList.toggle('expanded', value === 'expanded');
          const select = document.querySelector('#detail');
          if (select) select.value = value;
        } else if (setting === 'accent') {
          applyAccent(value);
        }
      }
    });
  }
} catch (err) {
  console.error('Failed to initialize Dock navigation:', err);
}

// Workspace dropdown popover toggle
const wsTrigger = document.querySelector('#workspace-menu-trigger');
if (wsTrigger) {
  wsTrigger.addEventListener('click', e => {
    e.stopPropagation();
    const isExpanded = wsTrigger.getAttribute('aria-expanded') === 'true';
    wsTrigger.setAttribute('aria-expanded', String(!isExpanded));
  });
  document.addEventListener('click', e => {
    if (!wsTrigger.contains(e.target)) {
      wsTrigger.setAttribute('aria-expanded', 'false');
    }
  });
  wsTrigger.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      wsTrigger.setAttribute('aria-expanded', 'false');
    }
  });
}

// History & URL hash routing
window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const targetView = labels[hash] ? hash : (hash === 'computer-preview' ? 'computer' : null);
  if (targetView && state.view !== targetView) {
    state.view = targetView;
    render();
    dock?.setView(state.view);
  }
});

document.addEventListener('click', event => {
  const view = event.target.closest('[data-view]');
  const home = event.target.closest('.brand');
  if (view || home) {
    state.view = view?.dataset.view || 'overview';
    window.location.hash = state.view;
    render();
    dock?.setView(state.view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const group = event.target.closest('[data-group]');
  if (group) {
    state.group = group.dataset.group;
    render();
  }
  const chip = event.target.closest('.accent-chip');
  if (chip && chip.dataset.accent) {
    applyAccent(chip.dataset.accent);
  }
  const worker = event.target.closest('[data-worker]');
  if (worker) inspectWorker(worker.dataset.worker);
});

document.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-worker]')) {
    event.preventDefault();
    inspectWorker(event.target.dataset.worker);
  }
});

const refreshBtn = document.querySelector('#refresh');
if (refreshBtn) refreshBtn.addEventListener('click', refresh);

const closeDialogBtn = document.querySelector('#close-dialog');
if (closeDialogBtn) closeDialogBtn.addEventListener('click', () => document.querySelector('#worker-dialog').close());

const toolrailToggle = document.querySelector('#app-toolrail-toggle');
if (toolrailToggle) {
  const mobileToolrail = window.matchMedia('(max-width: 600px)');
  const storageKey = () => mobileToolrail.matches ? 'zetro_toolrail_open_mobile' : 'zetro_toolrail_open';
  const setToolrailOpen = open => {
    document.body.classList.toggle('toolrail-closed', !open);
    toolrailToggle.setAttribute('aria-expanded', String(open));
    const label = open ? 'Hide tool navigation' : 'Show tool navigation';
    toolrailToggle.setAttribute('aria-label', label);
    toolrailToggle.title = label;
  };
  const restoreToolrail = () => {
    const saved = localStorage.getItem(storageKey());
    setToolrailOpen(mobileToolrail.matches ? saved === 'true' : saved !== 'false');
  };
  restoreToolrail();
  mobileToolrail.addEventListener('change', restoreToolrail);
  toolrailToggle.addEventListener('click', () => {
    const open = toolrailToggle.getAttribute('aria-expanded') !== 'true';
    setToolrailOpen(open);
    localStorage.setItem(storageKey(), String(open));
  });
}

const closeTweakBtn = document.querySelector('#close-tweak');
if (closeTweakBtn) {
  closeTweakBtn.addEventListener('click', () => {
    const tweak = document.querySelector('.tweak');
    if (tweak) tweak.open = false;
  });
}

const densitySel = document.querySelector('#density');
if (densitySel) {
  densitySel.addEventListener('change', event => {
    const val = event.target.value;
    document.body.classList.toggle('compact', val === 'compact');
    dock?.setDensity(val);
  });
}

const detailSel = document.querySelector('#detail');
if (detailSel) {
  detailSel.addEventListener('change', event => {
    const val = event.target.value;
    document.body.classList.toggle('expanded', val === 'expanded');
    dock?.setDetail(val);
  });
}

updateIcons();
applyAccent(currentAccentId);
refresh();

const footerEl = document.querySelector('footer');
if (footerEl && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
  footerEl.animate(
    [
      { opacity: 0, transform: 'translateY(10px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ],
    { duration: 600, delay: 350, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
  );
}

setInterval(() => {
  if (!document.hidden) refresh();
}, 10000);

// Global MagicBento Smart Spotlight & Hairline Border Glow Tracking for Cards and Composer
let pointerRaf = 0;
let lastPointerEvent = null;

function updateMagicBentoHover() {
  pointerRaf = 0;
  if (!lastPointerEvent) return;
  const cx = lastPointerEvent.clientX;
  const cy = lastPointerEvent.clientY;
  const targets = document.querySelectorAll(
    '.panel, .fleet-team, .fleet-worker, .plan-phase, .metric-card, dialog#worker-dialog, .bottom-nav, .prompt-bar, .empty-prompt-card'
  );
  const reach = 160;
  for (let i = 0; i < targets.length; i++) {
    const el = targets[i];
    const rect = el.getBoundingClientRect();
    const dist = Math.hypot(
      Math.max(rect.left - cx, 0, cx - rect.right),
      Math.max(rect.top - cy, 0, cy - rect.bottom)
    );
    if (dist <= reach) {
      const hot = Math.max(0, 1 - dist / reach);
      el.style.setProperty('--mouse-x', `${(cx - rect.left).toFixed(1)}px`);
      el.style.setProperty('--mouse-y', `${(cy - rect.top).toFixed(1)}px`);
      el.style.setProperty('--mouse-hot', hot.toFixed(3));
    } else if (el.style.getPropertyValue('--mouse-hot') && el.style.getPropertyValue('--mouse-hot') !== '0') {
      el.style.setProperty('--mouse-hot', '0');
    }
  }
}

window.addEventListener('pointermove', event => {
  lastPointerEvent = event;
  if (!pointerRaf) {
    pointerRaf = requestAnimationFrame(updateMagicBentoHover);
  }
}, { passive: true });
