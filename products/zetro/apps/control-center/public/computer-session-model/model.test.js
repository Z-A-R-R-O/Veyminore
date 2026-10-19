import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionViewModel,
  reduceSessionEvent,
  isSessionViewModel,
  SESSION_STATES,
  SESSION_EVENT_TYPES,
  ModelContractError
} from './model.js';

const fakeClock = { now: 1000 };
const BASE = {
  sessionId: 'sess-1',
  targetId: 'screen-1',
  sequence: 0,
  timestamp: 1000,
  expiry: 100000,
  authorityGranted: true,
  observationOnly: false
};

function ev(type, sequence, timestamp, extra = {}) {
  return {
    type,
    sessionId: 'sess-1',
    targetId: 'screen-1',
    sequence,
    timestamp,
    ...extra
  };
}

function reduce(model, event, options) {
  return reduceSessionEvent(model, event, options);
}

test('create: valid model defaults, frozen, never native', () => {
  const model = createSessionViewModel(BASE);
  assert.equal(model.status, SESSION_STATES.OFF);
  assert.equal(model.simulation, false);
  assert.equal(model.nativeAccess, false);
  assert.equal(model.actingTargetId, null);
  assert.equal(model.captureIndicator, false);
  assert.ok(Object.isFrozen(model));
  assert.ok(isSessionViewModel(model));
});

test('create: strict booleans, ids, bounds, unknown fields rejected', () => {
  assert.throws(() => createSessionViewModel({ ...BASE, authorityGranted: 'true' }), ModelContractError);
  assert.throws(() => createSessionViewModel({ ...BASE, observationOnly: 1 }), ModelContractError);
  assert.throws(() => createSessionViewModel({ ...BASE, simulation: 'no' }), ModelContractError);
  assert.throws(() => createSessionViewModel({ ...BASE, sessionId: 'has space' }), ModelContractError);
  assert.throws(() => createSessionViewModel({ ...BASE, sequence: -1 }), ModelContractError);
  assert.throws(() => createSessionViewModel({ ...BASE, sequence: 1.5 }), ModelContractError);
  assert.throws(() => createSessionViewModel({ ...BASE, timestamp: Number.NaN }), ModelContractError);
  assert.throws(() => createSessionViewModel({ ...BASE, nativeAccess: true }), ModelContractError);
  assert.throws(() => createSessionViewModel({ ...BASE, status: 'acting' }), ModelContractError);
  try {
    createSessionViewModel({ ...BASE, bogus: 1 });
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof ModelContractError);
    assert.ok(err.errors.some(e => e.includes("unknown field 'bogus'")));
  }
});

test('create: initial timestamp at/after expiry yields expired and cleared', () => {
  const model = createSessionViewModel({ ...BASE, timestamp: 100000 });
  assert.equal(model.status, SESSION_STATES.EXPIRED);
  assert.equal(model.actingTargetId, null);
  assert.equal(model.captureIndicator, false);
  assert.equal(model.authorityGranted, false);
});

test('lifecycle with fake clock: observe, request, grant, pause, resume, revoke', () => {
  const start = createSessionViewModel(BASE);
  let m = start;

  let r = reduce(m, ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 1, fakeClock.now));
  assert.equal(r.ok, true);
  m = r.model;
  assert.equal(m.status, SESSION_STATES.OBSERVING);
  assert.equal(m.captureIndicator, true);

  r = reduce(m, ev(SESSION_EVENT_TYPES.CONTROL_REQUESTED, 2, 1010));
  assert.equal(r.ok, true);
  m = r.model;
  assert.equal(m.status, SESSION_STATES.REQUESTING_CONTROL);

  r = reduce(m, ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 3, 1020, { authorityGranted: true }));
  assert.equal(r.ok, true);
  m = r.model;
  assert.equal(m.status, SESSION_STATES.ACTING);
  assert.equal(m.actingTargetId, 'screen-1');
  assert.equal(m.authorityGranted, true);
  assert.equal(m.nativeAccess, false);

  r = reduce(m, ev(SESSION_EVENT_TYPES.SESSION_PAUSED, 4, 1030));
  assert.equal(r.ok, true);
  m = r.model;
  assert.equal(m.status, SESSION_STATES.PAUSED);
  assert.equal(m.actingTargetId, 'screen-1', 'pause keeps acting pointer (only expiry/revoke/stop clear it)');

  r = reduce(m, ev(SESSION_EVENT_TYPES.SESSION_RESUMED, 5, 1040));
  assert.equal(r.ok, true);
  m = r.model;
  assert.equal(m.status, SESSION_STATES.ACTING);

  r = reduce(m, ev(SESSION_EVENT_TYPES.AUTHORITY_REVOKED, 6, 1050, { authorityGranted: false }));
  assert.equal(r.ok, true);
  m = r.model;
  assert.equal(m.status, SESSION_STATES.OBSERVING);
  assert.equal(m.actingTargetId, null, 'revoke removes acting pointer');
  assert.equal(m.captureIndicator, false, 'revoke removes capture indicator');
  assert.equal(m.authorityGranted, false);
  assert.equal(m.nativeAccess, false);
});

test('control grant needs explicit authority input, never derived from a button press', () => {
  const observing = reduce(
    createSessionViewModel(BASE),
    ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 1, 1000)
  ).model;
  const requesting = reduce(
    observing,
    ev(SESSION_EVENT_TYPES.CONTROL_REQUESTED, 2, 1010)
  ).model;

  let r = reduce(requesting, ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 3, 1020));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('explicit boolean authorityGranted')));

  r = reduce(requesting, ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 3, 1020, { authorityGranted: false }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('never derived from a button press')));

  r = reduce(
    requesting,
    ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 3, 1020, { authorityGranted: true, buttonPressed: true })
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes("unknown field 'buttonPressed'")));

  const noAuthority = createSessionViewModel({ ...BASE, authorityGranted: false });
  const obs2 = reduce(noAuthority, ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 1, 1000)).model;
  r = reduce(obs2, ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 2, 1010, { authorityGranted: true }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('configuration does not allow authority')));

  assert.equal(requesting.nativeAccess, false);
});

test('observation-only session rejects control request and grant', () => {
  const model = createSessionViewModel({ ...BASE, observationOnly: true });
  const observing = reduce(model, ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 1, 1000)).model;

  let r = reduce(observing, ev(SESSION_EVENT_TYPES.CONTROL_REQUESTED, 2, 1010));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('observation-only')));

  r = reduce(observing, ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 2, 1010, { authorityGranted: true }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('observation-only')));
});

test('stale, future, non-monotonic and bad clock inputs are rejected', () => {
  const m0 = createSessionViewModel(BASE);
  const m1 = reduce(m0, ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 5, 1000)).model;

  let r = reduce(m1, ev(SESSION_EVENT_TYPES.SESSION_PAUSED, 5, 1010));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('not greater than current')));

  r = reduce(m1, ev(SESSION_EVENT_TYPES.SESSION_PAUSED, 4, 1010));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('not greater than current')));

  r = reduce(m1, ev(SESSION_EVENT_TYPES.SESSION_PAUSED, 6, 900));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('older than current')));

  r = reduce(m1, ev(SESSION_EVENT_TYPES.SESSION_PAUSED, 6, 2000), { now: 1500 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('beyond the supplied now')));

  r = reduce(m1, ev(SESSION_EVENT_TYPES.SESSION_PAUSED, 6, 2000), { now: 'not-a-clock' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('now must be')));

  r = reduce(m1, ev(SESSION_EVENT_TYPES.SESSION_PAUSED, 6, 2000), { clock: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes("unknown option 'clock'")));

  r = reduce(m1, { type: 'nonsense', sessionId: 'sess-1', targetId: 'screen-1', sequence: 6, timestamp: 1100 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('event.type must be one of')));

  r = reduce(m1, null);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('plain object')));

  r = reduce({}, ev(SESSION_EVENT_TYPES.SESSION_PAUSED, 6, 1100));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('valid session view model')));
});

test('exact session and target matching is enforced', () => {
  const m = reduce(createSessionViewModel(BASE), ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 1, 1000)).model;

  let r = reduce(m, ev(SESSION_EVENT_TYPES.SESSION_PAUSED, 2, 1100, { sessionId: 'sess-2' }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('sessionId mismatch')));

  r = reduce(m, ev(SESSION_EVENT_TYPES.SESSION_PAUSED, 2, 1100, { targetId: 'screen-2' }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('targetId mismatch')));
});

test('expiry, revoke and stop each remove acting pointer and capture indicator', () => {
  const observing = reduce(
    createSessionViewModel(BASE),
    ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 1, 1000)
  ).model;
  const requesting = reduce(
    observing,
    ev(SESSION_EVENT_TYPES.CONTROL_REQUESTED, 2, 1010)
  ).model;
  const acting = reduce(
    requesting,
    ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 3, 1020, { authorityGranted: true })
  ).model;
  assert.equal(acting.actingTargetId, 'screen-1');

  const stoppedR = reduce(acting, ev(SESSION_EVENT_TYPES.SESSION_STOPPED, 4, 1030));
  assert.equal(stoppedR.ok, true);
  assert.equal(stoppedR.model.status, SESSION_STATES.STOPPED);
  assert.equal(stoppedR.model.actingTargetId, null);
  assert.equal(stoppedR.model.captureIndicator, false);

  const again = reduce(stoppedR.model, ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 5, 1040));
  assert.equal(again.ok, false);
  assert.ok(again.errors.some(e => e.includes('terminal')));

  const acting2 = reduce(
    reduce(
      reduce(
        createSessionViewModel(BASE),
        ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 1, 1000)
      ).model,
      ev(SESSION_EVENT_TYPES.CONTROL_REQUESTED, 2, 1010)
    ).model,
    ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 3, 1020, { authorityGranted: true })
  ).model;

  const expiredR = reduce(acting2, ev(SESSION_EVENT_TYPES.SESSION_EXPIRED, 4, 1030));
  assert.equal(expiredR.ok, true);
  assert.equal(expiredR.model.status, SESSION_STATES.EXPIRED);
  assert.equal(expiredR.model.actingTargetId, null);
  assert.equal(expiredR.model.captureIndicator, false);
  assert.equal(expiredR.model.authorityGranted, false);

  const pastExpiry = reduce(
    createSessionViewModel({ ...BASE, timestamp: 90000 }),
    ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 1, 100000)
  );
  assert.equal(pastExpiry.ok, true);
  assert.equal(pastExpiry.model.status, SESSION_STATES.EXPIRED);
  assert.equal(pastExpiry.model.actingTargetId, null);
  assert.equal(pastExpiry.model.captureIndicator, false);
});

test('disconnect clears pointer, capture and authority; restore lands in off', () => {
  const observing = reduce(
    createSessionViewModel(BASE),
    ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 1, 1000)
  ).model;
  const acting = reduce(
    reduce(observing, ev(SESSION_EVENT_TYPES.CONTROL_REQUESTED, 2, 1010)).model,
    ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 3, 1020, { authorityGranted: true })
  ).model;

  const down = reduce(acting, ev(SESSION_EVENT_TYPES.DISCONNECTED, 4, 1030));
  assert.equal(down.ok, true);
  assert.equal(down.model.status, SESSION_STATES.DISCONNECTED);
  assert.equal(down.model.actingTargetId, null, 'disconnect removes acting pointer');
  assert.equal(down.model.captureIndicator, false, 'disconnect removes active capture indicator');
  assert.equal(down.model.authorityGranted, false);
  assert.equal(down.model.nativeAccess, false);

  const up = reduce(down.model, ev(SESSION_EVENT_TYPES.CONNECTION_RESTORED, 5, 1040));
  assert.equal(up.ok, true);
  assert.equal(up.model.status, SESSION_STATES.OFF, 'restore does not auto-restore observing access');
  assert.equal(up.model.captureIndicator, false);
  assert.equal(up.model.authorityGranted, false, 'restore does not auto-restore grant');
  assert.equal(up.model.actingTargetId, null);

  const autoGrant = reduce(up.model, ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 6, 1050, { authorityGranted: true }));
  assert.equal(autoGrant.ok, false, 'no control from off without observing first');
  assert.ok(autoGrant.errors.some(e => e.includes('not allowed in state')));

  const observed = reduce(up.model, ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 6, 1050));
  assert.equal(observed.ok, true);
  assert.equal(observed.model.status, SESSION_STATES.OBSERVING);

  const staleAuthority = reduce(
    observed.model,
    ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 7, 1060, { authorityGranted: true })
  );
  assert.equal(staleAuthority.ok, false, 'grant authority cleared by disconnect cannot self-restore');
  assert.ok(staleAuthority.errors.some(e => e.includes('configuration does not allow authority')));

  const freshAuthority = reduce(
    observed.model,
    ev(SESSION_EVENT_TYPES.AUTHORITY_RESTORED, 7, 1060, { authorityGranted: true })
  );
  assert.equal(freshAuthority.ok, true);
  assert.equal(freshAuthority.model.authorityGranted, true);
  assert.equal(freshAuthority.model.status, SESSION_STATES.OBSERVING);
  assert.equal(freshAuthority.model.nativeAccess, false);

  const requested = reduce(freshAuthority.model, ev(SESSION_EVENT_TYPES.CONTROL_REQUESTED, 8, 1070));
  assert.equal(requested.ok, true);
  const reGranted = reduce(
    requested.model,
    ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 9, 1080, { authorityGranted: true })
  );
  assert.equal(reGranted.ok, true);
  assert.equal(reGranted.model.status, SESSION_STATES.ACTING);
  assert.equal(reGranted.model.nativeAccess, false);
});

test('expiry-on-restore, stale events and unknown events in disconnected state', () => {
  const observing = reduce(
    createSessionViewModel(BASE),
    ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 1, 1000)
  ).model;
  const down = reduce(observing, ev(SESSION_EVENT_TYPES.DISCONNECTED, 2, 1010));
  assert.equal(down.ok, true);
  assert.equal(down.model.status, SESSION_STATES.DISCONNECTED);
  assert.equal(down.model.captureIndicator, false);

  const staleTs = reduce(down.model, ev(SESSION_EVENT_TYPES.CONNECTION_RESTORED, 3, 900));
  assert.equal(staleTs.ok, false);
  assert.ok(staleTs.errors.some(e => e.includes('older than current')));
  assert.equal(staleTs.model, down.model);

  const staleSeq = reduce(down.model, ev(SESSION_EVENT_TYPES.CONNECTION_RESTORED, 2, 1020));
  assert.equal(staleSeq.ok, false);
  assert.ok(staleSeq.errors.some(e => e.includes('not greater than current')));

  const unknown = reduce(down.model, ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 3, 1020));
  assert.equal(unknown.ok, false, 'disallowed event in disconnected leaves explicit state untouched');
  assert.equal(unknown.model, down.model);
  assert.equal(unknown.model.status, SESSION_STATES.DISCONNECTED);
  assert.equal(unknown.model.captureIndicator, false);
  assert.equal(unknown.model.actingTargetId, null);

  const expiring = reduce(down.model, ev(SESSION_EVENT_TYPES.CONNECTION_RESTORED, 3, 100000));
  assert.equal(expiring.ok, true, 'restore at/after expiry applies expiry');
  assert.equal(expiring.model.status, SESSION_STATES.EXPIRED);
  assert.equal(expiring.model.actingTargetId, null);
  assert.equal(expiring.model.captureIndicator, false);
  assert.equal(expiring.model.authorityGranted, false);

  const after = reduce(expiring.model, ev(SESSION_EVENT_TYPES.CONNECTION_RESTORED, 4, 100001));
  assert.equal(after.ok, false);
  assert.ok(after.errors.some(e => e.includes('terminal')));
});

test('simulation flag stays separate from native access', () => {
  const model = createSessionViewModel({ ...BASE, simulation: true });
  assert.equal(model.simulation, true);
  assert.equal(model.nativeAccess, false);

  const acting = reduce(
    reduce(model, ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 1, 1000)).model,
    ev(SESSION_EVENT_TYPES.CONTROL_REQUESTED, 2, 1010)
  ).model;
  const granted = reduce(
    acting,
    ev(SESSION_EVENT_TYPES.CONTROL_GRANTED, 3, 1020, { authorityGranted: true })
  );
  assert.equal(granted.ok, true);
  assert.equal(granted.model.simulation, true);
  assert.equal(granted.model.nativeAccess, false, 'access is never derived from events or presses');
  assert.equal(granted.model.status, SESSION_STATES.ACTING);
});

test('reduced models are frozen and results carry frozen errors', () => {
  const m = reduce(createSessionViewModel(BASE), ev(SESSION_EVENT_TYPES.OBSERVATION_STARTED, 1, 1000));
  assert.ok(Object.isFrozen(m.model));
  const bad = reduce(m.model, ev(SESSION_EVENT_TYPES.SESSION_PAUSED, 1, 1100));
  assert.equal(bad.ok, false);
  assert.ok(Object.isFrozen(bad.errors));
  assert.equal(bad.model, m.model, 'rejected events return the unchanged model');
});
