/**
 * @file validators/workspace-admission.js
 * Runtime validator and factory for WorkspaceAdmission (zetro.protocol.workspace_admission.v1).
 * Defines the immutable contract binding isolated snapshot root, source baseline repository root,
 * baseline hashes, and exact capability scopes for runtime execution.
 */

import { SCHEMA_VERSIONS } from '../constants.js';
import { handleValidationFailure } from '../errors.js';
import { computeWorkspaceAdmissionDigest } from '../digest.js';
import { validateRelativePath, validateDirectoryPath } from '../path.js';

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const HEX_SHA256_REGEX = /^[a-f0-9]{64}$/i;

function isNonEmptyObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Deeply and recursively freezes an object and all nested object/array references.
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
 * Validates a WorkspaceAdmission object against zetro.protocol.workspace_admission.v1.
 * Returns a deeply frozen, immutable representation.
 *
 * @param {any} input
 * @param {{ throwOnError?: boolean, verifyDigest?: boolean }} [options]
 * @returns {object} Validated, normalized, deeply frozen WorkspaceAdmission object
 */
export function validateWorkspaceAdmission(input, { throwOnError = true, verifyDigest = false } = {}) {
  const errors = [];
  const schema = SCHEMA_VERSIONS.WORKSPACE_ADMISSION;

  if (!isNonEmptyObject(input)) {
    return handleValidationFailure(['WorkspaceAdmission must be a non-null object'], schema, throwOnError);
  }

  // schemaVersion
  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}', got '${input.schemaVersion}'`);
  }

  // workspaceId
  if (typeof input.workspaceId !== 'string' || !ID_REGEX.test(input.workspaceId)) {
    errors.push('workspaceId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
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

  // canonicalRoot (isolated snapshot directory root)
  let cleanCanonicalRoot = null;
  if (typeof input.canonicalRoot !== 'string' || input.canonicalRoot.trim().length === 0) {
    errors.push('canonicalRoot must be a non-empty string directory path');
  } else {
    const dirRes = validateDirectoryPath(input.canonicalRoot);
    if (!dirRes.ok) {
      errors.push(`canonicalRoot is invalid: ${dirRes.reason}`);
    } else {
      const canonical = dirRes.canonical;
      const isAbsolute = canonical.startsWith('/') || /^[a-zA-Z]:\//.test(canonical);
      if (!isAbsolute) {
        errors.push('canonicalRoot must be an absolute directory path');
      } else {
        cleanCanonicalRoot = canonical;
      }
    }
  }

  // sourceBaselineRoot (underlying source repository root)
  let cleanSourceBaselineRoot = null;
  if (typeof input.sourceBaselineRoot !== 'string' || input.sourceBaselineRoot.trim().length === 0) {
    errors.push('sourceBaselineRoot must be a non-empty string directory path');
  } else {
    const dirRes = validateDirectoryPath(input.sourceBaselineRoot);
    if (!dirRes.ok) {
      errors.push(`sourceBaselineRoot is invalid: ${dirRes.reason}`);
    } else {
      const canonical = dirRes.canonical;
      const isAbsolute = canonical.startsWith('/') || /^[a-zA-Z]:\//.test(canonical);
      if (!isAbsolute) {
        errors.push('sourceBaselineRoot must be an absolute directory path');
      } else {
        cleanSourceBaselineRoot = canonical;
      }
    }
  }

  // scope
  const cleanScope = {
    readPaths: [],
    writePaths: [],
    createPaths: [],
    commands: undefined
  };

  if (!isNonEmptyObject(input.scope)) {
    errors.push('scope must be a non-null object');
  } else {
    // readPaths
    if (input.scope.readPaths !== undefined) {
      if (!Array.isArray(input.scope.readPaths)) {
        errors.push('scope.readPaths must be an array of strings');
      } else {
        for (let i = 0; i < input.scope.readPaths.length; i++) {
          const p = input.scope.readPaths[i];
          const relRes = validateRelativePath(p);
          if (!relRes.ok) {
            errors.push(`scope.readPaths[${i}] is invalid: ${relRes.reason}`);
          } else {
            cleanScope.readPaths.push(relRes.canonical);
          }
        }
        cleanScope.readPaths = [...new Set(cleanScope.readPaths)].sort();
      }
    }

    // writePaths
    if (input.scope.writePaths !== undefined) {
      if (!Array.isArray(input.scope.writePaths)) {
        errors.push('scope.writePaths must be an array of strings');
      } else {
        for (let i = 0; i < input.scope.writePaths.length; i++) {
          const p = input.scope.writePaths[i];
          const relRes = validateRelativePath(p);
          if (!relRes.ok) {
            errors.push(`scope.writePaths[${i}] is invalid: ${relRes.reason}`);
          } else {
            cleanScope.writePaths.push(relRes.canonical);
          }
        }
        cleanScope.writePaths = [...new Set(cleanScope.writePaths)].sort();
      }
    }

    // createPaths
    if (input.scope.createPaths !== undefined) {
      if (!Array.isArray(input.scope.createPaths)) {
        errors.push('scope.createPaths must be an array of strings');
      } else {
        for (let i = 0; i < input.scope.createPaths.length; i++) {
          const p = input.scope.createPaths[i];
          const relRes = validateRelativePath(p);
          if (!relRes.ok) {
            errors.push(`scope.createPaths[${i}] is invalid: ${relRes.reason}`);
          } else {
            cleanScope.createPaths.push(relRes.canonical);
          }
        }
        cleanScope.createPaths = [...new Set(cleanScope.createPaths)].sort();
      }
    }

    // At least one path required across scopes
    const totalPaths = cleanScope.readPaths.length + cleanScope.writePaths.length + cleanScope.createPaths.length;
    if (totalPaths === 0) {
      errors.push('scope must include at least one readPath, writePath, or createPath');
    }

    // commands
    if (input.scope.commands !== undefined) {
      if (!Array.isArray(input.scope.commands) || input.scope.commands.length === 0) {
        errors.push('scope.commands if provided must be a non-empty array of strings or string arrays');
      } else {
        cleanScope.commands = [];
        for (let i = 0; i < input.scope.commands.length; i++) {
          const cmd = input.scope.commands[i];
          if (typeof cmd === 'string' && cmd.length > 0) {
            cleanScope.commands.push(cmd);
          } else if (Array.isArray(cmd) && cmd.length > 0 && cmd.every(c => typeof c === 'string' && c.length > 0)) {
            cleanScope.commands.push([...cmd]);
          } else {
            errors.push(`scope.commands[${i}] must be a non-empty string or string array`);
          }
        }
      }
    }
  }

  // Invariant: Distinct snapshot root for mutating workers
  // If task has write or create capabilities, canonicalRoot MUST NOT equal sourceBaselineRoot
  if (cleanCanonicalRoot && cleanSourceBaselineRoot) {
    const hasMutations = cleanScope.writePaths.length > 0 || cleanScope.createPaths.length > 0;
    if (hasMutations && cleanCanonicalRoot === cleanSourceBaselineRoot) {
      errors.push('canonicalRoot must not equal sourceBaselineRoot when write or create scopes are declared; mutating worker must operate in an isolated snapshot');
    }
  }

  // sourceBaselineHash (optional SHA-256 hex)
  let cleanSourceBaselineHash = undefined;
  if (input.sourceBaselineHash !== undefined && input.sourceBaselineHash !== null) {
    if (typeof input.sourceBaselineHash !== 'string' || !HEX_SHA256_REGEX.test(input.sourceBaselineHash)) {
      errors.push('sourceBaselineHash must be a 64-character hex SHA-256 string');
    } else {
      cleanSourceBaselineHash = input.sourceBaselineHash.toLowerCase();
    }
  }

  // baselineCommit (optional string)
  let cleanBaselineCommit = undefined;
  if (input.baselineCommit !== undefined && input.baselineCommit !== null) {
    if (typeof input.baselineCommit !== 'string' || input.baselineCommit.length < 1 || input.baselineCommit.length > 64) {
      errors.push('baselineCommit must be a string between 1 and 64 characters');
    } else {
      cleanBaselineCommit = input.baselineCommit;
    }
  }

  // admittedAt
  let cleanAdmittedAt = undefined;
  if (input.admittedAt !== undefined) {
    if (typeof input.admittedAt !== 'number' || !Number.isFinite(input.admittedAt) || input.admittedAt <= 0) {
      errors.push('admittedAt must be a positive finite epoch ms number');
    } else {
      cleanAdmittedAt = input.admittedAt;
    }
  } else {
    cleanAdmittedAt = Date.now();
  }

  // admittedBy
  let cleanAdmittedBy = 'coordinator';
  if (input.admittedBy !== undefined) {
    if (typeof input.admittedBy !== 'string' || input.admittedBy.length < 1 || input.admittedBy.length > 128) {
      errors.push('admittedBy must be a string between 1 and 128 characters');
    } else {
      cleanAdmittedBy = input.admittedBy;
    }
  }

  // admissionDigest
  let cleanAdmissionDigest = undefined;
  if (input.admissionDigest !== undefined) {
    if (typeof input.admissionDigest !== 'string' || !HEX_SHA256_REGEX.test(input.admissionDigest)) {
      errors.push('admissionDigest must be a 64-character hex SHA-256 string');
    } else {
      cleanAdmissionDigest = input.admissionDigest.toLowerCase();
    }
  }

  if (errors.length > 0) {
    return handleValidationFailure(errors, schema, throwOnError);
  }

  const normalized = {
    schemaVersion: schema,
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    canonicalRoot: cleanCanonicalRoot,
    sourceBaselineRoot: cleanSourceBaselineRoot,
    ...(cleanSourceBaselineHash ? { sourceBaselineHash: cleanSourceBaselineHash } : {}),
    ...(cleanBaselineCommit ? { baselineCommit: cleanBaselineCommit } : {}),
    scope: cleanScope,
    admittedAt: cleanAdmittedAt,
    admittedBy: cleanAdmittedBy,
    admissionDigest: cleanAdmissionDigest
  };

  // Verify cryptographic admissionDigest if requested
  if (verifyDigest && cleanAdmissionDigest) {
    const expectedDigest = computeWorkspaceAdmissionDigest(normalized);
    if (cleanAdmissionDigest !== expectedDigest.toLowerCase()) {
      return handleValidationFailure(
        [`admissionDigest mismatch: expected '${expectedDigest}', got '${cleanAdmissionDigest}'`],
        schema,
        throwOnError
      );
    }
  }

  // Return deeply frozen, immutable contract representation
  return deepFreeze(normalized);
}

/**
 * Creates, digests, and deeply freezes a new WorkspaceAdmission contract.
 *
 * @param {object} params
 * @returns {object} Validated, digested, deeply frozen WorkspaceAdmission
 */
export function createWorkspaceAdmission({
  workspaceId,
  taskId,
  attemptId = 1,
  canonicalRoot,
  sourceBaselineRoot,
  sourceBaselineHash,
  baselineCommit,
  scope,
  admittedAt = Date.now(),
  admittedBy = 'coordinator'
}) {
  const preValidation = validateWorkspaceAdmission({
    schemaVersion: SCHEMA_VERSIONS.WORKSPACE_ADMISSION,
    workspaceId,
    taskId,
    attemptId,
    canonicalRoot,
    sourceBaselineRoot,
    ...(sourceBaselineHash ? { sourceBaselineHash } : {}),
    ...(baselineCommit ? { baselineCommit } : {}),
    scope,
    admittedAt,
    admittedBy
  }, { throwOnError: true, verifyDigest: false });

  const admissionDigest = computeWorkspaceAdmissionDigest(preValidation);

  return validateWorkspaceAdmission({
    ...preValidation,
    admissionDigest
  }, { throwOnError: true, verifyDigest: true });
}

/**
 * Type guard for WorkspaceAdmission.
 * @param {any} value
 * @returns {boolean}
 */
export function isWorkspaceAdmission(value) {
  try {
    const res = validateWorkspaceAdmission(value, { throwOnError: false, verifyDigest: true });
    return res && res.ok !== false;
  } catch {
    return false;
  }
}
