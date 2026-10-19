import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectComputerPage,
  RUN_STATES,
  PAGE_LIFECYCLES,
  WORKER_REPORT_OUTCOMES,
  STALE_AFTER_MS,
  MAX_EVIDENCE_REFS_LIMIT
} from './projection.js';
import {
  createSessionViewModel,
  reduceSessionEvent,
  SESSION_EVENT_TYPES
} from './model.js';

const NOW = 20000;
const RUN_BASE = {
  taskId: 'task-1',
  runId: 'run-1',
  conversationId: 'conv-1',
  workerId: 'worker-1',
  workspaceId: 'ws-1',
  sessionId: 'sess-1',
  targetId: 'screen-1',
  authorityId: 'auth-1',
  observationId: 'obs-1',
  state: 'running',
  simulation: false,
  sequence: 5,
  timestamp: 10000,
  expiry: 100000
};
const SESSION_BASE = {
  sessionId: 'sess-1',
  targetId: 'screen-1',
  sequence: 3,
  timestamp: 10000,
  expiry: 100000,
  authorityGranted: true,
  observationOnly: false,
  simulation: false,
  nativeAccess: false,
  status: 'observing',
  actingTargetId: null,
  captureIndicator: false
};

function run(overrides = {}) {
  return { ...RUN_BASE, ...overrides };
}

function session(overrides = {}) {
  return { ...SESSION_BASE, ...overrides };
}

const UPDATE_IDENTITY = {
  taskId: 'task-1',
  runId: 'run-1',
  conversationId: 'conv-1',
  workerId: 'worker-1',
  workspaceId: 'ws-1',
  sessionId: 'sess-1',
  targetId: 'screen-1',
  authorityId: 'auth-1',
  observationId: 'obs-1'
};

function statusUpdate(runState, overrides = {}) {
  return { sequence: 6, timestamp: 15000, kind: 'run_status', runState, ...UPDATE_IDENTITY, ...overrides };
}

function reportUpdate(outcome, overrides = {}) {
  return {
    sequence: 6,
    timestamp: 15000,
    kind: 'worker_report',
    workerReport: { outcome },
    ...UPDATE_IDENTITY,
    ...overrides
  };
}

function verifyUpdate(verified, evidenceRefs, overrides = {}) {
  const verification = { verified };
  if (evidenceRefs !== undefined) {
    verification.evidenceRefs = evidenceRefs;
  }
  return { sequence: 6, timestamp: 15000, kind: 'verification', verification, ...UPDATE_IDENTITY, ...overrides };
}

function project(input, now = NOW) {
  return projectComputerPage(input, { now });
}

test('valid observing projection: frozen page, fixed keys, permissions, freshness, identity', () => {
  const r = project({ run: run(), session: session() });
  assert.equal(r.ok, true);
  const page = r.page;
  assert.equal(page.lifecycle, PAGE_LIFECYCLES.OBSERVING);
  assert.equal(page.subtext, 'Observing target');
  assert.equal(page.simulation, false);
  assert.deepEqual(page.permissions, {
    observe: true,
    control: false,
    requestControl: true,
    stop: true,
    escape: true
  });
  assert.deepEqual(page.freshness, { status: 'fresh', ageMs: 10000, asOf: NOW });
  assert.equal(page.stopAvailable, true);
  assert.equal(page.escapeAvailable, true);
  assert.deepEqual([...page.evidenceRefs], []);
  assert.deepEqual({ ...page.identity }, {
    taskId: 'task-1',
    runId: 'run-1',
    conversationId: 'conv-1',
    workerId: 'worker-1',
    workspaceId: 'ws-1',
    sessionId: 'sess-1',
    targetId: 'screen-1',
    authorityId: 'auth-1',
    observationId: 'obs-1'
  });
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(page));
  assert.ok(Object.isFrozen(page.permissions));
  assert.ok(Object.isFrozen(page.freshness));
  assert.ok(Object.isFrozen(page.identity));
  assert.ok(Object.isFrozen(page.evidenceRefs));
});

test('all eleven lifecycles are projected distinctly', () => {
  const cases = [
    [PAGE_LIFECYCLES.REQUESTED, { run: run({ state: RUN_STATES.REQUESTED }), session: session({ status: 'off' }) }],
    [PAGE_LIFECYCLES.ADMITTED, { run: run({ state: RUN_STATES.ADMITTED }), session: session({ status: 'off' }) }],
    [PAGE_LIFECYCLES.OBSERVING, { run: run({ state: RUN_STATES.RUNNING }), session: session({ status: 'observing' }) }],
    [PAGE_LIFECYCLES.ACTING, {
      run: run({ state: RUN_STATES.RUNNING }),
      session: session({ status: 'acting', actingTargetId: 'screen-1', captureIndicator: true })
    }],
    [PAGE_LIFECYCLES.PAUSED, { run: run({ state: RUN_STATES.PAUSED }), session: session({ status: 'paused' }) }],
    [PAGE_LIFECYCLES.STOPPED, { run: run({ state: RUN_STATES.STOPPED }), session: session({ status: 'stopped' }) }],
    [PAGE_LIFECYCLES.CANCELLED, { run: run({ state: RUN_STATES.CANCELLED }), session: session({ status: 'off' }) }],
    [PAGE_LIFECYCLES.DISCONNECTED, { run: run({ state: RUN_STATES.DISCONNECTED }), session: session({ status: 'off' }) }],
    [PAGE_LIFECYCLES.UNCERTAIN, {
      run: run({ state: RUN_STATES.RUNNING }),
      session: session({ status: 'observing' }),
      update: reportUpdate(WORKER_REPORT_OUTCOMES.COMPLETED)
    }],
    [PAGE_LIFECYCLES.FAILED, { run: run({ state: RUN_STATES.FAILED }), session: session({ status: 'off' }) }],
    [PAGE_LIFECYCLES.VERIFIED_COMPLETION, {
      run: run({ state: RUN_STATES.COMPLETED, completion: { kind: 'verified', evidenceRefs: ['ev/1'] } }),
      session: session({ status: 'off' })
    }]
  ];
  const seen = new Set();
  for (const [expected, input] of cases) {
    const r = project(input);
    assert.equal(r.ok, true, `expected ok for ${expected}: ${r.ok === false ? r.errors.join('; ') : ''}`);
    assert.equal(r.page.lifecycle, expected);
    seen.add(r.page.lifecycle);
  }
  assert.equal(cases.length, Object.keys(PAGE_LIFECYCLES).length);
  assert.deepEqual([...seen].sort(), Object.values(PAGE_LIFECYCLES).sort());
});

test('worker self-report and run-status completion cannot create verified completion', () => {
  const viaUpdate = project({
    run: run({ state: RUN_STATES.RUNNING }),
    session: session({ status: 'observing' }),
    update: reportUpdate(WORKER_REPORT_OUTCOMES.COMPLETED)
  });
  assert.equal(viaUpdate.ok, true);
  assert.equal(viaUpdate.page.lifecycle, PAGE_LIFECYCLES.UNCERTAIN);
  assert.equal(viaUpdate.page.subtext, 'Worker reported completion; not independently verified');
  assert.deepEqual([...viaUpdate.page.evidenceRefs], []);
  assert.equal(viaUpdate.page.stopAvailable, true, 'uncertain-but-active run can still be stopped');
  assert.equal(viaUpdate.page.escapeAvailable, true);

  const viaRunCompletion = project({
    run: run({ state: RUN_STATES.COMPLETED, completion: { kind: 'worker_reported' } }),
    session: session({ status: 'observing' })
  });
  assert.equal(viaRunCompletion.ok, true);
  assert.equal(viaRunCompletion.page.lifecycle, PAGE_LIFECYCLES.UNCERTAIN);
  assert.equal(viaRunCompletion.page.subtext, 'Worker reported completion; not independently verified');
  assert.deepEqual([...viaRunCompletion.page.evidenceRefs], []);

  const viaStatus = project({
    run: run({ state: RUN_STATES.RUNNING }),
    session: session({ status: 'observing' }),
    update: statusUpdate(RUN_STATES.COMPLETED)
  });
  assert.equal(viaStatus.ok, true);
  assert.equal(viaStatus.page.lifecycle, PAGE_LIFECYCLES.UNCERTAIN);
  assert.equal(viaStatus.page.subtext, 'State uncertain');
  assert.deepEqual([...viaStatus.page.evidenceRefs], []);

  for (const outcome of [WORKER_REPORT_OUTCOMES.FAILED, WORKER_REPORT_OUTCOMES.ABORTED]) {
    const failed = project({
      run: run({ state: RUN_STATES.RUNNING }),
      session: session({ status: 'observing' }),
      update: reportUpdate(outcome)
    });
    assert.equal(failed.ok, true, `outcome ${outcome} must project`);
    assert.equal(failed.page.lifecycle, PAGE_LIFECYCLES.FAILED);
    assert.equal(failed.page.subtext, 'Failed');
  }
});

test('verification with evidence reaches verified_completion; rejected verification does not', () => {
  const verified = project({
    run: run({ state: RUN_STATES.RUNNING }),
    session: session({ status: 'observing' }),
    update: verifyUpdate(true, ['ev/proof-1', 'ev/proof-2'])
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.page.lifecycle, PAGE_LIFECYCLES.VERIFIED_COMPLETION);
  assert.equal(verified.page.subtext, 'Completed (verified)');
  assert.deepEqual([...verified.page.evidenceRefs], ['ev/proof-1', 'ev/proof-2']);
  assert.equal(verified.page.stopAvailable, false);
  assert.equal(verified.page.escapeAvailable, true);
  assert.ok(Object.isFrozen(verified.page.evidenceRefs));

  const rejected = project({
    run: run({ state: RUN_STATES.RUNNING }),
    session: session({ status: 'observing' }),
    update: verifyUpdate(false, ['ev/1'])
  });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.page.lifecycle, PAGE_LIFECYCLES.FAILED);
  assert.equal(rejected.page.subtext, 'Failed');
  assert.deepEqual([...rejected.page.evidenceRefs], [], 'rejected verification carries no evidence');
  assert.equal(rejected.page.stopAvailable, false);
});

test('terminal run/session state beats verification (stopped, cancelled, failed, disconnected)', () => {
  const stoppedRun = project({
    run: run({ state: RUN_STATES.STOPPED }),
    session: session({ status: 'off' }),
    update: verifyUpdate(true, ['ev/1'])
  });
  assert.equal(stoppedRun.ok, true, stoppedRun.ok === false ? stoppedRun.errors.join('; ') : '');
  assert.equal(stoppedRun.page.lifecycle, PAGE_LIFECYCLES.STOPPED, 'stopped run cannot become verified_completion');
  assert.equal(stoppedRun.page.subtext, 'Stopped');
  assert.deepEqual([...stoppedRun.page.evidenceRefs], []);
  assert.equal(stoppedRun.page.stopAvailable, false);
  assert.equal(stoppedRun.page.escapeAvailable, true);

  const stoppedWithCompletionField = project({
    run: run({ state: RUN_STATES.STOPPED, completion: { kind: 'verified', evidenceRefs: ['ev/1'] } }),
    session: session({ status: 'stopped' })
  });
  assert.equal(stoppedWithCompletionField.ok, true, stoppedWithCompletionField.ok === false ? stoppedWithCompletionField.errors.join('; ') : '');
  assert.equal(stoppedWithCompletionField.page.lifecycle, PAGE_LIFECYCLES.STOPPED, 'verified completion field loses to stopped state');
  assert.deepEqual([...stoppedWithCompletionField.page.evidenceRefs], []);

  const cancelledRun = project({
    run: run({ state: RUN_STATES.CANCELLED }),
    session: session({ status: 'off' }),
    update: verifyUpdate(true, ['ev/1'])
  });
  assert.equal(cancelledRun.ok, true, cancelledRun.ok === false ? cancelledRun.errors.join('; ') : '');
  assert.equal(cancelledRun.page.lifecycle, PAGE_LIFECYCLES.CANCELLED, 'cancelled run cannot become verified_completion');
  assert.equal(cancelledRun.page.subtext, 'Cancelled');
  assert.deepEqual([...cancelledRun.page.evidenceRefs], []);
  assert.equal(cancelledRun.page.stopAvailable, false);

  const failedRun = project({
    run: run({ state: RUN_STATES.FAILED, completion: { kind: 'verified', evidenceRefs: ['ev/1'] } }),
    session: session({ status: 'off' })
  });
  assert.equal(failedRun.ok, true, failedRun.ok === false ? failedRun.errors.join('; ') : '');
  assert.equal(failedRun.page.lifecycle, PAGE_LIFECYCLES.FAILED, 'failed run cannot become verified_completion');
  assert.equal(failedRun.page.subtext, 'Failed');
  assert.deepEqual([...failedRun.page.evidenceRefs], []);

  const stoppedSession = project({
    run: run({ state: RUN_STATES.RUNNING }),
    session: session({ status: 'stopped' }),
    update: verifyUpdate(true, ['ev/1'])
  });
  assert.equal(stoppedSession.ok, true, stoppedSession.ok === false ? stoppedSession.errors.join('; ') : '');
  assert.equal(stoppedSession.page.lifecycle, PAGE_LIFECYCLES.STOPPED, 'stopped session cannot become verified_completion');
  assert.deepEqual([...stoppedSession.page.evidenceRefs], []);
  assert.equal(stoppedSession.page.stopAvailable, false);

  const disconnectedSession = project({
    run: run({ state: RUN_STATES.RUNNING }),
    session: session({ status: 'disconnected' }),
    update: verifyUpdate(true, ['ev/1'])
  });
  assert.equal(disconnectedSession.ok, true, disconnectedSession.ok === false ? disconnectedSession.errors.join('; ') : '');
  assert.equal(disconnectedSession.page.lifecycle, PAGE_LIFECYCLES.DISCONNECTED, 'disconnected session cannot become verified_completion');
  assert.deepEqual([...disconnectedSession.page.evidenceRefs], []);
  assert.equal(disconnectedSession.page.escapeAvailable, true);

  const disconnectedRun = project({
    run: run({ state: RUN_STATES.DISCONNECTED, completion: { kind: 'verified', evidenceRefs: ['ev/1'] } }),
    session: session({ status: 'off' })
  });
  assert.equal(disconnectedRun.ok, true, disconnectedRun.ok === false ? disconnectedRun.errors.join('; ') : '');
  assert.equal(disconnectedRun.page.lifecycle, PAGE_LIFECYCLES.DISCONNECTED, 'disconnected run cannot become verified_completion');
  assert.deepEqual([...disconnectedRun.page.evidenceRefs], []);

  const workerReportOnTerminalRun = project({
    run: run({ state: RUN_STATES.CANCELLED }),
    session: session({ status: 'off' }),
    update: reportUpdate(WORKER_REPORT_OUTCOMES.COMPLETED)
  });
  assert.equal(workerReportOnTerminalRun.ok, true);
  assert.notEqual(workerReportOnTerminalRun.page.lifecycle, PAGE_LIFECYCLES.VERIFIED_COMPLETION);
  assert.deepEqual([...workerReportOnTerminalRun.page.evidenceRefs], [], 'worker reports never carry evidence');

  const stillVerifiesWhenActive = project({
    run: run({ state: RUN_STATES.RUNNING }),
    session: session({ status: 'observing' }),
    update: verifyUpdate(true, ['ev/active'])
  });
  assert.equal(stillVerifiesWhenActive.ok, true);
  assert.equal(stillVerifiesWhenActive.page.lifecycle, PAGE_LIFECYCLES.VERIFIED_COMPLETION, 'non-terminal run still verifies');
  assert.deepEqual([...stillVerifiesWhenActive.page.evidenceRefs], ['ev/active']);
});

test('identity binding: session and target must match the run', () => {
  const wrongSession = project({ run: run(), session: session({ sessionId: 'sess-2' }) });
  assert.equal(wrongSession.ok, false);
  assert.ok(wrongSession.errors.some(e => e.includes('sessionId mismatch')));

  const wrongTarget = project({ run: run(), session: session({ targetId: 'screen-2' }) });
  assert.equal(wrongTarget.ok, false);
  assert.ok(wrongTarget.errors.some(e => e.includes('targetId mismatch')));

  const badRunId = project({ run: run({ observationId: 'bad id!' }), session: session() });
  assert.equal(badRunId.ok, false);
  assert.ok(badRunId.errors.some(e => e.includes('run.observationId must be a string matching')));

  const good = project({ run: run(), session: session() });
  assert.equal(good.ok, true);
  assert.deepEqual(Object.keys(good.page.identity), [
    'taskId', 'runId', 'conversationId', 'workerId', 'workspaceId',
    'sessionId', 'targetId', 'authorityId', 'observationId'
  ]);
  assert.equal(good.page.identity.sessionId, 'sess-1');
  assert.equal(good.page.identity.targetId, 'screen-1');
});

test('every update must carry and exactly match all nine bound identities', () => {
  const good = project({ run: run(), session: session(), update: statusUpdate(RUN_STATES.RUNNING) });
  assert.equal(good.ok, true, good.ok === false ? good.errors.join('; ') : '');
  assert.equal(good.page.lifecycle, PAGE_LIFECYCLES.OBSERVING);

  const idKeys = [
    'taskId', 'runId', 'conversationId', 'workerId', 'workspaceId',
    'sessionId', 'targetId', 'authorityId', 'observationId'
  ];
  for (const key of idKeys) {
    const missing = { ...statusUpdate(RUN_STATES.RUNNING) };
    delete missing[key];
    const r = project({ run: run(), session: session(), update: missing });
    assert.equal(r.ok, false, `update without ${key} must be rejected`);
    assert.ok(r.errors.some(e => e.includes(`update.${key} is required`)), `missing-${key} error absent: ${r.errors.join('; ')}`);
    assert.equal('page' in r, false, 'a rejected update must never project a page (rejected before state change)');
  }

  const mismatchedRunId = project({
    run: run(),
    session: session(),
    update: statusUpdate(RUN_STATES.RUNNING, { runId: 'run-2' })
  });
  assert.equal(mismatchedRunId.ok, false);
  assert.ok(mismatchedRunId.errors.some(e => e.includes("update.runId 'run-2' does not match run.runId 'run-1'")));
  assert.equal('page' in mismatchedRunId, false);

  const mismatchedSessionId = project({
    run: run(),
    session: session(),
    update: verifyUpdate(true, ['ev/1'], { sessionId: 'sess-2' })
  });
  assert.equal(mismatchedSessionId.ok, false);
  assert.ok(mismatchedSessionId.errors.some(e => e.includes("update.sessionId 'sess-2' does not match run.sessionId 'sess-1'")));
  assert.equal('page' in mismatchedSessionId, false, 'mismatched identity is rejected before any state change');

  const mismatchedObservation = project({
    run: run(),
    session: session(),
    update: reportUpdate(WORKER_REPORT_OUTCOMES.COMPLETED, { observationId: 'obs-2' })
  });
  assert.equal(mismatchedObservation.ok, false);
  assert.ok(mismatchedObservation.errors.some(e => e.includes("update.observationId 'obs-2' does not match run.observationId 'obs-1'")));

  const badFormat = project({
    run: run(),
    session: session(),
    update: statusUpdate(RUN_STATES.RUNNING, { workerId: 'bad id' })
  });
  assert.equal(badFormat.ok, false);
  assert.ok(badFormat.errors.some(e => e.includes('update.workerId must be a string matching')));

  const nonString = project({
    run: run(),
    session: session(),
    update: statusUpdate(RUN_STATES.RUNNING, { taskId: 7 })
  });
  assert.equal(nonString.ok, false);
  assert.ok(nonString.errors.some(e => e.includes('update.taskId must be a string matching')));

  for (const r of [good, mismatchedRunId, mismatchedSessionId, mismatchedObservation]) {
    assert.ok(Object.isFrozen(r));
    assert.ok(Object.isFrozen(r.errors));
  }
});

test('stale, future, expired and non-monotonic updates are rejected', () => {
  const stale = project({
    run: run(),
    session: session(),
    update: statusUpdate(RUN_STATES.PAUSED, { timestamp: 9999 })
  });
  assert.equal(stale.ok, false);
  assert.ok(stale.errors.some(e => e.includes('stale (older than run.timestamp')));

  const future = project({
    run: run(),
    session: session(),
    update: statusUpdate(RUN_STATES.PAUSED, { timestamp: NOW + 1 })
  });
  assert.equal(future.ok, false);
  assert.ok(future.errors.some(e => e.includes('beyond now')));

  const nonMonotonicEqual = project({
    run: run(),
    session: session(),
    update: statusUpdate(RUN_STATES.PAUSED, { sequence: 5 })
  });
  assert.equal(nonMonotonicEqual.ok, false);
  assert.ok(nonMonotonicEqual.errors.some(e => e.includes('must be greater than run.sequence')));

  const nonMonotonicBehind = project({
    run: run(),
    session: session(),
    update: statusUpdate(RUN_STATES.PAUSED, { sequence: 4 })
  });
  assert.equal(nonMonotonicBehind.ok, false);
  assert.ok(nonMonotonicBehind.errors.some(e => e.includes('must be greater than run.sequence')));

  const atExpiry = project({
    run: run({ expiry: 15000 }),
    session: session({ expiry: 15000 }),
    update: statusUpdate(RUN_STATES.PAUSED, { timestamp: 15000 })
  });
  assert.equal(atExpiry.ok, false);
  assert.ok(atExpiry.errors.some(e => e.includes('at or after run expiry')));

  const fractional = project({
    run: run(),
    session: session(),
    update: statusUpdate(RUN_STATES.PAUSED, { timestamp: 1.5 })
  });
  assert.equal(fractional.ok, false);
  assert.ok(fractional.errors.some(e => e.includes('update.timestamp must be a positive finite epoch ms integer')));

  const futureRun = project({ run: run({ timestamp: NOW + 1 }), session: session() });
  assert.equal(futureRun.ok, false);
  assert.ok(futureRun.errors.some(e => e.includes('run.timestamp') && e.includes('beyond now')));

  for (const r of [stale, future, nonMonotonicEqual, nonMonotonicBehind, atExpiry, fractional, futureRun]) {
    assert.ok(Object.isFrozen(r.errors));
    assert.ok(Object.isFrozen(r));
  }
});

test('expired runs and expired sessions project uncertainty with expired freshness and no Stop', () => {
  const r = project({ run: run({ expiry: 15000 }), session: session({ expiry: 15000 }) });
  assert.equal(r.ok, true);
  assert.equal(r.page.lifecycle, PAGE_LIFECYCLES.UNCERTAIN);
  assert.equal(r.page.subtext, 'Session expired; state uncertain');
  assert.equal(r.page.freshness.status, 'expired');
  assert.equal(r.page.stopAvailable, false);
  assert.equal(r.page.escapeAvailable, true);
  assert.deepEqual(r.page.permissions, {
    observe: false,
    control: false,
    requestControl: false,
    stop: false,
    escape: true
  });

  const sessExpired = project({ run: run(), session: session({ status: 'expired' }) });
  assert.equal(sessExpired.ok, true);
  assert.equal(sessExpired.page.lifecycle, PAGE_LIFECYCLES.UNCERTAIN);
  assert.equal(sessExpired.page.freshness.status, 'expired');
  assert.equal(sessExpired.page.stopAvailable, false);

  const expiredButVerified = project({
    run: run({ expiry: 15000, state: RUN_STATES.COMPLETED, completion: { kind: 'verified', evidenceRefs: ['ev/1'] } }),
    session: session({ expiry: 15000 })
  });
  assert.equal(expiredButVerified.ok, true);
  assert.equal(expiredButVerified.page.lifecycle, PAGE_LIFECYCLES.UNCERTAIN, 'expiry beats verification');
  assert.equal(expiredButVerified.page.subtext, 'Session expired; state uncertain');
  assert.deepEqual([...expiredButVerified.page.evidenceRefs], [], 'no evidence exposed when verification does not apply');
  assert.equal(expiredButVerified.page.freshness.status, 'expired');
  assert.equal(expiredButVerified.page.stopAvailable, false);
  assert.equal(expiredButVerified.page.escapeAvailable, true);

  const expiredSessionVerification = project({
    run: run(),
    session: session({ status: 'expired' }),
    update: verifyUpdate(true, ['ev/1'])
  });
  assert.equal(expiredSessionVerification.ok, true, expiredSessionVerification.ok === false ? expiredSessionVerification.errors.join('; ') : '');
  assert.equal(expiredSessionVerification.page.lifecycle, PAGE_LIFECYCLES.UNCERTAIN, 'expired session beats a verification update');
  assert.equal(expiredSessionVerification.page.subtext, 'Session expired; state uncertain');
  assert.deepEqual([...expiredSessionVerification.page.evidenceRefs], []);
  assert.equal(expiredSessionVerification.page.stopAvailable, false);
});

test('malformed, unknown-field and bad-option inputs are rejected with frozen errors', () => {
  const cases = [
    [{ run: { ...run(), prompt: 'do a thing' }, session: session() }, "unknown field 'prompt' is not allowed"],
    [{ run: run(), session: { ...session(), nativeAccess: true } }, 'session must be a valid computer session view model'],
    [{ run: run(), session: session(), update: null }, 'update must be a plain object'],
    [{ run: run(), session: session(), update: statusUpdate(RUN_STATES.RUNNING, { extra: 1 }) }, "update: unknown field 'extra' is not allowed"],
    [{ run: run(), session: session(), update: { sequence: 6, timestamp: 15000, kind: 'nonsense' } }, 'update.kind must be one of'],
    [{ run: run(), session: session(), update: statusUpdate(RUN_STATES.RUNNING, { workerReport: { outcome: 'completed' } }) }, 'run_status updates must not carry workerReport or verification'],
    [{ run: run(), session: session(), update: reportUpdate('nonsense') }, 'update.workerReport.outcome must be one of'],
    [{ run: run(), session: session(), meta: 1 }, "input: unknown field 'meta' is not allowed"],
    [{ run: { ...run(), state: 'weird' }, session: session() }, 'run.state must be one of'],
    [{ run: { ...run(), taskId: 'bad id!' }, session: session() }, 'run.taskId must be a string matching'],
    [{ run: { ...run(), sequence: 1.5 }, session: session() }, 'run.sequence must be a non-negative safe integer'],
    [{ run: { ...run(), simulation: 'yes' }, session: session() }, 'run.simulation must be a boolean']
  ];
  for (const [input, needle] of cases) {
    const r = project(input);
    assert.equal(r.ok, false, `expected rejection for: ${needle}`);
    assert.ok(r.errors.some(e => e.includes(needle)), `missing '${needle}' in: ${r.errors.join('; ')}`);
    assert.ok(Object.isFrozen(r.errors));
    assert.ok(Object.isFrozen(r));
  }

  const nullInput = projectComputerPage(null, { now: NOW });
  assert.equal(nullInput.ok, false);
  assert.ok(nullInput.errors.some(e => e.includes('input must be a plain object')));

  const nullOptions = projectComputerPage({ run: run(), session: session() }, null);
  assert.equal(nullOptions.ok, false);
  assert.ok(nullOptions.errors.some(e => e.includes('options must be a plain object')));

  const empty = projectComputerPage(undefined, { now: NOW });
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.some(e => e.includes('run must be a plain object')));

  const noNow = projectComputerPage({ run: run(), session: session() });
  assert.equal(noNow.ok, false);
  assert.ok(noNow.errors.some(e => e.includes('options.now must be')));

  const badOption = projectComputerPage({ run: run(), session: session() }, { now: NOW, clock: 1 });
  assert.equal(badOption.ok, false);
  assert.ok(badOption.errors.some(e => e.includes("unknown option 'clock'")));
});

test('authority-growing claimed permissions are rejected; equal or lesser claims pass', () => {
  const growControl = project({
    run: run(),
    session: session({ status: 'observing' }),
    update: statusUpdate(RUN_STATES.RUNNING, { claimedPermissions: { observe: true, control: true } })
  });
  assert.equal(growControl.ok, false);
  assert.ok(growControl.errors.some(e => e.includes('claimedPermissions.control exceeds derived permissions')));

  const growRequest = project({
    run: run(),
    session: session({ status: 'acting', actingTargetId: 'screen-1', captureIndicator: true }),
    update: statusUpdate(RUN_STATES.RUNNING, { claimedPermissions: { requestControl: true } })
  });
  assert.equal(growRequest.ok, false);
  assert.ok(growRequest.errors.some(e => e.includes('claimedPermissions.requestControl exceeds derived permissions')));

  const growEscapeOnRun = project({
    run: run({ state: RUN_STATES.CANCELLED }),
    session: session({ status: 'off' }),
    update: statusUpdate(RUN_STATES.CANCELLED, { claimedPermissions: { stop: true } })
  });
  assert.equal(growEscapeOnRun.ok, false);
  assert.ok(growEscapeOnRun.errors.some(e => e.includes('claimedPermissions.stop exceeds derived permissions')));

  const observeClaims = project({
    run: run(),
    session: session({ status: 'observing' }),
    update: statusUpdate(RUN_STATES.RUNNING, {
      claimedPermissions: { observe: true, requestControl: true, stop: true, escape: true }
    })
  });
  assert.equal(observeClaims.ok, true, observeClaims.ok === false ? observeClaims.errors.join('; ') : '');

  const actingClaims = project({
    run: run(),
    session: session({ status: 'acting', actingTargetId: 'screen-1', captureIndicator: true }),
    update: statusUpdate(RUN_STATES.RUNNING, {
      claimedPermissions: { observe: true, control: true, stop: true, escape: true }
    })
  });
  assert.equal(actingClaims.ok, true, actingClaims.ok === false ? actingClaims.errors.join('; ') : '');

  const underClaim = project({
    run: run(),
    session: session(),
    update: statusUpdate(RUN_STATES.RUNNING, { claimedPermissions: { observe: false, control: false } })
  });
  assert.equal(underClaim.ok, true, 'under-claiming never grows authority');

  const obsOnly = project({ run: run(), session: session({ observationOnly: true, status: 'observing' }) });
  assert.equal(obsOnly.ok, true);
  assert.equal(obsOnly.page.permissions.observe, true);
  assert.equal(obsOnly.page.permissions.requestControl, false);

  const obsOnlyClaim = project({
    run: run(),
    session: session({ observationOnly: true, status: 'observing' }),
    update: statusUpdate(RUN_STATES.RUNNING, { claimedPermissions: { requestControl: true } })
  });
  assert.equal(obsOnlyClaim.ok, false);
  assert.ok(obsOnlyClaim.errors.some(e => e.includes('claimedPermissions.requestControl exceeds derived permissions')));

  const nonBoolean = project({
    run: run(),
    session: session(),
    update: statusUpdate(RUN_STATES.RUNNING, { claimedPermissions: { observe: 'yes' } })
  });
  assert.equal(nonBoolean.ok, false);
  assert.ok(nonBoolean.errors.some(e => e.includes('claimedPermissions.observe must be a boolean')));

  const unknownClaim = project({
    run: run(),
    session: session(),
    update: statusUpdate(RUN_STATES.RUNNING, { claimedPermissions: { root: true } })
  });
  assert.equal(unknownClaim.ok, false);
  assert.ok(unknownClaim.errors.some(e => e.includes("unknown field 'root'")));
});

test('evidence refs are bounded and only accepted on verified completion', () => {
  const emptyRefs = project({
    run: run(),
    session: session(),
    update: verifyUpdate(true, [])
  });
  assert.equal(emptyRefs.ok, false);
  assert.ok(emptyRefs.errors.some(e => e.includes('requires at least one evidenceRef')));

  const tooMany = project({
    run: run(),
    session: session(),
    update: verifyUpdate(true, Array.from({ length: MAX_EVIDENCE_REFS_LIMIT + 1 }, (_, i) => `ev/${i}`))
  });
  assert.equal(tooMany.ok, false);
  assert.ok(tooMany.errors.some(e => e.includes(`at most ${MAX_EVIDENCE_REFS_LIMIT} entries`)));

  const badRef = project({
    run: run(),
    session: session(),
    update: verifyUpdate(true, ['bad ref'])
  });
  assert.equal(badRef.ok, false);
  assert.ok(badRef.errors.some(e => e.includes('bounded reference string')));

  const runVerified = project({
    run: run({ state: RUN_STATES.COMPLETED, completion: { kind: 'verified', evidenceRefs: ['ev/task-1'] } }),
    session: session()
  });
  assert.equal(runVerified.ok, true);
  assert.equal(runVerified.page.lifecycle, PAGE_LIFECYCLES.VERIFIED_COMPLETION);
  assert.deepEqual([...runVerified.page.evidenceRefs], ['ev/task-1']);

  const runVerifiedEmpty = project({
    run: run({ state: RUN_STATES.COMPLETED, completion: { kind: 'verified', evidenceRefs: [] } }),
    session: session()
  });
  assert.equal(runVerifiedEmpty.ok, false);
  assert.ok(runVerifiedEmpty.errors.some(e => e.includes('requires at least one evidenceRef')));

  const selfReportRefs = project({
    run: run({ state: RUN_STATES.COMPLETED, completion: { kind: 'worker_reported', evidenceRefs: ['ev/task-1'] } }),
    session: session()
  });
  assert.equal(selfReportRefs.ok, false);
  assert.ok(selfReportRefs.errors.some(e => e.includes('only accepted on verified completion')));

  const unknownCompletion = project({
    run: run({ completion: { kind: 'assumed' } }),
    session: session()
  });
  assert.equal(unknownCompletion.ok, false);
  assert.ok(unknownCompletion.errors.some(e => e.includes("run.completion.kind must be 'verified' or 'worker_reported'")));

  const missingRefs = project({
    run: run({ completion: { kind: 'verified' } }),
    session: session()
  });
  assert.equal(missingRefs.ok, false);
  assert.ok(missingRefs.errors.some(e => e.includes('run.completion.evidenceRefs must be an array')));
});

test('freshness reports fresh, stale and expired from the injected clock', () => {
  const fresh = project({ run: run(), session: session() }, 10000 + STALE_AFTER_MS);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.page.freshness.status, 'fresh');
  assert.equal(fresh.page.freshness.ageMs, STALE_AFTER_MS);
  assert.equal(fresh.page.freshness.asOf, 10000 + STALE_AFTER_MS);

  const stale = project({ run: run(), session: session() }, 10000 + STALE_AFTER_MS + 1);
  assert.equal(stale.ok, true);
  assert.equal(stale.page.freshness.status, 'stale');
  assert.equal(stale.page.freshness.ageMs, STALE_AFTER_MS + 1);
  assert.equal(stale.page.lifecycle, PAGE_LIFECYCLES.OBSERVING, 'staleness alone does not change lifecycle');
  assert.equal(stale.page.stopAvailable, true);

  const expired = project({ run: run(), session: session() }, 100000);
  assert.equal(expired.ok, true);
  assert.equal(expired.page.freshness.status, 'expired');
  assert.equal(expired.page.freshness.ageMs, 90000);
  assert.equal(expired.page.lifecycle, PAGE_LIFECYCLES.UNCERTAIN);
});

test('Stop is available only while the run is active and non-terminal; Escape is always available', () => {
  const observing = project({ run: run({ state: RUN_STATES.RUNNING }), session: session({ status: 'observing' }) });
  assert.equal(observing.ok, true);
  assert.equal(observing.page.stopAvailable, true);
  assert.equal(observing.page.escapeAvailable, true);

  const paused = project({ run: run({ state: RUN_STATES.PAUSED }), session: session({ status: 'paused' }) });
  assert.equal(paused.ok, true);
  assert.equal(paused.page.stopAvailable, true);
  assert.equal(paused.page.escapeAvailable, true);

  const terminal = [
    [run({ state: RUN_STATES.STOPPED }), session({ status: 'stopped' })],
    [run({ state: RUN_STATES.CANCELLED }), session({ status: 'off' })],
    [run({ state: RUN_STATES.FAILED }), session({ status: 'off' })],
    [run({ state: RUN_STATES.COMPLETED, completion: { kind: 'verified', evidenceRefs: ['ev/1'] } }), session({ status: 'off' })],
    [run({ expiry: 15000 }), session({ expiry: 15000 })]
  ];
  for (const [r, s] of terminal) {
    const res = project({ run: r, session: s });
    assert.equal(res.ok, true, res.ok === false ? res.errors.join('; ') : '');
    assert.equal(res.page.stopAvailable, false, `stop must be unavailable for lifecycle ${res.page.lifecycle}`);
    assert.equal(res.page.escapeAvailable, true, `escape must stay available for lifecycle ${res.page.lifecycle}`);
  }

  const disconnected = project({
    run: run({ state: RUN_STATES.DISCONNECTED }),
    session: session({ status: 'disconnected' })
  });
  assert.equal(disconnected.ok, true);
  assert.equal(disconnected.page.lifecycle, PAGE_LIFECYCLES.DISCONNECTED);
  assert.equal(disconnected.page.escapeAvailable, true);

  const uncertain = project({
    run: run({ state: RUN_STATES.RUNNING }),
    session: session({ status: 'observing' }),
    update: reportUpdate(WORKER_REPORT_OUTCOMES.COMPLETED)
  });
  assert.equal(uncertain.ok, true);
  assert.equal(uncertain.page.stopAvailable, true, 'an uncertain but active run can still be stopped');
  assert.equal(uncertain.page.escapeAvailable, true);
});

test('projection exposes only the fixed output key set and fixed-string subtexts', () => {
  const r = project({ run: run(), session: session() });
  assert.deepEqual(Object.keys(r.page), [
    'lifecycle', 'simulation', 'subtext', 'permissions', 'freshness',
    'stopAvailable', 'escapeAvailable', 'evidenceRefs', 'identity'
  ]);

  const forbiddenKeys = [
    'prompt', 'prompts', 'typedContent', 'input', 'secret', 'secrets',
    'screenshot', 'screenshots', 'reasoning', 'privateReasoning',
    'clipboard', 'nativeAccess', 'captureIndicator', 'actingTargetId'
  ];
  for (const key of forbiddenKeys) {
    assert.equal(key in r.page, false, `page must not expose '${key}'`);
  }

  const allowedSubtexts = new Set([
    'Worker requested a session',
    'Worker requested a session (simulated)',
    'Control requested; awaiting authority',
    'Run admitted; observation not started',
    'Run admitted (simulated); observation not started',
    'Observing target',
    'Observing target (simulated run)',
    'Control active (contract view; no native access claimed)',
    'Control active (simulated only)',
    'Paused',
    'Stopped',
    'Cancelled',
    'Disconnected; access cleared',
    'Session expired; state uncertain',
    'Worker reported completion; not independently verified',
    'State uncertain',
    'Failed',
    'Completed (verified)'
  ]);

  const subtextCases = [
    [{ run: run({ state: 'requested' }), session: session({ status: 'off' }) }, 'Worker requested a session'],
    [{ run: run({ state: 'requested', simulation: true }), session: session({ status: 'off', simulation: true }) }, 'Worker requested a session (simulated)'],
    [{ run: run({ state: 'running' }), session: session({ status: 'requesting_control' }) }, 'Control requested; awaiting authority'],
    [{ run: run({ state: 'admitted' }), session: session({ status: 'off' }) }, 'Run admitted; observation not started'],
    [{ run: run({ state: 'admitted', simulation: true }), session: session({ status: 'off', simulation: true }) }, 'Run admitted (simulated); observation not started'],
    [{ run: run({ state: 'running' }), session: session({ status: 'observing' }) }, 'Observing target'],
    [{ run: run({ state: 'running', simulation: true }), session: session({ status: 'observing', simulation: true }) }, 'Observing target (simulated run)'],
    [{ run: run({ state: 'running' }), session: session({ status: 'acting', actingTargetId: 'screen-1', captureIndicator: true }) }, 'Control active (contract view; no native access claimed)'],
    [{ run: run({ state: 'running', simulation: true }), session: session({ status: 'acting', actingTargetId: 'screen-1', captureIndicator: true, simulation: true }) }, 'Control active (simulated only)'],
    [{ run: run({ state: 'paused' }), session: session({ status: 'paused' }) }, 'Paused'],
    [{ run: run({ state: 'stopped' }), session: session({ status: 'stopped' }) }, 'Stopped'],
    [{ run: run({ state: 'cancelled' }), session: session({ status: 'off' }) }, 'Cancelled'],
    [{ run: run({ state: 'disconnected' }), session: session({ status: 'off' }) }, 'Disconnected; access cleared'],
    [{ run: run({ expiry: 15000 }), session: session({ expiry: 15000 }) }, 'Session expired; state uncertain'],
    [{ run: run({ state: 'running' }), session: session({ status: 'observing' }), update: reportUpdate('completed') }, 'Worker reported completion; not independently verified'],
    [{ run: run({ state: 'failed' }), session: session({ status: 'off' }) }, 'Failed'],
    [{ run: run({ state: 'completed', completion: { kind: 'verified', evidenceRefs: ['ev/1'] } }), session: session({ status: 'off' }) }, 'Completed (verified)'],
    [{ run: run({ state: 'uncertain' }), session: session({ status: 'off' }) }, 'State uncertain']
  ];

  const emitted = new Set();
  for (const [input, expected] of subtextCases) {
    const res = project(input);
    assert.equal(res.ok, true, `expected ok for subtext '${expected}': ${res.ok === false ? res.errors.join('; ') : ''}`);
    assert.equal(res.page.subtext, expected);
    assert.ok(allowedSubtexts.has(res.page.subtext), `subtext not in fixed set: ${res.page.subtext}`);
    assert.equal(/[{}]/.test(res.page.subtext), false, 'subtext must not contain interpolations');
    emitted.add(res.page.subtext);
  }
  assert.equal(emitted.size, allowedSubtexts.size, 'every fixed-string subtext is reachable');
});

test('projection composes with the session event reducer', () => {
  const created = createSessionViewModel({
    sessionId: 'sess-1',
    targetId: 'screen-1',
    sequence: 0,
    timestamp: 1000,
    expiry: 100000,
    authorityGranted: true,
    observationOnly: false
  });
  const observed = reduceSessionEvent(
    created,
    { type: SESSION_EVENT_TYPES.OBSERVATION_STARTED, sessionId: 'sess-1', targetId: 'screen-1', sequence: 1, timestamp: 1000 },
    { now: NOW }
  );
  assert.equal(observed.ok, true);

  const projectingObs = project({ run: run({ state: 'running' }), session: observed.model });
  assert.equal(projectingObs.ok, true, projectingObs.ok === false ? projectingObs.errors.join('; ') : '');
  assert.equal(projectingObs.page.lifecycle, PAGE_LIFECYCLES.OBSERVING);
  assert.equal(projectingObs.page.permissions.observe, true);
  assert.equal(projectingObs.page.permissions.control, false);

  const requested = reduceSessionEvent(
    observed.model,
    { type: SESSION_EVENT_TYPES.CONTROL_REQUESTED, sessionId: 'sess-1', targetId: 'screen-1', sequence: 2, timestamp: 2000 },
    { now: NOW }
  );
  assert.equal(requested.ok, true);

  const granted = reduceSessionEvent(
    requested.model,
    { type: SESSION_EVENT_TYPES.CONTROL_GRANTED, sessionId: 'sess-1', targetId: 'screen-1', sequence: 3, timestamp: 3000, authorityGranted: true },
    { now: NOW }
  );
  assert.equal(granted.ok, true);

  const acting = project({ run: run({ state: 'running' }), session: granted.model });
  assert.equal(acting.ok, true, acting.ok === false ? acting.errors.join('; ') : '');
  assert.equal(acting.page.lifecycle, PAGE_LIFECYCLES.ACTING);
  assert.equal(acting.page.permissions.control, true);
  assert.equal(acting.page.permissions.observe, true);
  assert.equal(granted.model.nativeAccess, false);

  const down = reduceSessionEvent(
    granted.model,
    { type: SESSION_EVENT_TYPES.DISCONNECTED, sessionId: 'sess-1', targetId: 'screen-1', sequence: 4, timestamp: 4000 },
    { now: NOW }
  );
  assert.equal(down.ok, true);

  const disconnected = project({ run: run({ state: 'running' }), session: down.model });
  assert.equal(disconnected.ok, true, disconnected.ok === false ? disconnected.errors.join('; ') : '');
  assert.equal(disconnected.page.lifecycle, PAGE_LIFECYCLES.DISCONNECTED);
  assert.equal(disconnected.page.permissions.observe, false, 'disconnect clears observing access in the page too');
  assert.equal(disconnected.page.permissions.control, false);
  assert.equal(disconnected.page.escapeAvailable, true);
});

test('every success and failure result is frozen', () => {
  const ok = project({ run: run(), session: session() });
  assert.ok(Object.isFrozen(ok));
  assert.ok(Object.isFrozen(ok.page));
  assert.ok(Object.isFrozen(ok.page.permissions));
  assert.ok(Object.isFrozen(ok.page.freshness));
  assert.ok(Object.isFrozen(ok.page.identity));
  assert.ok(Object.isFrozen(ok.page.evidenceRefs));
  assert.deepEqual(Object.keys(ok), ['ok', 'page']);

  const bad = project({
    run: run(),
    session: session(),
    update: statusUpdate('running', { timestamp: 1 })
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad), ['ok', 'errors']);
  assert.ok(Object.isFrozen(bad));
  assert.ok(Object.isFrozen(bad.errors));
  assert.equal(bad.errors.some(e => e.includes('stale')), true);
});
