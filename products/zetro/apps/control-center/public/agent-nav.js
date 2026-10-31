const GROUPS = ['AGR', 'OCR', 'RCT'];
const ACTIVE = new Set(['busy', 'running', 'working', 'in_progress']);
const ATTENTION = /fail|error|timeout|reconcil|review_required|needs_review|blocked|uncertain/;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function classifyAgent(worker, observedAt, now = Date.now()) {
  const raw = String(worker?.live?.state ?? '').toLowerCase();
  const timestamp = worker?.live?.updatedAt || worker?.live?.observedAt || observedAt;
  const numeric = Number(timestamp);
  const observed = Number.isFinite(numeric) && timestamp !== null && timestamp !== ''
    ? numeric < 100_000_000_000 ? numeric * 1000 : numeric
    : Date.parse(timestamp || '');
  const fresh = Number.isFinite(observed) && observed <= now + 60_000 && now - observed <= 120_000;
  const evidence = [worker?.dispatch, worker?.review, raw].filter(Boolean).join(' ').toLowerCase();
  if (ATTENTION.test(evidence)) return {kind:'attention', label:'Needs attention', priority:0};
  if (fresh && ACTIVE.has(raw)) return {kind:'active', label:'Observed active — unverified', priority:1};
  if (ACTIVE.has(raw) && !fresh) return {kind:'stale', label:'Observation stale', priority:2};
  return {kind:'unknown', label:raw === 'not_connected' ? 'Not connected' : 'No active observation', priority:2};
}

export function projectAgents(workers, observedAt, filter = 'all', now = Date.now()) {
  if (!Array.isArray(workers)) return [];
  return workers.filter(worker => worker && GROUPS.includes(worker.group) && typeof worker.name === 'string')
    .map(worker => ({worker, status:classifyAgent(worker, observedAt, now)}))
    .filter(item => filter === 'all' || item.status.kind === filter)
    .sort((a,b) => a.status.priority - b.status.priority || GROUPS.indexOf(a.worker.group) - GROUPS.indexOf(b.worker.group) || a.worker.name.localeCompare(b.worker.name, undefined, {numeric:true}));
}

export function mountAgentNav(root, onSelect) {
  const state = {filter:'all', expanded:new Set(GROUPS), more:new Set(), selected:null, compactOpen:false, workers:[], observedAt:null, workspace:null, unavailable:false};
  let lastMarkup = null;
  const render = () => {
    const projected = projectAgents(state.workers, state.observedAt, state.filter);
    const all = projectAgents(state.workers, state.observedAt);
    const counts = {all:all.length, active:all.filter(item => item.status.kind === 'active').length, attention:all.filter(item => item.status.kind === 'attention').length};
    root.classList.toggle('is-open', state.compactOpen);
    const markup = `<div class="app-sidebar__brand"><button class="app-sidebar__compact-toggle" type="button" aria-label="${state.compactOpen ? 'Close' : 'Open'} agents navigation" aria-expanded="${state.compactOpen}">Z</button><span class="app-sidebar__identity">ZETRO<small>${escape(state.workspace || 'Workspace')}</small></span></div><div class="app-sidebar__body"><div class="app-sidebar__heading"><span>Agents</span><span>${counts.all || ''}</span></div><div class="app-sidebar__filters" role="group" aria-label="Filter agents">${[['all','All'],['active','Active'],['attention','Attention']].map(([key,label]) => `<button type="button" data-agent-filter="${key}" aria-pressed="${state.filter === key}">${label}${key !== 'all' && counts[key] ? `<small>${counts[key]}</small>` : ''}</button>`).join('')}</div><div class="app-sidebar__groups">${GROUPS.map(group => {
      const items = projected.filter(item => item.worker.group === group);
      if (!items.length && state.filter !== 'all') return '';
      const visible = state.more.has(group) ? items : items.slice(0,5);
      return `<section class="agent-group"><button class="agent-group__head" type="button" data-agent-group="${group}" aria-expanded="${state.expanded.has(group)}"><span class="agent-group__chevron">⌄</span><span>${group}</span><small>${items.length}</small></button>${state.expanded.has(group) ? `<div class="agent-group__rows">${visible.map(({worker,status}) => `<button class="agent-row" type="button" data-agent-name="${escape(worker.name)}" title="${escape(status.label)}" aria-label="Inspect ${escape(worker.name)} — ${escape(status.label)}" aria-current="${state.selected === worker.name ? 'true' : 'false'}"><span class="agent-row__name">${escape(worker.name)}</span><span class="agent-row__task">${escape(worker.taskId && worker.taskId !== 'Assignment pending' ? worker.taskId : '')}</span><i class="agent-row__status is-${status.kind}" aria-hidden="true"></i></button>`).join('')}${items.length > 5 ? `<button class="agent-group__more" type="button" data-agent-more="${group}">${state.more.has(group) ? 'Show less' : `Show ${items.length - 5} more`}</button>` : ''}</div>` : ''}</section>`;
    }).join('')}</div><p class="app-sidebar__empty" ${projected.length ? 'hidden' : ''}>${state.unavailable ? 'Agent data unavailable.' : 'No agents in this view.'}</p><span class="app-sidebar__foot">Observed state is separate from verified work.</span></div>`;
    if (lastMarkup === markup) return;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    const focused = active && root.contains(active) ? {
      name:active.dataset.agentName,
      filter:active.dataset.agentFilter,
      group:active.dataset.agentGroup,
      more:active.dataset.agentMore,
      compact:active.classList.contains('app-sidebar__compact-toggle')
    } : null;
    root.innerHTML = markup;
    lastMarkup = markup;
    if (focused) {
      const buttons = [...root.querySelectorAll('button')];
      const match = buttons.find(button => focused.name && button.dataset.agentName === focused.name)
        || buttons.find(button => focused.filter && button.dataset.agentFilter === focused.filter)
        || buttons.find(button => focused.group && button.dataset.agentGroup === focused.group)
        || buttons.find(button => focused.more && button.dataset.agentMore === focused.more)
        || buttons.find(button => focused.compact && button.classList.contains('app-sidebar__compact-toggle'))
        || buttons.find(button => focused.name && button.dataset.agentGroup === focused.name.split('-')[0]);
      match?.focus({preventScroll:true});
    }
  };
  root.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target || !root.contains(target)) return;
    if (target.classList.contains('app-sidebar__compact-toggle')) state.compactOpen = !state.compactOpen;
    if (target.dataset.agentFilter) state.filter = target.dataset.agentFilter;
    if (target.dataset.agentGroup) state.expanded.has(target.dataset.agentGroup) ? state.expanded.delete(target.dataset.agentGroup) : state.expanded.add(target.dataset.agentGroup);
    if (target.dataset.agentMore) state.more.has(target.dataset.agentMore) ? state.more.delete(target.dataset.agentMore) : state.more.add(target.dataset.agentMore);
    const selected = target.dataset.agentName;
    if (selected) {
      state.selected = selected;
      state.compactOpen = false;
    }
    render();
    if (selected) {
      root.querySelectorAll('[data-agent-name]').forEach(row => {
        if (row.dataset.agentName === selected) row.focus();
      });
      onSelect(selected);
    }
  });
  render();
  return {update(snapshot, unavailable = false) { state.workers = snapshot?.workers || []; state.observedAt = snapshot?.live?.observedAt; state.workspace = snapshot?.workspace; state.unavailable = unavailable; render(); }};
}
