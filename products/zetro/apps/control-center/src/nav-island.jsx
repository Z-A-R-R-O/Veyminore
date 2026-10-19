import { createRoot } from 'react-dom/client';
import React, { useState, useEffect, useRef } from 'react';
import CardNav from './components/CardNav';

const viewLabels = {
  overview: 'Overview',
  workers: 'Workers',
  readiness: 'RCT Readiness',
  activity: 'Activity',
  requirements: 'Roadmap',
  computer: 'Computer Agent'
};

function NavIsland({
  initialView = 'overview',
  initialWorkerCount = 10,
  onMount
}) {
  const isComputerPreview =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/computer-preview');
  const [view, setView] = useState(isComputerPreview ? 'computer' : initialView);
  const [workerCount, setWorkerCount] = useState(initialWorkerCount);

  const callbacksRef = useRef({});

  useEffect(() => {
    onMount?.({
      setView: nextView => setView(nextView),
      setWorkerCount: count => setWorkerCount(count),
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

  const handleLinkClick = (link, item, event) => {
    if (event) event.preventDefault();
    const href = link.href || '';

    if (href === '#action:refresh') {
      callbacksRef.current.onRefresh?.();
      return;
    }

    if (href === '#action:scroll-fleet') {
      handleNavigate('overview');
      setTimeout(() => {
        document.querySelector('.fleet-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return;
    }

    if (href === '#action:scroll-bento') {
      handleNavigate('overview');
      setTimeout(() => {
        document.querySelector('#bento-root')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return;
    }

    if (href === '#action:scroll-streams') {
      handleNavigate('overview');
      setTimeout(() => {
        document.querySelector('.columns')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return;
    }

    if (href === '#action:tweak') {
      const tweak = document.querySelector('.tweak');
      if (tweak) tweak.open = !tweak.open;
      return;
    }

    if (href.startsWith('#workers?group=')) {
      const group = href.split('=')[1] || 'all';
      handleGroupFilter(group);
      return;
    }

    if (href.startsWith('#')) {
      const v = href.slice(1);
      if (viewLabels[v]) {
        handleNavigate(v);
      }
    }
  };

  const navItems = [
    {
      label: 'Views',
      description: 'Follow real assignments, verified evidence, and upcoming gates.',
      links: [
        { label: 'Overview', href: '#overview' },
        { label: 'Workers Fleet', href: '#workers' },
        { label: 'RCT Readiness', href: '#readiness' },
        { label: 'Activity Notes', href: '#activity' },
        { label: 'Roadmap Phases', href: '#requirements' },
        { label: 'Computer Agent', href: '#computer' }
      ]
    },
    {
      label: 'Fleets',
      description: 'Three coordinated teams operating in one workspace.',
      links: [
        { label: `All Workers (${workerCount || 10})`, href: '#workers?group=all' },
        { label: 'RCT Coding Team (Built-in)', href: '#workers?group=RCT' },
        { label: 'AGR Engineering (Antigravity)', href: '#workers?group=AGR' },
        { label: 'OCR Computing (OpenCode)', href: '#workers?group=OCR' }
      ]
    },
    {
      label: 'Workspace',
      description: 'Veyminore · Local preview v0.1 · Read-only authority.',
      links: [
        { label: 'Platform Bento Showcase', href: '#action:scroll-bento' },
        { label: 'Sync Saved Evidence', href: '#action:refresh' },
        { label: 'Scroll to Live Fleet', href: '#action:scroll-fleet' },
        { label: 'Scroll to Workstreams', href: '#action:scroll-streams' },
        { label: 'Appearance & Display Density', href: '#action:tweak' }
      ]
    }
  ];

  const ZetroLogo = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none' }}>
      <span
        style={{
          width: 26,
          height: 26,
          background: 'linear-gradient(180deg, #2a2a30, #18191c)',
          color: '#ffffff',
          borderRadius: 7,
          boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.22), 0 2px 6px rgba(0,0,0,0.4)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 14,
          fontWeight: 850,
          letterSpacing: '-.06em'
        }}
      >
        Z
      </span>
      <span style={{ fontSize: 13, letterSpacing: '.08em', fontWeight: 800, color: '#ffffff' }}>ZETRO</span>
      <span
        style={{
          fontSize: 11,
          color: 'rgba(255, 255, 255, 0.55)',
          fontWeight: 500,
          paddingLeft: 8,
          borderLeft: '1px solid rgba(255, 255, 255, 0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#3fb950',
            boxShadow: '0 0 6px rgba(63, 185, 80, 0.8)'
          }}
        />
        {viewLabels[view] || 'Overview'}
      </span>
    </div>
  );

  return (
    <CardNav
      logo={ZetroLogo}
      logoAlt="ZETRO Control Center"
      logoHref="#overview"
      items={navItems}
      cta={{
        label: 'Orb Preview ↗',
        href: '#computer',
        onClick: e => {
          e?.preventDefault?.();
          handleNavigate('computer');
        }
      }}
      theme="dark"
      surface="glass"
      cardEffect="rise"
      openOn="click"
      stagger={0.1}
      bounce={0.22}
      speed={1.1}
      cardHeight={168}
      maxWidth={1350}
      menuLabel={true}
      intro={true}
      onLinkClick={handleLinkClick}
    />
  );
}

export function mountCardNav(container, options = {}) {
  if (!container) return null;
  const root = createRoot(container);
  let controller = null;

  root.render(
    <NavIsland
      initialView={options.initialView || 'overview'}
      initialWorkerCount={options.workerCount || 10}
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
    destroy() {
      root.unmount();
    }
  };
}
