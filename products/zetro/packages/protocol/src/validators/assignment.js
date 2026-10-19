/**
 * @file validators/assignment.js
 * Runtime validator for Assignment (zetro.protocol.assignment.v1).
 */

import {
  SCHEMA_VERSIONS,
  CheckType,
  DataClassification,
  DEFAULT_BUDGET,
  BUDGET_BOUNDS
} from '../constants.js';
import { handleValidationFailure } from '../errors.js';
import { validateRelativePath } from '../path.js';

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

function isNonEmptyObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function checkInteger(val, label, min, max, errors) {
  if (!Number.isSafeInteger(val) || val < min || val > max) {
    errors.push(`${label} must be an integer between ${min} and ${max}, got ${val}`);
    return false;
  }
  return true;
}

/**
 * Validates an Assignment payload against the zetro.protocol.assignment.v1 schema.
 * @param {any} input
 * @param {{ throwOnError?: boolean }} [options]
 * @returns {object} Validated and normalized Assignment object
 */
export function validateAssignment(input, { throwOnError = true } = {}) {
  const errors = [];
  const schema = SCHEMA_VERSIONS.ASSIGNMENT;

  if (!isNonEmptyObject(input)) {
    return handleValidationFailure(['Assignment must be a non-null object'], schema, throwOnError);
  }

  // schemaVersion
  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}', got '${input.schemaVersion}'`);
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

  // agentId
  if (typeof input.agentId !== 'string' || !ID_REGEX.test(input.agentId)) {
    errors.push('agentId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // objective
  if (typeof input.objective !== 'string' || input.objective.length < 3 || input.objective.length > 2000) {
    errors.push('objective must be a string between 3 and 2000 characters');
  }

  // acceptance
  if (!Array.isArray(input.acceptance) || input.acceptance.length < 1 || input.acceptance.length > 20) {
    errors.push('acceptance must be an array of 1 to 20 criteria strings');
  } else {
    for (let i = 0; i < input.acceptance.length; i++) {
      const item = input.acceptance[i];
      if (typeof item !== 'string' || item.length < 3 || item.length > 2000) {
        errors.push(`acceptance[${i}] must be a string between 3 and 2000 characters`);
      }
    }
  }

  // scope
  const cleanScope = {
    root: '',
    readPaths: [],
    writePaths: [],
    createPaths: [],
    sourceHashes: {}
  };

  if (!isNonEmptyObject(input.scope)) {
    errors.push('scope must be an object with root, readPaths, writePaths');
  } else {
    // root
    if (typeof input.scope.root !== 'string' || input.scope.root.length < 1 || input.scope.root.length > 1024) {
      errors.push('scope.root must be a non-empty string up to 1024 characters');
    } else {
      const rootTrimmed = input.scope.root.trim();
      if (rootTrimmed === '/' || rootTrimmed === '\\' || /^[a-zA-Z]:[/\\]?$/.test(rootTrimmed)) {
        errors.push('scope.root must not be a bare filesystem root');
      } else {
        cleanScope.root = rootTrimmed;
      }
    }

    // paths arrays
    for (const key of ['readPaths', 'writePaths', 'createPaths']) {
      const paths = input.scope[key] ?? [];
      if (!Array.isArray(paths)) {
        errors.push(`scope.${key} must be an array`);
        continue;
      }
      if (paths.length > 100) {
        errors.push(`scope.${key} exceeds 100 paths limit`);
      }
      for (let i = 0; i < paths.length; i++) {
        const res = validateRelativePath(paths[i]);
        if (!res.ok) {
          errors.push(`scope.${key}[${i}] invalid: ${res.reason}`);
        } else {
          cleanScope[key].push(res.canonical);
        }
      }
    }

    cleanScope.readPaths = [...new Set(cleanScope.readPaths)].sort();
    cleanScope.writePaths = [...new Set(cleanScope.writePaths)].sort();
    cleanScope.createPaths = [...new Set(cleanScope.createPaths)].sort();

    if (cleanScope.readPaths.length === 0 && cleanScope.writePaths.length === 0 && cleanScope.createPaths.length === 0) {
      errors.push('scope must declare at least one path in readPaths, writePaths, or createPaths');
    }

    // sourceHashes
    if (input.scope.sourceHashes !== undefined) {
      if (!isNonEmptyObject(input.scope.sourceHashes)) {
        errors.push('scope.sourceHashes must be an object mapping path to hex SHA-256');
      } else {
        for (const [p, h] of Object.entries(input.scope.sourceHashes)) {
          const pathRes = validateRelativePath(p);
          if (!pathRes.ok) {
            errors.push(`scope.sourceHashes key '${p}' is invalid: ${pathRes.reason}`);
          }
          if (typeof h !== 'string' || !/^[a-f0-9]{64}$/i.test(h)) {
            errors.push(`scope.sourceHashes['${p}'] must be a 64-character hex SHA-256 string`);
          } else {
            cleanScope.sourceHashes[pathRes.canonical || p] = h.toLowerCase();
          }
        }
      }
    }
  }

  // checks
  const cleanChecks = [];
  const declaredScopePaths = new Set([
    ...cleanScope.readPaths,
    ...cleanScope.writePaths,
    ...cleanScope.createPaths
  ]);

  if (!Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 20) {
    errors.push('checks must be an array of 1 to 20 check specifications');
  } else {
    for (let i = 0; i < input.checks.length; i++) {
      const c = input.checks[i];
      if (!isNonEmptyObject(c)) {
        errors.push(`checks[${i}] must be an object`);
        continue;
      }
      const validTypes = Object.values(CheckType);
      if (!validTypes.includes(c.type)) {
        errors.push(`checks[${i}].type must be one of: ${validTypes.join(', ')}`);
        continue;
      }

      if (c.type === CheckType.EQUALS || c.type === CheckType.CONTAINS) {
        const pathRes = validateRelativePath(c.path);
        if (!pathRes.ok) {
          errors.push(`checks[${i}].path is invalid: ${pathRes.reason}`);
        } else if (!declaredScopePaths.has(pathRes.canonical)) {
          errors.push(`checks[${i}].path '${pathRes.canonical}' is not in declared scope`);
        }
        if (typeof c.text !== 'string' || c.text.length > 4096) {
          errors.push(`checks[${i}].text must be a string up to 4096 characters`);
        } else if (c.type === CheckType.CONTAINS && c.text.length === 0) {
          errors.push(`checks[${i}].text must not be empty for 'contains' check`);
        }
        cleanChecks.push({
          type: c.type,
          path: pathRes.canonical ?? c.path,
          text: c.text
        });
      } else if (c.type === CheckType.COMMAND) {
        if (!Array.isArray(c.command) || c.command.length < 1 || c.command.length > 20) {
          errors.push(`checks[${i}].command must be an array of 1 to 20 string arguments`);
        } else if (c.command.some(arg => typeof arg !== 'string' || arg.length === 0)) {
          errors.push(`checks[${i}].command must contain non-empty string arguments only`);
        } else {
          cleanChecks.push({
            type: CheckType.COMMAND,
            command: [...c.command]
          });
        }
      }
    }
  }

  // budget
  const cleanBudget = {};
  const rawBudget = input.budget ?? {};
  if (!isNonEmptyObject(rawBudget)) {
    errors.push('budget must be an object');
  } else {
    for (const [key, bounds] of Object.entries(BUDGET_BOUNDS)) {
      const val = rawBudget[key] ?? DEFAULT_BUDGET[key];
      if (checkInteger(val, `budget.${key}`, bounds.min, bounds.max, errors)) {
        cleanBudget[key] = val;
      }
    }
  }

  // dataPolicy
  const cleanDataPolicy = {
    classification: DataClassification.PUBLIC,
    allowRemoteInference: false,
    provider: null,
    model: null
  };

  if (!isNonEmptyObject(input.dataPolicy)) {
    errors.push('dataPolicy must be an object');
  } else {
    const validClassifications = Object.values(DataClassification);
    if (!validClassifications.includes(input.dataPolicy.classification)) {
      errors.push(`dataPolicy.classification must be one of: ${validClassifications.join(', ')}`);
    } else {
      cleanDataPolicy.classification = input.dataPolicy.classification;
    }

    if (typeof input.dataPolicy.allowRemoteInference !== 'boolean') {
      errors.push('dataPolicy.allowRemoteInference must be a boolean');
    } else {
      cleanDataPolicy.allowRemoteInference = input.dataPolicy.allowRemoteInference;
    }

    if (cleanDataPolicy.classification === DataClassification.SENSITIVE && cleanDataPolicy.allowRemoteInference) {
      errors.push('dataPolicy: remote inference is not permitted for sensitive data classification');
    }

    if (input.dataPolicy.provider !== undefined && input.dataPolicy.provider !== null) {
      if (typeof input.dataPolicy.provider !== 'string' || input.dataPolicy.provider.length > 64) {
        errors.push('dataPolicy.provider must be a string up to 64 characters or null');
      } else {
        cleanDataPolicy.provider = input.dataPolicy.provider;
      }
    }

    if (input.dataPolicy.model !== undefined && input.dataPolicy.model !== null) {
      if (typeof input.dataPolicy.model !== 'string' || input.dataPolicy.model.length > 128) {
        errors.push('dataPolicy.model must be a string up to 128 characters or null');
      } else {
        cleanDataPolicy.model = input.dataPolicy.model;
      }
    }
  }

  // deadlineMs
  let cleanDeadlineMs = 0;
  if (typeof input.deadlineMs !== 'number' || !Number.isSafeInteger(input.deadlineMs) || input.deadlineMs < 100) {
    errors.push('deadlineMs must be a safe integer >= 100');
  } else {
    cleanDeadlineMs = input.deadlineMs;
  }

  // metadata
  let cleanMetadata = undefined;
  if (input.metadata !== undefined) {
    if (!isNonEmptyObject(input.metadata)) {
      errors.push('metadata if provided must be an object');
    } else {
      cleanMetadata = { ...input.metadata };
    }
  }

  if (errors.length > 0) {
    return handleValidationFailure(errors, schema, throwOnError);
  }

  return {
    schemaVersion: schema,
    taskId: input.taskId,
    attemptId: input.attemptId,
    agentId: input.agentId,
    objective: input.objective,
    acceptance: [...input.acceptance],
    scope: cleanScope,
    checks: cleanChecks,
    budget: cleanBudget,
    dataPolicy: cleanDataPolicy,
    deadlineMs: cleanDeadlineMs,
    ...(cleanMetadata ? { metadata: cleanMetadata } : {})
  };
}

/**
 * Type guard for Assignment.
 * @param {any} value
 * @returns {boolean}
 */
export function isAssignment(value) {
  try {
    const res = validateAssignment(value, { throwOnError: false });
    return res && res.ok !== false;
  } catch {
    return false;
  }
}
