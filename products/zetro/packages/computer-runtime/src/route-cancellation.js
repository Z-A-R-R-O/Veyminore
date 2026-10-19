/**
 * @file route-cancellation.js
 * IFZ route-wide computer cancellation coordinator (pure, isolated).
 *
 * Coordinates cancellation across computer-session branches for one run.
 * Holds no native effects: session end/stop and input-lease checks flow
 * through injected ports (hosts wire these to ComputerSession.revoke /
 * emergencyStop and the input lease — never to observer/desktop calls).
 *
 * Contract highlights:
 * - Exact identity required: run, task, branch, session, worker, workspace,
 *   cancellation, attempt. Anything missing fails closed.
 * - Every transition on an admitted branch re-validates the full stable
 *   identity (task, session, worker, workspace, attempt), not just the key.
 * - Cancellation fans out to active admitted branches exactly once per
 *   cancellationId; queued branches are blocked from starting.
 * - A send that may have reached the branch but timed out/errored is
 *   UNCERTAIN: never blindly retried; resolution requires explicit
 *   reconciliation by stable identity.
 * - Late completion cannot change a cancelled or stopped branch.
 * - Injected clock; deterministic with fake ports; zero dependencies.
 */

export const BranchState = Object.freeze({
  QUEUED: 'queued',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  STOPPED: 'stopped'
});

export const DeliveryState = Object.freeze({
  NONE: 'none',
  DELIVERED: 'delivered',
  UNCERTAIN: 'uncertain',
  FAILED: 'failed',
  RECONCILED_DELIVERED: 'reconciled_delivered',
  RECONCILED_FAILED: 'reconciled_failed'
});

export const RouteState = Object.freeze({
  OPEN: 'open',
  CANCELLED: 'cancelled'
});

export const CancelErrorCode = Object.freeze({
  MISSING_IDENTITY: 'missing_identity',
  IDENTITY_MISMATCH: 'identity_mismatch',
  BRANCH_NOT_FOUND: 'branch_not_found',
  BRANCH_NOT_QUEUED: 'branch_not_queued',
  ROUTE_CANCELLED: 'route_cancelled',
  ROUTE_ALREADY_CANCELLED: 'route_already_cancelled',
  CANCELLATION_ID_MISMATCH: 'cancellation_id_mismatch',
  DELIVERY_NOT_UNCERTAIN: 'delivery_not_uncertain',
  DELIVERY_NOT_RESENDABLE: 'delivery_not_resendable',
  LATE_COMPLETION_REJECTED: 'late_completion_rejected',
  BRANCH_NOT_ACTIVE_OR_QUEUED: 'branch_not_active_or_queued',
  INPUT_LEASE_INVALID: 'input_lease_invalid',
  INVALID_RECONCILE_OUTCOME: 'invalid_reconcile_outcome'
});

const IDENTITY_FIELDS = Object.freeze([
  'runId', 'taskId', 'branchId', 'sessionId', 'workerId',
  'workspaceId', 'cancellationId', 'attemptId'
]);

const BINDING_FIELDS = Object.freeze([
  'taskId', 'sessionId', 'workerId', 'workspaceId', 'attemptId'
]);

function fail(code, details) {
  return { ok: false, code, ...(details ? { details } : {}) };
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function validateIdentity(identity) {
  if (!identity || typeof identity !== 'object') {
    return fail(CancelErrorCode.MISSING_IDENTITY, { field: '(identity)' });
  }
  for (const field of IDENTITY_FIELDS) {
    if (!isNonEmptyString(identity[field])) {
      return fail(CancelErrorCode.MISSING_IDENTITY, { field });
    }
  }
  return { ok: true, id: Object.freeze({ ...identity }) };
}

export class RouteCancellationCoordinator {
  /**
   * @param {object} ports
   * @property {{ now(): number }} ports.clock
   * @property {{ send(msg: object): Promise<{ status: 'delivered'|'timeout'|'unknown'|'failed' }>
   *   | { status: 'delivered'|'timeout'|'unknown'|'failed' } }} ports.cancellationPort
   * @property {{ end(args: object): any, stop(args: object): any }} [ports.branchControl]
   * @property {{ isValid(args: { sessionId: string, workerId: string }): boolean }} [ports.inputLease]
   * @property {{ write(event: object): void }} [ports.auditSink]
   * @property {(prefix: string) => string} [ports.idFactory]
   */
  constructor(ports) {
    if (!ports || typeof ports !== 'object' || !ports.clock || typeof ports.clock.now !== 'function') {
      throw new Error('RouteCancellationCoordinator requires an injected clock');
    }
    if (!ports.cancellationPort || typeof ports.cancellationPort.send !== 'function') {
      throw new Error('RouteCancellationCoordinator requires an injected cancellationPort with send()');
    }
    this._clock = ports.clock;
    this._cancellationPort = ports.cancellationPort;
    this._branchControl = ports.branchControl ?? null;
    this._inputLease = ports.inputLease ?? null;
    this._audit = ports.auditSink ?? null;
    this._seq = 1;
    this._idFactory = typeof ports.idFactory === 'function'
      ? ports.idFactory
      : (prefix) => `${prefix}-${this._seq++}`;
    /** @type {Map<string, { runId: string, state: string, cancellationId: string|null, at: number|null }>} */
    this._routes = new Map();
    /** @type {Map<string, object>} branchKey -> record */
    this._branches = new Map();
  }

  now() {
    return this._clock.now();
  }

  _routeKey(runId) {
    return runId;
  }

  _branchKey(runId, branchId) {
    return `${runId}:${branchId}`;
  }

  _emit(event) {
    if (this._audit) {
      this._audit.write({ at: this._clock.now(), ...event });
    }
  }

  /** Branch-level audit events always carry the full stable identity. */
  _branchEvent(type, id, extra = {}) {
    this._emit({
      type,
      runId: id.runId,
      taskId: id.taskId,
      branchId: id.branchId,
      sessionId: id.sessionId,
      workerId: id.workerId,
      workspaceId: id.workspaceId,
      attemptId: id.attemptId,
      ...extra
    });
  }

  _getBranch(id) {
    return this._branches.get(this._branchKey(id.runId, id.branchId)) ?? null;
  }

  /**
   * Resolves a branch and re-validates the full stable binding identity
   * (task, session, worker, workspace, attempt) on every transition.
   */
  _getBranchChecked(id) {
    const branch = this._getBranch(id);
    if (!branch) {
      return fail(CancelErrorCode.BRANCH_NOT_FOUND, { branchId: id.branchId });
    }
    const admitted = branch.identity;
    for (const field of BINDING_FIELDS) {
      if (admitted[field] !== id[field]) {
        return fail(CancelErrorCode.IDENTITY_MISMATCH, {
          field,
          expected: admitted[field],
          received: id[field]
        });
      }
    }
    return { ok: true, branch };
  }

  _ensureRoute(runId) {
    const key = this._routeKey(runId);
    if (!this._routes.has(key)) {
      this._routes.set(key, { runId, state: RouteState.OPEN, cancellationId: null, at: null });
    }
    return this._routes.get(key);
  }

  /**
   * Admits a branch in queued state. Cannot admit onto a cancelled route.
   * @param {object} identity exact run/task/branch/session/worker/workspace/cancellation/attempt ids
   * @param {object} [options]
   * @param {boolean} [options.requiresInput=false] branch will perform native input (lease-checked at start)
   */
  admit(identity, options = {}) {
    const v = validateIdentity(identity);
    if (!v.ok) return v;
    const id = v.id;
    const route = this._ensureRoute(id.runId);
    if (route.state === RouteState.CANCELLED) {
      return fail(CancelErrorCode.ROUTE_CANCELLED, { runId: id.runId, cancellationId: route.cancellationId });
    }
    const key = this._branchKey(id.runId, id.branchId);
    if (this._branches.has(key)) {
      return fail(CancelErrorCode.BRANCH_NOT_QUEUED, { branchId: id.branchId, reason: 'already_admitted' });
    }
    const branch = {
      identity: id,
      state: BranchState.QUEUED,
      delivery: DeliveryState.NONE,
      requiresInput: Boolean(options.requiresInput),
      deliveryCancellationId: null,
      completedUnderUncertainCancellation: false,
      lastOutcome: 'admitted'
    };
    this._branches.set(key, branch);
    this._branchEvent('branch_admitted', id);
    return { ok: true, branchKey: key, state: branch.state };
  }

  /**
   * Queued -> active. Blocked after route cancellation. Native input requires
   * a valid injected input lease; session authority remains host-owned.
   */
  tryStart(identity) {
    const v = validateIdentity(identity);
    if (!v.ok) return v;
    const id = v.id;
    const route = this._routes.get(this._routeKey(id.runId));
    if (route && route.state === RouteState.CANCELLED) {
      return fail(CancelErrorCode.ROUTE_CANCELLED, { runId: id.runId, cancellationId: route.cancellationId });
    }
    const found = this._getBranchChecked(id);
    if (!found.ok) return found;
    const branch = found.branch;
    if (branch.state !== BranchState.QUEUED) {
      return fail(CancelErrorCode.BRANCH_NOT_QUEUED, { branchId: id.branchId, state: branch.state });
    }
    if (branch.requiresInput) {
      const leaseOk = this._inputLease
        ? this._inputLease.isValid({ sessionId: id.sessionId, workerId: id.workerId }) === true
        : false;
      if (!leaseOk) {
        this._branchEvent('start_denied', id, { reason: 'input_lease_invalid' });
        return fail(CancelErrorCode.INPUT_LEASE_INVALID, { sessionId: id.sessionId, workerId: id.workerId });
      }
    }
    branch.state = BranchState.ACTIVE;
    branch.lastOutcome = 'started';
    this._branchEvent('branch_started', id);
    return { ok: true, state: branch.state };
  }

  /**
   * Route-wide cancellation. Fans out once per cancellationId to active
   * admitted branches; queued branches are cancelled locally and can never
   * start. Uncertain sends are never retried here.
   */
  async cancel(identity, options = {}) {
    const v = validateIdentity(identity);
    if (!v.ok) return v;
    const id = v.id;
    const route = this._ensureRoute(id.runId);
    if (route.state === RouteState.CANCELLED) {
      if (route.cancellationId === id.cancellationId) {
        return {
          ok: true,
          idempotent: true,
          cancellationId: id.cancellationId,
          branches: []
        };
      }
      return fail(CancelErrorCode.ROUTE_ALREADY_CANCELLED, {
        runId: id.runId,
        activeCancellationId: route.cancellationId
      });
    }

    route.state = RouteState.CANCELLED;
    route.cancellationId = id.cancellationId;
    route.at = this._clock.now();
    const reason = isNonEmptyString(options.reason) ? options.reason : 'route_cancelled';
    const results = [];

    for (const branch of this._branches.values()) {
      if (branch.identity.runId !== id.runId) continue;
      const bid = branch.identity;
      if (branch.state === BranchState.QUEUED) {
        branch.state = BranchState.CANCELLED;
        branch.lastOutcome = 'cancelled_before_start';
        this._branchEvent('branch_cancelled', bid, {
          cancellationId: id.cancellationId, delivery: 'not_started'
        });
        results.push({ branchId: bid.branchId, outcome: 'cancelled_before_start' });
        continue;
      }
      if (branch.state !== BranchState.ACTIVE) {
        results.push({ branchId: bid.branchId, outcome: `skipped_${branch.state}` });
        continue;
      }
      if (branch.delivery === DeliveryState.DELIVERED || branch.delivery === DeliveryState.UNCERTAIN) {
        results.push({ branchId: bid.branchId, outcome: 'already_fanned' });
        continue;
      }
      const outcome = await this._fanOne(branch, id.cancellationId, reason);
      results.push({ branchId: bid.branchId, outcome });
    }

    this._emit({
      type: 'route_cancelled',
      runId: id.runId,
      taskId: id.taskId,
      workspaceId: id.workspaceId,
      cancellationId: id.cancellationId,
      reason,
      branches: results
    });
    return { ok: true, cancellationId: id.cancellationId, branches: results };
  }

  async _fanOne(branch, cancellationId, reason) {
    const id = branch.identity;
    branch.deliveryCancellationId = cancellationId;
    let verdict;
    try {
      verdict = await this._cancellationPort.send({
        cancellationId,
        runId: id.runId,
        taskId: id.taskId,
        branchId: id.branchId,
        sessionId: id.sessionId,
        workerId: id.workerId,
        workspaceId: id.workspaceId,
        attemptId: id.attemptId,
        reason
      });
    } catch {
      // A thrown send may still have reached the branch: UNCERTAIN, never retried blindly.
      branch.delivery = DeliveryState.UNCERTAIN;
      branch.lastOutcome = 'delivery_uncertain';
      this._branchEvent('delivery_uncertain', id, { cancellationId, status: 'throw' });
      return 'uncertain';
    }
    const status = verdict && typeof verdict.status === 'string' ? verdict.status : 'unknown';
    if (status === 'delivered') {
      branch.delivery = DeliveryState.DELIVERED;
      if (this._branchControl && typeof this._branchControl.end === 'function') {
        try {
          this._branchControl.end({ sessionId: id.sessionId, branchId: id.branchId, cancellationId });
        } catch { /* host port errors do not change confirmed delivery */ }
      }
      branch.state = BranchState.CANCELLED;
      branch.lastOutcome = 'cancelled_delivered';
      this._branchEvent('branch_cancelled', id, { cancellationId, delivery: 'delivered' });
      return 'cancelled_delivered';
    }
    if (status === 'failed') {
      // Definitive non-delivery: branch remains active; resend is explicit only.
      branch.delivery = DeliveryState.FAILED;
      branch.lastOutcome = 'delivery_failed';
      this._branchEvent('delivery_failed', id, { cancellationId });
      return 'delivery_failed';
    }
    // timeout / unknown / anything else: possible send — UNCERTAIN.
    branch.delivery = DeliveryState.UNCERTAIN;
    branch.lastOutcome = 'delivery_uncertain';
    this._branchEvent('delivery_uncertain', id, { cancellationId, status });
    return 'uncertain';
  }

  /**
   * Resolves an UNCERTAIN delivery by stable identity. 'delivered' confirms
   * cancellation; 'not_delivered' makes the branch explicitly resendable.
   */
  reconcile(identity, outcome) {
    const v = validateIdentity(identity);
    if (!v.ok) return v;
    const id = v.id;
    if (outcome !== 'delivered' && outcome !== 'not_delivered') {
      return fail(CancelErrorCode.INVALID_RECONCILE_OUTCOME, { outcome });
    }
    // Dedicated stable-cancellation-id check runs BEFORE generic binding
    // mismatch so reconcile always reports CANCELLATION_ID_MISMATCH for a
    // different cancellationId (public contract).
    const existing = this._getBranch(id);
    if (existing && existing.deliveryCancellationId !== id.cancellationId) {
      return fail(CancelErrorCode.CANCELLATION_ID_MISMATCH, {
        expected: existing.deliveryCancellationId,
        received: id.cancellationId
      });
    }
    const found = this._getBranchChecked(id);
    if (!found.ok) return found;
    const branch = found.branch;
    if (branch.delivery !== DeliveryState.UNCERTAIN) {
      return fail(CancelErrorCode.DELIVERY_NOT_UNCERTAIN, { branchId: id.branchId, delivery: branch.delivery });
    }
    if (branch.deliveryCancellationId !== id.cancellationId) {
      return fail(CancelErrorCode.CANCELLATION_ID_MISMATCH, {
        expected: branch.deliveryCancellationId,
        received: id.cancellationId
      });
    }
    if (outcome === 'delivered') {
      branch.delivery = DeliveryState.RECONCILED_DELIVERED;
      if (this._branchControl && typeof this._branchControl.end === 'function') {
        try {
          this._branchControl.end({ sessionId: id.sessionId, branchId: id.branchId, cancellationId: id.cancellationId });
        } catch { /* ignored */ }
      }
      branch.state = BranchState.CANCELLED;
      branch.lastOutcome = 'cancelled_reconciled';
      this._branchEvent('branch_cancelled', id, { cancellationId: id.cancellationId, delivery: 'reconciled_delivered' });
      return { ok: true, delivery: branch.delivery, state: branch.state };
    }
    branch.delivery = DeliveryState.RECONCILED_FAILED;
    branch.lastOutcome = 'reconciled_not_delivered';
    this._branchEvent('reconciled_not_delivered', id, { cancellationId: id.cancellationId });
    return { ok: true, delivery: branch.delivery, state: branch.state };
  }

  /**
   * Explicit resend after reconciliation proved non-delivery. Never callable
   * directly from UNCERTAIN. Reuses the same stable cancellationId.
   */
  async resendCancellation(identity, options = {}) {
    const v = validateIdentity(identity);
    if (!v.ok) return v;
    const id = v.id;
    // Dedicated cancellation-id check before generic binding mismatch.
    const existing = this._getBranch(id);
    if (existing && existing.deliveryCancellationId !== id.cancellationId) {
      return fail(CancelErrorCode.CANCELLATION_ID_MISMATCH, {
        expected: existing.deliveryCancellationId,
        received: id.cancellationId
      });
    }
    const found = this._getBranchChecked(id);
    if (!found.ok) return found;
    const branch = found.branch;
    if (branch.delivery !== DeliveryState.RECONCILED_FAILED) {
      return fail(CancelErrorCode.DELIVERY_NOT_RESENDABLE, { branchId: id.branchId, delivery: branch.delivery });
    }
    const reason = isNonEmptyString(options.reason) ? options.reason : 'route_cancelled_resend';
    const outcome = await this._fanOne(branch, id.cancellationId, reason);
    return { ok: true, outcome, delivery: branch.delivery, state: branch.state };
  }

  /**
   * Branch-level emergency stop through the injected control port. Terminal.
   */
  stop(identity, options = {}) {
    const v = validateIdentity(identity);
    if (!v.ok) return v;
    const id = v.id;
    const found = this._getBranchChecked(id);
    if (!found.ok) return found;
    const branch = found.branch;
    if (branch.state !== BranchState.ACTIVE && branch.state !== BranchState.QUEUED) {
      return fail(CancelErrorCode.BRANCH_NOT_ACTIVE_OR_QUEUED, { branchId: id.branchId, state: branch.state });
    }
    if (this._branchControl && typeof this._branchControl.stop === 'function') {
      try {
        this._branchControl.stop({ sessionId: id.sessionId, branchId: id.branchId, reason: options.reason ?? 'emergency_stop' });
      } catch { /* host port errors do not change terminal local state */ }
    }
    branch.state = BranchState.STOPPED;
    branch.lastOutcome = 'stopped';
    this._branchEvent('branch_stopped', id, { reason: options.reason ?? 'emergency_stop' });
    return { ok: true, state: branch.state };
  }

  /**
   * Records completion. Late completions cannot change cancelled or stopped
   * branches. Completion under a merely UNCERTAIN delivery is accepted but
   * flagged (the cancellation was never confirmed).
   */
  complete(identity) {
    const v = validateIdentity(identity);
    if (!v.ok) return v;
    const id = v.id;
    const found = this._getBranchChecked(id);
    if (!found.ok) return found;
    const branch = found.branch;
    if (branch.state === BranchState.CANCELLED || branch.state === BranchState.STOPPED) {
      this._branchEvent('late_completion_rejected', id, { state: branch.state });
      return fail(CancelErrorCode.LATE_COMPLETION_REJECTED, { branchId: id.branchId, state: branch.state });
    }
    const route = this._routes.get(this._routeKey(id.runId));
    if (route && route.state === RouteState.CANCELLED
      && (branch.delivery === DeliveryState.DELIVERED || branch.delivery === DeliveryState.RECONCILED_DELIVERED)) {
      this._branchEvent('late_completion_rejected', id, { state: branch.state, delivery: branch.delivery });
      return fail(CancelErrorCode.LATE_COMPLETION_REJECTED, { branchId: id.branchId, state: branch.state, delivery: branch.delivery });
    }
    branch.completedUnderUncertainCancellation = branch.delivery === DeliveryState.UNCERTAIN;
    branch.state = BranchState.COMPLETED;
    branch.lastOutcome = branch.completedUnderUncertainCancellation
      ? 'completed_under_uncertain_cancellation'
      : 'completed';
    this._branchEvent('branch_completed', id, {
      underUncertainCancellation: branch.completedUnderUncertainCancellation
    });
    return {
      ok: true,
      state: branch.state,
      completedUnderUncertainCancellation: branch.completedUnderUncertainCancellation
    };
  }

  /** Read-only snapshot by stable identity. */
  status(identity) {
    const v = validateIdentity(identity);
    if (!v.ok) return v;
    const id = v.id;
    const found = this._getBranchChecked(id);
    if (!found.ok) return found;
    const branch = found.branch;
    const route = this._routes.get(this._routeKey(id.runId));
    return {
      ok: true,
      routeState: route ? route.state : RouteState.OPEN,
      cancellationId: route ? route.cancellationId : null,
      state: branch.state,
      delivery: branch.delivery,
      lastOutcome: branch.lastOutcome,
      completedUnderUncertainCancellation: branch.completedUnderUncertainCancellation
    };
  }
}
