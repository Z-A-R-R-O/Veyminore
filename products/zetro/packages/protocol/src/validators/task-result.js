/**
 * @file validators/task-result.js
 * Runtime validator for TaskResult (zetro.protocol.task_result.v1).
 * Strictly separates worker claims, mutations/effects, independent verification, and uncertainty.
 */

import {
  SCHEMA_VERSIONS,
  TaskState,
  VerificationStatus,
  WorkerReportedState
} from '../constants.js';
import { handleValidationFailure } from '../errors.js';
import { validateRelativePath } from '../path.js';

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const HEX_SHA256_REGEX = /^[a-f0-9]{64}$/i;

function isNonEmptyObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Validates a TaskResult against zetro.protocol.task_result.v1.
 * Enforces fail-closed validation for false verified states.
 *
 * @param {any} input
 * @param {{ throwOnError?: boolean }} [options]
 * @returns {object} Normalized TaskResult object
 */
export function validateTaskResult(input, { throwOnError = true } = {}) {
  const errors = [];
  const schema = SCHEMA_VERSIONS.TASK_RESULT;

  if (!isNonEmptyObject(input)) {
    return handleValidationFailure(['TaskResult must be a non-null object'], schema, throwOnError);
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
    errors.push('attemptId is required and must be distinct from taskId');
  }

  // agentId
  if (typeof input.agentId !== 'string' || !ID_REGEX.test(input.agentId)) {
    errors.push('agentId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  // status (terminal or current task state)
  const allowedStates = [TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED, TaskState.UNKNOWN];
  if (!allowedStates.includes(input.status)) {
    errors.push(`status must be one of: ${allowedStates.join(', ')}, got '${input.status}'`);
  }

  // workerClaim
  const cleanWorkerClaim = {
    reportedState: WorkerReportedState.SUBMITTED,
    summary: '',
    proposedPatches: []
  };

  if (!isNonEmptyObject(input.workerClaim)) {
    errors.push('workerClaim must be an object');
  } else {
    const validReported = Object.values(WorkerReportedState);
    if (!validReported.includes(input.workerClaim.reportedState)) {
      errors.push(`workerClaim.reportedState must be one of: ${validReported.join(', ')}`);
    } else {
      cleanWorkerClaim.reportedState = input.workerClaim.reportedState;
    }

    if (input.workerClaim.summary !== undefined) {
      if (typeof input.workerClaim.summary !== 'string' || input.workerClaim.summary.length > 2000) {
        errors.push('workerClaim.summary must be a string up to 2000 characters');
      } else {
        cleanWorkerClaim.summary = input.workerClaim.summary;
      }
    }

    if (input.workerClaim.proposedPatches !== undefined) {
      if (!Array.isArray(input.workerClaim.proposedPatches)) {
        errors.push('workerClaim.proposedPatches must be an array');
      } else {
        for (let i = 0; i < input.workerClaim.proposedPatches.length; i++) {
          const p = input.workerClaim.proposedPatches[i];
          if (!isNonEmptyObject(p)) {
            errors.push(`workerClaim.proposedPatches[${i}] must be an object`);
            continue;
          }
          const pathRes = validateRelativePath(p.path);
          if (!pathRes.ok) {
            errors.push(`workerClaim.proposedPatches[${i}].path is invalid: ${pathRes.reason}`);
          }
          if (p.beforeHash !== null && p.beforeHash !== undefined) {
            if (typeof p.beforeHash !== 'string' || !HEX_SHA256_REGEX.test(p.beforeHash)) {
              errors.push(`workerClaim.proposedPatches[${i}].beforeHash must be 64-char hex or null`);
            }
          }
          if (typeof p.afterHash !== 'string' || !HEX_SHA256_REGEX.test(p.afterHash)) {
            errors.push(`workerClaim.proposedPatches[${i}].afterHash must be a 64-character hex string`);
          }
          if (p.bytesChanged !== undefined) {
            if (!Number.isSafeInteger(p.bytesChanged) || p.bytesChanged < 0) {
              errors.push(`workerClaim.proposedPatches[${i}].bytesChanged must be a non-negative integer`);
            }
          }
          cleanWorkerClaim.proposedPatches.push({
            path: pathRes.canonical ?? p.path,
            beforeHash: p.beforeHash ? p.beforeHash.toLowerCase() : null,
            afterHash: (p.afterHash || '').toLowerCase(),
            bytesChanged: p.bytesChanged ?? 0
          });
        }
      }
    }

    if (input.workerClaim.legacyCheckLabels !== undefined) {
      if (!Array.isArray(input.workerClaim.legacyCheckLabels)) {
        errors.push('workerClaim.legacyCheckLabels must be an array of strings');
      } else {
        cleanWorkerClaim.legacyCheckLabels = input.workerClaim.legacyCheckLabels
          .filter(l => typeof l === 'string')
          .map(l => l.slice(0, 500));
      }
    }

    if (input.workerClaim.rawChecks !== undefined) {
      if (!Array.isArray(input.workerClaim.rawChecks)) {
        errors.push('workerClaim.rawChecks must be an array');
      } else {
        cleanWorkerClaim.rawChecks = [...input.workerClaim.rawChecks];
      }
    }
  }

  // effects (actual mutations)
  const cleanEffects = {
    applied: false,
    changedFiles: [],
    patchHashes: [],
    diffSummary: undefined
  };

  if (!isNonEmptyObject(input.effects)) {
    errors.push('effects must be an object');
  } else {
    if (typeof input.effects.applied !== 'boolean') {
      errors.push('effects.applied must be a boolean');
    } else {
      cleanEffects.applied = input.effects.applied;
    }

    if (!Array.isArray(input.effects.changedFiles)) {
      errors.push('effects.changedFiles must be an array');
    } else {
      for (let i = 0; i < input.effects.changedFiles.length; i++) {
        const pathRes = validateRelativePath(input.effects.changedFiles[i]);
        if (!pathRes.ok) {
          errors.push(`effects.changedFiles[${i}] is invalid: ${pathRes.reason}`);
        } else {
          cleanEffects.changedFiles.push(pathRes.canonical);
        }
      }
    }

    if (!Array.isArray(input.effects.patchHashes)) {
      errors.push('effects.patchHashes must be an array');
    } else {
      for (let i = 0; i < input.effects.patchHashes.length; i++) {
        const h = input.effects.patchHashes[i];
        if (typeof h !== 'string' || !HEX_SHA256_REGEX.test(h)) {
          errors.push(`effects.patchHashes[${i}] must be a 64-character hex string`);
        } else {
          cleanEffects.patchHashes.push(h.toLowerCase());
        }
      }
    }

    if (input.effects.diffSummary !== undefined) {
      if (typeof input.effects.diffSummary !== 'string' || input.effects.diffSummary.length > 4000) {
        errors.push('effects.diffSummary must be a string up to 4000 characters');
      } else {
        cleanEffects.diffSummary = input.effects.diffSummary;
      }
    }
  }

  // verification (independent verification)
  const cleanVerification = {
    verified: false,
    status: VerificationStatus.NOT_REQUESTED,
    verifierId: 'none',
    checkResults: []
  };

  if (!isNonEmptyObject(input.verification)) {
    errors.push('verification must be an object');
  } else {
    if (typeof input.verification.verified !== 'boolean') {
      errors.push('verification.verified must be a boolean');
    } else {
      cleanVerification.verified = input.verification.verified;
    }

    const validVerifStatuses = Object.values(VerificationStatus);
    if (!validVerifStatuses.includes(input.verification.status)) {
      errors.push(`verification.status must be one of: ${validVerifStatuses.join(', ')}`);
    } else {
      cleanVerification.status = input.verification.status;
    }

    if (typeof input.verification.verifierId !== 'string' || input.verification.verifierId.length === 0) {
      errors.push('verification.verifierId must be a non-empty string');
    } else {
      cleanVerification.verifierId = input.verification.verifierId;
    }

    if (!Array.isArray(input.verification.checkResults)) {
      errors.push('verification.checkResults must be an array');
    } else {
      for (let i = 0; i < input.verification.checkResults.length; i++) {
        const cr = input.verification.checkResults[i];
        if (!isNonEmptyObject(cr)) {
          errors.push(`verification.checkResults[${i}] must be an object`);
          continue;
        }
        if (typeof cr.passed !== 'boolean') {
          errors.push(`verification.checkResults[${i}].passed must be a boolean`);
        }
        cleanVerification.checkResults.push({
          checkId: typeof cr.checkId === 'string' ? cr.checkId : (cr.type ?? `check-${i}`),
          path: cr.path ?? null,
          passed: Boolean(cr.passed),
          details: cr.details && typeof cr.details === 'object' ? { ...cr.details } : {}
        });
      }
    }
  }

  // uncertainty
  const cleanUncertainty = {
    isUncertain: false,
    reasons: [],
    unconfirmedAttempts: 0
  };

  if (!isNonEmptyObject(input.uncertainty)) {
    errors.push('uncertainty must be an object');
  } else {
    if (typeof input.uncertainty.isUncertain !== 'boolean') {
      errors.push('uncertainty.isUncertain must be a boolean');
    } else {
      cleanUncertainty.isUncertain = input.uncertainty.isUncertain;
    }

    if (!Array.isArray(input.uncertainty.reasons)) {
      errors.push('uncertainty.reasons must be an array');
    } else {
      for (const r of input.uncertainty.reasons) {
        if (typeof r !== 'string' || r.length === 0) {
          errors.push('uncertainty.reasons items must be non-empty strings');
        } else {
          cleanUncertainty.reasons.push(r);
        }
      }
    }

    if (input.uncertainty.unconfirmedAttempts !== undefined) {
      if (!Number.isSafeInteger(input.uncertainty.unconfirmedAttempts) || input.uncertainty.unconfirmedAttempts < 0) {
        errors.push('uncertainty.unconfirmedAttempts must be a non-negative integer');
      } else {
        cleanUncertainty.unconfirmedAttempts = input.uncertainty.unconfirmedAttempts;
      }
    }
  }

  // usage
  const cleanUsage = {};
  if (input.usage !== undefined) {
    if (!isNonEmptyObject(input.usage)) {
      errors.push('usage if provided must be an object');
    } else {
      for (const [k, v] of Object.entries(input.usage)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          cleanUsage[k] = v;
        }
      }
    }
  }

  // completedAt
  let cleanCompletedAt = Date.now();
  if (input.completedAt !== undefined) {
    if (typeof input.completedAt === 'number') {
      if (!Number.isFinite(input.completedAt)) {
        errors.push('completedAt (number) must be finite');
      } else {
        cleanCompletedAt = input.completedAt;
      }
    } else if (typeof input.completedAt === 'string') {
      cleanCompletedAt = input.completedAt;
    } else {
      errors.push('completedAt must be a timestamp string or epoch number');
    }
  }

  // =========================================================================
  // CRITICAL FAIL-CLOSED RULES: FALSE VERIFIED STATES & SEPARATION OF CONCERNS
  // =========================================================================

  // 1. Task completed requires true verification
  if (input.status === TaskState.COMPLETED) {
    if (!cleanVerification.verified) {
      errors.push('TaskResult status cannot be completed when verification.verified is false');
    }
    if (cleanVerification.status !== VerificationStatus.PASSED) {
      errors.push(`TaskResult status cannot be completed when verification.status is '${cleanVerification.status}'`);
    }
    if (cleanVerification.checkResults.length === 0) {
      errors.push('TaskResult status cannot be completed without at least one verification check');
    }
    if (cleanVerification.checkResults.some(cr => !cr.passed)) {
      errors.push('TaskResult status cannot be completed when one or more verification checks failed');
    }
    if (cleanUncertainty.isUncertain) {
      errors.push('TaskResult status cannot be completed while uncertainty.isUncertain is true');
    }
  }

  // 2. Verified true requires passed status and passing checks
  if (cleanVerification.verified) {
    if (cleanVerification.status !== VerificationStatus.PASSED) {
      errors.push(`verification.verified cannot be true when verification.status is '${cleanVerification.status}'`);
    }
    if (cleanVerification.checkResults.length === 0) {
      errors.push('verification.verified cannot be true without check results');
    }
    if (cleanVerification.checkResults.some(cr => !cr.passed)) {
      errors.push('verification.verified cannot be true when some checkResults failed');
    }
    if (cleanVerification.verifierId === 'none' || cleanVerification.verifierId === '') {
      errors.push('verification.verified cannot be true without a valid verifierId');
    }
  }

  // 3. Worker claim alone cannot verify
  // (Worker submitting does not set verification.verified; this is checked above since verified requires checkResults)

  // 4. Unknown status requires uncertainty record
  if (input.status === TaskState.UNKNOWN) {
    if (!cleanUncertainty.isUncertain) {
      errors.push("TaskResult status 'unknown' requires uncertainty.isUncertain to be true");
    }
    if (cleanUncertainty.reasons.length === 0) {
      errors.push("TaskResult status 'unknown' requires at least one uncertainty reason");
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
    status: input.status,
    workerClaim: cleanWorkerClaim,
    effects: cleanEffects,
    verification: cleanVerification,
    uncertainty: cleanUncertainty,
    usage: cleanUsage,
    completedAt: cleanCompletedAt
  };
}

/**
 * Type guard for TaskResult.
 * @param {any} value
 * @returns {boolean}
 */
export function isTaskResult(value) {
  try {
    const res = validateTaskResult(value, { throwOnError: false });
    return res && res.ok !== false;
  } catch {
    return false;
  }
}
