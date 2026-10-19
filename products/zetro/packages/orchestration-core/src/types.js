/**
 * @typedef {Object} Budget
 * @property {number} maxContextChars
 * @property {number} maxReplyChars
 */

/**
 * @typedef {Object} TaskEnvelope
 * @property {string} id
 * @property {string} agent
 * @property {string} objective
 * @property {string[]} contextRefs
 * @property {string[]} allowedPaths
 * @property {string} acceptance
 * @property {string} verification
 * @property {number} deadlineMs
 * @property {Budget} budget
 * @property {string} [workspaceRoot]
 * @property {string} [sourceHash]
 * @property {string} [assignmentDigest]
 */

/**
 * @typedef {Object} TaskReceipt
 * @property {string} id
 * @property {string} agent
 * @property {string} state
 * @property {string[]} changedFiles
 * @property {string[]} checks
 * @property {string[]} evidenceRefs
 * @property {string} summary
 * @property {string} uncertainty
 */

/**
 * @typedef {Object} AttemptRecord
 * @property {string} attemptId
 * @property {string} taskId
 * @property {number} attemptNumber
 * @property {string} intent
 * @property {string} state
 * @property {number} startedAt
 * @property {number|null} finishedAt
 * @property {string} [uncertainty]
 * @property {string} [error]
 * @property {string} [callIntentData]
 */

/**
 * @typedef {Object} EventRecord
 * @property {number} id
 * @property {string} taskId
 * @property {string|null} attemptId
 * @property {string} eventType
 * @property {Object} payload
 * @property {number} timestamp
 */

/**
 * @typedef {Object} ArtifactRecord
 * @property {number} id
 * @property {string} taskId
 * @property {string|null} attemptId
 * @property {string} artifactType
 * @property {string} uri
 * @property {string|null} hash
 * @property {Object} metadata
 * @property {number} createdAt
 */

export const Bounds = Object.freeze({
  MAX_ID_CHARS: 256,
  MAX_STRING_CHARS: 4096,
  MAX_OBJECTIVE_CHARS: 65536,
  MAX_ARRAY_ITEMS: 1000,
  MIN_DEADLINE_MS: 1,
  MAX_DEADLINE_MS: 2147483647, // 2^31 - 1, max 32-bit signed integer (Node setTimeout limit)
  MIN_BUDGET_CHARS: 1,
  MAX_BUDGET_CHARS: 100_000_000, // 100M chars
});

export const States = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUBMITTED: 'SUBMITTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN'
});

export const TERMINAL_STATES = Object.freeze(new Set([
  States.COMPLETED,
  States.SUBMITTED,
  States.FAILED,
  States.UNKNOWN,
  States.CANCELLED,
]));

export const Intents = Object.freeze({
  NONE: 'NONE',
  DISPATCH_CALL: 'DISPATCH_CALL',
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  RECONCILED_UNKNOWN: 'RECONCILED_UNKNOWN',
  APPROVE_PATCH: 'APPROVE_PATCH',
  REJECT_PATCH: 'REJECT_PATCH',
  DISCARD_PATCH: 'DISCARD_PATCH'
});

export const ReviewStates = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  DISCARDED: 'DISCARDED'
});

export const TERMINAL_REVIEW_STATES = Object.freeze(new Set([
  ReviewStates.APPROVED,
  ReviewStates.REJECTED,
  ReviewStates.DISCARDED
]));
