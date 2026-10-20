import { createRoot } from 'react-dom/client';
import React, { useState, useEffect, useRef } from 'react';
import Dock from './components/Dock';
import {
  Home01Icon,
  Comment01Icon,
  UserGroupIcon,
  Route01Icon,
  ComputerTerminal01Icon,
  CheckmarkCircle01Icon,
  Settings01Icon,
  RefreshIcon,
  BellIcon,
  Search01Icon,
  CommandIcon,
  Layers01Icon,
  ViewIcon
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

export const ACCENTS = {
  mint: { id: 'mint', label: 'Mint', hex: '#8ce6b8', rgb: '140, 230, 184', beacon: '#3fb950', badge: '#3fb950', ink: '#ffffff', soft: 'rgba(62, 115, 88, 0.2)' },
  cyan: { id: 'cyan', label: 'Cyan', hex: '#38bdf8', rgb: '56, 189, 248', beacon: '#0ea5e9', badge: '#0ea5e9', ink: '#ffffff', soft: 'rgba(14, 116, 144, 0.25)' },
  violet: { id: 'violet', label: 'Violet', hex: '#a78bfa', rgb: '167, 139, 250', beacon: '#8b5cf6', badge: '#8b5cf6', ink: '#ffffff', soft: 'rgba(109, 40, 217, 0.25)' },
  amber: { id: 'amber', label: 'Amber', hex: '#fbbf24', rgb: '251, 191, 36', beacon: '#f59e0b', badge: '#f59e0b', ink: '#ffffff', soft: 'rgba(180, 83, 9, 0.25)' },
  rose: { id: 'rose', label: 'Rose', hex: '#fb7185', rgb: '251, 113, 133', beacon: '#f43f5e', badge: '#f43f5e', ink: '#ffffff', soft: 'rgba(190, 18, 60, 0.25)' },
  silver: { id: 'silver', label: 'Silver', hex: '#e2e8f0', rgb: '226, 232, 240', beacon: '#cbd5e1', badge: '#e2e8f0', ink: '#090a0c', soft: 'rgba(148, 163, 184, 0.2)' }
};

const glyph = IconComponent => (
  <HugeiconsIcon icon={IconComponent} size="20px" strokeWidth={1.8} color="#ffffff" />
);

// Custom SVGs matching user reference images
const SlidersGlyph = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ffffff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6.5" cy="8.5" r="2.2" stroke="#ffffff" strokeWidth="1.9" />
    <path d="M10 8.5h8.5" />
    <circle cx="6.5" cy="15.5" r="2.2" stroke="#ffffff" strokeWidth="1.9" />
    <path d="M10 15.5h8.5" />
  </svg>
);

const CornersGlyph = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 6h3v3" />
    <path d="M8 18H5v-3" />
  </svg>
);

const TabCountGlyph = ({ count = 2 }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
    <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="5" stroke="#ffffff" strokeWidth="1.9" />
    <text
      x="12"
      y="16.2"
      textAnchor="middle"
      fill="#ffffff"
      stroke="none"
      fontSize="12.5"
      fontWeight="750"
      fontFamily="Satoshi, system-ui, -apple-system, sans-serif"
    >
      {count}
    </text>
  </svg>
);

const MoreDotsGlyph = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="#ffffff" aria-hidden="true">
    <circle cx="5.5" cy="12" r="1.75" />
    <circle cx="12" cy="12" r="1.75" />
    <circle cx="18.5" cy="12" r="1.75" />
  </svg>
);

function DockIsland({
  initialView = 'overview',
  initialWorkerCount = 0,
  onMount
}) {
  const isComputerPreview =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/computer-preview');
  const [view, setView] = useState(isComputerPreview ? 'computer' : initialView);
  const [workerCount, setWorkerCount] = useState(initialWorkerCount);
  const [workspaceName, setWorkspaceName] = useState('No workspace');
  const [connectionLabel, setConnectionLabel] = useState('Connection unknown');
  const [density, setDensity] = useState('relaxed');
  const [detail, setDetail] = useState('focused');
  const [accent, setAccent] = useState(() => {
    try {
      return localStorage.getItem('zetro_accent') || 'mint';
    } catch {
      return 'mint';
    }
  });

  // Responsive window dimensions tracking for smart dock shrink
  const [windowDim, setWindowDim] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  }));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer = 0;
    const onResize = () => {
      cancelAnimationFrame(timer);
      timer = requestAnimationFrame(() => {
        setWindowDim({
          width: window.innerWidth,
          height: window.innerHeight
        });
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(timer);
    };
  }, []);

  useEffect(() => {
    const onShortcut = event => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== 'k' && !(key === 'p' && event.shiftKey)) return;
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('zetro:open-dock-menu', {
        detail: { dock: 'dock-island-left', index: key === 'k' ? 1 : 3 }
      }));
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  const dockMetrics = React.useMemo(() => {
    const w = windowDim.width;
    const h = windowDim.height;
    const isShort = h <= 680;
    const isVeryShort = h <= 520;

    if (w > 1560 && !isShort) {
      return {
        bottomBase: 50,
        bottomPeak: 70,
        bottomHeight: 68,
        bottomGap: 10
      };
    } else if (w > 1360 && !isShort) {
      return {
        bottomBase: 44,
        bottomPeak: 58,
        bottomHeight: 60,
        bottomGap: 8
      };
    } else if (w > 1180 || (isShort && !isVeryShort)) {
      const base = isVeryShort ? 32 : (isShort ? 34 : 38);
      return {
        bottomBase: base,
        bottomPeak: base + 12,
        bottomHeight: base + 14,
        bottomGap: 6
      };
    } else if (w > 1000) {
      return {
        bottomBase: 32,
        bottomPeak: 42,
        bottomHeight: 46,
        bottomGap: 4
      };
    } else {
      return {
        bottomBase: w <= 480 ? 32 : 38,
        bottomPeak: w <= 480 ? 42 : 52,
        bottomHeight: w <= 480 ? 46 : 54,
        bottomGap: w <= 480 ? 3 : 6
      };
    }
  }, [windowDim.width, windowDim.height]);

  // Sync accent styles & tokens to documentElement and body
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const a = ACCENTS[accent] || ACCENTS.mint;
    document.documentElement.style.setProperty('--dock-badge', a.badge);
    document.documentElement.style.setProperty('--dock-badge-ink', a.ink);
    document.documentElement.style.setProperty('--accent', a.beacon);
    document.documentElement.style.setProperty('--green', a.hex);
    document.documentElement.style.setProperty('--soft-green', a.soft);
    document.documentElement.style.setProperty('--mb-glow-rgb', a.rgb);
    document.documentElement.setAttribute('data-accent', a.id);
    document.body.setAttribute('data-accent', a.id);
  }, [accent]);

  const callbacksRef = useRef({});

  useEffect(() => {
    onMount?.({
      setView: nextView => setView(nextView),
      setWorkerCount: count => setWorkerCount(count),
      setWorkspace: value => setWorkspaceName(typeof value === 'string' ? value : value?.name || 'No workspace'),
      setConnectionStatus: value => setConnectionLabel(value?.label || 'Connection unknown'),
      setDensity: nextDensity => setDensity(nextDensity),
      setDetail: nextDetail => setDetail(nextDetail),
      setAccent: nextAccent => setAccent(nextAccent),
      registerCallbacks: cbs => {
        callbacksRef.current = { ...callbacksRef.current, ...cbs };
      }
    });
  }, [onMount]);

  const handleNavigate = targetView => {
    setView(targetView);
    callbacksRef.current.onViewChange?.(targetView);
  };

  const focusWork = () => {
    handleNavigate('work');
    setTimeout(() => document.querySelector('.prompt-bar__input')?.focus(), 80);
  };

  const openPromptLayer = tab => {
    handleNavigate('work');
    setTimeout(() => window.dispatchEvent(new CustomEvent('zetro:open-master-prompt', { detail: { tab } })), 80);
  };

  const handleGroupFilter = group => {
    setView('workers');
    callbacksRef.current.onGroupFilter?.(group);
  };

  const handleRefresh = () => {
    callbacksRef.current.onRefresh?.();
  };

  const handleDensityToggle = nextDensity => {
    setDensity(nextDensity);
    callbacksRef.current.onAppearanceChange?.('density', nextDensity);
  };

  const handleDetailToggle = nextDetail => {
    setDetail(nextDetail);
    callbacksRef.current.onAppearanceChange?.('detail', nextDetail);
  };

  const handleAccentChange = nextAccent => {
    setAccent(nextAccent);
    callbacksRef.current.onAppearanceChange?.('accent', nextAccent);
  };

  // 1. Satellite Left Dock Items (4 Canonical: Notifications, Search, Conversations, Command Palette)
  const leftItems = [
    {
      icon: glyph(BellIcon),
      label: 'Notifications',
      openMenuOnClick: true,
      menu: [
        { label: 'No notification feed connected', disabled: true },
        { separator: true },
        { label: 'View evidence', onClick: () => handleNavigate('evidence') },
        { label: 'View runs', onClick: () => handleNavigate('runs') }
      ]
    },
    {
      icon: glyph(Search01Icon),
      label: 'Quick Navigation (Ctrl+K)',
      openMenuOnClick: true,
      menu: [
        { label: 'Quick Navigation', disabled: true },
        { separator: true },
        { label: 'Jump to Work', onClick: () => handleNavigate('work') },
        { label: 'Jump to Workers', onClick: () => handleNavigate('workers') },
        { label: 'Jump to Runs', onClick: () => handleNavigate('runs') },
        { label: 'Jump to Evidence', onClick: () => handleNavigate('evidence') },
        { label: 'Jump to Computer', onClick: () => handleNavigate('computer') },
        { separator: true },
        { label: 'Filter RCT Team', onClick: () => handleGroupFilter('RCT') },
        { label: 'Filter AGR Team', onClick: () => handleGroupFilter('AGR') },
        { label: 'Filter OCR Team', onClick: () => handleGroupFilter('OCR') }
      ]
    },
    {
      icon: glyph(Comment01Icon),
      label: 'IFZ conversation',
      onClick: focusWork
    },
    {
      icon: glyph(CommandIcon),
      label: 'Command Palette (Ctrl+Shift+P)',
      openMenuOnClick: true,
      menu: [
        { label: 'Command Palette', disabled: true },
        { separator: true },
        { label: 'New IFZ instruction', onClick: focusWork },
        { label: 'Computer', onClick: () => handleNavigate('computer') },
        { label: `Workspace: ${workspaceName}`, disabled: true },
        { label: connectionLabel, disabled: true },
        { separator: true },
        { label: 'Appearance controls', onClick: () => { const t = document.querySelector('.tweak'); if (t) t.open = !t.open; } },
        { label: 'Sync evidence', onClick: handleRefresh }
      ]
    }
  ];

  // 2. Center Main Dock Items (Exact 8 destinations in order, current style)
  const items = [
    {
      icon: glyph(Home01Icon),
      label: 'Work',
      active: view === 'work' || view === 'overview',
      onClick: () => handleNavigate('work'),
      menu: [
        { label: 'Work & active prompt', onClick: focusWork },
        { separator: true },
        { label: 'IFZ route plan', onClick: () => openPromptLayer('task') },
        { label: 'Master Prompt', onClick: () => openPromptLayer('charter') }
      ]
    },
    {
      icon: glyph(Comment01Icon),
      label: 'Conversations',
      onClick: focusWork,
      menu: [
        { label: 'Active conversation', onClick: focusWork },
        { separator: true },
        { label: 'Route and task package', onClick: () => openPromptLayer('task') }
      ]
    },
    {
      icon: glyph(UserGroupIcon),
      label: 'Workers',
      badge: workerCount > 0 ? String(workerCount) : null,
      active: view === 'workers',
      onClick: () => handleNavigate('workers'),
      menu: [
        { label: 'All Workers', onClick: () => handleGroupFilter('all') },
        { separator: true },
        { label: 'RCT Coding Team (Built-in)', onClick: () => handleGroupFilter('RCT') },
        { label: 'AGR Engineering Team (Antigravity)', onClick: () => handleGroupFilter('AGR') },
        { label: 'OCR Computing Team (OpenCode)', onClick: () => handleGroupFilter('OCR') }
      ]
    },
    {
      icon: glyph(Route01Icon),
      label: 'Runs',
      active: view === 'runs' || view === 'activity',
      onClick: () => handleNavigate('runs'),
      menu: [
        { label: 'Runs Timeline', onClick: () => handleNavigate('runs') },
        { separator: true },
        { label: 'Active Execution Routes', onClick: () => handleNavigate('runs') },
        { label: 'Execution Receipts', onClick: () => handleNavigate('runs') }
      ]
    },
    {
      icon: glyph(ComputerTerminal01Icon),
      label: 'Computer',
      active: view === 'computer',
      onClick: () => handleNavigate('computer'),
      menu: [
        { label: 'Desktop Session Authority', onClick: () => handleNavigate('computer') },
        { separator: true },
        { label: 'Launch Orb Simulation', onClick: () => handleNavigate('computer') }
      ]
    },
    {
      icon: glyph(CheckmarkCircle01Icon),
      label: 'Evidence',
      active: view === 'evidence' || view === 'readiness',
      onClick: () => handleNavigate('evidence'),
      menu: [
        { label: 'Verification Receipts', onClick: () => handleNavigate('evidence') },
        { separator: true },
        { label: 'RCT Capability Qualification', onClick: () => handleNavigate('evidence') },
        { label: 'Audit Hashes', onClick: () => handleNavigate('evidence') }
      ]
    },
    {
      icon: glyph(Settings01Icon),
      label: 'Settings',
      active: view === 'settings',
      onClick: () => handleNavigate('settings'),
      menu: [
        {
          label: 'Display & Appearance',
          onClick: () => {
            const tweakEl = document.querySelector('.tweak');
            if (tweakEl) tweakEl.open = !tweakEl.open;
          }
        },
        { separator: true },
        { label: 'Master Prompt & Presets', onClick: () => openPromptLayer('charter') },
        { label: 'Worker Registry', onClick: () => handleNavigate('workers') }
      ]
    },
    {
      icon: glyph(RefreshIcon),
      label: 'Sync current state',
      onClick: () => handleRefresh(),
      menu: [
        { label: 'Sync Saved Evidence Now', onClick: () => handleRefresh() },
        { separator: true },
        { label: 'Auto-Refresh: Every 10s', disabled: true }
      ]
    }
  ];

  // 3. Satellite Right Dock Items (7 Canonical: Route, Context, Inspector, Appearance, Fullscreen, Workspaces, More)
  const rightItems = [
    {
      icon: glyph(Route01Icon),
      label: 'IFZ Route',
      onClick: () => openPromptLayer('task'),
      menu: [
        { label: 'Inspect route and task package', onClick: () => openPromptLayer('task') },
        { label: 'Open Work composer', onClick: focusWork }
      ]
    },
    {
      icon: glyph(Layers01Icon),
      label: 'Context',
      onClick: () => openPromptLayer('context'),
      menu: [
        { label: 'Inspect context package', onClick: () => openPromptLayer('context') },
        { label: 'Master Prompt', onClick: () => openPromptLayer('charter') }
      ]
    },
    {
      icon: glyph(ViewIcon),
      label: 'Inspector',
      onClick: () => handleNavigate('runs'),
      menu: [
        { label: 'Runs and execution state', onClick: () => handleNavigate('runs') },
        { label: 'Verification evidence', onClick: () => handleNavigate('evidence') }
      ]
    },
    {
      icon: <SlidersGlyph />,
      label: 'Appearance',
      onClick: () => {
        const tweakEl = document.querySelector('.tweak');
        if (tweakEl) tweakEl.open = !tweakEl.open;
      },
      menu: [
        { label: 'Display & Appearance', disabled: true },
        { separator: true },
        {
          label: 'Density: Relaxed',
          checked: density === 'relaxed',
          onClick: () => handleDensityToggle('relaxed')
        },
        {
          label: 'Density: Compact',
          checked: density === 'compact',
          onClick: () => handleDensityToggle('compact')
        },
        { separator: true },
        {
          label: 'Detail: Focused',
          checked: detail === 'focused',
          onClick: () => handleDetailToggle('focused')
        },
        {
          label: 'Detail: Expanded',
          checked: detail === 'expanded',
          onClick: () => handleDetailToggle('expanded')
        },
        { separator: true },
        { label: 'Accent Color', disabled: true },
        {
          label: 'Mint',
          checked: accent === 'mint',
          onClick: () => handleAccentChange('mint')
        },
        {
          label: 'Cyan',
          checked: accent === 'cyan',
          onClick: () => handleAccentChange('cyan')
        },
        {
          label: 'Violet',
          checked: accent === 'violet',
          onClick: () => handleAccentChange('violet')
        },
        {
          label: 'Amber',
          checked: accent === 'amber',
          onClick: () => handleAccentChange('amber')
        },
        {
          label: 'Rose',
          checked: accent === 'rose',
          onClick: () => handleAccentChange('rose')
        },
        {
          label: 'Silver',
          checked: accent === 'silver',
          onClick: () => handleAccentChange('silver')
        }
      ]
    },
    {
      icon: <CornersGlyph />,
      label: 'Toggle Fullscreen',
      onClick: () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => {});
        } else {
          document.exitFullscreen?.().catch(() => {});
        }
      },
      menu: [
        {
          label: 'Toggle Fullscreen Mode',
          onClick: () => {
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen?.().catch(() => {});
            } else {
              document.exitFullscreen?.().catch(() => {});
            }
          }
        },
        { separator: true },
        { label: 'Zen Focus Mode', onClick: () => document.body.classList.toggle('zen-mode') }
      ]
    },
    {
      icon: <TabCountGlyph count={1} />,
      label: 'Workspace',
      openMenuOnClick: true,
      menu: [
        { label: `Workspace: ${workspaceName}`, disabled: true },
        { label: connectionLabel, disabled: true },
        { separator: true },
        { label: 'Open Work', onClick: () => handleNavigate('work') }
      ]
    },
    {
      icon: <MoreDotsGlyph />,
      label: 'More Options',
      openMenuOnClick: true,
      menu: [
        { label: 'More controls', disabled: true },
        { separator: true },
        { label: 'Master Prompt & Presets', onClick: () => openPromptLayer('charter') },
        { label: 'Worker Registry', onClick: () => handleNavigate('workers') },
        { label: 'Computer development preview', onClick: () => { window.location.href = '/computer-preview/'; } },
        { label: 'Sync evidence', onClick: handleRefresh }
      ]
    }
  ];

  return (
    <>
      <Dock
        className="dock-island-left"
        items={leftItems}
        position="bottom"
        theme="dark"
        baseItemSize={dockMetrics.bottomBase}
        magnification={dockMetrics.bottomPeak}
        panelHeight={dockMetrics.bottomHeight}
        gap={dockMetrics.bottomGap}
        roundness={1}
        distance={160}
        spring={{ mass: 0.1, stiffness: 150, damping: 12 }}
        bounce={true}
        autoHide={false}
        tiles={true}
        showLabels={true}
        showIndicators={true}
        showBadges={false}
        intro={true}
        introDelay={180}
      />
      <Dock
        className="dock-island-center"
        items={items}
        position="bottom"
        theme="dark"
        baseItemSize={dockMetrics.bottomBase}
        magnification={dockMetrics.bottomPeak}
        panelHeight={dockMetrics.bottomHeight}
        gap={dockMetrics.bottomGap}
        roundness={1}
        distance={200}
        spring={{ mass: 0.1, stiffness: 150, damping: 12 }}
        bounce={true}
        autoHide={false}
        tiles={true}
        showLabels={true}
        showIndicators={true}
        showBadges={false}
        badgeColor="#ff453a"
        accentColor="#000000"
        intro={true}
        introDelay={60}
      />
      <Dock
        className="dock-island-right"
        items={rightItems}
        position="bottom"
        theme="dark"
        baseItemSize={dockMetrics.bottomBase}
        magnification={dockMetrics.bottomPeak}
        panelHeight={dockMetrics.bottomHeight}
        gap={dockMetrics.bottomGap}
        roundness={1}
        distance={160}
        spring={{ mass: 0.1, stiffness: 150, damping: 12 }}
        bounce={true}
        autoHide={false}
        tiles={true}
        showLabels={true}
        showIndicators={true}
        showBadges={false}
        intro={true}
        introDelay={180}
      />
    </>
  );
}

export function mountDock(container, options = {}) {
  if (!container) return null;
  const root = createRoot(container);
  let controller = null;

  root.render(
    <DockIsland
      initialView={options.initialView || 'overview'}
      initialWorkerCount={options.workerCount || 0}
      onMount={c => {
        controller = c;
        controller.registerCallbacks({
          onViewChange: options.onViewChange,
          onGroupFilter: options.onGroupFilter,
          onRefresh: options.onRefresh,
          onAppearanceChange: options.onAppearanceChange
        });
      }}
    />
  );

  return {
    setView(v) {
      controller?.setView(v);
    },
    setWorkerCount(count) {
      controller?.setWorkerCount(count);
    },
    setWorkspace(value) {
      controller?.setWorkspace(value);
    },
    setConnectionStatus(value) {
      controller?.setConnectionStatus(value);
    },
    setDensity(d) {
      controller?.setDensity(d);
    },
    setDetail(dt) {
      controller?.setDetail(dt);
    },
    setAccent(a) {
      controller?.setAccent(a);
    },
    destroy() {
      root.unmount();
    }
  };
}
