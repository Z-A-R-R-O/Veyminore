import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyAgent, projectAgents, mountAgentNav} from '../public/agent-nav.js';

const now = Date.parse('2026-10-31T12:00:00Z');
const observedAt = '2026-10-31T11:59:30Z';
const worker = (name, group, state, dispatch = 'assigned') => ({name, group, live:{state}, dispatch});

test('active requires a fresh observation and stays unverified', () => {
  assert.equal(classifyAgent(worker('AGR-1','AGR','busy'), observedAt, now).kind, 'active');
  assert.equal(classifyAgent(worker('AGR-1','AGR','busy'), null, now).kind, 'stale');
  assert.equal(classifyAgent(worker('AGR-1','AGR','idle'), observedAt, now).kind, 'unknown');
  const oldRecord = {...worker('AGR-1','AGR','busy'), live:{state:'busy',updatedAt:'2026-10-31T11:00:00Z'}};
  assert.equal(classifyAgent(oldRecord, observedAt, now).kind, 'stale');
});

test('attention takes priority without treating review in progress as failure', () => {
  assert.equal(classifyAgent(worker('AGR-1','AGR','idle','heartbeat_timeout'), observedAt, now).kind, 'attention');
  assert.equal(classifyAgent(worker('AGR-1','AGR','idle','independent_review_in_progress'), observedAt, now).kind, 'unknown');
});

test('filters and ordering use evidence, group, and stable numeric identity', () => {
  const workers = [worker('AGR-10','AGR','idle'),worker('OCR-1','OCR','busy'),worker('AGR-2','AGR','idle','failed'),worker('AGR-1','AGR','idle')];
  assert.deepEqual(projectAgents(workers, observedAt, 'all', now).map(item => item.worker.name), ['AGR-2','OCR-1','AGR-1','AGR-10']);
  assert.deepEqual(projectAgents(workers, observedAt, 'active', now).map(item => item.worker.name), ['OCR-1']);
});

test('unchanged refresh preserves DOM and changed refresh restores focused control', () => {
  const previousDocument = globalThis.document;
  const root = {
    html:'', writes:0, buttons:[],
    classList:{toggle() {}}, addEventListener() {},
    contains(button) { return this.buttons.includes(button); },
    querySelectorAll() { return this.buttons; },
    get innerHTML() { return this.html; },
    set innerHTML(value) {
      this.html = value;
      this.writes++;
      this.buttons = [...value.matchAll(/<button\b([^>]*)>/g)].map(([,attributes]) => {
        const dataset = Object.fromEntries([...attributes.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(([,key,val]) => [key.replace(/-([a-z])/g, (_,letter) => letter.toUpperCase()),val]));
        const button = {dataset,classList:{contains(name) { return attributes.includes(`class="${name}"`); }}};
        button.focus = () => { globalThis.document.activeElement = button; };
        return button;
      });
    }
  };
  globalThis.document = {activeElement:null};
  try {
    const nav = mountAgentNav(root, () => {});
    const snapshot = (taskId, time) => ({workspace:'ZETRO',workers:[{...worker('AGR-1','AGR','busy'),taskId}],live:{observedAt:time}});
    nav.update(snapshot('Task A', observedAt));
    const writes = root.writes;
    const focused = root.buttons.find(button => button.dataset.agentFilter === 'all');
    focused.focus();
    nav.update(snapshot('Task A', '2026-10-31T11:59:40Z'));
    assert.equal(root.writes, writes);
    assert.equal(globalThis.document.activeElement, focused);
    nav.update(snapshot('Task B', '2026-10-31T11:59:40Z'));
    assert.equal(root.writes, writes + 1);
    assert.equal(globalThis.document.activeElement.dataset.agentFilter, 'all');
  } finally { globalThis.document = previousDocument; }
});
