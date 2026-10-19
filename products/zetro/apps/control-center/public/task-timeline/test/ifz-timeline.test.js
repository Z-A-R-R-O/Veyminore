import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  renderIfzRunTimeline,
  renderTaskTimeline,
  IFZ_EVENT_KINDS,
  IFZ_LIMITS
} from '../view.js';
import { IFZ_FIXTURES, IFZ_FIXTURE_NAMES } from '../ifz-fixtures.js';

const ALL_FIXTURE_HTML = IFZ_FIXTURE_NAMES.map((name) => ({
  name,
  html: renderIfzRunTimeline(IFZ_FIXTURES[name], { connected: true })
}));

test('fixtures: all eight states render standalone HTML', () => {
  assert.deepEqual(IFZ_FIXTURE_NAMES, [
    'empty', 'loading', 'disconnected', 'running',
    'partial_failure', 'uncertain', 'cancelled', 'complete'
  ]);
  for (const { name, html } of ALL_FIXTURE_HTML) {
    assert.ok(html.includes('class="ifz-run-view"'), `${name}: missing root scope`);
    assert.ok(html.includes('aria-label="IFZ run timeline"'), `${name}: missing semantic label`);
  }
});

test('empty / loading / disconnected copy', () => {
  const empty = renderIfzRunTimeline(IFZ_FIXTURES.empty, { connected: true });
  assert.ok(empty.includes('No events reported'));
  const emptyOffline = renderIfzRunTimeline(IFZ_FIXTURES.empty, { connected: false });
  assert.ok(emptyOffline.includes('Not connected'));
  const disconnected = renderIfzRunTimeline(IFZ_FIXTURES.disconnected, { connected: true });
  assert.ok(disconnected.includes('Not connected'));
  const loading = renderIfzRunTimeline(IFZ_FIXTURES.loading, { connected: false });
  assert.ok(loading.includes('Loading…'));
  assert.ok(loading.includes('aria-busy="true"'));
  const nullRun = renderIfzRunTimeline(null, { connected: false });
  assert.ok(nullRun.includes('Not connected'));
});

test('state badges for running / partial-failure / uncertain / cancelled / complete', () => {
  const expected = {
    running: 'Running',
    partial_failure: 'Partial failure',
    uncertain: 'Uncertain',
    cancelled: 'Cancelled',
    complete: 'Complete'
  };
  for (const [fixture, label] of Object.entries(expected)) {
    const html = renderIfzRunTimeline(IFZ_FIXTURES[fixture], { connected: true });
    assert.ok(html.includes(`>${label}</span>`), `${fixture}: expected state label ${label}`);
  }
});

test('raw HTML in input is never rendered', () => {
  const html = renderIfzRunTimeline(
    {
      state: 'running',
      promptRef: { id: '<b id=x>', preview: '<iframe src=evil>' },
      events: [
        {
          id: 'e1',
          kind: 'result',
          timestamp: 1760300000000,
          summary: '<script>alert(1)</script>',
          producingWorker: '<img src=x onerror=1>',
          requestingWorker: 'worker<b>'
        }
      ]
    },
    { connected: true }
  );
  assert.ok(!html.includes('<script'), 'raw script tag leaked');
  assert.ok(!html.includes('<iframe'), 'raw iframe tag leaked');
  assert.ok(!html.includes('<img'), 'raw img tag leaked');
  assert.ok(!html.includes('<b id=x>'), 'raw markup in id leaked');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped script text expected');
  assert.ok(html.includes('&lt;img'), 'escaped worker text expected');
});

test('secret-looking tokens are redacted', () => {
  const html = renderIfzRunTimeline(
    {
      state: 'running',
      events: [
        {
          id: 'e1',
          kind: 'public_status',
          timestamp: 1760300000000,
          summary: 'issued sk-abcdef1234567890 during rotation; api_key-zzz987654 also rotated',
          producingWorker: 'coordinator',
          requestingWorker: 'coordinator'
        }
      ]
    },
    { connected: true }
  );
  assert.ok(!html.includes('sk-abcdef1234567890'), 'raw secret token leaked');
  assert.ok(!html.includes('api_key-zzz987654'), 'raw api key leaked');
  assert.ok(html.includes('[redacted]'));
});

test('private reasoning fields are never rendered (whitelist)', () => {
  const html = renderIfzRunTimeline(
    {
      state: 'running',
      events: [
        {
          id: 'e1',
          kind: 'result',
          timestamp: 1760300000000,
          summary: 'Delivered.',
          producingWorker: 'worker-alpha',
          requestingWorker: 'coordinator',
          reasoning: 'PRIVATE CHAIN OF THOUGHT must not appear',
          secrets: 'hunter2-password-material'
        }
      ]
    },
    { connected: true }
  );
  assert.ok(!html.includes('PRIVATE CHAIN OF THOUGHT'), 'reasoning leaked');
  assert.ok(!html.includes('hunter2-password-material'), 'secrets field leaked');
});

test('prompt preview, summary, and tool output are bounded', () => {
  const long = (n, head) => head + 'x'.repeat(n);
  const html = renderIfzRunTimeline(
    {
      state: 'running',
      promptRef: { id: 'p1', preview: long(400, 'PROMPT-HEAD-') },
      events: [
        {
          id: 'e1',
          kind: 'result',
          timestamp: 1760300000000,
          summary: long(500, 'SUMMARY-HEAD-'),
          producingWorker: 'worker-alpha',
          requestingWorker: 'coordinator',
          delegated: { toolOutput: long(1000, 'TOOL-HEAD-') }
        }
      ]
    },
    { connected: true }
  );
  assert.ok(!html.includes('x'.repeat(300)), 'unbounded text leaked');
  assert.ok(html.includes('PROMPT-HEAD-') && html.includes('…'), 'prompt preview should truncate with ellipsis');
  assert.ok(html.includes('SUMMARY-HEAD-'));
  assert.ok(html.includes('TOOL-HEAD-'));
  assert.ok(!html.includes(long(400, '')), 'full tool output must not render');
  assert.ok(IFZ_LIMITS.promptPreview === 140);
  assert.ok(IFZ_LIMITS.summary === 200);
  assert.ok(IFZ_LIMITS.toolOutput === 160);
});

test('producing and requesting worker identities shown; missing -> Unavailable', () => {
  const html = renderIfzRunTimeline(
    {
      state: 'running',
      events: [
        { id: 'e1', kind: 'handoff', timestamp: 1760300000000, summary: 'h', producingWorker: 'worker-alpha' },
        { id: 'e2', kind: 'handoff', timestamp: 1760300001000, summary: 'h2', requestingWorker: 'worker-beta' }
      ]
    },
    { connected: true }
  );
  assert.ok(html.includes('Produced by'));
  assert.ok(html.includes('Requested by'));
  assert.ok(html.includes('worker-alpha'));
  assert.ok(html.includes('worker-beta'));
  const unavailableCount = (html.match(/Unavailable/g) || []).length;
  assert.ok(unavailableCount >= 2, 'missing identities must label Unavailable');
});

test('worker claim and independent verification stay visually distinct', () => {
  const html = renderIfzRunTimeline(IFZ_FIXTURES.complete, { connected: true });
  assert.ok(html.includes('ifz-badge-claim'), 'claim badge missing');
  assert.ok(html.includes('ifz-badge-verified'), 'verification badge missing');
  assert.ok(html.includes('Worker claim'));
  assert.ok(html.includes('Independent verification'));
  assert.ok(html.includes('Verifier: verifier-1'));
  assert.ok(html.includes('class="ifz-claim"'));
  assert.ok(html.includes('class="ifz-verification"'));
});

test('parallel branches render as separate sections; delegation collapsed via <details>', () => {
  const html = renderIfzRunTimeline(IFZ_FIXTURES.complete, { connected: true });
  assert.ok(html.includes('data-branch="main"'));
  assert.ok(html.includes('data-branch="probe-1"'));
  assert.ok(html.includes('aria-label="Branch probe-1"'));
  assert.ok(html.includes('<details class="ifz-delegation">'));
  assert.ok(html.includes('<summary>Delegation details</summary>'));
  assert.ok(!html.includes(' open>'), 'delegation must start collapsed');
});

test('every contract event kind renders with its label', () => {
  for (const kind of IFZ_EVENT_KINDS) {
    const html = renderIfzRunTimeline(
      {
        state: 'running',
        events: [{ id: `e-${kind}`, kind, timestamp: 1760300000000, summary: `s-${kind}`, producingWorker: 'w', requestingWorker: 'c' }]
      },
      { connected: true }
    );
    assert.ok(html.includes(`data-kind="${kind}"`), `kind missing: ${kind}`);
    assert.ok(html.includes(`data-kind="${kind}"`), html);
  }
  const unknown = renderIfzRunTimeline(
    { state: 'running', events: [{ id: 'x', kind: 'made_up', timestamp: 1, summary: 's', producingWorker: 'w' }] },
    { connected: true }
  );
  assert.ok(unknown.includes('data-kind="unknown"'));
  assert.ok(unknown.includes('unrecognized kind'));
});

test('stable sort: timestamp then id, invalid timestamps last', () => {
  const html = renderIfzRunTimeline(
    {
      state: 'running',
      events: [
        { id: 'b', kind: 'result', timestamp: 1760300000000, summary: 'same-b', producingWorker: 'w' },
        { id: 'a', kind: 'result', timestamp: 1760300000000, summary: 'same-a', producingWorker: 'w' },
        { id: 'z', kind: 'result', timestamp: 'not-a-date', summary: 'invalid-ts', producingWorker: 'w' },
        { id: 'c', kind: 'result', timestamp: 1760299999000, summary: 'earliest', producingWorker: 'w' }
      ]
    },
    { connected: true }
  );
  const iEarliest = html.indexOf('earliest');
  const iA = html.indexOf('same-a');
  const iB = html.indexOf('same-b');
  const iInvalid = html.indexOf('invalid-ts');
  assert.ok(iEarliest >= 0 && iEarliest < iA, 'earliest timestamp first');
  assert.ok(iA < iB, 'same timestamp tie-broken by id');
  assert.ok(iInvalid > iB, 'invalid timestamp sorted last');
});

test('bounded to 100 events with disclosure', () => {
  const events = Array.from({ length: 150 }, (_, i) => ({
    id: `e${String(i).padStart(3, '0')}`,
    kind: 'public_status',
    timestamp: 1760300000000 + i,
    summary: `event ${i}`,
    producingWorker: 'w',
    requestingWorker: 'c'
  }));
  const html = renderIfzRunTimeline({ state: 'running', events }, { connected: true });
  const rendered = (html.match(/class="ifz-event"/g) || []).length;
  assert.equal(rendered, 100);
  assert.ok(html.includes('Showing the first 100 events'));
  assert.ok(html.includes('100 of 150 events'));
});

test('semantic markup and a11y hooks present in rendered HTML', () => {
  const html = renderIfzRunTimeline(IFZ_FIXTURES.complete, { connected: true });
  assert.ok(html.includes('<section'));
  assert.ok(html.includes('<ol class="ifz-events"'));
  assert.ok(html.includes('<li class="ifz-event"'));
  assert.ok(html.includes('<time class="ifz-time"'));
  assert.ok(html.includes('datetime="'));
  assert.ok(html.includes('aria-live="polite"'));
});

test('style.css: visible focus, reduced motion, collapsed-delegation affordance', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.ok(css.includes('prefers-reduced-motion'), 'reduced-motion block missing');
  assert.ok(css.includes('focus-visible'), 'focus-visible styles missing');
  assert.ok(css.includes('cursor: pointer'), 'summary affordance missing');
  assert.ok(css.includes('.ifz-run-view'), 'IFZ scope missing');
});

test('prior task timeline renderer unchanged and coexists', () => {
  const legacy = renderTaskTimeline([], { connected: false });
  assert.ok(legacy.includes('Not connected'));
  const ifz = renderIfzRunTimeline(IFZ_FIXTURES.complete, { connected: true });
  assert.ok(ifz.includes('IFZ run timeline'));
  assert.ok(!ifz.includes('tt-list'), 'IFZ renderer must not reuse legacy list scope');
});
