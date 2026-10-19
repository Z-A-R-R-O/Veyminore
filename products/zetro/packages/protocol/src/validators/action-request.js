/**
 * @file validators/action-request.js
 * Runtime validator and factory for ActionRequest (zetro.protocol.action_request.v1).
 */

import { randomUUID } from 'node:crypto';
import { SCHEMA_VERSIONS, ActionType } from '../constants.js';
import { handleValidationFailure } from '../errors.js';
import { computeActionRequestDigest } from '../digest.js';
import { validateRelativePath, validateDirectoryPath } from '../path.js';

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const HEX_SHA256_REGEX = /^[a-f0-9]{64}$/i;

function isNonEmptyObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Validates an ActionRequest object against zetro.protocol.action_request.v1.
 * @param {any} input
 * @param {{ throwOnError?: boolean, verifyDigest?: boolean }} [options]
 * @returns {object} Normalized ActionRequest object
 */
export function validateActionRequest(input, { throwOnError = true, verifyDigest = false } = {}) {
  const errors = [];
  const schema = SCHEMA_VERSIONS.ACTION_REQUEST;

  if (!isNonEmptyObject(input)) {
    return handleValidationFailure(['ActionRequest must be a non-null object'], schema, throwOnError);
  }

  // schemaVersion
  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}', got '${input.schemaVersion}'`);
  }

  // requestId
  if (typeof input.requestId !== 'string' || !ID_REGEX.test(input.requestId)) {
    errors.push('requestId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // taskId
  if (typeof input.taskId !== 'string' || !ID_REGEX.test(input.taskId)) {
    errors.push('taskId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // attemptId
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

  // principalId
  if (typeof input.principalId !== 'string' || input.principalId.length < 1 || input.principalId.length > 128) {
    errors.push('principalId must be a string between 1 and 128 characters');
  }

  // sessionId (optional)
  let cleanSessionId = undefined;
  if (input.sessionId !== undefined) {
    if (typeof input.sessionId !== 'string' || input.sessionId.length < 1 || input.sessionId.length > 128) {
      errors.push('sessionId if provided must be a string between 1 and 128 characters');
    } else {
      cleanSessionId = input.sessionId;
    }
  }

  // actionType
  const validActionTypes = Object.values(ActionType);
  if (!validActionTypes.includes(input.actionType)) {
    errors.push(`actionType must be one of: ${validActionTypes.join(', ')}, got '${input.actionType}'`);
  }

  // parameters
  let cleanParameters = {};
  if (!isNonEmptyObject(input.parameters)) {
    errors.push('parameters must be a non-null object');
  } else {
    cleanParameters = { ...input.parameters };

    // Action-specific parameter validations
    if ([ActionType.FILE_READ, ActionType.FILE_WRITE, ActionType.FILE_CREATE, ActionType.FILE_DELETE].includes(input.actionType)) {
      if (typeof cleanParameters.path !== 'string') {
        errors.push(`Action '${input.actionType}' requires a string 'path' in parameters`);
      } else {
        const pathRes = validateRelativePath(cleanParameters.path);
        if (!pathRes.ok) {
          errors.push(`parameters.path is invalid: ${pathRes.reason}`);
        } else {
          cleanParameters.path = pathRes.canonical;
        }
      }

      if (cleanParameters.workspaceRoot !== undefined || cleanParameters.root !== undefined) {
        const rawRoot = cleanParameters.workspaceRoot || cleanParameters.root;
        if (typeof rawRoot !== 'string') {
          errors.push('parameters.workspaceRoot must be a string');
        } else {
          const relRes = validateRelativePath(rawRoot);
          if (relRes.ok) {
            cleanParameters.workspaceRoot = relRes.canonical;
          } else {
            const dirRes = validateDirectoryPath(rawRoot);
            if (!dirRes.ok) {
              errors.push(`parameters.workspaceRoot is invalid: ${dirRes.reason}`);
            } else {
              cleanParameters.workspaceRoot = dirRes.canonical;
            }
          }
        }
        delete cleanParameters.root;
      }
    }

    if (input.actionType === ActionType.SHELL_EXEC) {
      if (!Array.isArray(cleanParameters.command) || cleanParameters.command.length < 1 || cleanParameters.command.length > 50) {
        errors.push('Action shell_exec requires parameters.command to be an array of 1 to 50 string arguments');
      } else if (cleanParameters.command.some(c => typeof c !== 'string' || c.length === 0)) {
        errors.push('parameters.command entries must all be non-empty strings');
      }
      if (cleanParameters.cwd !== undefined) {
        const cwdRel = validateRelativePath(cleanParameters.cwd);
        if (cwdRel.ok) {
          cleanParameters.cwd = cwdRel.canonical;
        } else {
          const cwdDir = validateDirectoryPath(cleanParameters.cwd);
          if (!cwdDir.ok) {
            errors.push(`parameters.cwd is invalid: ${cwdDir.reason}`);
          } else {
            cleanParameters.cwd = cwdDir.canonical;
          }
        }
      }
    }
  }

  // requestDigest
  if (typeof input.requestDigest !== 'string' || !HEX_SHA256_REGEX.test(input.requestDigest)) {
    errors.push('requestDigest must be a 64-character hex SHA-256 string');
  } else if (verifyDigest && validActionTypes.includes(input.actionType)) {
    const expectedDigest = computeActionRequestDigest(input.actionType, cleanParameters);
    if (input.requestDigest.toLowerCase() !== expectedDigest.toLowerCase()) {
      errors.push(`requestDigest mismatch: expected '${expectedDigest}', got '${input.requestDigest}'`);
    }
  }

  // requestedAt
  let cleanRequestedAt = Date.now();
  if (input.requestedAt !== undefined) {
    if (typeof input.requestedAt === 'number') {
      if (!Number.isFinite(input.requestedAt) || input.requestedAt <= 0) {
        errors.push('requestedAt (number) must be a positive finite number');
      } else {
        cleanRequestedAt = input.requestedAt;
      }
    } else if (typeof input.requestedAt === 'string') {
      if (isNaN(Date.parse(input.requestedAt))) {
        errors.push('requestedAt (string) must be a valid parseable ISO date string');
      } else {
        cleanRequestedAt = input.requestedAt;
      }
    } else {
      errors.push('requestedAt must be a timestamp number or string');
    }
  }

  if (errors.length > 0) {
    return handleValidationFailure(errors, schema, throwOnError);
  }

  return {
    schemaVersion: schema,
    requestId: input.requestId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    principalId: input.principalId,
    ...(cleanSessionId ? { sessionId: cleanSessionId } : {}),
    actionType: input.actionType,
    parameters: cleanParameters,
    requestDigest: input.requestDigest.toLowerCase(),
    requestedAt: cleanRequestedAt
  };
}

/**
 * Creates and signs a new ActionRequest.
 * @param {object} params
 * @returns {object} Validated ActionRequest with computed requestDigest
 */
export function createActionRequest({
  requestId = randomUUID(),
  taskId,
  attemptId,
  principalId,
  sessionId,
  actionType,
  parameters = {},
  requestedAt = Date.now()
}) {
  const normalizedParams = { ...parameters };
  if (normalizedParams.workspaceRoot !== undefined || normalizedParams.root !== undefined) {
    const rawRoot = normalizedParams.workspaceRoot || normalizedParams.root;
    if (typeof rawRoot === 'string') {
      const relRes = validateRelativePath(rawRoot);
      normalizedParams.workspaceRoot = relRes.ok ? relRes.canonical : (validateDirectoryPath(rawRoot).ok ? validateDirectoryPath(rawRoot).canonical : rawRoot);
    }
    delete normalizedParams.root;
  }
  if (typeof normalizedParams.path === 'string') {
    const pathRes = validateRelativePath(normalizedParams.path);
    if (pathRes.ok) {
      normalizedParams.path = pathRes.canonical;
    }
  }
  if (typeof normalizedParams.cwd === 'string') {
    const cwdRel = validateRelativePath(normalizedParams.cwd);
    normalizedParams.cwd = cwdRel.ok ? cwdRel.canonical : (validateDirectoryPath(normalizedParams.cwd).ok ? validateDirectoryPath(normalizedParams.cwd).canonical : normalizedParams.cwd);
  }
  const digest = computeActionRequestDigest(actionType, normalizedParams);
  return validateActionRequest({
    schemaVersion: SCHEMA_VERSIONS.ACTION_REQUEST,
    requestId,
    taskId,
    attemptId,
    principalId,
    ...(sessionId ? { sessionId } : {}),
    actionType,
    parameters: normalizedParams,
    requestDigest: digest,
    requestedAt
  }, { throwOnError: true, verifyDigest: true });
}

/**
 * Type guard for ActionRequest.
 * @param {any} value
 * @returns {boolean}
 */
export function isActionRequest(value) {
  try {
    const res = validateActionRequest(value, { throwOnError: false });
    return res && res.ok !== false;
  } catch {
    return false;
  }
}
