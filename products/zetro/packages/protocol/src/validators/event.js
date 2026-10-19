/**
 * @file validators/event.js
 * Runtime validator for Event (zetro.protocol.event.v1).
 */

import {
  SCHEMA_VERSIONS,
  EventType,
  ActorRole
} from '../constants.js';
import { handleValidationFailure } from '../errors.js';

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const HEX_SHA256_REGEX = /^[a-f0-9]{64}$/i;

function isNonEmptyObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Validates an Event object against zetro.protocol.event.v1.
 * @param {any} input
 * @param {{ throwOnError?: boolean }} [options]
 * @returns {object} Normalized Event object
 */
export function validateEvent(input, { throwOnError = true } = {}) {
  const errors = [];
  const schema = SCHEMA_VERSIONS.EVENT;

  if (!isNonEmptyObject(input)) {
    return handleValidationFailure(['Event must be a non-null object'], schema, throwOnError);
  }

  // schemaVersion
  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}', got '${input.schemaVersion}'`);
  }

  // eventId
  if (typeof input.eventId !== 'string' || !ID_REGEX.test(input.eventId)) {
    errors.push('eventId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // taskId
  if (typeof input.taskId !== 'string' || !ID_REGEX.test(input.taskId)) {
    errors.push('taskId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // attemptId (optional)
  let cleanAttemptId = undefined;
  if (input.attemptId !== undefined) {
    if (typeof input.attemptId === 'number') {
      if (!Number.isSafeInteger(input.attemptId) || input.attemptId < 1) {
        errors.push('attemptId (numeric) must be a positive safe integer');
      } else {
        cleanAttemptId = input.attemptId;
      }
    } else if (typeof input.attemptId === 'string') {
      if (!ID_REGEX.test(input.attemptId)) {
        errors.push('attemptId (string) must match ^[a-zA-Z0-9_-]{1,64}$');
      } else {
        cleanAttemptId = input.attemptId;
      }
    } else {
      errors.push('attemptId if provided must be a positive integer or identifier string');
    }
  }

  // type
  const validEventTypes = Object.values(EventType);
  if (!validEventTypes.includes(input.type)) {
    errors.push(`type must be one of: ${validEventTypes.join(', ')}, got '${input.type}'`);
  }

  // timestamp
  let cleanTimestamp = Date.now();
  if (input.timestamp !== undefined) {
    if (typeof input.timestamp === 'number') {
      if (!Number.isFinite(input.timestamp) || input.timestamp <= 0) {
        errors.push('timestamp (number) must be a positive finite number');
      } else {
        cleanTimestamp = input.timestamp;
      }
    } else if (typeof input.timestamp === 'string') {
      if (isNaN(Date.parse(input.timestamp))) {
        errors.push('timestamp (string) must be a valid parseable ISO date string');
      } else {
        cleanTimestamp = input.timestamp;
      }
    } else {
      errors.push('timestamp must be a timestamp number or string');
    }
  }

  // actor
  const cleanActor = {
    principalId: '',
    role: ActorRole.WORKER
  };

  if (!isNonEmptyObject(input.actor)) {
    errors.push('actor must be an object with principalId and role');
  } else {
    if (typeof input.actor.principalId !== 'string' || input.actor.principalId.length < 1 || input.actor.principalId.length > 128) {
      errors.push('actor.principalId must be a string between 1 and 128 characters');
    } else {
      cleanActor.principalId = input.actor.principalId;
    }

    const validRoles = Object.values(ActorRole);
    if (!validRoles.includes(input.actor.role)) {
      errors.push(`actor.role must be one of: ${validRoles.join(', ')}`);
    } else {
      cleanActor.role = input.actor.role;
    }
  }

  // payload
  if (!isNonEmptyObject(input.payload)) {
    errors.push('payload must be a non-null object');
  }

  // eventDigest (optional)
  let cleanDigest = undefined;
  if (input.eventDigest !== undefined) {
    if (typeof input.eventDigest !== 'string' || !HEX_SHA256_REGEX.test(input.eventDigest)) {
      errors.push('eventDigest if provided must be a 64-character hex SHA-256 string');
    } else {
      cleanDigest = input.eventDigest.toLowerCase();
    }
  }

  if (errors.length > 0) {
    return handleValidationFailure(errors, schema, throwOnError);
  }

  return {
    schemaVersion: schema,
    eventId: input.eventId,
    taskId: input.taskId,
    ...(cleanAttemptId !== undefined ? { attemptId: cleanAttemptId } : {}),
    type: input.type,
    timestamp: cleanTimestamp,
    actor: cleanActor,
    payload: { ...input.payload },
    ...(cleanDigest ? { eventDigest: cleanDigest } : {})
  };
}

/**
 * Type guard for Event.
 * @param {any} value
 * @returns {boolean}
 */
export function isEvent(value) {
  try {
    const res = validateEvent(value, { throwOnError: false });
    return res && res.ok !== false;
  } catch {
    return false;
  }
}
