import { States, Bounds } from './types.js';

/**
 * Interface definition for RCT (Repair/Coding Tool) Adapter Port.
 *
 * This port defines the boundary between ZETRO orchestration-core and rct-runtime.
 * The dispatcher calls execute() through this interface, keeping execution isolated
 * and allowing independent verification.
 */
export class RctAdapterPort {
  /**
   * Execute a task envelope through the RCT runtime.
   *
   * @param {import('./types.js').TaskEnvelope} envelope
   * @param {AbortSignal} abortSignal
   * @returns {Promise<import('./types.js').TaskReceipt>}
   */
  async execute(envelope, abortSignal) {
    throw new Error('RctAdapterPort.execute() must be implemented by adapter');
  }

  /**
   * Helper to check if a relative path is safely within allowed paths.
   * Prevents directory traversal and outside-scope changes.
   *
   * @param {string} filePath
   * @param {string[]} allowedPaths
   * @returns {boolean}
   */
  static isPathInScope(filePath, allowedPaths) {
    if (typeof filePath !== 'string' || !filePath.trim()) return false;
    const normalized = filePath.replace(/\\/g, '/').replace(/^\.?\//, '');
    if (normalized.includes('..') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
      return false; // Reject directory traversal and absolute paths
    }

    if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) return false;

    return allowedPaths.some(allowed => {
      const normAllowed = allowed.replace(/\\/g, '/').replace(/^\.?\//, '');
      if (normAllowed === '' || normAllowed === '.') return true;
      if (normalized === normAllowed) return true;
      const prefix = normAllowed.endsWith('/') ? normAllowed : normAllowed + '/';
      return normalized.startsWith(prefix);
    });
  }

  /**
   * Validate an individual check item against strict typing and boolean rules.
   * String labels ('passed', 'ok') and untyped/empty objects are strictly rejected.
   *
   * @param {any} check
   * @returns {{ valid: boolean, reason?: string }}
   */
  static validateCheck(check) {
    if (!check || typeof check !== 'object' || Array.isArray(check)) {
      const repr = typeof check === 'string' ? `'${check}'` : typeof check;
      return {
        valid: false,
        reason: `Malformed check: string labels (${repr}) are not trusted checks; structured check object required`
      };
    }
    if (typeof check.name !== 'string' || !check.name.trim() || check.name.length > Bounds.MAX_STRING_CHARS) {
      return { valid: false, reason: 'Check name must be a non-empty string within bounds' };
    }
    // Must be a strict boolean: reject 'true', 1, {}, truthiness
    if (typeof check.passed !== 'boolean') {
      return {
        valid: false,
        reason: `Malformed check '${check.name}': passed property must be a strict boolean (got ${typeof check.passed})`
      };
    }
    return { valid: true };
  }

  /**
   * Helper to extract authoritative declared check IDs from an envelope.
   * Priority: envelope.declaredChecks > envelope.verification.
   *
   * @param {import('./types.js').TaskEnvelope} envelope
   * @returns {string[]}
   */
  static getRequiredCheckIds(envelope) {
    if (!envelope || typeof envelope !== 'object') return [];
    if (Array.isArray(envelope.declaredChecks) && envelope.declaredChecks.length > 0) {
      return envelope.declaredChecks
        .filter(c => typeof c === 'string' && c.trim())
        .map(c => c.trim());
    }
    if (typeof envelope.verification === 'string' && envelope.verification.trim()) {
      return envelope.verification
        .split(/[,;\n]+/)
        .map(s => s.trim())
        .filter(Boolean);
    }
    return [];
  }

  /**
   * Validate separate injected independent verifier evidence tied to exact task/attempt.
   *
   * @param {Object} evidence
   * @param {import('./types.js').TaskEnvelope} envelope
   * @param {string} [attemptId]
   * @returns {{ valid: boolean, reason?: string }}
   */
  static validateVerifierEvidence(evidence, envelope, attemptId = null) {
    if (!evidence || typeof evidence !== 'object') {
      return { valid: false, reason: 'Verifier evidence must be a non-null object' };
    }
    if (evidence.taskId !== envelope?.id) {
      return { valid: false, reason: `Verifier evidence taskId mismatch: expected '${envelope?.id}', got '${evidence.taskId}'` };
    }
    // Require exact active attempt identity: missing or non-string attemptId is strictly rejected
    if (typeof evidence.attemptId !== 'string' || !evidence.attemptId.trim()) {
      return { valid: false, reason: 'Verifier evidence attemptId is required and must be a non-empty string' };
    }
    if (attemptId && evidence.attemptId !== attemptId) {
      return { valid: false, reason: `Verifier evidence attemptId mismatch: expected '${attemptId}', got '${evidence.attemptId}'` };
    }
    if (typeof evidence.verified !== 'boolean') {
      return { valid: false, reason: 'Verifier evidence verified property must be a strict boolean' };
    }
    if (!Array.isArray(evidence.checks) || evidence.checks.length === 0) {
      return { valid: false, reason: evidence.error || 'Verifier evidence must contain a non-empty checks array' };
    }
    for (const check of evidence.checks) {
      const cv = this.validateCheck(check);
      if (!cv.valid) return cv;
      if (check.passed !== true) {
        return { valid: false, reason: `Verifier check '${check.name}' failed` };
      }
    }

    // Authoritative exact declared check IDs derived from real envelope (declaredChecks or verification)
    const requiredChecks = this.getRequiredCheckIds(envelope);
    if (requiredChecks.length === 0) {
      return { valid: false, reason: 'Envelope must declare non-empty verification check IDs to trust verification evidence' };
    }

    for (const required of requiredChecks) {
      const found = evidence.checks.find(c => (c.name === required || c.id === required || c.checkId === required));
      if (!found || found.passed !== true) {
        return { valid: false, reason: `Required check '${required}' was not verified as passed` };
      }
    }

    if (evidence.verified !== true) {
      return { valid: false, reason: evidence.error || 'Verifier evidence indicates verification did not pass' };
    }
    return { valid: true };
  }

  /**
   * Detailed receipt conformance check against envelope, bounds, and independent verification rules.
   *
   * @param {import('./types.js').TaskReceipt} receipt
   * @param {import('./types.js').TaskEnvelope} envelope
   * @param {Object} [options]
   * @param {string} [options.attemptId]
   * @param {Object} [options.verifierEvidence]
   * @param {boolean} [options.requireTrustedVerifier=false]
   * @returns {{ valid: boolean, reason?: string }}
   */
  static checkReceiptConformance(receipt, envelope, options = {}) {
    if (!receipt || typeof receipt !== 'object') {
      return { valid: false, reason: 'Receipt is not an object' };
    }

    // 1. Exact Identity Validation
    if (receipt.id !== envelope.id) {
      return { valid: false, reason: `Task ID mismatch: expected '${envelope.id}', got '${receipt.id}'` };
    }
    if (receipt.agent !== envelope.agent) {
      return { valid: false, reason: `Agent identity mismatch: expected '${envelope.agent}', got '${receipt.agent}'` };
    }
    if (receipt.attemptId && options.attemptId && receipt.attemptId !== options.attemptId) {
      return { valid: false, reason: `Attempt ID mismatch: expected '${options.attemptId}', got '${receipt.attemptId}'` };
    }

    // 2. Allowed States
    if (![States.SUBMITTED, States.COMPLETED, States.FAILED, States.UNKNOWN].includes(receipt.state)) {
      return { valid: false, reason: `Invalid receipt state: '${receipt.state}'` };
    }

    // 3. Bounded String Fields
    if (typeof receipt.summary !== 'string') {
      return { valid: false, reason: 'Summary must be a string' };
    }
    if (receipt.summary.length > Bounds.MAX_STRING_CHARS) {
      return { valid: false, reason: `Summary exceeds maximum length (${Bounds.MAX_STRING_CHARS})` };
    }
    if (receipt.uncertainty != null) {
      if (typeof receipt.uncertainty !== 'string') {
        return { valid: false, reason: 'Uncertainty must be a string if provided' };
      }
      if (receipt.uncertainty.length > Bounds.MAX_STRING_CHARS) {
        return { valid: false, reason: `Uncertainty exceeds maximum length (${Bounds.MAX_STRING_CHARS})` };
      }
    }

    // 4. Arrays and Bounds
    if (!Array.isArray(receipt.changedFiles)) {
      return { valid: false, reason: 'changedFiles must be an array' };
    }
    if (receipt.changedFiles.length > Bounds.MAX_ARRAY_ITEMS) {
      return { valid: false, reason: `changedFiles exceeds maximum item count (${Bounds.MAX_ARRAY_ITEMS})` };
    }

    if (!Array.isArray(receipt.checks)) {
      return { valid: false, reason: 'checks must be an array' };
    }
    if (receipt.checks.length > Bounds.MAX_ARRAY_ITEMS) {
      return { valid: false, reason: `checks exceeds maximum item count (${Bounds.MAX_ARRAY_ITEMS})` };
    }

    // Validate each check item: reject string labels ('passed') and untyped objects ({})
    for (const check of receipt.checks) {
      const cv = this.validateCheck(check);
      if (!cv.valid) return cv;
    }

    if (!Array.isArray(receipt.evidenceRefs)) {
      return { valid: false, reason: 'evidenceRefs must be an array' };
    }
    if (receipt.evidenceRefs.length > Bounds.MAX_ARRAY_ITEMS) {
      return { valid: false, reason: `evidenceRefs exceeds maximum item count (${Bounds.MAX_ARRAY_ITEMS})` };
    }

    // 5. Scope Validation: all changed files must be within allowedPaths
    for (const file of receipt.changedFiles) {
      if (typeof file !== 'string' || file.length > Bounds.MAX_STRING_CHARS) {
        return { valid: false, reason: 'Invalid file path in changedFiles' };
      }
      if (!this.isPathInScope(file, envelope.allowedPaths)) {
        return { valid: false, reason: `Path scope violation: '${file}' is outside allowedPaths [${envelope.allowedPaths.join(', ')}]` };
      }
    }

    // 6. Evidence refs validation
    for (const ref of receipt.evidenceRefs) {
      if (typeof ref !== 'string' || ref.length > Bounds.MAX_STRING_CHARS) {
        return { valid: false, reason: 'Invalid ref in evidenceRefs' };
      }
      if (ref.includes('..')) {
        return { valid: false, reason: `Directory traversal in evidenceRef: '${ref}'` };
      }
    }

    // 7. Verification Integrity: Worker completion alone must not become independent completion
    if (receipt.state === States.COMPLETED) {
      if (receipt.checks.length === 0) {
        return { valid: false, reason: 'Worker completion rejected: COMPLETED state requires non-empty verification checks' };
      }
      for (const check of receipt.checks) {
        if (check.passed !== true) {
          return { valid: false, reason: `Worker completion rejected: check '${check.name}' indicates failure (check did not pass)` };
        }
      }

      if (options.requireTrustedVerifier) {
        if (!options.verifierEvidence) {
          return {
            valid: false,
            reason: 'Worker completion rejected: worker claims cannot supply trusted verification; requires separate injected independent verifier evidence tied to exact task/attempt'
          };
        }
        const evVal = this.validateVerifierEvidence(options.verifierEvidence, envelope, options.attemptId);
        if (!evVal.valid) return evVal;
      }
    }

    return { valid: true };
  }

  /**
   * Validate a receipt returned by an RCT adapter.
   *
   * @param {import('./types.js').TaskReceipt} receipt
   * @param {import('./types.js').TaskEnvelope} envelope
   * @param {Object} [options]
   * @returns {boolean}
   */
  static validateReceipt(receipt, envelope, options = {}) {
    return this.checkReceiptConformance(receipt, envelope, options).valid;
  }
}

