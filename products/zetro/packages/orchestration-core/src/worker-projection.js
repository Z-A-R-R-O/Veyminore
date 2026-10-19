import { States, Intents } from './types.js';
import { SqliteTaskStore } from './task-store.js';

export const WorkerStates = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  COMPLETED: 'completed',
  SUBMITTED: 'submitted',
  FAILED: 'failed',
  INTERRUPTED: 'interrupted',
  STALE: 'stale',
  UNKNOWN: 'unknown'
});

export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30000;

const SENSITIVE_PATTERNS = [
  // API keys / tokens (Groq, OpenAI, Anthropic, generic Bearer, secret keys)
  /gsk_[a-zA-Z0-9_\-]{16,}/gi,
  /sk-[a-zA-Z0-9_\-]{16,}/gi,
  /Bearer\s+[a-zA-Z0-9_\-\.]{10,}/gi,
  /(?:api[_-]?key|secret|token|password|auth|credential)["']?\s*[:=]\s*["']?[a-zA-Z0-9_\-\.]{8,}["']?/gi,
  // File paths (Windows drive letters or Unix absolute paths)
  /(?:[a-zA-Z]:\\|\/)[^\s:;"'<>)]+/g,
  // File URLs
  /file:\/\/\/[^\s:;"'<>)]+/gi
];

const MAX_SUMMARY_CHARS = 256;

/**
 * Sanitize error or uncertainty strings into a bounded, safe summary.
 * Redacts secrets, auth tokens, file system paths, and stack traces.
 *
 * @param {*} value Raw message
 * @param {string|null} [fallback=null] Fallback value
 * @returns {string|null} Bounded sanitized summary
 */
export function sanitizeSummary(value, fallback = null) {
  if (value == null) return fallback;
  let text = typeof value === 'string'
    ? value
    : (typeof value === 'object' ? (value.message || value.error || JSON.stringify(value)) : String(value));

  text = text.trim();
  if (!text) return fallback;

  // 1. Strip multi-line stack traces (take only the primary message line)
  const firstLine = text.split(/\r?\n/)[0].trim();
  text = firstLine;

  // 2. Redact sensitive patterns (tokens, keys, absolute paths, file URIs)
  for (const pattern of SENSITIVE_PATTERNS) {
    text = text.replace(pattern, '[REDACTED]');
  }

  // 3. Normalize whitespace and collapse multiple [REDACTED]
  text = text.replace(/\s+/g, ' ').replace(/(\[REDACTED\]\s*)+/g, '[REDACTED] ').trim();

  // 4. Bound to maximum safe length
  if (text.length > MAX_SUMMARY_CHARS) {
    text = text.slice(0, MAX_SUMMARY_CHARS - 3) + '...';
  }

  return text || fallback;
}

/**
 * Durable read-only RCT worker status projection.
 *
 * Exposes a passive, side-effect-free query interface over authoritative
 * TaskStore state, attempts, events, and verification artifacts.
 * Designed for real-time frontend dashboard connections and persistent monitoring.
 *
 * Invariants Enforced:
 * 1. Running requires an actual active attempt (never assignment or acknowledgment alone).
 * 2. Missing heartbeat or foreign attempt heartbeat marks active workers as stale.
 * 3. Only trusted, finite store timestamps are used (caller payload freshness rejected).
 * 4. Failed and Interrupted states are strictly distinct.
 * 5. Accepted completion requires authoritative stored independent verification
 *    matching the exact task and attempt, with meaningful check identity.
 * 6. Compact, safe fields with bounded sanitization and zero secret leakage.
 */
export class WorkerStatusProjection {
  /**
   * @param {import('./task-store.js').TaskStore} store Authoritative TaskStore
   * @param {Object} [options]
   * @param {number} [options.heartbeatTimeoutMs] Inactivity threshold before marking running workers stale (default 30000ms)
   */
  constructor(store, options = {}) {
    if (!store) {
      throw new Error('TaskStore is required for WorkerStatusProjection');
    }
    this.store = store;
    this.heartbeatTimeoutMs = typeof options.heartbeatTimeoutMs === 'number' && options.heartbeatTimeoutMs > 0
      ? options.heartbeatTimeoutMs
      : DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }

  /**
   * Open a read-only SQLite database and return a WorkerStatusProjection bound to it.
   * Enables frontends and external monitors to observe actual RCT worker statuses without
   * any lifecycle side effects, DB creation, or lock contention.
   *
   * @param {string} dbPath Path to existing SQLite database file
   * @param {Object} [options]
   * @param {number} [options.heartbeatTimeoutMs]
   * @returns {Promise<WorkerStatusProjection>}
   */
  static async openReadOnly(dbPath, options = {}) {
    const store = await SqliteTaskStore.openReadOnly(dbPath, options);
    return new WorkerStatusProjection(store, options);
  }

  /**
   * Close the underlying store if opened via openReadOnly.
   */
  close() {
    if (this.store && typeof this.store.close === 'function') {
      this.store.close();
    }
  }

  /**
   * Project status for a specific worker.
   *
   * @param {string} workerId Target worker identifier
   * @param {Object} [options]
   * @param {number|Function} [options.now] Optional clock override for deterministic time testing
   * @returns {Object} Compact safe worker status projection
   */
  getWorkerStatus(workerId, options = {}) {
    if (!workerId || typeof workerId !== 'string') {
      throw new Error('workerId is required and must be a non-empty string');
    }

    const cleanWorkerId = workerId.trim();
    if (!cleanWorkerId) {
      throw new Error('workerId must not be empty');
    }

    const rawNow = typeof options.now === 'function'
      ? options.now()
      : (typeof options.now === 'number' ? options.now : Date.now());

    const now = (typeof rawNow === 'number' && Number.isFinite(rawNow)) ? rawNow : Date.now();

    // 1. Discover all tasks belonging to this worker
    const allTasks = this.store.listTasks() || [];
    const workerTasks = allTasks.filter(t => t.agent === cleanWorkerId);

    if (workerTasks.length === 0) {
      return {
        workerId: cleanWorkerId,
        taskId: null,
        attemptId: null,
        state: WorkerStates.IDLE,
        phase: 'unassigned',
        verified: false,
        lastEventSequence: null,
        lastTimestamp: null,
        heartbeat: {
          lastHeartbeatAt: null,
          stale: false,
          timeoutMs: this.heartbeatTimeoutMs
        },
        error: null,
        uncertainty: null
      };
    }

    // 2. Select target task: prioritize active (RUNNING) task, else newest by createdAt
    let targetTask = null;
    let activeAttempt = null;

    // Sort newest first
    const sortedTasks = [...workerTasks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    for (const t of sortedTasks) {
      const attempts = typeof this.store.getAttempts === 'function'
        ? this.store.getAttempts(t.id)
        : [this.store.getLatestAttempt(t.id)].filter(Boolean);
      const runningAtt = attempts.find(a => a && a.state === States.RUNNING && a.finishedAt == null);
      if (runningAtt) {
        targetTask = t;
        activeAttempt = runningAtt;
        break;
      }
    }

    if (!targetTask) {
      targetTask = sortedTasks[0];
    }

    // 3. Inspect attempts for the target task
    const latestAttempt = activeAttempt || this.store.getLatestAttempt(targetTask.id);
    const targetAttemptId = latestAttempt ? latestAttempt.attemptId : null;

    // 4. Retrieve and audit events strictly matching this task
    const rawEvents = this.store.getEvents(targetTask.id) || [];

    // Filter events to guarantee exact task ownership and reject corrupted/foreign worker payloads
    const validTaskEvents = rawEvents.filter(e => {
      if (!e || typeof e !== 'object') return false;
      if (e.taskId !== targetTask.id) return false;
      if (e.payload?.workerId && e.payload.workerId !== cleanWorkerId) return false;
      return true;
    });

    // Sequence tracking: highest valid event ID on this task
    const lastEventSequence = validTaskEvents.length > 0
      ? Math.max(...validTaskEvents.map(e => (typeof e.id === 'number' ? e.id : 0)))
      : null;

    // Helper for trusted store event timestamp:
    // MUST use e.timestamp from database (NOT caller payload freshness)
    // MUST reject future timestamps (e.timestamp > now) and non-finite timestamps
    const getTrustedEventTime = e => {
      const ts = e.timestamp;
      if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0 && ts <= now) {
        return ts;
      }
      return null;
    };

    // Events strictly belonging to the target attempt (exact attempt identity filter)
    const validAttemptEvents = targetAttemptId
      ? validTaskEvents.filter(e => e.attemptId === targetAttemptId)
      : [];

    const attemptTrustedTimes = validAttemptEvents
      .map(getTrustedEventTime)
      .filter(t => t !== null);

    const latestAttemptEventTime = attemptTrustedTimes.length > 0
      ? Math.max(...attemptTrustedTimes)
      : null;

    // Heartbeat events strictly on this target attempt
    const attemptHeartbeatEvents = validAttemptEvents.filter(e =>
      e.eventType === 'WORKER_HEARTBEAT' || e.eventType === 'HEARTBEAT'
    );
    const attemptHeartbeatTimes = attemptHeartbeatEvents
      .map(getTrustedEventTime)
      .filter(t => t !== null);

    const latestHeartbeatTime = attemptHeartbeatTimes.length > 0
      ? Math.max(...attemptHeartbeatTimes)
      : null;

    // Valid attempt startedAt (trusted store timestamp <= now)
    const validStartedAt = (latestAttempt && typeof latestAttempt.startedAt === 'number' && Number.isFinite(latestAttempt.startedAt) && latestAttempt.startedAt <= now)
      ? latestAttempt.startedAt
      : null;

    // lastHeartbeatAt strictly bound to the target attempt
    const lastHeartbeatAt = latestHeartbeatTime || latestAttemptEventTime || validStartedAt || null;

    // Overall lastTimestamp for this worker
    const taskTrustedTimes = validTaskEvents
      .map(getTrustedEventTime)
      .filter(t => t !== null);

    const latestTaskEventTime = taskTrustedTimes.length > 0
      ? Math.max(...taskTrustedTimes)
      : null;

    const lastTimestamp = latestAttemptEventTime ||
      latestTaskEventTime ||
      (latestAttempt?.finishedAt && latestAttempt.finishedAt <= now ? latestAttempt.finishedAt : null) ||
      validStartedAt ||
      (targetTask.updatedAt && targetTask.updatedAt <= now ? targetTask.updatedAt : null) ||
      (targetTask.createdAt && targetTask.createdAt <= now ? targetTask.createdAt : null) ||
      null;

    // 5. Derive Current State according to strict invariants

    let state = WorkerStates.IDLE;
    let phase = 'idle';
    let verified = false;
    let rawError = null;
    let rawUncertainty = null;

    // INVARIANT 1: Running requires actual active attempt, NEVER assignment or acknowledgment alone.
    const hasActiveAttempt = Boolean(
      latestAttempt &&
      latestAttempt.state === States.RUNNING &&
      latestAttempt.finishedAt == null
    );

    const isHeartbeatStale = Boolean(
      hasActiveAttempt &&
      (lastHeartbeatAt == null || (now - lastHeartbeatAt) > this.heartbeatTimeoutMs)
    );

    if (hasActiveAttempt) {
      if (isHeartbeatStale) {
        // INVARIANT 2: Missing heartbeat transitions to stale/unknown
        state = WorkerStates.STALE;
        phase = 'heartbeat_timeout';
        const elapsed = lastHeartbeatAt != null ? `${now - lastHeartbeatAt}ms` : 'unknown duration';
        rawUncertainty = `Missing heartbeat: worker inactive for ${elapsed} (timeout: ${this.heartbeatTimeoutMs}ms)`;
      } else {
        state = WorkerStates.RUNNING;
        phase = 'executing';
      }
    } else if (latestAttempt?.state === States.CANCELLED || targetTask.state === States.CANCELLED) {
      // INVARIANT 3: Failed vs Interrupted are strictly distinct
      state = WorkerStates.INTERRUPTED;
      phase = 'cancelled';
      rawUncertainty = latestAttempt?.uncertainty || targetTask.uncertainty || 'Cancelled by operator request';
    } else if (
      latestAttempt?.state === States.UNKNOWN ||
      targetTask.state === States.UNKNOWN ||
      latestAttempt?.intent === Intents.RECONCILED_UNKNOWN
    ) {
      state = WorkerStates.INTERRUPTED;
      phase = 'crash_reconciled';
      rawUncertainty = latestAttempt?.uncertainty || targetTask.uncertainty || 'Interrupted in-flight during crash or restart';
    } else if (latestAttempt?.state === States.FAILED || targetTask.state === States.FAILED) {
      state = WorkerStates.FAILED;
      phase = 'execution_failed';
      rawError = latestAttempt?.error || targetTask.error || 'Task execution failed';
      rawUncertainty = latestAttempt?.uncertainty || targetTask.uncertainty || null;
    } else if (targetTask.state === States.COMPLETED || latestAttempt?.state === States.COMPLETED) {
      // INVARIANT 4: Accepted completion requires BOTH actual completed task AND attempt,
      // plus exact stored task/attempt verifier evidence with meaningful checks.
      const taskIsCompleted = targetTask.state === States.COMPLETED;
      const attemptIsCompleted = latestAttempt && latestAttempt.state === States.COMPLETED;

      if (taskIsCompleted && attemptIsCompleted && targetAttemptId) {
        const artifacts = this.store.getArtifacts(targetTask.id) || [];

        // Exact attempt identity check: null/foreign/missing attempt evidence MUST NEVER certify
        const exactVerifierArtifacts = artifacts.filter(a => {
          if (!a || typeof a !== 'object') return false;
          if (a.artifactType !== 'verifier_evidence') return false;
          if (a.taskId !== targetTask.id) return false;

          // AttemptId must be non-null and match the exact targetAttemptId
          if (!a.attemptId || a.attemptId !== targetAttemptId) {
            return false;
          }
          if (a.metadata?.attemptId && a.metadata.attemptId !== targetAttemptId) {
            return false;
          }
          return true;
        });

        // Meaningful independently checked identity fields consistent with authoritative verifier artifact
        const hasAuthoritativeVerification = exactVerifierArtifacts.some(a => {
          const meta = a.metadata;
          if (!meta || typeof meta !== 'object') return false;
          if (meta.verified !== true) return false;

          // Verifier must be a non-empty string
          if (typeof meta.verifier !== 'string' || !meta.verifier.trim()) return false;

          // Checks must be a non-empty array
          if (!Array.isArray(meta.checks) || meta.checks.length === 0) return false;

          // Every check must have a non-empty path, strict boolean passed: true, and 64-char hex sha256
          return meta.checks.every(c => {
            if (!c || typeof c !== 'object') return false;
            if (c.passed !== true) return false;
            if (typeof c.path !== 'string' || !c.path.trim()) return false;
            if (typeof c.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(c.sha256)) return false;
            return true;
          });
        });

        if (hasAuthoritativeVerification) {
          state = WorkerStates.COMPLETED;
          phase = 'verified_completed';
          verified = true;
        } else {
          state = WorkerStates.SUBMITTED;
          phase = 'unverified_worker_claim';
          verified = false;
          rawUncertainty = 'Worker claimed completion without authoritative stored independent verification';
        }
      } else {
        state = WorkerStates.SUBMITTED;
        phase = 'unverified_worker_claim';
        verified = false;
        rawUncertainty = 'Incomplete task/attempt lifecycle: requires both completed task and attempt';
      }
    } else if (latestAttempt?.state === States.SUBMITTED || targetTask.state === States.SUBMITTED) {
      state = WorkerStates.SUBMITTED;
      phase = 'submitted_awaiting_verification';
      verified = false;
    } else if (targetTask.state === States.PENDING || targetTask.state === States.RUNNING) {
      // Task is assigned or acknowledged, but has no active running attempt
      state = WorkerStates.IDLE;
      phase = targetTask.state === States.PENDING ? 'awaiting_dispatch' : 'awaiting_attempt';
    } else {
      state = WorkerStates.IDLE;
      phase = 'idle';
    }

    // 6. Return compact safe fields with bounded sanitization (zero secret leakage)
    return {
      workerId: cleanWorkerId,
      taskId: targetTask.id,
      attemptId: targetAttemptId,
      state,
      phase,
      verified,
      lastEventSequence,
      lastTimestamp,
      heartbeat: {
        lastHeartbeatAt,
        stale: isHeartbeatStale,
        timeoutMs: this.heartbeatTimeoutMs
      },
      error: sanitizeSummary(rawError),
      uncertainty: sanitizeSummary(rawUncertainty)
    };
  }

  /**
   * Project status across all known or discovered workers.
   *
   * @param {Object} [options]
   * @param {string[]} [options.knownWorkerIds] Optional list of known worker slots (e.g. ['RCT-1', 'RCT-2', 'RCT-3', 'RCT-4', 'RCT-5'])
   * @param {number|Function} [options.now] Optional clock override
   * @returns {Object[]} Array of compact safe worker status projections
   */
  listWorkerStatuses(options = {}) {
    const tasks = this.store.listTasks() || [];
    const discoveredWorkers = new Set(tasks.map(t => t.agent).filter(Boolean));

    if (Array.isArray(options.knownWorkerIds)) {
      for (const id of options.knownWorkerIds) {
        if (id && typeof id === 'string') {
          discoveredWorkers.add(id.trim());
        }
      }
    }

    const workerIds = [...discoveredWorkers].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );

    return workerIds.map(wId => this.getWorkerStatus(wId, options));
  }

  /**
   * Helper to record an explicit worker heartbeat in the authoritative event store.
   * Enforces exact task and attempt identity validation.
   *
   * @param {string} workerId Target worker identifier
   * @param {string} taskId Associated task identifier
   * @param {string} attemptId Associated attempt identifier
   * @param {Object} [options]
   * @returns {number} Recorded event sequence ID
   */
  recordHeartbeat(workerId, taskId, attemptId, options = {}) {
    if (!workerId || typeof workerId !== 'string') throw new Error('workerId is required');
    if (!taskId || typeof taskId !== 'string') throw new Error('taskId is required');
    if (!attemptId || typeof attemptId !== 'string') throw new Error('attemptId is required');

    const cleanWorkerId = workerId.trim();
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.agent !== cleanWorkerId) {
      throw new Error(`Worker mismatch: task '${taskId}' belongs to worker '${task.agent}', not '${cleanWorkerId}'`);
    }

    const attempt = this.store.getAttempt(attemptId);
    if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);
    if (attempt.taskId !== taskId) {
      throw new Error(`Attempt ownership mismatch: attempt '${attemptId}' belongs to task '${attempt.taskId}', not '${taskId}'`);
    }

    this.store.recordEvent(taskId, attemptId, 'WORKER_HEARTBEAT', {
      workerId: cleanWorkerId
    });

    const events = this.store.getEvents(taskId);
    return events[events.length - 1]?.id || null;
  }
}
