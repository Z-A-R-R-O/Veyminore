import { createRoot } from 'react-dom/client';
import React, { useState, useEffect, useRef } from 'react';
import CardNav from './components/CardNav';
import {
  CANONICAL_ROUTES,
  TOP_MENU_GROUPS,
  ROUTE_LABELS,
  createDynamicRegistries,
  resolveActiveRoute
} from './product-navigation.js';

function NavIsland({
  initialView = 'work',
  initialWorkerCount = 10,
  onMount
}) {
  const isComputerPreview =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/computer-preview');
  const [view, setView] = useState(isComputerPreview ? 'computer' : (initialView === 'overview' ? 'work' : initialView));
  const [workerCount, setWorkerCount] = useState(initialWorkerCount);
  const [connectionStatus, setConnectionStatus] = useState({
    connected: true,
    label: 'Connected'
  });
  const [workspaceName, setWorkspaceName] = useState('Veyminore');
  const [conversationTitle, setConversationTitle] = useState('');
  const [dynamicRegistries, setDynamicRegistries] = useState(() => createDynamicRegistries());
  const [navOpen, setNavOpen] = useState(false);

  const callbacksRef = useRef({});

  const handleNavOpenChange = next => {
    setNavOpen(next);
    if (next) {
      window.dispatchEvent(new CustomEvent('zetro:collapse-panels'));
    }
  };

  useEffect(() => {
    const handleClose = () => setNavOpen(false);
    window.addEventListener('zetro:close-top-nav', handleClose);
    return () => window.removeEventListener('zetro:close-top-nav', handleClose);
  }, []);

  useEffect(() => {
    onMount?.({
      setView: nextView => setView(nextView === 'overview' ? 'work' : nextView),
      setWorkerCount: count => setWorkerCount(count),
      setConnectionStatus: status => {
        if (typeof status === 'boolean') {
          setConnectionStatus({ connected: status, label: status ? 'Connected' : 'Disconnected' });
        } else if (status && typeof status === 'object') {
          setConnectionStatus({
            connected: Boolean(status.connected),
            label: status.label || (status.connected ? 'Connected' : 'Disconnected')
          });
        }
      },
      setWorkspace: ws => setWorkspaceName(typeof ws === 'string' ? ws : (ws?.name || 'Veyminore')),
      setConversationTitle: title => setConversationTitle(title || ''),
      updateDynamicRegistries: data => setDynamicRegistries(createDynamicRegistries(data)),
      registerCallbacks: cbs => {
        callbacksRef.current = { ...callbacksRef.current, ...cbs };
      }
    });
  }, [onMount]);

  const handleNavigate = targetView => {
    const resolved = targetView === 'overview' ? 'work' : targetView;
    setView(resolved);
    callbacksRef.current.onViewChange?.(resolved);
  };

  const handleGroupFilter = group => {
    setView('workers');
    callbacksRef.current.onGroupFilter?.(group);
  };

  const handleLinkClick = (link, item, event) => {
    if (event) event.preventDefault();
    setNavOpen(false);
    const href = link.href || '';

    if (href === '#computer-preview' || href === '#action:lab' || href === '#lab') {
      window.location.href = '/computer-preview/';
      return;
    }

    if (href === '#action:refresh') {
      callbacksRef.current.onRefresh?.();
      return;
    }

    if (href === '#action:scroll-fleet') {
      handleNavigate('work');
      setTimeout(() => {
        document.querySelector('.fleet-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return;
    }

    if (href === '#action:scroll-bento') {
      handleNavigate('work');
      setTimeout(() => {
        document.querySelector('#bento-root')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return;
    }

    if (href === '#action:scroll-streams') {
      handleNavigate('work');
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
      const hashPart = href.slice(1);
      const v = hashPart.split(/[?#]/)[0];
      const targetRoute = resolveActiveRoute(v);
      if (targetRoute) {
        handleNavigate(targetRoute.id);
      }
    }
  };

  const activeLabel = ROUTE_LABELS[view] || 'Work';

  const centerCluster = (
    <div className="card-nav__center-cluster" aria-label={`Current view: ${activeLabel}`}>
      <span className="card-nav__brand-mark" aria-hidden="true">Z</span>
      <span className="card-nav__brand-name">ZETRO</span>
      <span className="card-nav__slash" aria-hidden="true">/</span>
      <span className="card-nav__page-name">{activeLabel}</span>
      {conversationTitle ? (
        <>
          <span className="card-nav__title-sep" aria-hidden="true">·</span>
          <span className="card-nav__conv-title" title={conversationTitle}>{conversationTitle}</span>
        </>
      ) : null}
    </div>
  );

  const rightCluster = (
    <div className="card-nav__right-cluster">
      <div
        className={`card-nav__chip card-nav__chip--connection ${connectionStatus.connected ? 'is-connected' : 'is-disconnected'}`}
        title={connectionStatus.label || (connectionStatus.connected ? 'Connected · Live Evidence' : 'Connection unavailable')}
      >
        <span
          className={`card-nav__status-dot ${connectionStatus.connected ? 'is-pulse' : ''}`}
          aria-hidden="true"
        />
        <span className="card-nav__chip-text">{connectionStatus.connected ? 'Connected' : 'Disconnected'}</span>
      </div>

      <div
        className="card-nav__chip card-nav__chip--workspace"
        title={`Workspace: ${workspaceName}`}
      >
        <span className="card-nav__chip-text">{workspaceName}</span>
      </div>

      <button
        type="button"
        className="card-nav__ifz-shortcut"
        title="IFZ — Return to active conversation & prompts"
        onClick={() => {
          handleNavigate('work');
          const promptInput = document.querySelector('.ifz-composer__input, #ifz-prompt-input');
          if (promptInput) {
            promptInput.focus();
          }
        }}
      >
        <span>IFZ</span>
      </button>
    </div>
  );

  const navItems = [
    {
      label: 'PRODUCT',
      description: 'Core application work surfaces and execution records.',
      links: [
        { label: 'Work', href: '#work', description: 'IFZ active prompt & dispatch' },
        { label: 'Workers', href: '#workers', description: `${workerCount || 10} verified agents` },
        { label: 'Runs', href: '#runs', description: 'Live & durable timelines' },
        { label: 'Computer', href: '#computer', description: 'Sessions & native telemetry' },
        { label: 'Evidence', href: '#evidence', description: 'Independent audit receipts' }
      ],
      extraSection: dynamicRegistries.recentConversations?.length > 0 ? {
        title: 'Recent Conversations',
        items: dynamicRegistries.recentConversations.map(c => ({
          label: c.title,
          href: `#work?conversation=${encodeURIComponent(c.id)}`
        }))
      } : null
    },
    {
      label: 'IFZ',
      description: 'Central prompt, context, routing, and audit layer.',
      links: [
        { label: 'Master Prompt', href: '#settings?section=master-prompt', description: 'Charter & context layers' },
        { label: 'Presets', href: '#settings?section=presets', description: 'Standard, ECO & Build modes' },
        { label: 'Saved Routes', href: '#work?tab=saved-routes', description: 'Reusable route pipelines' },
        { label: 'Worker Registry', href: '#workers?tab=registry', description: 'Adapter contracts & schemas' }
      ],
      extraSection: dynamicRegistries.savedRoutes?.length > 0 ? {
        title: 'Saved Routes',
        items: dynamicRegistries.savedRoutes.map(r => ({
          label: r.label,
          href: `#work?route=${encodeURIComponent(r.id)}`
        }))
      } : null
    },
    {
      label: 'SYSTEM',
      description: 'Platform infrastructure, security & development tools.',
      links: [
        { label: 'Connections', href: '#settings?section=connections', description: 'Process runners & endpoints' },
        { label: 'Permissions', href: '#settings?section=permissions', description: 'Desktop access grants' },
        { label: 'Appearance', href: '#action:tweak', description: 'Themes & display density' },
        { label: 'Diagnostics', href: '#settings?section=diagnostics', description: 'Execution journals' },
        { label: 'Development Lab', href: '#computer-preview', description: 'Orb Preview & simulations' }
      ],
      extraSection: {
        title: 'Development Previews',
        items: [
          { label: 'Orb Preview ↗', href: '#computer-preview' },
          { label: 'Bento Showcase ↗', href: '#action:scroll-bento' }
        ]
      }
    }
  ];

  return (
    <CardNav
      center={centerCluster}
      right={rightCluster}
      items={navItems}
      theme="dark"
      surface="glass"
      cardEffect="rise"
      openOn="click"
      stagger={0.08}
      bounce={0.2}
      speed={1.1}
      cardHeight={210}
      maxWidth={980}
      menuLabel={true}
      intro={true}
      open={navOpen}
      onOpenChange={handleNavOpenChange}
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
      initialView={options.initialView || 'work'}
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
    setConnectionStatus(status) {
      controller?.setConnectionStatus(status);
    },
    setWorkspace(ws) {
      controller?.setWorkspace(ws);
    },
    setConversationTitle(title) {
      controller?.setConversationTitle(title);
    },
    destroy() {
      root.unmount();
    }
  };
}
