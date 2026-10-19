/**
 * @file session.test.js
 * OCR-2 ComputerSession lifecycle tests (dependency-free, node:test).
 *
 * STATUS: NOT RUN — shell unavailable in the OCR-2 worker pass.
 * Coordinator command: node --test packages/computer-runtime/test/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ComputerSession,
  SessionErrorCode,
  AuditEventType
} from '../src/index.js';

/** Deterministic manual clock fixture. */
function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms) { t += ms; return t; },
    set(ms) { t = ms; return t; }
  };
}

/** Token verifier fixture: only token 'valid-token:<principalId>' verifies. */
function makeVerifier() {
  return {
    verify({ token, principalId }) {
      if (typeof token === 'string' && token === `valid-token:${principalId}`) {
        return { valid: true, principalId, claims: { role: 'principal' } };
      }
      return { valid: false, reason: 'token_rejected' };
    }
  };
}

/** Authority port fixture with controllable decisions. */
function makeAuthority() {
  const state = { allowed: true, reason: null, calls: [] };
  return {
    state,
    evaluateScreenCapture(params) {
      state.calls.push(params);
      return state.allowed
        ? { allowed: true, grantId: 'grant-fixture' }
        : { allowed: false, reason: state.reason ?? 'denied_by_policy' };
    }
  };
}

/** Observer fixture; never invoked unless authority + gates pass. */
function makeObserver(overrides = {}) {
  const state = { calls: [] };
  return {
    state,
    async capture(args) {
      state.calls.push(args);
      if (overrides.hang) {
        return overrides.hang(args);
      }
      if (overrides.reject) {
        throw new Error(overrides.reject);
      }
      return { frames: [{ id: 'frame-1' }], bytes: 64 };
    }
  };
}

function makeAudit() {
  const events = [];
  return { events, write(e) { events.push(e); } };
}

function makeValidation(verdict = { valid: true }) {
  const calls = [];
  return {
    calls,
    validate(op, payload) { calls.push({ op, payload }); return verdict; }
  };
}

let seq = 0;
const idFactory = (prefix) => `${prefix}-${++seq}`;

function makeCore({ limits, validationPort, observer } = {}) {
  const clock = makeClock();
  const audit = makeAudit();
  const authority = makeAuthority();
  const obs = observer ?? makeObserver();
  const core = new ComputerSession({
    clock,
    tokenVerifier: makeVerifier(),
    authorityPort: authority,
    observer: obs,
    auditSink: audit,
    validationPort,
    idFactory,
    limits
  });
  return { core, clock, audit, authority, observer: obs };
}

function startSession(core, overrides = {}) {
  return core.start({
    token: 'valid-token:alice',
    principalId: 'alice',
    targetDisplayId: 0,
    ttlMs: 60_000,
    correlationId: 'corr-start-1',
    ...overrides
  });
}

test('start: missing principal is denied fail-closed', () => {
  const { core, audit } = makeCore();
  const res = core.start({ token: 'valid-token:alice', principalId: '' });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.MISSING_PRINCIPAL);
  assert.equal(core.getSession('csession-1'), null);
  assert.equal(audit.events[0].type, AuditEventType.OPERATION_DENIED);
});

test('start: missing session ref on status is denied', () => {
  const { core } = makeCore();
  const res = core.status({ token: 'valid-token:alice', principalId: 'alice', sessionId: '' });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.MISSING_SESSION);
});

test('status: unknown session id is denied', () => {
  const { core } = makeCore();
  const res = core.status({ token: 'valid-token:alice', principalId: 'alice', sessionId: 'nope' });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.SESSION_NOT_FOUND);
});

test('invalid token is rejected; worker label alone never verifies', async () => {
  const { core, observer } = makeCore();
  const started = startSession(core);
  assert.equal(started.ok, true);
  const sid = started.session.sessionId;

  const res = core.status({ token: 'forged', principalId: 'alice', sessionId: sid });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.INVALID_TOKEN);

  const obs = await core.observe({ token: 'forged', principalId: 'alice', sessionId: sid });
  assert.equal(obs.ok, false);
  assert.equal(obs.code, SessionErrorCode.INVALID_TOKEN);
  assert.equal(observer.state.calls.length, 0);
});

test('start: missing token is denied', () => {
  const { core } = makeCore();
  const res = core.start({ principalId: 'alice' });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.MISSING_TOKEN);
});

test('observe: expiry boundary — active at expiresAt-1, denied at expiresAt', async () => {
  const { core, clock, observer } = makeCore();
  const started = startSession(core, { ttlMs: 1_000 });
  const sid = started.session.sessionId;
  const expiresAt = started.session.expiresAt;

  clock.set(expiresAt - 1);
  const okRes = await core.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid });
  assert.equal(okRes.ok, true);

  clock.set(expiresAt);
  const denied = await core.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, SessionErrorCode.SESSION_EXPIRED);
  assert.equal(observer.state.calls.length, 1);

  const status = core.status({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid });
  assert.equal(status.ok, true);
  assert.equal(status.state, 'expired');
});

test('observe: expiry rechecked after awaited authority, before observer', async () => {
  const { core, clock } = makeCore();
  const started = startSession(core, { ttlMs: 1_000 });
  const sid = started.session.sessionId;

  const authority = {
    evaluateScreenCapture() {
      clock.advance(2_000);
      return { allowed: true, grantId: 'g' };
    }
  };
  const lateCore = new ComputerSession({
    clock,
    tokenVerifier: makeVerifier(),
    authorityPort: authority,
    observer: makeObserver(),
    auditSink: makeAudit(),
    idFactory
  });
  // Re-bind the same session into lateCore by starting fresh with authority that expires it.
  const started2 = lateCore.start({ token: 'valid-token:alice', principalId: 'alice', ttlMs: 1_000 });
  const res = await lateCore.observe({
    token: 'valid-token:alice',
    principalId: 'alice',
    sessionId: started2.session.sessionId
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.SESSION_EXPIRED);
});

test('observe: revoked session denies; queued observe cancels deterministically on revoke', async () => {
  const { core, observer } = makeCore();
  const started = startSession(core);
  const sid = started.session.sessionId;

  let release;
  const hangObs = makeObserver({
    hang: (args) => new Promise((resolve) => {
      args.signal.onAbort(() => resolve(Promise.reject(new Error('aborted'))));
      release = () => resolve({ frames: [], bytes: 0 });
    })
  });
  const core2 = new ComputerSession({
    clock: makeClock(),
    tokenVerifier: makeVerifier(),
    authorityPort: makeAuthority(),
    observer: hangObs,
    auditSink: makeAudit(),
    idFactory
  });
  const started2 = startSession(core2);
  const sid2 = started2.session.sessionId;

  const queued = core2.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid2 });
  // Authority is now awaited; let it settle so the observation is queued in-flight.
  await new Promise((r) => setImmediate(r));
  const rev = core2.revoke({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid2, reason: 'policy' });
  assert.equal(rev.ok, true);
  assert.equal(rev.state, 'revoked');
  assert.equal(rev.cancelledObservations, 1);

  const obsRes = await queued;
  assert.equal(obsRes.ok, false);
  assert.equal(obsRes.code, SessionErrorCode.OBSERVATION_CANCELLED);
  assert.equal(obsRes.details.reason, SessionErrorCode.SESSION_REVOKED);

  const after = await core2.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid2 });
  assert.equal(after.ok, false);
  assert.equal(after.code, SessionErrorCode.SESSION_REVOKED);
  assert.equal(hangObs.state.calls.length, 1);

  // Revoke of already-revoked session is denied.
  const reRevoke = core2.revoke({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid2 });
  assert.equal(reRevoke.ok, false);
  assert.equal(reRevoke.code, SessionErrorCode.SESSION_REVOKED);

  // Original core fixture untouched observer still works for control.
  assert.equal(observer.state.calls.length, 0);
  void release;
  void sid;
});

test('emergencyStop: stopped session denies status effect and future observes', async () => {
  const { core, observer } = makeCore();
  const started = startSession(core);
  const sid = started.session.sessionId;

  const stop = core.emergencyStop({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid, reason: 'operator' });
  assert.equal(stop.ok, true);
  assert.equal(stop.state, 'stopped');

  const status = core.status({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid });
  assert.equal(status.ok, true);
  assert.equal(status.state, 'stopped');

  const obs = await core.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid });
  assert.equal(obs.ok, false);
  assert.equal(obs.code, SessionErrorCode.SESSION_STOPPED);
  assert.equal(observer.state.calls.length, 0);
});

test('observe: mismatched target display is denied before authority', async () => {
  const { core, authority, observer } = makeCore();
  const started = startSession(core, { targetDisplayId: 1 });
  const sid = started.session.sessionId;

  const res = await core.observe({
    token: 'valid-token:alice',
    principalId: 'alice',
    sessionId: sid,
    displayId: 2
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.TARGET_MISMATCH);
  assert.equal(authority.state.calls.length, 0);
  assert.equal(observer.state.calls.length, 0);
});

test('observe: authority denied is surfaced; observer never runs', async () => {
  const { core, authority, observer } = makeCore();
  authority.state.allowed = false;
  const started = startSession(core);
  const res = await core.observe({
    token: 'valid-token:alice',
    principalId: 'alice',
    sessionId: started.session.sessionId
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.AUTHORITY_DENIED);
  assert.equal(observer.state.calls.length, 0);
});

test('status: principal mismatch against session owner is denied', () => {
  const { core } = makeCore();
  const started = startSession(core);
  const res = core.status({ token: 'valid-token:bob', principalId: 'bob', sessionId: started.session.sessionId });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.PRINCIPAL_MISMATCH);
});

test('audit correlation: one correlationId spans operation and denial events', async () => {
  const { core, audit } = makeCore();
  const started = startSession(core, { correlationId: 'corr-A' });
  const sid = started.session.sessionId;

  await core.observe({ token: 'bad', principalId: 'alice', sessionId: sid, correlationId: 'corr-B' });
  core.revoke({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid, correlationId: 'corr-C' });

  const byCorr = (c) => audit.events.filter((e) => e.correlationId === c);
  assert.equal(byCorr('corr-A')[0].type, AuditEventType.SESSION_STARTED);
  assert.equal(byCorr('corr-B')[0].type, AuditEventType.OPERATION_DENIED);
  assert.equal(byCorr('corr-B')[0].sessionId, sid);
  assert.equal(byCorr('corr-C')[0].type, AuditEventType.SESSION_REVOKED);

  const delivered = await core.observe({
    token: 'valid-token:alice', principalId: 'alice', sessionId: sid, correlationId: 'corr-D'
  });
  assert.equal(delivered.ok, false);
  assert.equal(byCorr('corr-D').length >= 1, true);
});

test('observe: observation limit is enforced (bounded observations)', async () => {
  const { core } = makeCore({ limits: { maxObservationsPerSession: 2 } });
  const started = startSession(core);
  const sid = started.session.sessionId;
  const auth = { token: 'valid-token:alice', principalId: 'alice', sessionId: sid };
  assert.equal((await core.observe(auth)).ok, true);
  assert.equal((await core.observe(auth)).ok, true);
  const third = await core.observe(auth);
  assert.equal(third.ok, false);
  assert.equal(third.code, SessionErrorCode.OBSERVATION_LIMIT_EXCEEDED);
});

test('contract validation port rejects invalid start payloads (OCR-1 port, not duplicated)', () => {
  const validation = makeValidation({ valid: false, errors: ['bad shape'] });
  const { core } = makeCore({ validationPort: validation });
  const res = core.start({ token: 'valid-token:alice', principalId: 'alice' });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.CONTRACT_INVALID);
  assert.equal(validation.calls[0].op, 'session.start');
});

test('regression: negative or non-integer declared bytes are rejected', async () => {
  const obs = (result) => ({
    state: { calls: [] },
    async capture() { return result; }
  });
  const { core: c1 } = makeCore({ observer: obs({ frames: [{ id: 'f', bytes: -5 }], bytes: -5 }) });
  const s1 = startSession(c1);
  const r1 = await c1.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: s1.session.sessionId });
  assert.equal(r1.ok, false);
  assert.equal(r1.code, SessionErrorCode.INVALID_OBSERVATION_SCHEMA);
  assert.equal(r1.details.reason, 'declared_size_not_non_negative_integer');

  const { core: c2 } = makeCore({ observer: obs({ frames: [], bytes: 1.5 }) });
  const s2 = startSession(c2);
  const r2 = await c2.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: s2.session.sessionId });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, SessionErrorCode.INVALID_OBSERVATION_SCHEMA);
});

test('regression: inline unbounded frame.data objects are rejected', async () => {
  const { core } = makeCore({
    observer: {
      state: { calls: [] },
      async capture() { return { frames: [{ data: { blob: 'x' } }], bytes: 0 }; }
    }
  });
  const started = startSession(core);
  const res = await core.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.INVALID_OBSERVATION_SCHEMA);
  assert.equal(res.details.reason, 'unbounded_frame_data');
});

test('regression: frame.data exceeding maxFrameInlineBytes is rejected as unbounded', async () => {
  const { core } = makeCore({
    limits: { maxFrameInlineBytes: 8 },
    observer: {
      state: { calls: [] },
      async capture() { return { frames: [{ data: 'x'.repeat(20) }], bytes: 0 }; }
    }
  });
  const started = startSession(core);
  const res = await core.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.INVALID_OBSERVATION_SCHEMA);
  assert.equal(res.details.reason, 'unbounded_frame_data');
});

test('regression: artifact metadata declared size must match actual content bytes', async () => {
  const { core } = makeCore({
    observer: {
      state: { calls: [] },
      async capture() {
        return { frames: [{ data: new Uint8Array(100), metadata: { bytes: 10 } }], bytes: 10 };
      }
    }
  });
  const started = startSession(core);
  const res = await core.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.INVALID_OBSERVATION_SCHEMA);
  assert.equal(res.details.reason, 'declared_size_mismatch');
  assert.equal(res.details.actual, 100);
});

test('regression: bounds enforce measured content bytes, not declared size', async () => {
  const { core } = makeCore({
    limits: { maxBytesPerObservation: 8 },
    observer: {
      state: { calls: [] },
      async capture() { return { frames: [{ data: new Uint8Array(64) }], bytes: 8 }; }
    }
  });
  const started = startSession(core);
  const res = await core.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.OBSERVER_FAILED);
  assert.equal(res.details.reason, 'observer_exceeded_bounds');
  assert.equal(res.details.actualBytes,
    64 + new TextEncoder().encode(JSON.stringify({})).length);
});

test('regression: quota reserved before await; concurrency max1 allows at most one in flight', async () => {
  const hcore = new ComputerSession({
    clock: makeClock(),
    tokenVerifier: makeVerifier(),
    authorityPort: makeAuthority(),
    observer: {
      state: { calls: [] },
      capture(args) {
        this.state.calls.push(args);
        return new Promise((resolve) => {
          args.signal.onAbort(() => resolve(Promise.reject(new Error('aborted'))));
          resolve.__release = () => resolve({ frames: [], bytes: 0 });
          hangRelease = resolve.__release;
        });
      }
    },
    auditSink: makeAudit(),
    idFactory
  });
  let hangRelease;
  const hs = startSession(hcore);
  const hauth = { token: 'valid-token:alice', principalId: 'alice', sessionId: hs.session.sessionId };

  const first = hcore.observe(hauth);
  await new Promise((r) => setImmediate(r));
  assert.equal(hcore.getSession(hs.session.sessionId).observationCount, 0);

  const second = await hcore.observe(hauth);
  assert.equal(second.ok, false);
  assert.equal(second.code, SessionErrorCode.CONCURRENCY_LIMIT_EXCEEDED);

  hangRelease();
  const firstRes = await first;
  assert.equal(firstRes.ok, true);
  assert.equal(hcore.getSession(hs.session.sessionId).observationCount, 1);

  // The fixture hangs every capture until released; release the third explicitly.
  const thirdPromise = hcore.observe(hauth);
  await new Promise((r) => setImmediate(r));
  hangRelease();
  const third = await thirdPromise;
  assert.equal(third.ok, true);
});

test('regression: async authority allow works; async reject handled; literal allowed-true only', async () => {
  const mk = (authorityPort) => new ComputerSession({
    clock: makeClock(),
    tokenVerifier: makeVerifier(),
    authorityPort,
    observer: makeObserver(),
    auditSink: makeAudit(),
    idFactory
  });

  const allowCore = mk({ evaluateScreenCapture: async () => ({ allowed: true, grantId: 'g-async' }) });
  const s1 = startSession(allowCore);
  const okRes = await allowCore.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: s1.session.sessionId });
  assert.equal(okRes.ok, true);

  const truthyCore = mk({ evaluateScreenCapture: () => ({ allowed: 1 }) });
  const s2 = startSession(truthyCore);
  const truthyRes = await truthyCore.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: s2.session.sessionId });
  assert.equal(truthyRes.ok, false);
  assert.equal(truthyRes.code, SessionErrorCode.AUTHORITY_DENIED);

  const rejectCore = mk({ evaluateScreenCapture: async () => { throw new Error('async-boom'); } });
  const s3 = startSession(rejectCore);
  const rejectRes = await rejectCore.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: s3.session.sessionId });
  assert.equal(rejectRes.ok, false);
  assert.equal(rejectRes.code, SessionErrorCode.AUTHORITY_UNAVAILABLE);
});

test('regression: hung authority port is denied by timeout', async () => {
  const core = new ComputerSession({
    clock: makeClock(),
    tokenVerifier: makeVerifier(),
    authorityPort: { evaluateScreenCapture: () => new Promise(() => {}) },
    observer: makeObserver(),
    auditSink: makeAudit(),
    idFactory,
    limits: { authorityTimeoutMs: 5 }
  });
  const started = startSession(core);
  const res = await core.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.AUTHORITY_TIMEOUT);
});

test('regression: hung observer port is denied by timeout and aborts its signal', async () => {
  let seenSignal = null;
  const core = new ComputerSession({
    clock: makeClock(),
    tokenVerifier: makeVerifier(),
    authorityPort: makeAuthority(),
    observer: {
      state: { calls: [] },
      capture(args) { seenSignal = args.signal; return new Promise(() => {}); }
    },
    auditSink: makeAudit(),
    idFactory,
    limits: { observerTimeoutMs: 5 }
  });
  const started = startSession(core);
  const res = await core.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.OBSERVER_TIMEOUT);
  assert.equal(seenSignal.aborted, true);
});

test('regression: revoke during awaited authority still hits the post-await gate', async () => {
  let resolveAuthority;
  const core = new ComputerSession({
    clock: makeClock(),
    tokenVerifier: makeVerifier(),
    authorityPort: {
      evaluateScreenCapture: () => new Promise((resolve) => { resolveAuthority = resolve; })
    },
    observer: makeObserver(),
    auditSink: makeAudit(),
    idFactory
  });
  const started = startSession(core);
  const sid = started.session.sessionId;
  const pending = core.observe({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid });
  await new Promise((r) => setImmediate(r));
  const rev = core.revoke({ token: 'valid-token:alice', principalId: 'alice', sessionId: sid });
  assert.equal(rev.ok, true);
  resolveAuthority({ allowed: true, grantId: 'late' });
  const res = await pending;
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.SESSION_REVOKED);
});

test('regression(prior probe): nested artifact.pixels + metadata.secret cannot bypass maxBytes8', async () => {
  const big = 'x'.repeat(10_000);
  const { core } = makeCore({
    limits: { maxBytesPerObservation: 8 },
    observer: {
      state: { calls: [] },
      async capture() {
        return {
          frames: [{
            id: 'f1',
            data: new Uint8Array(1),
            artifact: { pixels: big },
            metadata: { secret: big }
          }],
          bytes: 0
        };
      }
    }
  });
  const started = startSession(core);
  const res = await core.observe({
    token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.INVALID_OBSERVATION_SCHEMA);
  assert.equal(res.details.reason, 'unknown_frame_field');
  assert.equal(res.details.field, 'artifact');
});

test('regression: unknown nested metadata fields are rejected fail-closed', async () => {
  const big = 'x'.repeat(10_000);
  const { core } = makeCore({
    limits: { maxBytesPerObservation: 8 },
    observer: {
      state: { calls: [] },
      async capture() {
        return { frames: [{ id: 'f1', data: new Uint8Array(1), metadata: { secret: big } }], bytes: 0 };
      }
    }
  });
  const started = startSession(core);
  const res = await core.observe({
    token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.INVALID_OBSERVATION_SCHEMA);
  assert.equal(res.details.reason, 'unknown_metadata_field');
  assert.equal(res.details.field, 'metadata.secret');
});

test('regression: unknown top-level result fields are rejected', async () => {
  const { core } = makeCore({
    observer: {
      state: { calls: [] },
      async capture() { return { frames: [], bytes: 0, debugDump: 'leak' }; }
    }
  });
  const started = startSession(core);
  const res = await core.observe({
    token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.INVALID_OBSERVATION_SCHEMA);
  assert.equal(res.details.reason, 'unknown_result_field');
});

test('regression: whitelisted string fields reject oversized strings', async () => {
  const { core } = makeCore({
    limits: { maxStringFieldBytes: 8 },
    observer: {
      state: { calls: [] },
      async capture() {
        return { frames: [{ id: 'f1', metadata: { format: 'y'.repeat(20) } }], bytes: 0 };
      }
    }
  });
  const started = startSession(core);
  const res = await core.observe({
    token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.INVALID_OBSERVATION_SCHEMA);
  assert.equal(res.details.reason, 'unbounded_string');
});

test('regression: serialized metadata bytes count toward maxBytesPerObservation', async () => {
  const { core } = makeCore({
    limits: { maxBytesPerObservation: 64, maxMetadataBytes: 4096 },
    observer: {
      state: { calls: [] },
      async capture() {
        return { frames: [{ metadata: { format: 'z'.repeat(100) } }], bytes: 0 };
      }
    }
  });
  const started = startSession(core);
  const res = await core.observe({
    token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.OBSERVER_FAILED);
  assert.equal(res.details.reason, 'observer_exceeded_bounds');
  assert.ok(res.details.actualBytes > 100);
});

test('regression: delivered output is sanitized to whitelisted fields only', async () => {
  const { core } = makeCore({
    observer: {
      state: { calls: [] },
      async capture() {
        return {
          frames: [{ id: 'f1', data: new Uint8Array(4), metadata: { format: 'raw', bytes: 4 } }],
          bytes: 4
        };
      }
    }
  });
  const started = startSession(core);
  const res = await core.observe({
    token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId
  });
  assert.equal(res.ok, true);
  // Measured aggregate: data bytes + UTF-8 bytes of serialized sanitized frame
  // (id, metadata, keys). Computed honestly, not hard-coded.
  const expectedBytes = 4 + new TextEncoder().encode(
    JSON.stringify({ id: 'f1', metadata: { format: 'raw', bytes: 4 } })
  ).length;
  assert.equal(res.bytes, expectedBytes);
  assert.deepEqual(Object.keys(res.frames[0]).sort(), ['data', 'id', 'metadata']);
  assert.deepEqual(Object.keys(res.frames[0].metadata).sort(), ['bytes', 'format']);
  assert.equal(res.frames[0].data.length, 4);
});

test('regression: long frame.id is measured and cannot bypass maxBytes', async () => {
  const { core } = makeCore({
    limits: { maxBytesPerObservation: 8 },
    observer: {
      state: { calls: [] },
      async capture() { return { frames: [{ id: 'x'.repeat(100) }], bytes: 0 }; }
    }
  });
  const started = startSession(core);
  const res = await core.observe({
    token: 'valid-token:alice', principalId: 'alice', sessionId: started.session.sessionId
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, SessionErrorCode.OBSERVER_FAILED);
  assert.equal(res.details.reason, 'observer_exceeded_bounds');
  assert.ok(res.details.actualBytes >= 100);
});

test('regression: multibyte content measured as UTF-8 bytes, not char count', async () => {
  const multibyteId = 'é'.repeat(10); // 10 chars, 20 UTF-8 bytes
  const mk = (limit) => makeCore({
    limits: { maxBytesPerObservation: limit },
    observer: {
      state: { calls: [] },
      async capture() { return { frames: [{ id: multibyteId }], bytes: 0 }; }
    }
  });

  const over = mk(15);
  const sOver = startSession(over.core);
  const denied = await over.core.observe({
    token: 'valid-token:alice', principalId: 'alice', sessionId: sOver.session.sessionId
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, SessionErrorCode.OBSERVER_FAILED);
  assert.ok(denied.details.actualBytes >= 20);

  const under = mk(64);
  const sUnder = startSession(under.core);
  const okRes = await under.core.observe({
    token: 'valid-token:alice', principalId: 'alice', sessionId: sUnder.session.sessionId
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.bytes,
    new TextEncoder().encode(JSON.stringify({ id: multibyteId })).length);
});

test('regression: id + metadata + data aggregate enforced and reported consistently', async () => {
  const sampleFrame = () => ({
    id: 'f-123',
    data: new Uint8Array(4),
    metadata: { format: 'raw' }
  });
  const expected = 4 + new TextEncoder().encode(
    JSON.stringify({ id: 'f-123', metadata: { format: 'raw' } })
  ).length;
  const mk = (limit) => makeCore({
    limits: { maxBytesPerObservation: limit },
    observer: {
      state: { calls: [] },
      async capture() { return { frames: [sampleFrame()], bytes: 0 }; }
    }
  });

  const tight = mk(expected - 1);
  const sT = startSession(tight.core);
  const denied = await tight.core.observe({
    token: 'valid-token:alice', principalId: 'alice', sessionId: sT.session.sessionId
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, SessionErrorCode.OBSERVER_FAILED);
  assert.equal(denied.details.actualBytes, expected);

  const roomy = mk(expected);
  const sR = startSession(roomy.core);
  const okRes = await roomy.core.observe({
    token: 'valid-token:alice', principalId: 'alice', sessionId: sR.session.sessionId
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.bytes, expected);
});
