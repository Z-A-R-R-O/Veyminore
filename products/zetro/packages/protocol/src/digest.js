/**
 * @file digest.js
 * Cryptographic SHA-256 digests and deterministic canonical JSON serialization.
 */

import { createHash } from 'node:crypto';

/**
 * Computes SHA-256 hex digest of a string or buffer.
 * @param {string | Buffer} input
 * @returns {string} 64-character lowercase hexadecimal hash
 */
export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Deterministically serialize a value to canonical JSON.
 * - Object keys are sorted lexicographically.
 * - Arrays preserve element order with each element serialized canonical.
 * - Rejects circular structures, functions, symbols, and non-finite numbers.
 * @param {any} value
 * @param {WeakSet<object>} [seen]
 * @returns {string}
 */
export function canonicalJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Cannot canonically serialize non-finite number: ${value}`);
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'bigint') {
    return JSON.stringify(value.toString());
  }

  if (typeof value !== 'object') {
    throw new TypeError(`Unsupported type for canonical JSON serialization: ${typeof value}`);
  }

  if (seen.has(value)) {
    throw new TypeError('Circular structure detected in canonical JSON serialization');
  }
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      const items = value.map(item => (item === undefined ? 'null' : canonicalJson(item, seen)));
      return `[${items.join(',')}]`;
    }

    const keys = Object.keys(value).sort();
    const entries = [];
    for (const key of keys) {
      const val = value[key];
      if (val !== undefined && typeof val !== 'function' && typeof val !== 'symbol') {
        entries.push(`${JSON.stringify(key)}:${canonicalJson(val, seen)}`);
      }
    }
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/**
 * Computes SHA-256 digest of canonical JSON serialization.
 * @param {any} value
 * @returns {string}
 */
export function computeDigest(value) {
  return sha256(canonicalJson(value));
}

/**
 * Computes the exact-request digest for an ActionRequest.
 * Binds specifically to actionType and parameters.
 * @param {string} actionType
 * @param {object} parameters
 * @returns {string}
 */
export function computeActionRequestDigest(actionType, parameters) {
  return computeDigest({ actionType, parameters: parameters ?? {} });
}

/**
 * Computes receipt digest for an EvidenceReceipt.
 * Hashes all fields except receiptDigest itself and signature.
 * @param {object} receipt
 * @returns {string}
 */
export function computeEvidenceReceiptDigest(receipt) {
  const { receiptDigest, signedBy, ...body } = receipt;
  return computeDigest(body);
}

/**
 * Computes assignment digest for an Assignment.
 * @param {object} assignment
 * @returns {string}
 */
export function computeAssignmentDigest(assignment) {
  return computeDigest(assignment);
}

/**
 * Computes admission digest for a WorkspaceAdmission contract.
 * Hashes all fields except admissionDigest itself.
 * @param {object} admission
 * @returns {string}
 */
export function computeWorkspaceAdmissionDigest(admission) {
  const { admissionDigest, ...body } = admission;
  return computeDigest(body);
}

/**
 * Computes exact digest for a ComputerActionRequest.
 * Binds operation, target, parameters, sequence, and limits.
 * @param {object} req
 * @returns {string}
 */
export function computeComputerActionRequestDigest(req) {
  const { requestDigest, ...body } = req;
  return computeDigest({
    schemaVersion: body.schemaVersion,
    operation: body.operation,
    target: body.target ?? {},
    parameters: body.parameters ?? {},
    sequence: body.sequence,
    taskId: body.taskId,
    attemptId: body.attemptId,
    principalId: body.principalId,
    sessionId: body.sessionId,
    limits: body.limits ?? {}
  });
}

/**
 * Computes exact digest for a ComputerActionResult.
 * Hashes all fields except resultDigest itself.
 * @param {object} res
 * @returns {string}
 */
export function computeComputerActionResultDigest(res) {
  const { resultDigest, ...body } = res;
  return computeDigest(body);
}

