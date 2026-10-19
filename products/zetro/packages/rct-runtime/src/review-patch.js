import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const REVIEW_PATCH_SCHEMA_VERSION = 'rct.review_patch.v1';
export const DEFAULT_MAX_REVIEW_PATCH_BYTES = 512 * 1024; // 512 KB

export function sha256(value) {
  return createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

export function hashJson(value) {
  return sha256(JSON.stringify(value));
}

export function isValidRelativePath(p) {
  if (typeof p !== 'string' || !p.trim()) return false;
  if (p.includes('\0') || p.includes('\\')) return false;
  const normalized = p.replace(/^\/+/, '');
  const segments = normalized.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg.startsWith('.')) return false;
  }
  return true;
}

/**
 * Bijective 1-to-1 check matcher.
 * Safely compares manifest check specification against evidence check or checkId.
 * Strictly prevents any OR logic or undefined === undefined false positive matching.
 *
 * @param {Object} mChk - Manifest check specification
 * @param {Object|string} evChk - Evidence check object or string checkId
 * @returns {boolean} True if and only if they unambiguously identify the exact same check
 */
export function doesCheckMatch(mChk, evChk) {
  if (!mChk || typeof mChk !== 'object') return false;

  const mId = typeof mChk.id === 'string' && mChk.id.trim() ? mChk.id.trim() : null;
  const mName = typeof mChk.name === 'string' && mChk.name.trim() ? mChk.name.trim() : null;
  const mPath = typeof mChk.path === 'string' && mChk.path.trim() ? mChk.path.trim() : null;
  const mType = typeof mChk.type === 'string' && mChk.type.trim() ? mChk.type.trim() : null;

  // Case 1: evChk is a string checkId
  if (typeof evChk === 'string') {
    const idStr = evChk.trim();
    if (!idStr) return false;
    if (mId && mId === idStr) return true;
    if (mName && mName === idStr) return true;
    if (mPath && mPath === idStr) return true;
    if (mType && mPath && `${mType}:${mPath}` === idStr) return true;
    return false;
  }

  // Case 2: evChk is an object
  if (!evChk || typeof evChk !== 'object' || Array.isArray(evChk)) return false;

  const evId = typeof evChk.id === 'string' && evChk.id.trim() ? evChk.id.trim() : null;
  const evName = typeof evChk.name === 'string' && evChk.name.trim() ? evChk.name.trim() : null;
  const evPath = typeof evChk.path === 'string' && evChk.path.trim() ? evChk.path.trim() : null;
  const evType = typeof evChk.type === 'string' && evChk.type.trim() ? evChk.type.trim() : null;

  // At least one identifier must be present in evChk
  if (!evId && !evName && !evPath) return false;

  // Conflicting fields immediately disqualify match:
  if (evPath && mPath && evPath !== mPath) return false;
  if (evType && mType && evType !== mType) return false;
  if (evName && mName && evName !== mName) return false;
  if (evId && mId && evId !== mId) return false;

  // Positive alignment on primary path
  if (evPath && mPath && evPath === mPath) return true;

  // Positive alignment on explicit ID
  if (evId && mId && evId === mId) return true;

  // Positive alignment on explicit name
  if (evName && mName && evName === mName) return true;

  // Cross-field alignment when one side uses name/id as path identifier
  if (evName && mPath && evName === mPath) return true;
  if (evId && mPath && evId === mPath) return true;
  if (evPath && mName && evPath === mName) return true;
  if (evPath && mId && evPath === mId) return true;
  if (evName && mId && evName === mId) return true;
  if (evId && mName && evId === mName) return true;

  return false;
}


/**
 * Export a reviewable patch manifest from a completed assignment receipt and workspace snapshot.
 * Guarantees zero automatic source modification.
 * Returns null if the receipt is not review_ready, was cancelled/aborted,
 * resulted in an empty/reverted diff, or failed independent verification.
 *
 * Enforces:
 * - Scope boundary: denies empty allowedPaths, denies any change outside declared allowed paths.
 * - Strict literal booleans: verifies receipt.metrics.verified === true and every check.passed === true.
 * - Admitted baseline preservation: rejects source drift against scope.sourceHashes before export, never silently rebasing.
 *
 * @param {Object} options
 * @param {Object} options.assignment - Admitted task assignment
 * @param {Object} options.receipt - Execution receipt from runAssignment
 * @param {string} [options.sourceRoot] - Baseline source directory path (read-only)
 * @param {string} [options.snapshotRoot] - Isolated execution snapshot directory
 * @param {number} [options.maxBytes] - Maximum manifest byte ceiling
 * @returns {Promise<Object|null>} Reviewable patch manifest or null
 */
export async function exportReviewPatch({
  assignment,
  receipt,
  sourceRoot = null,
  snapshotRoot = null,
  maxBytes = DEFAULT_MAX_REVIEW_PATCH_BYTES
} = {}) {
  // Pre-condition: must have a valid receipt in review_ready state with applied diff
  if (!receipt || typeof receipt !== 'object') return null;
  if (receipt.state !== 'review_ready') return null;
  if (receipt.diffOutcome !== 'applied') return null;
  if (!Array.isArray(receipt.changedPaths) || receipt.changedPaths.length === 0) return null;
  if (receipt.failureReason || receipt.state === 'unknown') return null;

  // Strict literal boolean enforcement on verification
  if (!receipt.metrics || receipt.metrics.verified !== true) return null;
  if (!Array.isArray(receipt.checks) || receipt.checks.length === 0) return null;
  for (const c of receipt.checks) {
    if (!c || typeof c !== 'object') return null;
    if (typeof c.passed !== 'boolean' || c.passed !== true) return null; // Reject string 'false', 'true', etc.
  }

  // Exact scope boundary: empty allowedPaths permits no changes!
  const allowedList = assignment?.allowedPaths || assignment?.scope?.writePaths;
  if (!Array.isArray(allowedList) || allowedList.length === 0) {
    return null; // Deny empty!
  }
  const safeSet = new Set(allowedList);
  for (const p of receipt.changedPaths) {
    if (!safeSet.has(p)) {
      return null; // Reject export outside declared safe path!
    }
  }

  const changes = [];
  const sourceHashes = {};
  const snapshotHashes = {};

  for (const p of receipt.changedPaths) {
    if (!isValidRelativePath(p)) return null;

    // Determine snapshot content and hash
    let patchContent;
    let afterSha256;
    if (snapshotRoot) {
      try {
        const snapBytes = await readFile(path.join(snapshotRoot, p));
        afterSha256 = sha256(snapBytes);
        patchContent = snapBytes.toString('utf8');
      } catch {
        return null;
      }
    } else if (Array.isArray(receipt.patches)) {
      const match = receipt.patches.slice().reverse().find(pt => pt.path === p && pt.applied);
      if (!match || typeof match.content !== 'string') return null;
      patchContent = match.content;
      afterSha256 = match.after || sha256(patchContent);
    } else {
      return null;
    }

    // Preserve admitted baseline and reject drift against admitted scope.sourceHashes!
    const admittedHash = assignment?.scope?.sourceHashes?.[p] ||
      assignment?.sourceHashes?.[p] ||
      receipt.patches?.find(pt => pt.path === p)?.before ||
      null;

    let beforeSha256 = admittedHash;

    if (sourceRoot) {
      let srcBytes;
      try {
        srcBytes = await readFile(path.join(sourceRoot, p));
      } catch {
        return null;
      }
      const currentSourceSha = sha256(srcBytes);

      // If admitted baseline exists, reject drift before export instead of silently rebasing!
      if (admittedHash && currentSourceSha !== admittedHash) {
        return null; // Source drifted against admitted scope.sourceHashes!
      }

      if (!beforeSha256) {
        beforeSha256 = currentSourceSha;
      } else if (beforeSha256 !== currentSourceSha) {
        return null; // Drift detected!
      }
    }

    if (!beforeSha256 || !afterSha256) return null;
    // Disallow no-op changes disguised as effective
    if (beforeSha256 === afterSha256) return null;

    sourceHashes[p] = beforeSha256;
    snapshotHashes[p] = afterSha256;
    changes.push({
      path: p,
      beforeSha256,
      afterSha256,
      bytes: Buffer.byteLength(patchContent, 'utf8'),
      patchContent
    });
  }

  if (changes.length === 0) return null;

  const manifestBody = {
    schemaVersion: REVIEW_PATCH_SCHEMA_VERSION,
    createdAt: Date.now(),
    task: {
      id: assignment?.id || assignment?.taskId || receipt.id || 'unknown',
      assignmentHash: receipt.assignmentHash || (assignment?.assignmentHash) || (assignment ? hashJson(assignment) : null),
      objective: typeof assignment?.objective === 'string' ? assignment.objective : '',
      allowedPaths: [...new Set(allowedList)].sort()
    },
    sourceBaseline: {
      hashes: sourceHashes
    },
    snapshot: {
      hashes: snapshotHashes
    },
    changes,
    verification: {
      verified: true,
      checkRuns: receipt.metrics?.checkRuns ?? receipt.checks.length,
      checks: receipt.checks.map(c => ({
        ...(c.id ? { id: c.id } : {}),
        ...(c.name ? { name: c.name } : {}),
        type: c.type,
        path: c.path,
        passed: true, // strict literal boolean true
        sha256: c.sha256,
        expectedBytes: c.expectedBytes,
        actualBytes: c.actualBytes
      }))
    },
    workerClaims: {
      workerSummary: typeof receipt.workerSummary === 'string' ? receipt.workerSummary : '',
      completionSource: receipt.completionSource || 'independent_checks'
    },
    usage: {
      wallTimeMs: receipt.metrics?.wallTimeMs ?? receipt.elapsedMs ?? 0,
      requests: receipt.usage?.requests ?? 0,
      totalTokens: receipt.metrics?.totalTokens ?? ((receipt.usage?.inputTokens || 0) + (receipt.usage?.outputTokens || 0)),
      toolCalls: receipt.metrics?.toolCalls ?? 0
    }
  };

  const manifestHash = sha256(JSON.stringify(manifestBody));
  const manifest = {
    ...manifestBody,
    manifestHash
  };

  const totalBytes = Buffer.byteLength(JSON.stringify(manifest), 'utf8');
  if (totalBytes > maxBytes) {
    return null;
  }

  return manifest;
}

/**
 * Independently validate a reviewable patch manifest.
 * Performs strict validation against:
 * 1. Malformed or oversize artifacts
 * 2. Self-digest integrity only: manifestHash proves payload integrity, but cannot certify verification alone
 * 3. Scope violations: denies empty allowedPaths, denies paths outside declared allowed paths
 * 4. Strict literal booleans: rejects string 'false' or non-boolean passed properties
 * 5. Content tampering and SHA-256 hash mismatches
 * 6. Stale source baseline and admitted baseline drift (read-only against sourceRoot)
 * 7. Injected trusted evidence / verifier interface (AGR-3 coordination): verifies exact taskId, assignmentHash, snapshotHashes, and checkIds
 *
 * Guarantees zero modification to sourceRoot.
 *
 * @param {Object} manifest - Reviewable patch manifest to validate
 * @param {Object} [options]
 * @param {string} [options.sourceRoot] - Baseline source directory to verify fresh baseline (read-only)
 * @param {Object} [options.assignment] - Optional expected assignment spec
 * @param {Object} [options.trustedEvidence] - Injected trusted evidence object
 * @param {Function|Object} [options.trustedVerifier] - Injected trusted verifier contract
 * @param {string} [options.expectedAssignmentHash] - Expected assignment hash
 * @param {boolean} [options.requireTrustedVerifier] - Require trusted verifier/evidence
 * @param {number} [options.maxBytes] - Optional maximum size limit
 * @returns {Promise<{ valid: boolean, reason?: string, manifestHash?: string, taskId?: string, assignmentHash?: string, changedPaths?: string[], selfDigestValid?: boolean, verified?: boolean }>}
 */
export async function validateReviewPatch(manifest, {
  sourceRoot = null,
  assignment = null,
  trustedEvidence = null,
  trustedVerifier = null,
  expectedAssignmentHash = null,
  requireTrustedVerifier = false,
  maxBytes = DEFAULT_MAX_REVIEW_PATCH_BYTES
} = {}) {
  // 1. Structure and format validation
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, reason: 'Malformed manifest: expected non-null JSON object', verified: false };
  }

  if (manifest.schemaVersion !== REVIEW_PATCH_SCHEMA_VERSION) {
    return { valid: false, reason: `Unsupported schemaVersion: expected '${REVIEW_PATCH_SCHEMA_VERSION}', got '${manifest.schemaVersion}'`, verified: false };
  }

  const rawBytes = Buffer.byteLength(JSON.stringify(manifest), 'utf8');
  if (rawBytes > maxBytes) {
    return { valid: false, reason: `Oversize review patch artifact (${rawBytes} bytes exceeds limit of ${maxBytes} bytes)`, verified: false };
  }

  const { manifestHash, ...body } = manifest;
  if (!manifestHash || typeof manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifestHash)) {
    return { valid: false, reason: 'Missing or malformed manifestHash', verified: false };
  }

  if (sha256(JSON.stringify(body)) !== manifestHash) {
    return { valid: false, reason: 'Manifest hash integrity mismatch', verified: false };
  }

  // 2. Verification evidence check (Worker summary claims can NEVER certify verified success)
  if (!manifest.verification || typeof manifest.verification !== 'object') {
    return { valid: false, reason: 'Missing verification in review patch', verified: false };
  }

  if (typeof manifest.verification.verified !== 'boolean') {
    return { valid: false, reason: 'manifest.verification.verified must be literal boolean true', verified: false };
  }

  if (manifest.verification.verified !== true) {
    return { valid: false, reason: 'Missing independent verification: verified is not true', verified: false };
  }

  if (!Array.isArray(manifest.verification.checks) || manifest.verification.checks.length === 0) {
    return { valid: false, reason: 'Missing check evidence refs in review patch', verified: false };
  }

  for (const c of manifest.verification.checks) {
    if (!c || typeof c !== 'object') {
      return { valid: false, reason: 'Malformed check in verification evidence', verified: false };
    }
    if (typeof c.passed !== 'boolean' || c.passed !== true) {
      return { valid: false, reason: `Check passed property must be literal boolean true (got ${typeof c.passed})`, verified: false };
    }
  }

  if (manifest.workerClaims?.completionSource === 'worker_claim_alone') {
    return { valid: false, reason: 'Worker claim alone cannot certify review artifact', verified: false };
  }

  // 3. Task and declared paths validation
  if (!manifest.task || typeof manifest.task !== 'object') {
    return { valid: false, reason: 'Missing task identity in review patch', verified: false };
  }

  if (typeof manifest.task.id !== 'string' || !manifest.task.id.trim()) {
    return { valid: false, reason: 'Missing or invalid task.id', verified: false };
  }

  if (assignment) {
    const expectedId = assignment.id || assignment.taskId;
    if (expectedId && manifest.task.id !== expectedId) {
      return { valid: false, reason: `Task ID mismatch: expected '${expectedId}', got '${manifest.task.id}'`, verified: false };
    }
  }

  // Exact assignment hash check: reject wrongassignmentHash!
  const targetAssignmentHash = expectedAssignmentHash ||
    assignment?.assignmentHash ||
    null;

  if (targetAssignmentHash) {
    if (!manifest.task.assignmentHash || manifest.task.assignmentHash !== targetAssignmentHash) {
      return {
        valid: false,
        reason: `Assignment hash mismatch: expected '${targetAssignmentHash}', got '${manifest.task.assignmentHash || 'none'}'`,
        verified: false
      };
    }
  }

  // Exact scope: deny empty allowedPaths!
  const allowedList = assignment?.allowedPaths ||
    assignment?.scope?.writePaths ||
    manifest.task.allowedPaths;

  if (!Array.isArray(allowedList) || allowedList.length === 0) {
    return { valid: false, reason: 'Empty or missing allowedPaths: empty scope permits no changes', verified: false };
  }

  const allowedSet = new Set(allowedList);

  // 4. Exact changes validation
  if (!Array.isArray(manifest.changes) || manifest.changes.length === 0) {
    return { valid: false, reason: 'No changes declared in review patch', verified: false };
  }

  for (const change of manifest.changes) {
    if (!change || typeof change !== 'object') {
      return { valid: false, reason: 'Malformed change entry in review patch', verified: false };
    }

    if (!isValidRelativePath(change.path)) {
      return { valid: false, reason: `Invalid relative path in changes: '${change.path}'`, verified: false };
    }

    if (!allowedSet.has(change.path)) {
      return { valid: false, reason: `Path '${change.path}' is outside declared allowed paths`, verified: false };
    }

    if (!/^[a-f0-9]{64}$/.test(change.beforeSha256) || !/^[a-f0-9]{64}$/.test(change.afterSha256)) {
      return { valid: false, reason: `Invalid SHA-256 hash format for path '${change.path}'`, verified: false };
    }

    if (change.beforeSha256 === change.afterSha256) {
      return { valid: false, reason: `Empty change: before and after SHA-256 are identical for '${change.path}'`, verified: false };
    }

    if (typeof change.patchContent !== 'string') {
      return { valid: false, reason: `Missing patchContent string for '${change.path}'`, verified: false };
    }

    const computedAfter = sha256(change.patchContent);
    if (computedAfter !== change.afterSha256) {
      return { valid: false, reason: `Patch content hash mismatch for '${change.path}': expected ${change.afterSha256}, got ${computedAfter}`, verified: false };
    }

    if (manifest.snapshot?.hashes?.[change.path] !== change.afterSha256) {
      return { valid: false, reason: `Snapshot hash mismatch for '${change.path}'`, verified: false };
    }

    if (manifest.sourceBaseline?.hashes?.[change.path] !== change.beforeSha256) {
      return { valid: false, reason: `Baseline hash mismatch for '${change.path}'`, verified: false };
    }
  }

  // Admitted baseline preservation check
  const admittedHashes = assignment?.scope?.sourceHashes || assignment?.sourceHashes;
  if (admittedHashes && typeof admittedHashes === 'object') {
    for (const change of manifest.changes) {
      const expected = admittedHashes[change.path];
      if (expected && change.beforeSha256 !== expected) {
        return {
          valid: false,
          reason: `Baseline mismatch for '${change.path}': expected admitted baseline '${expected}', got '${change.beforeSha256}'`,
          verified: false
        };
      }
    }
  }

  // Declared assignment checks check
  if (Array.isArray(assignment?.checks) && assignment.checks.length > 0) {
    for (const reqCheck of assignment.checks) {
      const match = manifest.verification.checks.find(c =>
        (c.path === reqCheck.path && (!reqCheck.type || c.type === reqCheck.type)) ||
        (reqCheck.name && (c.name === reqCheck.name || c.id === reqCheck.name)) ||
        (reqCheck.id && (c.id === reqCheck.id || c.name === reqCheck.id))
      );
      if (!match) {
        return { valid: false, reason: `Required check '${reqCheck.path || reqCheck.name || reqCheck.id}' missing from verification`, verified: false };
      }
      if (typeof match.passed !== 'boolean' || match.passed !== true) {
        return { valid: false, reason: `Required check '${reqCheck.path || reqCheck.name || reqCheck.id}' not verified as passed`, verified: false };
      }
      // Strict check content/text verification: prevents matching check with different expected text
      if (reqCheck.text !== undefined) {
        const expectedBytes = Buffer.byteLength(String(reqCheck.text));
        const expectedSha = sha256(String(reqCheck.text));
        if (reqCheck.type === 'equals') {
          if (match.sha256 && match.sha256 !== expectedSha) {
            return {
              valid: false,
              reason: `Required check '${reqCheck.path}' expected sha256 '${expectedSha}' (for text '${reqCheck.text}'), got '${match.sha256}'`,
              verified: false
            };
          }
          if (match.expectedBytes !== undefined && match.expectedBytes !== expectedBytes) {
            return {
              valid: false,
              reason: `Required check '${reqCheck.path}' expected bytes ${expectedBytes}, got ${match.expectedBytes}`,
              verified: false
            };
          }
        }
      }
      if (reqCheck.sha256 && match.sha256 && match.sha256 !== reqCheck.sha256) {
        return {
          valid: false,
          reason: `Required check '${reqCheck.path}' sha256 mismatch: expected '${reqCheck.sha256}', got '${match.sha256}'`,
          verified: false
        };
      }
    }
  }

  // 5. Stale baseline validation (sourceRoot freshness check, strictly read-only)
  if (sourceRoot) {
    for (const change of manifest.changes) {
      const sourceFile = path.join(sourceRoot, change.path);
      let sourceBytes;
      try {
        sourceBytes = await readFile(sourceFile);
      } catch (err) {
        return { valid: false, reason: `Stale baseline: source file '${change.path}' missing or inaccessible: ${err.message}`, verified: false };
      }

      const currentSha = sha256(sourceBytes);
      if (currentSha !== change.beforeSha256) {
        return {
          valid: false,
          reason: `Stale baseline: source file '${change.path}' changed since baseline was taken (current: ${currentSha}, expected: ${change.beforeSha256})`,
          verified: false
        };
      }
    }
  }

  // 6. Trusted verifier / injected trusted evidence coordination (AGR-3 interface)
  // Self-digest manifestHash proves payload integrity only.
  // Verified status requires separate complete independent evidence or trusted verifier.
  // Worker claims or task declarations alone can NEVER certify execution proof.
  let isTrustedVerified = false;

  if (trustedEvidence) {
    if (!trustedEvidence || typeof trustedEvidence !== 'object' || Array.isArray(trustedEvidence)) {
      return { valid: false, reason: 'Malformed trustedEvidence: expected non-null object', verified: false };
    }

    // 1. Exact taskId
    if (typeof trustedEvidence.taskId !== 'string' || !trustedEvidence.taskId.trim()) {
      return { valid: false, reason: 'Trusted evidence missing taskId', verified: false };
    }
    if (trustedEvidence.taskId !== manifest.task.id) {
      return { valid: false, reason: `Trusted evidence taskId mismatch: expected '${manifest.task.id}', got '${trustedEvidence.taskId}'`, verified: false };
    }

    // 2. Exact assignmentHash / assignmentDigest (strictly required!)
    const evAssignHash = trustedEvidence.assignmentHash || trustedEvidence.assignmentDigest;
    if (typeof evAssignHash !== 'string' || !evAssignHash.trim()) {
      return { valid: false, reason: 'Trusted evidence missing assignmentHash / assignmentDigest', verified: false };
    }
    if (evAssignHash !== manifest.task.assignmentHash) {
      return { valid: false, reason: `Trusted evidence assignmentHash mismatch: expected '${manifest.task.assignmentHash}', got '${evAssignHash}'`, verified: false };
    }

    // 3. Exact snapshotHashes (strictly required!)
    const evSnapHashes = trustedEvidence.snapshotHashes || trustedEvidence.snapshot?.hashes || trustedEvidence.snapshot;
    if (!evSnapHashes || typeof evSnapHashes !== 'object' || Array.isArray(evSnapHashes)) {
      return { valid: false, reason: 'Trusted evidence missing snapshotHashes mapping', verified: false };
    }
    for (const change of manifest.changes) {
      const expectedSnapSha = evSnapHashes[change.path];
      if (typeof expectedSnapSha !== 'string' || !expectedSnapSha.trim()) {
        return { valid: false, reason: `Trusted evidence missing snapshot hash for changed path '${change.path}'`, verified: false };
      }
      if (expectedSnapSha !== change.afterSha256) {
        return { valid: false, reason: `Trusted evidence snapshotHash mismatch for '${change.path}': expected '${change.afterSha256}', got '${expectedSnapSha}'`, verified: false };
      }
    }

    // 4. Exact checkIds / checks with contents/status (strictly required!)
    const evCheckIds = Array.isArray(trustedEvidence.checkIds) ? trustedEvidence.checkIds : null;
    const evChecks = Array.isArray(trustedEvidence.checks) ? trustedEvidence.checks : null;
    if (!evCheckIds && !evChecks) {
      return { valid: false, reason: 'Trusted evidence missing checkIds or checks array', verified: false };
    }
    if ((evCheckIds && evCheckIds.length === 0) || (evChecks && evChecks.length === 0)) {
      return { valid: false, reason: 'Trusted evidence checkIds/checks must be non-empty', verified: false };
    }

    const mChecks = manifest.verification.checks;
    const mCount = mChecks.length;

    if (evChecks) {
      if (evChecks.length !== mCount) {
        return {
          valid: false,
          reason: `Trusted evidence checks count mismatch: expected ${mCount}, got ${evChecks.length}`,
          verified: false
        };
      }

      for (let j = 0; j < evChecks.length; j++) {
        const chk = evChecks[j];
        if (!chk || typeof chk !== 'object' || Array.isArray(chk)) {
          return { valid: false, reason: `Malformed check object at index ${j} in trusted evidence`, verified: false };
        }
        if (typeof chk.passed !== 'boolean' || chk.passed !== true) {
          return {
            valid: false,
            reason: `Trusted evidence check '${chk.name || chk.path || chk.id || j}' not passed (status must be passed: true)`,
            verified: false
          };
        }
      }

      // Bijective 1-to-1 match: manifest -> evidence
      const matchedEvIndices = new Set();
      for (let i = 0; i < mCount; i++) {
        const mChk = mChecks[i];
        const matches = [];
        for (let j = 0; j < evChecks.length; j++) {
          if (doesCheckMatch(mChk, evChecks[j])) {
            matches.push(j);
          }
        }
        if (matches.length === 0) {
          return {
            valid: false,
            reason: `Trusted evidence missing coverage for manifest check '${mChk.name || mChk.id || mChk.path || i}'`,
            verified: false
          };
        }
        if (matches.length > 1) {
          return {
            valid: false,
            reason: `Trusted evidence check for '${mChk.name || mChk.id || mChk.path || i}' is ambiguous (multiple matches in evidence)`,
            verified: false
          };
        }
        matchedEvIndices.add(matches[0]);
      }

      // Bijective 1-to-1 match: evidence -> manifest (rejects extra or unrelated checks)
      for (let j = 0; j < evChecks.length; j++) {
        const evChk = evChecks[j];
        const matches = [];
        for (let i = 0; i < mCount; i++) {
          if (doesCheckMatch(mChecks[i], evChk)) {
            matches.push(i);
          }
        }
        if (matches.length === 0) {
          return {
            valid: false,
            reason: `Trusted evidence contains unrelated/extra check '${evChk.name || evChk.id || evChk.path || j}'`,
            verified: false
          };
        }
        if (matches.length > 1) {
          return {
            valid: false,
            reason: `Trusted evidence check '${evChk.name || evChk.id || evChk.path || j}' is ambiguous (multiple matches in manifest)`,
            verified: false
          };
        }
      }

      if (matchedEvIndices.size !== mCount) {
        return {
          valid: false,
          reason: 'Trusted evidence checks do not form a 1-to-1 bijection with manifest checks',
          verified: false
        };
      }

      // Content, sha256, and byte verification
      for (let i = 0; i < mCount; i++) {
        const mChk = mChecks[i];
        const evChk = evChecks.find(c => doesCheckMatch(mChk, c));
        if (evChk.sha256 !== undefined) {
          if (typeof evChk.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evChk.sha256)) {
            return {
              valid: false,
              reason: `Malformed sha256 in trusted evidence check '${evChk.name || evChk.path || evChk.id || i}'`,
              verified: false
            };
          }
          if (mChk.sha256 && mChk.sha256 !== evChk.sha256) {
            return {
              valid: false,
              reason: `Trusted evidence check sha256 mismatch for '${mChk.path || mChk.name || mChk.id}': expected '${mChk.sha256}', got '${evChk.sha256}'`,
              verified: false
            };
          }
        }
        if (evChk.expectedBytes !== undefined && mChk.expectedBytes !== undefined) {
          if (evChk.expectedBytes !== mChk.expectedBytes) {
            return {
              valid: false,
              reason: `Trusted evidence check expectedBytes mismatch for '${mChk.path || mChk.name || mChk.id}': expected ${mChk.expectedBytes}, got ${evChk.expectedBytes}`,
              verified: false
            };
          }
        }
        if (evChk.actualBytes !== undefined && mChk.actualBytes !== undefined) {
          if (evChk.actualBytes !== mChk.actualBytes) {
            return {
              valid: false,
              reason: `Trusted evidence check actualBytes mismatch for '${mChk.path || mChk.name || mChk.id}': expected ${mChk.actualBytes}, got ${evChk.actualBytes}`,
              verified: false
            };
          }
        }
      }
    }

    if (evCheckIds) {
      if (evCheckIds.length !== mCount) {
        return {
          valid: false,
          reason: `Trusted evidence checkIds count mismatch: expected ${mCount}, got ${evCheckIds.length}`,
          verified: false
        };
      }

      for (let j = 0; j < evCheckIds.length; j++) {
        const id = evCheckIds[j];
        if (typeof id !== 'string' || !id.trim()) {
          return { valid: false, reason: `Malformed checkId at index ${j} in trusted evidence: expected non-empty string`, verified: false };
        }
      }

      // Bijective 1-to-1 match: manifest -> checkIds
      const matchedIdIndices = new Set();
      for (let i = 0; i < mCount; i++) {
        const mChk = mChecks[i];
        const matches = [];
        for (let j = 0; j < evCheckIds.length; j++) {
          if (doesCheckMatch(mChk, evCheckIds[j])) {
            matches.push(j);
          }
        }
        if (matches.length === 0) {
          return {
            valid: false,
            reason: `Trusted evidence missing checkId for '${mChk.name || mChk.id || mChk.path || i}'`,
            verified: false
          };
        }
        if (matches.length > 1) {
          return {
            valid: false,
            reason: `Trusted evidence checkId for '${mChk.name || mChk.id || mChk.path || i}' is ambiguous (multiple matches in checkIds)`,
            verified: false
          };
        }
        matchedIdIndices.add(matches[0]);
      }

      // Bijective 1-to-1 match: checkIds -> manifest (rejects extra or unrelated checkIds)
      for (let j = 0; j < evCheckIds.length; j++) {
        const id = evCheckIds[j];
        const matches = [];
        for (let i = 0; i < mCount; i++) {
          if (doesCheckMatch(mChecks[i], id)) {
            matches.push(i);
          }
        }
        if (matches.length === 0) {
          return {
            valid: false,
            reason: `Trusted evidence contains unrelated/extra checkId '${id}'`,
            verified: false
          };
        }
        if (matches.length > 1) {
          return {
            valid: false,
            reason: `Trusted evidence checkId '${id}' is ambiguous (multiple matches in manifest)`,
            verified: false
          };
        }
      }

      if (matchedIdIndices.size !== mCount) {
        return {
          valid: false,
          reason: 'Trusted evidence checkIds do not form a 1-to-1 bijection with manifest checks',
          verified: false
        };
      }

      // If both evChecks and evCheckIds are present, verify alignment
      if (evChecks) {
        for (let i = 0; i < mCount; i++) {
          const mChk = mChecks[i];
          const evChk = evChecks.find(c => doesCheckMatch(mChk, c));
          const evId = evCheckIds.find(id => doesCheckMatch(mChk, id));
          if (!doesCheckMatch(evChk, evId)) {
            return {
              valid: false,
              reason: `Trusted evidence checks and checkIds alignment mismatch for '${evId}'`,
              verified: false
            };
          }
        }
      }
    }

    // 5. Strict literal boolean verified: true
    if (typeof trustedEvidence.verified !== 'boolean' || trustedEvidence.verified !== true) {
      return { valid: false, reason: 'Trusted evidence verified property must be literal boolean true', verified: false };
    }

    isTrustedVerified = true;
  } else if (trustedVerifier) {
    try {
      const verifierFn = typeof trustedVerifier === 'function'
        ? trustedVerifier
        : (typeof trustedVerifier?.verify === 'function' ? trustedVerifier.verify.bind(trustedVerifier) : null);

      if (!verifierFn) {
        return { valid: false, reason: 'Malformed trustedVerifier: expected function or object with verify method', verified: false };
      }

      const verResult = await verifierFn(manifest, { sourceRoot, assignment });

      // Empty or malformed callback must deny!
      // Must return literal true OR non-null object with literal verified === true
      if (verResult === true) {
        isTrustedVerified = true;
      } else if (verResult && typeof verResult === 'object' && !Array.isArray(verResult)) {
        if (typeof verResult.verified !== 'boolean' || verResult.verified !== true) {
          return {
            valid: false,
            reason: verResult.reason || `Trusted verifier rejected: verified property must be literal boolean true (got ${typeof verResult.verified})`,
            verified: false
          };
        }
        isTrustedVerified = true;
      } else {
        return {
          valid: false,
          reason: 'Trusted verifier returned empty or malformed result (expected { verified: true })',
          verified: false
        };
      }
    } catch (err) {
      return { valid: false, reason: `Trusted verifier error: ${err.message}`, verified: false };
    }
  }

  // Required trust boundary: when requireTrustedVerifier is true, it CANNOT fall back to declaration!
  if (requireTrustedVerifier && !isTrustedVerified) {
    return {
      valid: false,
      reason: 'Trusted verifier or complete evidence required to certify review patch',
      verified: false
    };
  }

  return {
    valid: true,
    manifestHash: manifest.manifestHash,
    taskId: manifest.task.id,
    assignmentHash: manifest.task.assignmentHash,
    changedPaths: manifest.changes.map(c => c.path),
    selfDigestValid: true,
    verified: isTrustedVerified
  };
}
