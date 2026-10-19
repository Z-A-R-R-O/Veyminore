import { activityLabel } from './activity-label.js';
import { createIntentStatus } from './intent-status.js';
import { createSmartStatus, VALID_PHASES } from './smart-status.js';

export const OverlayState = Object.freeze({
  OFF: 'off',
  INTENTION: 'intention',
  OBSERVING: 'observing',
  THINKING: 'thinking',
  REQUESTING_CONTROL: 'requesting_control',
  ACTING: 'acting',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  DISCONNECTED: 'disconnected',
  EXPIRED: 'expired'
});
const inactive = new Set(['off', 'paused', 'stopped', 'disconnected', 'expired']);

export class AuthoritativeOverlayBridge {
  constructor({
    emitEvent = null,
    sessionId = null,
    taskId = null,
    expiresAt = null,
    clock = Date.now,
    intent = null,
    createIntentStatus = null,
    smartStatus = null,
    createSmartStatus: customCreateSmartStatus = null
  } = {}) {
    this.emitEvent = emitEvent;
    this.sessionId = sessionId;
    this.taskId = taskId || sessionId;
    this.expiresAt = expiresAt;
    this.clock = clock;
    this.sequence = 0;
    this.currentState = 'off';
    this.pointer = { x: 0, y: 0, visible: false, targetId: null };
    this.display = null;
    this.timer = null;
    this.currentTarget = null;
    this._customCreateIntentStatus = createIntentStatus;
    this.setIntent(intent);
    if (smartStatus) {
      this.smartStatus = smartStatus;
    } else if (customCreateSmartStatus) {
      this.smartStatus = typeof customCreateSmartStatus === 'function'
        ? customCreateSmartStatus({ clock: this.clock })
        : null;
    } else {
      this.smartStatus = null;
    }
    this.activity = this._describeActivity('off');
  }

  setIntent(intent) {
    this.intent = (intent && typeof intent === 'object') ? intent : null;
    this.intentStatus = null;
    if (this.intent) {
      const factory = this._customCreateIntentStatus || createIntentStatus;
      if (typeof factory === 'function') {
        try {
          this.intentStatus = factory(this.intent);
        } catch {
          this.intentStatus = null;
        }
      }
    }
  }

  get hasIntent() {
    return Boolean(this.intentStatus);
  }

  setSmartStatus(smartStatus) {
    this.smartStatus = smartStatus;
  }

  get hasSmartStatus() {
    return Boolean(this.smartStatus);
  }

  _describeActivity(phase, actionType = null) {
    if (this.intentStatus && typeof this.intentStatus.describe === 'function') {
      try {
        const desc = this.intentStatus.describe(phase, actionType);
        if (desc && typeof desc.phase === 'string' && typeof desc.text === 'string') {
          return desc;
        }
      } catch {
        // Fall back to activityLabel
      }
    }
    return activityLabel(phase, actionType);
  }

  transition(state, { sessionId = this.sessionId, targetId = null, pointer = null, display = null, expiresAt = this.expiresAt, activity = null } = {}) {
    if (!Object.values(OverlayState).includes(state)) throw new Error('Unsupported overlay state');
    if (this.sessionId && sessionId !== this.sessionId) throw new Error('Overlay session mismatch');
    if (this.expiresAt !== null && expiresAt !== null && expiresAt > this.expiresAt) throw new Error('Overlay expiry cannot be extended');
    if (!inactive.has(state) && !sessionId) throw new Error('Active overlay requires a session identity');
    if (!inactive.has(state) && !targetId) { state = 'paused'; pointer = null; display = null; }
    if (['stopped', 'expired', 'disconnected'].includes(this.currentState) && !inactive.has(state)) throw new Error('Ended overlay requires a new bridge/session');
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= this.clock())) state = 'expired';
    const sameTarget = this.currentTarget === targetId;
    const previousPointer = this.pointer, previousDisplay = this.display;
    this.sessionId = sessionId; this.expiresAt = expiresAt; this.currentState = state; this.sequence++;
    this.currentTarget = targetId;
    const targetPhase = state === 'expired' ? 'expired' : activity?.phase || state;
    this.activity = this._describeActivity(targetPhase, activity?.actionType);
    this.pointer = { x: 0, y: 0, visible: false, targetId: null }; this.display = null;
    if (['observing', 'thinking', 'acting', 'intention'].includes(state)) {
      this.display = display ?? (sameTarget ? previousDisplay : null);
      if (Number.isFinite(pointer?.x) && Number.isFinite(pointer?.y)) this.pointer = { x: pointer.x, y: pointer.y, visible: true, targetId };
      else if (sameTarget && previousPointer.visible) this.pointer = { ...previousPointer };
    }
    clearTimeout(this.timer);
    if (expiresAt && ['observing', 'thinking', 'acting', 'requesting_control', 'intention'].includes(state)) {
      this.timer = setTimeout(() => this.transition('expired', { sessionId }), Math.min(2147483647, Math.max(1, expiresAt - this.clock())));
      this.timer.unref?.();
    }
    if (this.smartStatus && typeof this.smartStatus.update === 'function') {
      const taskId = this.taskId || sessionId || this.sessionId;
      let smartPhase = targetPhase;
      if (smartPhase === 'off' || smartPhase === 'expired') smartPhase = 'stopped';
      if (smartPhase === 'requesting_control') smartPhase = 'observing';
      if (VALID_PHASES.includes(smartPhase)) {
        const snap = typeof this.smartStatus.getSnapshot === 'function' ? this.smartStatus.getSnapshot() : null;
        if (snap && snap.taskId === null && smartPhase !== 'intention') {
          this.smartStatus.update({
            taskId,
            sequence: 0,
            phase: 'intention',
            actionType: null,
            intent: this.intent,
            verified: false,
            stepId: null
          });
        }
        this.smartStatus.update({
          taskId,
          sequence: this.sequence,
          phase: smartPhase,
          actionType: activity?.actionType || null,
          intent: this.intent,
          verified: activity?.verified === true,
          stepId: activity?.stepId || null
        });
      }
    }
    const payload = { ...this.getSnapshot(), sessionId, targetId, timestamp: this.clock(), expiresAt };
    this.emitEvent?.('computer_overlay_state', payload);
    return payload;
  }

  getSnapshot() {
    const snap = {
      sequence: this.sequence,
      state: this.currentState,
      pointer: { ...this.pointer },
      controlledDisplay: this.display,
      activity: { ...this.activity },
      auraActive: ['acting', 'observing', 'thinking', 'intention'].includes(this.currentState)
    };
    if (this.smartStatus && typeof this.smartStatus.getSnapshot === 'function') {
      snap.smartStatus = this.smartStatus.getSnapshot();
    }
    return snap;
  }

  close() {
    clearTimeout(this.timer);
    try {
      this.transition('stopped');
    } catch {}
    try {
      this.smartStatus?.close?.();
    } catch {}
  }
}
