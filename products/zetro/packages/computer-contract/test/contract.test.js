import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ContractValidationError,
  COMPUTER_SCHEMA_VERSIONS,
  validateSessionIdentity,
  isSessionIdentity,
  validateObserveRequest,
  isObserveRequest,
  validateObservationResult,
  isObservationResult,
  validateAuditEvidence,
  isAuditEvidence,
  checkCapability,
  evaluateFreshness,
  computeResultDigest,
  verifyObservation,
  DEFAULT_OBSERVATION_LIMITS,
  createTrustedVerifierPort
} from '../src/index.js';

const T = 1700000000000;
const SHA = 'a'.repeat(64);

const validSession = {
  schemaVersion: COMPUTER_SCHEMA_VERSIONS.SESSION_IDENTITY,
  sessionId: 'sess-1',
  principalId: 'user-42',
  agentId: 'ocr-1',
  role: 'worker',
  issuedAt: T,
  expiresAt: T + 3600000
};

const validRequest = {
  schemaVersion: COMPUTER_SCHEMA_VERSIONS.OBSERVE_REQUEST,
  requestId: 'obs-1',
  sessionId: 'sess-1',
  principalId: 'user-42',
  capability: 'observe',
  target: { targetId: 'screen-1', kind: 'screen' },
  requestedAt: T,
  freshness: { maxAgeMs: 5000 },
  limits: { maxPayloadBytes: 65536 }
};

const validResult = {
  schemaVersion: COMPUTER_SCHEMA_VERSIONS.OBSERVATION_RESULT,
  requestId: 'obs-1',
  sessionId: 'sess-1',
  target: { targetId: 'screen-1', fingerprint: SHA },
  capturedAt: T,
  sequence: 0,
  payload: { sha256: SHA, byteLength: 512, mimeType: 'image/png' },
  observedBy: 'ocr-1'
};

const validEvidence = {
  schemaVersion: COMPUTER_SCHEMA_VERSIONS.AUDIT_EVIDENCE,
  evidenceId: 'ev-1',
  sessionId: 'sess-1',
  requestId: 'obs-1',
  capability: 'observe',
  resultDigest: computeResultDigest(validResult),
  effect: null,
  verification: {
    verified: true,
    status: 'passed',
    verifier: 'verifier-1',
    checksPassed: 4,
    checksFailed: 0,
    checkedAt: T
  },
  createdAt: T
};

const independentVerifierPort = createTrustedVerifierPort('coord-verifier-1', ctx => ({
  authorized: true,
  status: 'passed',
  bindings: {
    requestId: ctx.requestId,
    sessionId: ctx.sessionId,
    resultDigest: ctx.resultDigest
  }
}));

test('positive: valid session identity and guard', () => {
  const session = validateSessionIdentity(validSession);
  assert.equal(session.sessionId, 'sess-1');
  assert.equal(isSessionIdentity(validSession), true);
  assert.equal(isSessionIdentity({ ...validSession, role: 'root' }), false);
});

test('negative: malformed session identity (bad expiry, unknown field)', () => {
  const res = validateSessionIdentity(
    { ...validSession, expiresAt: T, bogus: 1 },
    { throwOnError: false }
  );
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => e.includes('expiresAt')));
  assert.ok(res.errors.some(e => e.includes("unknown field 'bogus'")));
  assert.throws(
    () => validateSessionIdentity(null),
    err => err instanceof ContractValidationError && err.name === 'ContractValidationError'
  );
});

test('positive: valid observe request bound to session/principal', () => {
  const request = validateObserveRequest(validRequest, { session: validSession });
  assert.equal(request.requestId, 'obs-1');
  assert.equal(isObserveRequest(validRequest), true);
});

test('negative: strict malformed observe request', () => {
  const res = validateObserveRequest(
    { ...validRequest, requestedAt: 'soon', unknownField: true },
    { throwOnError: false }
  );
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => e.includes('requestedAt')));
  assert.ok(res.errors.some(e => e.includes("unknown field 'unknownField'")));
  assert.equal(validateObserveRequest(null, { throwOnError: false }).ok, false);
});

test('negative: session/principal identity mismatch', () => {
  const res = validateObserveRequest(
    { ...validRequest, principalId: 'user-99' },
    { throwOnError: false, session: validSession }
  );
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => e.includes("principalId 'user-99' does not match session identity 'user-42'")));
});

test('negative: target identity mismatch between request and result', () => {
  const res = validateObservationResult(validResult, {
    throwOnError: false,
    request: { ...validRequest, target: { targetId: 'screen-2', kind: 'screen' } }
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => e.includes('target identity does not match observe request')));
});

test('positive: valid observation result bound to request', () => {
  const result = validateObservationResult(validResult, { request: validRequest });
  assert.equal(result.sequence, 0);
  assert.equal(isObservationResult(validResult), true);
});

test('negative: malformed observation (non-finite timestamp, negative sequence)', () => {
  const res = validateObservationResult(
    { ...validResult, capturedAt: Number.NaN, sequence: -1 },
    { throwOnError: false }
  );
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => e.includes('capturedAt')));
  assert.ok(res.errors.some(e => e.includes('sequence')));
});

test('negative: stale observation', () => {
  const fresh = evaluateFreshness(validResult, { now: T + 1000, maxAgeMs: 5000 });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.status, 'fresh');

  const stale = evaluateFreshness(validResult, { now: T + 10000, maxAgeMs: 5000 });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.ageMs, 10000);

  const future = evaluateFreshness({ ...validResult, capturedAt: T + 500 }, { now: T, maxAgeMs: 5000 });
  assert.equal(future.status, 'not_yet_valid');
});

test('negative: oversized payload', () => {
  const overBound = validateObservationResult(
    { ...validResult, payload: { ...validResult.payload, byteLength: 2000000 } },
    { throwOnError: false }
  );
  assert.equal(overBound.ok, false);
  assert.ok(overBound.errors.some(e => e.includes('exceeds maximum')));

  const overRequestLimit = validateObservationResult(
    { ...validResult, payload: { ...validResult.payload, byteLength: 4096 } },
    { throwOnError: false, request: { ...validRequest, limits: { maxPayloadBytes: 1024 } } }
  );
  assert.equal(overRequestLimit.ok, false);
  assert.ok(overRequestLimit.errors.some(e => e.includes('limits.maxPayloadBytes')));
});

test('negative: unsupported and effectful capabilities', () => {
  assert.equal(checkCapability('observe').ok, true);

  const effectful = checkCapability('shell_exec');
  assert.equal(effectful.ok, false);
  assert.equal(effectful.reason, 'effectful');

  const unsupported = checkCapability('screen_capture');
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.reason, 'unsupported');

  const res = validateObserveRequest(
    { ...validRequest, capability: 'shell_exec' },
    { throwOnError: false }
  );
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => e.includes('read-only Computer contract')));
});

test('negative: effect declaration and strict verified boolean', () => {
  const withEffect = validateAuditEvidence(
    { ...validEvidence, effect: { changedFiles: ['a.txt'] } },
    { throwOnError: false }
  );
  assert.equal(withEffect.ok, false);
  assert.ok(withEffect.errors.some(e => e.includes('effect must be null')));

  const nonBoolean = validateAuditEvidence(
    { ...validEvidence, verification: { ...validEvidence.verification, verified: 'yes' } },
    { throwOnError: false }
  );
  assert.equal(nonBoolean.ok, false);
  assert.ok(nonBoolean.errors.some(e => e.includes('verification.verified must be a boolean')));

  const unbackedPass = validateAuditEvidence(
    {
      ...validEvidence,
      verification: { ...validEvidence.verification, verified: false, status: 'passed' }
    },
    { throwOnError: false }
  );
  assert.equal(unbackedPass.ok, false);
  assert.ok(unbackedPass.errors.some(e => e.includes("status cannot be 'passed'")));

  const zeroChecks = validateAuditEvidence(
    {
      ...validEvidence,
      verification: { ...validEvidence.verification, checksPassed: 0 }
    },
    { throwOnError: false }
  );
  assert.equal(zeroChecks.ok, false);
  assert.ok(zeroChecks.errors.some(e => e.includes('checksPassed === 0')));

  assert.equal(isAuditEvidence(validEvidence), true);
});

test('positive: verifyObservation passes for consistent evidence', () => {
  const outcome = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    trust: independentVerifierPort
  });
  assert.equal(outcome.status, 'passed');
  assert.equal(outcome.checks.find(c => c.name === 'trusted_authority').ok, true);
  assert.ok(outcome.checksPassed >= 8);
  assert.equal(outcome.checksFailed, 0);
});

test('negative: verifyObservation detects tampered digest and missing evidence', () => {
  const tampered = { ...validEvidence, resultDigest: 'b'.repeat(64) };
  const outcome = verifyObservation(validResult, tampered, { now: T + 1000, maxAgeMs: 5000 });
  assert.equal(outcome.status, 'failed');
  const digestCheck = outcome.checks.find(c => c.name === 'result_digest');
  assert.equal(digestCheck.ok, false);

  const missing = verifyObservation(validResult, null);
  assert.equal(missing.status, 'not_requested');
  assert.equal(missing.checks.length, 0);
});

test('negative: verifyObservation marks stale and malformed inputs inconclusive', () => {
  const stale = verifyObservation(validResult, validEvidence, { now: T + 60000, maxAgeMs: 5000 });
  assert.equal(stale.status, 'inconclusive');

  const malformed = verifyObservation(
    { ...validResult, sequence: -1 },
    validEvidence,
    { now: T + 1000, maxAgeMs: 5000 }
  );
  assert.equal(malformed.status, 'inconclusive');
});

test('regression P1: honor verifier failure and require separate trusted verifier', () => {
  const failedEvidence = {
    ...validEvidence,
    resultDigest: computeResultDigest(validResult),
    verification: {
      verified: false,
      status: 'failed',
      verifier: 'verifier-1',
      checksPassed: 0,
      checksFailed: 1,
      checkedAt: T
    }
  };
  const honored = verifyObservation(validResult, failedEvidence, { now: T + 1000, maxAgeMs: 5000 });
  assert.equal(honored.status, 'failed');
  const verdict = honored.checks.find(c => c.name === 'verification_verdict');
  assert.equal(verdict.ok, false);
  assert.ok(verdict.detail.includes('failure'));

  const selfVerified = {
    ...validEvidence,
    verification: { ...validEvidence.verification, verifier: 'ocr-1' }
  };
  const selfOutcome = verifyObservation(validResult, selfVerified, { now: T + 1000, maxAgeMs: 5000 });
  assert.equal(selfOutcome.status, 'failed');
  const sep = selfOutcome.checks.find(c => c.name === 'verifier_separation');
  assert.equal(sep.ok, false);
});

test('regression P1: exact target fingerprint binding between request and result', () => {
  const requestWithPrint = {
    ...validRequest,
    target: { targetId: 'screen-1', kind: 'screen', fingerprint: 'a'.repeat(64) }
  };
  const accepted = validateObservationResult(validResult, { request: requestWithPrint });
  assert.equal(accepted.target.fingerprint, 'a'.repeat(64));

  const mismatch = validateObservationResult(
    { ...validResult, target: { targetId: 'screen-1', fingerprint: 'b'.repeat(64) } },
    { throwOnError: false, request: requestWithPrint }
  );
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.some(e => e.includes('target fingerprint does not match observe request')));

  const badPrint = validateObservationResult(
    { ...validResult, target: { targetId: 'screen-1', fingerprint: 'b'.repeat(64) } },
    { throwOnError: false, request: { ...requestWithPrint, target: { ...requestWithPrint.target, fingerprint: 'not-a-digest' } } }
  );
  assert.equal(badPrint.ok, false);
  assert.ok(badPrint.errors.some(e => e.includes('request.target.fingerprint')));
});

test('regression P2: strict finite positive integer maxPayloadBytes option and request limits', () => {
  const nan = validateObservationResult(validResult, { throwOnError: false, maxPayloadBytes: Number.NaN });
  assert.equal(nan.ok, false);
  assert.ok(nan.errors.some(e => e.includes('maxPayloadBytes option')));

  const zero = validateObservationResult(validResult, { throwOnError: false, maxPayloadBytes: 0 });
  assert.equal(zero.ok, false);

  const overBound = validateObservationResult(validResult, {
    throwOnError: false,
    maxPayloadBytes: 1048577
  });
  assert.equal(overBound.ok, false);

  const strictLimit = validateObservationResult(
    { ...validResult, payload: { ...validResult.payload, byteLength: 4096 } },
    { throwOnError: false, maxPayloadBytes: 1024 }
  );
  assert.equal(strictLimit.ok, false);
  assert.ok(strictLimit.errors.some(e => e.includes('exceeds the configured limit 1024')));

  const badRequestLimits = validateObservationResult(validResult, {
    throwOnError: false,
    request: { ...validRequest, limits: { maxPayloadBytes: Number.NaN } }
  });
  assert.equal(badRequestLimits.ok, false);
  assert.ok(badRequestLimits.errors.some(e => e.includes('request.limits.maxPayloadBytes')));

  const okLimit = validateObservationResult(validResult, { maxPayloadBytes: 1024 });
  assert.equal(okLimit.payload.byteLength, 512);
});

test('regression P2: omitted maxAgeMs uses finite freshness default, never skips', () => {
  assert.ok(Number.isFinite(DEFAULT_OBSERVATION_LIMITS.maxAgeMs));
  assert.equal(DEFAULT_OBSERVATION_LIMITS.maxAgeMs, 30000);

  const outcome = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    trust: independentVerifierPort
  });
  const freshness = outcome.checks.find(c => c.name === 'freshness');
  assert.equal(freshness.ok, true);
  assert.equal(freshness.detail, 'fresh');
  assert.equal(outcome.status, 'passed');

  const tooOld = verifyObservation(validResult, validEvidence, { now: T + 60000 });
  assert.equal(tooOld.status, 'inconclusive');
  assert.equal(tooOld.checks.find(c => c.name === 'freshness').detail, 'stale');
});

test('regression P1: missing trust stays inconclusive, forged verifier label never passes', () => {
  const missing = verifyObservation(validResult, validEvidence, { now: T + 1000, maxAgeMs: 5000 });
  assert.equal(missing.status, 'inconclusive');
  const trustCheck = missing.checks.find(c => c.name === 'trusted_authority');
  assert.equal(trustCheck.ok, false);
  assert.ok(trustCheck.detail.includes('no trusted verifier port'));

  const forged = {
    ...validEvidence,
    verification: { ...validEvidence.verification, verifier: 'chief-verification-authority-9' }
  };
  const selectivePort = createTrustedVerifierPort('coord-verifier-1', ctx => {
    const known = ctx.evidenceVerifier === 'verifier-1';
    return {
      authorized: known,
      status: known ? 'passed' : 'inconclusive',
      ...(known
        ? {
            bindings: {
              requestId: ctx.requestId,
              sessionId: ctx.sessionId,
              resultDigest: ctx.resultDigest
            }
          }
        : {})
    };
  });
  const forgedOutcome = verifyObservation(validResult, forged, {
    now: T + 1000,
    maxAgeMs: 5000,
    trust: selectivePort
  });
  assert.notEqual(forgedOutcome.status, 'passed');
  assert.equal(forgedOutcome.status, 'inconclusive');

  const selfDigestOnly = verifyObservation(validResult, forged, {
    now: T + 1000,
    maxAgeMs: 5000
  });
  assert.notEqual(selfDigestOnly.status, 'passed');
});

test('regression P1: trusted failure honored, forged or stale bindings rejected', () => {
  const failing = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    trust: createTrustedVerifierPort('coord-verifier-1', () => ({
      authorized: false,
      status: 'failed',
      reason: 'independent re-check failed'
    }))
  });
  assert.equal(failing.status, 'failed');

  const wrongDigest = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    trust: createTrustedVerifierPort('coord-verifier-1', ctx => ({
      authorized: true,
      status: 'passed',
      bindings: {
        requestId: ctx.requestId,
        sessionId: ctx.sessionId,
        resultDigest: 'c'.repeat(64)
      }
    }))
  });
  assert.equal(wrongDigest.status, 'failed');

  const wrongRequest = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    trust: createTrustedVerifierPort('coord-verifier-1', ctx => ({
      authorized: true,
      status: 'passed',
      bindings: {
        requestId: 'obs-other',
        sessionId: ctx.sessionId,
        resultDigest: ctx.resultDigest
      }
    }))
  });
  assert.equal(wrongRequest.status, 'failed');

  const wrongPrincipal = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    request: validRequest,
    trust: createTrustedVerifierPort('coord-verifier-1', ctx => ({
      authorized: true,
      status: 'passed',
      bindings: {
        requestId: ctx.requestId,
        sessionId: ctx.sessionId,
        resultDigest: ctx.resultDigest,
        principalId: 'user-99'
      }
    }))
  });
  assert.equal(wrongPrincipal.status, 'failed');
});

test('positive: valid injected independent verifier with exact bindings passes', () => {
  const outcome = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    request: validRequest,
    trust: independentVerifierPort
  });
  assert.equal(outcome.status, 'passed');
  const trustCheck = outcome.checks.find(c => c.name === 'trusted_authority');
  assert.equal(trustCheck.ok, true);
  assert.ok(trustCheck.detail.includes('coord-verifier-1'));

  const principalBound = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    request: validRequest,
    trust: createTrustedVerifierPort('coord-verifier-1', ctx => ({
      authorized: true,
      status: 'passed',
      bindings: {
        requestId: ctx.requestId,
        sessionId: ctx.sessionId,
        resultDigest: ctx.resultDigest,
        principalId: 'user-42'
      }
    }))
  });
  assert.equal(principalBound.status, 'passed');

  const throwingPort = createTrustedVerifierPort('coord-verifier-1', () => {
    throw new Error('authority backend down');
  });
  const errored = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    trust: throwingPort
  });
  assert.equal(errored.status, 'inconclusive');

  assert.throws(
    () => createTrustedVerifierPort('bad id!', () => ({})),
    ContractValidationError
  );
  assert.throws(
    () => createTrustedVerifierPort('ok-id', 'not-a-function'),
    ContractValidationError
  );
});

test('regression P1: admitted request must bind result before trusted callback', () => {
  let decideCalls = 0;
  const countingPort = createTrustedVerifierPort('coord-verifier-1', ctx => {
    decideCalls += 1;
    return {
      authorized: true,
      status: 'passed',
      bindings: {
        requestId: ctx.requestId,
        sessionId: ctx.sessionId,
        resultDigest: ctx.resultDigest
      }
    };
  });

  const mismatchedId = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    request: { ...validRequest, requestId: 'obs-other' },
    trust: countingPort
  });
  assert.equal(mismatchedId.status, 'failed');
  assert.equal(mismatchedId.checks.find(c => c.name === 'request_admission').ok, false);
  assert.equal(decideCalls, 0);

  const mismatchedSession = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    request: { ...validRequest, sessionId: 'sess-other' },
    trust: countingPort
  });
  assert.equal(mismatchedSession.status, 'failed');
  assert.equal(decideCalls, 0);

  const mismatchedPrint = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    request: {
      ...validRequest,
      target: { targetId: 'screen-1', kind: 'screen', fingerprint: 'b'.repeat(64) }
    },
    trust: countingPort
  });
  assert.equal(mismatchedPrint.status, 'failed');
  assert.equal(decideCalls, 0);
});

test('regression P1: admitted request limits immutable, malformed request fails, valid binds and passes', () => {
  let decideCalls = 0;
  const countingPort = createTrustedVerifierPort('coord-verifier-1', ctx => {
    decideCalls += 1;
    return {
      authorized: true,
      status: 'passed',
      bindings: {
        requestId: ctx.requestId,
        sessionId: ctx.sessionId,
        resultDigest: ctx.resultDigest
      }
    };
  });

  const limitBypass = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    request: { ...validRequest, limits: { maxPayloadBytes: 1 } },
    trust: countingPort
  });
  assert.equal(limitBypass.status, 'failed');
  const admission = limitBypass.checks.find(c => c.name === 'request_admission');
  assert.equal(admission.ok, false);
  assert.ok(admission.detail.includes('limits.maxPayloadBytes'));
  assert.equal(decideCalls, 0);

  const malformed = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    request: { ...validRequest, requestId: 123, requestedAt: 'soon' },
    trust: countingPort
  });
  assert.equal(malformed.status, 'failed');
  assert.ok(
    malformed.checks.find(c => c.name === 'request_admission').detail.includes('admitted request invalid')
  );
  assert.equal(decideCalls, 0);

  const validBind = verifyObservation(validResult, validEvidence, {
    now: T + 1000,
    maxAgeMs: 5000,
    request: validRequest,
    trust: countingPort
  });
  assert.equal(validBind.status, 'passed');
  assert.equal(decideCalls, 1);
});
