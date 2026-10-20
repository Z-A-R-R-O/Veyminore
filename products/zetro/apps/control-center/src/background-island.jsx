import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import GradientASCII from './components/GradientASCII.jsx';

const PALETTES = {
  mint: ['#182b5c', '#8174b9', '#59b9c7', '#bff0d8'],
  cyan: ['#1d2d59', '#536aaf', '#68b8d3', '#b9ecfc'],
  violet: ['#203452', '#5768a5', '#a789cf', '#dccbff'],
  amber: ['#203659', '#5c7796', '#b5a87e', '#f8dda1'],
  rose: ['#203556', '#696f9c', '#c187a9', '#ffd0d3'],
  silver: ['#20344f', '#647ca1', '#8bb9b9', '#e0ebed']
};

const container = document.getElementById('app-background');
const content = document.getElementById('content');

function AppBackground() {
  const [accent, setAccent] = useState(() => document.documentElement.dataset.accent || 'mint');

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setAccent(document.documentElement.dataset.accent || 'mint');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent'] });
    return () => observer.disconnect();
  }, []);

  return (
    <GradientASCII
      colors={PALETTES[accent] || PALETTES.mint}
      shape="horizon"
      characters=" "
      density={0}
      glyphOpacity={0}
      gradientOpacity={0.85}
      glow={0}
      flicker={0}
      grain={0}
      flow={0.2}
      speed={0.5}
      mouseInteraction={false}
      clickEffect="none"
      intro
    />
  );
}

if (container) {
  const renderBackground = () => {
    if (content?.querySelector('.loading')) return false;
    createRoot(container).render(<AppBackground />);
    return true;
  };

  if (!renderBackground() && content) {
    const observer = new MutationObserver(() => {
      if (renderBackground()) observer.disconnect();
    });
    observer.observe(content, { childList: true, subtree: true });
  }
}
