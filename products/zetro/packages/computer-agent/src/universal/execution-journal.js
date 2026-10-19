/**
 * @file execution-journal.js
 * Cryptographically-chained, append-only execution journal for ZETRO Universal Agent 2.0.
 *
 * Every perception, proposed action, authority check, native execution result,
 * and independent verification step is permanently journaled with SHA-256 hash chaining.
 */

import { createHash, randomUUID } from 'node:crypto';

/**
 * Creates an append-only ExecutionJournal instance.
 *
 * @param {Object} [options]
 * @param {string} [options.id]
 * @param {string} [options.taskGoal]
 * @param {Function} [options.onEntry] - Callback for streaming journal entries
 * @returns {ExecutionJournal}
 */
export function createExecutionJournal({
  id = `journal-${randomUUID()}`,
  taskGoal = '',
  onEntry = null
} = {}) {
  const entries = [];
  let previousHash = '0000000000000000000000000000000000000000000000000000000000000000';
  const startTime = Date.now();

  function computeEntryHash(entryPayload, prevHash) {
    return createHash('sha256')
      .update(prevHash + JSON.stringify(entryPayload))
      .digest('hex');
  }

  return {
    id,
    taskGoal,
    startTime,

    /**
     * Appends a new step entry to the append-only journal.
     *
     * @param {Object} step
     * @param {string} step.modelId - ID of model that proposed the action
     * @param {Object} step.action - Canonical ComputerAction
     * @param {Object} [step.observationBefore] - Pre-action visual/OCR observation summary
     * @param {Object} [step.observationAfter] - Post-action visual/OCR observation summary
     * @param {Object} [step.executionResult] - Result from ActionDispatcher
     * @param {Object} [step.verificationResult] - Result from visual/outcome verifier
     * @param {string} [step.riskLevel] - Risk level
     * @param {string} [step.status='success'] - 'success', 'interrupted', 'rejected', 'failed'
     * @param {string} [step.approval] - Supervisor approval identifier if applicable
     * @returns {Object} Finalized journal entry with chained hash
     */
    appendStep({
      modelId,
      action,
      observationBefore = null,
      observationAfter = null,
      executionResult = null,
      verificationResult = null,
      riskLevel = 'benign',
      status = 'success',
      approval = null,
      error = null
    }) {
      const stepIndex = entries.length;
      const timestamp = Date.now();

      const payload = {
        stepIndex,
        timestamp,
        modelId,
        action,
        observationBefore: observationBefore ? summarizeObservation(observationBefore) : null,
        observationAfter: observationAfter ? summarizeObservation(observationAfter) : null,
        executionResult: executionResult ? {
          success: executionResult.success === true,
          durationMs: executionResult.durationMs ?? 0,
          details: executionResult.details || null
        } : null,
        verificationResult: verificationResult ? {
          verified: verificationResult.verified === true,
          method: verificationResult.method || 'visual',
          details: verificationResult.details || null
        } : null,
        riskLevel,
        status,
        approval,
        error: error ? String(error.message || error) : null
      };

      const entryHash = computeEntryHash(payload, previousHash);
      const entry = {
        ...payload,
        previousHash,
        hash: entryHash
      };

      previousHash = entryHash;
      entries.push(entry);

      if (typeof onEntry === 'function') {
        try {
          onEntry(entry);
        } catch {
          // Journal listener errors must not break agent execution
        }
      }

      return entry;
    },

    /**
     * Returns an immutable copy of all journal entries.
     */
    getEntries() {
      return [...entries];
    },

    /**
     * Validates the cryptographic integrity of the entire journal hash chain.
     * @returns {boolean}
     */
    verifyIntegrity() {
      let expectedPrev = '0000000000000000000000000000000000000000000000000000000000000000';
      for (const entry of entries) {
        if (entry.previousHash !== expectedPrev) return false;
        const { hash, previousHash: _, ...payload } = entry;
        const calculated = computeEntryHash(payload, expectedPrev);
        if (calculated !== hash) return false;
        expectedPrev = hash;
      }
      return true;
    },

    /**
     * Computes high-level summary metrics of the agent run.
     */
    getSummary() {
      const totalSteps = entries.length;
      const modelsUsed = new Set(entries.map(e => e.modelId).filter(Boolean));
      const successfulSteps = entries.filter(e => e.status === 'success').length;
      const interruptedSteps = entries.filter(e => e.status === 'interrupted').length;
      const failedSteps = entries.filter(e => e.status === 'failed').length;
      const rejectedSteps = entries.filter(e => e.status === 'rejected').length;
      const approvalsRequested = entries.filter(e => e.action?.type === 'requestApproval' || e.approval).length;

      return {
        id,
        taskGoal,
        durationMs: Date.now() - startTime,
        totalSteps,
        modelsUsed: Array.from(modelsUsed),
        successfulSteps,
        interruptedSteps,
        failedSteps,
        rejectedSteps,
        approvalsRequested,
        integrityVerified: this.verifyIntegrity()
      };
    },

    /**
     * Serializes journal to JSON.
     */
    toJSON() {
      return {
        id,
        taskGoal,
        startTime,
        endTime: Date.now(),
        summary: this.getSummary(),
        entries
      };
    }
  };
}

/**
 * Summarizes observation to prevent storing megabytes of raw image data in journal.
 */
function summarizeObservation(obs) {
  if (!obs || typeof obs !== 'object') return null;

  let imageHash = null;
  if (obs.imageBuffer) {
    imageHash = createHash('sha256').update(obs.imageBuffer).digest('hex').slice(0, 16);
  } else if (typeof obs.hash === 'string') {
    imageHash = obs.hash;
  }

  return {
    timestamp: obs.timestamp || Date.now(),
    imageHash,
    width: obs.width,
    height: obs.height,
    activeWindow: obs.activeWindow ? {
      title: obs.activeWindow.title,
      hwnd: obs.activeWindow.hwnd,
      processName: obs.activeWindow.processName
    } : undefined
  };
}
