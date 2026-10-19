/**
 * @file policy-service.js
 * Dependency-free, fail-closed shared policy service for ZETRO.
 * Manages principal and session grants, expiry, revocation, atomic one-use
 * approval consumption, and effect-time authority rechecking with injected clock.
 *
 * NOTE: Policy enforces authorization and capability boundaries at the application layer.
 * It does NOT claim or provide OS-level hardware/kernel sandboxing.
 */

import {
  evaluateGrant,
  validateGrant,
  validateActionRequest,
  createActionRequest,
  ActionType,
  SCHEMA_VERSIONS,
  ValidationError
} from '../../protocol/src/index.js';
import { PolicyError, PolicyDeniedError, PolicyValidationError } from './errors.js';

const DENIAL_PRIORITY = Object.freeze({
  grant_revoked: 100,
  grant_expired: 90,
  grant_not_yet_valid: 85,
  exact_request_digest_mismatch: 80,
  request_already_consumed: 75,
  source_baseline_mutation_denied: 70,
  source_baseline_execution_denied: 70,
  missing_shell_cwd: 70,
  command_not_permitted: 60,
  cwd_outside_grant_scope: 55,
  workspace_root_mismatch: 52,
  missing_workspace_root: 52,
  target_outside_grant_scope: 51,
  path_outside_grant_scope: 50,
  no_cwds_in_grant_scope: 40,
  no_paths_in_grant_scope: 40,
  action_type_not_permitted: 10,
  no_grant_authorized: 0
});

/**
 * Deep clones any JSON-serializable value or object.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
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
 * Internal authoritative record holding grant state.
 * Immutable grant specifications are deeply cloned and frozen.
 * Mutable lifecycle state (revocation) is maintained internally.
 */
class StoredGrantRecord {
  constructor(validatedGrant) {
    const cloned = deepClone(validatedGrant);
    this.schemaVersion = cloned.schemaVersion;
    this.grantId = cloned.grantId;
    this.principalId = cloned.principalId;
    this.sessionId = cloned.sessionId ?? null;
    this.issuedAt = cloned.issuedAt;
    this.expiresAt = cloned.expiresAt;
    this.issuerId = cloned.issuerId;
    this.oneUse = Boolean(cloned.oneUse);

    // Deeply freeze immutable scope inside internal record
    this.scope = deepFreeze(cloned.scope);

    // Private mutable lifecycle state
    this.revoked = Boolean(cloned.revoked);
    this.revokedAt = cloned.revokedAt ?? null;
    this.revocationReason = cloned.revocationReason ?? null;
  }

  /**
   * Produces a deeply cloned and deeply frozen public Grant object.
   * Modifying any property or pushing to arrays in this object throws TypeError
   * in strict mode and cannot alter authoritative internal state.
   */
  toPublicGrant() {
    return deepFreeze({
      schemaVersion: this.schemaVersion,
      grantId: this.grantId,
      principalId: this.principalId,
      ...(this.sessionId !== null && this.sessionId !== undefined ? { sessionId: this.sessionId } : {}),
      scope: deepClone(this.scope),
      issuedAt: this.issuedAt,
      expiresAt: this.expiresAt,
      revoked: this.revoked,
      ...(this.revokedAt !== null && this.revokedAt !== undefined ? { revokedAt: this.revokedAt } : {}),
      ...(this.revocationReason !== null && this.revocationReason !== undefined ? { revocationReason: this.revocationReason } : {}),
      issuerId: this.issuerId,
      ...(this.oneUse ? { oneUse: true } : {})
    });
  }

  /**
   * Produces an evaluatable representation for Protocol's evaluateGrant().
   */
  toEvaluatableGrant() {
    return {
      schemaVersion: this.schemaVersion,
      grantId: this.grantId,
      principalId: this.principalId,
      sessionId: this.sessionId,
      scope: this.scope,
      issuedAt: this.issuedAt,
      expiresAt: this.expiresAt,
      revoked: this.revoked,
      revokedAt: this.revokedAt,
      revocationReason: this.revocationReason,
      issuerId: this.issuerId,
      oneUse: this.oneUse
    };
  }
}

export class PolicyService {
  #grants = new Map(); // grantId -> StoredGrantRecord
  #grantsByPrincipal = new Map(); // principalId -> Set<grantId>
  #grantsBySession = new Map(); // sessionId -> Set<grantId>
  #consumedRequestIds = new Set(); // Replay cache of consumed action request IDs
  #consumedExactDigests = new Set(); // Replay cache of consumed exact-request approval digests
  #clock;

  /**
   * @param {object} [options]
   * @param {() => number} [options.clock] - Injected timestamp generator in epoch ms (defaults to Date.now)
   */
  constructor(options = {}) {
    this.#clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
  }

  /**
   * Returns current time from injected clock.
   * @returns {number}
   */
  getCurrentTime() {
    return this.#clock();
  }

  /**
   * Injected clock getter.
   * @returns {() => number}
   */
  get clock() {
    return this.#clock;
  }

  /**
   * Registers a validated Grant in the policy store.
   * Input is deep-cloned on ingress to protect against caller tampering.
   * Returned Grant is deeply frozen.
   *
   * @param {object} grantInput - Grant object conforming to zetro.protocol.grant.v1
   * @returns {object} Deeply frozen public grant
   */
  issueGrant(grantInput) {
    let grant;
    try {
      // Ingress protection: deep clone before validation and storage
      grant = validateGrant(deepClone(grantInput), { throwOnError: true });
    } catch (err) {
      throw new PolicyValidationError(`Invalid grant: ${err.message}`, err.errors || [err.message]);
    }

    if (this.#grants.has(grant.grantId)) {
      const existing = this.#grants.get(grant.grantId);
      if (!existing.revoked && this.getCurrentTime() < existing.expiresAt) {
        throw new PolicyError(`Active grant already exists with ID: ${grant.grantId}`);
      }
    }

    const record = new StoredGrantRecord(grant);
    this.#grants.set(grant.grantId, record);

    // Index by principalId
    if (!this.#grantsByPrincipal.has(grant.principalId)) {
      this.#grantsByPrincipal.set(grant.principalId, new Set());
    }
    this.#grantsByPrincipal.get(grant.principalId).add(grant.grantId);

    // Index by sessionId if present
    if (grant.sessionId) {
      if (!this.#grantsBySession.has(grant.sessionId)) {
        this.#grantsBySession.set(grant.sessionId, new Set());
      }
      this.#grantsBySession.get(grant.sessionId).add(grant.grantId);
    }

    return record.toPublicGrant();
  }

  /**
   * Retrieves a grant by ID. Returns a deeply frozen copy.
   * @param {string} grantId
   * @returns {object|null}
   */
  getGrant(grantId) {
    const record = this.#grants.get(grantId);
    return record ? record.toPublicGrant() : null;
  }

  /**
   * Retrieves active (unrevoked, non-expired) grants matching optional filters.
   * Returns a frozen array containing deeply frozen grants.
   *
   * @param {object} [filter]
   * @param {string} [filter.principalId]
   * @param {string} [filter.sessionId]
   * @param {string} [filter.actionType]
   * @returns {readonly object[]} Frozen array of deeply frozen active grants
   */
  getActiveGrants(filter = {}) {
    const clock = this.getCurrentTime();
    const result = [];

    for (const record of this.#grants.values()) {
      if (record.revoked) continue;
      if (clock >= record.expiresAt) continue;
      if (filter.principalId && record.principalId !== filter.principalId) continue;
      if (filter.sessionId && record.sessionId !== filter.sessionId) continue;
      if (filter.actionType && !record.scope.actionTypes.includes(filter.actionType)) continue;

      result.push(record.toPublicGrant());
    }

    return Object.freeze(result);
  }

  /**
   * Revokes a specific grant by ID.
   *
   * @param {string} grantId
   * @param {string} [reason='manual_revocation']
   * @returns {boolean} True if grant was found and revoked
   */
  revokeGrant(grantId, reason = 'manual_revocation') {
    const record = this.#grants.get(grantId);
    if (!record) return false;
    record.revoked = true;
    record.revokedAt = this.getCurrentTime();
    record.revocationReason = String(reason).slice(0, 500);
    return true;
  }

  /**
   * Revokes all grants associated with a given sessionId.
   *
   * @param {string} sessionId
   * @param {string} [reason='session_revoked']
   * @returns {number} Number of grants revoked
   */
  revokeSession(sessionId, reason = 'session_revoked') {
    if (!sessionId) return 0;
    const grantIds = this.#grantsBySession.get(sessionId);
    if (!grantIds) return 0;

    let count = 0;
    for (const grantId of grantIds) {
      if (this.revokeGrant(grantId, reason)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Revokes all grants associated with a given principalId.
   *
   * @param {string} principalId
   * @param {string} [reason='principal_revoked']
   * @returns {number} Number of grants revoked
   */
  revokePrincipal(principalId, reason = 'principal_revoked') {
    if (!principalId) return 0;
    const grantIds = this.#grantsByPrincipal.get(principalId);
    if (!grantIds) return 0;

    let count = 0;
    for (const grantId of grantIds) {
      if (this.revokeGrant(grantId, reason)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Emergency stop: immediately revokes all registered grants.
   *
   * @param {string} [reason='emergency_stop']
   * @returns {number} Total number of grants revoked
   */
  revokeAll(reason = 'emergency_stop') {
    let count = 0;
    for (const record of this.#grants.values()) {
      if (!record.revoked) {
        record.revoked = true;
        record.revokedAt = this.getCurrentTime();
        record.revocationReason = String(reason).slice(0, 500);
        count++;
      }
    }
    return count;
  }

  /**
   * Evaluates an ActionRequest against active policy grants without consuming approval tokens.
   * Fail-closed: any failure to match, expired grant, revoked grant, or missing identity denies.
   *
   * @param {object} rawRequest - ActionRequest or parameters to create one
   * @param {object} [options]
   * @param {string} [options.grantId] - Explicit grant ID to evaluate against
   * @param {boolean} [options.verifyDigest=true] - Verify action request SHA-256 digest
   * @returns {{ granted: boolean, reason: string, grantId?: string, details?: object }}
   */
  evaluate(rawRequest, options = {}) {
    let actionRequest;
    try {
      actionRequest = validateActionRequest(rawRequest, {
        throwOnError: true,
        verifyDigest: options.verifyDigest ?? true
      });
    } catch (err) {
      return {
        granted: false,
        reason: 'invalid_request',
        details: { error: err.message, errors: err.errors || [err.message] }
      };
    }

    const clock = this.getCurrentTime();

    // 1. If explicit grantId requested, evaluate strictly against that grant
    if (options.grantId) {
      const record = this.#grants.get(options.grantId);
      if (!record) {
        return {
          granted: false,
          reason: 'grant_not_found',
          details: { grantId: options.grantId }
        };
      }

      const res = evaluateGrant(record.toEvaluatableGrant(), actionRequest, {
        currentTime: clock,
        consumedRequestIds: this.#consumedRequestIds,
        consumedExactDigests: this.#consumedExactDigests
      });

      return {
        ...res,
        grantId: record.grantId
      };
    }

    // 2. Lookup candidate grants for principal and session
    const candidateIds = new Set();
    const principalGrants = this.#grantsByPrincipal.get(actionRequest.principalId);
    if (principalGrants) {
      for (const id of principalGrants) candidateIds.add(id);
    }

    if (actionRequest.sessionId) {
      const sessionGrants = this.#grantsBySession.get(actionRequest.sessionId);
      if (sessionGrants) {
        // Intersect candidate grants: candidate must match principal AND session
        for (const id of candidateIds) {
          if (!sessionGrants.has(id)) {
            candidateIds.delete(id);
          }
        }
      } else {
        // If session was requested but has 0 grants, no matching grants exist
        candidateIds.clear();
      }
    }

    if (candidateIds.size === 0) {
      return {
        granted: false,
        reason: 'no_matching_grant',
        details: {
          principalId: actionRequest.principalId,
          sessionId: actionRequest.sessionId ?? null,
          actionType: actionRequest.actionType
        }
      };
    }

    // 3. Evaluate candidate grants; grant if ANY candidate authorizes
    let lastDenial = { reason: 'no_grant_authorized', details: {} };
    for (const grantId of candidateIds) {
      const record = this.#grants.get(grantId);
      if (!record) continue;

      const res = evaluateGrant(record.toEvaluatableGrant(), actionRequest, {
        currentTime: clock,
        consumedRequestIds: this.#consumedRequestIds,
        consumedExactDigests: this.#consumedExactDigests
      });

      if (res.granted) {
        return {
          granted: true,
          grantId: record.grantId,
          reason: 'authorized',
          details: res.details
        };
      }
      const currentPriority = DENIAL_PRIORITY[res.reason] ?? 20;
      const lastPriority = DENIAL_PRIORITY[lastDenial.reason] ?? -1;
      if (currentPriority >= lastPriority) {
        lastDenial = res;
      }
    }

    return {
      granted: false,
      reason: lastDenial.reason || 'no_grant_authorized',
      details: lastDenial.details
    };
  }

  /**
   * Atomically evaluates authority AND consumes the approval for one-use requests.
   * If authority is denied, nothing is consumed.
   * If authority is granted, atomically records consumption to prevent replay.
   *
   * @param {object} rawRequest - ActionRequest or parameters
   * @param {object} [options]
   * @param {string} [options.grantId] - Specific grant ID to evaluate and consume against
   * @param {boolean} [options.oneUse=false] - If true, revokes the underlying grant after consumption
   * @returns {{ granted: boolean, reason: string, grantId?: string, requestDigest?: string, details?: object }}
   */
  authorizeAndConsume(rawRequest, options = {}) {
    const evalRes = this.evaluate(rawRequest, options);

    // If not granted, fail closed: do not consume anything
    if (!evalRes.granted) {
      return evalRes;
    }

    let actionRequest;
    try {
      actionRequest = validateActionRequest(rawRequest, { throwOnError: true });
    } catch (err) {
      return {
        granted: false,
        reason: 'invalid_request',
        details: { error: err.message }
      };
    }

    // Atomic consumption: record requestId into replay cache
    this.#consumedRequestIds.add(actionRequest.requestId);

    const record = this.#grants.get(evalRes.grantId);
    if (record) {
      // If grant was bound to exactRequestDigest, mark digest consumed
      if (record.scope?.exactRequestDigest) {
        this.#consumedExactDigests.add(record.scope.exactRequestDigest);
      }

      // If oneUse was configured on grant or option, revoke grant immediately upon consumption
      if (options.oneUse || record.oneUse) {
        this.revokeGrant(record.grantId, 'one_use_consumed');
      }
    }

    return {
      granted: true,
      grantId: evalRes.grantId,
      reason: 'authorized_and_consumed',
      requestDigest: actionRequest.requestDigest,
      details: evalRes.details
    };
  }

  /**
   * Rechecks authority immediately before executing an effect.
   * Catches grants or sessions that were revoked while work was queued.
   *
   * @param {object} rawRequest - The ActionRequest ready to execute
   * @param {string} grantId - The grantId that previously authorized this request
   * @param {object} [options]
   * @param {boolean} [options.consume=true] - If true, atomically consumes approval upon successful recheck
   * @returns {{ granted: boolean, reason: string, details?: object }}
   */
  recheckAtEffectTime(rawRequest, grantId, options = {}) {
    const consume = options.consume ?? true;

    if (consume) {
      return this.authorizeAndConsume(rawRequest, { ...options, grantId });
    }

    return this.evaluate(rawRequest, { ...options, grantId });
  }

  /**
   * Checks if an action request ID was already consumed.
   * @param {string} requestId
   * @returns {boolean}
   */
  isRequestConsumed(requestId) {
    return this.#consumedRequestIds.has(requestId);
  }

  /**
   * Resets all internal stores (for testing).
   */
  reset() {
    this.#grants.clear();
    this.#grantsByPrincipal.clear();
    this.#grantsBySession.clear();
    this.#consumedRequestIds.clear();
    this.#consumedExactDigests.clear();
  }
}
