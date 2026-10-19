import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { SqliteTaskStore } from './task-store.js';
import { TaskManager } from './task-manager.js';
import { RealRctAdapter, createIndependentRctVerifier } from './real-rct-adapter.js';
import { WorkerStatusProjection, WorkerStates, sanitizeSummary } from './worker-projection.js';
import { States } from './types.js';

export const DEFAULT_WORKER_ID = 'RCT-1';

/**
 * Resolves the SQLite database file path from dataDir or dbPath options.
 *
 * @param {Object} options
 * @param {string} [options.dataDir] Directory containing tasks.db
 * @param {string} [options.dbPath] Direct path to tasks.db
 * @returns {string} Absolute or relative database file path
 */
export function resolveDbPath(options = {}) {
  if (options.dbPath && typeof options.dbPath === 'string') {
    return options.dbPath;
  }
  if (options.dataDir && typeof options.dataDir === 'string') {
    return join(options.dataDir, 'tasks.db');
  }
  throw new Error('Explicit database location required: specify either --data-dir <dir> or --db <path>');
}

/**
 * Creates an offline synthetic fixture provider for deterministic local execution.
 * Live models are disabled and source apply is unavailable.
 *
 * @param {Object} [options]
 * @param {string} [options.name]
 * @param {Array<{ path: string, expectedSha256: string, content: string }>} [options.patches]
 * @param {string} [options.summary]
 * @returns {Object}
 */
export function createSyntheticFixtureProvider(options = {}) {
  let turn = 0;
  return {
    name: options.name || 'offline-synthetic-provider',
    async next(params) {
      turn++;
      if (turn === 1 && Array.isArray(options.patches) && options.patches.length > 0) {
        return {
          toolCalls: options.patches.map(p => ({
            name: 'propose_patch',
            args: {
              path: p.path,
              expectedSha256: p.expectedSha256,
              content: p.content
            }
          })),
          usage: { inputTokens: 100, outputTokens: 40 }
        };
      }
      return {
        toolCalls: [{
          name: 'submit_receipt',
          args: {
            summary: options.summary || 'Completed offline assignment in isolated snapshot'
          }
        }],
        usage: { inputTokens: 80, outputTokens: 30 }
      };
    }
  };
}

/**
 * Single-Worker Persistent Offline RCT Host.
 *
 * Orchestrates a single dedicated worker slot (default 'RCT-1') against an explicit
 * persistent data directory with durable SQLite storage, independent verification,
 * and authoritative workspace admission.
 *
 * Invariants:
 * 1. Dedicated single worker slot: only one active task at a time for RCT-1.
 * 2. Database retention: SQLite database is retained on disk upon completion so
 *    desktop frontends can inspect state.
 * 3. Graceful restart & UNKNOWN reconciliation: in-flight attempts from interrupted/crashed
 *    hosts are reconciled to UNKNOWN on init with zero duplicate dispatch.
 * 4. Strictly read-only status: all status/event/projection queries open the database
 *    in read-only mode and never trigger writes, schema mutations, or checkpoints.
 */
export class RctHost {
  /**
   * @param {Object} options
   * @param {string} [options.dataDir] Directory storing tasks.db
   * @param {string} [options.dbPath] Direct path to SQLite DB
   * @param {string} [options.workerId='RCT-1'] Dedicated worker identifier
   * @param {string} [options.sourceRoot] Canonical workspace source root
   * @param {Object} [options.provider] Offline provider
   * @param {Object} [options.verifier] Independent verifier
   * @param {Object} [options.policyPort] Injected shared policy port
   * @param {Object} [options.authority] Injected policy authority
   */
  constructor(options = {}) {
    this.dbPath = resolveDbPath(options);
    this.dataDir = options.dataDir || null;
    this.workerId = (options.workerId && typeof options.workerId === 'string')
      ? options.workerId.trim()
      : DEFAULT_WORKER_ID;
    this.sourceRoot = options.sourceRoot || null;
    this.hostId = options.hostId || randomUUID();
    this.leaseTtlMs = typeof options.leaseTtlMs === 'number' && options.leaseTtlMs > 0
      ? options.leaseTtlMs
      : 30000;

    this.store = new SqliteTaskStore(this.dbPath);
    this.provider = options.provider || createSyntheticFixtureProvider(options.synthetic || {});
    this.verifier = options.verifier || createIndependentRctVerifier({ name: 'authoritative-rct-verifier' });
    this.policyPort = options.policyPort || null;
    this.authority = options.authority || null;

    this.adapter = new RealRctAdapter({
      provider: this.provider,
      sourceRoot: this.sourceRoot,
      policyPort: this.policyPort,
      authority: this.authority
    });

    this.manager = new TaskManager(this.store, this.adapter, {
      verifier: this.verifier,
      policyPort: this.policyPort,
      authority: this.authority
    });

    this._initialized = false;
    this._activeInvocation = null;
  }

  /**
   * Initialize persistent host in writer mode.
   * Runs schema migrations and reconciles prior in-flight crash windows,
   * while strictly protecting active live writer leases.
   *
   * @param {Object} [options]
   * @param {boolean} [options.force=false] Force recovery of all unfinished attempts
   * @returns {Promise<{ reconciledTaskIds: string[] }>}
   */
  async init(options = {}) {
    if (this._initialized) {
      return { reconciledTaskIds: [] };
    }
    await this.store.init();
    let reconciled = [];
    if (options.autoReconcile === true) {
      reconciled = this.store.reconcileInterruptedWork(options);
    }
    this._initialized = true;
    return { reconciledTaskIds: reconciled || [] };
  }

  /**
   * Explicitly reconcile interrupted in-flight attempts.
   *
   * @param {Object} [options]
   * @param {boolean} [options.force=false]
   * @returns {Promise<{ reconciledTaskIds: string[] }>}
   */
  async reconcile(options = {}) {
    if (!this._initialized) {
      await this.init(options);
    }
    const reconciled = this.store.reconcileInterruptedWork(options);
    return { reconciledTaskIds: reconciled || [] };
  }

  /**
   * Close the writer database connection and release active leases.
   */
  close() {
    try {
      if (this._activeInvocation) {
        this.store.releaseWorkerLease(this.workerId, this.hostId, this._activeInvocation.attemptId, {
          invocationToken: this._activeInvocation.invocationToken
        });
      } else {
        this.store.releaseWorkerLease(this.workerId, this.hostId);
      }
    } catch (_) {}
    this._activeInvocation = null;
    this.manager.close();
    this._initialized = false;
  }

  /**
   * Get current worker status projection.
   *
   * @param {Object} [options]
   * @returns {Object}
   */
  getWorkerStatus(options = {}) {
    return this.manager.getWorkerStatus(this.workerId, options);
  }

  /**
   * Dispatches a TaskEnvelope to the single dedicated worker slot.
   * Enforces transactional single-worker capacity and retains the database on completion.
   *
   * Invariants Enforced:
   * 1. Transactional lease acquisition: at most one active execution across all host processes.
   * 2. Stale telemetry never means slot free: unclosed active attempts block dispatch until reconciled.
   * 3. Live writer protection: active writer leases cannot be usurped or auto-reconciled.
   *
   * @param {Object|string} envelopeOrPath TaskEnvelope object or path to JSON envelope file
   * @param {Object} [options]
   * @param {Array} [options.patches] Optional synthetic patches for default offline provider
   * @returns {Promise<Object>} Final TaskStatus
   */
  async runTask(envelopeOrPath, options = {}) {
    if (!this._initialized) {
      await this.init();
    }

    // 0. Explicit local in-flight guard: single worker slot on this host
    // Prevents duplicate or concurrent execution before touching leases or timers
    if (this._activeInvocation) {
      throw new Error(
        `Host '${this.hostId}' is currently executing task '${this._activeInvocation.taskId}'; ` +
        `single-worker capacity guard rejects concurrent dispatch`
      );
    }

    // 1. Parse envelope if provided as path or string
    let envelope = envelopeOrPath;
    if (typeof envelopeOrPath === 'string') {
      const trimmed = envelopeOrPath.trim();
      if (existsSync(trimmed)) {
        const raw = readFileSync(trimmed, 'utf8');
        envelope = JSON.parse(raw);
      } else {
        envelope = JSON.parse(trimmed);
      }
    }

    if (!envelope || typeof envelope !== 'object') {
      throw new Error('TaskEnvelope must be a valid object');
    }

    // 2. Bind to dedicated worker identity
    if (!envelope.agent) {
      envelope.agent = this.workerId;
    } else if (envelope.agent !== this.workerId) {
      throw new Error(`Host is dedicated to single worker '${this.workerId}', envelope targeted '${envelope.agent}'`);
    }

    // 3. Bind sourceRoot if not explicitly specified in envelope
    if (this.sourceRoot && !envelope.workspaceRoot) {
      envelope.workspaceRoot = this.sourceRoot;
    }

    // 4. Transactional single-worker capacity and lease guard:
    // Fails closed if another host holds the lease or any unclosed attempt exists on disk.
    // Stale telemetry never means slot free.
    const attemptId = `${envelope.id}-att-1`;
    const invocationToken = randomUUID();
    this.store.acquireWorkerLease(this.workerId, this.hostId, envelope.id, attemptId, {
      leaseTtlMs: this.leaseTtlMs,
      invocationToken
    });

    const invocation = {
      taskId: envelope.id,
      attemptId,
      invocationToken
    };
    this._activeInvocation = invocation;

    const runAbortController = new AbortController();

    // Start background lease renewal and heartbeat recording
    let heartbeatTimer = setInterval(() => {
      try {
        const renewed = this.store.renewWorkerLease(this.workerId, this.hostId, attemptId, {
          invocationToken
        });
        if (!renewed) {
          // Lease renewal failed (lease lost or usurped) - abort active execution immediately!
          runAbortController.abort(new Error('Worker lease renewal failed: lease lost or usurped'));
          try {
            this.manager.cancel(envelope.id, { reason: 'Worker lease renewal failed: lease lost' });
          } catch (_) {}
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
          return;
        }

        this.store.recordEvent(envelope.id, attemptId, 'WORKER_HEARTBEAT', {
          workerId: this.workerId,
          activeAttemptId: attemptId,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        // Lease renewal error - abort active execution immediately!
        runAbortController.abort(err);
        try {
          this.manager.cancel(envelope.id, { reason: `Worker lease renewal error: ${err.message}` });
        } catch (_) {}
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }, 1000);

    // Initial heartbeat
    try {
      this.store.recordEvent(envelope.id, attemptId, 'WORKER_HEARTBEAT', {
        workerId: this.workerId,
        activeAttemptId: attemptId,
        timestamp: new Date().toISOString()
      });
    } catch (_) {}

    try {
      // 5. If synthetic patches passed, update default provider
      if (Array.isArray(options.patches) && this.provider && typeof this.provider === 'object') {
        this.adapter.provider = createSyntheticFixtureProvider({ patches: options.patches });
      }

      // 6. Execute task through authoritative TaskManager
      const combinedSignal = options.signal
        ? (typeof AbortSignal.any === 'function'
            ? AbortSignal.any([options.signal, runAbortController.signal])
            : options.signal)
        : runAbortController.signal;

      return await this.manager.run(envelope, {
        ...options,
        signal: combinedSignal
      });
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      try {
        this.store.releaseWorkerLease(this.workerId, this.hostId, attemptId, {
          invocationToken
        });
      } catch (_) {}
      if (this._activeInvocation === invocation) {
        this._activeInvocation = null;
      }
    }
  }

  /**
   * Cancel an active task.
   *
   * @param {string} taskId
   * @param {Object} [options]
   * @returns {Promise<{ cancelled: boolean, taskId: string, reason?: string }>}
   */
  async cancelTask(taskId, options = {}) {
    if (!this._initialized) {
      await this.init();
    }
    return this.manager.cancel(taskId, options);
  }

  // =========================================================================
  // Strictly Read-Only APIs (never reconcile, never mutate, never create files)
  // =========================================================================

  /**
   * Retrieve task status in strictly read-only mode.
   *
   * @param {string} dbPath
   * @param {string} taskId
   * @returns {Promise<Object|null>}
   */
  static async getStatus(dbPath, taskId) {
    const store = await SqliteTaskStore.openReadOnly(dbPath);
    try {
      const task = store.getTask(taskId);
      if (!task) return null;
      const latestAttempt = store.getLatestAttempt(taskId);
      return {
        id: task.id,
        state: task.state,
        agent: task.agent,
        objective: task.objective,
        uncertainty: task.uncertainty,
        error: task.error,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        latestAttempt: latestAttempt ? {
          attemptId: latestAttempt.attemptId,
          attemptNumber: latestAttempt.attemptNumber,
          state: latestAttempt.state,
          uncertainty: latestAttempt.uncertainty,
          error: latestAttempt.error,
          startedAt: latestAttempt.startedAt,
          finishedAt: latestAttempt.finishedAt
        } : null
      };
    } finally {
      store.close();
    }
  }

  /**
   * Retrieve worker status projection in strictly read-only mode.
   *
   * @param {string} dbPath
   * @param {string} [workerId='RCT-1']
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  static async getWorkerStatus(dbPath, workerId = DEFAULT_WORKER_ID, options = {}) {
    const projection = await WorkerStatusProjection.openReadOnly(dbPath, options);
    try {
      return projection.getWorkerStatus(workerId, options);
    } finally {
      projection.close();
    }
  }

  /**
   * List worker status projections in strictly read-only mode.
   *
   * @param {string} dbPath
   * @param {Object} [options]
   * @param {string[]} [options.knownWorkerIds]
   * @returns {Promise<Object[]>}
   */
  static async listWorkerStatuses(dbPath, options = {}) {
    const projection = await WorkerStatusProjection.openReadOnly(dbPath, options);
    try {
      return projection.listWorkerStatuses(options);
    } finally {
      projection.close();
    }
  }

  /**
   * Retrieve task audit events in strictly read-only mode.
   *
   * @param {string} dbPath
   * @param {string} taskId
   * @returns {Promise<Object[]>}
   */
  static async getEvents(dbPath, taskId) {
    const store = await SqliteTaskStore.openReadOnly(dbPath);
    try {
      return store.getEvents(taskId);
    } finally {
      store.close();
    }
  }

  /**
   * Retrieve task evidence and artifacts in strictly read-only mode.
   *
   * @param {string} dbPath
   * @param {string} taskId
   * @returns {Promise<Object|null>}
   */
  static async getEvidence(dbPath, taskId) {
    const store = await SqliteTaskStore.openReadOnly(dbPath);
    try {
      const task = store.getTask(taskId);
      if (!task) return null;
      const artifacts = store.getArtifacts(taskId);
      const events = store.getEvents(taskId);
      const attempt = store.getLatestAttempt(taskId);
      return {
        taskId: task.id,
        state: task.state,
        agent: task.agent,
        objective: task.objective,
        uncertainty: task.uncertainty,
        error: task.error,
        attemptId: attempt?.attemptId || null,
        artifacts,
        events
      };
    } finally {
      store.close();
    }
  }

  /**
   * Cancel task via independent writer connection.
   *
   * @param {string} dbPath
   * @param {string} taskId
   * @param {Object} [extra]
   * @returns {Promise<{ cancelled: boolean, state: string }>}
   */
  static async cancelTask(dbPath, taskId, extra = {}) {
    const store = new SqliteTaskStore(dbPath);
    await store.init();
    try {
      const task = store.getTask(taskId);
      if (!task) return { cancelled: false, state: null, reason: 'Task not found' };
      const attempt = store.getLatestAttempt(taskId);
      return store.cancelTaskAttempt(taskId, attempt?.attemptId, extra);
    } finally {
      store.close();
    }
  }

  /**
   * Retrieve frontend persistence bridge snapshot in strictly read-only mode.
   * Never creates database, never reconciles, never mutates files, never runs models.
   * Returns known worker projections (RCT-1 through RCT-5), bounded safe events, and safe artifact summaries.
   *
   * @param {string} dbPath
   * @param {Object} [options]
   * @param {string[]} [options.knownWorkerIds]
   * @param {number} [options.eventLimit=50]
   * @param {number} [options.artifactLimit=50]
   * @returns {Promise<Object>} Safe status snapshot
   */
  static async getStatusSnapshot(dbPath, options = {}) {
    const observedAt = new Date().toISOString();
    const knownWorkerIds = options.knownWorkerIds || ['RCT-1', 'RCT-2', 'RCT-3', 'RCT-4', 'RCT-5'];
    const maxEvents = Math.min(Math.max(1, Number(options.eventLimit) || 50), 100);
    const maxArtifacts = Math.min(Math.max(1, Number(options.artifactLimit) || 50), 100);

    if (!dbPath || typeof dbPath !== 'string') {
      return {
        schemaVersion: 1,
        observedAt,
        databasePath: null,
        connected: false,
        status: 'disconnected',
        error: 'Database path must be a non-empty string',
        workers: knownWorkerIds.map(wId => ({
          workerId: wId,
          taskId: null,
          attemptId: null,
          state: WorkerStates.UNKNOWN,
          phase: 'disconnected',
          verified: false,
          lastEventSequence: null,
          lastTimestamp: null,
          heartbeat: { lastHeartbeatAt: null, stale: true, timeoutMs: 30000 },
          error: null,
          uncertainty: null
        })),
        recentEvents: [],
        artifacts: []
      };
    }

    if (!existsSync(dbPath)) {
      return {
        schemaVersion: 1,
        observedAt,
        databasePath: dbPath,
        connected: false,
        status: 'disconnected',
        error: `Database file does not exist: '${dbPath}'`,
        workers: knownWorkerIds.map(wId => ({
          workerId: wId,
          taskId: null,
          attemptId: null,
          state: WorkerStates.UNKNOWN,
          phase: 'disconnected',
          verified: false,
          lastEventSequence: null,
          lastTimestamp: null,
          heartbeat: { lastHeartbeatAt: null, stale: true, timeoutMs: 30000 },
          error: null,
          uncertainty: null
        })),
        recentEvents: [],
        artifacts: []
      };
    }

    const store = await SqliteTaskStore.openReadOnly(dbPath);
    try {
      const projection = new WorkerStatusProjection(store, options);
      const workers = knownWorkerIds.map(wId => projection.getWorkerStatus(wId, options));

      // Fetch bounded events with safe sanitization (zero secrets, zero raw paths, zero code dumps)
      const rawEvents = store.db.prepare(`
        SELECT id, task_id, attempt_id, event_type, payload_json, timestamp
        FROM events
        ORDER BY id DESC
        LIMIT ?
      `).all(maxEvents);

      const recentEvents = rawEvents.map(r => {
        let safePayload = {};
        try {
          const parsed = JSON.parse(r.payload_json || '{}');
          if (parsed && typeof parsed === 'object') {
            safePayload = {
              ...(parsed.workerId ? { workerId: String(parsed.workerId).slice(0, 32) } : {}),
              ...(parsed.from ? { from: String(parsed.from).slice(0, 32) } : {}),
              ...(parsed.to ? { to: String(parsed.to).slice(0, 32) } : {}),
              ...(parsed.summary ? { summary: sanitizeSummary(parsed.summary) } : {}),
              ...(parsed.uncertainty ? { uncertainty: sanitizeSummary(parsed.uncertainty) } : {}),
              ...(parsed.error ? { error: sanitizeSummary(parsed.error) } : {}),
              ...(parsed.admissionDigest ? { admissionDigest: String(parsed.admissionDigest).slice(0, 64) } : {})
            };
          }
        } catch (_) {}

        return {
          id: r.id,
          taskId: r.task_id,
          attemptId: r.attempt_id,
          eventType: r.event_type,
          timestamp: r.timestamp,
          payload: safePayload
        };
      });

      // Fetch bounded safe artifact summaries (zero raw patch code, zero file contents)
      const rawArtifacts = store.db.prepare(`
        SELECT id, task_id, attempt_id, artifact_type, uri, hash, metadata_json, created_at
        FROM artifacts
        ORDER BY id DESC
        LIMIT ?
      `).all(maxArtifacts);

      const artifacts = rawArtifacts.map(r => {
        let safeSummary = null;
        let verified = false;
        try {
          const meta = JSON.parse(r.metadata_json || '{}');
          safeSummary = sanitizeSummary(meta.summary || meta.description || null);
          verified = Boolean(meta.verified);
        } catch (_) {}

        return {
          id: r.id,
          taskId: r.task_id,
          attemptId: r.attempt_id,
          artifactType: r.artifact_type,
          uri: r.uri,
          hash: r.hash,
          summary: safeSummary,
          verified,
          createdAt: r.created_at
        };
      });

      return {
        schemaVersion: 1,
        observedAt,
        databasePath: dbPath,
        connected: true,
        status: 'connected',
        error: null,
        workers,
        recentEvents,
        artifacts
      };
    } finally {
      store.close();
    }
  }
}

