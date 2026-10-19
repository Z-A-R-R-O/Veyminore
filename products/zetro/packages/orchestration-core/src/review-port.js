import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ReviewStates,
  TERMINAL_REVIEW_STATES,
  Intents,
  States
} from './types.js';
import {
  validateReviewPatch,
  exportReviewPatch,
  DEFAULT_MAX_REVIEW_PATCH_BYTES,
  REVIEW_PATCH_SCHEMA_VERSION,
  sha256
} from '../../rct-runtime/src/index.js';

function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  return resolve(p).replace(/\\/g, '/').toLowerCase();
}

/**
 * ReviewPort manages bounded review artifact ingestion, validation,
 * exact reference binding, immutable review state transitions, and one-use approval intents.
 *
 * Guarantees zero automatic source modification ("no source apply yet").
 */
export class ReviewPort {
  /**
   * @param {import('./task-store.js').TaskStore} store Authoritative TaskStore
   * @param {Object} [options]
   * @param {Function} [options.validator] Injected validator contract
   * @param {Function} [options.exporter] Injected exporter contract
   * @param {string} [options.sourceRoot] Optional baseline source directory
   * @param {number} [options.maxBytes] Max manifest size ceiling (default 512KB)
   */
  constructor(store, options = {}) {
    if (!store) {
      throw new Error('TaskStore is required for ReviewPort');
    }
    this.store = store;
    this.validator = options.validator || validateReviewPatch;
    this.exporter = options.exporter || exportReviewPatch;
    this.sourceRoot = options.sourceRoot || null;
    this.maxBytes = options.maxBytes || DEFAULT_MAX_REVIEW_PATCH_BYTES;
  }

  /**
   * Ingest a reviewable patch manifest exported from runtime execution.
   *
   * Validates structure, size, hashes, and independent verification.
   * Rejects malformed, oversize, worker-claimed-only, stale, mismatched, and replay artifacts.
   *
   * @param {Object} manifest Reviewable patch manifest
   * @param {Object} [options]
   * @param {string} [options.attemptId] Authoritative attempt ID to bind
   * @param {string} [options.sourceRoot] Source directory override
   * @param {string} [options.reviewId] Custom review ID
   * @returns {Promise<import('./types.js').ReviewRecord>} Persisted review record
   */
  async ingestReviewPatch(manifest, options = {}) {
    // 1. Basic structure check
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('Malformed manifest: expected non-null object');
    }

    const taskId = manifest.task?.id;
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('Malformed manifest: missing or invalid task.id');
    }

    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found in authoritative TaskStore`);
    }

    // Admitted source identity & fail closed: canonical task.workspaceRoot takes priority
    let admittedSourceRoot = task.workspaceRoot;
    if (admittedSourceRoot) {
      if (options.sourceRoot && normalizePath(options.sourceRoot) !== normalizePath(admittedSourceRoot)) {
        throw new Error(`Source identity mismatch rejection: Ingestion sourceRoot '${options.sourceRoot}' differs from task workspaceRoot '${admittedSourceRoot}'`);
      }
      if (this.sourceRoot && normalizePath(this.sourceRoot) !== normalizePath(admittedSourceRoot)) {
        throw new Error(`Source identity mismatch rejection: Port sourceRoot '${this.sourceRoot}' differs from task workspaceRoot '${admittedSourceRoot}'`);
      }
    } else {
      admittedSourceRoot = options.sourceRoot || this.sourceRoot;
    }

    if (!admittedSourceRoot) {
      throw new Error('Missing admitted source identity (fail closed): No sourceRoot or task workspaceRoot available');
    }

    // Exact identity gate: enforce presence of required baseline hashes before validator
    if (Array.isArray(manifest.changes)) {
      for (const change of manifest.changes) {
        if (change && typeof change === 'object' && change.path) {
          if (!manifest.sourceBaseline?.hashes?.[change.path]) {
            throw new Error(`Missing baseline hash: Manifest omits sourceBaseline.hashes for '${change.path}'`);
          }
        }
      }
    }

    // 2. Validate manifest via injected/runtime contract
    const valResult = await this.validator(manifest, {
      sourceRoot: admittedSourceRoot,
      maxBytes: this.maxBytes
    });

    if (!valResult || !valResult.valid) {
      throw new Error(`Review patch validation failed: ${valResult?.reason || 'Invalid manifest'}`);
    }

    // 3. Strict Independent Verification Check (Worker claims can NEVER certify verified success)
    if (!manifest.verification || typeof manifest.verification !== 'object') {
      throw new Error('Worker claim rejection: Review artifact lacks independent verification');
    }
    if (manifest.verification.verified !== true) {
      throw new Error('Worker claim rejection: Review artifact verification is not verified: true');
    }
    if (!Array.isArray(manifest.verification.checks) || manifest.verification.checks.length === 0) {
      throw new Error('Worker claim rejection: Review artifact lacks verification checks');
    }
    if (manifest.verification.checks.some(c => !c || c.passed !== true)) {
      throw new Error('Worker claim rejection: Review artifact verification checks contain failures');
    }
    if (manifest.workerClaims?.completionSource === 'worker_claim_alone') {
      throw new Error('Worker claim rejection: Worker claim alone cannot certify review artifact');
    }

    // 4. Authoritative Attempt Verification
    const latestAttempt = this.store.getLatestAttempt(taskId);
    const attemptId = options.attemptId || manifest.attemptId || manifest.task?.attemptId || latestAttempt?.attemptId;
    if (!attemptId || typeof attemptId !== 'string') {
      throw new Error('Attempt ID is required to bind review artifact');
    }

    const attempt = this.store.getAttempt(attemptId);
    if (!attempt) {
      throw new Error(`Attempt '${attemptId}' not found in TaskStore`);
    }
    if (attempt.taskId !== taskId) {
      throw new Error(`Attempt ownership mismatch: attempt '${attemptId}' does not belong to task '${taskId}'`);
    }

    // Authoritative Evidence Enforcement:
    // Eligible verified task/attempt requires States.COMPLETED.
    // Worker claims or unverified states (SUBMITTED, FAILED, CANCELLED, UNKNOWN, RUNNING, PENDING) MUST be rejected.
    if (task.state !== States.COMPLETED || attempt.state !== States.COMPLETED) {
      throw new Error(`Unverified attempt rejection: task '${taskId}' (state: ${task.state}) or attempt '${attemptId}' (state: ${attempt.state}) is not in COMPLETED state. Independent verification must complete before review ingestion.`);
    }

    // Authoritative Evidence Enforcement:
    // Stored independent verifier evidence must be present in TaskStore.
    const taskArtifacts = this.store.getArtifacts(taskId) || [];
    const verifierEvidenceArtifacts = taskArtifacts.filter(art =>
      art.artifactType === 'verifier_evidence' &&
      (art.attemptId === attemptId || (!art.attemptId && art.metadata?.attemptId === attemptId))
    );

    if (verifierEvidenceArtifacts.length === 0) {
      throw new Error(`Unverified attempt rejection: no authoritative verifier_evidence artifact persisted in TaskStore for attempt '${attemptId}'`);
    }

    const verifierArtifact = verifierEvidenceArtifacts[0];
    const verifierMeta = verifierArtifact.metadata || {};
    if (verifierMeta.verified !== true) {
      throw new Error('Unverified attempt rejection: stored verifier evidence metadata is not verified: true');
    }
    if (!Array.isArray(verifierMeta.checks) || verifierMeta.checks.length === 0) {
      throw new Error('Unverified attempt rejection: stored verifier evidence lacks verification checks');
    }
    if (verifierMeta.checks.some(c => !c || c.passed !== true)) {
      throw new Error('Unverified attempt rejection: stored verifier evidence checks contain failures');
    }

    // Exact assignment digest check & omission rejection
    if (!task.assignmentDigest) {
      throw new Error(`Missing identity rejection: Task '${taskId}' lacks authoritative assignmentDigest`);
    }
    if (!manifest.task?.assignmentHash) {
      throw new Error(`Forged manifest rejection: Manifest omits required task.assignmentHash`);
    }
    if (task.assignmentDigest !== manifest.task.assignmentHash) {
      throw new Error(`Forged manifest rejection: manifest assignmentHash '${manifest.task.assignmentHash}' does not match task assignmentDigest '${task.assignmentDigest}'`);
    }

    // Declared allowed paths check
    if (Array.isArray(task.allowedPaths)) {
      for (const change of manifest.changes || []) {
        if (!task.allowedPaths.includes(change.path)) {
          throw new Error(`Forged manifest rejection: change path '${change.path}' not in task allowedPaths`);
        }
      }
    }

    // Stored verifier check SHA-256 matching the patch digest (afterSha256)
    for (const change of manifest.changes || []) {
      const matchingCheck = verifierMeta.checks.find(c => c.path === change.path);
      if (!matchingCheck) {
        throw new Error(`Forged manifest rejection: no stored verifier check found for change path '${change.path}'`);
      }
      if (matchingCheck.passed !== true) {
        throw new Error(`Forged manifest rejection: stored verifier check for '${change.path}' did not pass`);
      }
      if (!matchingCheck.sha256) {
        throw new Error(`Forged manifest rejection: stored verifier check for '${change.path}' omits sha256`);
      }
      if (matchingCheck.sha256 !== change.afterSha256) {
        throw new Error(`Forged manifest rejection: stored verifier check sha256 '${matchingCheck.sha256}' does not match patch change afterSha256 '${change.afterSha256}' for '${change.path}'`);
      }
    }

    // 5. Source Baseline Consistency & Hash Omission Checks
    for (const change of manifest.changes || []) {
      if (!change.beforeSha256 || !change.afterSha256) {
        throw new Error(`Malformed manifest: change '${change.path}' omits beforeSha256 or afterSha256`);
      }
      if (!manifest.sourceBaseline?.hashes?.[change.path]) {
        throw new Error(`Missing baseline hash: Manifest omits sourceBaseline.hashes for '${change.path}'`);
      }
      if (manifest.sourceBaseline.hashes[change.path] !== change.beforeSha256) {
        throw new Error(`Baseline mismatch for '${change.path}': manifest sourceBaseline.hashes '${manifest.sourceBaseline.hashes[change.path]}' does not match change.beforeSha256 '${change.beforeSha256}'`);
      }
      if (task.sourceHashes && typeof task.sourceHashes === 'object') {
        const expectedHash = task.sourceHashes[change.path];
        if (expectedHash && manifest.sourceBaseline.hashes[change.path] !== expectedHash) {
          throw new Error(`Baseline mismatch for '${change.path}': task envelope expected '${expectedHash}', manifest has '${manifest.sourceBaseline.hashes[change.path]}'`);
        }
      }
    }

    for (const change of manifest.changes || []) {
      try {
        const content = await readFile(join(admittedSourceRoot, change.path));
        const currentSha = sha256(content);
        if (currentSha !== change.beforeSha256) {
          throw new Error(`Stale baseline rejection: source file '${change.path}' changed on disk since baseline was taken (current: ${currentSha}, expected: ${change.beforeSha256})`);
        }
      } catch (err) {
        if (err.message?.startsWith('Stale baseline rejection:')) throw err;
        throw new Error(`Stale baseline rejection: source file '${change.path}' inaccessible or modified: ${err.message}`);
      }
    }

    // 6. Replay & Terminal Overwrite Prevention
    const existingReviews = this.store.listReviews(taskId).filter(r => r.attemptId === attemptId);
    for (const r of existingReviews) {
      if (r.patchDigest === manifest.manifestHash) {
        throw new Error(`Replay rejection: review artifact with digest '${manifest.manifestHash}' already ingested for attempt '${attemptId}'`);
      }
      if (TERMINAL_REVIEW_STATES.has(r.state)) {
        throw new Error(`Terminal overwrite rejection: attempt '${attemptId}' already has terminal review in state '${r.state}'`);
      }
    }

    // 7. Persist review record in store
    const reviewId = options.reviewId || `rev-${taskId}-${attemptId}`;
    const review = this.store.createReview({
      id: reviewId,
      taskId,
      attemptId,
      state: ReviewStates.PENDING,
      sourceRoot: admittedSourceRoot,
      sourceBaseline: manifest.sourceBaseline,
      patchDigest: manifest.manifestHash,
      verification: manifest.verification,
      manifest
    });

    // Record audit event
    this.store.recordEvent(taskId, attemptId, 'REVIEW_INGESTED', {
      reviewId,
      manifestHash: manifest.manifestHash,
      state: ReviewStates.PENDING,
      timestamp: Date.now()
    });

    // Record review artifact in task artifacts table
    this.store.recordArtifact(taskId, attemptId, {
      artifactType: 'review_patch',
      uri: `reviews/${reviewId}.json`,
      hash: manifest.manifestHash,
      metadata: {
        reviewId,
        verified: true,
        manifestHash: manifest.manifestHash
      }
    });

    return review;
  }

  /**
   * Approve a pending review artifact with a one-use approval intent.
   *
   * Verifies source baseline freshness at time of approval.
   * Rejects replayed approvals, terminal overwrites, and stale baselines.
   * Guarantees zero source modification ("no source apply yet").
   *
   * @param {string} reviewId Review ID
   * @param {Object} [options]
   * @param {string} [options.operator] Operator identifier
   * @param {string} [options.reason] Reason for approval
   * @param {string} [options.sourceRoot] Source directory override for freshness check
   * @returns {Promise<import('./types.js').ReviewRecord>} Updated review record
   */
  async approve(reviewId, options = {}) {
    const review = this.store.getReview(reviewId);
    if (!review) {
      throw new Error(`Review not found: '${reviewId}'`);
    }

    // One-use approval & terminal immutability check
    if (review.state === ReviewStates.APPROVED) {
      throw new Error(`One-use approval rejection: Review '${reviewId}' is already APPROVED; approval intent cannot be reused or replayed`);
    }
    if (TERMINAL_REVIEW_STATES.has(review.state)) {
      throw new Error(`Terminal overwrite rejection: Review '${reviewId}' is in terminal state '${review.state}' and cannot be approved`);
    }
    if (review.state !== ReviewStates.PENDING) {
      throw new Error(`Invalid review state: Review '${reviewId}' is in state '${review.state}', must be PENDING`);
    }

    // Canonical admitted source identity:
    // Stored canonical review root takes strict authority.
    const task = this.store.getTask(review.taskId);
    const canonicalSourceRoot = review.sourceRoot || task?.workspaceRoot;
    if (!canonicalSourceRoot) {
      throw new Error('Missing admitted source identity (fail closed): Cannot verify freshness at approval without source root');
    }

    // Reject differing caller/port roots (including replacement after ingestion)
    if (options.sourceRoot && normalizePath(options.sourceRoot) !== normalizePath(canonicalSourceRoot)) {
      throw new Error(`Source identity mismatch rejection: Caller sourceRoot '${options.sourceRoot}' differs from canonical admitted review sourceRoot '${canonicalSourceRoot}'. Re-rooting or source replacement after ingestion is strictly forbidden.`);
    }
    if (this.sourceRoot && normalizePath(this.sourceRoot) !== normalizePath(canonicalSourceRoot)) {
      throw new Error(`Source identity mismatch rejection: Port sourceRoot '${this.sourceRoot}' differs from canonical admitted review sourceRoot '${canonicalSourceRoot}'. Re-rooting or source replacement after ingestion is strictly forbidden.`);
    }

    // Stale baseline check: ALWAYS verify against canonicalSourceRoot
    if (Array.isArray(review.manifest?.changes)) {
      for (const change of review.manifest.changes) {
        try {
          const content = await readFile(join(canonicalSourceRoot, change.path));
          const currentSha = sha256(content);
          if (currentSha !== change.beforeSha256) {
            throw new Error(`Stale baseline rejection: source file '${change.path}' changed on disk before approval; cannot approve stale patch`);
          }
        } catch (err) {
          if (err.message?.startsWith('Stale baseline rejection:')) throw err;
          throw new Error(`Stale baseline rejection: source file '${change.path}' inaccessible: ${err.message}`);
        }
      }
    }

    // Atomic transaction: intent + review transition + audit event
    return this.store.finalizeReviewApproval(reviewId, options);
  }

  /**
   * Reject a pending review artifact.
   *
   * @param {string} reviewId Review ID
   * @param {Object} [options]
   * @param {string} [options.operator] Operator identifier
   * @param {string} [options.reason] Reason for rejection
   * @returns {Promise<import('./types.js').ReviewRecord>} Updated review record
   */
  async reject(reviewId, options = {}) {
    return this.store.finalizeReviewRejection(reviewId, options);
  }

  /**
   * Discard a pending review artifact.
   *
   * @param {string} reviewId Review ID
   * @param {Object} [options]
   * @param {string} [options.operator] Operator identifier
   * @param {string} [options.reason] Reason for discard
   * @returns {Promise<import('./types.js').ReviewRecord>} Updated review record
   */
  async discard(reviewId, options = {}) {
    return this.store.finalizeReviewDiscard(reviewId, options);
  }

  /**
   * Get a review by ID.
   * @param {string} reviewId
   * @returns {import('./types.js').ReviewRecord|null}
   */
  getReview(reviewId) {
    return this.store.getReview(reviewId);
  }

  /**
   * List reviews for a task or all reviews.
   * @param {string} [taskId]
   * @returns {import('./types.js').ReviewRecord[]}
   */
  listReviews(taskId = null) {
    return this.store.listReviews(taskId);
  }
}
