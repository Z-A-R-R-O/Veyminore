import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Route01Icon,
  Layers01Icon,
  ViewIcon,
  SidebarRight01Icon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  PlayIcon,
  StopIcon,
  RefreshIcon,
  File01Icon,
  Attachment01Icon,
  UserGroupIcon,
  ArrowRight01Icon,
  ZapIcon
} from '@hugeicons/core-free-icons';
import Dock from './Dock';
import './RightSideNav.css';

const ACCENT_MAP = {
  mint: { badge: '#3fb950', beacon: '#3fb950', hex: '#8ce6b8', rgb: '140, 230, 184', ink: '#ffffff', soft: 'rgba(62, 115, 88, 0.2)' },
  cyan: { badge: '#0ea5e9', beacon: '#0ea5e9', hex: '#38bdf8', rgb: '56, 189, 248', ink: '#ffffff', soft: 'rgba(14, 116, 144, 0.25)' },
  violet: { badge: '#8b5cf6', beacon: '#8b5cf6', hex: '#a78bfa', rgb: '167, 139, 250', ink: '#ffffff', soft: 'rgba(109, 40, 217, 0.25)' },
  amber: { badge: '#f59e0b', beacon: '#f59e0b', hex: '#fbbf24', rgb: '251, 191, 36', ink: '#ffffff', soft: 'rgba(180, 83, 9, 0.25)' },
  rose: { badge: '#f43f5e', beacon: '#f43f5e', hex: '#fb7185', rgb: '251, 113, 133', ink: '#ffffff', soft: 'rgba(190, 18, 60, 0.25)' },
  silver: { badge: '#e2e8f0', beacon: '#cbd5e1', hex: '#e2e8f0', rgb: '226, 232, 240', ink: '#090a0c', soft: 'rgba(148, 163, 184, 0.2)' }
};

export function RightSideNav({
  open = false,
  collapsed = false,
  accent = 'mint',
  activeTab = 'route',
  onClose,
  onToggleCollapse,
  onSelectTab,
  onNavigate,
  intro = true,
  introDelay = 150,
  baseItemSize = 50,
  magnification = 70,
  panelHeight = 68,
  gap = 10
}) {
  const [routeMode, setRouteMode] = useState('auto');
  const [executionStrategy, setExecutionStrategy] = useState('parallel');
  const [delegationDepth, setDelegationDepth] = useState('depth-2');
  const panelRef = useRef(null);
  const introRef = useRef(true);
  const [collapsing, setCollapsing] = useState(false);

  const handleCollapseClick = () => {
    if (collapsing) return;
    setCollapsing(true);
    setTimeout(() => {
      setCollapsing(false);
      onToggleCollapse?.();
    }, 280);
  };

  // Expanded card intro unroll on initial page mount (matching CardNav)
  useEffect(() => {
    if (collapsed) {
      introRef.current = false;
      return;
    }
    if (!intro || !introRef.current || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    introRef.current = false;
    const card = panelRef.current;
    if (!card) return;
    card.animate(
      [
        { clipPath: 'inset(0px 0px calc(100% - 52px) 0px round 24px)', opacity: 0, transform: 'translateY(-10px)' },
        { clipPath: 'inset(0px 0px 0px 0px round 24px)', opacity: 1, transform: 'translateY(0)' }
      ],
      { duration: 800, delay: introDelay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
    );
  }, [collapsed, intro, introDelay]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (typeof document === 'undefined' || !open) return null;

  const compactDockItems = [
    {
      icon: <HugeiconsIcon icon={SidebarRight01Icon} size={20} strokeWidth={1.8} color="#ffffff" />,
      label: 'Expand panel',
      onClick: onToggleCollapse
    },
    { separator: true },
    {
      icon: <HugeiconsIcon icon={Route01Icon} size={20} strokeWidth={1.8} color="#ffffff" />,
      label: 'IFZ Route',
      active: activeTab === 'route',
      onClick: () => {
        onSelectTab?.('route');
        onToggleCollapse?.();
      }
    },
    {
      icon: <HugeiconsIcon icon={Layers01Icon} size={20} strokeWidth={1.8} color="#ffffff" />,
      label: 'Context (48 KB)',
      badge: '48K',
      active: activeTab === 'context',
      onClick: () => {
        onSelectTab?.('context');
        onToggleCollapse?.();
      }
    },
    {
      icon: <HugeiconsIcon icon={ViewIcon} size={20} strokeWidth={1.8} color="#ffffff" />,
      label: 'Inspector (Step 5/6)',
      badge: '5/6',
      active: activeTab === 'inspector',
      onClick: () => {
        onSelectTab?.('inspector');
        onToggleCollapse?.();
      }
    },
    { separator: true },
    {
      icon: <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={2} color="#9b9da4" />,
      label: 'Close (Esc)',
      onClick: onClose
    }
  ];

  const [liveAccent, setLiveAccent] = useState(() => {
    try {
      return document.documentElement.getAttribute('data-accent') || localStorage.getItem('zetro_accent') || accent || 'mint';
    } catch {
      return accent || 'mint';
    }
  });

  useEffect(() => {
    if (accent) setLiveAccent(accent);
  }, [accent]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const a = document.documentElement.getAttribute('data-accent');
      if (a) setLiveAccent(a);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent'] });
    return () => observer.disconnect();
  }, []);

  const activeAccent = ACCENT_MAP[liveAccent] || ACCENT_MAP.mint;
  const accentStyles = {
    '--dock-badge': activeAccent.badge,
    '--dock-badge-ink': activeAccent.ink,
    '--accent': activeAccent.beacon,
    '--green': activeAccent.hex,
    '--soft-green': activeAccent.soft,
    '--mb-glow-rgb': activeAccent.rgb
  };

  return createPortal(
    <>
      {/* Transparent non-disturbing click-away shield (only active when expanded) */}
      {!collapsed && (
        <div
          className="right-nav-shield"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {collapsed ? (
        <Dock
          className="dock-side-right"
          items={compactDockItems}
          position="right"
          theme="dark"
          baseItemSize={baseItemSize}
          magnification={magnification}
          panelHeight={panelHeight}
          gap={gap}
          roundness={1}
          distance={160}
          spring={{ mass: 0.1, stiffness: 150, damping: 12 }}
          bounce={true}
          autoHide={false}
          tiles={true}
          showLabels={true}
          showIndicators={true}
          showBadges={true}
          badgeColor={activeAccent.badge}
          accentColor={activeAccent.beacon}
          intro={intro}
          introDelay={introDelay}
        />
      ) : (
        <aside
          ref={panelRef}
          id="ps-right-panel"
          className="right-side-card"
          data-open=""
          data-collapsing={collapsing ? '' : undefined}
          style={accentStyles}
          role="complementary"
          aria-label="Route, Context, and Inspector Panel"
        >
          <div className="right-nav-expanded">
            {/* Header: Segmented Tab Bar & Controls */}
            <div className="right-nav-header">
              <nav className="right-nav-tabs" role="tablist" aria-label="Tools">
                <button
                  type="button"
                  role="tab"
                  className="right-nav-tab"
                  data-active={activeTab === 'route' ? '' : undefined}
                  aria-selected={activeTab === 'route'}
                  onClick={() => onSelectTab?.('route')}
                  tabIndex={open ? 0 : -1}
                >
                  <HugeiconsIcon icon={Route01Icon} size={15} strokeWidth={1.8} />
                  <span>Route</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  className="right-nav-tab"
                  data-active={activeTab === 'context' ? '' : undefined}
                  aria-selected={activeTab === 'context'}
                  onClick={() => onSelectTab?.('context')}
                  tabIndex={open ? 0 : -1}
                >
                  <HugeiconsIcon icon={Layers01Icon} size={15} strokeWidth={1.8} />
                  <span>Context</span>
                  <span className="right-nav-tab-badge">48K</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  className="right-nav-tab"
                  data-active={activeTab === 'inspector' ? '' : undefined}
                  aria-selected={activeTab === 'inspector'}
                  onClick={() => onSelectTab?.('inspector')}
                  tabIndex={open ? 0 : -1}
                >
                  <HugeiconsIcon icon={ViewIcon} size={15} strokeWidth={1.8} />
                  <span>Inspector</span>
                  <span className="right-nav-tab-badge active">5/6</span>
                </button>
              </nav>

              <div className="right-nav-actions">
                <button
                  type="button"
                  className="right-nav-icon-btn"
                  onClick={handleCollapseClick}
                  aria-label="Collapse to vertical dock"
                  title="Collapse to vertical dock"
                  tabIndex={open ? 0 : -1}
                >
                  <HugeiconsIcon icon={SidebarRight01Icon} size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="right-nav-icon-btn"
                  onClick={onClose}
                  aria-label="Close panel"
                  title="Close panel (Esc)"
                  tabIndex={open ? 0 : -1}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* Scrollable Content Body */}
            <div className="right-nav-body">
              <div key={activeTab} className="right-nav-tab-content">
                {/* ==============================================================
                    TAB 1: ROUTE
                    ============================================================== */}
                {activeTab === 'route' && (
                <>
                  {/* Mode Selector */}
                  <div className="right-nav-section-0 right-nav-card-box">
                    <div className="right-nav-row-between">
                      <span className="right-nav-eyebrow">Routing Mode</span>
                      <div className="right-nav-segmented">
                        <button
                          type="button"
                          className="right-nav-seg-btn"
                          data-active={routeMode === 'auto' ? '' : undefined}
                          onClick={() => setRouteMode('auto')}
                        >
                          Automatic
                        </button>
                        <button
                          type="button"
                          className="right-nav-seg-btn"
                          data-active={routeMode === 'manual' ? '' : undefined}
                          onClick={() => setRouteMode('manual')}
                        >
                          Manual
                        </button>
                      </div>
                    </div>
                    <p className="right-nav-meta-desc">
                      {routeMode === 'auto'
                        ? 'IFZ dynamically coordinates generation, authority review, and qualification gates.'
                        : 'Manual routing enabled: Explicit worker assignments and execution controls.'}
                    </p>
                  </div>

                  {/* Selected Workers */}
                  <div className="right-nav-section-1 right-nav-card-box">
                    <div className="right-nav-row-between">
                      <span className="right-nav-eyebrow">
                        <HugeiconsIcon icon={UserGroupIcon} size={13} strokeWidth={2} />
                        Selected Workers
                      </span>
                      <span className="right-nav-meta-tag">7 slots active</span>
                    </div>

                    <ul className="right-nav-worker-list" role="list">
                      <li className="right-nav-worker-card">
                        <div className="right-nav-worker-head">
                          <span className="right-nav-worker-name">AGR × 5</span>
                          <span className="right-nav-worker-role">Lead Generation Swarm</span>
                        </div>
                        <span className="right-nav-worker-badge">Parallel · Fast</span>
                      </li>

                      <li className="right-nav-worker-card highlight">
                        <div className="right-nav-worker-head">
                          <span className="right-nav-worker-name">RCT-1</span>
                          <span className="right-nav-worker-role">Code Qualification Authority</span>
                        </div>
                        <span className="right-nav-worker-badge gate">Gatekeeper</span>
                      </li>

                      <li className="right-nav-worker-card">
                        <div className="right-nav-worker-head">
                          <span className="right-nav-worker-name">OCR-2</span>
                          <span className="right-nav-worker-role">Runtime Desktop Tester</span>
                        </div>
                        <span className="right-nav-worker-badge">Specialized</span>
                      </li>
                    </ul>
                  </div>

                  {/* Execution Strategy */}
                  <div className="right-nav-section-2 right-nav-card-box">
                    <span className="right-nav-eyebrow">Execution Strategy</span>
                    <div className="right-nav-strategy-grid">
                      <button
                        type="button"
                        className="right-nav-strategy-btn"
                        data-active={executionStrategy === 'parallel' ? '' : undefined}
                        onClick={() => setExecutionStrategy('parallel')}
                      >
                        <span className="right-nav-strat-title">Parallel</span>
                        <span className="right-nav-strat-desc">Simultaneous generation</span>
                      </button>
                      <button
                        type="button"
                        className="right-nav-strategy-btn"
                        data-active={executionStrategy === 'pipeline' ? '' : undefined}
                        onClick={() => setExecutionStrategy('pipeline')}
                      >
                        <span className="right-nav-strat-title">Pipeline</span>
                        <span className="right-nav-strat-desc">Sequential stage handoff</span>
                      </button>
                      <button
                        type="button"
                        className="right-nav-strategy-btn"
                        data-active={executionStrategy === 'gated' ? '' : undefined}
                        onClick={() => setExecutionStrategy('gated')}
                      >
                        <span className="right-nav-strat-title">Gated</span>
                        <span className="right-nav-strat-desc">Strict checkpoint review</span>
                      </button>
                    </div>
                  </div>

                  {/* Delegation Depth & Reviewer */}
                  <div className="right-nav-section-3 right-nav-card-box">
                    <div className="right-nav-row-between">
                      <span className="right-nav-eyebrow">Delegation Depth</span>
                      <div className="right-nav-segmented">
                        <button
                          type="button"
                          className="right-nav-seg-btn"
                          data-active={delegationDepth === 'depth-1' ? '' : undefined}
                          onClick={() => setDelegationDepth('depth-1')}
                        >
                          Depth 1
                        </button>
                        <button
                          type="button"
                          className="right-nav-seg-btn"
                          data-active={delegationDepth === 'depth-2' ? '' : undefined}
                          onClick={() => setDelegationDepth('depth-2')}
                        >
                          Depth 2
                        </button>
                        <button
                          type="button"
                          className="right-nav-seg-btn"
                          data-active={delegationDepth === 'depth-3' ? '' : undefined}
                          onClick={() => setDelegationDepth('depth-3')}
                        >
                          Depth 3
                        </button>
                      </div>
                    </div>

                    <div className="right-nav-divider" />

                    <div className="right-nav-row-between">
                      <span className="right-nav-eyebrow">Reviewer Authority</span>
                      <span className="right-nav-reviewer-pill">
                        <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} strokeWidth={2} />
                        RCT-1 Deterministic Gate
                      </span>
                    </div>
                  </div>

                  {/* Route Preview */}
                  <div className="right-nav-section-3 right-nav-card-box">
                    <span className="right-nav-eyebrow">Route Preview</span>
                    <div className="right-nav-flow">
                      <div className="right-nav-flow-node start">IFZ Composer</div>
                      <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={2} className="right-nav-flow-arrow" />
                      <div className="right-nav-flow-node active">AGR × 5</div>
                      <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={2} className="right-nav-flow-arrow" />
                      <div className="right-nav-flow-node gate">RCT Gate</div>
                      <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={2} className="right-nav-flow-arrow" />
                      <div className="right-nav-flow-node end">Evidence</div>
                    </div>
                  </div>
                </>
              )}

              {/* ==============================================================
                  TAB 2: CONTEXT
                  ============================================================== */}
              {activeTab === 'context' && (
                <>
                  {/* Master Prompt Preset */}
                  <div className="right-nav-section-0 right-nav-card-box">
                    <div className="right-nav-row-between">
                      <span className="right-nav-eyebrow">Master Prompt Preset</span>
                      <span className="right-nav-meta-tag active">Strict · Deterministic</span>
                    </div>
                    <div className="right-nav-preset-box">
                      <span className="right-nav-preset-title">ZETRO Standard v1.2</span>
                      <p className="right-nav-meta-desc">
                        Zero speculation, verified evidence files required, offline test isolation enforced.
                      </p>
                    </div>
                  </div>

                  {/* Project Context */}
                  <div className="right-nav-section-1 right-nav-card-box">
                    <div className="right-nav-row-between">
                      <span className="right-nav-eyebrow">Project Context</span>
                      <span className="right-nav-branch-pill">main</span>
                    </div>
                    <div className="right-nav-context-kv">
                      <span className="right-nav-kv-k">Workspace</span>
                      <span className="right-nav-kv-v">Veyminore / ZETRO Engine</span>
                    </div>
                    <div className="right-nav-context-kv">
                      <span className="right-nav-kv-k">Location</span>
                      <span className="right-nav-kv-v mono">e:/Veyminore/products/zetro</span>
                    </div>
                    <div className="right-nav-context-kv">
                      <span className="right-nav-kv-k">Modified Files</span>
                      <span className="right-nav-kv-v">3 files tracked</span>
                    </div>
                  </div>

                  {/* Attached Files */}
                  <div className="right-nav-section-2 right-nav-card-box">
                    <div className="right-nav-row-between">
                      <span className="right-nav-eyebrow">
                        <HugeiconsIcon icon={Attachment01Icon} size={13} strokeWidth={2} />
                        Attached Files
                      </span>
                      <span className="right-nav-meta-tag">4 files</span>
                    </div>
                    <ul className="right-nav-files-list">
                      <li className="right-nav-file-row">
                        <HugeiconsIcon icon={File01Icon} size={14} strokeWidth={1.8} className="right-nav-file-icon" />
                        <span className="right-nav-file-name">packages/computer-agent/package.json</span>
                        <span className="right-nav-file-size">3.4 KB</span>
                      </li>
                      <li className="right-nav-file-row">
                        <HugeiconsIcon icon={File01Icon} size={14} strokeWidth={1.8} className="right-nav-file-icon" />
                        <span className="right-nav-file-name">docs/IFZ-UNIFIED-APP-ARCHITECTURE.md</span>
                        <span className="right-nav-file-size">12.8 KB</span>
                      </li>
                      <li className="right-nav-file-row">
                        <HugeiconsIcon icon={File01Icon} size={14} strokeWidth={1.8} className="right-nav-file-icon" />
                        <span className="right-nav-file-name">apps/control-center/src/dock-island.jsx</span>
                        <span className="right-nav-file-size">18.8 KB</span>
                      </li>
                      <li className="right-nav-file-row">
                        <HugeiconsIcon icon={File01Icon} size={14} strokeWidth={1.8} className="right-nav-file-icon" />
                        <span className="right-nav-file-name">apps/control-center/src/components/LeftSideNav.jsx</span>
                        <span className="right-nav-file-size">13.3 KB</span>
                      </li>
                    </ul>
                  </div>

                  {/* Shared Context & Invariants */}
                  <div className="right-nav-section-3 right-nav-card-box">
                    <span className="right-nav-eyebrow">Shared Context Invariants</span>
                    <ul className="right-nav-invariants-list">
                      <li>Strict offline deterministic suite validation (1,395 pass)</li>
                      <li>No mock receipts: Physical cryptographic proof required</li>
                      <li>Single global route registry for docks, menu, and status</li>
                    </ul>
                  </div>

                  {/* Context Version & Worker Packages */}
                  <div className="right-nav-section-3 right-nav-card-box">
                    <div className="right-nav-row-between">
                      <span className="right-nav-eyebrow">Context Packages</span>
                      <span className="right-nav-meta-tag">v2.4 · 48.2 KB</span>
                    </div>
                    <div className="right-nav-packages-grid">
                      <div className="right-nav-pkg-tile">
                        <span className="right-nav-pkg-name">AGR Fleet</span>
                        <span className="right-nav-pkg-val">24.0 KB</span>
                      </div>
                      <div className="right-nav-pkg-tile">
                        <span className="right-nav-pkg-name">RCT Authority</span>
                        <span className="right-nav-pkg-val">16.0 KB</span>
                      </div>
                      <div className="right-nav-pkg-tile">
                        <span className="right-nav-pkg-name">OCR Vision</span>
                        <span className="right-nav-pkg-val">8.2 KB</span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ==============================================================
                  TAB 3: INSPECTOR
                  ============================================================== */}
              {activeTab === 'inspector' && (
                <>
                  {/* Current Run */}
                  <div className="right-nav-section-0 right-nav-card-box highlight">
                    <div className="right-nav-row-between">
                      <span className="right-nav-eyebrow">Current Run</span>
                      <span className="right-nav-meta-tag active">
                        <span className="right-nav-pulse-dot" />
                        Active · Step 5/6
                      </span>
                    </div>
                    <span className="right-nav-run-title">Run #104 · Computer Agent Qualification</span>
                    <div className="right-nav-run-meta">
                      <span>Elapsed: 3m 42s</span>
                      <span>·</span>
                      <span>Tokens: 14.8k</span>
                      <span>·</span>
                      <span>Strategy: Parallel</span>
                    </div>
                  </div>

                  {/* Actual Worker States (Telemetry: Not inferring completion from idle) */}
                  <div className="right-nav-section-1 right-nav-card-box">
                    <div className="right-nav-row-between">
                      <span className="right-nav-eyebrow">Worker States (Actual Telemetry)</span>
                      <span className="right-nav-meta-tag">Live</span>
                    </div>
                    <ul className="right-nav-telemetry-list">
                      <li className="right-nav-telemetry-item working">
                        <div className="right-nav-telemetry-lead">
                          <span className="right-nav-worker-tag">AGR-1</span>
                          <span className="right-nav-telemetry-detail">Generating verification assertions</span>
                        </div>
                        <span className="right-nav-status-label working">Working</span>
                      </li>
                      <li className="right-nav-telemetry-item idle">
                        <div className="right-nav-telemetry-lead">
                          <span className="right-nav-worker-tag">AGR-2</span>
                          <span className="right-nav-telemetry-detail">Waiting for dispatch (not complete)</span>
                        </div>
                        <span className="right-nav-status-label idle">Idle</span>
                      </li>
                      <li className="right-nav-telemetry-item standby">
                        <div className="right-nav-telemetry-lead">
                          <span className="right-nav-worker-tag">RCT-1</span>
                          <span className="right-nav-telemetry-detail">Authority gate listener armed</span>
                        </div>
                        <span className="right-nav-status-label standby">Standby</span>
                      </li>
                      <li className="right-nav-telemetry-item complete">
                        <div className="right-nav-telemetry-lead">
                          <span className="right-nav-worker-tag">OCR-1</span>
                          <span className="right-nav-telemetry-detail">Baseline screen bounds verified</span>
                        </div>
                        <span className="right-nav-status-label complete">Complete</span>
                      </li>
                    </ul>
                    <span className="right-nav-telemetry-notice">
                      State verified via daemon socket. Idle workers are not inferred as finished.
                    </span>
                  </div>

                  {/* Verified Steps */}
                  <div className="right-nav-section-2 right-nav-card-box">
                    <div className="right-nav-row-between">
                      <span className="right-nav-eyebrow">Verified Steps</span>
                      <span className="right-nav-meta-tag active">5 / 6 Steps</span>
                    </div>
                    <div className="right-nav-progress-bar">
                      <div className="right-nav-progress-fill" style={{ width: '83%' }} />
                    </div>
                    <ul className="right-nav-steps-list">
                      <li className="right-nav-step passed">
                        <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} strokeWidth={2} />
                        <span>Step 1: Baseline inspection passed</span>
                        <span className="right-nav-step-time">0.2s</span>
                      </li>
                      <li className="right-nav-step passed">
                        <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} strokeWidth={2} />
                        <span>Step 2: Protocol contracts verified</span>
                        <span className="right-nav-step-time">0.4s</span>
                      </li>
                      <li className="right-nav-step passed">
                        <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} strokeWidth={2} />
                        <span>Step 3: Fast unit tests passed (40/40)</span>
                        <span className="right-nav-step-time">0.3s</span>
                      </li>
                      <li className="right-nav-step passed">
                        <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} strokeWidth={2} />
                        <span>Step 4: Worker receipts parsed</span>
                        <span className="right-nav-step-time">0.1s</span>
                      </li>
                      <li className="right-nav-step in-flight">
                        <HugeiconsIcon icon={ZapIcon} size={14} strokeWidth={2} />
                        <span>Step 5: Runtime verification in flight...</span>
                        <span className="right-nav-step-time">Active</span>
                      </li>
                      <li className="right-nav-step pending">
                        <span className="right-nav-step-circle" />
                        <span>Step 6: Cryptographic receipt sign-off</span>
                        <span className="right-nav-step-time">Queue</span>
                      </li>
                    </ul>
                  </div>

                  {/* Changes & Checks */}
                  <div className="right-nav-section-3 right-nav-card-box">
                    <div className="right-nav-row-between">
                      <span className="right-nav-eyebrow">Changes &amp; Checks</span>
                      <span className="right-nav-diff-badge">+142 / -18</span>
                    </div>
                    <div className="right-nav-checks-grid">
                      <div className="right-nav-check-item">
                        <span className="right-nav-check-status pass">✓</span>
                        <span>40/40 Unit Tests Passed</span>
                      </div>
                      <div className="right-nav-check-item">
                        <span className="right-nav-check-status pass">✓</span>
                        <span>0 Lint Regressions</span>
                      </div>
                      <div className="right-nav-check-item">
                        <span className="right-nav-check-status pass">✓</span>
                        <span>100% Deterministic Pass</span>
                      </div>
                      <div className="right-nav-check-item">
                        <span className="right-nav-check-status hash">#</span>
                        <span className="mono">0x8f2c7a...9e14</span>
                      </div>
                    </div>
                  </div>

                  {/* Stop and Retry Actions */}
                  <div className="right-nav-section-3 right-nav-actions-card">
                    <button
                      type="button"
                      className="right-nav-btn danger"
                      onClick={() => {}}
                    >
                      <HugeiconsIcon icon={StopIcon} size={14} strokeWidth={2} />
                      <span>Stop Run</span>
                    </button>
                    <button
                      type="button"
                      className="right-nav-btn secondary"
                      onClick={() => {}}
                    >
                      <HugeiconsIcon icon={RefreshIcon} size={14} strokeWidth={2} />
                      <span>Retry Step</span>
                    </button>
                    <button
                      type="button"
                      className="right-nav-btn primary"
                      onClick={() => {
                        onNavigate?.('evidence');
                        onClose?.();
                      }}
                    >
                      <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} strokeWidth={2} />
                      <span>Evidence</span>
                    </button>
                  </div>
                </>
              )}
              </div>
            </div>
          </div>
        </aside>
      )}
    </>,
    document.body
  );
}
