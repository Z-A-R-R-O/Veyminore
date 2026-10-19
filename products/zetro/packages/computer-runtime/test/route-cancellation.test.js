/**
 * @file route-cancellation.test.js
 * IFZ route-wide computer cancellation coordinator tests (dependency-free).
 *
 * STATUS: NOT RUN by author — no shell tool in this session.
 * Focused command: node --test packages/computer-runtime/test/route-cancellation.test.js
 *
 * Deterministic: injected fake clock, scripted cancellationPort, recording
 * branchControl and inputLease fakes (each fake IS the injected port object).
 * No process/network/native/provider use.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RouteCancellationCoordinator,
  BranchState,
  DeliveryState,
  RouteState,
  CancelErrorCode
} from '../src/index.js';

function makeClock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance(ms) { t += ms; return t; } };
}

function makeCancellationPort(script = []) {
  return {
    sent: [],
    async send(msg) {
      this.sent.push(msg);
      if (script.length > 0) {
        const next = script.shift();
        if (next === 'throw') throw new Error('send transport failure');
        return { status: next };
      }
      return { status: 'delivered' };
    }
  };
}

/** The returned object IS the injected branchControl port (methods on it). */
function makeBranchControl() {
  return {
    endCalls: [],
    stopCalls: [],
    end(args) { this.endCalls.push(args); },
    stop(args) { this.stopCalls.push(args); }
  };
}

/** The returned object IS the injected inputLease port (isValid on it). */
function makeLease(valid = true) {
  return {
    calls: [],
    valid,
    isValid(args) { this.calls.push(args); return this.valid; }
  };
}

function makeCoordinator({ cancellationPort, branchControl, inputLease, clock } = {}) {
  const audit = { events: [], write(e) { this.events.push(e); } };
  const coordinator = new RouteCancellationCoordinator({
    clock: clock ?? makeClock(),
    cancellationPort: cancellationPort ?? makeCancellationPort(),
    branchControl: branchControl ?? makeBranchControl(),
    inputLease: inputLease ?? makeLease(),
    auditSink: audit
  });
  return { coordinator, audit };
}

let n = 0;
function identity(overrides = {}) {
  n += 1;
  return {
    runId: 'run-1',
    taskId: 'W1-OCR-2',
    branchId: `b${n}`,
    sessionId: `csession-${n}`,
    workerId: 'OCR-2',
    workspaceId: 'ws-1',
    cancellationId: 'cancel-1',
    attemptId: '1',
    ...overrides
  };
}

test('identity: any missing field fails closed', () => {
  const { coordinator } = makeCoordinator();
  for (const field of ['runId', 'taskId', 'branchId', 'sessionId', 'workerId', 'workspaceId', 'cancellationId', 'attemptId']) {
    const id = identity();
    delete id[field];
    const res = coordinator.admit(id);
    assert.equal(res.ok, false);
    assert.equal(res.code, CancelErrorCode.MISSING_IDENTITY);
    assert.equal(res.details.field, field);
  }
});

test('full identity revalidated on every transition: mismatched binding denied', () => {
  const { coordinator } = makeCoordinator();
  const a = identity({ branchId: 'bA', sessionId: 'sA' });
  coordinator.admit(a);
  for (const field of ['taskId', 'sessionId', 'workerId', 'workspaceId', 'attemptId']) {
    const forged = { ...a, [field]: `forged-${field}` };
    const res = coordinator.tryStart(forged);
    assert.equal(res.ok, false);
    assert.equal(res.code, CancelErrorCode.IDENTITY_MISMATCH);
    assert.equal(res.details.field, field);
    assert.equal(res.details.expected, a[field]);
    assert.equal(res.details.received, forged[field]);
  }
  const lateComplete = coordinator.complete({ ...a, sessionId: 's-forged' });
  assert.equal(lateComplete.ok, false);
  assert.equal(lateComplete.code, CancelErrorCode.IDENTITY_MISMATCH);
  const forgedStatus = coordinator.status({ ...a, workerId: 'OCR-9' });
  assert.equal(forgedStatus.ok, false);
  assert.equal(forgedStatus.code, CancelErrorCode.IDENTITY_MISMATCH);
});

test('fan-out: cancel delivers once to each active branch; queued branches cancelled before start', async () => {
  const port = makeCancellationPort();
  const { coordinator } = makeCoordinator({ cancellationPort: port });
  const a = identity({ branchId: 'bA', sessionId: 'sA' });
  const b = identity({ branchId: 'bB', sessionId: 'sB' });
  const q = identity({ branchId: 'bQ', sessionId: 'sQ' });
  coordinator.admit(a);
  coordinator.admit(b);
  coordinator.admit(q);
  assert.equal(coordinator.tryStart(a).ok, true);
  assert.equal(coordinator.tryStart(b).ok, true);

  const res = await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-1' }));
  assert.equal(res.ok, true);
  assert.equal(port.sent.length, 2);
  assert.deepEqual(port.sent.map((m) => m.branchId).sort(), ['bA', 'bB']);
  assert.equal(port.sent[0].cancellationId, 'cancel-1');
  assert.equal(coordinator.status(a).state, BranchState.CANCELLED);
  assert.equal(coordinator.status(b).delivery, DeliveryState.DELIVERED);
  assert.equal(coordinator.status(q).state, BranchState.CANCELLED);
  assert.equal(coordinator.status(q).lastOutcome, 'cancelled_before_start');
});

test('once semantics: repeat cancel with same cancellationId is idempotent; different id rejected', async () => {
  const port = makeCancellationPort();
  const { coordinator } = makeCoordinator({ cancellationPort: port });
  const a = identity({ branchId: 'bA' });
  coordinator.admit(a);
  coordinator.tryStart(a);
  const first = await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-1' }));
  assert.equal(first.ok, true);
  const again = await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-1' }));
  assert.equal(again.ok, true);
  assert.equal(again.idempotent, true);
  assert.equal(port.sent.length, 1);
  const other = await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-2' }));
  assert.equal(other.ok, false);
  assert.equal(other.code, CancelErrorCode.ROUTE_ALREADY_CANCELLED);
  assert.equal(port.sent.length, 1);
});

test('queued branch cannot start after cancellation', async () => {
  const { coordinator } = makeCoordinator();
  const q = identity({ branchId: 'bQ' });
  coordinator.admit(q);
  await coordinator.cancel(identity({ branchId: 'bQ', cancellationId: 'cancel-1' }));
  const start = coordinator.tryStart(q);
  assert.equal(start.ok, false);
  assert.equal(start.code, CancelErrorCode.ROUTE_CANCELLED);
});

test('timeout after possible send is uncertain, never blindly retried; reconcile by stable identity', async () => {
  const port = makeCancellationPort(['timeout']);
  const { coordinator, audit } = makeCoordinator({ cancellationPort: port });
  const a = identity({ branchId: 'bA' });
  coordinator.admit(a);
  coordinator.tryStart(a);
  await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-1' }));
  assert.equal(port.sent.length, 1);

  const st = coordinator.status(a);
  assert.equal(st.delivery, DeliveryState.UNCERTAIN);
  assert.equal(st.state, BranchState.ACTIVE);

  // Blind resend is impossible: no API path from UNCERTAIN to resend.
  const blind = await coordinator.resendCancellation(a);
  assert.equal(blind.ok, false);
  assert.equal(blind.code, CancelErrorCode.DELIVERY_NOT_RESENDABLE);
  assert.equal(port.sent.length, 1);

  // Wrong cancellationId cannot reconcile (dedicated path wins even when the
  // rest of the binding identity is also fresh/forged).
  const mismatch = coordinator.reconcile(identity({ branchId: 'bA', cancellationId: 'cancel-X' }), 'delivered');
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, CancelErrorCode.CANCELLATION_ID_MISMATCH);
  assert.equal(mismatch.details.received, 'cancel-X');
  assert.equal(mismatch.details.expected, 'cancel-1');

  // Correct cancellationId + forged binding still fails the full-identity check.
  const forgedBinding = coordinator.reconcile({ ...a, sessionId: 's-forged' }, 'delivered');
  assert.equal(forgedBinding.ok, false);
  assert.equal(forgedBinding.code, CancelErrorCode.IDENTITY_MISMATCH);
  assert.equal(forgedBinding.details.field, 'sessionId');

  const rec = coordinator.reconcile(a, 'delivered');
  assert.equal(rec.ok, true);
  assert.equal(rec.state, BranchState.CANCELLED);
  assert.equal(audit.events.some((e) => e.type === 'delivery_uncertain'), true);
});

test('reconcile not_delivered makes resend explicit and allowed once', async () => {
  const port = makeCancellationPort(['timeout', 'delivered']);
  const { coordinator } = makeCoordinator({ cancellationPort: port });
  const a = identity({ branchId: 'bA' });
  coordinator.admit(a);
  coordinator.tryStart(a);
  await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-1' }));
  const rec = coordinator.reconcile(a, 'not_delivered');
  assert.equal(rec.ok, true);
  assert.equal(rec.delivery, DeliveryState.RECONCILED_FAILED);
  assert.equal(rec.state, BranchState.ACTIVE);

  const resend = await coordinator.resendCancellation(a);
  assert.equal(resend.ok, true);
  assert.equal(resend.outcome, 'cancelled_delivered');
  assert.equal(coordinator.status(a).state, BranchState.CANCELLED);
  assert.equal(port.sent.length, 2);
  assert.equal(port.sent[1].cancellationId, 'cancel-1');
});

test('failed send is definitive non-delivery: no auto-retry, resend requires reconciliation first', async () => {
  const port = makeCancellationPort(['failed']);
  const { coordinator } = makeCoordinator({ cancellationPort: port });
  const a = identity({ branchId: 'bA' });
  coordinator.admit(a);
  coordinator.tryStart(a);
  await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-1' }));
  assert.equal(coordinator.status(a).delivery, DeliveryState.FAILED);
  const blind = await coordinator.resendCancellation(a);
  assert.equal(blind.ok, false);
  assert.equal(port.sent.length, 1);
});

test('thrown send is uncertain (possible send), zero confirmed delivery', async () => {
  const port = makeCancellationPort(['throw']);
  const { coordinator } = makeCoordinator({ cancellationPort: port });
  const a = identity({ branchId: 'bA' });
  coordinator.admit(a);
  coordinator.tryStart(a);
  await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-1' }));
  assert.equal(coordinator.status(a).delivery, DeliveryState.UNCERTAIN);
  assert.equal(port.sent.length, 1);
});

test('late completion cannot change cancelled or stopped state', async () => {
  const { coordinator } = makeCoordinator();
  const a = identity({ branchId: 'bA' });
  coordinator.admit(a);
  coordinator.tryStart(a);
  await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-1' }));
  const late = coordinator.complete(a);
  assert.equal(late.ok, false);
  assert.equal(late.code, CancelErrorCode.LATE_COMPLETION_REJECTED);
  assert.equal(coordinator.status(a).state, BranchState.CANCELLED);

  // Stopped scenario runs on its own route (run-1 is already cancelled).
  const b = identity({ runId: 'run-2', branchId: 'bB' });
  coordinator.admit(b);
  coordinator.tryStart(b);
  const stop = coordinator.stop(b);
  assert.equal(stop.ok, true);
  const lateStop = coordinator.complete(b);
  assert.equal(lateStop.ok, false);
  assert.equal(lateStop.code, CancelErrorCode.LATE_COMPLETION_REJECTED);
  assert.equal(coordinator.status(b).state, BranchState.STOPPED);
});

test('completion under uncertain delivery is accepted and flagged', async () => {
  const port = makeCancellationPort(['timeout']);
  const { coordinator } = makeCoordinator({ cancellationPort: port });
  const a = identity({ branchId: 'bA' });
  coordinator.admit(a);
  coordinator.tryStart(a);
  await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-1' }));
  const done = coordinator.complete(a);
  assert.equal(done.ok, true);
  assert.equal(done.completedUnderUncertainCancellation, true);
  assert.equal(coordinator.status(a).state, BranchState.COMPLETED);
});

test('input-bearing branch requires valid input lease; native effects stay behind injected ports', async () => {
  const lease = makeLease(false);
  const control = makeBranchControl();
  const { coordinator } = makeCoordinator({ inputLease: lease, branchControl: control });
  const a = identity({ branchId: 'bA' });
  coordinator.admit(a, { requiresInput: true });
  const denied = coordinator.tryStart(a);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, CancelErrorCode.INPUT_LEASE_INVALID);
  assert.equal(lease.calls.length, 1);
  assert.deepEqual(lease.calls[0], { sessionId: a.sessionId, workerId: a.workerId });

  lease.valid = true;
  assert.equal(coordinator.tryStart(a).ok, true);
  await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-1' }));
  assert.deepEqual(control.endCalls[0], {
    sessionId: a.sessionId, branchId: 'bA', cancellationId: 'cancel-1'
  });
});

test('branch control stop is terminal and recorded once', () => {
  const control = makeBranchControl();
  const { coordinator } = makeCoordinator({ branchControl: control });
  const a = identity({ branchId: 'bA' });
  coordinator.admit(a);
  coordinator.tryStart(a);
  assert.equal(coordinator.stop(a).ok, true);
  const again = coordinator.stop(a);
  assert.equal(again.ok, false);
  assert.equal(again.code, CancelErrorCode.BRANCH_NOT_ACTIVE_OR_QUEUED);
  assert.equal(control.stopCalls.length, 1);
  assert.deepEqual(control.stopCalls[0], {
    sessionId: a.sessionId, branchId: 'bA', reason: 'emergency_stop'
  });
});

test('audit events carry the full stable identity including sessionId', async () => {
  const { coordinator, audit } = makeCoordinator();
  const a = identity({ branchId: 'bA', sessionId: 'sA' });
  coordinator.admit(a);
  coordinator.tryStart(a);
  await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-1' }));
  const cancelled = audit.events.find((e) => e.type === 'route_cancelled');
  assert.equal(cancelled.runId, 'run-1');
  assert.equal(cancelled.cancellationId, 'cancel-1');
  const fan = audit.events.find((e) => e.type === 'branch_cancelled');
  assert.equal(fan.branchId, 'bA');
  assert.equal(fan.sessionId, 'sA');
  assert.equal(fan.workerId, a.workerId);
  assert.equal(fan.taskId, a.taskId);
  assert.equal(fan.workspaceId, a.workspaceId);
  assert.equal(fan.attemptId, a.attemptId);
  const started = audit.events.find((e) => e.type === 'branch_started');
  assert.equal(started.sessionId, 'sA');
});

test('route state after cancel blocks new admits', async () => {
  const { coordinator } = makeCoordinator();
  const a = identity({ branchId: 'bA' });
  coordinator.admit(a);
  await coordinator.cancel(identity({ branchId: 'bA', cancellationId: 'cancel-1' }));
  const late = coordinator.admit(identity({ branchId: 'bNew' }));
  assert.equal(late.ok, false);
  assert.equal(late.code, CancelErrorCode.ROUTE_CANCELLED);
  assert.equal(coordinator.status(a).routeState, RouteState.CANCELLED);
});
