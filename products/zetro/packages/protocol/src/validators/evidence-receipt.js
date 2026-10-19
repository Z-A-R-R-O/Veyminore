/**
 * @file validators/evidence-receipt.js
 * Runtime validator for EvidenceReceipt (zetro.protocol.evidence_receipt.v1).
 * Cryptographically binds task, attempt, source state, applied effects, independent verification, and artifacts.
 */

import { SCHEMA_VERSIONS } from '../constants.js';
import { handleValidationFailure } from '../errors.js';
import { computeEvidenceReceiptDigest } from '../digest.js';
import { validateRelativePath } from '../path.js';

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const HEX_SHA256_REGEX = /^[a-f0-9]{64}$/i;

function isNonEmptyObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Validates an EvidenceReceipt against zetro.protocol.evidence_receipt.v1.
 * @param {any} input
 * @param {{ throwOnError?: boolean, verifyDigest?: boolean }} [options]
 * @returns {object} Normalized EvidenceReceipt object
 */
export function validateEvidenceReceipt(input, { throwOnError = true, verifyDigest = false } = {}) {
  const errors = [];
  const schema = SCHEMA_VERSIONS.EVIDENCE_RECEIPT;

  if (!isNonEmptyObject(input)) {
    return handleValidationFailure(['EvidenceReceipt must be a non-null object'], schema, throwOnError);
  }

  // schemaVersion
  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}', got '${input.schemaVersion}'`);
  }

  // receiptId
  if (typeof input.receiptId !== 'string' || !ID_REGEX.test(input.receiptId)) {
    errors.push('receiptId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
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

  // sourceBaseline
  const cleanBaseline = {
    sourceRoot: '',
    commit: null,
    initialHashes: {}
  };

  if (!isNonEmptyObject(input.sourceBaseline)) {
    errors.push('sourceBaseline must be an object');
  } else {
    if (typeof input.sourceBaseline.sourceRoot !== 'string' || input.sourceBaseline.sourceRoot.length === 0) {
      errors.push('sourceBaseline.sourceRoot must be a non-empty string');
    } else {
      cleanBaseline.sourceRoot = input.sourceBaseline.sourceRoot;
    }

    if (input.sourceBaseline.commit !== undefined && input.sourceBaseline.commit !== null) {
      if (typeof input.sourceBaseline.commit !== 'string' || input.sourceBaseline.commit.length > 64) {
        errors.push('sourceBaseline.commit must be a string up to 64 chars or null');
      } else {
        cleanBaseline.commit = input.sourceBaseline.commit;
      }
    }

    if (input.sourceBaseline.initialHashes !== undefined) {
      if (!isNonEmptyObject(input.sourceBaseline.initialHashes)) {
        errors.push('sourceBaseline.initialHashes must be an object');
      } else {
        for (const [p, h] of Object.entries(input.sourceBaseline.initialHashes)) {
          const pathRes = validateRelativePath(p);
          if (!pathRes.ok) {
            errors.push(`sourceBaseline.initialHashes key '${p}' is invalid: ${pathRes.reason}`);
          }
          if (typeof h !== 'string' || !HEX_SHA256_REGEX.test(h)) {
            errors.push(`sourceBaseline.initialHashes['${p}'] must be a 64-char hex SHA-256`);
          } else {
            cleanBaseline.initialHashes[pathRes.canonical || p] = h.toLowerCase();
          }
        }
      }
    }
  }

  // effects
  const cleanEffects = {
    changedFiles: [],
    finalHashes: {},
    diffDigest: null
  };

  if (!isNonEmptyObject(input.effects)) {
    errors.push('effects must be an object');
  } else {
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

    if (input.effects.finalHashes !== undefined) {
      if (!isNonEmptyObject(input.effects.finalHashes)) {
        errors.push('effects.finalHashes must be an object');
      } else {
        for (const [p, h] of Object.entries(input.effects.finalHashes)) {
          const pathRes = validateRelativePath(p);
          if (!pathRes.ok) {
            errors.push(`effects.finalHashes key '${p}' is invalid: ${pathRes.reason}`);
          }
          if (typeof h !== 'string' || !HEX_SHA256_REGEX.test(h)) {
            errors.push(`effects.finalHashes['${p}'] must be a 64-char hex SHA-256`);
          } else {
            cleanEffects.finalHashes[pathRes.canonical || p] = h.toLowerCase();
          }
        }
      }
    }

    if (input.effects.diffDigest !== undefined && input.effects.diffDigest !== null) {
      if (typeof input.effects.diffDigest !== 'string' || !HEX_SHA256_REGEX.test(input.effects.diffDigest)) {
        errors.push('effects.diffDigest must be a 64-char hex SHA-256 or null');
      } else {
        cleanEffects.diffDigest = input.effects.diffDigest.toLowerCase();
      }
    }
  }

  // verification
  const cleanVerification = {
    verified: false,
    verifier: '',
    checksPassed: 0,
    checksFailed: 0,
    checkDetails: []
  };

  if (!isNonEmptyObject(input.verification)) {
    errors.push('verification must be an object');
  } else {
    if (typeof input.verification.verified !== 'boolean') {
      errors.push('verification.verified must be a boolean');
    } else {
      cleanVerification.verified = input.verification.verified;
    }

    if (typeof input.verification.verifier !== 'string' || input.verification.verifier.length === 0) {
      errors.push('verification.verifier must be a non-empty string');
    } else {
      cleanVerification.verifier = input.verification.verifier;
    }

    if (!Number.isSafeInteger(input.verification.checksPassed) || input.verification.checksPassed < 0) {
      errors.push('verification.checksPassed must be a non-negative integer');
    } else {
      cleanVerification.checksPassed = input.verification.checksPassed;
    }

    if (!Number.isSafeInteger(input.verification.checksFailed) || input.verification.checksFailed < 0) {
      errors.push('verification.checksFailed must be a non-negative integer');
    } else {
      cleanVerification.checksFailed = input.verification.checksFailed;
    }

    if (input.verification.checkDetails !== undefined) {
      if (!Array.isArray(input.verification.checkDetails)) {
        errors.push('verification.checkDetails must be an array');
      } else {
        cleanVerification.checkDetails = [...input.verification.checkDetails];
      }
    }

    // Integrity constraint on verified flag:
    if (cleanVerification.verified) {
      if (cleanVerification.checksPassed === 0) {
        errors.push('verification.verified cannot be true with checksPassed === 0');
      }
      if (cleanVerification.checksFailed > 0) {
        errors.push(`verification.verified cannot be true with checksFailed > 0 (${cleanVerification.checksFailed})`);
      }
    }
  }

  // artifactRefs
  const cleanArtifactRefs = [];
  if (input.artifactRefs !== undefined) {
    if (!Array.isArray(input.artifactRefs)) {
      errors.push('artifactRefs must be an array');
    } else {
      for (let i = 0; i < input.artifactRefs.length; i++) {
        const ref = input.artifactRefs[i];
        if (!isNonEmptyObject(ref)) {
          errors.push(`artifactRefs[${i}] must be an object`);
          continue;
        }
        if (typeof ref.path !== 'string' || ref.path.length === 0) {
          errors.push(`artifactRefs[${i}].path must be a non-empty string`);
        }
        if (typeof ref.sha256 !== 'string' || !HEX_SHA256_REGEX.test(ref.sha256)) {
          errors.push(`artifactRefs[${i}].sha256 must be a 64-char hex SHA-256`);
        }
        if (!Number.isSafeInteger(ref.byteLength) || ref.byteLength < 0) {
          errors.push(`artifactRefs[${i}].byteLength must be a non-negative integer`);
        }
        cleanArtifactRefs.push({
          path: ref.path,
          sha256: (ref.sha256 || '').toLowerCase(),
          byteLength: ref.byteLength,
          ...(ref.mimeType ? { mimeType: String(ref.mimeType) } : {})
        });
      }
    }
  }

  // uncertainty
  const cleanUncertainty = {
    isUncertain: false,
    reasons: []
  };

  if (!isNonEmptyObject(input.uncertainty)) {
    errors.push('uncertainty must be an object');
  } else {
    if (typeof input.uncertainty.isUncertain !== 'boolean') {
      errors.push('uncertainty.isUncertain must be a boolean');
    } else {
      cleanUncertainty.isUncertain = input.uncertainty.isUncertain;
    }
    if (Array.isArray(input.uncertainty.reasons)) {
      cleanUncertainty.reasons = input.uncertainty.reasons.filter(r => typeof r === 'string' && r.length > 0);
    }
  }

  // createdAt
  let cleanCreatedAt = Date.now();
  if (input.createdAt !== undefined) {
    if (typeof input.createdAt === 'number') {
      if (!Number.isFinite(input.createdAt) || input.createdAt <= 0) {
        errors.push('createdAt (number) must be a positive finite epoch ms');
      } else {
        cleanCreatedAt = input.createdAt;
      }
    } else if (typeof input.createdAt === 'string') {
      if (isNaN(Date.parse(input.createdAt))) {
        errors.push('createdAt (string) must be a parseable ISO date string');
      } else {
        cleanCreatedAt = input.createdAt;
      }
    } else {
      errors.push('createdAt must be a timestamp');
    }
  }

  // signedBy
  let cleanSignedBy = undefined;
  if (input.signedBy !== undefined && input.signedBy !== null) {
    if (typeof input.signedBy !== 'string' || input.signedBy.length > 128) {
      errors.push('signedBy must be a string up to 128 chars');
    } else {
      cleanSignedBy = input.signedBy;
    }
  }

  // receiptDigest
  let cleanReceiptDigest = undefined;
  if (input.receiptDigest !== undefined && input.receiptDigest !== null) {
    if (typeof input.receiptDigest !== 'string' || !HEX_SHA256_REGEX.test(input.receiptDigest)) {
      errors.push('receiptDigest must be a 64-character hex SHA-256 string');
    } else {
      cleanReceiptDigest = input.receiptDigest.toLowerCase();
    }
  }

  if (errors.length > 0) {
    return handleValidationFailure(errors, schema, throwOnError);
  }

  const receiptBody = {
    schemaVersion: schema,
    receiptId: input.receiptId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    agentId: input.agentId,
    sourceBaseline: cleanBaseline,
    effects: cleanEffects,
    verification: cleanVerification,
    artifactRefs: cleanArtifactRefs,
    uncertainty: cleanUncertainty,
    createdAt: cleanCreatedAt,
    ...(cleanSignedBy ? { signedBy: cleanSignedBy } : {})
  };

  if (verifyDigest && cleanReceiptDigest) {
    const computed = computeEvidenceReceiptDigest(receiptBody);
    if (cleanReceiptDigest !== computed) {
      return handleValidationFailure([
        `receiptDigest mismatch: expected '${computed}', got '${cleanReceiptDigest}'`
      ], schema, throwOnError);
    }
  }

  return {
    ...receiptBody,
    receiptDigest: cleanReceiptDigest ?? computeEvidenceReceiptDigest(receiptBody)
  };
}

/**
 * Type guard for EvidenceReceipt.
 * @param {any} value
 * @returns {boolean}
 */
export function isEvidenceReceipt(value) {
  try {
    const res = validateEvidenceReceipt(value, { throwOnError: false });
    return res && res.ok !== false;
  } catch {
    return false;
  }
}
