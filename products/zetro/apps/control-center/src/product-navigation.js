/**
 * @file product-navigation.js
 * Unified Route Registry and Navigation Projections for ZETRO IFZ Product Shell.
 *
 * Implements the architecture defined in docs/IFZ-UNIFIED-APP-ARCHITECTURE.md:
 * - One canonical route registry controlling top menu, center dock, side docks, and responsive shell.
 * - Top menu grouped by Product, IFZ, and System.
 * - Center dock with exactly 8 destinations in order (Work with IFZ Orb, Conversations, Workers, Runs, Computer, Evidence, Settings, Refresh).
 * - Left utility dock with Notifications, Search, Conversations, Command Palette.
 * - Right utility dock with Route, Context, Inspector, Appearance, Fullscreen, Workspaces, More.
 * - Truthful evidence reporting: no invented workspace, worker counts, connection state, or IFZ state.
 * - Strict focus return behavior on Escape.
 * - Development Tweak controls strictly scoped from product authority.
 */

/**
 * The six canonical product routes.
 * Work is the default primary page.
 */
export const CANONICAL_ROUTES = [
  {
    id: 'work',
    label: 'Work',
    href: '#work',
    purpose: 'IFZ conversations, prompts, routes, and active execution',
    default: true,
    icon: 'orb'
  },
  {
    id: 'workers',
    label: 'Workers',
    href: '#workers',
    purpose: 'Worker registry, fleets, capabilities, assignments, and qualification',
    default: false,
    icon: 'workers'
  },
  {
    id: 'runs',
    label: 'Runs',
    href: '#runs',
    purpose: 'Queued, active, completed, failed, cancelled, and uncertain routes',
    default: false,
    icon: 'runs'
  },
  {
    id: 'computer',
    label: 'Computer',
    href: '#computer',
    purpose: 'ZETRO computer sessions, permissions, status, and evidence',
    default: false,
    icon: 'computer'
  },
  {
    id: 'evidence',
    label: 'Evidence',
    href: '#evidence',
    purpose: 'Independent checks, receipts, changes, and route history',
    default: false,
    icon: 'evidence'
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '#settings',
    purpose: 'Master Prompt, adapters, permissions, providers, limits, and appearance',
    default: false,
    icon: 'settings'
  }
];

/**
 * Standard readable label mapping for the 6 canonical routes.
 */
export const ROUTE_LABELS = {
  work: 'Work',
  workers: 'Workers',
  runs: 'Runs',
  computer: 'Computer',
  evidence: 'Evidence',
  settings: 'Settings'
};

/**
 * Factory for dynamic registries (worker groups, saved routes, recent conversations).
 * Ensures worker fleets and saved templates are not hardcoded into navigation components.
 */
export function createDynamicRegistries(state = {}) {
  const workerGroups = Array.isArray(state?.workerGroups) && state.workerGroups.length > 0
    ? state.workerGroups
    : Array.isArray(state?.workers) && state.workers.length > 0
      ? [...new Set(state.workers.map(w => w.group).filter(Boolean))]
      : ['RCT', 'AGR', 'OCR'];

  const savedRoutes = Array.isArray(state?.savedRoutes) && state.savedRoutes.length > 0
    ? state.savedRoutes
    : [
        { id: 'agr-5-rct', label: 'AGR × 5 → RCT', strategy: 'Parallel 5-worker review + RCT synthesis' },
        { id: 'ocr-codex', label: 'OCR → Codex review', strategy: 'OCR extraction + dual pass' },
        { id: 'full-qual', label: 'Full qualification', strategy: 'All-agent benchmark suite' }
      ];

  const recentConversations = Array.isArray(state?.recentConversations) && state.recentConversations.length > 0
    ? state.recentConversations
    : [
        { id: 'unified-app', title: 'Unified app architecture' },
        { id: 'computer-agent-qual', title: 'Computer agent qualification' },
        { id: 'rct-review', title: 'RCT provider review' }
      ];

  return {
    workerGroups,
    savedRoutes,
    recentConversations
  };
}

/**
 * Former primary destinations removed per IFZ architecture.
 */
export const REMOVED_PRIMARY_ROUTES = [
  {
    id: 'readiness',
    label: 'RCT Readiness',
    destination: 'Moved into RCT worker detail and Evidence pages'
  },
  {
    id: 'requirements',
    alias: 'roadmap',
    label: 'Roadmap',
    destination: 'Moved out of primary navigation into Development Lab / Planning'
  },
  {
    id: 'orb-preview',
    label: 'Orb Preview',
    destination: 'Removed as primary header CTA; moved into Computer page / Development Lab'
  }
];

/**
 * Top menu grouped navigation definition.
 * Groups links strictly under Product, IFZ, and System.
 */
export const TOP_MENU_GROUPS = [
  {
    id: 'product',
    label: 'Product',
    description: 'Core application work surfaces and execution records',
    items: [
      { id: 'work', label: 'Work', href: '#work', description: 'IFZ prompts, conversations & execution', routeId: 'work' },
      { id: 'workers', label: 'Workers', href: '#workers', description: 'Worker fleet registry & capability manifests', routeId: 'workers' },
      { id: 'runs', label: 'Runs', href: '#runs', description: 'Complete durable execution routes & timelines', routeId: 'runs' },
      { id: 'computer', label: 'Computer', href: '#computer', description: 'ZETRO computer sessions & native evidence', routeId: 'computer' },
      { id: 'evidence', label: 'Evidence', href: '#evidence', description: 'Independent checks, receipts & audit logs', routeId: 'evidence' }
    ]
  },
  {
    id: 'ifz',
    label: 'IFZ',
    description: 'Central prompt, context, routing, and audit layer',
    items: [
      { id: 'master-prompt', label: 'Master Prompt', href: '#settings?section=master-prompt', description: 'Charter, Worker Knowledge & Context layers', routeId: 'settings' },
      { id: 'presets', label: 'Presets', href: '#settings?section=presets', description: 'Standard, ECO, Build, Review & Qualification modes', routeId: 'settings' },
      { id: 'saved-routes', label: 'Saved Routes', href: '#work?tab=saved-routes', description: 'Reusable route templates & execution strategies', routeId: 'work' },
      { id: 'worker-registry', label: 'Worker Registry', href: '#workers?tab=registry', description: 'Adapter capabilities, contracts & manifests', routeId: 'workers' }
    ]
  },
  {
    id: 'system',
    label: 'System',
    description: 'Platform infrastructure, security & development tools',
    items: [
      { id: 'connections', label: 'Connections', href: '#settings?section=connections', description: 'Local adapters, process runners & endpoints', routeId: 'settings' },
      { id: 'permissions', label: 'Permissions', href: '#settings?section=permissions', description: 'Desktop access grants & authority limits', routeId: 'settings' },
      { id: 'appearance', label: 'Appearance', href: '#settings?section=appearance', description: 'Visual themes, density & display options', routeId: 'settings' },
      { id: 'diagnostics', label: 'Diagnostics', href: '#settings?section=diagnostics', description: 'System health logs & execution journals', routeId: 'settings' },
      { id: 'development-lab', label: 'Development Lab', href: '#lab', description: 'Component showcases, simulations & tweaks', scope: 'development', authoritative: false }
    ]
  }
];

/**
 * Normalizes and looks up a route by id or hash.
 * Handles legacy aliases (overview -> work, activity -> runs).
 *
 * @param {string} routeId
 * @returns {Object|null}
 */
export function getRoute(routeId) {
  if (!routeId || typeof routeId !== 'string') return null;
  const clean = routeId.trim().toLowerCase().replace(/^[#/]+/, '').split(/[?#]/)[0];
  if (!clean) return null;
  if (clean === 'overview') return CANONICAL_ROUTES[0]; // Overview becomes Work empty-state
  if (clean === 'activity') return CANONICAL_ROUTES[2]; // Activity becomes Runs
  return CANONICAL_ROUTES.find(r => r.id === clean) || null;
}

/**
 * Returns true if the id represents one of the 6 canonical routes.
 */
export function isValidRoute(routeId) {
  return getRoute(routeId) !== null;
}

/**
 * Resolves to a valid canonical route, defaulting to 'work'.
 */
export function resolveActiveRoute(routeId) {
  return getRoute(routeId) || CANONICAL_ROUTES[0];
}

/**
 * Checks whether a route id was removed from primary navigation.
 */
export function isRemovedPrimaryRoute(routeId) {
  if (!routeId || typeof routeId !== 'string') return false;
  const clean = routeId.trim().toLowerCase().replace(/^[#/]+/, '').split(/[?#]/)[0];
  return REMOVED_PRIMARY_ROUTES.some(r => r.id === clean || r.alias === clean);
}

/**
 * Formats a canonical URL hash for a route (always `#<routeId>`).
 *
 * @param {string} routeId
 * @returns {string}
 */
export function formatCanonicalHash(routeId) {
  const route = getRoute(routeId) || CANONICAL_ROUTES[0];
  return `#${route.id}`;
}

/**
 * Builds a canonical URL for a given route. Pure function without side effects.
 *
 * @param {string} routeId
 * @param {string} [baseUrl='http://localhost:4000/']
 * @returns {string}
 */
export function formatCanonicalUrl(routeId, baseUrl = 'http://localhost:4000/') {
  const route = getRoute(routeId) || CANONICAL_ROUTES[0];
  const base = String(baseUrl).replace(/#.*$/, '');
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  return `${cleanBase}#${route.id}`;
}

/**
 * Creates a pure navigation history state object suitable for pushState / replaceState.
 *
 * @param {string} routeId
 * @param {Object} [meta={}]
 * @returns {Object}
 */
export function createNavigationHistoryState(routeId, meta = {}) {
  const route = getRoute(routeId) || CANONICAL_ROUTES[0];
  const baseUrl = meta.baseUrl || 'http://localhost:4000/';
  return {
    routeId: route.id,
    routeLabel: route.label,
    canonicalHash: `#${route.id}`,
    canonicalUrl: formatCanonicalUrl(route.id, baseUrl),
    timestamp: typeof meta.timestamp === 'number' ? meta.timestamp : 0,
    ...meta
  };
}

/**
 * Resolves a canonical route from any URL string, hash, or Location-like object.
 * Pure function: supports full URLs, hashes, pathnames, search params, and legacy aliases.
 *
 * @param {string|Object} [input]
 * @param {string} [fallback='work']
 * @returns {Object} Canonical route definition
 */
export function parseRouteFromUrl(input, fallback = 'work') {
  const getFallback = () => (fallback !== null && fallback !== undefined ? resolveActiveRoute(fallback) : null);

  if (!input) return getFallback();

  let raw = '';
  if (typeof input === 'string') {
    raw = input;
  } else if (typeof input === 'object') {
    if (input.hash) {
      raw = input.hash;
    } else if (input.pathname && input.pathname !== '/') {
      raw = input.pathname;
    } else if (input.href) {
      raw = input.href;
    }
  }

  if (!raw || typeof raw !== 'string') {
    return getFallback();
  }

  // 1. Check hash first if present (e.g. http://localhost:4000/#workers or #/workers)
  const hashIdx = raw.indexOf('#');
  if (hashIdx !== -1) {
    const afterHash = raw.slice(hashIdx + 1);
    const token = afterHash.split(/[?#&]/)[0].replace(/^\/+/, '');
    const matched = getRoute(token);
    if (matched) return matched;
    return getFallback();
  }

  // 2. Check pathname or raw path token
  const pathPart = raw.split(/[?#]/)[0].replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/^\/+/, '');
  const pathToken = pathPart.split('/')[0];
  const matchedPath = getRoute(pathToken);
  if (matchedPath) return matchedPath;

  return getFallback();
}

/**
 * Pure helper for route load: resolves initial canonical route from location or URL.
 *
 * @param {string|Object} [locationInput]
 * @returns {Object} Canonical route definition
 */
export function resolveInitialRoute(locationInput) {
  return parseRouteFromUrl(locationInput, 'work');
}

/**
 * Pure helper for route navigation transitions.
 * Calculates previous/next route, canonical hash, URL, and history state without side effects.
 *
 * @param {string} currentRouteId
 * @param {string} targetInput
 * @param {Object} [options={}]
 * @returns {Object} Transition descriptor
 */
export function resolveRouteTransition(currentRouteId, targetInput, options = {}) {
  const current = resolveActiveRoute(currentRouteId);
  const next = parseRouteFromUrl(targetInput, current.id);
  const changed = current.id !== next.id;
  const baseUrl = options.baseUrl || 'http://localhost:4000/';

  return {
    previousRoute: current.id,
    nextRoute: next.id,
    route: next,
    changed,
    hash: formatCanonicalHash(next.id),
    url: formatCanonicalUrl(next.id, baseUrl),
    historyState: createNavigationHistoryState(next.id, { ...options.meta, baseUrl })
  };
}

/**
 * Pure helper for back/forward navigation (popstate event).
 * Determines target canonical route from popstate event state or location fallback.
 *
 * @param {Object} [eventState]
 * @param {string|Object} [locationInput]
 * @returns {Object}
 */
export function handlePopState(eventState, locationInput) {
  if (eventState && typeof eventState === 'object' && eventState.routeId) {
    const matched = getRoute(eventState.routeId);
    if (matched) {
      return {
        routeId: matched.id,
        route: matched,
        source: 'history-state',
        state: eventState
      };
    }
  }

  const fromLocation = parseRouteFromUrl(locationInput, 'work');
  return {
    routeId: fromLocation.id,
    route: fromLocation,
    source: 'location',
    state: eventState || null
  };
}

/**
 * Pure helper for page refresh / rehydration.
 * Resolves persistent canonical route from location deep-link or persisted state.
 *
 * @param {Object} [persistedState]
 * @param {string|Object} [locationInput]
 * @returns {Object}
 */
export function resolveRefreshRoute(persistedState, locationInput) {
  if (locationInput) {
    let hasExplicitToken = false;
    if (typeof locationInput === 'string') {
      hasExplicitToken = locationInput.includes('#') || (locationInput.includes('/') && !locationInput.endsWith('/'));
    } else if (typeof locationInput === 'object') {
      hasExplicitToken = Boolean(locationInput.hash && locationInput.hash !== '#' && locationInput.hash !== '#/') ||
                         Boolean(locationInput.pathname && locationInput.pathname !== '/');
    }
    if (hasExplicitToken) {
      const fromUrl = parseRouteFromUrl(locationInput, null);
      if (fromUrl) {
        return {
          routeId: fromUrl.id,
          route: fromUrl,
          source: 'location-deep-link'
        };
      }
    }
  }

  if (persistedState && typeof persistedState === 'object' && persistedState.routeId) {
    const matched = getRoute(persistedState.routeId);
    if (matched) {
      return {
        routeId: matched.id,
        route: matched,
        source: 'persisted-state'
      };
    }
  }

  const defaultRoute = CANONICAL_ROUTES[0];
  return {
    routeId: defaultRoute.id,
    route: defaultRoute,
    source: 'default'
  };
}

/**
 * Formats a clean, shareable canonical URL for copying or deep linking.
 *
 * @param {string} routeId
 * @param {string} [baseUrl='http://localhost:4000/']
 * @returns {string}
 */
export function formatShareableRouteUrl(routeId, baseUrl = 'http://localhost:4000/') {
  return formatCanonicalUrl(routeId, baseUrl);
}

/**
 * Resolves and validates a copied or shared URL string into canonical route details.
 *
 * @param {string} urlString
 * @param {string} [baseUrl='http://localhost:4000/']
 * @returns {Object}
 */
export function resolveCopiedRouteUrl(urlString, baseUrl = 'http://localhost:4000/') {
  if (!urlString || typeof urlString !== 'string') {
    const def = CANONICAL_ROUTES[0];
    return {
      valid: false,
      routeId: def.id,
      route: def,
      canonicalUrl: formatCanonicalUrl(def.id, baseUrl),
      originalUrl: urlString || ''
    };
  }

  const parsed = parseRouteFromUrl(urlString, null);
  if (parsed) {
    return {
      valid: true,
      routeId: parsed.id,
      route: parsed,
      canonicalUrl: formatCanonicalUrl(parsed.id, baseUrl),
      originalUrl: urlString
    };
  }

  const def = CANONICAL_ROUTES[0];
  return {
    valid: false,
    routeId: def.id,
    route: def,
    canonicalUrl: formatCanonicalUrl(def.id, baseUrl),
    originalUrl: urlString
  };
}

/**
 * Evaluates connection observation truthfully.
 * Missing, malformed, or stale evidence produces an explicit non-connected status with no pulse.
 *
 * @param {Object} [state]
 * @returns {Object}
 */
export function resolveConnectionStatus(state = {}) {
  if (!state || typeof state !== 'object') {
    return {
      connected: false,
      status: 'unknown',
      label: 'Connection unknown',
      pulse: false
    };
  }

  // Explicit stale flag
  if (state.stale === true) {
    return {
      connected: false,
      status: 'stale',
      label: 'Connection stale',
      pulse: false
    };
  }

  // Stale observation timestamp check if provided
  if (typeof state.connectionObservedAt === 'number') {
    const ttl = typeof state.connectionTtlMs === 'number' && state.connectionTtlMs > 0 ? state.connectionTtlMs : 30000;
    const now = typeof state.now === 'number' ? state.now : Date.now();
    if (now - state.connectionObservedAt > ttl) {
      return {
        connected: false,
        status: 'stale',
        label: 'Connection stale',
        pulse: false
      };
    }
  }

  // Explicit boolean checks only
  if (state.connected === true) {
    return {
      connected: true,
      status: 'connected',
      label: 'Connected',
      pulse: true
    };
  }

  if (state.connected === false) {
    return {
      connected: false,
      status: 'disconnected',
      label: 'Disconnected',
      pulse: false
    };
  }

  // Any non-boolean value (undefined, null, string, number, object) is treated truthfully as unknown
  return {
    connected: false,
    status: 'unknown',
    label: 'Connection unknown',
    pulse: false
  };
}

/**
 * Resolves workspace evidence truthfully without inventing paths or names.
 *
 * @param {Object} [state]
 * @returns {Object}
 */
export function resolveWorkspaceStatus(state = {}) {
  const hasId = typeof state?.workspaceId === 'string' && state.workspaceId.trim().length > 0;
  const hasName = typeof state?.workspaceName === 'string' && state.workspaceName.trim().length > 0;
  const hasPath = typeof state?.workspacePath === 'string' && state.workspacePath.trim().length > 0;

  return {
    id: hasId ? state.workspaceId.trim() : null,
    name: hasName ? state.workspaceName.trim() : 'No workspace',
    path: hasPath ? state.workspacePath.trim() : null,
    admitted: Boolean(hasId && hasPath)
  };
}

/**
 * Resolves IFZ layer state truthfully without assuming it is active.
 *
 * @param {Object} [state]
 * @returns {Object}
 */
export function resolveIfzStatus(state = {}) {
  const mode = typeof state?.routingMode === 'string' && state.routingMode.trim().length > 0
    ? state.routingMode.trim()
    : 'automatic';

  if (state?.ifzActive === true || state?.ifzStatus === 'active') {
    return {
      mode,
      active: true,
      status: 'active',
      label: 'IFZ'
    };
  }

  if (state?.ifzActive === false || state?.ifzStatus === 'inactive') {
    return {
      mode,
      active: false,
      status: 'inactive',
      label: 'IFZ Inactive'
    };
  }

  return {
    mode,
    active: false,
    status: 'unknown',
    label: 'IFZ Unknown'
  };
}

/**
 * Formats a count badge truthfully.
 * Returns a string only if given a valid nonnegative integer > 0.
 * Zero or non-integer / omitted values return null (no badge).
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function formatCountBadge(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  return null;
}

/**
 * Projects top navigation header and grouped menu model.
 *
 * @param {string} currentRouteId
 * @param {Object} [state]
 * @returns {Object}
 */
export function projectTopMenu(currentRouteId, state = {}) {
  const active = resolveActiveRoute(currentRouteId);
  return {
    brand: {
      mark: 'Z',
      name: 'ZETRO'
    },
    activeRoute: active,
    connectionStatus: resolveConnectionStatus(state),
    workspace: resolveWorkspaceStatus(state),
    ifzStatus: resolveIfzStatus(state),
    groups: TOP_MENU_GROUPS.map(group => ({
      ...group,
      items: group.items.map(item => ({
        ...item,
        active: item.routeId === active.id
      }))
    })),
    // Orb Preview is explicitly removed as a primary header CTA per architecture requirements
    headerCta: null
  };
}

/**
 * Projects the center dock items in strict architectural order:
 * 1. Work with IFZ Orb icon
 * 2. Conversations
 * 3. Workers
 * 4. Runs
 * 5. Computer
 * 6. Evidence
 * 7. Settings
 * 8. Refresh
 *
 * @param {string} currentRouteId
 * @param {Object} [state]
 * @returns {Array<Object>}
 */
export function projectCenterDock(currentRouteId, state = {}) {
  const active = resolveActiveRoute(currentRouteId);

  return [
    {
      id: 'work',
      label: 'Work',
      href: '#work',
      icon: 'orb',
      isIfzOrb: true,
      active: active.id === 'work',
      badge: null,
      tooltip: 'IFZ Work & Active Prompts'
    },
    {
      id: 'conversations',
      label: 'Conversations',
      icon: 'conversations',
      action: 'toggle-left-panel',
      targetPanel: 'conversations',
      active: state.leftPanel === 'conversations',
      badge: formatCountBadge(state.conversationCount),
      tooltip: 'Conversations & Saved Routes'
    },
    {
      id: 'workers',
      label: 'Workers',
      href: '#workers',
      icon: 'workers',
      active: active.id === 'workers',
      badge: formatCountBadge(state.workerCount),
      tooltip: 'Worker Fleet Registry'
    },
    {
      id: 'runs',
      label: 'Runs',
      href: '#runs',
      icon: 'runs',
      active: active.id === 'runs',
      badge: formatCountBadge(state.activeRunCount),
      tooltip: 'Active & Durable Runs'
    },
    {
      id: 'computer',
      label: 'Computer',
      href: '#computer',
      icon: 'computer',
      active: active.id === 'computer',
      badge: null,
      tooltip: 'ZETRO Computer Session'
    },
    {
      id: 'evidence',
      label: 'Evidence',
      href: '#evidence',
      icon: 'evidence',
      active: active.id === 'evidence',
      badge: null,
      tooltip: 'Independent Verification & Checks'
    },
    {
      id: 'settings',
      label: 'Settings',
      href: '#settings',
      icon: 'settings',
      active: active.id === 'settings',
      badge: null,
      tooltip: 'Master Prompt & System Configuration'
    },
    {
      id: 'refresh',
      label: 'Refresh Evidence',
      icon: 'refresh',
      action: 'refresh-evidence',
      isAction: true,
      active: false,
      badge: null,
      tooltip: 'Sync Verified Evidence'
    }
  ];
}

/**
 * Projects the left utility dock items:
 * Notifications, Search, Conversations, Command Palette.
 *
 * @param {Object} [state]
 * @returns {Array<Object>}
 */
export function projectLeftUtilityDock(state = {}) {
  return [
    {
      id: 'notifications',
      label: 'Notifications',
      icon: 'bell',
      action: 'open-notifications',
      badge: formatCountBadge(state.unreadNotifications),
      tooltip: 'Notifications'
    },
    {
      id: 'search',
      label: 'Search (Ctrl+K)',
      shortcut: 'Ctrl+K',
      icon: 'search',
      action: 'open-search',
      badge: null,
      tooltip: 'Global Quick Search'
    },
    {
      id: 'conversations',
      label: 'Conversations',
      icon: 'conversations',
      action: 'toggle-left-panel',
      targetPanel: 'conversations',
      active: state.leftPanel === 'conversations',
      badge: null,
      tooltip: 'Toggle Left Conversations Panel'
    },
    {
      id: 'command-palette',
      label: 'Command Palette',
      shortcut: 'Ctrl+Shift+P',
      icon: 'command',
      action: 'open-command-palette',
      badge: null,
      tooltip: 'Open Command Palette'
    }
  ];
}

/**
 * Projects the right utility dock items:
 * Route, Context, Inspector, Appearance, Fullscreen, Workspaces, More.
 *
 * @param {Object} [state]
 * @returns {Array<Object>}
 */
export function projectRightUtilityDock(state = {}) {
  return [
    {
      id: 'route',
      label: 'IFZ Route',
      icon: 'route',
      action: 'toggle-right-panel',
      targetPanel: 'route',
      active: state.rightPanel === 'route',
      tooltip: 'IFZ Route Plan & Worker Order'
    },
    {
      id: 'context',
      label: 'Context',
      icon: 'context',
      action: 'toggle-right-panel',
      targetPanel: 'context',
      active: state.rightPanel === 'context',
      tooltip: 'Context Package & Preset Versions'
    },
    {
      id: 'inspector',
      label: 'Inspector',
      icon: 'inspector',
      action: 'toggle-right-panel',
      targetPanel: 'inspector',
      active: state.rightPanel === 'inspector',
      tooltip: 'Run Inspector & Verified Effects'
    },
    {
      id: 'appearance',
      label: 'Appearance',
      icon: 'sliders',
      action: 'toggle-tweak',
      active: Boolean(state.tweakPanelOpen),
      scope: 'development',
      authoritative: false,
      tooltip: 'Display Density & Tweaks (Dev)'
    },
    {
      id: 'fullscreen',
      label: 'Fullscreen',
      icon: 'fullscreen',
      action: 'toggle-fullscreen',
      active: Boolean(state.fullscreen),
      tooltip: 'Toggle Fullscreen'
    },
    {
      id: 'workspaces',
      label: 'Workspaces',
      icon: 'workspaces',
      action: 'toggle-workspaces',
      badge: formatCountBadge(state.activeWorkspacesCount),
      tooltip: 'Active Virtual Workspaces'
    },
    {
      id: 'more',
      label: 'More',
      icon: 'more',
      action: 'toggle-more',
      active: false,
      tooltip: 'More Workspace Options'
    }
  ];
}

/**
 * Projects the responsive navigation model for narrow/mobile screens.
 *
 * @param {string} currentRouteId
 * @param {Object} [options]
 * @returns {Object}
 */
export function projectResponsiveNavigation(currentRouteId, { isNarrow = false } = {}) {
  const active = resolveActiveRoute(currentRouteId);
  return {
    isNarrow,
    activeRoute: active,
    compactRoutes: CANONICAL_ROUTES.map(route => ({
      ...route,
      active: route.id === active.id
    })),
    panels: {
      left: {
        id: 'conversations',
        label: 'Conversations Sheet',
        type: isNarrow ? 'bottom-sheet' : 'sliding-drawer'
      },
      right: {
        id: 'inspector',
        label: 'Inspector Sheet',
        type: isNarrow ? 'bottom-sheet' : 'sliding-drawer'
      }
    },
    primaryAction: {
      id: 'ifz-prompt',
      label: 'IFZ Prompt',
      persistent: true
    }
  };
}

/**
 * Clearly isolates development-only visual tweak controls from product authority.
 *
 * @param {Object} [state]
 * @returns {Object}
 */
export function projectDevelopmentTweaks(state = {}) {
  return {
    scope: 'development',
    authoritative: false,
    disclaimer: 'Development Preview Only — Non-authoritative display parameters. Cannot weaken security or authority policy.',
    controls: [
      {
        id: 'density',
        label: 'Layout Density',
        type: 'select',
        options: ['relaxed', 'compact'],
        current: state.density || 'relaxed'
      },
      {
        id: 'detail',
        label: 'Detail Level',
        type: 'select',
        options: ['focused', 'expanded'],
        current: state.detail || 'focused'
      },
      {
        id: 'theme',
        label: 'Color Theme',
        type: 'select',
        options: ['dark', 'light'],
        current: state.theme || 'dark'
      }
    ]
  };
}

/**
 * Factory for default shell navigation state.
 * Uses neutral non-invented defaults.
 *
 * @param {Object} [initial]
 * @returns {Object}
 */
export function createShellNavigationState(initial = {}) {
  return {
    activeRoute: resolveActiveRoute(initial.activeRoute || 'work').id,
    leftPanel: initial.leftPanel || null, // null | 'conversations'
    rightPanel: initial.rightPanel || null, // null | 'route' | 'context' | 'inspector'
    topMenuOpen: Boolean(initial.topMenuOpen),
    tweakPanelOpen: Boolean(initial.tweakPanelOpen),
    density: initial.density || 'relaxed',
    detail: initial.detail || 'focused',
    workerCount: typeof initial.workerCount === 'number' ? initial.workerCount : null,
    activeRunCount: typeof initial.activeRunCount === 'number' ? initial.activeRunCount : null,
    activeWorkspacesCount: typeof initial.activeWorkspacesCount === 'number' ? initial.activeWorkspacesCount : null,
    conversationCount: typeof initial.conversationCount === 'number' ? initial.conversationCount : null,
    unreadNotifications: typeof initial.unreadNotifications === 'number' ? initial.unreadNotifications : null,
    connected: typeof initial.connected === 'boolean' ? initial.connected : undefined,
    stale: Boolean(initial.stale),
    workspaceId: typeof initial.workspaceId === 'string' ? initial.workspaceId : null,
    workspaceName: typeof initial.workspaceName === 'string' ? initial.workspaceName : null,
    workspacePath: typeof initial.workspacePath === 'string' ? initial.workspacePath : null,
    ifzActive: typeof initial.ifzActive === 'boolean' ? initial.ifzActive : undefined,
    openerId: null,
    returnFocusTo: null
  };
}

/**
 * Reducer for shell navigation state actions.
 * Guarantees clean panel, Escape behavior, and focus return tracking.
 *
 * @param {Object} state
 * @param {Object} action
 * @returns {Object}
 */
export function reduceNavigationAction(state, action) {
  if (!action || typeof action !== 'object') return state;

  switch (action.type) {
    case 'NAVIGATE': {
      const nextRoute = resolveActiveRoute(action.routeId).id;
      const willClose = state.topMenuOpen;
      return {
        ...state,
        activeRoute: nextRoute,
        topMenuOpen: false,
        returnFocusTo: willClose ? (state.openerId || action.openerId || null) : null,
        openerId: willClose ? null : state.openerId
      };
    }
    case 'TOGGLE_TOP_MENU': {
      const nextOpen = typeof action.open === 'boolean' ? action.open : !state.topMenuOpen;
      return {
        ...state,
        topMenuOpen: nextOpen,
        openerId: nextOpen ? (action.openerId || 'menu-trigger') : null,
        returnFocusTo: !nextOpen ? (state.openerId || action.openerId || 'menu-trigger') : null
      };
    }
    case 'TOGGLE_LEFT_PANEL': {
      const panel = action.panel || 'conversations';
      const isClosing = state.leftPanel === panel;
      return {
        ...state,
        leftPanel: isClosing ? null : panel,
        openerId: isClosing ? null : (action.openerId || panel),
        returnFocusTo: isClosing ? (state.openerId || action.openerId || panel) : null
      };
    }
    case 'TOGGLE_RIGHT_PANEL': {
      const panel = action.panel || 'inspector';
      const isClosing = state.rightPanel === panel;
      return {
        ...state,
        rightPanel: isClosing ? null : panel,
        openerId: isClosing ? null : (action.openerId || panel),
        returnFocusTo: isClosing ? (state.openerId || action.openerId || panel) : null
      };
    }
    case 'TOGGLE_TWEAK': {
      const nextOpen = typeof action.open === 'boolean' ? action.open : !state.tweakPanelOpen;
      return {
        ...state,
        tweakPanelOpen: nextOpen,
        openerId: nextOpen ? (action.openerId || 'appearance') : null,
        returnFocusTo: !nextOpen ? (state.openerId || action.openerId || 'appearance') : null
      };
    }
    case 'CLOSE_ALL': {
      // Escape key handler: closes all open overlays, drawers and menus, returning focus to opener
      const hadOpenOverlay = state.topMenuOpen || state.leftPanel !== null || state.rightPanel !== null || state.tweakPanelOpen;
      const targetOpener = state.openerId || action.openerId || null;
      return {
        ...state,
        topMenuOpen: false,
        leftPanel: null,
        rightPanel: null,
        tweakPanelOpen: false,
        openerId: null,
        returnFocusTo: hadOpenOverlay ? targetOpener : null
      };
    }
    case 'CLEAR_FOCUS_RETURN': {
      return {
        ...state,
        returnFocusTo: null
      };
    }
    case 'SET_APPEARANCE': {
      // Non-authoritative visual appearance updates
      return {
        ...state,
        density: action.density || state.density,
        detail: action.detail || state.detail
      };
    }
    default:
      return state;
  }
}
