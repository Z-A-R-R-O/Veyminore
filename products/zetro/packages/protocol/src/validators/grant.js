/**
 * @file validators/grant.js
 * Runtime validator for Grant (zetro.protocol.grant.v1).
 * Supports principal/session scope, expiry, revocation, and exact-request approval digest semantics.
 */

import { SCHEMA_VERSIONS, ActionType } from '../constants.js';
import { handleValidationFailure } from '../errors.js';
import { validateRelativePath, validateDirectoryPath } from '../path.js';

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
 * Validates a Grant object against zetro.protocol.grant.v1.
 * @param {any} input
 * @param {{ throwOnError?: boolean }} [options]
 * @returns {object} Normalized Grant object
 */
export function validateGrant(input, { throwOnError = true } = {}) {
  const errors = [];
  const schema = SCHEMA_VERSIONS.GRANT;

  if (!isNonEmptyObject(input)) {
    return handleValidationFailure(['Grant must be a non-null object'], schema, throwOnError);
  }

  // schemaVersion
  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}', got '${input.schemaVersion}'`);
  }

  // grantId
  if (typeof input.grantId !== 'string' || !ID_REGEX.test(input.grantId)) {
    errors.push('grantId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // principalId
  if (typeof input.principalId !== 'string' || input.principalId.length < 1 || input.principalId.length > 128) {
    errors.push('principalId must be a string between 1 and 128 characters');
  }

  // sessionId
  if (typeof input.sessionId !== 'string' || input.sessionId.length < 1 || input.sessionId.length > 128) {
    errors.push('sessionId must be a string between 1 and 128 characters');
  }

  // scope
  const cleanScope = {
    actionTypes: [],
    allowedPaths: [],
    exactRequestDigest: undefined
  };

  if (!isNonEmptyObject(input.scope)) {
    errors.push('scope must be an object with actionTypes');
  } else {
    const validActionTypes = Object.values(ActionType);
    if (!Array.isArray(input.scope.actionTypes) || input.scope.actionTypes.length === 0) {
      errors.push('scope.actionTypes must be a non-empty array of ActionType values');
    } else {
      for (const at of input.scope.actionTypes) {
        if (!validActionTypes.includes(at)) {
          errors.push(`scope.actionTypes contains invalid ActionType: '${at}'`);
        } else {
          cleanScope.actionTypes.push(at);
        }
      }
      cleanScope.actionTypes = [...new Set(cleanScope.actionTypes)];
    }

    if (input.scope.allowedPaths !== undefined) {
      if (!Array.isArray(input.scope.allowedPaths)) {
        errors.push('scope.allowedPaths must be an array of strings');
      } else {
        for (let i = 0; i < input.scope.allowedPaths.length; i++) {
          const p = input.scope.allowedPaths[i];
          const relRes = validateRelativePath(p);
          if (relRes.ok) {
            cleanScope.allowedPaths.push(relRes.canonical);
          } else {
            const dirRes = validateDirectoryPath(p);
            if (!dirRes.ok) {
              errors.push(`scope.allowedPaths[${i}] is invalid: ${dirRes.reason}`);
            } else {
              cleanScope.allowedPaths.push(dirRes.canonical);
            }
          }
        }
        cleanScope.allowedPaths = [...new Set(cleanScope.allowedPaths)].sort();
      }
    }

    if (input.scope.allowedCommands !== undefined) {
      if (!Array.isArray(input.scope.allowedCommands) || input.scope.allowedCommands.length === 0) {
        errors.push('scope.allowedCommands if provided must be a non-empty array of strings or string arrays');
      } else {
        cleanScope.allowedCommands = [];
        for (let i = 0; i < input.scope.allowedCommands.length; i++) {
          const cmd = input.scope.allowedCommands[i];
          if (typeof cmd === 'string' && cmd.length > 0) {
            cleanScope.allowedCommands.push(cmd);
          } else if (Array.isArray(cmd) && cmd.length > 0 && cmd.every(c => typeof c === 'string' && c.length > 0)) {
            cleanScope.allowedCommands.push([...cmd]);
          } else {
            errors.push(`scope.allowedCommands[${i}] must be a non-empty string or string array`);
          }
        }
      }
    }

    if (input.scope.allowedDisplays !== undefined) {
      if (!Array.isArray(input.scope.allowedDisplays) || input.scope.allowedDisplays.length === 0) {
        errors.push('scope.allowedDisplays if provided must be a non-empty array of numbers or strings');
      } else {
        cleanScope.allowedDisplays = [];
        for (let i = 0; i < input.scope.allowedDisplays.length; i++) {
          const d = input.scope.allowedDisplays[i];
          if (typeof d === 'number' && Number.isSafeInteger(d)) {
            cleanScope.allowedDisplays.push(d);
          } else if (typeof d === 'string' && d.length > 0) {
            cleanScope.allowedDisplays.push(d);
          } else {
            errors.push(`scope.allowedDisplays[${i}] must be a safe integer or non-empty string`);
          }
        }
      }
    }

    if (input.scope.allowedTargets !== undefined) {
      if (!Array.isArray(input.scope.allowedTargets) || input.scope.allowedTargets.length === 0) {
        errors.push('scope.allowedTargets if provided must be a non-empty array');
      } else {
        cleanScope.allowedTargets = [...input.scope.allowedTargets];
      }
    }

    if (input.scope.exactRequestDigest !== undefined && input.scope.exactRequestDigest !== null) {
      if (typeof input.scope.exactRequestDigest !== 'string' || !HEX_SHA256_REGEX.test(input.scope.exactRequestDigest)) {
        errors.push('scope.exactRequestDigest must be a 64-character hex SHA-256 string');
      } else {
        cleanScope.exactRequestDigest = input.scope.exactRequestDigest.toLowerCase();
      }
    }

    if (input.scope.exactArgs !== undefined) {
      cleanScope.exactArgs = Boolean(input.scope.exactArgs);
    }

    if (input.scope.exactCwd !== undefined) {
      cleanScope.exactCwd = Boolean(input.scope.exactCwd);
    }

    if (input.scope.workspaceRoot !== undefined && input.scope.workspaceRoot !== null) {
      if (typeof input.scope.workspaceRoot !== 'string') {
        errors.push('scope.workspaceRoot must be a string');
      } else {
        const relRes = validateRelativePath(input.scope.workspaceRoot);
        if (relRes.ok) {
          cleanScope.workspaceRoot = relRes.canonical;
        } else {
          const dirRes = validateDirectoryPath(input.scope.workspaceRoot);
          if (!dirRes.ok) {
            errors.push(`scope.workspaceRoot is invalid: ${dirRes.reason}`);
          } else {
            cleanScope.workspaceRoot = dirRes.canonical;
          }
        }
      }
    }

    if (input.scope.sourceBaselineRoot !== undefined && input.scope.sourceBaselineRoot !== null) {
      if (typeof input.scope.sourceBaselineRoot !== 'string') {
        errors.push('scope.sourceBaselineRoot must be a string');
      } else {
        const relRes = validateRelativePath(input.scope.sourceBaselineRoot);
        if (relRes.ok) {
          cleanScope.sourceBaselineRoot = relRes.canonical;
        } else {
          const dirRes = validateDirectoryPath(input.scope.sourceBaselineRoot);
          if (!dirRes.ok) {
            errors.push(`scope.sourceBaselineRoot is invalid: ${dirRes.reason}`);
          } else {
            cleanScope.sourceBaselineRoot = dirRes.canonical;
          }
        }
      }
    }
  }

  // issuedAt & expiresAt
  const issuedAtMs = parseTimestamp(input.issuedAt, 'issuedAt', errors);
  const expiresAtMs = parseTimestamp(input.expiresAt, 'expiresAt', errors);

  if (issuedAtMs !== null && expiresAtMs !== null) {
    if (expiresAtMs <= issuedAtMs) {
      errors.push(`expiresAt (${expiresAtMs}) must be strictly greater than issuedAt (${issuedAtMs})`);
    }
  }

  // revoked
  if (typeof input.revoked !== 'boolean') {
    errors.push('revoked must be a boolean');
  }

  // revokedAt & revocationReason
  let cleanRevokedAt = undefined;
  if (input.revoked) {
    if (input.revokedAt === undefined || input.revokedAt === null) {
      errors.push('revokedAt is required when revoked is true');
    } else {
      cleanRevokedAt = parseTimestamp(input.revokedAt, 'revokedAt', errors);
    }
  } else if (input.revokedAt !== undefined && input.revokedAt !== null) {
    cleanRevokedAt = parseTimestamp(input.revokedAt, 'revokedAt', errors);
  }

  let cleanRevocationReason = undefined;
  if (input.revocationReason !== undefined && input.revocationReason !== null) {
    if (typeof input.revocationReason !== 'string' || input.revocationReason.length > 500) {
      errors.push('revocationReason must be a string up to 500 characters');
    } else {
      cleanRevocationReason = input.revocationReason;
    }
  }

  // issuerId
  if (typeof input.issuerId !== 'string' || input.issuerId.length < 1 || input.issuerId.length > 128) {
    errors.push('issuerId must be a string between 1 and 128 characters');
  }

  // oneUse
  let cleanOneUse = undefined;
  if (input.oneUse !== undefined) {
    if (typeof input.oneUse !== 'boolean') {
      errors.push('oneUse must be a boolean');
    } else {
      cleanOneUse = input.oneUse;
    }
  }

  if (errors.length > 0) {
    return handleValidationFailure(errors, schema, throwOnError);
  }

  return {
    schemaVersion: schema,
    grantId: input.grantId,
    principalId: input.principalId,
    sessionId: input.sessionId,
    scope: cleanScope,
    issuedAt: issuedAtMs,
    expiresAt: expiresAtMs,
    revoked: input.revoked,
    ...(cleanOneUse !== undefined ? { oneUse: cleanOneUse } : {}),
    ...(cleanRevokedAt !== undefined ? { revokedAt: cleanRevokedAt } : {}),
    ...(cleanRevocationReason ? { revocationReason: cleanRevocationReason } : {}),
    issuerId: input.issuerId
  };
}

/**
 * Type guard for Grant.
 * @param {any} value
 * @returns {boolean}
 */
export function isGrant(value) {
  try {
    const res = validateGrant(value, { throwOnError: false });
    return res && res.ok !== false;
  } catch {
    return false;
  }
}
