/**
 * @file constants.js
 * Versioned schema identifiers, state enums, action types, and bounds for ZETRO Protocol v1.
 */

export const SCHEMA_VERSIONS = Object.freeze({
  ASSIGNMENT: 'zetro.protocol.assignment.v1',
  TASK_RESULT: 'zetro.protocol.task_result.v1',
  EVENT: 'zetro.protocol.event.v1',
  ACTION_REQUEST: 'zetro.protocol.action_request.v1',
  ACTION_RESULT: 'zetro.protocol.action_result.v1',
  GRANT: 'zetro.protocol.grant.v1',
  EVIDENCE_RECEIPT: 'zetro.protocol.evidence_receipt.v1',
  WORKSPACE_ADMISSION: 'zetro.protocol.workspace_admission.v1',
  COMPUTER_ACTION_REQUEST: 'zetro.protocol.computer_request.v1',
  COMPUTER_ACTION_RESULT: 'zetro.protocol.computer_result.v1'
});

export const ComputerOperation = Object.freeze({
  // Observation operations (qualified)
  ENUMERATE: 'enumerate',
  INSPECT: 'inspect',
  CAPTURE: 'capture',
  // Proposed input actions (disabled pending native qualification)
  MOVE: 'move',
  CLICK: 'click',
  SCROLL: 'scroll',
  KEY: 'key',
  TEXT: 'text'
});

export const ComputerCapability = Object.freeze({
  OBSERVE: 'observe',
  INPUT: 'input'
});

export const QUALIFIED_COMPUTER_OPERATIONS = Object.freeze([
  ComputerOperation.ENUMERATE,
  ComputerOperation.INSPECT,
  ComputerOperation.CAPTURE
]);

export const UNQUALIFIED_INPUT_OPERATIONS = Object.freeze([
  ComputerOperation.MOVE,
  ComputerOperation.CLICK,
  ComputerOperation.SCROLL,
  ComputerOperation.KEY,
  ComputerOperation.TEXT
]);

export const ComputerActionStatus = Object.freeze({
  SUCCESS: 'success',
  DENIED: 'denied',
  FAILED: 'failed',
  DISABLED: 'disabled'
});

export const COMPUTER_PAYLOAD_BOUNDS = Object.freeze({
  maxPayloadBytes: Object.freeze({ min: 1, max: 1048576 }),
  maxTargets: Object.freeze({ min: 1, max: 256 })
});

export const TaskState = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  SUBMITTED: 'submitted',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown'
});

export const VerificationStatus = Object.freeze({
  NOT_REQUESTED: 'not_requested',
  IN_PROGRESS: 'in_progress',
  PASSED: 'passed',
  FAILED: 'failed',
  INCONCLUSIVE: 'inconclusive'
});

export const WorkerReportedState = Object.freeze({
  SUBMITTED: 'submitted',
  FAILED: 'failed',
  ABORTED: 'aborted'
});

export const ActionType = Object.freeze({
  FILE_READ: 'file_read',
  FILE_WRITE: 'file_write',
  FILE_CREATE: 'file_create',
  FILE_DELETE: 'file_delete',
  SHELL_EXEC: 'shell_exec',
  DESKTOP_INPUT: 'desktop_input',
  SCREEN_CAPTURE: 'screen_capture',
  BROWSER_NAVIGATE: 'browser_navigate',
  BROWSER_ACTION: 'browser_action',
  PROVIDER_CALL: 'provider_call'
});

export const ActionStatus = Object.freeze({
  SUCCESS: 'success',
  FAILED: 'failed',
  DENIED: 'denied',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown'
});

export const EventType = Object.freeze({
  TASK_CREATED: 'task_created',
  INTENT_TO_SUBMIT: 'intent_to_submit',
  SUBMITTED: 'submitted',
  WORKER_STARTED: 'worker_started',
  TOOL_CALL: 'tool_call',
  WORKER_REPORTED: 'worker_reported',
  VERIFICATION_STARTED: 'verification_started',
  VERIFICATION_COMPLETED: 'verification_completed',
  TASK_COMPLETED: 'task_completed',
  TASK_FAILED: 'task_failed',
  TASK_CANCELLED: 'task_cancelled',
  UNCERTAINTY_RECORDED: 'uncertainty_recorded',
  ACTION_REQUESTED: 'action_requested',
  GRANT_ISSUED: 'grant_issued',
  GRANT_REVOKED: 'grant_revoked',
  ACTION_EXECUTED: 'action_executed'
});

export const ActorRole = Object.freeze({
  WORKER: 'worker',
  COORDINATOR: 'coordinator',
  VERIFIER: 'verifier',
  USER: 'user',
  DAEMON: 'daemon'
});

export const CheckType = Object.freeze({
  EQUALS: 'equals',
  CONTAINS: 'contains',
  COMMAND: 'command'
});

export const DataClassification = Object.freeze({
  PUBLIC: 'public',
  INTERNAL: 'internal',
  SENSITIVE: 'sensitive'
});

export const DEFAULT_BUDGET = Object.freeze({
  maxTurns: 6,
  maxInputTokens: 6000,
  maxOutputTokens: 3000,
  maxPromptChars: 16000,
  maxReadBytes: 8192,
  maxWriteBytes: 8192,
  maxWallMs: 30000,
  maxContextChars: 50000,
  maxReplyChars: 10000
});

export const BUDGET_BOUNDS = Object.freeze({
  maxTurns: { min: 1, max: 50 },
  maxInputTokens: { min: 100, max: 200000 },
  maxOutputTokens: { min: 100, max: 100000 },
  maxPromptChars: { min: 500, max: 200000 },
  maxReadBytes: { min: 1, max: 1048576 },
  maxWriteBytes: { min: 1, max: 1048576 },
  maxWallMs: { min: 100, max: 600000 },
  maxContextChars: { min: 100, max: 500000 },
  maxReplyChars: { min: 100, max: 500000 }
});
