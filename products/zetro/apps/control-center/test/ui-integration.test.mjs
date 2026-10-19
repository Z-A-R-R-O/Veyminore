import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapStatusProjection,
  resolveDevLabFlag
} from '../src/live-integration.js';

import {
  CANONICAL_ROUTES,
  resolveInitialRoute,
  resolveRouteTransition,
  handlePopState,
  resolveRefreshRoute,
  formatCanonicalHash,
  formatCanonicalUrl,
  createNavigationHistoryState,
  parseRouteFromUrl,
  resolveCopiedRouteUrl
} from '../src/product-navigation.js';

test('Live integration: default live route is Work', () => {
  const initial = resolveInitialRoute(undefined);
  assert.equal(initial.id, 'work', 'Default live route must be work');
  assert.equal(initial.default, true);
  assert.equal(formatCanonicalHash('work'), '#work');
  assert.equal(formatCanonicalUrl('work'), 'http://localhost:4000/#work');
});

test('Live integration: mapStatusProjection supplies only real observed data without inventing evidence', () => {
  // 1. Omitted / empty data
  const empty = mapStatusProjection(undefined);
  assert.equal(empty.workspaceName, null);
  assert.equal(empty.workspacePath, null, 'Must never invent a local workspace path');
  assert.equal(empty.workspaceId, null);
  assert.equal(empty.connected, undefined, 'Missing connection evidence must be undefined/unknown');
  assert.equal(empty.stale, false);
  assert.equal(empty.ifzActive, undefined, 'Missing IFZ evidence must be undefined/unknown');
  assert.equal(empty.workerCount, null, 'No count badge without supplied nonnegative integer');
  assert.equal(empty.activeRunCount, null);

  // 2. Real observed snapshot from /api/status
  const mockSnapshot = {
    workspace: 'Veyminore / ZETRO',
    sourceMode: 'saved-evidence',
    workers: [
      { name: 'AGR-1', group: 'AGR', dispatch: 'independent_review_in_progress', live: { state: 'busy' } },
      { name: 'OCR-1', group: 'OCR', dispatch: 'idle', live: { state: 'idle' } },
      { name: 'RCT-1', group: 'RCT', dispatch: 'not_connected', live: { state: 'not_connected' } }
    ],
    activity: [
      { title: 'Task 1', text: 'Verified scoped change', team: 'AGR' }
    ],
    sources: [
      { path: 'docs/execution/DISPATCH.json', available: true, updatedAt: '2026-10-19T00:00:00Z' }
    ],
    boundaries: {
      readOnly: true,
      liveInference: false,
      nativeDesktopVerified: false,
      safeApplyAvailable: false
    }
  };

  const mapped = mapStatusProjection(mockSnapshot);
  assert.equal(mapped.workspaceName, 'Veyminore / ZETRO');
  assert.equal(mapped.workspacePath, null, 'Snapshot does not declare filesystem path; must stay null');
  assert.equal(mapped.connected, false, 'liveInference boundary is false; no persistent daemon attached');
  assert.equal(mapped.ifzActive, false, 'Runtime inference boundary is protected read-only');
  assert.equal(mapped.workerCount, 3, 'Must match real observed workers count');
  assert.equal(mapped.activeRunCount, 1, 'Only AGR-1 is active/busy');
  assert.equal(mapped.boundaries.readOnly, true);
  assert.equal(mapped.boundaries.liveInference, false);
});

test('Live integration: devLab flag remains strictly hidden unless explicitly requested', () => {
  // Default is false
  assert.equal(resolveDevLabFlag(null), false);
  assert.equal(resolveDevLabFlag({ search: '', hash: '' }), false);
  assert.equal(resolveDevLabFlag({ search: '?foo=bar', hash: '#work' }), false);

  // Enabled via query param ?dev=true or ?devLab=true
  assert.equal(resolveDevLabFlag({ search: '?dev=true', hash: '' }), true);
  assert.equal(resolveDevLabFlag({ search: '?devLab=true', hash: '' }), true);
  assert.equal(resolveDevLabFlag({ search: '?lab=true', hash: '' }), true);

  // Enabled via hash #lab
  assert.equal(resolveDevLabFlag({ search: '', hash: '#lab' }), true);
  assert.equal(resolveDevLabFlag({ search: '', hash: '#/lab' }), true);
});

test('Live integration: wires canonical hash, history state, and popstate navigation cleanly', () => {
  // 1. Initial route parsing
  assert.equal(resolveInitialRoute({ hash: '#workers' }).id, 'workers');
  assert.equal(resolveInitialRoute({ hash: '#computer' }).id, 'computer');
  assert.equal(resolveInitialRoute({ hash: '#evidence' }).id, 'evidence');

  // 2. Transition forward
  const nav = resolveRouteTransition('work', 'workers');
  assert.equal(nav.previousRoute, 'work');
  assert.equal(nav.nextRoute, 'workers');
  assert.equal(nav.changed, true);
  assert.equal(nav.hash, '#workers');
  assert.equal(nav.historyState.routeId, 'workers');

  // 3. Popstate back to initial landing page
  const back = handlePopState(null, { hash: '#work' });
  assert.equal(back.routeId, 'work');
  assert.equal(back.source, 'location');

  // 4. Popstate forward with history state
  const forward = handlePopState({ routeId: 'computer' }, { hash: '#work' });
  assert.equal(forward.routeId, 'computer');
  assert.equal(forward.source, 'history-state');

  // 5. Refresh preserves deep-link
  const refresh = resolveRefreshRoute(null, { hash: '#evidence' });
  assert.equal(refresh.routeId, 'evidence');
  assert.equal(refresh.source, 'location-deep-link');

  // 6. Copied route resolution
  const copied = resolveCopiedRouteUrl('http://127.0.0.1:4317/?ref=share#workers');
  assert.equal(copied.valid, true);
  assert.equal(copied.routeId, 'workers');
});

test('Live integration: Computer page and orb preview boundaries are preserved without claiming native proof', () => {
  const compRoute = CANONICAL_ROUTES.find(r => r.id === 'computer');
  assert.ok(compRoute, 'Computer canonical route must be present');
  assert.equal(compRoute.id, 'computer');
  assert.equal(compRoute.label, 'Computer');

  // Mapped status guarantees read-only simulated preview
  const projection = mapStatusProjection({
    boundaries: { readOnly: true, liveInference: false, nativeDesktopVerified: false }
  });
  assert.equal(projection.boundaries.nativeDesktopVerified, false, 'Desktop proof must remain unverified in preview');
  assert.equal(projection.boundaries.readOnly, true);
});
