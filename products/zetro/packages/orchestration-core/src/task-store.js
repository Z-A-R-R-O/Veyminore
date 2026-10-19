import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { States, TERMINAL_STATES, Intents, ReviewStates, TERMINAL_REVIEW_STATES } from './types.js';

let DatabaseSyncClass = null;
try {
  const mod = await import('node:sqlite');
  DatabaseSyncClass = mod.DatabaseSync;
} catch {
  DatabaseSyncClass = null;
}

export function isSqliteSupported() {
  return typeof DatabaseSyncClass === 'function';
}

/**
 * Abstract TaskStore interface for durable task lifecycle persistence.
 */
export class TaskStore {
  constructor() {
    this.readOnly = false;
  }
  async init() { throw new Error('Not implemented'); }
  close() { throw new Error('Not implemented'); }
  createTask(task) { throw new Error('Not implemented'); }
  getTask(id) { throw new Error('Not implemented'); }
  listTasks() { throw new Error('Not implemented'); }
  updateTaskState(id, state, extra) { throw new Error('Not implemented'); }
  createAttempt(attempt) { throw new Error('Not implemented'); }
  getAttempt(id) { throw new Error('Not implemented'); }
  getLatestAttempt(taskId) { throw new Error('Not implemented'); }
  getAttempts(taskId) { throw new Error('Not implemented'); }
  updateAttemptState(attemptId, state, extra) { throw new Error('Not implemented'); }
  recordIntent(taskId, attemptId, intent, data) { throw new Error('Not implemented'); }
  recordEvent(taskId, attemptId, eventType, payload) { throw new Error('Not implemented'); }
  getEvents(taskId) { throw new Error('Not implemented'); }
  recordArtifact(taskId, attemptId, artifact) { throw new Error('Not implemented'); }
  getArtifacts(taskId) { throw new Error('Not implemented'); }
  finalizeTaskAttempt(taskId, attemptId, options) { throw new Error('Not implemented'); }
  cancelTaskAttempt(taskId, attemptId, extra) { throw new Error('Not implemented'); }
  createReview(review) { throw new Error('Not implemented'); }
  getReview(id) { throw new Error('Not implemented'); }
  getReviewByTaskId(taskId) { throw new Error('Not implemented'); }
  updateReviewState(id, state, options) { throw new Error('Not implemented'); }
  listReviews(taskId) { throw new Error('Not implemented'); }
  finalizeReviewApproval(reviewId, options) { throw new Error('Not implemented'); }
  finalizeReviewRejection(reviewId, options) { throw new Error('Not implemented'); }
  finalizeReviewDiscard(reviewId, options) { throw new Error('Not implemented'); }
  reconcileInterruptedWork() { throw new Error('Not implemented'); }
  transaction(fn) { throw new Error('Not implemented'); }
  createComputerSession(session) { throw new Error('Not implemented'); }
  getComputerSession(sessionId) { throw new Error('Not implemented'); }
  listComputerSessions(options) { throw new Error('Not implemented'); }
  updateComputerSession(sessionId, updates) { throw new Error('Not implemented'); }
  recordComputerEvent(sessionId, event) { throw new Error('Not implemented'); }
  getComputerEvents(sessionId, options) { throw new Error('Not implemented'); }
}

function assertValidState(state, context = 'state') {
  if (!state || !Object.values(States).includes(state)) {
    throw new Error(`Invalid or unknown ${context}: '${state}'`);
  }
}

/**
 * SQLite-backed transactional TaskStore using Node's built-in node:sqlite DatabaseSync.
 *
 * Runtime Requirements:
 * - Requires Node.js >= 22.5.0 for built-in node:sqlite DatabaseSync.
 * - For Node < 22.5.0, a compatible dependency (e.g. better-sqlite3) must be coordinated via AGR-5.
 */
export class SqliteTaskStore extends TaskStore {
  /**
   * @param {string|Object} [dbPath=':memory:'] Path to SQLite database file, or options object
   * @param {Object} [options={}]
   * @param {boolean} [options.readOnly=false] Whether to open in strictly read-only mode
   */
  constructor(dbPath = ':memory:', options = {}) {
    super();
    let actualDbPath = dbPath;
    let actualOptions = options;
    if (typeof dbPath === 'object' && dbPath !== null) {
      actualOptions = dbPath;
      actualDbPath = actualOptions.dbPath || ':memory:';
    }
    this.readOnly = Boolean(actualOptions?.readOnly);
    this.dbPath = actualDbPath;
    if (this.readOnly) {
      if (!this.dbPath || typeof this.dbPath !== 'string' || this.dbPath === ':memory:') {
        throw new Error('Read-only SqliteTaskStore requires an existing database file path');
      }
    }
    this.db = null;
    this.version = 2;
  }

  /**
   * Open an existing SQLite database in strictly read-only mode.
   * Fails closed if the database file does not exist, or schema is missing/incompatible.
   *
   * @param {string} dbPath Path to existing SQLite database file
   * @param {Object} [options]
   * @returns {Promise<SqliteTaskStore>}
   */
  static async openReadOnly(dbPath, options = {}) {
    const store = new SqliteTaskStore(dbPath, { ...options, readOnly: true });
    await store.init();
    return store;
  }

  async init() {
    if (!isSqliteSupported()) {
      throw new Error('SQLite storage is unsupported on this Node runtime: DatabaseSync missing (requires Node >= 22.5.0)');
    }

    // Idempotent initialization: preserve single connection lifecycle
    if (this.db) {
      return;
    }

    if (this.readOnly) {
      // Existing database path REQUIRED; never create DB or directories in read-only mode
      if (!existsSync(this.dbPath)) {
        throw new Error(`Read-only SQLite database file does not exist: '${this.dbPath}'`);
      }

      this.db = new DatabaseSyncClass(this.dbPath, { readOnly: true });

      // In read-only mode: never PRAGMA writes, never checkpoints, never migrations
      this.db.exec('PRAGMA foreign_keys = ON;');

      // Validate that database has a compatible and complete schema; fail closed if incompatible/missing
      this._validateReadOnlySchema();
      return;
    }

    if (this.dbPath !== ':memory:') {
      await mkdir(dirname(this.dbPath), { recursive: true });
    }

    this.db = new DatabaseSyncClass(this.dbPath);

    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA foreign_keys = ON;');

    this._runMigrations();
  }

  _validateReadOnlySchema() {
    try {
      // 1. Verify all required tables exist in sqlite_master
      const tableRows = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table';").all();
      const tableNames = new Set(tableRows.map(r => r.name));
      const requiredTables = ['schema_migrations', 'tasks', 'attempts', 'events', 'artifacts', 'reviews'];
      for (const req of requiredTables) {
        if (!tableNames.has(req)) {
          throw new Error(`Incompatible or missing SQLite schema in read-only database: required table '${req}' not found`);
        }
      }

      // 2. Verify schema_migrations has reached current version
      const versionRow = this.db.prepare('SELECT MAX(version) AS current_version FROM schema_migrations;').get();
      const currentVersion = versionRow?.current_version || 0;
      if (currentVersion < this.version) {
        throw new Error(`Incompatible SQLite schema in read-only database: expected schema version ${this.version}, found ${currentVersion}`);
      }

      // 3. Verify required columns exist (e.g. source_root in reviews)
      const reviewCols = this.db.prepare("PRAGMA table_info('reviews');").all().map(r => r.name);
      if (!reviewCols.includes('source_root')) {
        throw new Error("Incompatible SQLite schema in read-only database: required column 'source_root' missing from 'reviews'");
      }
    } catch (err) {
      this.close();
      throw err;
    }
  }

  _assertWritable(action = 'mutate') {
    if (this.readOnly) {
      throw new Error(`Cannot ${action} in read-only SqliteTaskStore`);
    }
  }

  /**
   * Create a WorkerStatusProjection bound to this store.
   *
   * @param {Object} [options]
   * @returns {Promise<import('./worker-projection.js').WorkerStatusProjection>}
   */
  async createWorkerStatusProjection(options = {}) {
    const { WorkerStatusProjection } = await import('./worker-projection.js');
    return new WorkerStatusProjection(this, options);
  }

  /**
   * Create a ComputerSessionProjection bound to this store.
   *
   * @param {Object} [options]
   * @returns {Promise<import('./computer-projection.js').ComputerSessionProjection>}
   */
  async createComputerSessionProjection(options = {}) {
    const { ComputerSessionProjection } = await import('./computer-projection.js');
    return new ComputerSessionProjection(this, options);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  transaction(fn) {
    this._assertWritable('execute transaction');
    if (this._inTransaction) {
      return fn();
    }
    this._inTransaction = true;
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch (_) {}
      throw err;
    } finally {
      this._inTransaction = false;
    }
  }

  _runMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT NOT NULL
      );
    `);

    const row = this.db.prepare('SELECT MAX(version) AS current_version FROM schema_migrations').get();
    const currentVersion = row?.current_version || 0;

    if (currentVersion < 1) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            agent TEXT NOT NULL,
            objective TEXT NOT NULL,
            allowed_paths TEXT NOT NULL,
            context_refs TEXT NOT NULL,
            acceptance TEXT NOT NULL,
            verification TEXT NOT NULL,
            workspace_root TEXT,
            source_hash TEXT,
            assignment_digest TEXT,
            deadline_ms INTEGER NOT NULL,
            max_context_chars INTEGER NOT NULL,
            max_reply_chars INTEGER NOT NULL,
            context_chars_used INTEGER DEFAULT 0,
            reply_chars_used INTEGER DEFAULT 0,
            state TEXT NOT NULL,
            uncertainty TEXT,
            error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS attempts (
            attempt_id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id),
            attempt_number INTEGER NOT NULL,
            intent TEXT NOT NULL,
            intent_data TEXT,
            state TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            finished_at INTEGER,
            uncertainty TEXT,
            error TEXT
          );

          CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL REFERENCES tasks(id),
            attempt_id TEXT,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            timestamp INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS artifacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL REFERENCES tasks(id),
            attempt_id TEXT,
            artifact_type TEXT NOT NULL,
            uri TEXT NOT NULL,
            hash TEXT,
            metadata_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
          );

          INSERT INTO schema_migrations (version, applied_at, description)
          VALUES (1, ${Date.now()}, 'Initial TaskStore schema: tasks, attempts, events, artifacts');
        `);
      });
    }

    if (currentVersion < 2) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS reviews (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id),
            attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id),
            state TEXT NOT NULL,
            source_root TEXT,
            source_baseline TEXT NOT NULL,
            patch_digest TEXT NOT NULL,
            verification_ref TEXT NOT NULL,
            manifest_json TEXT NOT NULL,
            approval_intent TEXT,
            approval_data TEXT,
            approved_at INTEGER,
            rejected_at INTEGER,
            discarded_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_reviews_task_id ON reviews(task_id);
          CREATE INDEX IF NOT EXISTS idx_reviews_attempt_id ON reviews(attempt_id);

          INSERT INTO schema_migrations (version, applied_at, description)
          VALUES (2, ${Date.now()}, 'Review artifacts and immutable approval states');
        `);
      });
    }

    try {
      this.db.exec('ALTER TABLE reviews ADD COLUMN source_root TEXT;');
    } catch (_) {
      // Ignore if column already exists
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS worker_leases (
        worker_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        invocation_token TEXT NOT NULL DEFAULT '',
        task_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        lease_ttl_ms INTEGER NOT NULL,
        released_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_worker_leases_active ON worker_leases(worker_id, released_at);
    `);

    try {
      this.db.exec("ALTER TABLE worker_leases ADD COLUMN invocation_token TEXT NOT NULL DEFAULT '';");
    } catch (_) {
      // Ignore if column already exists
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS computer_sessions (
        session_id TEXT PRIMARY KEY,
        target_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        task_id TEXT,
        attempt_id TEXT,
        state TEXT NOT NULL,
        phase TEXT NOT NULL,
        acting INTEGER NOT NULL DEFAULT 0,
        granted INTEGER NOT NULL DEFAULT 0,
        paused INTEGER NOT NULL DEFAULT 0,
        verified INTEGER NOT NULL DEFAULT 0,
        is_native INTEGER NOT NULL DEFAULT 0,
        last_sequence INTEGER NOT NULL DEFAULT 0,
        last_timestamp INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        stopped_at INTEGER,
        revoked_at INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_computer_sessions_task ON computer_sessions(task_id);

      CREATE TABLE IF NOT EXISTS computer_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        task_id TEXT,
        attempt_id TEXT,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_computer_events_session ON computer_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_computer_events_seq ON computer_events(session_id, sequence);
    `);
  }

  createTask(task) {
    this._assertWritable('create task');
    if (!task || typeof task !== 'object') {
      throw new Error('Task must be a valid object');
    }
    if (!task.id || typeof task.id !== 'string') {
      throw new Error('Task id is required and must be a non-empty string');
    }
    if (!task.agent || typeof task.agent !== 'string') {
      throw new Error('Task agent is required and must be a non-empty string');
    }
    if (!task.objective || typeof task.objective !== 'string') {
      throw new Error('Task objective is required and must be a non-empty string');
    }
    if (!task.budget || typeof task.budget !== 'object') {
      throw new Error('Task budget is required and must be an object');
    }

    const existing = this.getTask(task.id);
    if (existing) {
      throw new Error(`Duplicate Task ID: ${task.id}`);
    }

    const state = task.state || States.PENDING;
    assertValidState(state, 'task state');

    const now = Date.now();
    return this.transaction(() => {
      this.db.prepare(`
        INSERT INTO tasks (
          id, agent, objective, allowed_paths, context_refs,
          acceptance, verification, workspace_root, source_hash, assignment_digest,
          deadline_ms, max_context_chars, max_reply_chars,
          context_chars_used, reply_chars_used, state, uncertainty, error,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?
        )
      `).run(
        task.id,
        task.agent,
        task.objective,
        JSON.stringify(task.allowedPaths || []),
        JSON.stringify(task.contextRefs || []),
        task.acceptance || '',
        task.verification || '',
        task.workspaceRoot || null,
        task.sourceHash || null,
        task.assignmentDigest || null,
        task.deadlineMs,
        task.budget.maxContextChars,
        task.budget.maxReplyChars,
        0,
        0,
        state,
        null,
        null,
        now,
        now
      );

      this.recordEvent(task.id, null, 'TASK_CREATED', {
        id: task.id,
        agent: task.agent,
        state
      });

      return this.getTask(task.id);
    });
  }

  getTask(id) {
    if (!id || typeof id !== 'string') return null;
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) return null;
    return this._mapTaskRow(row);
  }

  listTasks() {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at ASC').all();
    return rows.map(r => this._mapTaskRow(r));
  }

  updateTaskState(id, newState, extra = {}) {
    this._assertWritable('update task state');
    if (!id || typeof id !== 'string') throw new Error('Task id is required and must be a string');
    assertValidState(newState, 'task state');

    const current = this.getTask(id);
    if (!current) throw new Error(`Task not found: ${id}`);
    if (TERMINAL_STATES.has(current.state)) {
      return current; // Terminal states are immutable
    }

    if (extra.attemptId) {
      if (typeof extra.attemptId !== 'string') throw new Error('Attempt id must be a string');
      const attempt = this.getAttempt(extra.attemptId);
      if (attempt && attempt.taskId !== id) {
        throw new Error(`Attempt ownership mismatch: attempt '${extra.attemptId}' belongs to task '${attempt.taskId}', not '${id}'`);
      }
    }

    const now = Date.now();
    return this.transaction(() => {
      this.db.prepare(`
        UPDATE tasks SET
          state = ?,
          uncertainty = ?,
          error = ?,
          context_chars_used = ?,
          reply_chars_used = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        newState,
        extra.uncertainty || null,
        extra.error || null,
        extra.contextCharsUsed ?? current.contextCharsUsed,
        extra.replyCharsUsed ?? current.replyCharsUsed,
        now,
        id
      );

      this.recordEvent(id, extra.attemptId || null, 'STATE_TRANSITION', {
        from: current.state,
        to: newState,
        ...extra
      });

      return this.getTask(id);
    });
  }

  createAttempt(attempt) {
    this._assertWritable('create attempt');
    if (!attempt || typeof attempt !== 'object') {
      throw new Error('Attempt must be a valid object');
    }
    if (!attempt.attemptId || typeof attempt.attemptId !== 'string') {
      throw new Error('Attempt attemptId is required and must be a string');
    }
    if (!attempt.taskId || typeof attempt.taskId !== 'string') {
      throw new Error('Attempt taskId is required and must be a string');
    }
    if (typeof attempt.attemptNumber !== 'number') {
      throw new Error('Attempt attemptNumber is required and must be a number');
    }

    const parentTask = this.getTask(attempt.taskId);
    if (!parentTask) {
      throw new Error(`Parent task not found: ${attempt.taskId}`);
    }

    const existing = this.getAttempt(attempt.attemptId);
    if (existing) {
      throw new Error(`Duplicate Attempt ID: ${attempt.attemptId}`);
    }

    const state = attempt.state || States.RUNNING;
    assertValidState(state, 'attempt state');

    const now = Date.now();
    return this.transaction(() => {
      this.db.prepare(`
        INSERT INTO attempts (
          attempt_id, task_id, attempt_number, intent, intent_data,
          state, started_at, finished_at, uncertainty, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        attempt.attemptId,
        attempt.taskId,
        attempt.attemptNumber,
        attempt.intent || Intents.NONE,
        attempt.intentData ? JSON.stringify(attempt.intentData) : null,
        state,
        now,
        null,
        null,
        null
      );

      this.recordEvent(attempt.taskId, attempt.attemptId, 'ATTEMPT_STARTED', {
        attemptId: attempt.attemptId,
        attemptNumber: attempt.attemptNumber,
        state
      });

      return this.getAttempt(attempt.attemptId);
    });
  }

  getAttempt(attemptId) {
    if (!attemptId || typeof attemptId !== 'string') return null;
    const row = this.db.prepare('SELECT * FROM attempts WHERE attempt_id = ?').get(attemptId);
    if (!row) return null;
    return this._mapAttemptRow(row);
  }

  getLatestAttempt(taskId) {
    if (!taskId || typeof taskId !== 'string') return null;
    const row = this.db.prepare('SELECT * FROM attempts WHERE task_id = ? ORDER BY attempt_number DESC LIMIT 1').get(taskId);
    if (!row) return null;
    return this._mapAttemptRow(row);
  }

  getAttempts(taskId) {
    if (!taskId || typeof taskId !== 'string') return [];
    const rows = this.db.prepare('SELECT * FROM attempts WHERE task_id = ? ORDER BY attempt_number ASC').all(taskId);
    return rows.map(r => this._mapAttemptRow(r));
  }

  recordIntent(taskId, attemptId, intent, data = null) {
    this._assertWritable('record intent');
    if (!taskId || typeof taskId !== 'string') throw new Error('Task id is required and must be a string');
    if (!attemptId || typeof attemptId !== 'string') throw new Error('Attempt id is required and must be a string');
    if (!intent || typeof intent !== 'string') throw new Error('Intent is required and must be a string');

    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const attempt = this.getAttempt(attemptId);
    if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);

    if (attempt.taskId !== taskId) {
      throw new Error(`Attempt ownership mismatch: attempt '${attemptId}' belongs to task '${attempt.taskId}', not '${taskId}'`);
    }

    const now = Date.now();
    return this.transaction(() => {
      this.db.prepare(`
        UPDATE attempts SET
          intent = ?,
          intent_data = ?
        WHERE attempt_id = ?
      `).run(
        intent,
        data ? JSON.stringify(data) : null,
        attemptId
      );

      this.recordEvent(taskId, attemptId, 'INTENT_RECORDED', {
        intent,
        data,
        timestamp: now
      });

      return this.getAttempt(attemptId);
    });
  }

  updateAttemptState(attemptId, newState, extra = {}) {
    this._assertWritable('update attempt state');
    if (!attemptId || typeof attemptId !== 'string') throw new Error('Attempt id is required and must be a string');
    assertValidState(newState, 'attempt state');

    const attempt = this.getAttempt(attemptId);
    if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);

    if (extra.taskId && attempt.taskId !== extra.taskId) {
      throw new Error(`Attempt ownership mismatch: attempt '${attemptId}' belongs to task '${attempt.taskId}', not '${extra.taskId}'`);
    }

    if (TERMINAL_STATES.has(attempt.state)) {
      return attempt; // Terminal states are immutable
    }

    const finished = TERMINAL_STATES.has(newState) ? Date.now() : attempt.finishedAt;
    return this.transaction(() => {
      this.db.prepare(`
        UPDATE attempts SET
          state = ?,
          finished_at = ?,
          uncertainty = ?,
          error = ?
        WHERE attempt_id = ?
      `).run(
        newState,
        finished,
        extra.uncertainty || null,
        extra.error || null,
        attemptId
      );

      this.recordEvent(attempt.taskId, attemptId, 'ATTEMPT_STATE_CHANGED', {
        from: attempt.state,
        to: newState,
        ...extra
      });

      return this.getAttempt(attemptId);
    });
  }

  finalizeTaskAttempt(taskId, attemptId, options = {}) {
    this._assertWritable('finalize task attempt');
    if (!taskId || typeof taskId !== 'string') throw new Error('Task id is required and must be a string');
    const {
      state,
      uncertainty = null,
      error = null,
      summary = null,
      artifacts = [],
      contextCharsUsed = null,
      replyCharsUsed = null
    } = options;

    assertValidState(state, 'state');

    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);

      let attempt = null;
      if (attemptId) {
        if (typeof attemptId !== 'string') throw new Error('Attempt id must be a string');
        attempt = this.getAttempt(attemptId);
        if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);
        if (attempt.taskId !== taskId) {
          throw new Error(`Attempt ownership mismatch: attempt '${attemptId}' belongs to task '${attempt.taskId}', not '${taskId}'`);
        }
      }

      if (Array.isArray(artifacts)) {
        for (const art of artifacts) {
          if (!art || typeof art !== 'object' || !art.artifactType || !art.uri) {
            throw new Error('Malformed artifact: artifactType and uri required');
          }
        }
      }

      const now = Date.now();

      // 1. Finalize attempt if attemptId provided
      if (attempt && !TERMINAL_STATES.has(attempt.state)) {
        this.db.prepare(`
          UPDATE attempts SET
            state = ?,
            finished_at = ?,
            uncertainty = ?,
            error = ?
          WHERE attempt_id = ?
        `).run(
          state,
          now,
          uncertainty,
          error,
          attemptId
        );

        this.recordEvent(taskId, attemptId, 'ATTEMPT_STATE_CHANGED', {
          from: attempt.state,
          to: state,
          summary,
          uncertainty,
          error
        });
      }

      // 2. Persist artifacts atomically
      if (Array.isArray(artifacts) && artifacts.length > 0) {
        const insertStmt = this.db.prepare(`
          INSERT INTO artifacts (task_id, attempt_id, artifact_type, uri, hash, metadata_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const art of artifacts) {
          insertStmt.run(
            taskId,
            attemptId || null,
            art.artifactType,
            art.uri,
            art.hash || null,
            JSON.stringify(art.metadata || {}),
            now
          );

          this.recordEvent(taskId, attemptId || null, 'ARTIFACT_RECORDED', {
            artifactType: art.artifactType,
            uri: art.uri,
            hash: art.hash
          });
        }
      }

      // 3. Finalize task state if not already terminal
      if (!TERMINAL_STATES.has(task.state)) {
        this.db.prepare(`
          UPDATE tasks SET
            state = ?,
            uncertainty = ?,
            error = ?,
            context_chars_used = ?,
            reply_chars_used = ?,
            updated_at = ?
          WHERE id = ?
        `).run(
          state,
          uncertainty,
          error,
          contextCharsUsed ?? task.contextCharsUsed,
          replyCharsUsed ?? task.replyCharsUsed,
          now,
          taskId
        );

        this.recordEvent(taskId, attemptId || null, 'STATE_TRANSITION', {
          from: task.state,
          to: state,
          uncertainty,
          error
        });
      }
 
      // 4. Atomically release any active worker lease for this attempt/task
      try {
        this.db.prepare(`
          UPDATE worker_leases
          SET released_at = ?
          WHERE (task_id = ? OR attempt_id = ?) AND released_at IS NULL
        `).run(now, taskId, attemptId || '');
      } catch (_) {}

      return {
        task: this.getTask(taskId),
        attempt: attemptId ? this.getAttempt(attemptId) : null
      };
    });
  }

  cancelTaskAttempt(taskId, attemptId, extra = {}) {
    this._assertWritable('cancel task attempt');
    if (!taskId || typeof taskId !== 'string') throw new Error('Task id is required and must be a string');

    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);

      let attempt = null;
      if (attemptId) {
        if (typeof attemptId !== 'string') throw new Error('Attempt id must be a string');
        attempt = this.getAttempt(attemptId);
        if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);
        if (attempt.taskId !== taskId) {
          throw new Error(`Attempt ownership mismatch: attempt '${attemptId}' belongs to task '${attempt.taskId}', not '${taskId}'`);
        }
      }

      if (TERMINAL_STATES.has(task.state)) {
        return { cancelled: false, state: task.state };
      }

      const now = Date.now();
      const uncertainty = extra.uncertainty || 'Cancelled by operator request';

      if (attempt && !TERMINAL_STATES.has(attempt.state)) {
        this.db.prepare(`
          UPDATE attempts SET
            intent = ?,
            intent_data = ?
          WHERE attempt_id = ?
        `).run(
          Intents.CANCEL_REQUESTED,
          JSON.stringify({ timestamp: now }),
          attemptId
        );

        this.db.prepare(`
          UPDATE attempts SET
            state = ?,
            finished_at = ?,
            uncertainty = ?
          WHERE attempt_id = ?
        `).run(
          States.CANCELLED,
          now,
          uncertainty,
          attemptId
        );

        this.recordEvent(taskId, attemptId, 'ATTEMPT_STATE_CHANGED', {
          from: attempt.state,
          to: States.CANCELLED,
          uncertainty
        });
      }

      this.db.prepare(`
        UPDATE tasks SET
          state = ?,
          uncertainty = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        States.CANCELLED,
        uncertainty,
        now,
        taskId
      );

      this.recordEvent(taskId, attemptId || null, 'STATE_TRANSITION', {
        from: task.state,
        to: States.CANCELLED,
        uncertainty
      });

      // Release any active worker lease for this attempt/task
      try {
        this.db.prepare(`
          UPDATE worker_leases
          SET released_at = ?
          WHERE (task_id = ? OR attempt_id = ?) AND released_at IS NULL
        `).run(now, taskId, attemptId || '');
      } catch (_) {}

      return { cancelled: true, state: States.CANCELLED };
    });
  }

  recordEvent(taskId, attemptId, eventType, payload, options = {}) {
    this._assertWritable('record event');
    if (!taskId || typeof taskId !== 'string') throw new Error('Task id is required and must be a string');
    if (!eventType || typeof eventType !== 'string') throw new Error('Event type is required and must be a string');

    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (attemptId) {
      if (typeof attemptId !== 'string') throw new Error('Attempt id must be a string');
      const attempt = this.getAttempt(attemptId);
      if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);
      if (attempt.taskId !== taskId) {
        throw new Error(`Attempt ownership mismatch: attempt '${attemptId}' belongs to task '${attempt.taskId}', not '${taskId}'`);
      }
    }

    let now = Date.now();
    if (typeof options?.timestamp === 'number' && Number.isFinite(options.timestamp)) {
      now = options.timestamp;
    } else if (typeof payload?.timestamp === 'number' && Number.isFinite(payload.timestamp)) {
      now = payload.timestamp;
    } else if (typeof payload?.timestamp === 'string') {
      const parsed = new Date(payload.timestamp).getTime();
      if (Number.isFinite(parsed)) {
        now = parsed;
      }
    }

    this.db.prepare(`
      INSERT INTO events (task_id, attempt_id, event_type, payload_json, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      taskId,
      attemptId || null,
      eventType,
      JSON.stringify(payload || {}),
      now
    );
  }

  getEvents(taskId) {
    if (!taskId || typeof taskId !== 'string') return [];
    const rows = this.db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY id ASC').all(taskId);
    return rows.map(r => ({
      id: r.id,
      taskId: r.task_id,
      attemptId: r.attempt_id,
      eventType: r.event_type,
      payload: JSON.parse(r.payload_json),
      timestamp: r.timestamp
    }));
  }

  recordArtifact(taskId, attemptId, artifact) {
    this._assertWritable('record artifact');
    if (!taskId || typeof taskId !== 'string') throw new Error('Task id is required and must be a string');
    if (!artifact || typeof artifact !== 'object') throw new Error('Artifact must be an object');
    if (!artifact.artifactType || typeof artifact.artifactType !== 'string') throw new Error('Artifact artifactType is required');
    if (!artifact.uri || typeof artifact.uri !== 'string') throw new Error('Artifact uri is required');

    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);

      if (attemptId) {
        if (typeof attemptId !== 'string') throw new Error('Attempt id must be a string');
        const attempt = this.getAttempt(attemptId);
        if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);
        if (attempt.taskId !== taskId) {
          throw new Error(`Attempt ownership mismatch: attempt '${attemptId}' belongs to task '${attempt.taskId}', not '${taskId}'`);
        }
      }

      const now = Date.now();
      const info = this.db.prepare(`
        INSERT INTO artifacts (task_id, attempt_id, artifact_type, uri, hash, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskId,
        attemptId || null,
        artifact.artifactType,
        artifact.uri,
        artifact.hash || null,
        JSON.stringify(artifact.metadata || {}),
        now
      );

      this.recordEvent(taskId, attemptId, 'ARTIFACT_RECORDED', {
        artifactType: artifact.artifactType,
        uri: artifact.uri,
        hash: artifact.hash
      });

      return Number(info.lastInsertRowid);
    });
  }

  getArtifacts(taskId) {
    if (!taskId || typeof taskId !== 'string') return [];
    const rows = this.db.prepare('SELECT * FROM artifacts WHERE task_id = ? ORDER BY id ASC').all(taskId);
    return rows.map(r => ({
      id: r.id,
      taskId: r.task_id,
      attemptId: r.attempt_id,
      artifactType: r.artifact_type,
      uri: r.uri,
      hash: r.hash,
      metadata: JSON.parse(r.metadata_json),
      createdAt: r.created_at
    }));
  }

  reconcileInterruptedWork(options = {}) {
    this._assertWritable('reconcile interrupted work');
    const now = options.now || Date.now();
    const force = Boolean(options.force);

    return this.transaction(() => {
      // 1. Inspect existing active leases to protect LIVE writers
      const liveAttemptIds = new Set();
      try {
        const activeLeases = this.db.prepare(`
          SELECT * FROM worker_leases WHERE released_at IS NULL
        `).all();

        for (const lease of activeLeases) {
          const isFresh = (now - lease.heartbeat_at) < lease.lease_ttl_ms;
          if (isFresh && !force) {
            // Actively held by a live writer with fresh heartbeat!
            // Live writer's attempt and task MUST NOT be reconciled.
            liveAttemptIds.add(lease.attempt_id);
          }
        }
      } catch (_) {
        // In case worker_leases table not yet created
      }

      // Find unfinished attempts
      const unfinishedAttempts = this.db.prepare(`
        SELECT * FROM attempts
        WHERE finished_at IS NULL AND state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN')
      `).all();

      const reconciledTaskIds = [];

      for (const att of unfinishedAttempts) {
        if (liveAttemptIds.has(att.attempt_id)) {
          // Skip attempt owned by live active writer!
          continue;
        }

        this.db.prepare(`
          UPDATE attempts SET
            state = ?,
            intent = ?,
            finished_at = ?,
            uncertainty = ?
          WHERE attempt_id = ?
        `).run(
          States.UNKNOWN,
          Intents.RECONCILED_UNKNOWN,
          now,
          'Interrupted during intent execution: crash recovery',
          att.attempt_id
        );

        this.db.prepare(`
          UPDATE tasks SET
            state = ?,
            uncertainty = ?,
            updated_at = ?
          WHERE id = ? AND state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN')
        `).run(
          States.UNKNOWN,
          'Interrupted in-flight during crash/restart',
          now,
          att.task_id
        );

        this.recordEvent(att.task_id, att.attempt_id, 'INTENT_RECONCILED_UNKNOWN', {
          reason: 'Interrupted during unclosed intent window',
          attemptId: att.attempt_id
        });

        // Release lease if associated with this attempt
        try {
          this.db.prepare(`
            UPDATE worker_leases SET released_at = ?
            WHERE attempt_id = ? AND released_at IS NULL
          `).run(now, att.attempt_id);
        } catch (_) {}

        reconciledTaskIds.push(att.task_id);
      }

      // Also reconcile any tasks left in RUNNING with no attempt or stalled attempt
      const stalledTasks = this.db.prepare(`
        SELECT id FROM tasks WHERE state = 'RUNNING'
      `).all();

      for (const t of stalledTasks) {
        // Check if task has any live attempt
        let hasLiveAttempt = false;
        try {
          hasLiveAttempt = this.db.prepare(`
            SELECT attempt_id FROM attempts WHERE task_id = ? AND state = 'RUNNING' AND finished_at IS NULL
          `).all(t.id).some(a => liveAttemptIds.has(a.attempt_id));
        } catch (_) {}

        if (hasLiveAttempt) {
          continue;
        }

        if (!reconciledTaskIds.includes(t.id)) {
          this.db.prepare(`
            UPDATE tasks SET state = ?, uncertainty = ?, updated_at = ? WHERE id = ?
          `).run(States.UNKNOWN, 'Crashed while RUNNING', now, t.id);

          this.recordEvent(t.id, null, 'TASK_RECONCILED_UNKNOWN', {
            reason: 'Task left in RUNNING at restart'
          });

          reconciledTaskIds.push(t.id);
        }
      }

      return reconciledTaskIds;
    });
  }

  getWorkerLease(workerId) {
    if (!workerId || typeof workerId !== 'string') return null;
    try {
      return this.db.prepare('SELECT * FROM worker_leases WHERE worker_id = ?').get(workerId) || null;
    } catch (_) {
      return null;
    }
  }

  getActiveAttemptForWorker(workerId) {
    if (!workerId || typeof workerId !== 'string') return null;
    try {
      const row = this.db.prepare(`
        SELECT a.attempt_id, a.task_id, a.state, a.started_at, a.finished_at, a.intent, t.agent
        FROM attempts a
        JOIN tasks t ON a.task_id = t.id
        WHERE t.agent = ?
          AND a.finished_at IS NULL
          AND a.state = 'RUNNING'
        ORDER BY a.started_at DESC
        LIMIT 1
      `).get(workerId);
      return row || null;
    } catch (_) {
      return null;
    }
  }

  acquireWorkerLease(workerId, ownerId, taskId, attemptId, options = {}) {
    this._assertWritable('acquire worker lease');
    if (!workerId || typeof workerId !== 'string') throw new Error('workerId must be a string');
    if (!ownerId || typeof ownerId !== 'string') throw new Error('ownerId must be a string');
    if (!taskId || typeof taskId !== 'string') throw new Error('taskId must be a string');
    if (!attemptId || typeof attemptId !== 'string') throw new Error('attemptId must be a string');

    const now = options.now || Date.now();
    const leaseTtlMs = options.leaseTtlMs || 30000;
    const invocationToken = options.invocationToken || randomUUID();

    return this.transaction(() => {
      // 1. Check for any active attempt on this worker in the database
      const activeAttempt = this.getActiveAttemptForWorker(workerId);
      if (activeAttempt) {
        // INVARIANT: Stale telemetry never means slot free!
        // Any unclosed active attempt strictly blocks dispatch until explicitly reconciled.
        throw new Error(
          `Worker '${workerId}' has an active unclosed attempt '${activeAttempt.attempt_id}' for task '${activeAttempt.task_id}'; ` +
          `single-worker capacity guard rejects concurrent dispatch (stale telemetry does not free the slot)`
        );
      }

      // 2. Check for an active unreleased lease on this worker
      const currentLease = this.getWorkerLease(workerId);
      if (currentLease && currentLease.released_at == null) {
        const isLiveWriter = (now - currentLease.heartbeat_at) < currentLease.lease_ttl_ms;
        if (isLiveWriter) {
          throw new Error(
            `Worker '${workerId}' is actively leased to host '${currentLease.owner_id}' executing task '${currentLease.task_id}' (attempt '${currentLease.attempt_id}'); ` +
            `single-worker capacity guard rejects concurrent dispatch`
          );
        } else {
          // Stale telemetry does not free the slot automatically without explicit recovery
          throw new Error(
            `Worker '${workerId}' has an unreleased lease from host '${currentLease.owner_id}' for task '${currentLease.task_id}' (attempt '${currentLease.attempt_id}'); ` +
            `stale telemetry does not free the slot. Run explicit reconcile to clear abandoned work.`
          );
        }
      }

      // 3. Acquire lease with unique invocation token atomically
      this.db.prepare(`
        INSERT INTO worker_leases (worker_id, owner_id, invocation_token, task_id, attempt_id, acquired_at, heartbeat_at, lease_ttl_ms, released_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(worker_id) DO UPDATE SET
          owner_id = excluded.owner_id,
          invocation_token = excluded.invocation_token,
          task_id = excluded.task_id,
          attempt_id = excluded.attempt_id,
          acquired_at = excluded.acquired_at,
          heartbeat_at = excluded.heartbeat_at,
          lease_ttl_ms = excluded.lease_ttl_ms,
          released_at = NULL
      `).run(workerId, ownerId, invocationToken, taskId, attemptId, now, now, leaseTtlMs);

      return { acquired: true, workerId, ownerId, invocationToken, taskId, attemptId };
    });
  }

  renewWorkerLease(workerId, ownerId, attemptId, options = {}) {
    this._assertWritable('renew worker lease');
    try {
      const now = (typeof options === 'number') ? options : (options?.now || Date.now());
      const invocationToken = (typeof options === 'object') ? options?.invocationToken : null;
      let stmt;
      if (invocationToken) {
        stmt = this.db.prepare(`
          UPDATE worker_leases
          SET heartbeat_at = ?
          WHERE worker_id = ? AND owner_id = ? AND attempt_id = ? AND invocation_token = ? AND released_at IS NULL
        `).run(now, workerId, ownerId, attemptId, invocationToken);
      } else {
        stmt = this.db.prepare(`
          UPDATE worker_leases
          SET heartbeat_at = ?
          WHERE worker_id = ? AND owner_id = ? AND attempt_id = ? AND released_at IS NULL
        `).run(now, workerId, ownerId, attemptId);
      }
      return stmt.changes > 0;
    } catch (_) {
      return false;
    }
  }

  releaseWorkerLease(workerId, ownerId, attemptId, options = {}) {
    this._assertWritable('release worker lease');
    try {
      const now = (typeof options === 'number') ? options : (options?.now || Date.now());
      const invocationToken = (typeof options === 'object') ? options?.invocationToken : null;
      let stmt;
      if (invocationToken) {
        stmt = this.db.prepare(`
          UPDATE worker_leases
          SET released_at = ?
          WHERE worker_id = ? AND owner_id = ? AND attempt_id = ? AND invocation_token = ? AND released_at IS NULL
        `).run(now, workerId, ownerId, attemptId, invocationToken);
      } else if (attemptId) {
        stmt = this.db.prepare(`
          UPDATE worker_leases
          SET released_at = ?
          WHERE worker_id = ? AND owner_id = ? AND attempt_id = ? AND released_at IS NULL
        `).run(now, workerId, ownerId, attemptId);
      } else {
        stmt = this.db.prepare(`
          UPDATE worker_leases
          SET released_at = ?
          WHERE worker_id = ? AND owner_id = ? AND released_at IS NULL
        `).run(now, workerId, ownerId);
      }
      return stmt.changes > 0;
    } catch (_) {
      return false;
    }
  }

  createReview(review) {
    this._assertWritable('create review');
    if (!review || typeof review !== 'object') {
      throw new Error('Review must be a valid object');
    }
    if (!review.id || typeof review.id !== 'string') {
      throw new Error('Review id is required and must be a non-empty string');
    }
    if (!review.taskId || typeof review.taskId !== 'string') {
      throw new Error('Review taskId is required and must be a non-empty string');
    }
    if (!review.attemptId || typeof review.attemptId !== 'string') {
      throw new Error('Review attemptId is required and must be a non-empty string');
    }
    if (!review.state || !Object.values(ReviewStates).includes(review.state)) {
      throw new Error(`Invalid or unknown review state: '${review.state}'`);
    }
    if (!review.patchDigest || typeof review.patchDigest !== 'string') {
      throw new Error('Review patchDigest is required and must be a string');
    }
    if (!review.sourceBaseline) {
      throw new Error('Review sourceBaseline is required');
    }
    if (!review.verification) {
      throw new Error('Review verification is required');
    }
    if (!review.manifest) {
      throw new Error('Review manifest is required');
    }

    const task = this.getTask(review.taskId);
    if (!task) {
      throw new Error(`Parent task not found: ${review.taskId}`);
    }

    const attempt = this.getAttempt(review.attemptId);
    if (!attempt) {
      throw new Error(`Parent attempt not found: ${review.attemptId}`);
    }
    if (attempt.taskId !== review.taskId) {
      throw new Error(`Attempt ownership mismatch: attempt '${review.attemptId}' does not belong to task '${review.taskId}'`);
    }

    const existingById = this.getReview(review.id);
    if (existingById) {
      throw new Error(`Review with id '${review.id}' already exists`);
    }

    const duplicate = this.db.prepare(
      'SELECT id FROM reviews WHERE task_id = ? AND attempt_id = ? AND patch_digest = ?'
    ).get(review.taskId, review.attemptId, review.patchDigest);
    if (duplicate) {
      throw new Error(`Review already exists for task '${review.taskId}', attempt '${review.attemptId}', and patch digest '${review.patchDigest}'`);
    }

    const now = Date.now();
    const sourceBaselineStr = typeof review.sourceBaseline === 'string'
      ? review.sourceBaseline
      : JSON.stringify(review.sourceBaseline);
    const verificationStr = typeof review.verification === 'string'
      ? review.verification
      : JSON.stringify(review.verification);
    const manifestStr = typeof review.manifest === 'string'
      ? review.manifest
      : JSON.stringify(review.manifest);
    const approvalDataStr = review.approvalData
      ? (typeof review.approvalData === 'string' ? review.approvalData : JSON.stringify(review.approvalData))
      : null;

    this.db.prepare(`
      INSERT INTO reviews (
        id, task_id, attempt_id, state, source_root, source_baseline, patch_digest,
        verification_ref, manifest_json, approval_intent, approval_data,
        approved_at, rejected_at, discarded_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      review.id,
      review.taskId,
      review.attemptId,
      review.state,
      review.sourceRoot || null,
      sourceBaselineStr,
      review.patchDigest,
      verificationStr,
      manifestStr,
      review.approvalIntent || null,
      approvalDataStr,
      review.approvedAt || null,
      review.rejectedAt || null,
      review.discardedAt || null,
      now,
      now
    );

    return this.getReview(review.id);
  }

  getReview(id) {
    if (!id || typeof id !== 'string') return null;
    const row = this.db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
    return row ? this._mapReviewRow(row) : null;
  }

  getReviewByTaskId(taskId) {
    if (!taskId || typeof taskId !== 'string') return null;
    const row = this.db.prepare('SELECT * FROM reviews WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(taskId);
    return row ? this._mapReviewRow(row) : null;
  }

  listReviews(taskId = null) {
    let rows;
    if (taskId && typeof taskId === 'string') {
      rows = this.db.prepare('SELECT * FROM reviews WHERE task_id = ? ORDER BY created_at ASC').all(taskId);
    } else {
      rows = this.db.prepare('SELECT * FROM reviews ORDER BY created_at ASC').all();
    }
    return rows.map(r => this._mapReviewRow(r));
  }

  updateReviewState(id, newState, options = {}) {
    this._assertWritable('update review state');
    if (!id || typeof id !== 'string') {
      throw new Error('Review id is required');
    }
    if (!Object.values(ReviewStates).includes(newState)) {
      throw new Error(`Invalid or unknown review state: '${newState}'`);
    }

    const current = this.getReview(id);
    if (!current) {
      throw new Error(`Review not found: '${id}'`);
    }

    if (TERMINAL_REVIEW_STATES.has(current.state)) {
      throw new Error(`Cannot transition review '${id}': already in terminal state '${current.state}'`);
    }

    const now = Date.now();
    let approvalIntent = current.approvalIntent;
    let approvalData = current.approvalData;
    let approvedAt = current.approvedAt;
    let rejectedAt = current.rejectedAt;
    let discardedAt = current.discardedAt;

    if (newState === ReviewStates.APPROVED) {
      approvalIntent = options.intent || Intents.APPROVE_PATCH;
      approvalData = options.intentData || options.approvalData || { timestamp: now };
      approvedAt = now;
    } else if (newState === ReviewStates.REJECTED) {
      approvalIntent = options.intent || Intents.REJECT_PATCH;
      approvalData = options.intentData || options.approvalData || { timestamp: now };
      rejectedAt = now;
    } else if (newState === ReviewStates.DISCARDED) {
      approvalIntent = options.intent || Intents.DISCARD_PATCH;
      approvalData = options.intentData || options.approvalData || { timestamp: now };
      discardedAt = now;
    }

    const approvalDataStr = approvalData ? JSON.stringify(approvalData) : null;

    this.db.prepare(`
      UPDATE reviews SET
        state = ?,
        approval_intent = ?,
        approval_data = ?,
        approved_at = ?,
        rejected_at = ?,
        discarded_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      newState,
      approvalIntent,
      approvalDataStr,
      approvedAt,
      rejectedAt,
      discardedAt,
      now,
      id
    );

    return this.getReview(id);
  }

  finalizeReviewApproval(reviewId, options = {}) {
    this._assertWritable('finalize review approval');
    if (!reviewId || typeof reviewId !== 'string') {
      throw new Error('Review id is required and must be a string');
    }

    return this.transaction(() => {
      const review = this.getReview(reviewId);
      if (!review) {
        throw new Error(`Review not found: '${reviewId}'`);
      }

      if (review.state === ReviewStates.APPROVED) {
        throw new Error(`One-use approval rejection: Review '${reviewId}' is already APPROVED; approval intent cannot be reused or replayed`);
      }
      if (TERMINAL_REVIEW_STATES.has(review.state)) {
        throw new Error(`Terminal overwrite rejection: Review '${reviewId}' is in terminal state '${review.state}' and cannot be approved`);
      }
      if (review.state !== ReviewStates.PENDING) {
        throw new Error(`Invalid review state: Review '${reviewId}' is in state '${review.state}', must be PENDING`);
      }

      const operator = options.operator || 'operator';
      const timestamp = options.timestamp || Date.now();
      const intentData = {
        operator,
        timestamp,
        reason: options.reason || 'Approved by operator',
        patchDigest: review.patchDigest
      };

      // 1. Record approval intent in TaskStore
      this.recordIntent(review.taskId, review.attemptId, Intents.APPROVE_PATCH, intentData);

      if (options._injectFailure === 'after_intent') {
        throw new Error('Injected failure after intent recording');
      }

      // 2. Update review state to APPROVED
      const updated = this.updateReviewState(reviewId, ReviewStates.APPROVED, {
        intent: Intents.APPROVE_PATCH,
        intentData,
        operator,
        timestamp
      });

      if (options._injectFailure === 'after_review_update') {
        throw new Error('Injected failure after review state update');
      }

      // 3. Log audit event
      this.recordEvent(review.taskId, review.attemptId, 'REVIEW_APPROVED', {
        reviewId,
        operator,
        patchDigest: review.patchDigest,
        timestamp
      });

      if (options._injectFailure === 'after_event') {
        throw new Error('Injected failure after audit event');
      }

      return updated;
    });
  }

  finalizeReviewRejection(reviewId, options = {}) {
    this._assertWritable('finalize review rejection');
    if (!reviewId || typeof reviewId !== 'string') {
      throw new Error('Review id is required and must be a string');
    }

    return this.transaction(() => {
      const review = this.getReview(reviewId);
      if (!review) {
        throw new Error(`Review not found: '${reviewId}'`);
      }
      if (TERMINAL_REVIEW_STATES.has(review.state)) {
        throw new Error(`Terminal overwrite rejection: Review '${reviewId}' is in terminal state '${review.state}'`);
      }

      const operator = options.operator || 'operator';
      const timestamp = options.timestamp || Date.now();
      const intentData = {
        operator,
        timestamp,
        reason: options.reason || 'Rejected by operator'
      };

      this.recordIntent(review.taskId, review.attemptId, Intents.REJECT_PATCH, intentData);

      const updated = this.updateReviewState(reviewId, ReviewStates.REJECTED, {
        intent: Intents.REJECT_PATCH,
        intentData,
        operator,
        timestamp
      });

      this.recordEvent(review.taskId, review.attemptId, 'REVIEW_REJECTED', {
        reviewId,
        operator,
        timestamp
      });

      return updated;
    });
  }

  finalizeReviewDiscard(reviewId, options = {}) {
    this._assertWritable('finalize review discard');
    if (!reviewId || typeof reviewId !== 'string') {
      throw new Error('Review id is required and must be a string');
    }

    return this.transaction(() => {
      const review = this.getReview(reviewId);
      if (!review) {
        throw new Error(`Review not found: '${reviewId}'`);
      }
      if (TERMINAL_REVIEW_STATES.has(review.state)) {
        throw new Error(`Terminal overwrite rejection: Review '${reviewId}' is in terminal state '${review.state}'`);
      }

      const operator = options.operator || 'operator';
      const timestamp = options.timestamp || Date.now();
      const intentData = {
        operator,
        timestamp,
        reason: options.reason || 'Discarded'
      };

      this.recordIntent(review.taskId, review.attemptId, Intents.DISCARD_PATCH, intentData);

      const updated = this.updateReviewState(reviewId, ReviewStates.DISCARDED, {
        intent: Intents.DISCARD_PATCH,
        intentData,
        operator,
        timestamp
      });

      this.recordEvent(review.taskId, review.attemptId, 'REVIEW_DISCARDED', {
        reviewId,
        operator,
        timestamp
      });

      return updated;
    });
  }

  _mapReviewRow(r) {
    return {
      id: r.id,
      taskId: r.task_id,
      attemptId: r.attempt_id,
      state: r.state,
      sourceRoot: r.source_root || null,
      sourceBaseline: JSON.parse(r.source_baseline),
      patchDigest: r.patch_digest,
      verification: JSON.parse(r.verification_ref),
      manifest: JSON.parse(r.manifest_json),
      approvalIntent: r.approval_intent,
      approvalData: r.approval_data ? JSON.parse(r.approval_data) : null,
      approvedAt: r.approved_at,
      rejectedAt: r.rejected_at,
      discardedAt: r.discarded_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  _mapTaskRow(r) {
    return {
      id: r.id,
      agent: r.agent,
      objective: r.objective,
      allowedPaths: JSON.parse(r.allowed_paths),
      contextRefs: JSON.parse(r.context_refs),
      acceptance: r.acceptance,
      verification: r.verification,
      workspaceRoot: r.workspace_root,
      sourceHash: r.source_hash,
      assignmentDigest: r.assignment_digest,
      deadlineMs: r.deadline_ms,
      budget: {
        maxContextChars: r.max_context_chars,
        maxReplyChars: r.max_reply_chars
      },
      contextCharsUsed: r.context_chars_used,
      replyCharsUsed: r.reply_chars_used,
      state: r.state,
      uncertainty: r.uncertainty,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  _mapAttemptRow(r) {
    return {
      attemptId: r.attempt_id,
      taskId: r.task_id,
      attemptNumber: r.attempt_number,
      intent: r.intent,
      intentData: r.intent_data ? JSON.parse(r.intent_data) : null,
      state: r.state,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      uncertainty: r.uncertainty,
      error: r.error
    };
  }

  createComputerSession(session) {
    this._assertWritable('create computer session');
    if (!session || typeof session !== 'object') {
      throw new Error('Computer session must be a valid object');
    }
    if (!session.sessionId || typeof session.sessionId !== 'string') {
      throw new Error('Computer sessionId is required and must be a non-empty string');
    }
    if (!session.targetId || typeof session.targetId !== 'string') {
      throw new Error('Computer targetId is required and must be a non-empty string');
    }
    if (!session.targetKind || typeof session.targetKind !== 'string') {
      throw new Error('Computer targetKind is required and must be a non-empty string');
    }

    const existing = this.getComputerSession(session.sessionId);
    if (existing) {
      throw new Error(`Duplicate Computer Session ID: ${session.sessionId}`);
    }

    const now = Date.now();
    const state = session.state || 'observed';
    const phase = session.phase || 'initialized';
    const acting = session.acting ? 1 : 0;
    const granted = session.granted ? 1 : 0;
    const paused = session.paused ? 1 : 0;
    // INVARIANT: No actor claim can establish verified or native access
    const verified = 0;
    const isNative = 0;
    const lastSequence = Number.isInteger(session.lastSequence) ? session.lastSequence : 0;
    const lastTimestamp = typeof session.lastTimestamp === 'number' ? session.lastTimestamp : now;
    const expiresAt = typeof session.expiresAt === 'number' ? session.expiresAt : (now + 3600000);
    const stoppedAt = typeof session.stoppedAt === 'number' ? session.stoppedAt : null;
    const revokedAt = typeof session.revokedAt === 'number' ? session.revokedAt : null;
    const metadataJson = session.metadata ? JSON.stringify(session.metadata) : '{}';

    const stmt = this.db.prepare(`
      INSERT INTO computer_sessions (
        session_id, target_id, target_kind, task_id, attempt_id,
        state, phase, acting, granted, paused, verified, is_native,
        last_sequence, last_timestamp, expires_at, stopped_at, revoked_at,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.sessionId,
      session.targetId,
      session.targetKind,
      session.taskId || null,
      session.attemptId || null,
      state,
      phase,
      acting,
      granted,
      paused,
      verified,
      isNative,
      lastSequence,
      lastTimestamp,
      expiresAt,
      stoppedAt,
      revokedAt,
      metadataJson,
      now,
      now
    );

    return this.getComputerSession(session.sessionId);
  }

  getComputerSession(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      return null;
    }
    const stmt = this.db.prepare('SELECT * FROM computer_sessions WHERE session_id = ?');
    const row = stmt.get(sessionId);
    return this._mapComputerSessionRow(row);
  }

  listComputerSessions(options = {}) {
    let sql = 'SELECT * FROM computer_sessions WHERE 1=1';
    const params = [];

    if (options.taskId) {
      sql += ' AND task_id = ?';
      params.push(options.taskId);
    }
    if (options.targetId) {
      sql += ' AND target_id = ?';
      params.push(options.targetId);
    }
    if (options.state) {
      sql += ' AND state = ?';
      params.push(options.state);
    }

    sql += ' ORDER BY created_at DESC';

    const limit = typeof options.limit === 'number' && options.limit > 0 ? Math.min(options.limit, 200) : 50;
    sql += ' LIMIT ?';
    params.push(limit);

    if (typeof options.offset === 'number' && options.offset > 0) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => this._mapComputerSessionRow(r));
  }

  updateComputerSession(sessionId, updates = {}) {
    this._assertWritable('update computer session');
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Computer sessionId must be a non-empty string');
    }

    const current = this.getComputerSession(sessionId);
    if (!current) {
      throw new Error(`Computer session not found: ${sessionId}`);
    }

    const setClauses = [];
    const params = [];

    if (updates.state !== undefined) {
      setClauses.push('state = ?');
      params.push(String(updates.state));
    }
    if (updates.phase !== undefined) {
      setClauses.push('phase = ?');
      params.push(String(updates.phase));
    }
    if (updates.acting !== undefined) {
      setClauses.push('acting = ?');
      params.push(updates.acting ? 1 : 0);
    }
    if (updates.granted !== undefined) {
      setClauses.push('granted = ?');
      params.push(updates.granted ? 1 : 0);
    }
    if (updates.paused !== undefined) {
      setClauses.push('paused = ?');
      params.push(updates.paused ? 1 : 0);
    }
    // INVARIANT: No actor claim can establish verified or native access
    if (updates.verified !== undefined) {
      setClauses.push('verified = ?');
      params.push(0);
    }
    if (updates.isNative !== undefined) {
      setClauses.push('is_native = ?');
      params.push(0);
    }
    if (typeof updates.lastSequence === 'number') {
      setClauses.push('last_sequence = ?');
      params.push(updates.lastSequence);
    }
    if (typeof updates.lastTimestamp === 'number') {
      setClauses.push('last_timestamp = ?');
      params.push(updates.lastTimestamp);
    }
    if (typeof updates.expiresAt === 'number') {
      setClauses.push('expires_at = ?');
      params.push(updates.expiresAt);
    }
    if (updates.stoppedAt !== undefined) {
      setClauses.push('stopped_at = ?');
      params.push(updates.stoppedAt != null ? Number(updates.stoppedAt) : null);
    }
    if (updates.revokedAt !== undefined) {
      setClauses.push('revoked_at = ?');
      params.push(updates.revokedAt != null ? Number(updates.revokedAt) : null);
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata_json = ?');
      params.push(JSON.stringify(updates.metadata || {}));
    }

    const now = Date.now();
    setClauses.push('updated_at = ?');
    params.push(now);

    params.push(sessionId);

    const sql = `UPDATE computer_sessions SET ${setClauses.join(', ')} WHERE session_id = ?`;
    this.db.prepare(sql).run(...params);

    return this.getComputerSession(sessionId);
  }

  recordComputerEvent(sessionId, event) {
    this._assertWritable('record computer event');
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Computer sessionId must be a non-empty string');
    }
    if (!event || typeof event !== 'object') {
      throw new Error('Event must be a valid object');
    }
    if (!Number.isInteger(event.sequence) || event.sequence <= 0) {
      throw new Error(`Event sequence must be a positive integer, got: ${event.sequence}`);
    }
    if (!event.eventType || typeof event.eventType !== 'string') {
      throw new Error('Event eventType is required and must be a non-empty string');
    }

    const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Date.now();
    if (timestamp > Date.now() + 5000) {
      throw new Error(`Event timestamp cannot be in the future (skew limit 5000ms): ${timestamp}`);
    }

    const targetId = event.targetId || '';
    const taskId = event.taskId || null;
    const attemptId = event.attemptId || null;
    const payloadJson = event.payload ? JSON.stringify(event.payload) : '{}';

    const stmt = this.db.prepare(`
      INSERT INTO computer_events (
        session_id, target_id, task_id, attempt_id, sequence,
        event_type, payload_json, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      sessionId,
      targetId,
      taskId,
      attemptId,
      event.sequence,
      event.eventType,
      payloadJson,
      timestamp
    );

    return {
      id: Number(info.lastInsertRowid),
      sessionId,
      targetId,
      taskId,
      attemptId,
      sequence: event.sequence,
      eventType: event.eventType,
      payload: event.payload || {},
      timestamp
    };
  }

  getComputerEvents(sessionId, options = {}) {
    if (!sessionId || typeof sessionId !== 'string') {
      return [];
    }

    let sql = 'SELECT * FROM computer_events WHERE session_id = ?';
    const params = [sessionId];

    if (typeof options.sinceSequence === 'number') {
      sql += ' AND sequence > ?';
      params.push(options.sinceSequence);
    }

    const order = options.order && options.order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    sql += ` ORDER BY sequence ${order}`;

    const limit = typeof options.limit === 'number' && options.limit > 0 ? Math.min(options.limit, 500) : 100;
    sql += ' LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => this._mapComputerEventRow(r));
  }

  _mapComputerSessionRow(r) {
    if (!r) return null;
    return {
      sessionId: r.session_id,
      targetId: r.target_id,
      targetKind: r.target_kind,
      taskId: r.task_id || null,
      attemptId: r.attempt_id || null,
      state: r.state,
      phase: r.phase,
      acting: Boolean(r.acting),
      granted: Boolean(r.granted),
      paused: Boolean(r.paused),
      verified: Boolean(r.verified),
      isNative: Boolean(r.is_native),
      lastSequence: r.last_sequence,
      lastTimestamp: r.last_timestamp,
      expiresAt: r.expires_at,
      stoppedAt: r.stopped_at || null,
      revokedAt: r.revoked_at || null,
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {},
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  _mapComputerEventRow(r) {
    if (!r) return null;
    return {
      id: r.id,
      sessionId: r.session_id,
      targetId: r.target_id,
      taskId: r.task_id || null,
      attemptId: r.attempt_id || null,
      sequence: r.sequence,
      eventType: r.event_type,
      payload: r.payload_json ? JSON.parse(r.payload_json) : {},
      timestamp: r.timestamp
    };
  }
}
