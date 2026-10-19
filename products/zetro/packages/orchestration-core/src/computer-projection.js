import { SqliteTaskStore } from './task-store.js';
import { sanitizeSummary } from './worker-projection.js';

export const ComputerSessionStates = Object.freeze({
  OBSERVED: 'observed',
  GRANTED: 'granted',
  ACTING: 'acting',
  PAUSED: 'paused',
  REVOKED: 'revoked',
  STOPPED: 'stopped',
  DISCONNECTED: 'disconnected',
  EXPIRED: 'expired'
});

export const COMPUTER_SESSION_SCHEMA_VERSION = 1;

export const NATIVE_LIMITATION_NOTICE =
  'Native Windows desktop execution (Win32/UIA/DirectX) is not qualified in this increment. All interactions are simulated, projected, or broker-mediated. Actor claims of native or verified access are unverified and denied by policy.';

/**
 * Durable read-only / projection interface for Computer sessions and event streams.
 *
 * Enforces strict boundary invariants:
 * 1. Exact identity binding: session, target, task, attempt, sequence.
 * 2. Strictly monotonic sequence numbers (regression / replay rejection).
 * 3. Future timestamps rejected (fail closed beyond 5000ms skew tolerance).
 * 4. No actor claim can establish verified or native access (always denied/unverified).
 * 5. Stop and revoke are terminal for effects (subsequent active transitions rejected).
 * 6. Disconnect clears active flags (acting=false, granted=false).
 * 7. Bounded read-only feed for overlay with companion pointer visible ONLY during acting.
 */
export class ComputerSessionProjection {
  /**
   * @param {import('./task-store.js').TaskStore} store Authoritative TaskStore
   * @param {Object} [options]
   * @param {boolean} [options.readOnly=false] Whether projection is read-only
   */
  constructor(store, options = {}) {
    if (!store) {
      throw new Error('TaskStore is required for ComputerSessionProjection');
    }
    this.store = store;
    this.readOnly = Boolean(options.readOnly || store.readOnly);
  }

  /**
   * Open an existing SQLite database in strictly read-only mode for computer projection.
   * Fails closed if the database file does not exist or schema is incompatible.
   *
   * @param {string} dbPath Path to existing SQLite database file
   * @param {Object} [options]
   * @returns {Promise<ComputerSessionProjection>}
   */
  static async openReadOnly(dbPath, options = {}) {
    const store = await SqliteTaskStore.openReadOnly(dbPath, options);
    // Ensure computer_sessions table exists in the read-only store
    const tableExists = store.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='computer_sessions';"
    ).get();
    if (!tableExists) {
      store.close();
      throw new Error(`Incompatible SQLite schema for computer projection: table 'computer_sessions' not found in '${dbPath}'`);
    }
    return new ComputerSessionProjection(store, { ...options, readOnly: true });
  }

  close() {
    if (this.store) {
      this.store.close();
    }
  }

  _assertWritable(action = 'mutate') {
    if (this.readOnly) {
      throw new Error(`Cannot ${action} in read-only ComputerSessionProjection`);
    }
  }

  /**
   * Register a new Computer session.
   *
   * @param {Object} params
   * @param {string} params.sessionId Unique session identifier
   * @param {string} params.targetId Target window/surface/control identifier
   * @param {string} params.targetKind Target surface kind (e.g. 'window', 'display', 'control')
   * @param {string} [params.taskId] Optional bound task identifier
   * @param {string} [params.attemptId] Optional bound attempt identifier
   * @param {number} [params.expiresInMs=3600000] Session TTL in milliseconds
   * @param {Object} [params.metadata={}] Additional session metadata
   * @returns {Object} Initial session projection
   */
  registerSession(params) {
    this._assertWritable('register session');
    if (!params || typeof params !== 'object') {
      throw new Error('Session parameters must be an object');
    }
    if (!params.sessionId || typeof params.sessionId !== 'string') {
      throw new Error('Session sessionId is required and must be a non-empty string');
    }
    if (!params.targetId || typeof params.targetId !== 'string') {
      throw new Error('Session targetId is required and must be a non-empty string');
    }
    if (!params.targetKind || typeof params.targetKind !== 'string') {
      throw new Error('Session targetKind is required and must be a non-empty string');
    }

    const now = Date.now();
    const expiresInMs = typeof params.expiresInMs === 'number' && params.expiresInMs > 0
      ? params.expiresInMs
      : 3600000;

    const initialSession = {
      sessionId: params.sessionId,
      targetId: params.targetId,
      targetKind: params.targetKind,
      taskId: params.taskId || null,
      attemptId: params.attemptId || null,
      state: ComputerSessionStates.OBSERVED,
      phase: 'registered',
      acting: false,
      granted: false,
      paused: false,
      // INVARIANT: No actor claim can establish verified or native access
      verified: false,
      isNative: false,
      lastSequence: 1,
      lastTimestamp: now,
      expiresAt: now + expiresInMs,
      metadata: params.metadata || {}
    };

    this.store.createComputerSession(initialSession);

    // Record initial registration event (sequence 1)
    this.store.recordComputerEvent(params.sessionId, {
      sequence: 1,
      eventType: 'session_registered',
      targetId: params.targetId,
      taskId: params.taskId || null,
      attemptId: params.attemptId || null,
      payload: {
        targetKind: params.targetKind,
        metadata: params.metadata || {}
      },
      timestamp: now
    });

    return this.getSessionProjection(params.sessionId);
  }

  /**
   * Record a lifecycle or interaction event for a session.
   *
   * @param {string} sessionId
   * @param {Object} eventInput
   * @returns {Object} Updated session projection
   */
  recordEvent(sessionId, eventInput) {
    this._assertWritable('record event');
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('sessionId must be a non-empty string');
    }
    if (!eventInput || typeof eventInput !== 'object') {
      throw new Error('eventInput must be a valid object');
    }

    const session = this.store.getComputerSession(sessionId);
    if (!session) {
      throw new Error(`Computer session not found: ${sessionId}`);
    }

    // INVARIANT 5: Stop and Revoke are terminal for effects
    if (session.state === ComputerSessionStates.STOPPED || session.state === ComputerSessionStates.REVOKED) {
      throw new Error(`Cannot record event on terminal session (${session.state}): ${sessionId}`);
    }

    // INVARIANT 1: Exact identity binding
    if (eventInput.sessionId && eventInput.sessionId !== sessionId) {
      throw new Error(`Event sessionId mismatch: expected '${sessionId}', got '${eventInput.sessionId}'`);
    }
    if (eventInput.targetId && eventInput.targetId !== session.targetId) {
      throw new Error(`Event targetId mismatch: expected '${session.targetId}', got '${eventInput.targetId}'`);
    }
    if (session.taskId && eventInput.taskId && eventInput.taskId !== session.taskId) {
      throw new Error(`Event taskId mismatch: expected '${session.taskId}', got '${eventInput.taskId}'`);
    }
    if (session.attemptId && eventInput.attemptId && eventInput.attemptId !== session.attemptId) {
      throw new Error(`Event attemptId mismatch: expected '${session.attemptId}', got '${eventInput.attemptId}'`);
    }

    // INVARIANT 2: Strictly monotonic sequence
    if (!Number.isInteger(eventInput.sequence) || eventInput.sequence <= session.lastSequence) {
      throw new Error(
        `Sequence regression or replay detected: event sequence ${eventInput.sequence} is not strictly greater than session last sequence ${session.lastSequence}`
      );
    }

    // INVARIANT 3: Future timestamps rejected
    const now = Date.now();
    const timestamp = typeof eventInput.timestamp === 'number' ? eventInput.timestamp : now;
    if (timestamp > now + 5000) {
      throw new Error(`Event timestamp cannot be in the future (skew limit 5000ms): ${timestamp}`);
    }

    // INVARIANT 4: No actor claim can establish verified or native access
    const safePayload = (eventInput.payload && typeof eventInput.payload === 'object')
      ? { ...eventInput.payload }
      : {};
    delete safePayload.verified;
    delete safePayload.isNative;

    // Transition evaluation
    let nextState = session.state;
    let nextActing = session.acting;
    let nextGranted = session.granted;
    let nextPaused = session.paused;
    let stoppedAt = session.stoppedAt;
    let revokedAt = session.revokedAt;

    const eventType = String(eventInput.eventType || '').toLowerCase();
    const requestedState = eventInput.state ? String(eventInput.state).toLowerCase() : null;

    if (eventType === 'grant' || requestedState === ComputerSessionStates.GRANTED) {
      nextState = ComputerSessionStates.GRANTED;
      nextGranted = true;
      nextActing = false;
      nextPaused = false;
    } else if (
      eventType === 'start_action' ||
      eventType === 'action_begin' ||
      eventType === 'action_executing' ||
      requestedState === ComputerSessionStates.ACTING
    ) {
      if (!session.granted && !nextGranted) {
        throw new Error(`Cannot start action without granted control on session: ${sessionId}`);
      }
      nextState = ComputerSessionStates.ACTING;
      nextActing = true;
      nextPaused = false;
    } else if (
      eventType === 'end_action' ||
      eventType === 'action_complete' ||
      eventType === 'action_idle'
    ) {
      nextState = nextGranted ? ComputerSessionStates.GRANTED : ComputerSessionStates.OBSERVED;
      nextActing = false;
    } else if (eventType === 'pause' || requestedState === ComputerSessionStates.PAUSED) {
      nextState = ComputerSessionStates.PAUSED;
      nextPaused = true;
      nextActing = false;
    } else if (eventType === 'resume') {
      nextState = nextGranted ? ComputerSessionStates.GRANTED : ComputerSessionStates.OBSERVED;
      nextPaused = false;
    } else if (eventType === 'disconnect' || requestedState === ComputerSessionStates.DISCONNECTED) {
      // INVARIANT 6: Disconnect clears active flags
      nextState = ComputerSessionStates.DISCONNECTED;
      nextActing = false;
      nextGranted = false;
    } else if (eventType === 'stop' || requestedState === ComputerSessionStates.STOPPED) {
      // INVARIANT 5: Stop is terminal for effects
      nextState = ComputerSessionStates.STOPPED;
      nextActing = false;
      nextGranted = false;
      stoppedAt = timestamp;
    } else if (eventType === 'revoke' || requestedState === ComputerSessionStates.REVOKED) {
      // INVARIANT 5: Revoke is terminal for effects
      nextState = ComputerSessionStates.REVOKED;
      nextActing = false;
      nextGranted = false;
      revokedAt = timestamp;
    }

    // Persist event
    this.store.recordComputerEvent(sessionId, {
      sequence: eventInput.sequence,
      eventType: eventInput.eventType,
      targetId: session.targetId,
      taskId: session.taskId,
      attemptId: session.attemptId,
      payload: safePayload,
      timestamp
    });

    // Update session record
    this.store.updateComputerSession(sessionId, {
      state: nextState,
      phase: eventInput.phase || session.phase,
      acting: nextActing,
      granted: nextGranted,
      paused: nextPaused,
      verified: false,
      isNative: false,
      lastSequence: eventInput.sequence,
      lastTimestamp: timestamp,
      stoppedAt,
      revokedAt
    });

    return this.getSessionProjection(sessionId);
  }

  /**
   * Stop session. Terminal for effects.
   *
   * @param {string} sessionId
   * @param {string} [reason='Operator stopped session']
   * @returns {Object} Updated session projection
   */
  stopSession(sessionId, reason = 'Operator stopped session') {
    const session = this.store.getComputerSession(sessionId);
    if (!session) {
      throw new Error(`Computer session not found: ${sessionId}`);
    }
    if (session.state === ComputerSessionStates.STOPPED || session.state === ComputerSessionStates.REVOKED) {
      return this.getSessionProjection(sessionId);
    }
    return this.recordEvent(sessionId, {
      sequence: session.lastSequence + 1,
      eventType: 'stop',
      payload: { reason }
    });
  }

  /**
   * Revoke session control. Terminal for effects.
   *
   * @param {string} sessionId
   * @param {string} [reason='Authorization revoked']
   * @returns {Object} Updated session projection
   */
  revokeSession(sessionId, reason = 'Authorization revoked') {
    const session = this.store.getComputerSession(sessionId);
    if (!session) {
      throw new Error(`Computer session not found: ${sessionId}`);
    }
    if (session.state === ComputerSessionStates.REVOKED) {
      return this.getSessionProjection(sessionId);
    }
    return this.recordEvent(sessionId, {
      sequence: session.lastSequence + 1,
      eventType: 'revoke',
      payload: { reason }
    });
  }

  /**
   * Disconnect session. Clears active flags (acting=false, granted=false).
   *
   * @param {string} sessionId
   * @param {string} [reason='Target disconnected']
   * @returns {Object} Updated session projection
   */
  disconnectSession(sessionId, reason = 'Target disconnected') {
    const session = this.store.getComputerSession(sessionId);
    if (!session) {
      throw new Error(`Computer session not found: ${sessionId}`);
    }
    return this.recordEvent(sessionId, {
      sequence: session.lastSequence + 1,
      eventType: 'disconnect',
      payload: { reason }
    });
  }

  /**
   * Get durable session projection by session ID.
   *
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getSessionProjection(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      return null;
    }
    const session = this.store.getComputerSession(sessionId);
    if (!session) {
      return null;
    }

    const now = Date.now();
    let effectiveState = session.state;
    let effectiveActing = session.acting;
    let effectiveGranted = session.granted;

    // Check expiration dynamically if not in terminal state
    if (
      now > session.expiresAt &&
      session.state !== ComputerSessionStates.STOPPED &&
      session.state !== ComputerSessionStates.REVOKED
    ) {
      effectiveState = ComputerSessionStates.EXPIRED;
      effectiveActing = false;
      effectiveGranted = false;
    }

    return {
      sessionId: session.sessionId,
      targetId: session.targetId,
      targetKind: session.targetKind,
      taskId: session.taskId,
      attemptId: session.attemptId,
      state: effectiveState,
      phase: session.phase,
      indicators: {
        acting: effectiveActing,
        granted: effectiveGranted,
        paused: session.paused,
        // INVARIANT 4: No actor claim can establish verified or native access
        verified: false,
        isNative: false
      },
      lastSequence: session.lastSequence,
      lastTimestamp: session.lastTimestamp,
      expiresAt: session.expiresAt,
      stoppedAt: session.stoppedAt,
      revokedAt: session.revokedAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      metadata: session.metadata,
      limitations: NATIVE_LIMITATION_NOTICE
    };
  }

  /**
   * Read-only bounded feed for overlay display.
   * Companion pointer is visible ONLY when acting is true.
   *
   * @param {string} sessionId
   * @param {Object} [options]
   * @param {number} [options.sinceSequence] Fetch events strictly after this sequence
   * @param {number} [options.limit=20] Maximum events to include (max 100)
   * @returns {Object|null}
   */
  getOverlayFeed(sessionId, options = {}) {
    const projection = this.getSessionProjection(sessionId);
    if (!projection) {
      return null;
    }

    const limit = typeof options.limit === 'number' && options.limit > 0
      ? Math.min(options.limit, 100)
      : 20;

    const events = this.store.getComputerEvents(sessionId, {
      sinceSequence: options.sinceSequence,
      limit,
      order: 'ASC'
    });

    // Extract latest pointer position from recent events
    let latestPointer = { x: null, y: null };
    for (const ev of events) {
      const payload = ev.payload || {};
      const coords = payload.pointer || (typeof payload.x === 'number' && typeof payload.y === 'number' ? payload : null);
      if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
        latestPointer = { x: coords.x, y: coords.y };
      }
    }

    // INVARIANT 7: Companion pointer is visible ONLY during acting === true
    const isPointerVisible = Boolean(projection.indicators.acting && latestPointer.x != null && latestPointer.y != null);

    const boundedEvents = events.map(ev => ({
      id: ev.id,
      sequence: ev.sequence,
      eventType: ev.eventType,
      timestamp: ev.timestamp,
      summary: sanitizeSummary(ev.payload?.summary || ev.eventType),
      payload: ev.payload || {}
    }));

    return {
      sessionId: projection.sessionId,
      targetId: projection.targetId,
      targetKind: projection.targetKind,
      taskId: projection.taskId,
      attemptId: projection.attemptId,
      state: projection.state,
      phase: projection.phase,
      indicators: projection.indicators,
      pointer: {
        x: latestPointer.x,
        y: latestPointer.y,
        visible: isPointerVisible
      },
      lastSequence: projection.lastSequence,
      lastTimestamp: projection.lastTimestamp,
      expiresAt: projection.expiresAt,
      stoppedAt: projection.stoppedAt,
      revokedAt: projection.revokedAt,
      events: boundedEvents,
      limitations: NATIVE_LIMITATION_NOTICE
    };
  }
}
