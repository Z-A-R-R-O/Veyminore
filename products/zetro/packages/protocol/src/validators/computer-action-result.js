/**
 * @file validators/computer-action-result.js
 * Runtime validator and factory for native ComputerActionResult (zetro.protocol.computer_result.v1).
 * Binds execution status, target identity proof, sequence, and result digest.
 */

import {
  SCHEMA_VERSIONS,
  ComputerOperation,
  ComputerActionStatus
} from '../constants.js';
import { handleValidationFailure } from '../errors.js';
import { computeComputerActionResultDigest } from '../digest.js';
import { deepFreeze } from './computer-action-request.js';

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
 * Validates a ComputerActionResult object against zetro.protocol.computer_result.v1.
 *
 * @param {any} input
 * @param {{ throwOnError?: boolean, verifyDigest?: boolean }} [options]
 * @returns {object} Validated, normalized, deeply frozen ComputerActionResult object
 */
export function validateComputerActionResult(input, { throwOnError = true, verifyDigest = false } = {}) {
  const errors = [];
  const schema = SCHEMA_VERSIONS.COMPUTER_ACTION_RESULT;

  if (!isNonEmptyObject(input)) {
    return handleValidationFailure(['ComputerActionResult must be a non-null object'], schema, throwOnError);
  }

  // 1. schemaVersion
  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}', got '${input.schemaVersion}'`);
  }

  // 2. requestId
  if (typeof input.requestId !== 'string' || !ID_REGEX.test(input.requestId)) {
    errors.push('requestId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // 3. sessionId
  if (typeof input.sessionId !== 'string' || !ID_REGEX.test(input.sessionId)) {
    errors.push('sessionId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // 4. operation
  const validOperations = Object.values(ComputerOperation);
  if (!validOperations.includes(input.operation)) {
    errors.push(`operation must be one of: ${validOperations.join(', ')}, got '${input.operation}'`);
  }

  // 5. status
  const validStatuses = Object.values(ComputerActionStatus);
  if (!validStatuses.includes(input.status)) {
    errors.push(`status must be one of: ${validStatuses.join(', ')}, got '${input.status}'`);
  }

  // 6. reason (optional string)
  let cleanReason = null;
  if (input.reason !== undefined && input.reason !== null) {
    if (typeof input.reason !== 'string' || input.reason.length > 500) {
      errors.push('reason if provided must be a string up to 500 characters');
    } else {
      cleanReason = input.reason;
    }
  }

  // 7. target
  let cleanTarget = {};
  if (!isNonEmptyObject(input.target)) {
    errors.push('target must be a non-null object');
  } else {
    cleanTarget = { ...input.target };
  }

  // 8. sequence (strictly monotonic safe integer >= 1)
  if (typeof input.sequence !== 'number' || !Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    errors.push('sequence must be a positive safe integer (>= 1)');
  }

  // 9. executedAt
  const executedAtMs = parseTimestamp(input.executedAt, 'executedAt', errors);

  // 10. payload
  let cleanPayload = {};
  if (!isNonEmptyObject(input.payload)) {
    errors.push('payload must be a non-null object');
  } else {
    cleanPayload = { ...input.payload };
  }

  // 11. resultDigest
  if (typeof input.resultDigest !== 'string' || !HEX_SHA256_REGEX.test(input.resultDigest)) {
    errors.push('resultDigest must be a 64-character hex SHA-256 string');
  } else if (verifyDigest && validOperations.includes(input.operation)) {
    const expectedDigest = computeComputerActionResultDigest({
      schemaVersion: schema,
      requestId: input.requestId,
      sessionId: input.sessionId,
      operation: input.operation,
      status: input.status,
      reason: cleanReason,
      target: cleanTarget,
      sequence: input.sequence,
      executedAt: executedAtMs,
      payload: cleanPayload
    });
    if (input.resultDigest.toLowerCase() !== expectedDigest.toLowerCase()) {
      errors.push(`resultDigest mismatch: expected '${expectedDigest}', got '${input.resultDigest}'`);
    }
  }

  if (errors.length > 0) {
    return handleValidationFailure(errors, schema, throwOnError);
  }

  return deepFreeze({
    schemaVersion: schema,
    requestId: input.requestId,
    sessionId: input.sessionId,
    operation: input.operation,
    status: input.status,
    reason: cleanReason,
    target: cleanTarget,
    sequence: input.sequence,
    executedAt: executedAtMs,
    payload: cleanPayload,
    resultDigest: input.resultDigest.toLowerCase()
  });
}

/**
 * Creates and validates a well-formed ComputerActionResult.
 * Automatically computes resultDigest.
 *
 * @param {object} params
 * @returns {object} Validated and frozen ComputerActionResult
 */
export function createComputerActionResult(params) {
  const schema = SCHEMA_VERSIONS.COMPUTER_ACTION_RESULT;
  const executedAt = params.executedAt ?? Date.now();

  const raw = {
    schemaVersion: schema,
    requestId: params.requestId,
    sessionId: params.sessionId,
    operation: params.operation,
    status: params.status || ComputerActionStatus.SUCCESS,
    reason: params.reason || null,
    target: params.target ?? {},
    sequence: params.sequence ?? 1,
    executedAt,
    payload: params.payload ?? {},
    resultDigest: params.resultDigest || ''
  };

  if (!raw.resultDigest) {
    raw.resultDigest = computeComputerActionResultDigest(raw);
  }

  return validateComputerActionResult(raw, { throwOnError: true, verifyDigest: true });
}
