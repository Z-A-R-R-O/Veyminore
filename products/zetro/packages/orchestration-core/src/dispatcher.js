import { States, Bounds, TERMINAL_STATES } from './types.js';
import { Journal } from './journal.js';

export class Dispatcher {
  constructor(adapter, journalPath) {
    this.adapter = adapter;
    this.journal = new Journal(journalPath);
    this.queue = [];
    this.stateMap = new Map();
    this.isProcessing = false;
    this.abortControllers = new Map();
    this._drainResolvers = [];
    this._transitionLocks = new Map();
  }

  _isTerminal(state) {
    return TERMINAL_STATES.has(state);
  }

  _isValidTransition(fromState, toState) {
    if (fromState === toState) return true;
    if (this._isTerminal(fromState)) return false;
    if (fromState === States.PENDING) {
      return (
        toState === States.RUNNING ||
        toState === States.CANCELLED ||
        toState === States.UNKNOWN ||
        toState === States.COMPLETED ||
        toState === States.SUBMITTED ||
        toState === States.FAILED
      );
    }
    if (fromState === States.RUNNING) {
      return (
        toState === States.COMPLETED ||
        toState === States.SUBMITTED ||
        toState === States.FAILED ||
        toState === States.UNKNOWN ||
        toState === States.CANCELLED
      );
    }
    return false;
  }

  async init() {
    const events = await this.journal.init();
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      if (event.type === 'SUBMIT' && event.payload?.id) {
        if (!this.stateMap.has(event.payload.id)) {
          this.stateMap.set(event.payload.id, States.PENDING);
          this.queue.push(event.payload);
        }
      } else if (event.type === 'TRANSITION' && event.payload?.id) {
        const id = event.payload.id;
        const targetState = event.payload.state;
        const currentState = this.stateMap.get(id);
        if (!this._isTerminal(currentState) && this._isValidTransition(currentState, targetState)) {
          this.stateMap.set(id, targetState);
          if (targetState !== States.PENDING && targetState !== States.RUNNING) {
            this.queue = this.queue.filter(e => e.id !== id);
          }
        }
      }
    }

    // Fail closed / quarantine handling for corrupted journals:
    // If ANY corruption was detected in the journal, we must never leave any possibly affected tasks as PENDING.
    // If a RUNNING transition was corrupted after SUBMIT, recovery must not leave the task PENDING and resend already-executed work.
    if (this.journal.corruptLines.length > 0) {
      const mentionedIds = new Set();
      for (const c of this.journal.corruptLines) {
        const matches = c.raw.matchAll(/"id"\s*:\s*"([^"]+)"/g);
        for (const m of matches) {
          mentionedIds.add(m[1]);
        }
      }

      for (const [id, state] of this.stateMap.entries()) {
        if (this._isTerminal(state)) continue;
        // Any non-terminal task in PENDING or mentioned in corruption cannot be safely executed
        if (state === States.PENDING || mentionedIds.has(id)) {
          await this._transition(id, States.UNKNOWN, {
            error: 'Journal corruption detected: uncertain execution state',
            uncertainty: 'Task may have been dispatched or executed prior to journal corruption'
          });
        }
      }
    }

    // Reconcile crashed tasks: any task left in RUNNING must become UNKNOWN
    for (const [id, state] of this.stateMap.entries()) {
      if (state === States.RUNNING) {
        await this._transition(id, States.UNKNOWN, {
          error: 'Crashed while RUNNING',
          uncertainty: 'In-flight when process crashed'
        });
      }
    }

    // Never automatically resend uncertain work; only clean PENDING tasks remain in queue
    const seen = new Set();
    this.queue = this.queue.filter(e => {
      if (seen.has(e.id) || this.stateMap.get(e.id) !== States.PENDING) {
        return false;
      }
      seen.add(e.id);
      return true;
    });
  }

  validateEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new Error('Invalid TaskEnvelope: missing required fields');
    }
    if (
      typeof envelope.id !== 'string' || !envelope.id.trim() ||
      typeof envelope.agent !== 'string' || !envelope.agent.trim() ||
      typeof envelope.objective !== 'string' || !envelope.objective.trim() ||
      typeof envelope.deadlineMs !== 'number'
    ) {
      throw new Error('Invalid TaskEnvelope: missing required fields');
    }
    if (
      envelope.id.length > Bounds.MAX_ID_CHARS ||
      envelope.agent.length > Bounds.MAX_STRING_CHARS ||
      envelope.objective.length > Bounds.MAX_OBJECTIVE_CHARS
    ) {
      throw new Error('Invalid TaskEnvelope: field length exceeds allowed bounds');
    }
    if (
      !Number.isSafeInteger(envelope.deadlineMs) ||
      envelope.deadlineMs < Bounds.MIN_DEADLINE_MS ||
      envelope.deadlineMs > Bounds.MAX_DEADLINE_MS
    ) {
      throw new Error('Invalid TaskEnvelope: deadlineMs missing or invalid bounds');
    }
    if (!Array.isArray(envelope.contextRefs) || !Array.isArray(envelope.allowedPaths)) {
      throw new Error('Invalid TaskEnvelope: contextRefs/allowedPaths must be arrays');
    }
    if (
      envelope.contextRefs.length > Bounds.MAX_ARRAY_ITEMS ||
      envelope.allowedPaths.length > Bounds.MAX_ARRAY_ITEMS
    ) {
      throw new Error('Invalid TaskEnvelope: array size exceeds allowed bounds');
    }
    for (const ref of envelope.contextRefs) {
      if (typeof ref !== 'string' || ref.length > Bounds.MAX_STRING_CHARS) {
        throw new Error('Invalid TaskEnvelope: contextRef items must be strings within bounds');
      }
    }
    for (const p of envelope.allowedPaths) {
      if (typeof p !== 'string' || p.length > Bounds.MAX_STRING_CHARS) {
        throw new Error('Invalid TaskEnvelope: allowedPath items must be strings within bounds');
      }
    }
    if (typeof envelope.acceptance !== 'string' || typeof envelope.verification !== 'string') {
      throw new Error('Invalid TaskEnvelope: acceptance/verification must be strings');
    }
    if (
      envelope.acceptance.length > Bounds.MAX_OBJECTIVE_CHARS ||
      envelope.verification.length > Bounds.MAX_OBJECTIVE_CHARS
    ) {
      throw new Error('Invalid TaskEnvelope: acceptance/verification exceeds allowed bounds');
    }
    if (!envelope.budget || typeof envelope.budget !== 'object') {
      throw new Error('Invalid TaskEnvelope: budget fields missing or invalid bounds');
    }
    if (
      typeof envelope.budget.maxContextChars !== 'number' ||
      typeof envelope.budget.maxReplyChars !== 'number' ||
      !Number.isSafeInteger(envelope.budget.maxContextChars) ||
      !Number.isSafeInteger(envelope.budget.maxReplyChars) ||
      envelope.budget.maxContextChars < Bounds.MIN_BUDGET_CHARS ||
      envelope.budget.maxReplyChars < Bounds.MIN_BUDGET_CHARS ||
      envelope.budget.maxContextChars > Bounds.MAX_BUDGET_CHARS ||
      envelope.budget.maxReplyChars > Bounds.MAX_BUDGET_CHARS
    ) {
      throw new Error('Invalid TaskEnvelope: budget fields missing or invalid bounds');
    }
    if (this.stateMap.has(envelope.id)) {
      throw new Error(`Duplicate Task ID: ${envelope.id}`);
    }
  }

  async submit(envelope) {
    this.validateEnvelope(envelope);
    // Reserve ID synchronously in stateMap to prevent duplicate ID races under concurrent submissions
    this.stateMap.set(envelope.id, States.PENDING);
    try {
      await this.journal.append({ type: 'SUBMIT', payload: envelope });
    } catch (err) {
      this.stateMap.delete(envelope.id);
      throw err;
    }
    this.queue.push(envelope);
    this._processQueue();
  }

  async drain() {
    if (!this.isProcessing && this.queue.length === 0) return;
    await new Promise(resolve => this._drainResolvers.push(resolve));
  }

  async cancel(id) {
    if (!this.stateMap.has(id)) return false;
    const state = this.stateMap.get(id);
    if (this._isTerminal(state)) {
      return false;
    }

    this.queue = this.queue.filter(e => e.id !== id);

    let ac = this.abortControllers.get(id);
    if (!ac) {
      ac = new AbortController();
      this.abortControllers.set(id, ac);
    }
    ac.abort();

    await this._transition(id, States.CANCELLED);
    return true;
  }

  async _transition(id, state, extra = {}) {
    const prevLock = this._transitionLocks.get(id) || Promise.resolve();
    let resolveLock;
    const currentLock = new Promise(resolve => { resolveLock = resolve; });
    this._transitionLocks.set(id, currentLock);

    await prevLock;
    try {
      const currentState = this.stateMap.get(id);
      if (currentState === state) return;
      if (this._isTerminal(currentState)) return;
      if (!this._isValidTransition(currentState, state)) {
        throw new Error(`Invalid state transition from ${currentState} to ${state} for task ${id}`);
      }
      await this.journal.append({ type: 'TRANSITION', payload: { id, state, ...extra } });
      this.stateMap.set(id, state);
    } finally {
      resolveLock();
      if (this._transitionLocks.get(id) === currentLock) {
        this._transitionLocks.delete(id);
      }
    }
  }

  async _processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      while (this.queue.length > 0) {
        const index = this.queue.findIndex(e => this.stateMap.get(e.id) === States.PENDING);
        if (index === -1) {
          this.queue = [];
          break;
        }
        const envelope = this.queue.splice(index, 1)[0];
        try {
          await this._executeTask(envelope);
        } catch (err) {
          this.lastError = err;
        }
      }
    } finally {
      this.isProcessing = false;
      while (this._drainResolvers.length) {
        this._drainResolvers.shift()();
      }
      if (this.queue.some(e => this.stateMap.get(e.id) === States.PENDING)) {
        this._processQueue();
      }
    }
  }

  async _executeTask(envelope) {
    let ac = this.abortControllers.get(envelope.id);
    if (ac?.signal.aborted) return;
    if (this.stateMap.get(envelope.id) !== States.PENDING) return;

    await this._transition(envelope.id, States.RUNNING);

    ac = this.abortControllers.get(envelope.id);
    if (ac?.signal.aborted || this.stateMap.get(envelope.id) === States.CANCELLED) {
      if (this.stateMap.get(envelope.id) !== States.CANCELLED) {
        await this._transition(envelope.id, States.CANCELLED);
      }
      return;
    }

    if (!ac) {
      ac = new AbortController();
      this.abortControllers.set(envelope.id, ac);
    }

    let timeoutId;
    let deadlineFired = false;
    const deadlinePromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        deadlineFired = true;
        reject(new Error('Deadline exceeded'));
      }, envelope.deadlineMs);
    });

    let receipt;
    try {
      receipt = await Promise.race([
        this.adapter.execute(envelope, ac.signal),
        deadlinePromise
      ]);
    } catch (error) {
      clearTimeout(timeoutId);

      // 1. Cancellation during active execution: never overwrite CANCELLED
      if (this.stateMap.get(envelope.id) === States.CANCELLED || ac.signal.aborted || error.name === 'AbortError') {
        if (this.stateMap.get(envelope.id) !== States.CANCELLED) {
          await this._transition(envelope.id, States.CANCELLED);
        }
        return;
      }

      // 2. Deadline exceeded race
      if (error.message === 'Deadline exceeded' || deadlineFired) {
        ac.abort();
        if (this.stateMap.get(envelope.id) === States.RUNNING) {
          await this._transition(envelope.id, States.UNKNOWN, {
            error: 'Deadline exceeded',
            uncertainty: 'In-flight when deadline exceeded'
          });
        }
        return;
      }

      // 3. Adapter error
      if (this.stateMap.get(envelope.id) === States.RUNNING) {
        await this._transition(envelope.id, States.FAILED, { error: error.message });
      }
      return;
    } finally {
      clearTimeout(timeoutId);
      this.abortControllers.delete(envelope.id);
    }

    clearTimeout(timeoutId);

    // CRITICAL: Late successful adapter return after cancellation must NEVER overwrite CANCELLED
    if (this.stateMap.get(envelope.id) === States.CANCELLED || ac.signal.aborted) {
      if (this.stateMap.get(envelope.id) !== States.CANCELLED) {
        await this._transition(envelope.id, States.CANCELLED);
      }
      return;
    }

    // Only transition if still in RUNNING state
    if (this.stateMap.get(envelope.id) !== States.RUNNING) {
      return;
    }

    if (
      !receipt ||
      receipt.id !== envelope.id ||
      receipt.agent !== envelope.agent ||
      ![States.SUBMITTED, States.COMPLETED, States.FAILED, States.UNKNOWN].includes(receipt.state)
    ) {
      await this._transition(envelope.id, States.FAILED, {
        error: 'Invalid adapter receipt: mismatch or bad state'
      });
      return;
    }

    await this._transition(envelope.id, receipt.state, { receipt });
  }

  getState(id) {
    return this.stateMap.get(id);
  }
}
