/**
 * @file compatibility/dispatcher.js
 * Compatibility adapter between orchestration-core Dispatcher and ZETRO Protocol v1.
 * Preserves partitioned authority (read/write/create) across roundtrips and strictly
 * isolates raw worker check claims from independent verifier evidence.
 */

import {
  SCHEMA_VERSIONS,
  TaskState,
  VerificationStatus,
  WorkerReportedState,
  DEFAULT_BUDGET
} from '../constants.js';
import { ValidationError } from '../errors.js';
import { validateAssignment } from '../validators/assignment.js';
import { validateTaskResult } from '../validators/task-result.js';

export const DispatcherStates = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUBMITTED: 'SUBMITTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN'
});

/**
 * Converts a Dispatcher TaskEnvelope to a Protocol Assignment.
 * Preserves partitioned scope if provided as structured scope/allowedPaths object.
 *
 * @param {object} envelope - Dispatcher TaskEnvelope
 * @param {object} [options]
 * @param {string|number} [options.attemptId=1]
 * @param {string} [options.sourceRoot]
 * @param {boolean} [options.rejectFlatAllowedPaths=false] - Reject ambiguous flat allowedPaths
 * @returns {object} Validated Protocol Assignment
 */
export function dispatcherEnvelopeToProtocolAssignment(envelope, options = {}) {
  const attemptId = options.attemptId ?? 1;
  const sourceRoot = options.sourceRoot || process.cwd();

  // Extract scope preserving read, write, and create partitions
  let readPaths = [];
  let writePaths = [];
  let createPaths = [];

  if (envelope.scope && typeof envelope.scope === 'object' && !Array.isArray(envelope.scope)) {
    readPaths = Array.isArray(envelope.scope.readPaths) ? envelope.scope.readPaths : [];
    writePaths = Array.isArray(envelope.scope.writePaths) ? envelope.scope.writePaths : [];
    createPaths = Array.isArray(envelope.scope.createPaths) ? envelope.scope.createPaths : [];
  } else if (envelope.allowedPaths && typeof envelope.allowedPaths === 'object' && !Array.isArray(envelope.allowedPaths)) {
    readPaths = Array.isArray(envelope.allowedPaths.readPaths) ? envelope.allowedPaths.readPaths : [];
    writePaths = Array.isArray(envelope.allowedPaths.writePaths) ? envelope.allowedPaths.writePaths : [];
    createPaths = Array.isArray(envelope.allowedPaths.createPaths) ? envelope.allowedPaths.createPaths : [];
  } else if (Array.isArray(envelope.allowedPaths)) {
    if (options.rejectFlatAllowedPaths) {
      throw new ValidationError(
        'Ambiguous authority: flat allowedPaths does not distinguish readPaths from writePaths',
        ['Envelope must supply structured scope or allowedPaths object to preserve authority partitions'],
        'dispatcherEnvelopeToProtocolAssignment'
      );
    }
    readPaths = envelope.allowedPaths;
    writePaths = envelope.allowedPaths;
  }

  const acceptance = typeof envelope.acceptance === 'string'
    ? [envelope.acceptance]
    : (Array.isArray(envelope.acceptance) ? envelope.acceptance : ['Verification passes']);

  // Extract checks if specified, or construct a command check from envelope.verification
  const checks = [];
  if (Array.isArray(envelope.checks) && envelope.checks.length > 0) {
    checks.push(...envelope.checks);
  } else if (typeof envelope.verification === 'string' && envelope.verification.length > 0) {
    checks.push({
      type: 'command',
      command: envelope.verification.split(' ').filter(Boolean)
    });
  } else {
    checks.push({
      type: 'command',
      command: ['npm', 'test']
    });
  }

  const budget = {
    ...DEFAULT_BUDGET,
    maxContextChars: envelope.budget?.maxContextChars ?? DEFAULT_BUDGET.maxContextChars,
    maxReplyChars: envelope.budget?.maxReplyChars ?? DEFAULT_BUDGET.maxReplyChars
  };

  const raw = {
    schemaVersion: SCHEMA_VERSIONS.ASSIGNMENT,
    taskId: envelope.id,
    attemptId,
    agentId: envelope.agent,
    objective: envelope.objective,
    acceptance,
    scope: {
      root: sourceRoot,
      readPaths,
      writePaths,
      createPaths
    },
    checks,
    budget,
    dataPolicy: {
      classification: 'public',
      allowRemoteInference: false
    },
    deadlineMs: envelope.deadlineMs ?? 30000,
    metadata: {
      contextRefs: Array.isArray(envelope.contextRefs) ? envelope.contextRefs : []
    }
  };

  return validateAssignment(raw, { throwOnError: true });
}

/**
 * Converts a Protocol Assignment to a Dispatcher TaskEnvelope.
 * Returns allowedPaths as an Array to satisfy Dispatcher.validateEnvelope.
 * Rejects unsupported asymmetric conversion until the consumer explicitly supports partitions.
 *
 * @param {object} assignment - Protocol Assignment
 * @param {object} [options]
 * @param {boolean} [options.allowAsymmetricFlattening=false] - Explicitly permit flattening asymmetric scopes
 * @returns {object} Dispatcher TaskEnvelope conforming to Dispatcher.validateEnvelope
 */
export function protocolAssignmentToDispatcherEnvelope(assignment, options = {}) {
  const valid = validateAssignment(assignment, { throwOnError: true });

  const partitionedScope = {
    readPaths: [...valid.scope.readPaths],
    writePaths: [...valid.scope.writePaths],
    createPaths: [...valid.scope.createPaths]
  };

  const isAsymmetric =
    valid.scope.readPaths.length !== valid.scope.writePaths.length ||
    valid.scope.createPaths.length > 0 ||
    valid.scope.readPaths.some((p, i) => p !== valid.scope.writePaths[i]);

  if (isAsymmetric && !options.allowAsymmetricFlattening) {
    throw new ValidationError(
      'Cannot convert Assignment to Dispatcher TaskEnvelope: Dispatcher requires allowedPaths to be a flat array and does not yet support partitioned read/write/create scopes. Asymmetric conversion rejected to prevent granting write authority to read-only paths.',
      ['Scope is asymmetric: readPaths != writePaths or createPaths is non-empty'],
      'protocolAssignmentToDispatcherEnvelope'
    );
  }

  // To produce a valid consumer envelope for Dispatcher.validateEnvelope, allowedPaths MUST be an Array.
  // For symmetric scopes, valid.scope.writePaths equals readPaths, so no elevation occurs.
  // For explicitly flattened asymmetric scopes, it collapses all unique paths.
  const allowedPaths = isAsymmetric
    ? [...new Set([...valid.scope.readPaths, ...valid.scope.writePaths, ...valid.scope.createPaths])]
    : [...valid.scope.writePaths];

  let verification = 'npm test';
  if (valid.checks.length > 0) {
    const firstCheck = valid.checks[0];
    if (firstCheck.type === 'command' && Array.isArray(firstCheck.command)) {
      verification = firstCheck.command.join(' ');
    } else if (firstCheck.type === 'equals' || firstCheck.type === 'contains') {
      verification = `${firstCheck.type}:${firstCheck.path}`;
    }
  }

  return {
    id: valid.taskId,
    agent: valid.agentId,
    objective: valid.objective,
    contextRefs: valid.metadata?.contextRefs ?? [],
    allowedPaths, // Guaranteed to be an Array matching Dispatcher.validateEnvelope
    scope: partitionedScope, // Preserved partition metadata in envelope.scope
    acceptance: valid.acceptance.join('; '),
    verification,
    deadlineMs: valid.deadlineMs,
    budget: {
      maxContextChars: valid.budget.maxContextChars,
      maxReplyChars: valid.budget.maxReplyChars
    }
  };
}

/**
 * Converts a Dispatcher TaskReceipt to a Protocol TaskResult.
 * Strictly preserves ALL receipt.checks as unverified worker claims.
 * Only explicitly supplied options.trustedChecks may verify, with explicit options.verifierId.
 * Never invents independent verifier evidence or verifier identity.
 *
 * @param {object} receipt - Dispatcher TaskReceipt
 * @param {object} [options]
 * @param {string|number} [options.attemptId=1]
 * @param {string} [options.verifierId] - Explicit trusted verifier identity (required when trustedChecks provided)
 * @param {Array<object>} [options.trustedChecks] - Explicitly supplied independent check results
 * @returns {object} Protocol TaskResult
 */
export function dispatcherReceiptToTaskResult(receipt, options = {}) {
  const attemptId = options.attemptId ?? 1;

  // ALL checks from receipt.checks are unverified worker claims (strings, structured objects, or mixed)
  const rawWorkerChecks = Array.isArray(receipt.checks) ? [...receipt.checks] : [];
  const legacyStringChecks = rawWorkerChecks.filter(c => typeof c === 'string');

  const stateStr = String(receipt.state).toUpperCase();
  const workerClaim = {
    reportedState: stateStr === DispatcherStates.COMPLETED
      ? WorkerReportedState.SUBMITTED
      : WorkerReportedState.FAILED,
    summary: typeof receipt.summary === 'string' ? receipt.summary.slice(0, 2000) : '',
    proposedPatches: [],
    rawChecks: rawWorkerChecks,
    legacyCheckLabels: legacyStringChecks
  };

  // Only explicitly supplied options.trustedChecks may provide verification evidence
  let verified = false;
  let verificationStatus = VerificationStatus.NOT_REQUESTED;
  let verifierId = 'none';
  let checkResults = [];

  if (options.trustedChecks !== undefined) {
    if (!Array.isArray(options.trustedChecks)) {
      throw new ValidationError(
        'options.trustedChecks must be an array',
        ['options.trustedChecks must be an array of check result objects'],
        'dispatcherReceiptToTaskResult'
      );
    }

    if (options.trustedChecks.length > 0) {
      if (!options.verifierId || typeof options.verifierId !== 'string' || options.verifierId.trim() === '') {
        throw new ValidationError(
          'options.trustedChecks requires an explicit non-empty options.verifierId',
          ['Explicit verifier identity is required when supplying trusted checks; cannot invent verifier'],
          'dispatcherReceiptToTaskResult'
        );
      }
      verifierId = options.verifierId.trim();
      checkResults = options.trustedChecks.map((c, i) => {
        if (!c || typeof c !== 'object' || Array.isArray(c)) {
          throw new ValidationError(
            `trustedChecks[${i}] must be an object`,
            [`trustedChecks[${i}] must be an object`],
            'dispatcherReceiptToTaskResult'
          );
        }
        if (typeof c.passed !== 'boolean') {
          throw new ValidationError(
            `trustedChecks[${i}].passed must be a boolean (strict true or false), got ${typeof c.passed === 'string' ? `'${c.passed}'` : String(c.passed)}`,
            [`trustedChecks[${i}].passed must be a strict boolean; truthiness coercion rejected`],
            'dispatcherReceiptToTaskResult'
          );
        }
        return {
          checkId: c.checkId || `trusted-check-${i}`,
          path: c.path ?? null,
          passed: c.passed,
          details: c.details && typeof c.details === 'object' ? { ...c.details } : {}
        };
      });

      const allPassed = checkResults.every(c => c.passed === true);
      if (allPassed) {
        verified = true;
        verificationStatus = VerificationStatus.PASSED;
      } else {
        verified = false;
        verificationStatus = VerificationStatus.FAILED;
      }
    }
  }

  // Determine authoritative TaskState status
  let status;
  if (stateStr === DispatcherStates.COMPLETED) {
    // Completed status STRICTLY requires verified === true (proven by trustedChecks)
    if (verified) {
      status = TaskState.COMPLETED;
    } else {
      // Without passing trusted checks, a worker-claimed COMPLETED must resolve to FAILED
      status = TaskState.FAILED;
    }
  } else if (stateStr === DispatcherStates.CANCELLED) {
    status = TaskState.CANCELLED;
  } else if (stateStr === DispatcherStates.UNKNOWN) {
    status = TaskState.UNKNOWN;
  } else {
    status = TaskState.FAILED;
  }

  const isUncertain = status === TaskState.UNKNOWN || Boolean(receipt.uncertainty);
  const uncertaintyReasons = [];
  if (receipt.uncertainty) {
    uncertaintyReasons.push(String(receipt.uncertainty));
  } else if (status === TaskState.UNKNOWN) {
    uncertaintyReasons.push('dispatcher_reported_unknown');
  }

  if (stateStr === DispatcherStates.COMPLETED && !verified) {
    uncertaintyReasons.push('unverified_worker_receipt: receipt claimed completed but lacks explicitly supplied trustedChecks with passed status');
  }

  const raw = {
    schemaVersion: SCHEMA_VERSIONS.TASK_RESULT,
    taskId: receipt.id,
    attemptId,
    agentId: receipt.agent,
    status,
    workerClaim,
    effects: {
      applied: Array.isArray(receipt.changedFiles) && receipt.changedFiles.length > 0,
      changedFiles: Array.isArray(receipt.changedFiles) ? receipt.changedFiles : [],
      patchHashes: []
    },
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
    usage: {},
    completedAt: Date.now()
  };

  return validateTaskResult(raw, { throwOnError: true });
}

/**
 * Converts a Protocol TaskResult to a Dispatcher TaskReceipt.
 * @param {object} taskResult - Protocol TaskResult
 * @returns {object} Dispatcher TaskReceipt
 */
export function taskResultToDispatcherReceipt(taskResult) {
  const valid = validateTaskResult(taskResult, { throwOnError: true });

  let state = DispatcherStates.FAILED;
  if (valid.status === TaskState.COMPLETED) {
    state = DispatcherStates.COMPLETED;
  } else if (valid.status === TaskState.CANCELLED) {
    state = DispatcherStates.CANCELLED;
  } else if (valid.status === TaskState.UNKNOWN) {
    state = DispatcherStates.UNKNOWN;
  }

  // Preserve worker's raw checks or verification check strings
  const checks = valid.workerClaim.rawChecks && valid.workerClaim.rawChecks.length > 0
    ? [...valid.workerClaim.rawChecks]
    : valid.verification.checkResults.map(cr => `${cr.checkId}: ${cr.passed ? 'passed' : 'failed'}`);

  return {
    id: valid.taskId,
    agent: valid.agentId,
    state,
    changedFiles: [...valid.effects.changedFiles],
    checks,
    evidenceRefs: [],
    summary: valid.workerClaim.summary,
    uncertainty: valid.uncertainty.isUncertain ? valid.uncertainty.reasons.join(', ') : ''
  };
}
