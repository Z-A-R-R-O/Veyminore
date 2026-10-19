import { RctAdapterPort } from './rct-adapter-port.js';
import { States, Bounds } from './types.js';

/**
 * Fake RCT Adapter fixture for conformance testing and integration verification.
 * Simulates RCT offline execution behaviors, including adversarial edge cases,
 * without requiring live Groq or external processes.
 */
export class FakeRctAdapter extends RctAdapterPort {
  /**
   * @param {Object} [options]
   * @param {'success'|'check_failure'|'scope_violation'|'hang'|'delay'|'intruder_agent'|'mismatched_id'|'outside_scope_patch'|'completed_no_checks'|'completed_failed_checks'|'unbounded_fields'|'invalid_state'} [options.mode='success']
   * @param {number} [options.delayMs=10]
   * @param {string[]} [options.changedFiles]
   * @param {string[]} [options.checks]
   * @param {Object} [options.receiptOverride]
   */
  constructor(options = {}) {
    super();
    this.mode = options.mode || 'success';
    this.delayMs = options.delayMs ?? 10;
    this.changedFiles = options.changedFiles || ['src/patch.js'];
    this.checks = options.checks || [{ name: 'npm-test', passed: true }];
    this.receiptOverride = options.receiptOverride || null;
    this.executionHistory = [];
  }

  async execute(envelope, optionsOrSignal) {
    const abortSignal = optionsOrSignal instanceof AbortSignal
      ? optionsOrSignal
      : (optionsOrSignal?.signal || optionsOrSignal?.abortSignal || optionsOrSignal);

    this.executionHistory.push({
      id: envelope.id,
      agent: envelope.agent,
      timestamp: Date.now()
    });

    if (abortSignal?.aborted) {
      throw new Error('AbortError');
    }

    if (this.mode === 'hang') {
      return new Promise((_, reject) => {
        abortSignal?.addEventListener?.('abort', () => reject(new Error('AbortError')));
      });
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.receiptOverride) {
          resolve(this.receiptOverride);
          return;
        }

        switch (this.mode) {
          case 'intruder_agent':
            resolve({
              id: envelope.id,
              agent: 'evil-intruder-agent',
              state: States.COMPLETED,
              changedFiles: this.changedFiles,
              checks: [{ name: 'test', passed: true }],
              evidenceRefs: [],
              summary: 'Intruder executed task',
              uncertainty: 'None'
            });
            break;

          case 'mismatched_id':
            resolve({
              id: 'another-unrelated-task-id',
              agent: envelope.agent,
              state: States.COMPLETED,
              changedFiles: this.changedFiles,
              checks: [{ name: 'test', passed: true }],
              evidenceRefs: [],
              summary: 'Receipt for wrong task ID',
              uncertainty: 'None'
            });
            break;

          case 'outside_scope_patch':
            resolve({
              id: envelope.id,
              agent: envelope.agent,
              state: States.COMPLETED,
              changedFiles: ['unauthorized/exploit.js', ...this.changedFiles],
              checks: [{ name: 'test', passed: true }],
              evidenceRefs: ['evidence/patch.diff'],
              summary: 'Attempted out-of-scope modifications',
              uncertainty: 'None'
            });
            break;

          case 'completed_no_checks':
            resolve({
              id: envelope.id,
              agent: envelope.agent,
              state: States.COMPLETED,
              changedFiles: this.changedFiles,
              checks: [], // Worker declares COMPLETED with no checks!
              evidenceRefs: ['evidence/patch.diff'],
              summary: 'Self-declared completion without independent checks',
              uncertainty: 'None'
            });
            break;

          case 'completed_failed_checks':
            resolve({
              id: envelope.id,
              agent: envelope.agent,
              state: States.COMPLETED,
              changedFiles: this.changedFiles,
              checks: [{ name: 'npm-test', passed: false, error: '2 failed' }], // Failed checks but claimed COMPLETED
              evidenceRefs: ['evidence/fail.log'],
              summary: 'Claimed completion despite failed test checks',
              uncertainty: 'None'
            });
            break;

          case 'forged_checks_strings':
            resolve({
              id: envelope.id,
              agent: envelope.agent,
              state: States.COMPLETED,
              changedFiles: this.changedFiles,
              checks: ['passed'], // Bare string label!
              evidenceRefs: [],
              summary: 'Worker returned bare string label check',
              uncertainty: 'None'
            });
            break;

          case 'forged_checks_empty_object':
            resolve({
              id: envelope.id,
              agent: envelope.agent,
              state: States.COMPLETED,
              changedFiles: this.changedFiles,
              checks: [{}], // Empty object!
              evidenceRefs: [],
              summary: 'Worker returned empty check object',
              uncertainty: 'None'
            });
            break;

          case 'forged_checks_malformed_boolean':
            resolve({
              id: envelope.id,
              agent: envelope.agent,
              state: States.COMPLETED,
              changedFiles: this.changedFiles,
              checks: [{ name: 'test', passed: 'true' }], // String boolean!
              evidenceRefs: [],
              summary: 'Worker returned malformed string boolean',
              uncertainty: 'None'
            });
            break;

          case 'forged_checks_number_boolean':
            resolve({
              id: envelope.id,
              agent: envelope.agent,
              state: States.COMPLETED,
              changedFiles: this.changedFiles,
              checks: [{ name: 'test', passed: 1 }], // Number boolean!
              evidenceRefs: [],
              summary: 'Worker returned number instead of boolean',
              uncertainty: 'None'
            });
            break;

          case 'unbounded_fields':
            resolve({
              id: envelope.id,
              agent: envelope.agent,
              state: States.COMPLETED,
              changedFiles: this.changedFiles,
              checks: [{ name: 'test', passed: true }],
              evidenceRefs: [],
              summary: 'A'.repeat(Bounds.MAX_STRING_CHARS + 100),
              uncertainty: 'None'
            });
            break;

          case 'invalid_state':
            resolve({
              id: envelope.id,
              agent: envelope.agent,
              state: 'BOGUS_INVALID_STATE',
              changedFiles: this.changedFiles,
              checks: [{ name: 'test', passed: true }],
              evidenceRefs: [],
              summary: 'Invalid state returned',
              uncertainty: 'None'
            });
            break;

          case 'check_failure':
            resolve({
              id: envelope.id,
              agent: envelope.agent,
              state: States.FAILED,
              changedFiles: this.changedFiles,
              checks: [{ name: 'test-suite', passed: false, error: '1 failed' }],
              evidenceRefs: ['evidence/check_fail.log'],
              summary: 'Checks failed during verification',
              uncertainty: 'None'
            });
            break;

          case 'scope_violation':
            resolve({
              id: envelope.id,
              agent: envelope.agent,
              state: States.FAILED,
              changedFiles: [],
              checks: [{ name: 'scope-check', passed: false, error: 'rejected outside allowedPaths' }],
              evidenceRefs: [],
              summary: 'Scope violation detected',
              uncertainty: 'None'
            });
            break;

          default:
            resolve({
              id: envelope.id,
              agent: envelope.agent,
              state: States.COMPLETED,
              changedFiles: this.changedFiles,
              checks: this.checks,
              evidenceRefs: [`evidence/${envelope.id}-diff.patch`],
              summary: 'RCT verification completed successfully',
              uncertainty: 'None'
            });
            break;
        }
      }, this.delayMs);

      abortSignal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('AbortError'));
      });
    });
  }
}

