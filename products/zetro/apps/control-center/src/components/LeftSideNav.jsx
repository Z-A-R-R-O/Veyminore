import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Add01Icon,
  SidebarLeft01Icon,
  Cancel01Icon,
  Clock01Icon,
  Folder01Icon,
  Route01Icon,
  ArrowRight01Icon
} from '@hugeicons/core-free-icons';
import Dock from './Dock';
import './LeftSideNav.css';

const RECENT_CONVERSATIONS = [
  { id: 'unified-arch', label: 'Unified app architecture', sub: 'Work · Active now', active: true },
  { id: 'computer-agent-qual', label: 'Computer agent qualification', sub: 'Runs · 2h ago' },
  { id: 'rct-review', label: 'RCT provider review', sub: 'Evidence · Yesterday' }
];

const WORKSPACES = [
  { id: 'veyminore', label: 'Veyminore', path: 'e:/Veyminore/products/zetro', active: true },
  { id: 'zetro-engine', label: 'ZETRO Engine', path: 'e:/Veyminore/products/zetro/packages' }
];

const SAVED_ROUTES = [
  { id: 'agr5-rct', label: 'AGR × 5 → RCT', badge: '5 workers', desc: 'Autonomous generation to qualification gate' },
  { id: 'ocr-codex', label: 'OCR → Codex review', badge: 'Chain', desc: 'OpenCode native review pipeline' },
  { id: 'full-qual', label: 'Full qualification', badge: '10 slots', desc: 'Complete fleet benchmark pass' }
];

const ACCENT_MAP = {
  mint: { badge: '#3fb950', beacon: '#3fb950', hex: '#8ce6b8', rgb: '140, 230, 184', ink: '#ffffff', soft: 'rgba(62, 115, 88, 0.2)' },
  cyan: { badge: '#0ea5e9', beacon: '#0ea5e9', hex: '#38bdf8', rgb: '56, 189, 248', ink: '#ffffff', soft: 'rgba(14, 116, 144, 0.25)' },
  violet: { badge: '#8b5cf6', beacon: '#8b5cf6', hex: '#a78bfa', rgb: '167, 139, 250', ink: '#ffffff', soft: 'rgba(109, 40, 217, 0.25)' },
  amber: { badge: '#f59e0b', beacon: '#f59e0b', hex: '#fbbf24', rgb: '251, 191, 36', ink: '#ffffff', soft: 'rgba(180, 83, 9, 0.25)' },
  rose: { badge: '#f43f5e', beacon: '#f43f5e', hex: '#fb7185', rgb: '251, 113, 133', ink: '#ffffff', soft: 'rgba(190, 18, 60, 0.25)' },
  silver: { badge: '#e2e8f0', beacon: '#cbd5e1', hex: '#e2e8f0', rgb: '226, 232, 240', ink: '#090a0c', soft: 'rgba(148, 163, 184, 0.2)' }
};

export function LeftSideNav({
  open = false,
  collapsed = false,
  accent = 'mint',
  onClose,
  onToggleCollapse,
  onNavigate,
  onSelectConversation,
  onSelectWorkspace,
  onSelectRoute,
  activeConversation = 'unified-arch',
  activeWorkspace = 'veyminore',
  intro = true,
  introDelay = 120,
  baseItemSize = 50,
  magnification = 70,
  panelHeight = 68,
  gap = 10
}) {
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

  // Keyboard shortcut listener (Escape closes cleanly without stealing focus)
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
      icon: <HugeiconsIcon icon={SidebarLeft01Icon} size={20} strokeWidth={1.8} color="#ffffff" />,
      label: 'Expand panel',
      onClick: onToggleCollapse
    },
    { separator: true },
    {
      icon: <HugeiconsIcon icon={Add01Icon} size={20} strokeWidth={2.2} color="#ffffff" />,
      label: 'New work',
      onClick: () => {
        onNavigate?.('work');
      }
    },
    {
      icon: <HugeiconsIcon icon={Clock01Icon} size={20} strokeWidth={1.8} color="#ffffff" />,
      label: 'Recent (3 active)',
      badge: 3,
      active: true,
      onClick: onToggleCollapse
    },
    {
      icon: <HugeiconsIcon icon={Folder01Icon} size={20} strokeWidth={1.8} color="#ffffff" />,
      label: 'Workspace: Veyminore',
      onClick: onToggleCollapse
    },
    {
      icon: <HugeiconsIcon icon={Route01Icon} size={20} strokeWidth={1.8} color="#ffffff" />,
      label: 'Saved routes (3)',
      onClick: onToggleCollapse
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
          className="left-nav-shield"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {collapsed ? (
        <Dock
          className="dock-side-left"
          items={compactDockItems}
          position="left"
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
          id="ps-left-panel"
          className="left-side-card"
          data-open=""
          data-collapsing={collapsing ? '' : undefined}
          style={accentStyles}
          role="complementary"
          aria-label="Conversations and Workspaces"
        >
          <div className="left-nav-expanded">
            {/* Card Header */}
            <div className="left-nav-header">
              <span className="left-nav-title">Conversations &amp; Routes</span>
              <div className="left-nav-actions">
                <button
                  type="button"
                  className="left-nav-icon-btn"
                  onClick={handleCollapseClick}
                  aria-label="Collapse to vertical dock"
                  title="Collapse to vertical dock"
                  tabIndex={open ? 0 : -1}
                >
                  <HugeiconsIcon icon={SidebarLeft01Icon} size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="left-nav-icon-btn"
                  onClick={onClose}
                  aria-label="Close panel"
                  title="Close panel (Esc)"
                  tabIndex={open ? 0 : -1}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* Scrollable Content Body with CardNav Staggered Cards */}
            <div className="left-nav-body">
              {/* Section 0: New Work CTA Card */}
              <div className="left-nav-section-0">
                <button
                  type="button"
                  className="left-nav-new-work-btn"
                  onClick={() => {
                    onNavigate?.('work');
                  }}
                  title="Start new work"
                  tabIndex={open ? 0 : -1}
                >
                  <span className="left-nav-new-work-left">
                    <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={2.4} />
                    <span>New work</span>
                  </span>
                  <span className="left-nav-shortcut-badge">Ctrl+N</span>
                </button>
              </div>

              {/* Section 1: RECENT Card */}
              <div className="left-nav-section-1 left-nav-card-box">
                <span className="left-nav-eyebrow">
                  <span className="left-nav-eyebrow-icon">
                    <HugeiconsIcon icon={Clock01Icon} size={13} strokeWidth={2} />
                  </span>
                  RECENT
                </span>
                <ul className="left-nav-list" role="list">
                  {RECENT_CONVERSATIONS.map(conv => (
                    <li key={conv.id}>
                      <button
                        type="button"
                        className="left-nav-item"
                        data-active={activeConversation === conv.id ? '' : undefined}
                        onClick={() => {
                          onSelectConversation?.(conv.id);
                          onNavigate?.('work');
                        }}
                        title={conv.label}
                        tabIndex={open ? 0 : -1}
                      >
                        <span className="left-nav-item-icon">
                          <HugeiconsIcon icon={Clock01Icon} size={15} strokeWidth={1.8} />
                        </span>
                        <div className="left-nav-item-content">
                          <span className="left-nav-item-label">{conv.label}</span>
                          <span className="left-nav-item-sub">{conv.sub}</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Section 2: WORKSPACES Card */}
              <div className="left-nav-section-2 left-nav-card-box">
                <span className="left-nav-eyebrow">
                  <span className="left-nav-eyebrow-icon">
                    <HugeiconsIcon icon={Folder01Icon} size={13} strokeWidth={2} />
                  </span>
                  WORKSPACES
                </span>
                <ul className="left-nav-list" role="list">
                  {WORKSPACES.map(ws => (
                    <li key={ws.id}>
                      <button
                        type="button"
                        className="left-nav-item"
                        data-active={activeWorkspace === ws.id ? '' : undefined}
                        onClick={() => {
                          onSelectWorkspace?.(ws.id);
                        }}
                        title={`${ws.label} (${ws.path})`}
                        tabIndex={open ? 0 : -1}
                      >
                        <span className="left-nav-item-icon">
                          <HugeiconsIcon icon={Folder01Icon} size={15} strokeWidth={1.8} />
                        </span>
                        <div className="left-nav-item-content">
                          <span className="left-nav-item-label">{ws.label}</span>
                          <span className="left-nav-item-sub">{ws.path}</span>
                        </div>
                        {ws.active && (
                          <span className="left-nav-item-badge active">Active</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Section 3: SAVED ROUTES Card */}
              <div className="left-nav-section-3 left-nav-card-box">
                <span className="left-nav-eyebrow">
                  <span className="left-nav-eyebrow-icon">
                    <HugeiconsIcon icon={Route01Icon} size={13} strokeWidth={2} />
                  </span>
                  SAVED ROUTES
                </span>
                <ul className="left-nav-list" role="list">
                  {SAVED_ROUTES.map(route => (
                    <li key={route.id}>
                      <button
                        type="button"
                        className="left-nav-item"
                        onClick={() => {
                          onSelectRoute?.(route.id);
                          onNavigate?.('work');
                        }}
                        title={`${route.label} — ${route.desc}`}
                        tabIndex={open ? 0 : -1}
                      >
                        <span className="left-nav-item-icon">
                          <HugeiconsIcon icon={Route01Icon} size={15} strokeWidth={1.8} />
                        </span>
                        <div className="left-nav-item-content">
                          <span className="left-nav-item-label">{route.label}</span>
                          <span className="left-nav-item-sub">{route.desc}</span>
                        </div>
                        <span className="left-nav-item-badge">{route.badge}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </aside>
      )}
    </>,
    document.body
  );
}

export default LeftSideNav;
