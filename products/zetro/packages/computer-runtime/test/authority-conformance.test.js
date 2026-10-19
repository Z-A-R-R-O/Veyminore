/**
 * @file authority-conformance.test.js
 * W-COMPUTER conformance: real ComputerSession + actual shared policy
 * (PolicyService + OcrComputerAuthorityAdapter + WorkspaceAdmission).
 *
 * STATUS: NOT RUN — shell unavailable in this worker pass.
 * Coordinator command: node --test packages/computer-runtime/test/
 *
 * No native/desktop calls: the observer is an injected fake; authority is the
 * real offline policy stack with a finite fake clock and explicit barriers.
 * Every test carries a finite node:test timeout; barriers expose an awaitable
 * `entered` signal raced against deadlines; every gated test releases gates
 * and pending observers in `finally` so nothing can hang the suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComputerSession, SessionErrorCode } from '../src/index.js';
import { PolicyService, OcrComputerAuthorityAdapter } from '../../policy/src/index.js';
import { createWorkspaceAdmission } from '../../protocol/src/validators/workspace-admission.js';

const T0 = 1_700_000_000_000;
const PRINCIPAL = 'alice';
const TASK_ID = 'W1-OCR-2';
const ATTEMPT_ID = 1;
const TEST_TIMEOUT = { timeout: 3000 };

let seq = 0;
const idFactory = (prefix) => `${prefix}-${++seq}`;

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Races a promise against a finite deadline; fails fast with a labeled error. */
function withDeadline(promise, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`deadline exceeded (${ms}ms): ${label}`)), ms);
  });
  return Promise.race([Promise.resolve(promise), deadline]).finally(() => clearTimeout(timer));
}

/** Authority gate with awaitable entry signal; release is idempotent. */
function makeGate() {
  let releaseFn;
  let markEntered;
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const signal = new Promise((resolve) => { releaseFn = resolve; });
  return {
    entered,
    signal,
    markEntered,
    release() {
      markEntered();
      releaseFn();
    }
  };
}

/**
 * Injected fake observer. Resolves immediately by default (schema-valid
 * minimal capture). `state.hang = true` arms manual release for in-flight
 * scenarios; tests must release in try or finally — never leave it pending.
 */
function makeObserver() {
  const state = { calls: [], hang: false, release: null };
  return {
    state,
    capture() {
      state.calls.push(arguments[0]);
      const result = { frames: [{ id: 'frame-1' }], bytes: 0 };
      if (!state.hang) {
        return Promise.resolve(result);
      }
      return new Promise((resolve) => {
        state.release = () => resolve(result);
      });
    }
  };
}

function makeVerifier() {
  return {
    verify({ token, principalId }) {
      return token === `valid-token:${principalId}`
        ? { valid: true, principalId }
        : { valid: false, reason: 'token_rejected' };
    }
  };
}

function makeHub() {
  const hub = {
    inner: null,
    gate: null,
    evaluateScreenCapture(params, options) {
      const run = async () => {
        if (hub.gate) {
          const g = hub.gate;
          hub.gate = null;
          g.markEntered();
          await g.signal;
        }
        return hub.inner.evaluateScreenCapture(params, options);
      };
      return run();
    }
  };
  return hub;
}

/**
 * Full stack: shared fake clock -> PolicyService + ComputerSession,
 * real OcrComputerAuthorityAdapter (bound to exact principal/session/target/
 * admission) behind an async hub, injected fake observer.
 */
function makeStack({ oneUse = false, consume = false, sessionDisplayId = 0, adapterDisplays = [0] } = {}) {
  let now = T0;
  const clock = () => now;
  const policy = new PolicyService({ clock });
  const admission = createWorkspaceAdmission({
    workspaceId: 'ws-ocr-conformance',
    taskId: TASK_ID,
    attemptId: ATTEMPT_ID,
    canonicalRoot: '/ocr-conformance/snap-1',
    sourceBaselineRoot: '/ocr-conformance/baseline',
    scope: { readPaths: ['src'] },
    admittedAt: now,
    admittedBy: 'coordinator'
  });
  const audit = { events: [], write(event) { this.events.push(event); } };
  const observer = makeObserver();
  const hub = makeHub();
  const core = new ComputerSession({
    clock: { now: () => now },
    tokenVerifier: makeVerifier(),
    authorityPort: hub,
    observer,
    auditSink: audit,
    idFactory
  });

  const started = core.start({
    token: `valid-token:${PRINCIPAL}`,
    principalId: PRINCIPAL,
    targetDisplayId: sessionDisplayId,
    ttlMs: 60_000,
    correlationId: 'corr-w-computer'
  });
  assert.equal(started.ok, true);
  const sid = started.session.sessionId;

  const adapter = new OcrComputerAuthorityAdapter(policy, {
    workspaceAdmission: admission,
    principalId: PRINCIPAL,
    sessionId: sid,
    allowedDisplays: adapterDisplays,
    consumeByDefault: consume,
    oneUseByDefault: oneUse
  });
  hub.inner = adapter;

  const grant = adapter.createObservationGrant({
    principalId: PRINCIPAL,
    sessionId: sid,
    allowedDisplays: adapterDisplays,
    ttlMs: 60_000,
    oneUse
  });

  return {
    core, policy, adapter, observer, audit, admission, grant, hub,
    sid,
    auth: { token: `valid-token:${PRINCIPAL}`, principalId: PRINCIPAL, sessionId: sid },
    advance: (ms) => { now += ms; return now; }
  };
}

test('conformance: admitted principal/session/target/task/attempt delivers through real authority', TEST_TIMEOUT, async () => {
  const s = makeStack();
  const res = await withDeadline(
    s.core.observe({ ...s.auth, correlationId: 'corr-ok' }),
    2000,
    'happy-path observe did not settle'
  );
  assert.equal(res.ok, true);
  assert.equal(s.observer.state.calls.length, 1);
  assert.equal(s.observer.state.calls[0].sessionId, s.sid);
  assert.equal(s.observer.state.calls[0].displayId, 0);
  const delivered = s.audit.events.filter((e) => e.type === 'observation_delivered');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].grantId, s.grant.grantId);
  assert.equal(delivered[0].correlationId, 'corr-ok');
});

test('conformance: one-use consuming grant — second sequential observe denied, zero extra observer effects', TEST_TIMEOUT, async () => {
  const s = makeStack({ oneUse: true, consume: true });
  const first = await withDeadline(s.core.observe(s.auth), 2000, 'first observe did not settle');
  assert.equal(first.ok, true);
  assert.equal(s.observer.state.calls.length, 1);

  const stored = s.policy.getGrant(s.grant.grantId);
  assert.equal(stored.revoked, true);
  assert.equal(stored.revocationReason, 'one_use_consumed');

  const second = await withDeadline(s.core.observe(s.auth), 2000, 'second observe did not settle');
  assert.equal(second.ok, false);
  assert.equal(second.code, SessionErrorCode.AUTHORITY_DENIED);
  assert.equal(second.details.reason, 'request_already_consumed');
  assert.equal(s.observer.state.calls.length, 1);
});

test('conformance: concurrent in-flight observe denied by runtime; one-use grant still consumed exactly once', TEST_TIMEOUT, async () => {
  const s = makeStack({ oneUse: true, consume: true });
  s.observer.state.hang = true;
  try {
    const inflight = s.core.observe({ ...s.auth, correlationId: 'corr-inflight' });
    await withDeadline(tick(), 1000, 'in-flight observe never reached the observer');
    assert.equal(s.observer.state.calls.length, 1);

    const second = await withDeadline(s.core.observe({ ...s.auth, correlationId: 'corr-second' }), 2000, 'second observe did not settle');
    assert.equal(second.ok, false);
    assert.equal(second.code, SessionErrorCode.CONCURRENCY_LIMIT_EXCEEDED);
    assert.equal(s.observer.state.calls.length, 1);

    s.observer.state.release();
    const first = await withDeadline(inflight, 2000, 'in-flight observe did not settle after release');
    assert.equal(first.ok, true);
    assert.equal(s.observer.state.calls.length, 1);

    const third = await withDeadline(s.core.observe(s.auth), 2000, 'third observe did not settle');
    assert.equal(third.ok, false);
    assert.equal(third.details?.reason, 'request_already_consumed');
    assert.equal(s.observer.state.calls.length, 1);
  } finally {
    s.observer.state.hang = false;
    s.observer.state.release?.();
  }
});

test('conformance: expiry during authority await — real adapter denies grant_expired, zero observer effects', TEST_TIMEOUT, async () => {
  const s = makeStack();
  const gate = makeGate();
  s.hub.gate = gate;
  try {
    const pending = s.core.observe({ ...s.auth, correlationId: 'corr-expiry' });
    await withDeadline(gate.entered, 1000, 'authority gate never entered');
    s.advance(120_000);
    gate.release();
    const res = await withDeadline(pending, 2000, 'observe did not settle after gate release');
    assert.equal(res.ok, false);
    assert.equal(res.code, SessionErrorCode.AUTHORITY_DENIED);
    assert.equal(res.details.reason, 'grant_expired');
    assert.equal(s.observer.state.calls.length, 0);
  } finally {
    gate.release();
  }
});

test('conformance: session revoked during authority await — post-await session gate denies, zero observer effects', TEST_TIMEOUT, async () => {
  const s = makeStack();
  const gate = makeGate();
  s.hub.gate = gate;
  try {
    const pending = s.core.observe({ ...s.auth, correlationId: 'corr-revoke' });
    await withDeadline(gate.entered, 1000, 'authority gate never entered');
    const rev = s.core.revoke({ ...s.auth, reason: 'operator' });
    assert.equal(rev.ok, true);
    gate.release();
    const res = await withDeadline(pending, 2000, 'observe did not settle after gate release');
    assert.equal(res.ok, false);
    assert.equal(res.code, SessionErrorCode.SESSION_REVOKED);
    assert.equal(s.observer.state.calls.length, 0);
    assert.equal(s.policy.getGrant(s.grant.grantId).revoked, false);
  } finally {
    gate.release();
  }
});

test('conformance: policy grant revoked during authority await — adapter denies grant_revoked, zero observer effects', TEST_TIMEOUT, async () => {
  const s = makeStack();
  const gate = makeGate();
  s.hub.gate = gate;
  try {
    const pending = s.core.observe({ ...s.auth, correlationId: 'corr-grant-revoke' });
    await withDeadline(gate.entered, 1000, 'authority gate never entered');
    assert.equal(s.policy.revokeSession(s.sid, 'coordinator_revocation'), 1);
    gate.release();
    const res = await withDeadline(pending, 2000, 'observe did not settle after gate release');
    assert.equal(res.ok, false);
    assert.equal(res.code, SessionErrorCode.AUTHORITY_DENIED);
    assert.equal(res.details.reason, 'grant_revoked');
    assert.equal(s.observer.state.calls.length, 0);
  } finally {
    gate.release();
  }
});

test('conformance: emergency stop denies capture with zero observer effects; grant remains unconsumed', TEST_TIMEOUT, async () => {
  const s = makeStack();
  const stop = s.core.emergencyStop({ ...s.auth, reason: 'operator_stop' });
  assert.equal(stop.ok, true);
  const res = await withDeadline(s.core.observe(s.auth), 2000, 'observe after stop did not settle');
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.SESSION_STOPPED);
  assert.equal(s.observer.state.calls.length, 0);
  const stored = s.policy.getGrant(s.grant.grantId);
  assert.equal(stored.revoked, false);
});

test('conformance: unadmitted target display — real adapter denies target_outside_grant_scope, zero observer effects', TEST_TIMEOUT, async () => {
  const s = makeStack({ sessionDisplayId: 1, adapterDisplays: [0] });
  const res = await withDeadline(s.core.observe({ ...s.auth, displayId: 1 }), 2000, 'observe did not settle');
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.AUTHORITY_DENIED);
  assert.equal(res.details.reason, 'target_outside_grant_scope');
  assert.equal(s.observer.state.calls.length, 0);
});

test('conformance: adapter identity confinement — principal/session/task/attempt mismatches fail closed', TEST_TIMEOUT, () => {
  const s = makeStack();
  const base = { displayId: 0, frames: 1 };

  const wrongPrincipal = s.adapter.evaluateScreenCapture({
    ...base, principalId: 'eve', sessionId: s.sid
  });
  assert.equal(wrongPrincipal.allowed, false);
  assert.equal(wrongPrincipal.reason, 'principal_mismatch');

  const wrongSession = s.adapter.evaluateScreenCapture({
    ...base, principalId: PRINCIPAL, sessionId: 'csession-forged'
  });
  assert.equal(wrongSession.allowed, false);
  assert.equal(wrongSession.reason, 'session_mismatch');

  const wrongTask = s.adapter.evaluateScreenCapture({
    ...base, principalId: PRINCIPAL, sessionId: s.sid, taskId: 'W9-OTHER'
  });
  assert.equal(wrongTask.allowed, false);
  assert.equal(wrongTask.reason, 'unadmitted_session');

  const wrongAttempt = s.adapter.evaluateScreenCapture({
    ...base, principalId: PRINCIPAL, sessionId: s.sid, attemptId: 99
  });
  assert.equal(wrongAttempt.allowed, false);
  assert.equal(wrongAttempt.reason, 'unadmitted_session');
});
