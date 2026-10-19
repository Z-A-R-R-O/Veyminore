/**
 * @file compatibility/rct.js
 * Compatibility adapter between RCT contracts and ZETRO Protocol v1.
 */

import {
  SCHEMA_VERSIONS,
  TaskState,
  VerificationStatus,
  WorkerReportedState,
  DataClassification,
  DEFAULT_BUDGET
} from '../constants.js';
import { ValidationError } from '../errors.js';
import { validateAssignment } from '../validators/assignment.js';
import { validateTaskResult } from '../validators/task-result.js';
import { sha256 } from '../digest.js';

const RCT_ASSIGNMENT_SCHEMA = 'rct.assignment.v1';

/**
 * Converts an RCT manifest (or admitted plan) into a Protocol Assignment.
 * @param {object} rctManifest
 * @param {object} [options]
 * @param {string|number} [options.attemptId=1]
 * @param {string} [options.agentId='RCT-1']
 * @returns {object} Validated Protocol Assignment
 */
export function rctManifestToProtocolAssignment(rctManifest, options = {}) {
  const attemptId = options.attemptId ?? 1;
  const agentId = options.agentId ?? 'RCT-1';

  // Handle acceptance: RCT manifest uses array; direct runtime may use string
  let acceptanceArray = [];
  if (Array.isArray(rctManifest.acceptance)) {
    acceptanceArray = rctManifest.acceptance;
  } else if (typeof rctManifest.acceptance === 'string') {
    acceptanceArray = [rctManifest.acceptance];
  } else {
    acceptanceArray = ['Independent checks pass'];
  }

  // Handle scope
  const scopeObj = rctManifest.scope ?? {};
  const readPaths = scopeObj.readPaths ?? [];
  const writePaths = scopeObj.writePaths ?? [];
  const createPaths = scopeObj.createPaths ?? [];
  const sourceRoot = rctManifest.sourceRoot || rctManifest.source?.root || process.cwd();

  // If manifest came from direct runtime with allowedPaths
  let effectiveRead = [...readPaths];
  let effectiveWrite = [...writePaths];
  if (effectiveRead.length === 0 && effectiveWrite.length === 0 && Array.isArray(rctManifest.allowedPaths)) {
    effectiveRead = [...rctManifest.allowedPaths];
    effectiveWrite = [...rctManifest.allowedPaths];
  }

  // Handle checks
  const checks = (rctManifest.checks ?? []).map(c => ({
    type: c.type,
    path: c.path,
    text: c.text ?? ''
  }));

  // Budget
  const budget = {
    ...DEFAULT_BUDGET,
    ...(rctManifest.budget ?? {})
  };

  // Data policy
  const dp = rctManifest.dataPolicy ?? {};
  const dataPolicy = {
    classification: dp.classification || DataClassification.PUBLIC,
    allowRemoteInference: Boolean(dp.allowRemoteInference ?? dp.remoteInferencePermitted),
    provider: dp.provider ?? null,
    model: dp.model ?? null
  };

  const deadlineMs = budget.maxWallMs ? budget.maxWallMs : 30000;

  const raw = {
    schemaVersion: SCHEMA_VERSIONS.ASSIGNMENT,
    taskId: rctManifest.taskId || rctManifest.id,
    attemptId,
    agentId,
    objective: rctManifest.objective,
    acceptance: acceptanceArray,
    scope: {
      root: sourceRoot,
      readPaths: effectiveRead,
      writePaths: effectiveWrite,
      createPaths,
      ...(scopeObj.sourceHashes ? { sourceHashes: scopeObj.sourceHashes } : {})
    },
    checks,
    budget,
    dataPolicy,
    deadlineMs
  };

  return validateAssignment(raw, { throwOnError: true });
}

/**
 * Converts a Protocol Assignment into an RCT manifest object.
 * @param {object} assignment - Protocol Assignment
 * @returns {object} RCT manifest object adhering to rct.assignment.v1
 */
export function protocolAssignmentToRctManifest(assignment) {
  const valid = validateAssignment(assignment, { throwOnError: true });

  // Reject unsupported check types (such as command checks) to prevent weakening acceptance criteria
  const unsupportedChecks = valid.checks.filter(c => c.type !== 'equals' && c.type !== 'contains');
  if (unsupportedChecks.length > 0) {
    const unsupportedTypes = [...new Set(unsupportedChecks.map(c => c.type))];
    throw new ValidationError(
      `Cannot convert Assignment to RCT manifest: check type(s) [${unsupportedTypes.join(', ')}] are not supported by rct.assignment.v1. Conversion rejected to prevent weakening acceptance criteria.`,
      unsupportedChecks.map(c => `Unsupported check type '${c.type}'`),
      'protocolAssignmentToRctManifest'
    );
  }

  return {
    schemaVersion: RCT_ASSIGNMENT_SCHEMA,
    taskId: valid.taskId,
    objective: valid.objective,
    acceptance: [...valid.acceptance],
    source: {
      root: valid.scope.root
    },
    scope: {
      readPaths: [...valid.scope.readPaths],
      writePaths: [...valid.scope.writePaths],
      createPaths: [...valid.scope.createPaths]
    },
    checks: valid.checks.map(c => ({
      type: c.type,
      path: c.path,
      text: c.text
    })),
    dataPolicy: {
      classification: valid.dataPolicy.classification,
      allowRemoteInference: valid.dataPolicy.allowRemoteInference,
      provider: valid.dataPolicy.provider,
      model: valid.dataPolicy.model
    },
    budget: {
      maxTurns: valid.budget.maxTurns,
      maxInputTokens: valid.budget.maxInputTokens,
      maxOutputTokens: valid.budget.maxOutputTokens,
      maxPromptChars: valid.budget.maxPromptChars,
      maxReadBytes: valid.budget.maxReadBytes,
      maxWriteBytes: valid.budget.maxWriteBytes,
      maxWallMs: valid.budget.maxWallMs
    }
  };
}

/**
 * Converts an RCT runtime receipt to a Protocol TaskResult.
 * Strictly separates worker claims, mutations, independent checks, and uncertainty.
 *
 * @param {object} rctReceipt - Output from RCT runAssignment
 * @param {object} [options]
 * @param {string|number} [options.attemptId=1]
 * @param {string} [options.agentId='RCT-1']
 * @param {string} [options.verifierId='rct_runtime_verifier']
 * @returns {object} Protocol TaskResult
 */
export function rctReceiptToTaskResult(rctReceipt, options = {}) {
  const attemptId = options.attemptId ?? 1;
  const agentId = options.agentId ?? 'RCT-1';
  const verifierId = options.verifierId ?? 'rct_runtime_verifier';

  const checks = Array.isArray(rctReceipt.checks) ? rctReceipt.checks : [];
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      throw new ValidationError(`rctReceipt.checks[${i}] must be an object`, ['malformed check object'], 'rctReceiptToTaskResult');
    }
    if (typeof c.passed !== 'boolean') {
      throw new ValidationError(
        `rctReceipt.checks[${i}].passed must be a boolean (strict true or false), got ${typeof c.passed === 'string' ? `'${c.passed}'` : String(c.passed)}`,
        ['Strict boolean required for rct checks; truthiness coercion rejected'],
        'rctReceiptToTaskResult'
      );
    }
  }
  const patches = Array.isArray(rctReceipt.patches) ? rctReceipt.patches : [];
  const checksPassed = checks.length > 0 && checks.every(c => c.passed === true);

  let status;
  let verificationStatus;
  let verified = false;

  if (rctReceipt.state === 'review_ready') {
    if (checksPassed) {
      status = TaskState.COMPLETED;
      verificationStatus = VerificationStatus.PASSED;
      verified = true;
    } else {
      status = TaskState.FAILED;
      verificationStatus = VerificationStatus.FAILED;
      verified = false;
    }
  } else if (rctReceipt.state === 'unknown') {
    status = TaskState.UNKNOWN;
    verificationStatus = VerificationStatus.INCONCLUSIVE;
    verified = false;
  } else {
    status = TaskState.FAILED;
    verificationStatus = checks.length > 0 ? (checksPassed ? VerificationStatus.PASSED : VerificationStatus.FAILED) : VerificationStatus.NOT_REQUESTED;
    verified = false;
  }

  // Format proposedPatches
  const proposedPatches = patches.map(p => ({
    path: p.path,
    beforeHash: p.before ? sha256(p.before) : null,
    afterHash: p.after ? (p.after.length === 64 ? p.after : sha256(p.after)) : sha256(''),
    bytesChanged: p.after ? Buffer.byteLength(p.after) : 0
  }));

  // Format effects
  const appliedPatches = patches.filter(p => p.applied);
  const effects = {
    applied: appliedPatches.length > 0,
    changedFiles: appliedPatches.map(p => p.path),
    patchHashes: appliedPatches.map(p => (p.after?.length === 64 ? p.after : sha256(p.after || '')))
  };

  // Format checkResults
  const checkResults = checks.map((c, i) => ({
    checkId: `rct-check-${i}`,
    path: c.path ?? null,
    passed: c.passed,
    details: {
      type: c.type,
      sha256: c.sha256,
      expectedBytes: c.expectedBytes,
      actualBytes: c.actualBytes
    }
  }));

  const isUncertain = Boolean(rctReceipt.remoteUsageUncertain || rctReceipt.state === 'unknown');
  const uncertaintyReasons = [];
  if (rctReceipt.remoteUsageUncertain) {
    uncertaintyReasons.push('remote_transport_uncertainty');
  }
  if (rctReceipt.state === 'unknown') {
    uncertaintyReasons.push(rctReceipt.failureReason || 'unknown_transport_error');
  }

  const rawResult = {
    schemaVersion: SCHEMA_VERSIONS.TASK_RESULT,
    taskId: rctReceipt.id,
    attemptId,
    agentId,
    status,
    workerClaim: {
      reportedState: rctReceipt.state === 'failed' ? WorkerReportedState.FAILED : WorkerReportedState.SUBMITTED,
      summary: typeof rctReceipt.workerSummary === 'string' ? rctReceipt.workerSummary.slice(0, 2000) : '',
      proposedPatches
    },
    effects,
    verification: {
      verified,
      status: verificationStatus,
      verifierId,
      checkResults
    },
    uncertainty: {
      isUncertain,
      reasons: uncertaintyReasons,
      unconfirmedAttempts: isUncertain ? 1 : 0
    },
    usage: {
      ...(rctReceipt.usage ?? {}),
      elapsedMs: rctReceipt.elapsedMs ?? 0
    },
    completedAt: Date.now()
  };

  return validateTaskResult(rawResult, { throwOnError: true });
}
