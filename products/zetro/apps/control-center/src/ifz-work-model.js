/**
 * @file ifz-work-model.js
 * Domain model, state management, and honest fixtures for the IFZ Work page.
 *
 * Implements:
 * - Unified IFZ orchestrator targeting (all requests target IFZ)
 * - Automatic, Manual (constrained), and Saved Workflow route modes
 * - Honest fixtures: empty, loading, disconnected, running, partial-failure, uncertain, cancelled, complete
 * - Unified conversation stream with expandable worker branches (no private reasoning)
 * - Persistent draft state across page/view transitions
 * - Route preview and chip generation
 * - Dry-run submission guard (no network calls, no simulated dispatch)
 */

export const ROUTE_MODES = Object.freeze({
  AUTOMATIC: 'automatic',
  MANUAL: 'manual',
  SAVED_WORKFLOW: 'saved_workflow'
});

export const MASTER_PRESETS = Object.freeze([
  { id: 'zetro-standard', name: 'ZETRO Standard', desc: 'Normal product work with balanced verification' },
  { id: 'eco-mode', name: 'ECO Mode', desc: 'Small context, focused reads, and bounded checks' },
  { id: 'build-mode', name: 'Build Mode', desc: 'Implementation with focused verification' },
  { id: 'review-mode', name: 'Review Mode', desc: 'Read-only inspection and evidence gathering' },
  { id: 'design-mode', name: 'Design Mode', desc: 'Product, UX, and interface architecture' },
  { id: 'qualification-mode', name: 'Qualification Mode', desc: 'Strict independent conformance testing' },
  { id: 'recovery-mode', name: 'Recovery Mode', desc: 'Inspect interrupted work before dispatch' },
  { id: 'custom', name: 'Custom', desc: 'User-managed instructions' }
]);

export const REGISTERED_WORKERS = Object.freeze([
  { id: 'AGR-1', name: 'AGR-1', role: 'Architecture & Verification', adapter: 'antigravity', available: true },
  { id: 'AGR-2', name: 'AGR-2', role: 'Computer Agent & Windows', adapter: 'antigravity', available: true },
  { id: 'AGR-3', name: 'AGR-3', role: 'UI Systems & Frontend', adapter: 'antigravity', available: true },
  { id: 'AGR-4', name: 'AGR-4', role: 'RCT Conformance', adapter: 'antigravity', available: true },
  { id: 'AGR-5', name: 'AGR-5', role: 'Control Center & Island', adapter: 'antigravity', available: true },
  { id: 'OCR-1', name: 'OCR-1', role: 'Visual Computer Agent', adapter: 'opencode', available: true },
  { id: 'OCR-2', name: 'OCR-2', role: 'Document Pipeline', adapter: 'opencode', available: false },
  { id: 'RCT-1', name: 'RCT-1', role: 'Independent Reviewer', adapter: 'rct', available: true },
  { id: 'RCT-2', name: 'RCT-2', role: 'Evidence Synthesizer', adapter: 'rct', available: true },
  { id: 'Codex', name: 'Codex', role: 'External Peer Reviewer', adapter: 'codex', available: false }
]);

export const SAVED_WORKFLOWS = Object.freeze([
  {
    id: 'sequential_review',
    name: 'Sequential Review Chain',
    desc: 'IFZ dispatches to implementation worker, followed by independent RCT review before acceptance.',
    workers: ['AGR-5', 'RCT-1'],
    strategy: 'sequential'
  },
  {
    id: 'parallel_fleet',
    name: 'Parallel Fleet Execution',
    desc: 'IFZ partitions task into bounded subtasks across 3 parallel workers, merged by RCT synthesizer.',
    workers: ['AGR-1', 'AGR-2', 'AGR-3', 'RCT-2'],
    strategy: 'parallel'
  },
  {
    id: 'first_verified',
    name: 'First Verified Result',
    desc: 'IFZ races two implementation workers; accepts the first independently verified evidence receipt.',
    workers: ['AGR-1', 'OCR-1'],
    strategy: 'race'
  },
  {
    id: 'bounded_delegation',
    name: 'Bounded Delegation',
    desc: 'IFZ delegates scoped orchestration to RCT lead with strict depth limit = 1.',
    workers: ['RCT-1'],
    strategy: 'delegated'
  }
]);

/**
 * Honest, reproducible conversation fixtures representing real states.
 */
export const HONEST_FIXTURES = Object.freeze({
  empty: {
    id: 'fixture-empty',
    name: 'Empty State',
    status: 'idle',
    connection: 'connected',
    workspace: 'zetro-workspace',
    title: 'New Work Session',
    subtitle: 'Send a prompt to IFZ to plan and route work',
    events: [],
    activeRun: null,
    stats: { totalEvents: 0, verifiedCount: 0, pendingCount: 0 }
  },

  loading: {
    id: 'fixture-loading',
    name: 'Loading State',
    status: 'loading',
    connection: 'connected',
    workspace: 'zetro-workspace',
    title: 'Loading Workspace Session…',
    subtitle: 'Hydrating registered workers and context package',
    events: [],
    activeRun: null,
    stats: { totalEvents: 0, verifiedCount: 0, pendingCount: 0 }
  },

  disconnected: {
    id: 'fixture-disconnected',
    name: 'Disconnected Gateway',
    status: 'disconnected',
    connection: 'offline',
    workspace: null,
    title: 'Offline Session',
    subtitle: 'Gateway unreachable · Local preview only',
    error: 'IFZ orchestration gateway is disconnected. No active workers registered. Dispatches are disabled.',
    events: [
      {
        id: 'ev-disc-1',
        type: 'user_prompt',
        source: 'User',
        target: 'IFZ',
        timestamp: '2026-10-19T02:45:00Z',
        content: 'Check worker fleet readiness'
      },
      {
        id: 'ev-disc-2',
        type: 'failure',
        source: 'IFZ',
        target: 'User',
        timestamp: '2026-10-19T02:45:01Z',
        content: 'Unable to route prompt: IFZ adapter service is not running on 127.0.0.1:4317.',
        details: 'Adapter heartbeat timeout (> 15000ms). Safe fallback active.'
      }
    ],
    activeRun: null,
    stats: { totalEvents: 2, verifiedCount: 0, pendingCount: 0 }
  },

  running: {
    id: 'fixture-running',
    name: 'Running Execution',
    status: 'running',
    connection: 'connected',
    workspace: 'zetro-workspace',
    title: 'Refactor Control Center Dock',
    subtitle: 'Run run-9102 · Active dispatch via IFZ',
    activeRun: {
      runId: 'run-9102',
      prompt: 'Refactor the control-center navigation dock to support the unified IFZ Work page',
      elapsedMs: 14200,
      status: 'running',
      currentWorker: 'AGR-3'
    },
    events: [
      {
        id: 'ev-run-1',
        type: 'user_prompt',
        source: 'User',
        target: 'IFZ',
        timestamp: '2026-10-19T03:10:00Z',
        content: 'Refactor the control-center navigation dock to support the unified IFZ Work page',
        routeMode: 'automatic'
      },
      {
        id: 'ev-run-2',
        type: 'ifz_plan',
        source: 'IFZ',
        target: 'User',
        timestamp: '2026-10-19T03:10:01Z',
        content: 'Proposed Route: Automatic selection -> AGR-3 (UI Systems) -> RCT-1 (Review)',
        strategy: 'sequential',
        workers: ['AGR-3', 'RCT-1'],
        scope: ['apps/control-center/src/dock-island.jsx', 'apps/control-center/public/dock.css']
      },
      {
        id: 'ev-run-3',
        type: 'worker_request',
        source: 'IFZ',
        target: 'AGR-3',
        timestamp: '2026-10-19T03:10:02Z',
        content: 'Envelope dispatched: Task #dock-refactor with 8-step boot package.',
        branchId: 'branch-agr-3',
        subEvents: [
          {
            id: 'ev-run-3a',
            type: 'worker_status',
            source: 'AGR-3',
            timestamp: '2026-10-19T03:10:05Z',
            content: 'Analyzing existing dock destinations and magnification hooks…'
          },
          {
            id: 'ev-run-3b',
            type: 'worker_status',
            source: 'AGR-3',
            timestamp: '2026-10-19T03:10:12Z',
            content: 'Adding Work destination with IFZ orb glyph at index 0…'
          }
        ]
      }
    ],
    stats: { totalEvents: 3, verifiedCount: 0, pendingCount: 1 }
  },

  partial_failure: {
    id: 'fixture-partial-failure',
    name: 'Partial Failure',
    status: 'error',
    connection: 'connected',
    workspace: 'zetro-workspace',
    title: 'Computer Access & Lease Verification',
    subtitle: 'Run run-8821 · Implementation succeeded, visual check failed',
    activeRun: {
      runId: 'run-8821',
      prompt: 'Verify computer agent pointer lease under Windows desktop access',
      elapsedMs: 24500,
      status: 'partial_failure'
    },
    events: [
      {
        id: 'ev-pf-1',
        type: 'user_prompt',
        source: 'User',
        target: 'IFZ',
        timestamp: '2026-10-19T02:20:00Z',
        content: 'Verify computer agent pointer lease under Windows desktop access',
        routeMode: 'manual',
        manualWorkers: ['AGR-2', 'OCR-1']
      },
      {
        id: 'ev-pf-2',
        type: 'ifz_plan',
        source: 'IFZ',
        target: 'User',
        timestamp: '2026-10-19T02:20:01Z',
        content: 'Route constrained by user to [AGR-2, OCR-1]. Execution strategy: sequential verification.',
        workers: ['AGR-2', 'OCR-1']
      },
      {
        id: 'ev-pf-3',
        type: 'worker_request',
        source: 'IFZ',
        target: 'AGR-2',
        timestamp: '2026-10-19T02:20:02Z',
        content: 'Dispatched lease test harness to AGR-2.',
        branchId: 'branch-agr-2',
        subEvents: [
          {
            id: 'ev-pf-3a',
            type: 'worker_status',
            source: 'AGR-2',
            timestamp: '2026-10-19T02:20:06Z',
            content: 'Testing focus lease and escape hotkey acquisition…'
          },
          {
            id: 'ev-pf-3b',
            type: 'worker_result',
            source: 'AGR-2',
            timestamp: '2026-10-19T02:20:10Z',
            content: 'Lease acquired and released cleanly under Esc. Native tests passed.'
          }
        ]
      },
      {
        id: 'ev-pf-4',
        type: 'handoff',
        source: 'IFZ',
        target: 'OCR-1',
        timestamp: '2026-10-19T02:20:11Z',
        content: 'IFZ transfers evidence artifact to OCR-1 for independent visual probe.'
      },
      {
        id: 'ev-pf-5',
        type: 'worker_request',
        source: 'IFZ',
        target: 'OCR-1',
        timestamp: '2026-10-19T02:20:12Z',
        content: 'OCR-1 visual verification envelope.',
        branchId: 'branch-ocr-1',
        subEvents: [
          {
            id: 'ev-pf-5a',
            type: 'worker_status',
            source: 'OCR-1',
            timestamp: '2026-10-19T02:20:15Z',
            content: 'Capturing desktop framebuffer region…'
          },
          {
            id: 'ev-pf-5b',
            type: 'failure',
            source: 'OCR-1',
            timestamp: '2026-10-19T02:20:22Z',
            content: 'Visual probe timed out. Framebuffer capture denied by OS security policy.'
          }
        ]
      },
      {
        id: 'ev-pf-6',
        type: 'verification_result',
        source: 'IFZ',
        target: 'User',
        timestamp: '2026-10-19T02:20:24Z',
        content: 'PARTIAL FAILURE: AGR-2 verified (PASS), OCR-1 visual check failed (FAIL). Task blocked.',
        verified: false
      }
    ],
    stats: { totalEvents: 6, verifiedCount: 1, pendingCount: 0 }
  },

  uncertain: {
    id: 'fixture-uncertain',
    name: 'Uncertain Delivery',
    status: 'uncertain',
    connection: 'connected',
    workspace: 'zetro-workspace',
    title: 'Sync Distributed Fleet Ledger',
    subtitle: 'Run run-7703 · Acknowledgment lost, reconciliation needed',
    activeRun: {
      runId: 'run-7703',
      prompt: 'Sync ledger state across distributed workers',
      elapsedMs: 18000,
      status: 'uncertain'
    },
    events: [
      {
        id: 'ev-unc-1',
        type: 'user_prompt',
        source: 'User',
        target: 'IFZ',
        timestamp: '2026-10-19T01:15:00Z',
        content: 'Sync ledger state across distributed workers'
      },
      {
        id: 'ev-unc-2',
        type: 'ifz_plan',
        source: 'IFZ',
        target: 'User',
        timestamp: '2026-10-19T01:15:01Z',
        content: 'Route: IFZ -> RCT-2 ledger reconciliation'
      },
      {
        id: 'ev-unc-3',
        type: 'worker_status',
        source: 'RCT-2',
        timestamp: '2026-10-19T01:15:05Z',
        content: 'Broadcasting partition checkpoint hash…'
      },
      {
        id: 'ev-unc-4',
        type: 'failure',
        source: 'IFZ',
        target: 'User',
        timestamp: '2026-10-19T01:15:18Z',
        content: 'Uncertain delivery: Peer acknowledgment timed out during network split. No blind retry permitted.',
        details: 'Per IFZ Architecture § Routing Controls: Must reconcile local workspace state before resubmission.'
      }
    ],
    stats: { totalEvents: 4, verifiedCount: 0, pendingCount: 0 }
  },

  cancelled: {
    id: 'fixture-cancelled',
    name: 'Cancelled Run',
    status: 'cancelled',
    connection: 'connected',
    workspace: 'zetro-workspace',
    title: 'Exhaustive Fleet Stress Matrix',
    subtitle: 'Run run-6604 · Cancelled by user',
    activeRun: null,
    events: [
      {
        id: 'ev-can-1',
        type: 'user_prompt',
        source: 'User',
        target: 'IFZ',
        timestamp: '2026-10-19T00:50:00Z',
        content: 'Run exhaustive end-to-end matrix on all 12 worker fleet instances'
      },
      {
        id: 'ev-can-2',
        type: 'ifz_plan',
        source: 'IFZ',
        target: 'User',
        timestamp: '2026-10-19T00:50:02Z',
        content: 'Parallel fleet strategy initiated across AGR-1 through AGR-5.'
      },
      {
        id: 'ev-can-3',
        type: 'cancellation',
        source: 'User',
        target: 'IFZ',
        timestamp: '2026-10-19T00:50:07Z',
        content: 'Stop requested by user (Esc / Stop button). IFZ propagated cancellation to all 5 active branches.',
        details: 'All worker envelopes halted. Clean rollback completed.'
      }
    ],
    stats: { totalEvents: 3, verifiedCount: 0, pendingCount: 0 }
  },

  complete: {
    id: 'fixture-complete',
    name: 'Complete & Verified',
    status: 'complete',
    connection: 'connected',
    workspace: 'zetro-workspace',
    title: 'Implement Smart Status Controller',
    subtitle: 'Run run-5501 · Verified by RCT-1',
    activeRun: null,
    events: [
      {
        id: 'ev-comp-1',
        type: 'user_prompt',
        source: 'User',
        target: 'IFZ',
        timestamp: '2026-10-18T22:30:00Z',
        content: 'Implement smart status controller contract with monotonic sequence and bounded latency',
        routeMode: 'saved_workflow',
        savedWorkflowId: 'sequential_review'
      },
      {
        id: 'ev-comp-2',
        type: 'ifz_plan',
        source: 'IFZ',
        target: 'User',
        timestamp: '2026-10-18T22:30:01Z',
        content: 'Route: Sequential Review Chain (IFZ -> AGR-5 -> RCT-1 review -> Work page).',
        strategy: 'sequential',
        workers: ['AGR-5', 'RCT-1']
      },
      {
        id: 'ev-comp-3',
        type: 'worker_request',
        source: 'IFZ',
        target: 'AGR-5',
        timestamp: '2026-10-18T22:30:02Z',
        content: 'Dispatched contract implementation to AGR-5.',
        branchId: 'branch-agr-5',
        subEvents: [
          {
            id: 'ev-comp-3a',
            type: 'worker_status',
            source: 'AGR-5',
            timestamp: '2026-10-18T22:30:05Z',
            content: 'Implementing createSmartStatus controller in packages/computer-agent…'
          },
          {
            id: 'ev-comp-3b',
            type: 'worker_result',
            source: 'AGR-5',
            timestamp: '2026-10-18T22:30:15Z',
            content: 'Controller written with monotonic sequence, privacy redaction, and 9 passing unit tests.'
          }
        ]
      },
      {
        id: 'ev-comp-4',
        type: 'handoff',
        source: 'IFZ',
        target: 'RCT-1',
        timestamp: '2026-10-18T22:30:16Z',
        content: 'IFZ transfers implementation diff and test suite to RCT-1 for independent conformance check.'
      },
      {
        id: 'ev-comp-5',
        type: 'worker_request',
        source: 'IFZ',
        target: 'RCT-1',
        timestamp: '2026-10-18T22:30:17Z',
        content: 'Independent verification assignment.',
        branchId: 'branch-rct-1',
        subEvents: [
          {
            id: 'ev-comp-5a',
            type: 'worker_status',
            source: 'RCT-1',
            timestamp: '2026-10-18T22:30:20Z',
            content: 'Auditing monotonic sequence invariants and boundary leak protection…'
          },
          {
            id: 'ev-comp-5b',
            type: 'verification_result',
            source: 'RCT-1',
            timestamp: '2026-10-18T22:30:25Z',
            content: 'VERIFIED: All 9 tests passed. Zero prompt/typed text leakage. Independent check PASSED.',
            verified: true
          }
        ]
      },
      {
        id: 'ev-comp-6',
        type: 'verification_result',
        source: 'IFZ',
        target: 'User',
        timestamp: '2026-10-18T22:30:26Z',
        content: 'Run complete: Implementation independently verified and accepted into workspace.',
        verified: true
      }
    ],
    stats: { totalEvents: 6, verifiedCount: 2, pendingCount: 0 }
  }
});

const STORAGE_KEY = 'zetro_ifz_work_draft_v1';

/**
 * Computes an honest public route preview for the current draft settings.
 *
 * Invariant: The prompt ALWAYS targets IFZ. Manual selection constrains IFZ,
 * it never bypasses IFZ.
 *
 * @param {object} draft
 * @returns {object} Public route preview metadata
 */
export function generateRoutePreview(draft = {}, options = {}) {
  const mode = draft.routeMode || ROUTE_MODES.AUTOMATIC;
  const preset = MASTER_PRESETS.find(p => p.id === draft.presetId) || MASTER_PRESETS[0];
  const workspace = options.workspace || draft.workspace || null;
  const connection = options.connection || 'unknown';

  let strategy = 'Automatic IFZ Selection';
  let assignedWorkers = [];
  let description = '';
  let chips = ['IFZ'];
  let isValid = true;
  let validationError = null;

  if (mode === ROUTE_MODES.AUTOMATIC) {
    strategy = 'Adaptive Routing';
    assignedWorkers = [];
    description = connection === 'connected'
      ? 'IFZ evaluates prompt upon submission and selects compatible execution units with independent verification.'
      : 'IFZ adaptive routing planned upon dispatch when gateway evidence is available.';
    chips = ['IFZ', 'Auto Route'];
  } else if (mode === ROUTE_MODES.MANUAL) {
    const rawWorkers = Array.isArray(draft.manualWorkers) ? draft.manualWorkers : [];
    if (rawWorkers.length === 0) {
      isValid = false;
      validationError = 'Manual route constraint requires at least one selected worker';
      strategy = 'User-Constrained Dispatch (Invalid: No workers)';
      assignedWorkers = [];
      description = 'Manual constraint is invalid: Zero workers selected. Select at least one worker or switch to Automatic.';
      chips = ['IFZ', 'No worker selected'];
    } else {
      strategy = 'User-Constrained Dispatch';
      assignedWorkers = [...rawWorkers];
      description = `Manual constraint: IFZ will route strictly to ${assignedWorkers.join(', ')}. IFZ retains orchestration authority and boundary checks.`;
      chips = ['IFZ', ...assignedWorkers];
    }
  } else if (mode === ROUTE_MODES.SAVED_WORKFLOW) {
    const wf = SAVED_WORKFLOWS.find(w => w.id === draft.savedWorkflowId) || SAVED_WORKFLOWS[0];
    strategy = wf.name;
    assignedWorkers = [...wf.workers];
    description = wf.desc;
    chips = ['IFZ', ...wf.workers];
  }

  // Never claim "Bounded to current workspace" without admitted workspace evidence!
  const authorityScope = workspace
    ? `Bounded to workspace: ${workspace}`
    : null;

  return {
    target: 'IFZ (Central Orchestrator)',
    routeMode: mode,
    modeLabel: mode === ROUTE_MODES.AUTOMATIC
      ? 'Automatic'
      : mode === ROUTE_MODES.MANUAL
        ? 'Manual Constraint'
        : 'Saved Workflow',
    preset: preset.name,
    presetId: preset.id,
    strategy,
    assignedWorkers,
    isConstrained: mode === ROUTE_MODES.MANUAL,
    isValid,
    validationError,
    description,
    chips,
    authorityScope,
    verificationRequired: true
  };
}

export const DEFAULT_UNVERIFIED_STATE = Object.freeze({
  id: 'unverified-session',
  name: null,
  status: 'unknown',
  connection: 'unknown',
  title: 'Work Session',
  subtitle: 'No session connected · Awaiting gateway evidence',
  workspace: null,
  events: [],
  activeRun: null,
  stats: { totalEvents: 0, verifiedCount: 0, pendingCount: 0 }
});

/**
 * Creates the IFZ Work Page model.
 *
 * Invariants:
 * - Default model is empty/unknown and never running, connected, accepted, verified, or populated without supplied evidence.
 * - Clock and ID generation are fully injectable for deterministic behavior.
 * - IFZ is the stable recipient across all operations.
 * - Manual route is an execution constraint on IFZ, never bypassing IFZ.
 * - Route suggestions never auto-send.
 * - Submissions are strictly dry-run until an authenticated mutation API exists.
 *
 * @param {object} [options]
 * @param {string} [options.initialFixture=null]
 * @param {object} [options.initialDraft]
 * @param {() => number} [options.clock]
 * @param {(prefix?: string) => string} [options.idGenerator]
 * @param {boolean} [options.devLab=false]
 * @returns {object} Work page controller
 */
export function createIfzWorkModel(options = {}) {
  const clock = typeof options.clock === 'function' ? options.clock : () => 1776556800000;
  let idCounter = 0;
  const idGenerator = typeof options.idGenerator === 'function'
    ? options.idGenerator
    : (prefix = 'id') => `${prefix}-${++idCounter}`;

  let listeners = new Set();
  let devLab = Boolean(options.devLab || options.showDevControls);
  let fixtureKey = options.initialFixture || null;
  let fixtureData = fixtureKey && HONEST_FIXTURES[fixtureKey]
    ? HONEST_FIXTURES[fixtureKey]
    : DEFAULT_UNVERIFIED_STATE;

  // Branch expansion state
  let expandedBranches = new Set(
    fixtureKey === 'running'
      ? ['branch-agr-3']
      : fixtureKey === 'complete'
        ? ['branch-agr-5']
        : []
  );

  // Draft state (persists across page transitions)
  let draft = {
    text: '',
    attachments: [],
    routeMode: ROUTE_MODES.AUTOMATIC,
    manualWorkers: [],
    savedWorkflowId: 'sequential_review',
    presetId: 'zetro-standard',
    ...(options.initialDraft || loadDraftFromStorage())
  };

  // Local user additions in current session (non-network dry-run)
  let localEvents = [];
  let isSimulatingOrRunning = fixtureData.status === 'running';
  let runOverrideStatus = null;

  function emitChange() {
    const snap = getSnapshot();
    listeners.forEach(fn => fn(snap));
  }

  function getCombinedEvents() {
    return [...fixtureData.events, ...localEvents];
  }

  function getSnapshot() {
    const combinedEvents = getCombinedEvents();
    const effectiveStatus = runOverrideStatus
      ? runOverrideStatus
      : (isSimulatingOrRunning ? 'running' : fixtureData.status);

    const hasConnectedGateway = fixtureData.connection === 'connected';

    return {
      fixtureKey,
      fixtureName: fixtureData.name || null,
      devLab,
      status: effectiveStatus,
      connection: fixtureData.connection,
      title: fixtureData.title,
      subtitle: fixtureData.subtitle,
      workspace: fixtureData.workspace || null,
      error: fixtureData.error || null,
      activeRun: isSimulatingOrRunning ? fixtureData.activeRun : null,
      events: combinedEvents,
      expandedBranches: Array.from(expandedBranches),
      draft: { ...draft, attachments: [...draft.attachments], manualWorkers: [...draft.manualWorkers] },
      routePreview: generateRoutePreview(draft, {
        workspace: fixtureData.workspace || null,
        connection: fixtureData.connection
      }),
      availablePresets: MASTER_PRESETS,
      availableWorkers: hasConnectedGateway ? REGISTERED_WORKERS : [],
      savedWorkflows: SAVED_WORKFLOWS,
      stats: {
        totalEvents: combinedEvents.length,
        verifiedCount: combinedEvents.filter(e => e.verified === true).length,
        pendingCount: isSimulatingOrRunning ? 1 : 0
      }
    };
  }

  function setDevLab(enabled) {
    devLab = Boolean(enabled);
    emitChange();
  }

  function setDraft(partial) {
    draft = { ...draft, ...partial };
    saveDraftToStorage(draft);
    emitChange();
  }

  function setRouteMode(mode) {
    if (Object.values(ROUTE_MODES).includes(mode)) {
      setDraft({ routeMode: mode });
    }
  }

  function toggleManualWorker(workerId) {
    const current = new Set(draft.manualWorkers);
    if (current.has(workerId)) {
      current.delete(workerId);
    } else {
      current.add(workerId);
    }
    setDraft({ manualWorkers: Array.from(current) });
  }

  function setPreset(presetId) {
    if (MASTER_PRESETS.some(p => p.id === presetId)) {
      setDraft({ presetId });
    }
  }

  function setSavedWorkflow(savedWorkflowId) {
    if (SAVED_WORKFLOWS.some(w => w.id === savedWorkflowId)) {
      setDraft({ savedWorkflowId });
    }
  }

  function addAttachment(attachment) {
    if (attachment && attachment.name) {
      setDraft({
        attachments: [...draft.attachments, { id: idGenerator('att'), ...attachment }]
      });
    }
  }

  function removeAttachment(id) {
    setDraft({
      attachments: draft.attachments.filter(a => a.id !== id)
    });
  }

  function toggleBranch(branchId) {
    if (expandedBranches.has(branchId)) {
      expandedBranches.delete(branchId);
    } else {
      expandedBranches.add(branchId);
    }
    emitChange();
  }

  function switchFixture(newFixtureKey) {
    if (HONEST_FIXTURES[newFixtureKey]) {
      fixtureKey = newFixtureKey;
      fixtureData = HONEST_FIXTURES[newFixtureKey];
      localEvents = [];
      runOverrideStatus = null;
      isSimulatingOrRunning = fixtureData.status === 'running';
      emitChange();
    } else if (newFixtureKey === 'default' || newFixtureKey === 'unknown' || newFixtureKey === null) {
      fixtureKey = null;
      fixtureData = DEFAULT_UNVERIFIED_STATE;
      localEvents = [];
      runOverrideStatus = null;
      isSimulatingOrRunning = false;
      emitChange();
    }
  }

  /**
   * Submit draft to IFZ.
   *
   * Invariant: Never sends live network calls or simulates live completion.
   * Emits user_prompt and dry-run envelope notice in preview stream.
   */
  function submitPrompt() {
    const promptText = (draft.text || '').trim();
    if (!promptText) {
      return { success: false, reason: 'Empty prompt' };
    }

    if (draft.routeMode === ROUTE_MODES.MANUAL && (!draft.manualWorkers || draft.manualWorkers.length === 0)) {
      return {
        success: false,
        reason: 'Manual route constraint requires at least one selected worker'
      };
    }

    const preview = generateRoutePreview(draft, {
      workspace: fixtureData.workspace || null,
      connection: fixtureData.connection
    });
    const nowMs = clock();
    const timestamp = new Date(nowMs).toISOString();

    const userEvent = {
      id: idGenerator('ev-local'),
      type: 'user_prompt',
      source: 'User',
      target: 'IFZ',
      timestamp,
      content: promptText,
      routeMode: draft.routeMode,
      preset: draft.presetId,
      attachments: [...draft.attachments]
    };

    const dryRunNotice = {
      id: idGenerator('ev-notice'),
      type: 'ifz_plan',
      source: 'IFZ',
      target: 'User',
      timestamp,
      content: `[DRY-RUN PREVIEW] Envelope parsed by IFZ. Target: ${preview.target} · Strategy: ${preview.strategy}`,
      details: 'Live provider transmission and dispatch are disabled in this build. Prompt was safely preserved in draft history.'
    };

    localEvents.push(userEvent, dryRunNotice);
    emitChange();

    return {
      success: true,
      dryRun: true,
      notice: 'Live dispatch disabled: Authenticated mutation API not available. Prompt captured as local dry-run intent.',
      envelope: {
        target: 'IFZ',
        prompt: promptText,
        routePreview: preview,
        timestamp
      }
    };
  }

  /**
   * Stop active run (Esc or Stop button).
   */
  function stopActiveRun() {
    if (isSimulatingOrRunning) {
      isSimulatingOrRunning = false;
      runOverrideStatus = 'cancelled';
      const nowMs = clock();
      const timestamp = new Date(nowMs).toISOString();
      localEvents.push({
        id: idGenerator('ev-stop'),
        type: 'cancellation',
        source: 'User',
        target: 'IFZ',
        timestamp,
        content: 'Execution stopped by user. Cancellation propagated to active worker branches.',
        details: 'Zero effects committed.'
      });
      emitChange();
      return true;
    }
    return false;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    getSnapshot,
    setDevLab,
    setDraft,
    setRouteMode,
    toggleManualWorker,
    setPreset,
    setSavedWorkflow,
    addAttachment,
    removeAttachment,
    toggleBranch,
    switchFixture,
    submitPrompt,
    stopActiveRun,
    subscribe
  };
}

function loadDraftFromStorage() {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
  }
  return null;
}

function saveDraftToStorage(draft) {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {}
  }
}
