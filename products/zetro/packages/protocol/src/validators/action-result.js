/**
 * @file validators/action-result.js
 * Runtime validator for ActionResult (zetro.protocol.action_result.v1).
 */

import {
  SCHEMA_VERSIONS,
  ActionType,
  ActionStatus
} from '../constants.js';
import { handleValidationFailure } from '../errors.js';

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

function isNonEmptyObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Validates an ActionResult object against zetro.protocol.action_result.v1.
 * @param {any} input
 * @param {{ throwOnError?: boolean }} [options]
 * @returns {object} Normalized ActionResult object
 */
export function validateActionResult(input, { throwOnError = true } = {}) {
  const errors = [];
  const schema = SCHEMA_VERSIONS.ACTION_RESULT;

  if (!isNonEmptyObject(input)) {
    return handleValidationFailure(['ActionResult must be a non-null object'], schema, throwOnError);
  }

  // schemaVersion
  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}', got '${input.schemaVersion}'`);
  }

  // requestId
  if (typeof input.requestId !== 'string' || !ID_REGEX.test(input.requestId)) {
    errors.push('requestId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // grantId
  if (typeof input.grantId !== 'string' || !ID_REGEX.test(input.grantId)) {
    errors.push('grantId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // actionType
  const validActionTypes = Object.values(ActionType);
  if (!validActionTypes.includes(input.actionType)) {
    errors.push(`actionType must be one of: ${validActionTypes.join(', ')}, got '${input.actionType}'`);
  }

  // status
  const validStatuses = Object.values(ActionStatus);
  if (!validStatuses.includes(input.status)) {
    errors.push(`status must be one of: ${validStatuses.join(', ')}, got '${input.status}'`);
  }

  // effectObserved
  if (typeof input.effectObserved !== 'boolean') {
    errors.push('effectObserved must be a boolean');
  }

  // output
  let cleanOutput = {};
  if (input.output !== undefined) {
    if (!isNonEmptyObject(input.output)) {
      errors.push('output if provided must be an object');
    } else {
      cleanOutput = { ...input.output };
    }
  }

  // error (optional)
  let cleanError = undefined;
  if (input.error !== undefined) {
    if (!isNonEmptyObject(input.error)) {
      errors.push('error if provided must be an object');
    } else {
      cleanError = {
        code: typeof input.error.code === 'string' ? input.error.code : 'UNKNOWN_ERROR',
        message: typeof input.error.message === 'string' ? input.error.message : 'Unknown error occurred',
        ...(input.error.category ? { category: String(input.error.category) } : {})
      };
    }
  }

  // executedAt
  let cleanExecutedAt = Date.now();
  if (input.executedAt !== undefined) {
    if (typeof input.executedAt === 'number') {
      if (!Number.isFinite(input.executedAt) || input.executedAt <= 0) {
        errors.push('executedAt (number) must be a positive finite number');
      } else {
        cleanExecutedAt = input.executedAt;
      }
    } else if (typeof input.executedAt === 'string') {
      if (isNaN(Date.parse(input.executedAt))) {
        errors.push('executedAt (string) must be a valid parseable ISO date string');
      } else {
        cleanExecutedAt = input.executedAt;
      }
    } else {
      errors.push('executedAt must be a timestamp number or string');
    }
  }

  // durationMs
  let cleanDurationMs = 0;
  if (input.durationMs !== undefined) {
    if (typeof input.durationMs !== 'number' || !Number.isFinite(input.durationMs) || input.durationMs < 0) {
      errors.push('durationMs must be a non-negative finite number');
    } else {
      cleanDurationMs = input.durationMs;
    }
  }

  if (errors.length > 0) {
    return handleValidationFailure(errors, schema, throwOnError);
  }

  return {
    schemaVersion: schema,
    requestId: input.requestId,
    grantId: input.grantId,
    actionType: input.actionType,
    status: input.status,
    effectObserved: input.effectObserved,
    output: cleanOutput,
    ...(cleanError ? { error: cleanError } : {}),
    executedAt: cleanExecutedAt,
    durationMs: cleanDurationMs
  };
}

/**
 * Type guard for ActionResult.
 * @param {any} value
 * @returns {boolean}
 */
export function isActionResult(value) {
  try {
    const res = validateActionResult(value, { throwOnError: false });
    return res && res.ok !== false;
  } catch {
    return false;
  }
}
