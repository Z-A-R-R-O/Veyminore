import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_ROUTES,
  REMOVED_PRIMARY_ROUTES,
  TOP_MENU_GROUPS,
  getRoute,
  isValidRoute,
  resolveActiveRoute,
  isRemovedPrimaryRoute,
  resolveConnectionStatus,
  resolveWorkspaceStatus,
  resolveIfzStatus,
  formatCountBadge,
  projectTopMenu,
  projectCenterDock,
  projectLeftUtilityDock,
  projectRightUtilityDock,
  projectResponsiveNavigation,
  projectDevelopmentTweaks,
  createShellNavigationState,
  reduceNavigationAction,
  formatCanonicalHash,
  formatCanonicalUrl,
  createNavigationHistoryState,
  parseRouteFromUrl,
  resolveInitialRoute,
  resolveRouteTransition,
  handlePopState,
  resolveRefreshRoute,
  formatShareableRouteUrl,
  resolveCopiedRouteUrl
} from '../src/product-navigation.js';

test('CANONICAL_ROUTES defines exactly the 6 approved primary product routes', () => {
  const ids = CANONICAL_ROUTES.map(r => r.id);
  assert.deepEqual(ids, ['work', 'workers', 'runs', 'computer', 'evidence', 'settings']);

  const defaultRoute = CANONICAL_ROUTES.find(r => r.default === true);
  assert.ok(defaultRoute, 'A default route must be defined');
  assert.equal(defaultRoute.id, 'work', 'Work must be the default primary route');
});

test('Legacy and non-primary routes are removed from primary navigation registry', () => {
  const ids = CANONICAL_ROUTES.map(r => r.id);
  assert.equal(ids.includes('readiness'), false, 'RCT Readiness must be removed from primary routes');
  assert.equal(ids.includes('roadmap'), false, 'Roadmap must be removed from primary routes');
  assert.equal(ids.includes('requirements'), false, 'Roadmap/Requirements must be removed from primary routes');
  assert.equal(ids.includes('overview'), false, 'Overview must be replaced by Work default empty-state');
  assert.equal(ids.includes('activity'), false, 'Activity must be replaced by Runs');

  assert.equal(isRemovedPrimaryRoute('readiness'), true);
  assert.equal(isRemovedPrimaryRoute('roadmap'), true);
  assert.equal(isRemovedPrimaryRoute('requirements'), true);
  assert.equal(isRemovedPrimaryRoute('orb-preview'), true);
  assert.equal(isRemovedPrimaryRoute('work'), false);
});

test('Route resolution and alias migration handles hashes and invalid inputs', () => {
  assert.equal(getRoute('work')?.id, 'work');
  assert.equal(getRoute('#WORK')?.id, 'work');
  assert.equal(getRoute('#settings?section=presets')?.id, 'settings');

  // Overview aliases to Work
  assert.equal(getRoute('overview')?.id, 'work');
  // Activity aliases to Runs
  assert.equal(getRoute('activity')?.id, 'runs');

  // Fallbacks
  assert.equal(isValidRoute('unknown-route'), false);
  assert.equal(resolveActiveRoute('unknown-route').id, 'work');
  assert.equal(resolveActiveRoute(null).id, 'work');
  assert.equal(resolveActiveRoute('').id, 'work');
});

test('resolveConnectionStatus handles omitted, false, true, malformed, and stale observations truthfully', () => {
  // 1. Omitted observations
  assert.deepEqual(resolveConnectionStatus(undefined), {
    connected: false,
    status: 'unknown',
    label: 'Connection unknown',
    pulse: false
  });
  assert.deepEqual(resolveConnectionStatus({}), {
    connected: false,
    status: 'unknown',
    label: 'Connection unknown',
    pulse: false
  });
  assert.deepEqual(resolveConnectionStatus({ connected: undefined }), {
    connected: false,
    status: 'unknown',
    label: 'Connection unknown',
    pulse: false
  });

  // 2. Explicit false
  assert.deepEqual(resolveConnectionStatus({ connected: false }), {
    connected: false,
    status: 'disconnected',
    label: 'Disconnected',
    pulse: false
  });

  // 3. Explicit true
  assert.deepEqual(resolveConnectionStatus({ connected: true }), {
    connected: true,
    status: 'connected',
    label: 'Connected',
    pulse: true
  });

  // 4. Malformed observations (non-boolean values)
  assert.deepEqual(resolveConnectionStatus({ connected: 'yes' }), {
    connected: false,
    status: 'unknown',
    label: 'Connection unknown',
    pulse: false
  });
  assert.deepEqual(resolveConnectionStatus({ connected: 1 }), {
    connected: false,
    status: 'unknown',
    label: 'Connection unknown',
    pulse: false
  });
  assert.deepEqual(resolveConnectionStatus({ connected: null }), {
    connected: false,
    status: 'unknown',
    label: 'Connection unknown',
    pulse: false
  });
  assert.deepEqual(resolveConnectionStatus({ connected: { active: true } }), {
    connected: false,
    status: 'unknown',
    label: 'Connection unknown',
    pulse: false
  });

  // 5. Stale observations
  assert.deepEqual(resolveConnectionStatus({ connected: true, stale: true }), {
    connected: false,
    status: 'stale',
    label: 'Connection stale',
    pulse: false
  });

  // 6. Stale observation timestamp check (age exceeds TTL)
  const staleTime = resolveConnectionStatus({
    connected: true,
    connectionObservedAt: 1000,
    now: 45000,
    connectionTtlMs: 30000
  });
  assert.deepEqual(staleTime, {
    connected: false,
    status: 'stale',
    label: 'Connection stale',
    pulse: false
  });

  // 7. Fresh observation timestamp check
  const freshTime = resolveConnectionStatus({
    connected: true,
    connectionObservedAt: 40000,
    now: 45000,
    connectionTtlMs: 30000
  });
  assert.deepEqual(freshTime, {
    connected: true,
    status: 'connected',
    label: 'Connected',
    pulse: true
  });
});

test('resolveWorkspaceStatus handles omitted, partial, and explicit valid evidence without inventing paths', () => {
  // 1. Omitted evidence
  assert.deepEqual(resolveWorkspaceStatus(undefined), {
    id: null,
    name: 'No workspace',
    path: null,
    admitted: false
  });
  assert.deepEqual(resolveWorkspaceStatus({}), {
    id: null,
    name: 'No workspace',
    path: null,
    admitted: false
  });

  // 2. Partial fields: name only
  assert.deepEqual(resolveWorkspaceStatus({ workspaceName: 'Test Workspace' }), {
    id: null,
    name: 'Test Workspace',
    path: null,
    admitted: false
  });

  // 3. Partial fields: path only
  assert.deepEqual(resolveWorkspaceStatus({ workspacePath: 'E:/Veyminore/products/zetro' }), {
    id: null,
    name: 'No workspace',
    path: 'E:/Veyminore/products/zetro',
    admitted: false
  });

  // 4. Fully admitted valid workspace evidence
  assert.deepEqual(resolveWorkspaceStatus({
    workspaceId: 'ws-zetro-primary',
    workspaceName: 'ZETRO Engine',
    workspacePath: 'E:/Veyminore/products/zetro'
  }), {
    id: 'ws-zetro-primary',
    name: 'ZETRO Engine',
    path: 'E:/Veyminore/products/zetro',
    admitted: true
  });
});

test('resolveIfzStatus does not assume IFZ is active without explicit evidence', () => {
  assert.deepEqual(resolveIfzStatus(undefined), {
    mode: 'automatic',
    active: false,
    status: 'unknown',
    label: 'IFZ Unknown'
  });
  assert.deepEqual(resolveIfzStatus({}), {
    mode: 'automatic',
    active: false,
    status: 'unknown',
    label: 'IFZ Unknown'
  });
  assert.deepEqual(resolveIfzStatus({ ifzActive: false }), {
    mode: 'automatic',
    active: false,
    status: 'inactive',
    label: 'IFZ Inactive'
  });
  assert.deepEqual(resolveIfzStatus({ ifzActive: true, routingMode: 'manual' }), {
    mode: 'manual',
    active: true,
    status: 'active',
    label: 'IFZ'
  });
});

test('formatCountBadge formats nonnegative integers and rejects omitted/malformed/negative values', () => {
  // Omitted or null
  assert.equal(formatCountBadge(undefined), null);
  assert.equal(formatCountBadge(null), null);

  // Non-numbers or strings
  assert.equal(formatCountBadge('10'), null);
  assert.equal(formatCountBadge(''), null);
  assert.equal(formatCountBadge({}), null);

  // Negative or non-integer
  assert.equal(formatCountBadge(-1), null);
  assert.equal(formatCountBadge(-100), null);
  assert.equal(formatCountBadge(3.14), null);
  assert.equal(formatCountBadge(NaN), null);
  assert.equal(formatCountBadge(Infinity), null);

  // Zero returns null (no unread/active badge)
  assert.equal(formatCountBadge(0), null);

  // Valid positive integers return strings
  assert.equal(formatCountBadge(1), '1');
  assert.equal(formatCountBadge(5), '5');
  assert.equal(formatCountBadge(24), '24');
});

test('Top menu projection does not invent workspace or connection when caller supplies empty state', () => {
  const menu = projectTopMenu('work', {});

  assert.equal(menu.activeRoute.id, 'work');
  assert.equal(menu.brand.mark, 'Z');
  assert.equal(menu.brand.name, 'ZETRO');
  assert.equal(menu.headerCta, null, 'Orb Preview must not appear as a primary header action');

  // Truthful defaults:
  assert.deepEqual(menu.connectionStatus, {
    connected: false,
    status: 'unknown',
    label: 'Connection unknown',
    pulse: false
  });
  assert.deepEqual(menu.workspace, {
    id: null,
    name: 'No workspace',
    path: null,
    admitted: false
  });
  assert.deepEqual(menu.ifzStatus, {
    mode: 'automatic',
    active: false,
    status: 'unknown',
    label: 'IFZ Unknown'
  });

  const groupIds = menu.groups.map(g => g.id);
  assert.deepEqual(groupIds, ['product', 'ifz', 'system']);
});

test('Center dock projection outputs 8 destinations in strict order without inventing badges', () => {
  // Empty state: no badges should be rendered
  const dockEmpty = projectCenterDock('work', {});
  assert.equal(dockEmpty.length, 8);
  assert.equal(dockEmpty[2].id, 'workers');
  assert.equal(dockEmpty[2].badge, null, 'Workers badge must be null when count is omitted');
  assert.equal(dockEmpty[3].id, 'runs');
  assert.equal(dockEmpty[3].badge, null, 'Runs badge must be null when count is omitted');

  // Explicit nonnegative counts
  const dockWithCounts = projectCenterDock('runs', {
    workerCount: 10,
    activeRunCount: 3,
    conversationCount: 4
  });
  assert.equal(dockWithCounts[1].badge, '4');
  assert.equal(dockWithCounts[2].badge, '10');
  assert.equal(dockWithCounts[3].badge, '3');
  assert.equal(dockWithCounts[3].active, true);

  // Refresh destination is index 7
  assert.equal(dockWithCounts[7].id, 'refresh');
  assert.equal(dockWithCounts[7].isAction, true);
});

test('Left and right utility docks format badges strictly from nonnegative integers', () => {
  const leftEmpty = projectLeftUtilityDock({});
  assert.equal(leftEmpty.find(d => d.id === 'notifications').badge, null);

  const leftActive = projectLeftUtilityDock({ unreadNotifications: 2 });
  assert.equal(leftActive.find(d => d.id === 'notifications').badge, '2');

  const rightEmpty = projectRightUtilityDock({});
  assert.equal(rightEmpty.find(d => d.id === 'workspaces').badge, null);

  const rightActive = projectRightUtilityDock({ activeWorkspacesCount: 2 });
  assert.equal(rightActive.find(d => d.id === 'workspaces').badge, '2');
});

test('Responsive navigation projection preserves compact routes, sheets, and persistent IFZ action', () => {
  const narrowNav = projectResponsiveNavigation('computer', { isNarrow: true });
  assert.equal(narrowNav.isNarrow, true);
  assert.equal(narrowNav.activeRoute.id, 'computer');
  assert.equal(narrowNav.compactRoutes.length, 6);
  assert.equal(narrowNav.panels.left.type, 'bottom-sheet');
  assert.equal(narrowNav.panels.right.type, 'bottom-sheet');
  assert.equal(narrowNav.primaryAction.id, 'ifz-prompt');
  assert.equal(narrowNav.primaryAction.persistent, true);
});

test('Development tweak controls are clearly scoped from product authority', () => {
  const tweaks = projectDevelopmentTweaks({ density: 'compact', detail: 'focused', theme: 'dark' });
  assert.equal(tweaks.scope, 'development');
  assert.equal(tweaks.authoritative, false);
  assert.match(tweaks.disclaimer, /non-authoritative/i);
  assert.match(tweaks.disclaimer, /cannot weaken security or authority/i);

  const densityControl = tweaks.controls.find(c => c.id === 'density');
  assert.equal(densityControl.current, 'compact');
});

test('Navigation state reducer tracks opener control and returns focus on Escape (CLOSE_ALL)', () => {
  let state = createShellNavigationState({ activeRoute: 'work' });
  assert.equal(state.topMenuOpen, false);
  assert.equal(state.leftPanel, null);
  assert.equal(state.rightPanel, null);
  assert.equal(state.openerId, null);
  assert.equal(state.returnFocusTo, null);

  // 1. Open Top Menu with openerId
  state = reduceNavigationAction(state, { type: 'TOGGLE_TOP_MENU', openerId: 'ps-menu-trigger' });
  assert.equal(state.topMenuOpen, true);
  assert.equal(state.openerId, 'ps-menu-trigger');

  // Press Escape (CLOSE_ALL): top menu closes and returnFocusTo is set to 'ps-menu-trigger'
  state = reduceNavigationAction(state, { type: 'CLOSE_ALL' });
  assert.equal(state.topMenuOpen, false);
  assert.equal(state.returnFocusTo, 'ps-menu-trigger');
  assert.equal(state.openerId, null);

  // Clear focus return
  state = reduceNavigationAction(state, { type: 'CLEAR_FOCUS_RETURN' });
  assert.equal(state.returnFocusTo, null);

  // 2. Open Left Panel from center dock with openerId
  state = reduceNavigationAction(state, { type: 'TOGGLE_LEFT_PANEL', panel: 'conversations', openerId: 'ps-center-tile-conversations' });
  assert.equal(state.leftPanel, 'conversations');
  assert.equal(state.openerId, 'ps-center-tile-conversations');

  // Press Escape: panel closes and returns focus to 'ps-center-tile-conversations'
  state = reduceNavigationAction(state, { type: 'CLOSE_ALL' });
  assert.equal(state.leftPanel, null);
  assert.equal(state.returnFocusTo, 'ps-center-tile-conversations');
  assert.equal(state.openerId, null);

  // 3. Open Right Panel with inspector tab
  state = reduceNavigationAction(state, { type: 'TOGGLE_RIGHT_PANEL', panel: 'inspector', openerId: 'ps-right-tile-inspector' });
  assert.equal(state.rightPanel, 'inspector');
  assert.equal(state.openerId, 'ps-right-tile-inspector');

  // Closing single panel returns focus
  state = reduceNavigationAction(state, { type: 'TOGGLE_RIGHT_PANEL', panel: 'inspector' });
  assert.equal(state.rightPanel, null);
  assert.equal(state.returnFocusTo, 'ps-right-tile-inspector');

  // 4. Open Tweak Modal
  state = reduceNavigationAction(state, { type: 'TOGGLE_TWEAK', openerId: 'ps-right-tile-appearance' });
  assert.equal(state.tweakPanelOpen, true);
  assert.equal(state.openerId, 'ps-right-tile-appearance');

  // Press Escape (CLOSE_ALL) returns focus to 'ps-right-tile-appearance'
  state = reduceNavigationAction(state, { type: 'CLOSE_ALL' });
  assert.equal(state.tweakPanelOpen, false);
  assert.equal(state.returnFocusTo, 'ps-right-tile-appearance');
});

test('formatCanonicalHash and formatCanonicalUrl generate pure canonical hashes and URLs', () => {
  // 1. formatCanonicalHash
  assert.equal(formatCanonicalHash('work'), '#work');
  assert.equal(formatCanonicalHash('workers'), '#workers');
  assert.equal(formatCanonicalHash('runs'), '#runs');
  assert.equal(formatCanonicalHash('overview'), '#work'); // alias
  assert.equal(formatCanonicalHash('activity'), '#runs'); // alias
  assert.equal(formatCanonicalHash('unknown'), '#work'); // fallback

  // 2. formatCanonicalUrl
  assert.equal(formatCanonicalUrl('work'), 'http://localhost:4000/#work');
  assert.equal(formatCanonicalUrl('workers', 'http://localhost:4000/'), 'http://localhost:4000/#workers');
  assert.equal(formatCanonicalUrl('computer', 'http://localhost:4000'), 'http://localhost:4000/#computer');
  assert.equal(formatCanonicalUrl('evidence', 'https://zetro.app/app/#legacy'), 'https://zetro.app/app/#evidence');

  // 3. createNavigationHistoryState
  const state = createNavigationHistoryState('workers', { timestamp: 123456 });
  assert.deepEqual(state, {
    routeId: 'workers',
    routeLabel: 'Workers',
    canonicalHash: '#workers',
    canonicalUrl: 'http://localhost:4000/#workers',
    timestamp: 123456
  });
});

test('parseRouteFromUrl and resolveInitialRoute handle route load across hashes, paths, queries, and aliases', () => {
  // 1. Route load from full URL string with hash
  assert.equal(resolveInitialRoute('http://localhost:4000/#workers').id, 'workers');
  assert.equal(resolveInitialRoute('http://localhost:4000/#/computer').id, 'computer');
  assert.equal(resolveInitialRoute('http://localhost:4000/#settings?section=master-prompt').id, 'settings');

  // 2. Route load from relative hash
  assert.equal(resolveInitialRoute('#runs').id, 'runs');
  assert.equal(resolveInitialRoute('#evidence').id, 'evidence');

  // 3. Route load from pathname
  assert.equal(resolveInitialRoute('/computer').id, 'computer');
  assert.equal(resolveInitialRoute('workers').id, 'workers');

  // 4. Route load with legacy aliases
  assert.equal(resolveInitialRoute('#overview').id, 'work');
  assert.equal(resolveInitialRoute('/activity').id, 'runs');

  // 5. Route load from Location-like object
  assert.equal(resolveInitialRoute({ hash: '#workers' }).id, 'workers');
  assert.equal(resolveInitialRoute({ pathname: '/evidence' }).id, 'evidence');
  assert.equal(resolveInitialRoute({ href: 'http://localhost:4000/#settings' }).id, 'settings');

  // 6. Graceful fallbacks for missing, empty, or unknown routes
  assert.equal(resolveInitialRoute(undefined).id, 'work');
  assert.equal(resolveInitialRoute('').id, 'work');
  assert.equal(resolveInitialRoute('#').id, 'work');
  assert.equal(resolveInitialRoute('#unknown-destination').id, 'work');
});

test('resolveRouteTransition generates pure navigation descriptors without side effects', () => {
  // 1. Forward navigation to a different route
  const transition = resolveRouteTransition('work', 'workers', { baseUrl: 'http://localhost:4000/' });
  assert.equal(transition.previousRoute, 'work');
  assert.equal(transition.nextRoute, 'workers');
  assert.equal(transition.changed, true);
  assert.equal(transition.hash, '#workers');
  assert.equal(transition.url, 'http://localhost:4000/#workers');
  assert.equal(transition.historyState.routeId, 'workers');

  // 2. Navigating to the same route
  const sameTransition = resolveRouteTransition('workers', 'workers');
  assert.equal(sameTransition.previousRoute, 'workers');
  assert.equal(sameTransition.nextRoute, 'workers');
  assert.equal(sameTransition.changed, false);

  // 3. Transition using alias input
  const aliasTransition = resolveRouteTransition('settings', '#overview');
  assert.equal(aliasTransition.previousRoute, 'settings');
  assert.equal(aliasTransition.nextRoute, 'work');
  assert.equal(aliasTransition.changed, true);
});

test('handlePopState resolves target route from history state or location fallback during back/forward', () => {
  // 1. History state present with routeId (standard forward/back)
  const fromHistory = handlePopState({ routeId: 'computer' }, '#work');
  assert.equal(fromHistory.routeId, 'computer');
  assert.equal(fromHistory.source, 'history-state');

  // 2. History state is null or missing routeId (e.g. pop back to landing page), falls back to location
  const fromLocation = handlePopState(null, '#evidence');
  assert.equal(fromLocation.routeId, 'evidence');
  assert.equal(fromLocation.source, 'location');

  // 3. Both missing or invalid, falls back to default canonical 'work'
  const fallback = handlePopState(undefined, '#invalid-hash');
  assert.equal(fallback.routeId, 'work');
  assert.equal(fallback.source, 'location');
});

test('resolveRefreshRoute and resolveCopiedRouteUrl handle refresh and copied share links safely', () => {
  // 1. Refresh with explicit deep-link location hash takes precedence
  const refreshWithDeepLink = resolveRefreshRoute({ routeId: 'workers' }, '#computer');
  assert.equal(refreshWithDeepLink.routeId, 'computer');
  assert.equal(refreshWithDeepLink.source, 'location-deep-link');

  // 2. Refresh without deep-link location falls back to persisted state
  const refreshFromState = resolveRefreshRoute({ routeId: 'runs' }, '');
  assert.equal(refreshFromState.routeId, 'runs');
  assert.equal(refreshFromState.source, 'persisted-state');

  // 3. Refresh with no evidence defaults to 'work'
  const refreshDefault = resolveRefreshRoute(null, '');
  assert.equal(refreshDefault.routeId, 'work');
  assert.equal(refreshDefault.source, 'default');

  // 4. Copied / Shareable URL resolution
  const shareableUrl = formatShareableRouteUrl('workers');
  assert.equal(shareableUrl, 'http://localhost:4000/#workers');

  // Valid copied route with complex query params
  const validCopied = resolveCopiedRouteUrl('https://zetro.app/app?source=share&theme=dark#computer');
  assert.equal(validCopied.valid, true);
  assert.equal(validCopied.routeId, 'computer');
  assert.equal(validCopied.canonicalUrl, 'http://localhost:4000/#computer');

  // Valid copied route with alias
  const aliasCopied = resolveCopiedRouteUrl('http://localhost:4000/#activity');
  assert.equal(aliasCopied.valid, true);
  assert.equal(aliasCopied.routeId, 'runs');

  // Invalid copied route returns fallback with valid: false
  const invalidCopied = resolveCopiedRouteUrl('http://localhost:4000/#nonexistent-view');
  assert.equal(invalidCopied.valid, false);
  assert.equal(invalidCopied.routeId, 'work');
  assert.equal(invalidCopied.canonicalUrl, 'http://localhost:4000/#work');
});

test('Closed side panels and modals guarantee null panel state and clean focus return in reducer', () => {
  const state = createShellNavigationState({ activeRoute: 'work' });
  assert.equal(state.leftPanel, null, 'Left panel must default to closed null state');
  assert.equal(state.rightPanel, null, 'Right panel must default to closed null state');
  assert.equal(state.topMenuOpen, false, 'Top menu must default to closed state');
  assert.equal(state.tweakPanelOpen, false, 'Tweak panel must default to closed state');

  // Navigating while modal is open automatically closes the modal
  const openMenuState = reduceNavigationAction(state, { type: 'TOGGLE_TOP_MENU', open: true, openerId: 'ps-menu-trigger' });
  assert.equal(openMenuState.topMenuOpen, true);
  const navigatedState = reduceNavigationAction(openMenuState, { type: 'NAVIGATE', routeId: 'computer' });
  assert.equal(navigatedState.topMenuOpen, false);
  assert.equal(navigatedState.activeRoute, 'computer');
  assert.equal(navigatedState.returnFocusTo, 'ps-menu-trigger');
});
