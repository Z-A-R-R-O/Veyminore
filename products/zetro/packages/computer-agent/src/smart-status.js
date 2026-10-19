/**
 * @file smart-status.js
 * Authoritative lifecycle status controller for ZETRO Computer Agent.
 *
 * Implements deterministic phase aggregation, verified-step accumulation,
 * honest latency tracking, and privacy-guarded status descriptions.
 */

import { createIntentStatus } from './intent-status.js';

export const VALID_PHASES = Object.freeze([
  'intention',
  'observing',
  'thinking',
  'acting',
  'checking',
  'completed',
  'blocked',
  'failed',
  'uncertain',
  'cancelled',
  'paused',
  'stopped'
]);

export const TERMINAL_PHASES = Object.freeze([
  'completed',
  'failed',
  'blocked',
  'uncertain',
  'cancelled',
  'stopped'
]);

const MAX_VERIFIED_STEPS = 20;
const OBSERVING_TIMEOUT_MS = 8000;

/**
 * Creates an authoritative smart status controller.
 *
 * @param {object} [options]
 * @param {() => number} [options.clock=Date.now] - Monotonic/epoch clock provider
 * @param {(snapshot: object) => void} [options.onChange] - Optional listener for state transitions
 * @returns {{ update: (event: object) => boolean, getSnapshot: () => object, close: () => void }}
 */
export function createSmartStatus({ clock = Date.now, onChange = () => {} } = {}) {
  let closed = false;
  let taskId = null;
  let lastSequence = -1;
  let phase = 'off';
  let intentStatus = null;
  let activeText = 'Ready when you are';
  let startTime = 0;
  let phaseStartTime = 0;
  let frozenElapsedMs = null;
  let frozenPhaseElapsedMs = null;
  let settledReason = null;
  let verifiedSteps = [];
  let currentStep = null;
  let currentIntent = null;

  function buildSnapshot() {
    const now = typeof clock === 'function' ? clock() : Date.now();
    const isWorking = phase === 'intention' ||
      phase === 'observing' ||
      phase === 'thinking' ||
      phase === 'acting';

    let elapsedMs = 0;
    let phaseElapsedMs = 0;

    if (startTime > 0) {
      elapsedMs = frozenElapsedMs !== null ? frozenElapsedMs : Math.max(0, now - startTime);
    }
    if (phaseStartTime > 0) {
      phaseElapsedMs = frozenPhaseElapsedMs !== null ? frozenPhaseElapsedMs : Math.max(0, now - phaseStartTime);
    }

    let text = activeText;
    if (phase === 'observing' && phaseElapsedMs >= OBSERVING_TIMEOUT_MS) {
      text = 'Still locating the target\u2026';
    }

    return {
      taskId,
      sequence: lastSequence >= 0 ? lastSequence : 0,
      phase,
      text,
      working: isWorking,
      elapsedMs,
      phaseElapsedMs,
      verifiedSteps: verifiedSteps.map(s => ({ ...s })),
      currentStep: currentStep ? { ...currentStep } : null,
      intent: currentIntent ? { ...currentIntent } : null,
      settledReason
    };
  }

  function emitChange() {
    if (closed) return;
    try {
      onChange(buildSnapshot());
    } catch {
      // Listener errors must not disrupt internal controller state
    }
  }

  return {
    update(event) {
      if (closed || !event || typeof event !== 'object') {
        return false;
      }

      const {
        taskId: evTaskId,
        sequence: evSeq,
        phase: evPhase,
        actionType: evAction,
        intent: evIntent,
        verified: evVerified,
        stepId: evStepId
      } = event;

      // 1. Validate taskId (non-empty string <= 128 chars)
      if (typeof evTaskId !== 'string' || !evTaskId.trim() || evTaskId.length > 128) {
        return false;
      }

      // 2. Validate phase
      if (!VALID_PHASES.includes(evPhase)) {
        return false;
      }

      // 3. Validate sequence (strictly integer >= 0)
      if (typeof evSeq !== 'number' || !Number.isInteger(evSeq) || evSeq < 0) {
        return false;
      }

      const now = typeof clock === 'function' ? clock() : Date.now();

      // 4. Task lifecycle management:
      // A new task may only start via 'intention' phase if there is no task or if the previous task is terminal
      if (taskId !== evTaskId) {
        const isCurrentTerminal = !taskId || TERMINAL_PHASES.includes(phase);
        if (evPhase !== 'intention' || !isCurrentTerminal) {
          // Reject foreign or non-intention events for a new task
          return false;
        }

        // Reset state for new task
        taskId = evTaskId;
        lastSequence = -1;
        verifiedSteps = [];
        currentStep = null;
        settledReason = null;
        frozenElapsedMs = null;
        frozenPhaseElapsedMs = null;
        startTime = now;
        phaseStartTime = now;
        intentStatus = evIntent ? createIntentStatus(evIntent) : null;
      } else {
        // Same task: sequence must be strictly monotonic
        if (evSeq <= lastSequence) {
          return false;
        }

        // Cannot transition from terminal states
        if (TERMINAL_PHASES.includes(phase)) {
          return false;
        }
      }

      lastSequence = evSeq;
      phase = evPhase;

      if (evIntent) {
        currentIntent = {
          operation: evIntent.operation,
          targetLabel: evIntent.targetLabel,
          destinationLabel: evIntent.destinationLabel,
          application: evIntent.application
        };
        intentStatus = createIntentStatus(evIntent);
      }
      if (!intentStatus) {
        intentStatus = createIntentStatus({ operation: 'unknown' });
      }

      phaseStartTime = now;

      // Resolve base phrase via createIntentStatus
      const phraseObj = intentStatus.describe(evPhase, evAction);
      activeText = phraseObj.text;

      // Completed phase requires verified === true
      if (evPhase === 'completed') {
        if (evVerified !== true) {
          // Verification missing or false: completed is invalid; settle as uncertain
          phase = 'uncertain';
          activeText = intentStatus.describe('uncertain', evAction).text;
          settledReason = 'uncertain';
        } else {
          settledReason = 'completed';
        }
      } else if (TERMINAL_PHASES.includes(evPhase)) {
        settledReason = evPhase;
      } else {
        settledReason = null;
      }

      // Handle step tracking
      if (evPhase === 'checking') {
        currentStep = null;
        if (evVerified === true) {
          if (verifiedSteps.length < MAX_VERIFIED_STEPS) {
            verifiedSteps.push({
              id: evStepId || `step-${verifiedSteps.length + 1}`,
              text: activeText
            });
          }
        }
      } else if (TERMINAL_PHASES.includes(phase) || evPhase === 'paused') {
        currentStep = null;
      } else {
        currentStep = {
          id: evStepId || `step-${lastSequence}`,
          text: activeText
        };
      }

      // Freeze elapsed latency on terminal states or pause
      if (TERMINAL_PHASES.includes(phase) || evPhase === 'paused') {
        frozenElapsedMs = Math.max(0, now - startTime);
        frozenPhaseElapsedMs = Math.max(0, now - phaseStartTime);
      } else {
        frozenElapsedMs = null;
        frozenPhaseElapsedMs = null;
      }

      emitChange();
      return true;
    },

    getSnapshot() {
      return buildSnapshot();
    },

    close() {
      closed = true;
    }
  };
}
