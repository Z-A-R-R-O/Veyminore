import { createRoot } from 'react-dom/client';
import React from 'react';
import IfzWorkPage from './ifz-work-page.jsx';

/**
 * Mounts the isolated IFZ Work Page into a target DOM container.
 *
 * @param {Element} container - Target container element
 * @param {Object} [options] - Work page options (initialFixture, initialDraft, devLab, etc.)
 * @returns {{ destroy: () => void }} Controller object
 */
export function mountIfzWorkPage(container, options = {}) {
  if (!container) return null;
  const root = createRoot(container);
  root.render(React.createElement(IfzWorkPage, options));
  return {
    destroy() {
      root.unmount();
    }
  };
}

export default IfzWorkPage;
