/**
 * @file apps/control-center/src/live-integration.js
 * Pure live integration models, status projection mapping, and URL sync logic.
 *
 * Guaranteed 100% vanilla JavaScript for standard Node.js test runner execution.
 */

/**
 * Maps raw snapshot from /api/status into truthful shell status properties.
 * Never invents paths, connections, worker counts, or active flags.
 *
 * @param {Object} [data]
 * @returns {Object}
 */
export function mapStatusProjection(data) {
  if (!data || typeof data !== 'object') {
    return {
      workspaceName: null,
      workspacePath: null,
      workspaceId: null,
      connected: undefined,
      stale: false,
      ifzActive: undefined,
      workerCount: null,
      activeRunCount: null,
      workers: [],
      activity: [],
      sources: [],
      boundaries: { readOnly: true, liveInference: false, nativeDesktopVerified: false }
    };
  }

  const workers = Array.isArray(data.workers) ? data.workers : [];
  const workerCount = workers.length > 0 ? workers.length : null;
  const activeRuns = workers.filter(w => {
    const s = String(w.live?.state || w.dispatch || '').toLowerCase();
    return ['busy', 'running', 'working', 'in_progress'].includes(s);
  }).length;

  return {
    workspaceName: typeof data.workspace === 'string' && data.workspace.trim() ? data.workspace.trim() : null,
    workspacePath: null, // Truthful: filesystem path is not exposed via read-only snapshot
    workspaceId: null,
    connected: false, // Boundaries state liveInference is false; no persistent daemon attached
    stale: false,
    ifzActive: false, // IFZ runtime inference boundary is protected read-only
    workerCount,
    activeRunCount: activeRuns > 0 ? activeRuns : null,
    workers,
    activity: Array.isArray(data.activity) ? data.activity : [],
    sources: Array.isArray(data.sources) ? data.sources : [],
    boundaries: data.boundaries || { readOnly: true, liveInference: false, nativeDesktopVerified: false }
  };
}

/**
 * Checks whether the development lab mode is explicitly enabled.
 * Remains strictly hidden by default.
 *
 * @param {Object|Location} [locationInput]
 * @returns {boolean}
 */
export function resolveDevLabFlag(locationInput = null) {
  if (typeof window !== 'undefined' || locationInput) {
    const loc = locationInput || (typeof window !== 'undefined' ? window.location : null);
    if (!loc) return false;
    const search = loc.search || '';
    const hash = loc.hash || '';
    if (search.includes('dev=true') || search.includes('devLab=true') || search.includes('lab=true')) {
      return true;
    }
    if (hash === '#lab' || hash.startsWith('#lab?') || hash.startsWith('#/lab')) {
      return true;
    }
    if (typeof window !== 'undefined' && window.__ZETRO_DEV_LAB__ === true) {
      return true;
    }
  }
  return false;
}
