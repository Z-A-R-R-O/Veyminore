import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHmac, randomBytes } from 'node:crypto';
import {
  validateReviewPatch,
  sha256,
  isValidRelativePath
} from './review-patch.js';

export const SAFE_APPLY_PLAN_SCHEMA_VERSION = 'rct.safe_apply_plan.v1';

/**
 * Authoritative one-use approval port.
 * Retains immutable issued records and issues cryptographically authenticated
 * opaque port-owned tokens bound to exact planDigest, taskId, and manifestHash.
 * Strictly verifies issuer authority, rejects invented IDs, field mutations,
 * cross-port tokens, and duplicate redemptions.
 */
export class ApprovalPort {
  /**
   * @param {Object} [options]
   * @param {string} [options.portId] - Unique port instance identity
   * @param {string} [options.secret] - Cryptographic HMAC secret
   */
  constructor({ portId = null, secret = null } = {}) {
    this._portId = (typeof portId === 'string' && portId.trim()) ? portId.trim() : `port-${randomUUID()}`;
    this._portSecret = (typeof secret === 'string' && secret.trim()) ? secret.trim() : randomBytes(32).toString('hex');
    this._issuedRecords = new Map();
    this._redeemedTokens = new Set();
  }

  get portId() {
    return this._portId;
  }

  /**
   * Internal helper to compute HMAC signature over authoritative token fields.
   * @private
   */
  _computeSignature({ portId, tokenId, taskId, planDigest, manifestHash, createdAt, operator }) {
    const payload = `${portId}:${tokenId}:${taskId}:${planDigest}:${manifestHash}:${createdAt}:${operator}`;
    return createHmac('sha256', this._portSecret).update(payload).digest('hex');
  }

  /**
   * Create an authoritative approval token bound to an exact planDigest, taskId, and manifestHash.
   *
   * @param {Object} params
   * @param {string} params.taskId - Exact task ID
   * @param {string} params.planDigest - Canonical plan digest
   * @param {string} params.manifestHash - Review patch manifest hash
   * @param {string} [params.operator] - Approving human or agent operator
   * @param {string} [params.reason] - Human-readable reason for approval
   * @returns {Object} Immutable approval token object
   */
  createApprovalToken({ taskId, planDigest, manifestHash, operator = 'operator', reason = 'approved' }) {
    if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
      throw new Error('ApprovalPort: taskId is required to issue approval token');
    }
    if (!planDigest || typeof planDigest !== 'string' || !/^[a-f0-9]{64}$/.test(planDigest)) {
      throw new Error('ApprovalPort: valid 64-char hex planDigest is required to issue approval token');
    }
    if (!manifestHash || typeof manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifestHash)) {
      throw new Error('ApprovalPort: valid 64-char hex manifestHash is required to issue approval token');
    }

    const tokenId = `appr-${randomUUID()}`;
    const createdAt = Date.now();
    const cleanOperator = typeof operator === 'string' && operator.trim() ? operator.trim() : 'operator';
    const cleanReason = typeof reason === 'string' ? reason : 'approved';

    const signature = this._computeSignature({
      portId: this._portId,
      tokenId,
      taskId: taskId.trim(),
      planDigest: planDigest.trim(),
      manifestHash: manifestHash.trim(),
      createdAt,
      operator: cleanOperator
    });

    const record = Object.freeze({
      tokenId,
      portId: this._portId,
      taskId: taskId.trim(),
      planDigest: planDigest.trim(),
      manifestHash: manifestHash.trim(),
      operator: cleanOperator,
      reason: cleanReason,
      createdAt,
      signature,
      redeemed: false,
      redeemedAt: null
    });

    this._issuedRecords.set(tokenId, record);

    return Object.freeze({
      tokenId,
      portId: this._portId,
      taskId: taskId.trim(),
      planDigest: planDigest.trim(),
      manifestHash: manifestHash.trim(),
      operator: cleanOperator,
      reason: cleanReason,
      createdAt,
      signature
    });
  }

  /**
   * Verify and redeem a one-use approval token.
   * Strictly verifies:
   * - Token was actually issued by THIS port (rejects invented/unissued IDs).
   * - Token was issued by this port instance (rejects cross-port tokens).
   * - Token fields have not been mutated or tampered with.
   * - Cryptographic signature is valid.
   * - Token matches expected planDigest, taskId, and manifestHash.
   * - Token has not been redeemed previously (blocks replay/duplicate redemption).
   *
   * @param {Object} token - Approval token
   * @param {Object} context - Verification context
   * @param {string} context.planDigest - Expected plan digest
   * @param {string} [context.taskId] - Expected task ID
   * @param {string} [context.manifestHash] - Expected manifest hash
   * @returns {Object} Redemption result
   */
  verifyAndRedeem(token, { planDigest, taskId = null, manifestHash = null }) {
    if (!token || typeof token !== 'object' || Array.isArray(token)) {
      throw new Error('Approval verification failed: malformed approval token (expected object)');
    }
    if (!token.tokenId || typeof token.tokenId !== 'string' || !token.tokenId.trim()) {
      throw new Error('Approval verification failed: missing or empty tokenId');
    }

    // 1. Authoritative issuance check: reject invented IDs that were never issued
    const record = this._issuedRecords.get(token.tokenId);
    if (!record) {
      throw new Error(`Forged approval rejection: token '${token.tokenId}' was never issued by this ApprovalPort`);
    }

    // 2. Cross-port check: reject tokens originating from other ports
    if (token.portId && token.portId !== this._portId) {
      throw new Error(`Cross-port approval rejection: token issued by '${token.portId}', expected '${this._portId}'`);
    }

    // 3. Mutated field check: reject tokens whose fields differ from the authoritative issued record
    if (token.taskId !== record.taskId) {
      throw new Error(`Mutated approval token rejection: taskId mismatch (token: '${token.taskId}', issued: '${record.taskId}')`);
    }
    if (token.planDigest !== record.planDigest) {
      throw new Error(`Mutated approval token rejection: planDigest mismatch (token: '${token.planDigest}', issued: '${record.planDigest}')`);
    }
    if (token.manifestHash !== record.manifestHash) {
      throw new Error(`Mutated approval token rejection: manifestHash mismatch (token: '${token.manifestHash}', issued: '${record.manifestHash}')`);
    }
    if (token.createdAt !== record.createdAt) {
      throw new Error(`Mutated approval token rejection: createdAt timestamp mismatch`);
    }
    if (token.operator !== record.operator) {
      throw new Error(`Mutated approval token rejection: operator mismatch`);
    }

    // 4. Cryptographic signature check: verify port-owned signature
    const expectedSig = this._computeSignature(record);
    if (token.signature !== expectedSig || record.signature !== expectedSig) {
      throw new Error(`Forged approval rejection: invalid cryptographic signature on token '${token.tokenId}'`);
    }

    // 5. Context check: verify against expected target plan digest, task ID, manifest hash
    if (record.planDigest !== planDigest) {
      throw new Error(`Wrong digest approval rejection: token planDigest '${record.planDigest}' does not match expected planDigest '${planDigest}'`);
    }
    if (taskId && record.taskId !== taskId) {
      throw new Error(`Task ID mismatch rejection: token taskId '${record.taskId}' does not match expected taskId '${taskId}'`);
    }
    if (manifestHash && record.manifestHash !== manifestHash) {
      throw new Error(`Manifest hash mismatch rejection: token manifestHash '${record.manifestHash}' does not match expected manifestHash '${manifestHash}'`);
    }

    // 6. Duplicate redemption check: reject replay
    if (record.redeemed === true || this._redeemedTokens.has(token.tokenId)) {
      throw new Error(`One-use approval rejection: token '${token.tokenId}' has already been redeemed (replay blocked)`);
    }

    // 7. Atomic transition to redeemed
    const redeemedAt = Date.now();
    this._issuedRecords.set(token.tokenId, Object.freeze({
      ...record,
      redeemed: true,
      redeemedAt
    }));
    this._redeemedTokens.add(token.tokenId);

    return {
      redeemed: true,
      tokenId: token.tokenId,
      portId: this._portId,
      operator: record.operator,
      redeemedAt
    };
  }

  /**
   * Check if a token has been issued by this port.
   * @param {string} tokenId
   * @returns {boolean}
   */
  isIssued(tokenId) {
    return this._issuedRecords.has(tokenId);
  }

  /**
   * Check if a token has already been redeemed.
   * @param {string} tokenId
   * @returns {boolean}
   */
  isRedeemed(tokenId) {
    return this._redeemedTokens.has(tokenId);
  }

  /**
   * Retrieve authoritative issued record if present.
   * @param {string} tokenId
   * @returns {Object|null}
   */
  getIssuedRecord(tokenId) {
    const rec = this._issuedRecords.get(tokenId);
    return rec ? { ...rec } : null;
  }
}

/**
 * Plan a safe apply operation without modifying the source.
 * Pure preview and planning API only:
 * - Validates review manifest and independent verification.
 * - Rechecks source baseline freshness directly against current bytes on disk.
 * - Enforces allowed paths, relative path containment, and denies symlinks.
 * - Computes exact change descriptors, byte deltas, and canonical plan digest.
 * - Binds one-use approval requirements and validates approval port/token if supplied.
 * - Strictly leaves source unmodified (read-only; apply execution is gated).
 *
 * @param {Object} params
 * @param {Object} params.manifest - Validated review patch manifest
 * @param {string} params.sourceRoot - Baseline source directory path
 * @param {ApprovalPort} [params.approvalPort] - Separate trusted review/approval port
 * @param {Object} [params.approval] - One-use approval token to redeem
 * @param {Object} [params.assignment] - Optional task assignment for scope verification
 * @param {Object} [params.options] - Optional validation options
 * @param {AbortSignal} [params.signal] - AbortSignal for cancellation
 * @returns {Promise<Object>} SafeApplyPlan object
 */
export async function planSafeApply({
  manifest,
  sourceRoot,
  approvalPort = null,
  approval = null,
  trustedEvidence = null,
  trustedVerifier = null,
  assignment = null,
  options = {},
  signal = null
} = {}) {
  // 1. Cancellation check at entry
  if (signal?.aborted) {
    const err = new Error('Operation aborted');
    err.name = 'AbortError';
    throw err;
  }

  // 2. Validate sourceRoot input
  if (!sourceRoot || typeof sourceRoot !== 'string' || !sourceRoot.trim()) {
    throw new Error('Missing admitted source identity (fail closed): sourceRoot path is required');
  }

  const resolvedSourceRoot = path.resolve(sourceRoot);
  try {
    const rootStat = await lstat(resolvedSourceRoot);
    if (rootStat.isSymbolicLink()) {
      throw new Error(`Symlink rejection: sourceRoot '${sourceRoot}' is a symbolic link`);
    }
    if (!rootStat.isDirectory()) {
      throw new Error(`Invalid sourceRoot: '${sourceRoot}' is not a directory`);
    }
  } catch (err) {
    if (err.message.startsWith('Symlink rejection:') || err.message.startsWith('Invalid sourceRoot:')) {
      throw err;
    }
    throw new Error(`Inaccessible sourceRoot: '${sourceRoot}': ${err.message}`);
  }

  if (signal?.aborted) {
    const err = new Error('Operation aborted');
    err.name = 'AbortError';
    throw err;
  }

  // 3. Validate review manifest via runtime contract
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Malformed review manifest: expected non-null object');
  }

  const validation = await validateReviewPatch(manifest, {
    sourceRoot: resolvedSourceRoot,
    assignment,
    trustedEvidence: trustedEvidence || options.trustedEvidence,
    trustedVerifier: trustedVerifier || options.trustedVerifier,
    ...options
  });

  if (!validation.valid) {
    throw new Error(`Review manifest validation failed: ${validation.reason}`);
  }

  if (!validation.verified) {
    throw new Error('Unverified manifest rejection: review artifact lacks independent verification');
  }

  if (signal?.aborted) {
    const err = new Error('Operation aborted');
    err.name = 'AbortError';
    throw err;
  }

  // 4. Enforce non-empty changes
  if (!Array.isArray(manifest.changes) || manifest.changes.length === 0) {
    throw new Error('Empty changes rejection: manifest declares zero changes');
  }

  // 5. Allowed paths boundary
  const allowedList = assignment?.allowedPaths ||
    assignment?.scope?.writePaths ||
    manifest.task?.allowedPaths;

  if (!Array.isArray(allowedList) || allowedList.length === 0) {
    throw new Error('Empty or missing allowedPaths: empty scope permits no changes');
  }

  const allowedSet = new Set(allowedList);

  // 6. Check each path for traversal, symlinks, containment, and disk baseline freshness
  const changeDescriptors = [];
  let totalBeforeBytes = 0;
  let totalAfterBytes = 0;
  let totalPatchBytes = 0;

  for (const change of manifest.changes) {
    if (signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }

    if (!change || typeof change !== 'object') {
      throw new Error('Malformed change entry in review manifest');
    }

    if (!isValidRelativePath(change.path)) {
      throw new Error(`Invalid relative path in changes: '${change.path}'`);
    }

    if (!allowedSet.has(change.path)) {
      throw new Error(`Out of scope rejection: path '${change.path}' is outside declared allowed paths`);
    }

    // Path containment check
    const fullPath = path.join(resolvedSourceRoot, change.path);
    const normalized = path.normalize(fullPath);
    if (!normalized.startsWith(resolvedSourceRoot + path.sep) && normalized !== resolvedSourceRoot) {
      throw new Error(`Path traversal rejection: path '${change.path}' escapes sourceRoot`);
    }

    // Symlink / link escape checks along the path
    let cur = resolvedSourceRoot;
    const segs = change.path.replace(/^\/+/, '').split('/');
    for (const seg of segs) {
      cur = path.join(cur, seg);
      try {
        const st = await lstat(cur);
        if (st.isSymbolicLink()) {
          throw new Error(`Symlink rejection: path '${change.path}' contains symbolic link at segment '${seg}'`);
        }
      } catch (err) {
        if (err.message.startsWith('Symlink rejection:')) throw err;
        // Non-existent target file is handled in baseline read check below
      }
    }

    // Disk baseline freshness recheck: read current bytes on disk
    let currentBytes;
    try {
      currentBytes = await readFile(fullPath);
    } catch (err) {
      throw new Error(`Stale baseline rejection: source file '${change.path}' is missing or inaccessible: ${err.message}`);
    }

    const currentSha = sha256(currentBytes);
    if (currentSha !== change.beforeSha256) {
      throw new Error(`Stale baseline rejection: source file '${change.path}' changed on disk since baseline was taken (current: ${currentSha}, expected: ${change.beforeSha256})`);
    }

    // Admitted baseline hash check if provided in assignment scope
    const admittedHashes = assignment?.scope?.sourceHashes || assignment?.sourceHashes;
    if (admittedHashes && typeof admittedHashes === 'object') {
      const expectedAdmitted = admittedHashes[change.path];
      if (expectedAdmitted && change.beforeSha256 !== expectedAdmitted) {
        throw new Error(`Baseline mismatch for '${change.path}': expected admitted baseline '${expectedAdmitted}', got '${change.beforeSha256}'`);
      }
    }

    // Verify patch content hash integrity
    if (typeof change.patchContent !== 'string') {
      throw new Error(`Missing patchContent for '${change.path}'`);
    }
    const computedAfter = sha256(change.patchContent);
    if (computedAfter !== change.afterSha256) {
      throw new Error(`Patch content hash mismatch for '${change.path}': expected '${change.afterSha256}', got '${computedAfter}'`);
    }

    const beforeBytes = Buffer.byteLength(currentBytes);
    const afterBytes = Buffer.byteLength(change.patchContent, 'utf8');
    const byteDelta = afterBytes - beforeBytes;
    const patchBytes = Buffer.byteLength(change.patchContent, 'utf8');

    totalBeforeBytes += beforeBytes;
    totalAfterBytes += afterBytes;
    totalPatchBytes += patchBytes;

    changeDescriptors.push({
      path: change.path,
      beforeSha256: change.beforeSha256,
      afterSha256: change.afterSha256,
      beforeBytes,
      afterBytes,
      byteDelta,
      patchBytes,
      patchContent: change.patchContent
    });
  }

  if (signal?.aborted) {
    const err = new Error('Operation aborted');
    err.name = 'AbortError';
    throw err;
  }

  // 7. Canonical plan digest computation
  const changedPaths = changeDescriptors.map(c => c.path).sort();
  const summary = {
    totalFiles: changeDescriptors.length,
    changedPaths,
    totalBeforeBytes,
    totalAfterBytes,
    totalByteDelta: totalAfterBytes - totalBeforeBytes,
    totalPatchBytes
  };

  const planBody = {
    schemaVersion: SAFE_APPLY_PLAN_SCHEMA_VERSION,
    taskId: manifest.task.id,
    manifestHash: manifest.manifestHash,
    assignmentHash: manifest.task.assignmentHash || null,
    sourceIdentity: {
      sourceRoot: resolvedSourceRoot
    },
    changes: changeDescriptors.map(c => ({
      path: c.path,
      beforeSha256: c.beforeSha256,
      afterSha256: c.afterSha256,
      beforeBytes: c.beforeBytes,
      afterBytes: c.afterBytes,
      byteDelta: c.byteDelta,
      patchBytes: c.patchBytes
    })),
    summary
  };

  const planDigest = sha256(JSON.stringify(planBody));

  // 8. One-use approval binding
  const approvalRequirements = {
    required: true,
    oneUseOnly: true,
    boundPlanDigest: planDigest,
    boundTaskId: manifest.task.id,
    boundManifestHash: manifest.manifestHash,
    status: 'ready_for_approval'
  };

  let redeemedApproval = null;
  if (approval) {
    if (!approvalPort) {
      throw new Error('ApprovalPort is required to redeem approval token');
    }
    const redeemResult = approvalPort.verifyAndRedeem(approval, {
      planDigest,
      taskId: manifest.task.id,
      manifestHash: manifest.manifestHash
    });
    approvalRequirements.status = 'approved';
    redeemedApproval = redeemResult;
  }

  // 9. Build final immutable plan object
  const plan = {
    ...planBody,
    planDigest,
    approvalRequirements,
    approval: redeemedApproval,
    detailedChanges: changeDescriptors,
    executionAvailable: false,
    executionGate: 'apply_execution_gated',
    execute() {
      throw new Error('Apply execution is currently unavailable: safe-apply preview gate only. Source modification is strictly prohibited.');
    }
  };

  return plan;
}

/**
 * Gate function to explicitly block apply execution pending separate future gate.
 *
 * @param {Object} plan - SafeApplyPlan
 */
export function executeSafeApply(plan) {
  throw new Error('Apply execution is currently unavailable: safe-apply preview gate only. Source modification is strictly prohibited.');
}
