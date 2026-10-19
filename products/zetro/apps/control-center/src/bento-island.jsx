import { createRoot } from 'react-dom/client';
import React, { useState, useEffect } from 'react';
import MagicBento from './components/MagicBento';

const ZETRO_BENTO_ITEMS = [
  {
    title: 'Fleet Observation',
    label: 'METRICS',
    description: 'Track verified progress, timestamps, and monotonic session sequences across workers.',
    visual: 'analytics'
  },
  {
    title: 'Orchestration Hub',
    label: 'DISPATCH',
    description: 'Unified dispatch for RCT, AGR, and OCR fleets in one reactive workspace.',
    visual: 'dashboard'
  },
  {
    title: 'Human-in-the-Loop Policy',
    label: 'GOVERNANCE',
    description: 'Non-consequential actions execute autonomously under explicit leases. Consequential edits, purchases, or credential access require human authorization.',
    visual: 'collaboration',
    colSpan: 2,
    rowSpan: 2
  },
  {
    title: 'Prompt-Driven Computer Agent',
    label: 'COMPUTER AGENT',
    description: 'Discover applications -> observe desktop state -> plan supported steps -> authorize native effects -> independently verify with SHA-256 evidence.',
    visual: 'automation',
    colSpan: 2,
    rowSpan: 2
  },
  {
    title: 'MCP & Native Bridges',
    label: 'CONNECTIVITY',
    description: 'Isolated stdio / SSE transport, Antigravity sidecar bridge, and Windows UI Automation provider.',
    visual: 'integration'
  },
  {
    title: 'Read-Only Containment',
    label: 'INTEGRITY',
    description: 'Zero paid fallback leaks, zero arbitrary shell injection, strict boundary policy enforcement.',
    visual: 'security'
  }
];

function BentoIsland({
  items = ZETRO_BENTO_ITEMS,
  columns = 4,
  rowHeight = 190,
  gap = 14,
  radius = 16,
  enableBorderGlow = true,
  enableSpotlight = true,
  spotlightRadius = 320,
  clickEffect = true,
  glowColor = '#8ce6b8',
  onItemClick,
  onMount
}) {
  const [currentGlow, setCurrentGlow] = useState(glowColor);

  useEffect(() => {
    onMount?.({
      setGlowColor: (color) => setCurrentGlow(color)
    });
  }, [onMount]);

  return (
    <div className="bento-container">
      <MagicBento
        items={items}
        columns={columns}
        rowHeight={rowHeight}
        gap={gap}
        radius={radius}
        enableBorderGlow={enableBorderGlow}
        enableSpotlight={enableSpotlight}
        spotlightRadius={spotlightRadius}
        clickEffect={clickEffect}
        glowColor={currentGlow}
        theme="dark"
        textAutoHide={true}
        intro={true}
        onItemClick={onItemClick}
      />
    </div>
  );
}

export function mountMagicBento(container, options = {}) {
  if (!container) return null;
  const root = createRoot(container);
  let islandController = null;

  root.render(
    <BentoIsland
      items={options.items || ZETRO_BENTO_ITEMS}
      columns={options.columns || 4}
      rowHeight={options.rowHeight || 190}
      gap={options.gap || 14}
      radius={options.radius || 16}
      enableBorderGlow={options.enableBorderGlow !== false}
      enableSpotlight={options.enableSpotlight !== false}
      spotlightRadius={options.spotlightRadius || 320}
      clickEffect={options.clickEffect !== false}
      glowColor={options.glowColor || '#8ce6b8'}
      onItemClick={options.onItemClick}
      onMount={(ctrl) => {
        islandController = ctrl;
      }}
    />
  );

  return {
    setGlowColor(color) {
      islandController?.setGlowColor(color);
    },
    destroy() {
      root.unmount();
    }
  };
}

export default BentoIsland;
