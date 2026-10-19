import { createRoot } from 'react-dom/client';
import React, { useState, useEffect, useRef } from 'react';
import Dock from './components/Dock';
import {
  Home01Icon,
  ComputerTerminal01Icon,
  UserGroupIcon,
  Activity01Icon,
  Layers01Icon,
  SparklesIcon,
  SlidersHorizontal,
  RefreshIcon,
  BellIcon,
  Search01Icon
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

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
  const [density, setDensity] = useState('relaxed');
  const [detail, setDetail] = useState('focused');
  const [accent, setAccent] = useState(() => {
    try {
      return localStorage.getItem('zetro_accent') || 'mint';
    } catch {
      return 'mint';
    }
  });

  const callbacksRef = useRef({});

  useEffect(() => {
    onMount?.({
      setView: nextView => setView(nextView),
      setWorkerCount: count => setWorkerCount(count),
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

  const scrollToSelector = selector => {
    setView('overview');
    callbacksRef.current.onViewChange?.('overview');
    setTimeout(() => {
      const el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  };

  // 1. Satellite Left Dock Items (Notifications & Search)
  const leftItems = [
    {
      icon: glyph(BellIcon),
      label: 'Notifications',
      menu: [
        { label: 'Workspace Notifications', disabled: true },
        { separator: true },
        { label: '✓ All offline unit tests passed', onClick: () => {} },
        { label: '✓ AGR-2 reviewed increment accepted', onClick: () => {} },
        { label: '• Free model qualification pending', onClick: () => {} },
        { separator: true },
        { label: 'Notification Preferences...', onClick: () => {} }
      ]
    },
    {
      icon: glyph(Search01Icon),
      label: 'Quick Search (Ctrl+K)',
      onClick: () => {
        handleNavigate('workers');
      },
      menu: [
        { label: 'Quick Navigation', disabled: true },
        { separator: true },
        { label: 'Jump to Overview', onClick: () => handleNavigate('overview') },
        { label: 'Jump to Workers', onClick: () => handleNavigate('workers') },
        { label: 'Jump to RCT Readiness', onClick: () => handleNavigate('readiness') },
        { label: 'Jump to Computer Preview', onClick: () => handleNavigate('computer') },
        { separator: true },
        { label: 'Filter RCT Team', onClick: () => handleGroupFilter('RCT') },
        { label: 'Filter AGR Team', onClick: () => handleGroupFilter('AGR') },
        { label: 'Filter OCR Team', onClick: () => handleGroupFilter('OCR') }
      ]
    }
  ];

  // 2. Center Main Dock Items (Untouched current dock)
  const items = [
    {
      icon: glyph(Home01Icon),
      label: 'Overview',
      active: view === 'overview',
      onClick: () => handleNavigate('overview'),
      menu: [
        { label: 'Workspace Overview', onClick: () => handleNavigate('overview') },
        { separator: true },
        { label: 'Scroll to Live Fleet', onClick: () => scrollToSelector('.fleet-preview') },
        { label: 'Scroll to Workstreams', onClick: () => scrollToSelector('.columns') }
      ]
    },
    {
      icon: glyph(ComputerTerminal01Icon),
      label: 'RCT Readiness',
      active: view === 'readiness',
      onClick: () => handleNavigate('readiness'),
      menu: [
        { label: 'All 14 Capability Gates', onClick: () => handleNavigate('readiness') },
        { separator: true },
        { label: 'View Roadmap Phases', onClick: () => handleNavigate('requirements') }
      ]
    },
    {
      icon: glyph(UserGroupIcon),
      label: 'Workers',
      badge: workerCount > 0 ? String(workerCount) : null,
      active: view === 'workers',
      onClick: () => handleNavigate('workers'),
      menu: [
        { label: `All Workers (${workerCount || 10})`, onClick: () => handleGroupFilter('all') },
        { separator: true },
        { label: 'RCT Team (Built-in)', onClick: () => handleGroupFilter('RCT') },
        { label: 'AGR Team (Antigravity)', onClick: () => handleGroupFilter('AGR') },
        { label: 'OCR Team (OpenCode)', onClick: () => handleGroupFilter('OCR') }
      ]
    },
    {
      icon: glyph(Activity01Icon),
      label: 'Activity',
      active: view === 'activity',
      onClick: () => handleNavigate('activity'),
      menu: [
        { label: 'Coordinator Notes Timeline', onClick: () => handleNavigate('activity') },
        { separator: true },
        { label: 'Sync Coordinator Activity', onClick: () => handleRefresh() }
      ]
    },
    {
      icon: glyph(Layers01Icon),
      label: 'Roadmap',
      active: view === 'requirements',
      onClick: () => handleNavigate('requirements'),
      menu: [
        { label: 'Delivery Phases (01–04)', onClick: () => handleNavigate('requirements') },
        { separator: true },
        { label: 'Phase 1: Foundations', onClick: () => handleNavigate('requirements') },
        { label: 'Phase 2: Qualification', onClick: () => handleNavigate('requirements') },
        { label: 'Phase 3: Review & Experience', onClick: () => handleNavigate('requirements') },
        { label: 'Phase 4: Desktop & Computer', onClick: () => handleNavigate('requirements') }
      ]
    },
    {
      icon: glyph(SparklesIcon),
      label: 'Computer Agent',
      active: view === 'computer',
      onClick: () => handleNavigate('computer'),
      menu: [
        {
          label: 'Launch Orb Simulation',
          onClick: () => handleNavigate('computer')
        },
        { separator: true },
        {
          label: 'Reactive Computing Preview',
          onClick: () => handleNavigate('computer')
        }
      ]
    },
    { separator: true },
    {
      icon: glyph(SlidersHorizontal),
      label: 'Appearance',
      onClick: () => {
        const tweakEl = document.querySelector('.tweak');
        if (tweakEl) {
          tweakEl.open = !tweakEl.open;
        }
      },
      menu: [
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
          label: 'Mint (Default)',
          checked: accent === 'mint',
          onClick: () => handleAccentChange('mint')
        },
        {
          label: 'Cyan (Sky)',
          checked: accent === 'cyan',
          onClick: () => handleAccentChange('cyan')
        },
        {
          label: 'Violet (Iris)',
          checked: accent === 'violet',
          onClick: () => handleAccentChange('violet')
        },
        {
          label: 'Amber (Gold)',
          checked: accent === 'amber',
          onClick: () => handleAccentChange('amber')
        },
        {
          label: 'Rose (Coral)',
          checked: accent === 'rose',
          onClick: () => handleAccentChange('rose')
        },
        {
          label: 'Silver (Slate)',
          checked: accent === 'silver',
          onClick: () => handleAccentChange('silver')
        }
      ]
    },
    {
      icon: glyph(RefreshIcon),
      label: 'Refresh Evidence',
      onClick: () => handleRefresh(),
      menu: [
        { label: 'Sync Saved Evidence Now', onClick: () => handleRefresh() },
        { separator: true },
        { label: 'Auto-Refresh: Every 10s', disabled: true }
      ]
    }
  ];

  // 3. Satellite Right Dock Items (More, Sliders, Fullscreen, Tabs)
  const rightItems = [
    {
      icon: <MoreDotsGlyph />,
      label: 'More Options',
      menu: [
        { label: 'Workspace Options', disabled: true },
        { separator: true },
        { label: 'Export Diagnostics Journal', onClick: () => {} },
        { label: 'Open Terminal Session', onClick: () => {} },
        { label: 'Documentation & Guides', onClick: () => {} },
        { separator: true },
        { label: 'Zetro Control Center v0.1.0', disabled: true }
      ]
    },
    {
      icon: <SlidersGlyph />,
      label: 'Display Settings',
      onClick: () => {
        const tweakEl = document.querySelector('.tweak');
        if (tweakEl) tweakEl.open = !tweakEl.open;
      },
      menu: [
        { label: 'Display & Layout', disabled: true },
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
    { separator: true },
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
      icon: <TabCountGlyph count={2} />,
      label: 'Workspaces (2 Active)',
      menu: [
        { label: 'Virtual Workspaces', disabled: true },
        { separator: true },
        { label: 'Workspace 1: Local Preview', checked: false, onClick: () => {} },
        { label: 'Workspace 2: Zetro Engine', checked: true, onClick: () => {} },
        { separator: true },
        { label: '+ Add New Workspace', onClick: () => {} }
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
        baseItemSize={50}
        magnification={70}
        panelHeight={68}
        gap={10}
        roundness={1}
        distance={160}
        spring={{ mass: 0.1, stiffness: 150, damping: 12 }}
        bounce={true}
        autoHide={false}
        tiles={true}
        showLabels={true}
        showIndicators={false}
        showBadges={false}
        intro={true}
        introDelay={180}
      />
      <Dock
        className="dock-island-center"
        items={items}
        position="bottom"
        theme="dark"
        baseItemSize={50}
        magnification={70}
        panelHeight={68}
        gap={10}
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
        baseItemSize={50}
        magnification={70}
        panelHeight={68}
        gap={10}
        roundness={1}
        distance={160}
        spring={{ mass: 0.1, stiffness: 150, damping: 12 }}
        bounce={true}
        autoHide={false}
        tiles={true}
        showLabels={true}
        showIndicators={false}
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
    setDensity(d) {
      controller?.setDensity(d);
    },
    setDetail(dt) {
      controller?.setDetail(dt);
    },
    destroy() {
      root.unmount();
    }
  };
}
