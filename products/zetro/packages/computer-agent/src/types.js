/**
 * @file types.js
 * Domain types, schema versions, action constants, and error codes for @zetro/computer-agent.
 */

export const AGENT_SCHEMA_VERSION = 'zetro.computer_agent.v1';
export const ACTION_SCHEMA_VERSION = 'zetro.computer_action.v1';
export const EVIDENCE_SCHEMA_VERSION = 'zetro.computer_evidence.v1';

export const AgentStatus = Object.freeze({
  COMPLETED: 'completed',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  UNCERTAIN: 'uncertain'
});

export const SupportedActionTypes = Object.freeze([
  'resolve_app',
  'launch_app',
  'focus_window',
  'type_text',
  'click_element',
  'press_key',
  'scroll_target',
  'wait_observe',
  'verify_state'
]);

export const AgentErrorCode = Object.freeze({
  UNSUPPORTED_APPLICATION: 'unsupported_application',
  APPLICATION_NOT_FOUND: 'application_not_found',
  APPLICATION_AMBIGUOUS: 'application_ambiguous',
  LAUNCH_FAILED: 'launch_failed',
  MALICIOUS_ARGUMENTS: 'malicious_arguments',
  TARGET_NOT_FOUND: 'target_not_found',
  TARGET_MISMATCH: 'target_mismatch',
  TARGET_REPLACED: 'target_replaced',
  TARGET_MINIMIZED: 'target_minimized',
  TARGET_NOT_VISIBLE: 'target_not_visible',
  STALE_OBSERVATION: 'stale_observation',
  UNSUPPORTED_CAPTURE: 'unsupported_capture',
  PLANNER_FAILED: 'planner_failed',
  PLANNER_BLOCKED: 'planner_blocked',
  AUTHORITY_DENIED: 'authority_denied',
  AUTHORITY_REVOKED: 'authority_revoked',
  AUTHORITY_EXPIRED: 'authority_expired',
  EXECUTOR_FAILED: 'executor_failed',
  VERIFICATION_FAILED: 'verification_failed',
  HUMAN_TAKEOVER: 'human_takeover',
  BUDGET_EXCEEDED: 'budget_exceeded',
  UNCERTAIN_EFFECT: 'uncertain_effect',
  DISCONNECTED: 'disconnected',
  INVALID_ADMISSION: 'invalid_admission'
});

export const DEFAULT_AGENT_BUDGETS = Object.freeze({
  maxSteps: 12,
  maxDurationMs: 60000,
  maxRetriesPerStep: 2,
  maxObservations: 24,
  maxTokens: 4096,
  maxActionPayloadBytes: 16384,
  observationMaxAgeMs: 5000
});

export class ComputerAgentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ComputerAgentError';
    this.code = code;
    this.details = details;
  }
}
