/**
 * @file apps/control-center/src/index.js
 * Integration entry module for ZETRO IFZ Unified Product Shell & Control Center.
 *
 * Implements live application integration:
 * - Mounts IfzWorkPage in ProductShell as default live route ('work').
 * - Keeps canonical navigation state for the composed product shell.
 * - Wires canonical URL hash, history state, popstate back/forward, and copied-route resolution.
 * - Consumes read-only status data truthfully without inventing counts, connections, or paths.
 * - Protects read-only authority: Composer remains visibly dry-run with zero mutation endpoints.
 * - Preserves Computer page and orb preview without asserting unverified native proof.
 * - Hides development fixtures unless explicit devLab flag is enabled.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';

import { ProductShell } from './product-shell.jsx';
import IfzWorkPage from './ifz-work-page.jsx';
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
} from './product-navigation.js';

export {
  mapStatusProjection,
  resolveDevLabFlag
} from './live-integration.js';

import {
  mapStatusProjection,
  resolveDevLabFlag
} from './live-integration.js';

/**
 * Mounts IfzWorkPage into the .ps-work-view container inside ProductShell.
 */
function WorkViewPortal({ devLab = false }) {
  const [container, setContainer] = useState(() => {
    return typeof document !== 'undefined' ? document.querySelector('.ps-work-view') : null;
  });

  useEffect(() => {
    const findContainer = () => {
      const el = document.querySelector('.ps-work-view');
      if (el) {
        el.textContent = '';
        setContainer(el);
      }
    };
    findContainer();

    const mainEl = document.getElementById('main-content');
    if (mainEl && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(findContainer);
      observer.observe(mainEl, { childList: true, subtree: true });
      return () => observer.disconnect();
    }
  }, []);

  if (!container) return null;
  return createPortal(React.createElement(IfzWorkPage, { devLab }), container);
}

/**
 * Mounts Computer Page View into .ps-computer-view with truthful simulated preview limits.
 */
function ComputerViewPortal({ boundaries }) {
  const [container, setContainer] = useState(() => {
    return typeof document !== 'undefined' ? document.querySelector('.ps-computer-view') : null;
  });

  useEffect(() => {
    const findContainer = () => {
      const el = document.querySelector('.ps-computer-view');
      if (el) {
        el.textContent = '';
        setContainer(el);
      }
    };
    findContainer();

    const mainEl = document.getElementById('main-content');
    if (mainEl && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(findContainer);
      observer.observe(mainEl, { childList: true, subtree: true });
      return () => observer.disconnect();
    }
  }, []);

  if (!container) return null;
  return createPortal(
    React.createElement(
      'div',
      { className: 'ps-computer-page-container' },
      React.createElement(
        'div',
        { className: 'ps-computer-preview-alert', role: 'status' },
        React.createElement('span', { className: 'ps-computer-preview-pill' }, 'SIMULATED PREVIEW · READ-ONLY'),
        React.createElement(
          'p',
          { className: 'ps-computer-preview-notice' },
          'Computer sessions operate under strict read-only boundary authority. Native desktop execution is simulated and is not asserted as verified native proof in this preview.'
        )
      ),
      React.createElement(
        'div',
        { className: 'ps-computer-preview-grid' },
        React.createElement(
          'div',
          { className: 'ps-computer-preview-card' },
          React.createElement('h3', { className: 'ps-computer-preview-card__title' }, 'Session Authority'),
          React.createElement(
            'div',
            { className: 'ps-computer-preview-card__meta' },
            React.createElement('div', null, React.createElement('span', null, 'Authority Mode: '), React.createElement('strong', null, 'Read-Only Projection')),
            React.createElement('div', null, React.createElement('span', null, 'Live Inference: '), React.createElement('strong', null, 'Disabled (Zero Model Calls)')),
            React.createElement('div', null, React.createElement('span', null, 'Desktop Verification: '), React.createElement('strong', null, 'Simulated Sandbox'))
          )
        ),
        React.createElement(
          'div',
          { className: 'ps-computer-preview-card' },
          React.createElement('h3', { className: 'ps-computer-preview-card__title' }, 'Interactive Orb Simulator'),
          React.createElement(
            'p',
            { className: 'ps-computer-preview-card__text' },
            'Launch the dedicated native desktop simulation and orb inspector in an isolated window.'
          ),
          React.createElement(
            'a',
            {
              href: '/computer-preview/',
              className: 'ps-computer-preview-btn',
              target: '_blank',
              rel: 'noopener noreferrer'
            },
            'Open Standalone Computer Preview →'
          )
        )
      )
    ),
    container
  );
}

/**
 * Mounts Workers Fleet list into .ps-workers-view.
 */
function WorkersViewPortal({ workers = [] }) {
  const [container, setContainer] = useState(() => {
    return typeof document !== 'undefined' ? document.querySelector('.ps-workers-view') : null;
  });

  useEffect(() => {
    const findContainer = () => {
      const el = document.querySelector('.ps-workers-view');
      if (el) {
        el.textContent = '';
        setContainer(el);
      }
    };
    findContainer();
  }, []);

  if (!container) return null;
  return createPortal(
    React.createElement(
      'div',
      { className: 'ps-workers-page-container' },
      React.createElement(
        'div',
        { className: 'ps-workers-list-header' },
        React.createElement('span', { className: 'ps-workers-count' }, `${workers.length} Observed Worker Slots`)
      ),
      React.createElement(
        'div',
        { className: 'ps-workers-grid' },
        workers.map(w =>
          React.createElement(
            'div',
            { key: w.name, className: 'ps-worker-card' },
            React.createElement(
              'div',
              { className: 'ps-worker-card__head' },
              React.createElement(
                'span',
                { className: `ps-worker-avatar ps-worker-avatar--${(w.group || '').toLowerCase()}` },
                (w.group || 'W')[0]
              ),
              React.createElement(
                'div',
                { className: 'ps-worker-card__title-group' },
                React.createElement('span', { className: 'ps-worker-card__name' }, w.name),
                React.createElement('span', { className: 'ps-worker-card__group' }, `${w.group} Fleet`)
              ),
              React.createElement(
                'span',
                { className: `ps-worker-card__state ps-worker-card__state--${(w.live?.state || 'unknown').replace(/_/g, '-')}` },
                w.live?.state ? w.live.state.replace(/_/g, ' ') : 'Unavailable'
              )
            ),
            React.createElement('p', { className: 'ps-worker-card__objective' }, w.objective || 'Task assignment pending'),
            React.createElement(
              'div',
              { className: 'ps-worker-card__footer' },
              React.createElement('span', { className: 'ps-worker-card__task-id' }, 'Task: ', React.createElement('code', null, w.taskId))
            )
          )
        )
      )
    ),
    container
  );
}

/**
 * Main Live Control Center Application Component.
 */
export function LiveControlCenterApp({
  initialRoute = null,
  initialStatus = null,
  devLab: initialDevLab = null
}) {
  const [route, setRoute] = useState(() => {
    if (initialRoute) return initialRoute;
    if (typeof window !== 'undefined') {
      return resolveInitialRoute(window.location).id;
    }
    return 'work';
  });

  const [statusState, setStatusState] = useState(() => mapStatusProjection(initialStatus));
  const [externalNavKey, setExternalNavKey] = useState(0);

  const isDevLab = useMemo(() => {
    if (typeof initialDevLab === 'boolean') return initialDevLab;
    return resolveDevLabFlag();
  }, [initialDevLab]);

  // Synchronize initial URL hash
  useEffect(() => {
    if (typeof window !== 'undefined' && window.history) {
      const canonicalHash = formatCanonicalHash(route);
      if (window.location.hash !== canonicalHash && !window.location.hash.startsWith('#lab')) {
        window.history.replaceState(
          createNavigationHistoryState(route),
          '',
          canonicalHash
        );
      }
    }
  }, []);

  // Handle browser popstate (back / forward buttons)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    function onPopState(event) {
      const resolved = handlePopState(event.state, window.location);
      setRoute(resolved.routeId);
      setExternalNavKey(k => k + 1);
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Fetch read-only status projection from server
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { method: 'GET' });
      if (res.status === 200) {
        const json = await res.json();
        setStatusState(mapStatusProjection(json));
      }
    } catch {
      // Keep omitted evidence unknown on failure
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        fetchStatus();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Navigation handler
  const handleNavigate = useCallback((targetRouteId) => {
    const transition = resolveRouteTransition(route, targetRouteId);
    if (transition.changed) {
      setRoute(transition.nextRoute);
      if (typeof window !== 'undefined' && window.history) {
        window.history.pushState(transition.historyState, '', transition.hash);
      }
    }
  }, [route]);

  const handleRefresh = useCallback(() => {
    fetchStatus();
  }, [fetchStatus]);

  return React.createElement(
    'div',
    { className: 'ps-live-control-center' },
    React.createElement(ProductShell, {
      key: externalNavKey,
      initialRoute: route,
      workspaceName: statusState.workspaceName,
      workspacePath: statusState.workspacePath,
      workspaceId: statusState.workspaceId,
      connected: statusState.connected,
      stale: statusState.stale,
      ifzActive: statusState.ifzActive,
      initialWorkerCount: statusState.workerCount,
      initialActiveRunCount: statusState.activeRunCount,
      onNavigate: handleNavigate,
      onRefresh: handleRefresh
    }),
    route === 'work' ? React.createElement(WorkViewPortal, { devLab: isDevLab }) : null,
    route === 'computer' ? React.createElement(ComputerViewPortal, { boundaries: statusState.boundaries }) : null,
    route === 'workers' ? React.createElement(WorkersViewPortal, { workers: statusState.workers }) : null
  );
}

/**
 * Mounts the Live Control Center into a DOM element.
 *
 * @param {Element} container
 * @param {Object} [options]
 * @returns {Object}
 */
export function mountControlCenter(container, options = {}) {
  if (!container) return null;
  const root = createRoot(container);
  root.render(React.createElement(LiveControlCenterApp, options));
  return {
    unmount() {
      root.unmount();
    }
  };
}

// Auto-boot in browser DOM when #app-root is present
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const target = document.getElementById('app-root');
  if (target && !window.__ZETRO_CONTROL_CENTER_MOUNTED__) {
    window.__ZETRO_CONTROL_CENTER_MOUNTED__ = true;
    mountControlCenter(target);
  }
}
