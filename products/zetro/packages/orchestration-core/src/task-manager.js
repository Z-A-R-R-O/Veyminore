import { States, TERMINAL_STATES, Bounds, Intents } from './types.js';
import { RctAdapterPort } from './rct-adapter-port.js';
import { WorkerStatusProjection } from './worker-projection.js';

/**
 * TaskManager exposes bounded run/status/events/cancel/evidence library APIs
 * backed by a durable TaskStore.
 */
export class TaskManager {
  /**
   * @param {import('./task-store.js').TaskStore} store
   * @param {Object} adapter
   * @param {Object} [options]
   * @param {Object} [options.verifier]
   */
  constructor(store, adapter, options = {}) {
    this.store = store;
    this.adapter = adapter;
    this.verifier = options.verifier || (typeof options.verify === 'function' ? options : null);
    this.policyPort = options.policyPort || null;
    this.authority = options.authority || null;
    this.abortControllers = new Map();
  }

  async init(options = {}) {
    await this.store.init();
    if (!this.store.readOnly) {
      // Reconcile interrupted in-flight attempts on restart, protecting live writer leases
      return this.store.reconcileInterruptedWork(options);
    }
    return [];
  }

  close() {
    for (const ac of this.abortControllers.values()) {
      ac.abort();
    }
    this.abortControllers.clear();
    this.store.close();
  }

  async run(envelope, options = {}) {
    this._validateEnvelope(envelope);

    // 1. Immediately create durable task in TaskStore
    this.store.createTask({
      ...envelope,
      state: States.PENDING
    });

    const attemptId = `${envelope.id}-att-1`;
    const workspaceId = (envelope.workspaceId && typeof envelope.workspaceId === 'string')
      ? envelope.workspaceId
      : `ws-${envelope.id}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

    this.store.createAttempt({
      attemptId,
      taskId: envelope.id,
      attemptNumber: 1,
      intent: Intents.NONE,
      state: States.RUNNING
    });

    const ac = new AbortController();
    this.abortControllers.set(envelope.id, ac);

    // 2. Intent window: record intent BEFORE remote dispatch
    this.store.recordIntent(envelope.id, attemptId, Intents.DISPATCH_CALL, {
      agent: envelope.agent,
      timestamp: Date.now()
    });

    this.store.updateTaskState(envelope.id, States.RUNNING, { attemptId });

    let timeoutId;
    let deadlineFired = false;
    const deadlinePromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        deadlineFired = true;
        reject(new Error('Deadline exceeded'));
      }, envelope.deadlineMs);
    });

    try {
      if (options.workspaceAdmission) {
        if (options.workspaceAdmission.taskId !== envelope.id) {
          throw new Error(`Workspace admission taskId mismatch: expected '${envelope.id}', got '${options.workspaceAdmission.taskId}'`);
        }
        if (options.workspaceAdmission.attemptId !== attemptId) {
          throw new Error(`Workspace admission attemptId mismatch (stale attempt rejection): expected '${attemptId}', got '${options.workspaceAdmission.attemptId}'`);
        }
      }
      if (options.executionIdentity) {
        if (options.executionIdentity.taskId !== envelope.id) {
          throw new Error(`Execution identity taskId mismatch: expected '${envelope.id}', got '${options.executionIdentity.taskId}'`);
        }
        if (options.executionIdentity.attemptId !== attemptId) {
          throw new Error(`Execution identity attemptId mismatch (stale attempt rejection): expected '${attemptId}', got '${options.executionIdentity.attemptId}'`);
        }
      }
      const adapterContext = {
        signal: ac.signal,
        abortSignal: ac.signal,
        get aborted() { return ac.signal.aborted; },
        addEventListener: (...args) => ac.signal.addEventListener(...args),
        removeEventListener: (...args) => ac.signal.removeEventListener(...args),
        taskId: envelope.id,
        attemptId,
        attemptNumber: 1,
        workspaceId,
        task: this.store.getTask(envelope.id),
        attempt: this.store.getAttempt(attemptId),
        store: this.store,
        policyPort: options.policyPort || this.policyPort || null,
        authority: options.authority || this.authority || null,
        workspaceAdmission: options.workspaceAdmission || null,
        executionIdentity: options.executionIdentity || null
      };

      const receipt = await Promise.race([
        this.adapter.execute(envelope, adapterContext),
        deadlinePromise
      ]);

      let current = this.store.getTask(envelope.id);
      if (current?.state === States.CANCELLED || ac.signal.aborted || deadlineFired) {
        return this.status(envelope.id);
      }

      // 1. Strict Receipt & Verification Validation BEFORE ANY authoritative writes
      const validation = RctAdapterPort.checkReceiptConformance(receipt, envelope, { attemptId });
      if (!validation.valid) {
        // Receipt validation failed!
        // Worker completion alone must not become independent completion.
        // Atomic finalization to FAILED with validation error, zero proposed artifacts recorded.
        this.store.finalizeTaskAttempt(envelope.id, attemptId, {
          state: States.FAILED,
          error: `Receipt validation failed: ${validation.reason}`,
          uncertainty: 'Adapter returned invalid or non-conformant receipt',
          artifacts: []
        });
        return this.status(envelope.id);
      }

      // 2. Receipt is conformant. Collect worker artifacts.
      const artifactsToPersist = [];
      if (receipt.workspaceAdmission) {
        artifactsToPersist.push({
          artifactType: 'workspace_admission',
          uri: `evidence/${envelope.id}-admission.json`,
          metadata: {
            workspaceId: receipt.workspaceAdmission.workspaceId,
            taskId: receipt.workspaceAdmission.taskId,
            attemptId: receipt.workspaceAdmission.attemptId,
            admissionDigest: receipt.workspaceAdmission.admissionDigest,
            sourceBaselineHash: receipt.workspaceAdmission.sourceBaselineHash,
            canonicalRoot: receipt.workspaceAdmission.canonicalRoot,
            sourceBaselineRoot: receipt.workspaceAdmission.sourceBaselineRoot,
            scope: receipt.workspaceAdmission.scope
          }
        });

        this.store.recordEvent(envelope.id, attemptId, 'WORKSPACE_ADMISSION_VERIFIED', {
          admissionDigest: receipt.workspaceAdmission.admissionDigest,
          workspaceId: receipt.workspaceAdmission.workspaceId
        });
      }
      if (receipt.evidenceRefs?.length) {
        for (const uri of receipt.evidenceRefs) {
          artifactsToPersist.push({
            artifactType: 'evidence',
            uri,
            metadata: { summary: receipt.summary }
          });
        }
      }
      if (receipt.changedFiles?.length) {
        for (const path of receipt.changedFiles) {
          artifactsToPersist.push({
            artifactType: 'patch',
            uri: path,
            metadata: {}
          });
        }
      }

      // 3. Verification Trust: Worker completion alone must NEVER become independent completion.
      // If worker claims COMPLETED:
      if (receipt.state === States.COMPLETED) {
        const verifier = options.verifier || (typeof options.verify === 'function' ? options : null) || this.verifier;
        let verifierEvidence = options.verifierEvidence || null;

        if (!verifierEvidence && verifier && typeof verifier.verify === 'function') {
          // Keep verifier within deadline/cancel boundary:
          const verifierAbortPromise = new Promise((_, reject) => {
            if (ac.signal.aborted) {
              reject(new Error('AbortError'));
            } else {
              ac.signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
            }
          });

          verifierEvidence = await Promise.race([
            verifier.verify(envelope, receipt, { attemptId, abortSignal: ac.signal }),
            deadlinePromise,
            verifierAbortPromise
          ]);
        }

        // Check if deadline fired or cancel was requested during verifier execution
        current = this.store.getTask(envelope.id);
        if (current?.state === States.CANCELLED || ac.signal.aborted || deadlineFired) {
          return this.status(envelope.id);
        }

        if (verifierEvidence) {
          // Injected independent verifier evidence provided: validate strictly
          const evVal = RctAdapterPort.validateVerifierEvidence(verifierEvidence, envelope, attemptId);
          if (!evVal.valid) {
            // Independent verification failed!
            this.store.finalizeTaskAttempt(envelope.id, attemptId, {
              state: States.FAILED,
              error: `Verification failed: ${evVal.reason}`,
              uncertainty: 'Independent verifier rejected worker completion',
              artifacts: []
            });
            return this.status(envelope.id);
          }

          // Handle direct run({ verifierEvidence }) where verifier object is omitted
          const verifierName = verifier?.name || verifierEvidence.verifier || 'independent-verifier';

          // Independent verification passed! Authoritative completion granted.
          artifactsToPersist.push({
            artifactType: 'verifier_evidence',
            uri: `evidence/${envelope.id}-verifier.json`,
            metadata: {
              verified: true,
              checks: verifierEvidence.checks,
              verifier: verifierName
            }
          });

          this.store.finalizeTaskAttempt(envelope.id, attemptId, {
            state: States.COMPLETED,
            summary: receipt.summary,
            uncertainty: receipt.uncertainty,
            artifacts: artifactsToPersist
          });
        } else {
          // No separate injected independent verifier evidence provided!
          // Preserve unverified worker claim (diff, checks, artifacts) without authoritative completion.
          const uncertainty = receipt.uncertainty && receipt.uncertainty !== 'None'
            ? `Unverified worker claim (${receipt.uncertainty}): separate independent verifier evidence absent`
            : 'Unverified worker claim: separate independent verifier evidence absent';

          this.store.finalizeTaskAttempt(envelope.id, attemptId, {
            state: States.SUBMITTED,
            summary: receipt.summary,
            uncertainty,
            artifacts: artifactsToPersist
          });
        }
      } else {
        // Non-COMPLETED states (SUBMITTED, FAILED, UNKNOWN)
        current = this.store.getTask(envelope.id);
        if (current?.state === States.CANCELLED || ac.signal.aborted || deadlineFired) {
          return this.status(envelope.id);
        }

        this.store.finalizeTaskAttempt(envelope.id, attemptId, {
          state: receipt.state,
          summary: receipt.summary,
          uncertainty: receipt.uncertainty,
          artifacts: artifactsToPersist
        });
      }

      return this.status(envelope.id);
    } catch (err) {
      const current = this.store.getTask(envelope.id);
      if (current?.state === States.CANCELLED || ac.signal.aborted || err.name === 'AbortError') {
        return this.status(envelope.id);
      }

      if (err.message === 'Deadline exceeded' || deadlineFired) {
        ac.abort();
        this.store.finalizeTaskAttempt(envelope.id, attemptId, {
          state: States.UNKNOWN,
          error: 'Deadline exceeded',
          uncertainty: 'In-flight when deadline exceeded',
          artifacts: []
        });
      } else {
        this.store.finalizeTaskAttempt(envelope.id, attemptId, {
          state: States.FAILED,
          error: err.message,
          artifacts: []
        });
      }

      return this.status(envelope.id);
    } finally {
      clearTimeout(timeoutId);
      this.abortControllers.delete(envelope.id);
    }
  }

  status(taskId) {
    if (!taskId || typeof taskId !== 'string') return null;
    const task = this.store.getTask(taskId);
    if (!task) return null;
    const latestAttempt = this.store.getLatestAttempt(taskId);
    return {
      id: task.id,
      state: task.state,
      agent: task.agent,
      objective: task.objective,
      budget: task.budget,
      contextCharsUsed: task.contextCharsUsed,
      replyCharsUsed: task.replyCharsUsed,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      error: task.error,
      uncertainty: task.uncertainty,
      latestAttempt: latestAttempt ? {
        attemptId: latestAttempt.attemptId,
        attemptNumber: latestAttempt.attemptNumber,
        intent: latestAttempt.intent,
        state: latestAttempt.state,
        startedAt: latestAttempt.startedAt,
        finishedAt: latestAttempt.finishedAt,
        error: latestAttempt.error,
        uncertainty: latestAttempt.uncertainty
      } : null
    };
  }

  events(taskId, options = {}) {
    if (!taskId || typeof taskId !== 'string') return [];
    return this.store.getEvents(taskId);
  }

  cancel(taskId, options = {}) {
    if (!taskId || typeof taskId !== 'string') return { cancelled: false, reason: 'Task ID must be a non-empty string' };
    const task = this.store.getTask(taskId);
    if (!task) return { cancelled: false, reason: 'Task not found' };
    if (TERMINAL_STATES.has(task.state)) {
      return { cancelled: false, reason: `Cannot cancel task in terminal state: ${task.state}` };
    }

    const ac = this.abortControllers.get(taskId);
    if (ac) {
      ac.abort();
    }

    const uncertainty = options.uncertainty || options.reason || 'Cancelled by operator request';
    const attempt = this.store.getLatestAttempt(taskId);
    const result = this.store.cancelTaskAttempt(taskId, attempt?.attemptId, {
      uncertainty
    });

    return { cancelled: result.cancelled, taskId };
  }

  evidence(taskId) {
    if (!taskId || typeof taskId !== 'string') return null;
    const task = this.store.getTask(taskId);
    if (!task) return null;
    const artifacts = this.store.getArtifacts(taskId);
    const events = this.store.getEvents(taskId);
    const attempt = this.store.getLatestAttempt(taskId);

    return {
      taskId: task.id,
      state: task.state,
      agent: task.agent,
      objective: task.objective,
      uncertainty: task.uncertainty,
      error: task.error,
      attemptId: attempt?.attemptId || null,
      artifacts,
      eventsCount: events.length
    };
  }

  getWorkerStatus(workerId, options = {}) {
    const projection = new WorkerStatusProjection(this.store, options);
    return projection.getWorkerStatus(workerId, options);
  }

  listWorkerStatuses(options = {}) {
    const projection = new WorkerStatusProjection(this.store, options);
    return projection.listWorkerStatuses(options);
  }

  _validateEnvelope(envelope) {
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
    if (typeof envelope.acceptance !== 'string' || typeof envelope.verification !== 'string') {
      throw new Error('Invalid TaskEnvelope: acceptance/verification must be strings');
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
  }
}
