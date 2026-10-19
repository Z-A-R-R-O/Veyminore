import React, { useState, useEffect, useCallback, useReducer, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
  HugeiconsIcon
} from '@hugeicons/react';
import {
  Settings01Icon,
  UserGroupIcon,
  Activity01Icon,
  ComputerTerminal01Icon,
  CheckmarkCircle01Icon,
  RefreshIcon,
  BellIcon,
  Search01Icon,
  SlidersHorizontal,
  Layers01Icon,
  Layers02Icon,
  Route01Icon,
  ViewIcon,
  MoreHorizontalIcon,
  Maximize01Icon,
  CommandIcon,
  Comment01Icon,
  SparklesIcon
} from '@hugeicons/core-free-icons';

import {
  CANONICAL_ROUTES,
  TOP_MENU_GROUPS,
  resolveActiveRoute,
  projectTopMenu,
  projectCenterDock,
  projectLeftUtilityDock,
  projectRightUtilityDock,
  projectDevelopmentTweaks,
  createShellNavigationState,
  reduceNavigationAction
} from './product-navigation.js';

// Custom SVG Icons matching product identity
const IfzOrbGlyph = ({ size = 22, active = false }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    aria-hidden="true"
    style={{ filter: active ? 'drop-shadow(0 0 6px rgba(255, 255, 255, 0.85))' : 'none' }}
  >
    <circle cx="12" cy="12" r="9" stroke="url(#ifz-orb-gradient)" strokeWidth="2.2" />
    <circle cx="12" cy="12" r="4.5" fill="url(#ifz-orb-core)" />
    <ellipse cx="12" cy="12" rx="9" ry="3.5" stroke="rgba(255, 255, 255, 0.45)" strokeWidth="1.2" transform="rotate(-25 12 12)" />
    <defs>
      <linearGradient id="ifz-orb-gradient" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFFFFF" />
        <stop offset="0.6" stopColor="#9B9DA4" />
        <stop offset="1" stopColor="#262932" />
      </linearGradient>
      <radialGradient id="ifz-orb-core" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(12 12) rotate(90) scale(4.5)">
        <stop stopColor="#FFFFFF" />
        <stop offset="1" stopColor="#696C74" />
      </radialGradient>
    </defs>
  </svg>
);

const SlidersGlyph = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6.5" cy="8.5" r="2.2" />
    <path d="M10 8.5h8.5" />
    <circle cx="6.5" cy="15.5" r="2.2" />
    <path d="M10 15.5h8.5" />
  </svg>
);

const CornersGlyph = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 6h3v3" />
    <path d="M8 18H5v-3" />
  </svg>
);

const TabCountGlyph = ({ count = null }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
    <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="5" stroke="currentColor" strokeWidth="1.9" />
    {count !== null && (
      <text
        x="12"
        y="16.2"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontSize="12.5"
        fontWeight="750"
        fontFamily="Satoshi, system-ui, -apple-system, sans-serif"
      >
        {count}
      </text>
    )}
  </svg>
);

/**
 * Resolves standard Hugeicons for navigation tiles.
 */
function resolveTileIcon(iconName, active = false, badgeValue = null) {
  const color = '#FFFFFF';
  const size = '20px';
  switch (iconName) {
    case 'orb':
      return <IfzOrbGlyph active={active} />;
    case 'conversations':
      return <HugeiconsIcon icon={Comment01Icon} size={size} strokeWidth={1.8} color={color} />;
    case 'workers':
      return <HugeiconsIcon icon={UserGroupIcon} size={size} strokeWidth={1.8} color={color} />;
    case 'runs':
      return <HugeiconsIcon icon={Activity01Icon} size={size} strokeWidth={1.8} color={color} />;
    case 'computer':
      return <HugeiconsIcon icon={ComputerTerminal01Icon} size={size} strokeWidth={1.8} color={color} />;
    case 'evidence':
      return <HugeiconsIcon icon={CheckmarkCircle01Icon} size={size} strokeWidth={1.8} color={color} />;
    case 'settings':
      return <HugeiconsIcon icon={Settings01Icon} size={size} strokeWidth={1.8} color={color} />;
    case 'refresh':
      return <HugeiconsIcon icon={RefreshIcon} size={size} strokeWidth={1.8} color={color} />;
    case 'bell':
      return <HugeiconsIcon icon={BellIcon} size={size} strokeWidth={1.8} color={color} />;
    case 'search':
      return <HugeiconsIcon icon={Search01Icon} size={size} strokeWidth={1.8} color={color} />;
    case 'command':
      return <HugeiconsIcon icon={CommandIcon} size={size} strokeWidth={1.8} color={color} />;
    case 'route':
      return <HugeiconsIcon icon={Route01Icon} size={size} strokeWidth={1.8} color={color} />;
    case 'context':
      return <HugeiconsIcon icon={Layers01Icon} size={size} strokeWidth={1.8} color={color} />;
    case 'inspector':
      return <HugeiconsIcon icon={ViewIcon} size={size} strokeWidth={1.8} color={color} />;
    case 'sliders':
      return <SlidersGlyph />;
    case 'fullscreen':
      return <CornersGlyph />;
    case 'workspaces':
      return <TabCountGlyph count={badgeValue} />;
    case 'more':
      return <HugeiconsIcon icon={MoreHorizontalIcon} size={size} strokeWidth={1.8} color={color} />;
    default:
      return <HugeiconsIcon icon={SparklesIcon} size={size} strokeWidth={1.8} color={color} />;
  }
}

/**
 * Traps Tab and Shift+Tab keyboard focus within a modal container.
 */
function trapFocus(container, event) {
  if (!container || event.key !== 'Tab') return;
  const focusables = Array.from(
    container.querySelectorAll(
      'button:not([disabled]):not([tabindex="-1"]), [href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
    )
  );

  if (focusables.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (event.shiftKey) {
    if (document.activeElement === first || !container.contains(document.activeElement)) {
      event.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last || !container.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }
}

/**
 * ProductShell Component
 * Isolated source module for the complete IFZ unified application shell.
 */
export function ProductShell({
  initialRoute = 'work',
  initialWorkerCount = null,
  initialActiveRunCount = null,
  workspaceName = null,
  workspaceId = null,
  workspacePath = null,
  connected = undefined,
  stale = false,
  ifzActive = undefined,
  onNavigate,
  onRefresh,
  onAction
}) {
  const [state, dispatch] = useReducer(
    reduceNavigationAction,
    createShellNavigationState({
      activeRoute: initialRoute,
      workerCount: initialWorkerCount,
      activeRunCount: initialActiveRunCount,
      workspaceName,
      workspaceId,
      workspacePath,
      connected,
      stale,
      ifzActive
    })
  );

  const [rightPanelTab, setRightPanelTab] = useState('inspector');
  const [leftPanelTab, setLeftPanelTab] = useState('recent');
  const openerRef = useRef(null);

  const topMenuModalRef = useRef(null);
  const tweakModalRef = useRef(null);
  const leftCloseRef = useRef(null);
  const rightCloseRef = useRef(null);

  const prevTopMenuOpen = useRef(state.topMenuOpen);
  const prevTweakOpen = useRef(state.tweakPanelOpen);
  const prevLeftPanel = useRef(state.leftPanel);
  const prevRightPanel = useRef(state.rightPanel);

  // Focus meaningful first control when overlay or drawer opens
  useEffect(() => {
    if (state.topMenuOpen && !prevTopMenuOpen.current) {
      setTimeout(() => {
        const first = topMenuModalRef.current?.querySelector('button:not([disabled]), [href]');
        first?.focus();
      }, 0);
    }
    prevTopMenuOpen.current = state.topMenuOpen;
  }, [state.topMenuOpen]);

  useEffect(() => {
    if (state.tweakPanelOpen && !prevTweakOpen.current) {
      setTimeout(() => {
        const first = tweakModalRef.current?.querySelector('button:not([disabled]), select:not([disabled])');
        first?.focus();
      }, 0);
    }
    prevTweakOpen.current = state.tweakPanelOpen;
  }, [state.tweakPanelOpen]);

  useEffect(() => {
    if (state.leftPanel && !prevLeftPanel.current) {
      setTimeout(() => {
        leftCloseRef.current?.focus();
      }, 0);
    }
    prevLeftPanel.current = state.leftPanel;
  }, [state.leftPanel]);

  useEffect(() => {
    if (state.rightPanel && !prevRightPanel.current) {
      setTimeout(() => {
        rightCloseRef.current?.focus();
      }, 0);
    }
    prevRightPanel.current = state.rightPanel;
  }, [state.rightPanel]);

  // Manage focus return to opener element on overlay close
  useEffect(() => {
    if (state.returnFocusTo) {
      const target = document.getElementById(state.returnFocusTo) || openerRef.current;
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
      openerRef.current = null;
      dispatch({ type: 'CLEAR_FOCUS_RETURN' });
    }
  }, [state.returnFocusTo]);

  // Handle global keyboard shortcuts (Escape closes all overlays & returns focus, Ctrl+K opens search)
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        dispatch({ type: 'CLOSE_ALL' });
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onAction?.('search');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onAction]);

  const handleNavigate = useCallback(
    routeId => {
      dispatch({ type: 'NAVIGATE', routeId });
      onNavigate?.(routeId);
    },
    [onNavigate]
  );

  const topMenu = useMemo(() => projectTopMenu(state.activeRoute, state), [state]);
  const centerDockItems = useMemo(() => projectCenterDock(state.activeRoute, state), [state]);
  const leftDockItems = useMemo(() => projectLeftUtilityDock(state), [state]);
  const rightDockItems = useMemo(() => projectRightUtilityDock(state), [state]);
  const tweaks = useMemo(() => projectDevelopmentTweaks(state), [state]);

  const handleCenterTileClick = (tile, event) => {
    openerRef.current = event.currentTarget;
    if (tile.isAction) {
      if (tile.action === 'refresh-evidence') {
        onRefresh?.();
      }
      return;
    }
    if (tile.action === 'toggle-left-panel') {
      dispatch({ type: 'TOGGLE_LEFT_PANEL', panel: 'conversations', openerId: event.currentTarget.id });
      return;
    }
    if (tile.id) {
      handleNavigate(tile.id);
    }
  };

  const handleLeftTileClick = (tile, event) => {
    openerRef.current = event.currentTarget;
    if (tile.action === 'toggle-left-panel') {
      dispatch({ type: 'TOGGLE_LEFT_PANEL', panel: 'conversations', openerId: event.currentTarget.id });
      return;
    }
    onAction?.(tile.action);
  };

  const handleRightTileClick = (tile, event) => {
    openerRef.current = event.currentTarget;
    if (tile.action === 'toggle-right-panel') {
      setRightPanelTab(tile.targetPanel);
      dispatch({ type: 'TOGGLE_RIGHT_PANEL', panel: tile.targetPanel, openerId: event.currentTarget.id });
      return;
    }
    if (tile.action === 'toggle-tweak') {
      dispatch({ type: 'TOGGLE_TWEAK', openerId: event.currentTarget.id });
      return;
    }
    if (tile.action === 'toggle-fullscreen') {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
      return;
    }
    onAction?.(tile.action);
  };

  return (
    <div className={`ps-shell ps-density--${state.density} ps-detail--${state.detail}`}>
      {/* 1. Floating Top Navigation Bar */}
      <header className="ps-top-nav-container" role="banner">
        <nav className="ps-top-nav" aria-label="Product navigation">
          {/* Left: Grouped Menu Trigger */}
          <div className="ps-top-nav__left">
            <button
              id="ps-menu-trigger"
              type="button"
              className="ps-top-nav__menu-trigger"
              aria-label="Toggle navigation menu"
              aria-expanded={state.topMenuOpen}
              aria-haspopup="dialog"
              onClick={e => {
                openerRef.current = e.currentTarget;
                dispatch({ type: 'TOGGLE_TOP_MENU', openerId: 'ps-menu-trigger' });
              }}
            >
              <HugeiconsIcon icon={CommandIcon} size="16px" strokeWidth={2} />
              <span>Menu</span>
            </button>
          </div>

          {/* Center: Brand Mark & Current Page Indicator */}
          <div className="ps-top-nav__center">
            <span className="ps-brand-mark" aria-hidden="true">{topMenu.brand.mark}</span>
            <span className="ps-brand-title">{topMenu.brand.name}</span>
            <div className="ps-route-indicator" title={topMenu.connectionStatus.label}>
              <span
                className={`ps-status-dot ps-status-dot--${topMenu.connectionStatus.status} ${topMenu.connectionStatus.pulse ? 'ps-status-dot--pulse' : ''}`}
                aria-hidden="true"
              />
              <span>{topMenu.activeRoute.label}</span>
            </div>
          </div>

          {/* Right: Workspace, Connection & IFZ Status */}
          <div className="ps-top-nav__right">
            <div className="ps-chip" title={topMenu.connectionStatus.label}>
              <span>{topMenu.connectionStatus.label}</span>
            </div>
            <div className={`ps-chip ${topMenu.workspace.path ? '' : 'ps-chip--quiet'}`} title={topMenu.workspace.path || 'No workspace path'}>
              <span>{topMenu.workspace.name}</span>
            </div>
            <div
              className={`ps-chip ps-chip--ifz ${topMenu.ifzStatus.active ? 'ps-chip--ifz-active' : 'ps-chip--ifz-inactive'}`}
              title={topMenu.ifzStatus.label}
            >
              <span>{topMenu.ifzStatus.label}</span>
            </div>
          </div>
        </nav>
      </header>

      {/* 2. Grouped Top Menu Flyout (Product, IFZ, System) */}
      {state.topMenuOpen && (
        <div
          className="ps-top-menu-scrim"
          role="presentation"
          onClick={e => {
            if (e.target === e.currentTarget) dispatch({ type: 'TOGGLE_TOP_MENU', open: false });
          }}
        >
          <div
            ref={topMenuModalRef}
            className="ps-top-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Product navigation menu"
            onKeyDown={e => trapFocus(topMenuModalRef.current, e)}
          >
            {topMenu.groups.map(group => (
              <section key={group.id} className="ps-menu-group" aria-labelledby={`group-${group.id}`}>
                <h3 id={`group-${group.id}`} className="ps-menu-group__title">{group.label}</h3>
                <p className="ps-menu-group__desc">{group.description}</p>
                <ul className="ps-menu-group__items">
                  {group.items.map(item => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`ps-menu-item-btn ${item.active ? 'ps-menu-item-btn--active' : ''}`}
                        onClick={() => {
                          if (item.routeId) handleNavigate(item.routeId);
                          dispatch({ type: 'TOGGLE_TOP_MENU', open: false });
                        }}
                      >
                        <span className="ps-menu-item__label">{item.label}</span>
                        <span className="ps-menu-item__desc">{item.description}</span>
                        {item.scope === 'development' && (
                          <span className="ps-menu-item__badge-dev">DEV (NON-AUTHORITATIVE)</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}

      {/* 3. Left Sliding Panel (Conversations & Workspaces) */}
      <aside
        id="ps-left-panel"
        className={`ps-panel ps-panel--left ${state.leftPanel === 'conversations' ? 'ps-panel--open' : ''}`}
        aria-label="Conversations and Workspaces panel"
        aria-hidden={state.leftPanel !== 'conversations'}
        inert={state.leftPanel !== 'conversations' ? '' : undefined}
      >
        <div className="ps-panel__header">
          <h2 className="ps-panel__title">Conversations & Routes</h2>
          <button
            ref={leftCloseRef}
            type="button"
            className="ps-panel__close-btn"
            aria-label="Close conversations panel"
            tabIndex={state.leftPanel === 'conversations' ? 0 : -1}
            onClick={() => dispatch({ type: 'TOGGLE_LEFT_PANEL', panel: 'conversations' })}
          >
            ✕
          </button>
        </div>
        <div className="ps-panel__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={leftPanelTab === 'recent'}
            tabIndex={state.leftPanel === 'conversations' ? 0 : -1}
            className={`ps-panel__tab-btn ${leftPanelTab === 'recent' ? 'ps-panel__tab-btn--active' : ''}`}
            onClick={() => setLeftPanelTab('recent')}
          >
            Recent
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={leftPanelTab === 'workspaces'}
            tabIndex={state.leftPanel === 'conversations' ? 0 : -1}
            className={`ps-panel__tab-btn ${leftPanelTab === 'workspaces' ? 'ps-panel__tab-btn--active' : ''}`}
            onClick={() => setLeftPanelTab('workspaces')}
          >
            Workspaces
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={leftPanelTab === 'saved'}
            tabIndex={state.leftPanel === 'conversations' ? 0 : -1}
            className={`ps-panel__tab-btn ${leftPanelTab === 'saved' ? 'ps-panel__tab-btn--active' : ''}`}
            onClick={() => setLeftPanelTab('saved')}
          >
            Saved Routes
          </button>
        </div>
        <div className="ps-panel__body">
          {leftPanelTab === 'recent' && (
            <div>
              <p style={{ color: 'var(--ps-text-quiet)', fontSize: 13 }}>
                Active IFZ conversation history and prompt dispatches appear here.
              </p>
            </div>
          )}
          {leftPanelTab === 'workspaces' && (
            <div>
              <p style={{ color: 'var(--ps-text-quiet)', fontSize: 13 }}>
                {topMenu.workspace.path ? (
                  <>Admitted workspace: <code>{topMenu.workspace.path}</code></>
                ) : (
                  <>No admitted workspace reported.</>
                )}
              </p>
            </div>
          )}
          {leftPanelTab === 'saved' && (
            <div>
              <p style={{ color: 'var(--ps-text-quiet)', fontSize: 13 }}>
                Parallel, Sequential, and Review Chain templates.
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* 4. Right Sliding Panel (Route, Context, Inspector) */}
      <aside
        id="ps-right-panel"
        className={`ps-panel ps-panel--right ${state.rightPanel ? 'ps-panel--open' : ''}`}
        aria-label="Route Context and Inspector panel"
        aria-hidden={!state.rightPanel}
        inert={!state.rightPanel ? '' : undefined}
      >
        <div className="ps-panel__header">
          <h2 className="ps-panel__title">
            {rightPanelTab === 'route' ? 'IFZ Route Plan' : rightPanelTab === 'context' ? 'Context Package' : 'Run Inspector'}
          </h2>
          <button
            ref={rightCloseRef}
            type="button"
            className="ps-panel__close-btn"
            aria-label="Close inspector panel"
            tabIndex={state.rightPanel ? 0 : -1}
            onClick={() => dispatch({ type: 'TOGGLE_RIGHT_PANEL', panel: rightPanelTab })}
          >
            ✕
          </button>
        </div>
        <div className="ps-panel__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={rightPanelTab === 'route'}
            tabIndex={state.rightPanel ? 0 : -1}
            className={`ps-panel__tab-btn ${rightPanelTab === 'route' ? 'ps-panel__tab-btn--active' : ''}`}
            onClick={() => {
              setRightPanelTab('route');
              if (!state.rightPanel) dispatch({ type: 'TOGGLE_RIGHT_PANEL', panel: 'route' });
            }}
          >
            Route
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightPanelTab === 'context'}
            tabIndex={state.rightPanel ? 0 : -1}
            className={`ps-panel__tab-btn ${rightPanelTab === 'context' ? 'ps-panel__tab-btn--active' : ''}`}
            onClick={() => {
              setRightPanelTab('context');
              if (!state.rightPanel) dispatch({ type: 'TOGGLE_RIGHT_PANEL', panel: 'context' });
            }}
          >
            Context
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightPanelTab === 'inspector'}
            tabIndex={state.rightPanel ? 0 : -1}
            className={`ps-panel__tab-btn ${rightPanelTab === 'inspector' ? 'ps-panel__tab-btn--active' : ''}`}
            onClick={() => {
              setRightPanelTab('inspector');
              if (!state.rightPanel) dispatch({ type: 'TOGGLE_RIGHT_PANEL', panel: 'inspector' });
            }}
          >
            Inspector
          </button>
        </div>
        <div className="ps-panel__body">
          {rightPanelTab === 'route' && (
            <div>
              <p style={{ color: 'var(--ps-text-quiet)', fontSize: 13 }}>
                Target workers, execution order, strategy (Sequential / Parallel), and review chains.
              </p>
            </div>
          )}
          {rightPanelTab === 'context' && (
            <div>
              <p style={{ color: 'var(--ps-text-quiet)', fontSize: 13 }}>
                Selected Master Prompt preset, project context version, and bounded context packages.
              </p>
            </div>
          )}
          {rightPanelTab === 'inspector' && (
            <div>
              <p style={{ color: 'var(--ps-text-quiet)', fontSize: 13 }}>
                Active run timeline, verified effects, check receipts, and stop/retry controls.
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* 5. Main Content Viewport */}
      <main id="main-content" className="ps-main-viewport" tabIndex={-1}>
        <div className="ps-view-content">
          <header className="ps-view-header">
            <h1 className="ps-view-header__title">{topMenu.activeRoute.label}</h1>
            <p className="ps-view-header__purpose">{topMenu.activeRoute.purpose}</p>
          </header>

          {/* Active View Container Placeholder */}
          <div className="ps-view-card">
            {state.activeRoute === 'work' && (
              <div className="ps-work-view">
                <p style={{ color: 'var(--ps-text-secondary)' }}>
                  Work surface ready. The fixed IFZ prompt bar attaches above the center dock.
                </p>
              </div>
            )}
            {state.activeRoute === 'workers' && (
              <div className="ps-workers-view">
                <p style={{ color: 'var(--ps-text-secondary)' }}>
                  Worker Fleet Registry: RCT Coding, AGR Engineering, OCR Computing.
                </p>
              </div>
            )}
            {state.activeRoute === 'runs' && (
              <div className="ps-runs-view">
                <p style={{ color: 'var(--ps-text-secondary)' }}>
                  Durable route execution history and timeline.
                </p>
              </div>
            )}
            {state.activeRoute === 'computer' && (
              <div className="ps-computer-view">
                <p style={{ color: 'var(--ps-text-secondary)' }}>
                  ZETRO Computer session, permissions, and verified native evidence.
                </p>
              </div>
            )}
            {state.activeRoute === 'evidence' && (
              <div className="ps-evidence-view">
                <p style={{ color: 'var(--ps-text-secondary)' }}>
                  Independent verification receipts, hashes, and check logs.
                </p>
              </div>
            )}
            {state.activeRoute === 'settings' && (
              <div className="ps-settings-view">
                <p style={{ color: 'var(--ps-text-secondary)' }}>
                  Charter, Worker Knowledge templates, Project Context, and provider limits.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 6. Three Bottom Docks */}
      <div className="ps-docks-container" role="region" aria-label="System Docks">
        {/* Left Utility Dock */}
        <div className="ps-dock ps-dock--left" role="toolbar" aria-label="Left Utilities">
          {leftDockItems.map(tile => (
            <button
              id={`ps-left-tile-${tile.id}`}
              key={tile.id}
              type="button"
              className={`ps-dock-tile ${tile.active ? 'ps-dock-tile--active' : ''}`}
              aria-label={tile.label}
              onClick={e => handleLeftTileClick(tile, e)}
            >
              {resolveTileIcon(tile.icon, tile.active, tile.badge)}
              {tile.badge && <span className="ps-dock-tile__badge">{tile.badge}</span>}
              <span className="ps-tooltip">{tile.tooltip}</span>
            </button>
          ))}
        </div>

        {/* Center Main Dock (8 Destinations in Order) */}
        <div className="ps-dock ps-dock--center" role="navigation" aria-label="Primary Navigation Dock">
          {centerDockItems.map(tile => (
            <React.Fragment key={tile.id}>
              {tile.id === 'refresh' && <div className="ps-dock__separator" aria-hidden="true" />}
              <button
                id={`ps-center-tile-${tile.id}`}
                type="button"
                className={`ps-dock-tile ${tile.active ? 'ps-dock-tile--active' : ''}`}
                aria-label={tile.label}
                aria-current={tile.active ? 'page' : undefined}
                onClick={e => handleCenterTileClick(tile, e)}
              >
                {resolveTileIcon(tile.icon, tile.active, tile.badge)}
                {tile.active && <span className="ps-dock-tile__indicator" aria-hidden="true" />}
                {tile.badge && <span className="ps-dock-tile__badge">{tile.badge}</span>}
                <span className="ps-tooltip">{tile.tooltip}</span>
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Right Utility Dock */}
        <div className="ps-dock ps-dock--right" role="toolbar" aria-label="Right Utilities">
          {rightDockItems.map(tile => (
            <button
              id={`ps-right-tile-${tile.id}`}
              key={tile.id}
              type="button"
              className={`ps-dock-tile ${tile.active ? 'ps-dock-tile--active' : ''}`}
              aria-label={tile.label}
              onClick={e => handleRightTileClick(tile, e)}
            >
              {resolveTileIcon(tile.icon, tile.active, tile.badge)}
              {tile.badge && <span className="ps-dock-tile__badge">{tile.badge}</span>}
              <span className="ps-tooltip">{tile.tooltip}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 7. Development Tweak Modal (Scoped Non-Authoritative Tool) */}
      {state.tweakPanelOpen && (
        <div
          className="ps-tweak-scrim"
          role="presentation"
          onClick={e => {
            if (e.target === e.currentTarget) dispatch({ type: 'TOGGLE_TWEAK', open: false });
          }}
        >
          <div
            ref={tweakModalRef}
            className="ps-tweak-card"
            role="dialog"
            aria-modal="true"
            aria-label="Development Display Tweaks"
            onKeyDown={e => trapFocus(tweakModalRef.current, e)}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 750 }}>Display Settings</h3>
            <div className="ps-tweak-disclaimer" role="note">
              <span>⚠</span>
              <span>{tweaks.disclaimer}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--ps-text-secondary)' }}>
                  Density
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['relaxed', 'compact'].map(d => (
                    <button
                      key={d}
                      type="button"
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        background: state.density === d ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 6,
                        color: '#FFFFFF',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 13,
                        fontWeight: state.density === d ? 700 : 500
                      }}
                      onClick={() => dispatch({ type: 'SET_APPEARANCE', density: d })}
                    >
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--ps-text-secondary)' }}>
                  Detail Level
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['focused', 'expanded'].map(dt => (
                    <button
                      key={dt}
                      type="button"
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        background: state.detail === dt ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 6,
                        color: '#FFFFFF',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 13,
                        fontWeight: state.detail === dt ? 700 : 500
                      }}
                      onClick={() => dispatch({ type: 'SET_APPEARANCE', detail: dt })}
                    >
                      {dt.charAt(0).toUpperCase() + dt.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                style={{
                  marginTop: 12,
                  padding: '10px 16px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 8,
                  color: '#FFFFFF',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
                onClick={() => dispatch({ type: 'TOGGLE_TWEAK', open: false })}
              >
                Close Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Mount helper for isolated testing and preview.
 */
export function mountProductShell(container, options = {}) {
  if (!container) return null;
  const root = createRoot(container);
  root.render(<ProductShell {...options} />);
  return {
    destroy() {
      root.unmount();
    }
  };
}
