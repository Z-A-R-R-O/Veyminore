/**
 * @file ifz-fixtures.js
 * Reference fixtures for the IFZ run timeline (states: empty, loading, disconnected,
 * running, partial-failure, uncertain, cancelled, complete). Data only — no rendering,
 * no network, no storage. Parent may use these for development wiring; tests consume them.
 */

const ROUTE = Object.freeze({
  steps: [
    { label: 'Plan route', target: 'ocr/worker-alpha' },
    { label: 'Dispatch probe', target: 'ocr/worker-beta' },
    { label: 'Collect results', target: 'control-center' }
  ]
});

const PROMPT_REF = Object.freeze({
  id: 'prompt-7f3a91',
  preview: 'Summarize last night’s ingestion failures and propose a safe retry order…'
});

export const IFZ_FIXTURES = Object.freeze({
  /** connected, no events yet */
  empty: Object.freeze({
    runId: 'ifz-run-empty',
    state: 'complete',
    promptRef: PROMPT_REF,
    route: ROUTE,
    events: []
  }),

  /** loading, no events yet */
  loading: Object.freeze({
    runId: 'ifz-run-loading',
    state: 'loading',
    events: []
  }),

  /** disconnected, no events */
  disconnected: Object.freeze({
    runId: 'ifz-run-disconnected',
    state: 'disconnected',
    events: []
  }),

  /** running: prompt reference, route plan, worker request, public status */
  running: Object.freeze({
    runId: 'ifz-run-running',
    state: 'running',
    promptRef: PROMPT_REF,
    route: ROUTE,
    events: [
      {
        id: 'e1',
        kind: 'prompt_reference',
        timestamp: 1760300000000,
        summary: 'User prompt reference admitted for this run.',
        producingWorker: 'coordinator',
        requestingWorker: 'coordinator'
      },
      {
        id: 'e2',
        kind: 'route_plan',
        timestamp: 1760300001000,
        summary: 'Route plan accepted: 3 steps.',
        producingWorker: 'router-1',
        requestingWorker: 'coordinator'
      },
      {
        id: 'e3',
        kind: 'worker_request',
        timestamp: 1760300002000,
        summary: 'Worker alpha asked to inspect the ingestion queue.',
        producingWorker: 'coordinator',
        requestingWorker: 'worker-alpha'
      },
      {
        id: 'e4',
        kind: 'public_status',
        timestamp: 1760300003000,
        summary: 'Public status updated: workers engaged.',
        producingWorker: 'coordinator',
        requestingWorker: 'coordinator'
      }
    ]
  }),

  /** partial failure: adds a failure event with a worker claim */
  partial_failure: Object.freeze({
    runId: 'ifz-run-partial-failure',
    state: 'partial_failure',
    promptRef: PROMPT_REF,
    route: ROUTE,
    events: [
      {
        id: 'e1',
        kind: 'worker_request',
        timestamp: 1760300100000,
        summary: 'Worker beta asked to fetch shard manifests.',
        producingWorker: 'coordinator',
        requestingWorker: 'worker-beta'
      },
      {
        id: 'e2',
        kind: 'failure',
        timestamp: 1760300105000,
        summary: 'Shard manifest fetch failed for 2 of 5 shards; other steps succeeded.',
        producingWorker: 'worker-beta',
        requestingWorker: 'coordinator',
        claim: {
          workerId: 'worker-beta',
          summary: 'Retried twice; remaining failures persist against read-only shard store.'
        },
        delegated: {
          summary: 'Delegated manifest checks to worker-delta.',
          steps: ['List shard ids', 'Read manifest headers'],
          toolOutput: 'shard-3: timeout after 2 attempts'
        }
      },
      {
        id: 'e3',
        kind: 'result',
        timestamp: 1760300110000,
        summary: 'Partial result delivered: 3 of 5 shards verified.',
        producingWorker: 'worker-beta',
        requestingWorker: 'coordinator'
      }
    ]
  }),

  /** uncertain delivery */
  uncertain: Object.freeze({
    runId: 'ifz-run-uncertain',
    state: 'uncertain',
    events: [
      {
        id: 'e1',
        kind: 'result',
        timestamp: 1760300200000,
        summary: 'Result handed to the delivery bridge.',
        producingWorker: 'worker-gamma',
        requestingWorker: 'coordinator'
      },
      {
        id: 'e2',
        kind: 'uncertain_delivery',
        timestamp: 1760300204000,
        summary: 'Delivery acknowledgement not received within the bounded window.',
        producingWorker: 'delivery-bridge',
        requestingWorker: 'coordinator'
      }
    ]
  }),

  /** cancelled */
  cancelled: Object.freeze({
    runId: 'ifz-run-cancelled',
    state: 'cancelled',
    events: [
      {
        id: 'e1',
        kind: 'worker_request',
        timestamp: 1760300300000,
        summary: 'Worker delta asked to widen the scan.',
        producingWorker: 'coordinator',
        requestingWorker: 'worker-delta'
      },
      {
        id: 'e2',
        kind: 'cancellation',
        timestamp: 1760300306000,
        summary: 'Run cancelled at operator request; pending work stopped.',
        producingWorker: 'coordinator',
        requestingWorker: 'operator'
      }
    ]
  }),

  /** complete: all identities, distinct claim vs verification, parallel branch, collapsed delegation */
  complete: Object.freeze({
    runId: 'ifz-run-complete',
    state: 'complete',
    promptRef: PROMPT_REF,
    route: ROUTE,
    events: [
      {
        id: 'e1',
        kind: 'prompt_reference',
        timestamp: 1760300400000,
        summary: 'User prompt reference admitted for this run.',
        producingWorker: 'coordinator',
        requestingWorker: 'coordinator'
      },
      {
        id: 'e2',
        kind: 'route_plan',
        timestamp: 1760300401000,
        summary: 'Route plan accepted: 3 steps.',
        producingWorker: 'router-1',
        requestingWorker: 'coordinator'
      },
      {
        id: 'e3',
        kind: 'worker_request',
        timestamp: 1760300402000,
        summary: 'Worker alpha asked to summarize queue depth.',
        producingWorker: 'coordinator',
        requestingWorker: 'worker-alpha'
      },
      {
        id: 'e4',
        kind: 'question',
        timestamp: 1760300403000,
        summary: 'Clarifying question raised about retention window.',
        producingWorker: 'worker-alpha',
        requestingWorker: 'coordinator'
      },
      {
        id: 'e5',
        kind: 'result',
        timestamp: 1760300410000,
        summary: 'Queue depth summary delivered for the bounded window.',
        producingWorker: 'worker-alpha',
        requestingWorker: 'coordinator',
        claim: {
          workerId: 'worker-alpha',
          summary: 'All sampled windows fit the requested retention range.'
        },
        delegated: {
          summary: 'Delegated sampling to worker-epsilon.',
          steps: ['Sample window', 'Aggregate counts'],
          toolOutput: 'windows=8 samples=240'
        }
      },
      {
        id: 'e6',
        kind: 'verification',
        timestamp: 1760300415000,
        summary: 'Independent check of the delivered summary.',
        producingWorker: 'verifier-1',
        requestingWorker: 'coordinator',
        verification: {
          verifier: 'verifier-1',
          status: 'passed',
          summary: 'Recomputed aggregate matches the delivered summary.'
        }
      },
      {
        id: 'e7',
        kind: 'handoff',
        timestamp: 1760300420000,
        summary: 'Result handed to the control-center display.',
        producingWorker: 'coordinator',
        requestingWorker: 'control-center'
      },
      {
        id: 'e8',
        kind: 'public_status',
        timestamp: 1760300404000,
        summary: 'Public status updated: verification pending.',
        producingWorker: 'coordinator',
        requestingWorker: 'coordinator',
        branchId: 'probe-1'
      },
      {
        id: 'e9',
        kind: 'result',
        timestamp: 1760300412000,
        summary: 'Parallel probe result: no queue regressions detected.',
        producingWorker: 'worker-theta',
        requestingWorker: 'coordinator',
        branchId: 'probe-1',
        claim: {
          workerId: 'worker-theta',
          summary: 'Probe covered all three sample windows.'
        }
      }
    ]
  })
});

export const IFZ_FIXTURE_NAMES = Object.freeze([
  'empty',
  'loading',
  'disconnected',
  'running',
  'partial_failure',
  'uncertain',
  'cancelled',
  'complete'
]);
