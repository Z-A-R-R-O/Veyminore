/**
 * @file validators/computer-action-request.js
 * Runtime validator and factory for native ComputerActionRequest (zetro.protocol.computer_request.v1).
 * Binds exact HWND, process start, PID, process name, display, DPI, generation, sequence, and expiry identity.
 */

import { randomUUID } from 'node:crypto';
import {
  SCHEMA_VERSIONS,
  ComputerOperation,
  COMPUTER_PAYLOAD_BOUNDS
} from '../constants.js';
import { handleValidationFailure } from '../errors.js';
import { computeComputerActionRequestDigest } from '../digest.js';

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const HEX_SHA256_REGEX = /^[a-f0-9]{64}$/i;

function isNonEmptyObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function parseTimestamp(val, label, errors) {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) {
      errors.push(`${label} must be a positive finite epoch ms number`);
      return null;
    }
    return val;
  }
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    if (isNaN(parsed)) {
      errors.push(`${label} must be a valid parseable ISO date string`);
      return null;
    }
    return parsed;
  }
  errors.push(`${label} must be a timestamp number or string`);
  return null;
}

/**
 * Deeply and recursively freezes an object.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

/**
 * Validates a ComputerActionRequest object against zetro.protocol.computer_request.v1.
 *
 * @param {any} input
 * @param {{ throwOnError?: boolean, verifyDigest?: boolean }} [options]
 * @returns {object} Validated, normalized, deeply frozen ComputerActionRequest object
 */
export function validateComputerActionRequest(input, { throwOnError = true, verifyDigest = false } = {}) {
  const errors = [];
  const schema = SCHEMA_VERSIONS.COMPUTER_ACTION_REQUEST;

  if (!isNonEmptyObject(input)) {
    return handleValidationFailure(['ComputerActionRequest must be a non-null object'], schema, throwOnError);
  }

  // 1. schemaVersion
  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}', got '${input.schemaVersion}'`);
  }

  // 2. requestId
  if (typeof input.requestId !== 'string' || !ID_REGEX.test(input.requestId)) {
    errors.push('requestId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // 3. taskId
  if (typeof input.taskId !== 'string' || !ID_REGEX.test(input.taskId)) {
    errors.push('taskId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // 4. attemptId
  if (typeof input.attemptId === 'number') {
    if (!Number.isSafeInteger(input.attemptId) || input.attemptId < 1) {
      errors.push('attemptId (numeric) must be a positive safe integer');
    }
  } else if (typeof input.attemptId === 'string') {
    if (!ID_REGEX.test(input.attemptId)) {
      errors.push('attemptId (string) must match ^[a-zA-Z0-9_-]{1,64}$');
    }
  } else {
    errors.push('attemptId is required and must be a positive integer or identifier string');
  }

  // 5. sessionId
  if (typeof input.sessionId !== 'string' || !ID_REGEX.test(input.sessionId)) {
    errors.push('sessionId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // 6. principalId
  if (typeof input.principalId !== 'string' || input.principalId.length < 1 || input.principalId.length > 128) {
    errors.push('principalId must be a string between 1 and 128 characters');
  }

  // 7. operation
  const validOperations = Object.values(ComputerOperation);
  if (!validOperations.includes(input.operation)) {
    errors.push(`operation must be one of: ${validOperations.join(', ')}, got '${input.operation}'`);
  }

  // 8. target identity binding
  let cleanTarget = {};
  if (!isNonEmptyObject(input.target)) {
    errors.push('target must be a non-null object');
  } else {
    cleanTarget = { ...input.target };
    const isEnumerate = input.operation === ComputerOperation.ENUMERATE;

    // displayId: required for all operations
    if (cleanTarget.displayId === undefined || cleanTarget.displayId === null) {
      errors.push('target.displayId is required for native Computer operations');
    } else if (typeof cleanTarget.displayId !== 'number' && typeof cleanTarget.displayId !== 'string') {
      errors.push('target.displayId must be a number or string');
    }

    if (!isEnumerate) {
      // hwnd: positive safe integer
      if (typeof cleanTarget.hwnd !== 'number' || !Number.isSafeInteger(cleanTarget.hwnd) || cleanTarget.hwnd <= 0) {
        errors.push('target.hwnd must be a positive safe integer HWND');
      }

      // processId: positive integer PID
      if (typeof cleanTarget.processId !== 'number' || !Number.isSafeInteger(cleanTarget.processId) || cleanTarget.processId <= 0) {
        errors.push('target.processId must be a positive safe integer PID');
      }

      // processStartTimestamp: positive epoch ms
      if (typeof cleanTarget.processStartTimestamp !== 'number' || !Number.isSafeInteger(cleanTarget.processStartTimestamp) || cleanTarget.processStartTimestamp <= 0) {
        errors.push('target.processStartTimestamp must be a positive safe integer epoch ms timestamp');
      }

      // processName: non-empty string
      if (typeof cleanTarget.processName !== 'string' || cleanTarget.processName.trim().length === 0) {
        errors.push('target.processName must be a non-empty string');
      }

      // dpi: positive integer
      if (typeof cleanTarget.dpi !== 'number' || !Number.isSafeInteger(cleanTarget.dpi) || cleanTarget.dpi < 48 || cleanTarget.dpi > 960) {
        errors.push('target.dpi must be a positive safe integer between 48 and 960');
      }

      // generation: non-empty string or positive integer
      if (typeof cleanTarget.generation === 'number') {
        if (!Number.isSafeInteger(cleanTarget.generation) || cleanTarget.generation < 1) {
          errors.push('target.generation (number) must be a positive integer');
        }
      } else if (typeof cleanTarget.generation === 'string') {
        if (cleanTarget.generation.trim().length === 0) {
          errors.push('target.generation (string) cannot be empty');
        }
      } else {
        errors.push('target.generation is required and must be a string or positive integer');
      }
    } else {
      // For enumerate, dpi is optional
      if (cleanTarget.dpi !== undefined) {
        if (typeof cleanTarget.dpi !== 'number' || !Number.isSafeInteger(cleanTarget.dpi) || cleanTarget.dpi < 48 || cleanTarget.dpi > 960) {
          errors.push('target.dpi if provided must be a positive safe integer between 48 and 960');
        }
      }
    }
  }

  // 9. parameters
  let cleanParameters = {};
  if (!isNonEmptyObject(input.parameters)) {
    errors.push('parameters must be a non-null object');
  } else {
    cleanParameters = { ...input.parameters };

    if (input.operation === ComputerOperation.MOVE) {
      if (typeof cleanParameters.x !== 'number' || !Number.isFinite(cleanParameters.x)) {
        errors.push('parameters.x must be a finite number for move action');
      }
      if (typeof cleanParameters.y !== 'number' || !Number.isFinite(cleanParameters.y)) {
        errors.push('parameters.y must be a finite number for move action');
      }
    } else if (input.operation === ComputerOperation.CLICK) {
      const validButtons = ['left', 'right', 'middle'];
      if (!validButtons.includes(cleanParameters.button)) {
        errors.push(`parameters.button must be one of: ${validButtons.join(', ')}`);
      }
    } else if (input.operation === ComputerOperation.SCROLL) {
      if (typeof cleanParameters.deltaX !== 'number' || !Number.isFinite(cleanParameters.deltaX)) {
        errors.push('parameters.deltaX must be a finite number for scroll action');
      }
      if (typeof cleanParameters.deltaY !== 'number' || !Number.isFinite(cleanParameters.deltaY)) {
        errors.push('parameters.deltaY must be a finite number for scroll action');
      }
    } else if (input.operation === ComputerOperation.KEY) {
      if (typeof cleanParameters.key !== 'string' || cleanParameters.key.length === 0) {
        errors.push('parameters.key must be a non-empty string');
      }
    } else if (input.operation === ComputerOperation.TEXT) {
      if (typeof cleanParameters.text !== 'string') {
        errors.push('parameters.text must be a string');
      }
    }
  }

  // 10. sequence (strictly monotonic per session/task >= 1)
  if (typeof input.sequence !== 'number' || !Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    errors.push('sequence must be a positive safe integer (>= 1)');
  }

  // 11. requestedAt & expiresAt
  const requestedAtMs = parseTimestamp(input.requestedAt, 'requestedAt', errors);
  const expiresAtMs = parseTimestamp(input.expiresAt, 'expiresAt', errors);

  if (requestedAtMs !== null && expiresAtMs !== null) {
    if (expiresAtMs <= requestedAtMs) {
      errors.push(`expiresAt (${expiresAtMs}) must be strictly greater than requestedAt (${requestedAtMs})`);
    }
  }

  // 12. limits
  let cleanLimits = { maxPayloadBytes: 65536 };
  if (input.limits !== undefined) {
    if (!isNonEmptyObject(input.limits)) {
      errors.push('limits if provided must be a non-null object');
    } else {
      if (typeof input.limits.maxPayloadBytes !== 'number' ||
          !Number.isSafeInteger(input.limits.maxPayloadBytes) ||
          input.limits.maxPayloadBytes < COMPUTER_PAYLOAD_BOUNDS.maxPayloadBytes.min ||
          input.limits.maxPayloadBytes > COMPUTER_PAYLOAD_BOUNDS.maxPayloadBytes.max) {
        errors.push(`limits.maxPayloadBytes must be an integer within ${COMPUTER_PAYLOAD_BOUNDS.maxPayloadBytes.min}..${COMPUTER_PAYLOAD_BOUNDS.maxPayloadBytes.max}`);
      } else {
        cleanLimits.maxPayloadBytes = input.limits.maxPayloadBytes;
      }
    }
  }

  // 13. requestDigest
  if (typeof input.requestDigest !== 'string' || !HEX_SHA256_REGEX.test(input.requestDigest)) {
    errors.push('requestDigest must be a 64-character hex SHA-256 string');
  } else if (verifyDigest && validOperations.includes(input.operation)) {
    const expectedDigest = computeComputerActionRequestDigest({
      schemaVersion: schema,
      operation: input.operation,
      target: cleanTarget,
      parameters: cleanParameters,
      sequence: input.sequence,
      taskId: input.taskId,
      attemptId: input.attemptId,
      principalId: input.principalId,
      sessionId: input.sessionId,
      limits: cleanLimits
    });
    if (input.requestDigest.toLowerCase() !== expectedDigest.toLowerCase()) {
      errors.push(`requestDigest mismatch: expected '${expectedDigest}', got '${input.requestDigest}'`);
    }
  }

  if (errors.length > 0) {
    return handleValidationFailure(errors, schema, throwOnError);
  }

  return deepFreeze({
    schemaVersion: schema,
    requestId: input.requestId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    sessionId: input.sessionId,
    principalId: input.principalId,
    operation: input.operation,
    target: cleanTarget,
    parameters: cleanParameters,
    sequence: input.sequence,
    requestedAt: requestedAtMs,
    expiresAt: expiresAtMs,
    limits: cleanLimits,
    requestDigest: input.requestDigest.toLowerCase()
  });
}

/**
 * Creates and validates a well-formed ComputerActionRequest.
 * Automatically generates requestId, requestedAt, default sequence, limits, and requestDigest.
 *
 * @param {object} params
 * @returns {object} Validated and frozen ComputerActionRequest
 */
export function createComputerActionRequest(params) {
  const schema = SCHEMA_VERSIONS.COMPUTER_ACTION_REQUEST;
  const requestId = params.requestId || `creq-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const requestedAt = params.requestedAt ?? Date.now();
  const expiresAt = params.expiresAt ?? (requestedAt + (params.ttlMs || 30000));
  const sequence = params.sequence ?? 1;
  const limits = {
    maxPayloadBytes: params.limits?.maxPayloadBytes ?? 65536
  };

  const raw = {
    schemaVersion: schema,
    requestId,
    taskId: params.taskId,
    attemptId: params.attemptId ?? 1,
    sessionId: params.sessionId,
    principalId: params.principalId,
    operation: params.operation,
    target: params.target ?? {},
    parameters: params.parameters ?? {},
    sequence,
    requestedAt,
    expiresAt,
    limits,
    requestDigest: params.requestDigest || ''
  };

  if (!raw.requestDigest) {
    raw.requestDigest = computeComputerActionRequestDigest(raw);
  }

  return validateComputerActionRequest(raw, { throwOnError: true, verifyDigest: true });
}
