/**
 * @file compatibility/bridge.js
 * Compatibility adapter between antigravity-bridge (MCP and events journal) and ZETRO Protocol v1.
 */

import {
  SCHEMA_VERSIONS,
  EventType,
  ActorRole,
  WorkerReportedState
} from '../constants.js';
import { validateEvent } from '../validators/event.js';

export const BridgeEventTypes = Object.freeze({
  CREATED: 'created',
  INTENT_TO_SUBMIT: 'intent-to-submit',
  SUBMITTED: 'submitted',
  HOOK_ERROR: 'hook-error',
  HOOK_IDLE: 'hook-idle',
  WORKER_REPORTED: 'worker-reported',
  VERIFIED: 'verified',
  UNKNOWN_TRANSITION: 'unknown-transition'
});

/**
 * Maps a bridge MCP submit_receipt call into a worker claim representation.
 * Explicitly separates the worker's asserted status from independent verification.
 *
 * @param {object} mcpSubmission - MCP submit_receipt parameters
 * @returns {object} Normalized worker claim and receipt submission data
 */
export function bridgeMcpReceiptToWorkerClaim(mcpSubmission) {
  const receipt = mcpSubmission.receipt || {};
  const status = receipt.status === 'success' ? WorkerReportedState.SUBMITTED : WorkerReportedState.FAILED;

  return {
    taskId: mcpSubmission.taskId,
    agentId: receipt.agent,
    capabilityDigest: mcpSubmission.capabilityDigest,
    reportedState: status,
    paths: Array.isArray(receipt.paths) ? [...receipt.paths] : [],
    summary: receipt.summary || '',
    verified: false // Crucial: MCP submission alone is unverified!
  };
}

/**
 * Converts a bridge journal event into a Protocol Event.
 * @param {object} bridgeEvent - Bridge journal event line
 * @returns {object} Validated Protocol Event
 */
export function bridgeEventToProtocolEvent(bridgeEvent) {
  let mappedType;
  let actorRole = ActorRole.COORDINATOR;

  switch (bridgeEvent.type) {
    case BridgeEventTypes.CREATED:
      mappedType = EventType.TASK_CREATED;
      actorRole = ActorRole.COORDINATOR;
      break;
    case BridgeEventTypes.INTENT_TO_SUBMIT:
      mappedType = EventType.INTENT_TO_SUBMIT;
      actorRole = ActorRole.COORDINATOR;
      break;
    case BridgeEventTypes.SUBMITTED:
      mappedType = EventType.SUBMITTED;
      actorRole = ActorRole.COORDINATOR;
      break;
    case BridgeEventTypes.WORKER_REPORTED:
      mappedType = EventType.WORKER_REPORTED;
      actorRole = ActorRole.WORKER;
      break;
    case BridgeEventTypes.VERIFIED:
      mappedType = EventType.VERIFICATION_COMPLETED;
      actorRole = ActorRole.VERIFIER;
      break;
    case BridgeEventTypes.HOOK_ERROR:
      mappedType = EventType.TASK_FAILED;
      actorRole = ActorRole.DAEMON;
      break;
    case BridgeEventTypes.HOOK_IDLE:
      mappedType = EventType.WORKER_STARTED;
      actorRole = ActorRole.DAEMON;
      break;
    case BridgeEventTypes.UNKNOWN_TRANSITION:
    default:
      mappedType = EventType.UNCERTAINTY_RECORDED;
      actorRole = ActorRole.COORDINATOR;
      break;
  }

  const raw = {
    schemaVersion: SCHEMA_VERSIONS.EVENT,
    eventId: bridgeEvent.eventId || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskId: bridgeEvent.taskId,
    attemptId: bridgeEvent.attempt ?? 1,
    type: mappedType,
    timestamp: bridgeEvent.timestamp || Date.now(),
    actor: {
      principalId: bridgeEvent.agent || 'bridge-coordinator',
      role: actorRole
    },
    payload: {
      originalBridgeType: bridgeEvent.type,
      status: bridgeEvent.status,
      details: bridgeEvent.details ?? {}
    }
  };

  return validateEvent(raw, { throwOnError: true });
}

/**
 * Converts a Protocol Event to a Bridge journal event.
 * @param {object} protocolEvent - Protocol Event
 * @returns {object} Bridge journal event object
 */
export function protocolEventToBridgeEvent(protocolEvent) {
  const valid = validateEvent(protocolEvent, { throwOnError: true });

  let bridgeType;
  switch (valid.type) {
    case EventType.TASK_CREATED:
      bridgeType = BridgeEventTypes.CREATED;
      break;
    case EventType.INTENT_TO_SUBMIT:
      bridgeType = BridgeEventTypes.INTENT_TO_SUBMIT;
      break;
    case EventType.SUBMITTED:
      bridgeType = BridgeEventTypes.SUBMITTED;
      break;
    case EventType.WORKER_REPORTED:
      bridgeType = BridgeEventTypes.WORKER_REPORTED;
      break;
    case EventType.VERIFICATION_COMPLETED:
      bridgeType = BridgeEventTypes.VERIFIED;
      break;
    case EventType.TASK_FAILED:
      bridgeType = BridgeEventTypes.HOOK_ERROR;
      break;
    case EventType.UNCERTAINTY_RECORDED:
    default:
      bridgeType = BridgeEventTypes.UNKNOWN_TRANSITION;
      break;
  }

  return {
    taskId: valid.taskId,
    agent: valid.actor.principalId,
    type: bridgeType,
    attempt: valid.attemptId ?? 1,
    timestamp: valid.timestamp,
    status: valid.payload?.status,
    details: valid.payload?.details ?? {}
  };
}
