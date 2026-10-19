import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runOfflineIntegration,
  runNegativeSuite,
  INTEGRATION_LABEL,
  NATIVE_UNVERIFIED
} from '../src/actual-integration.js';
import { COMPUTER_SCHEMA_VERSIONS, VerificationStatus } from '../../computer-contract/src/index.js';

test('offline integration: real contract+session+observer happy path', async () => {
  const report = await runOfflineIntegration();
  assert.equal(report.label, INTEGRATION_LABEL);
  assert.equal(report.nativeUnverified, true, 'must be labeled native-unverified');
  assert.equal(report.verificationStatus, VerificationStatus.PASSED);
  assert.ok(report.checksPassed > 0);
  assert.equal(report.checksFailed, 0);
  assert.equal(report.sessionStateAfterRevoke, 'revoked');
  // zero observer effects after revocation: exactly one capture (the happy-path observation)
  assert.equal(report.observerCaptures, 1);
  assert.equal(report.postRevokeObserveCode, 'session_revoked');
  // revoke is terminal; stop-after-revoke is honestly rejected as already-terminal
  assert.equal(report.stopAfterRevoke.ok, false);
  assert.equal(report.stopAfterRevoke.code, 'session_stopped');
  assert.equal(report.stopAfterRevoke.terminalState, 'revoked');
  assert.equal(report.finalSessionState, 'revoked');
  assert.ok(report.auditTypes.includes('session_started'));
  assert.ok(report.auditTypes.includes('observation_delivered'));
  assert.ok(report.auditTypes.includes('session_revoked'));
});

test('offline integration uses actual OCR-1 schema versions', async () => {
  await runOfflineIntegration();
  assert.equal(COMPUTER_SCHEMA_VERSIONS.SESSION_IDENTITY, 'zetro.computer.session.alpha.v1');
  assert.equal(COMPUTER_SCHEMA_VERSIONS.OBSERVE_REQUEST, 'zetro.computer.observe_request.alpha.v1');
  assert.equal(COMPUTER_SCHEMA_VERSIONS.OBSERVATION_RESULT, 'zetro.computer.observation_result.alpha.v1');
  assert.equal(COMPUTER_SCHEMA_VERSIONS.AUDIT_EVIDENCE, 'zetro.computer.audit_evidence.alpha.v1');
});

test('negatives: wrong identity / future target / stale / revoke-await / timeout / bounds rejected', async () => {
  const { negatives } = await runNegativeSuite();
  const byName = Object.fromEntries(negatives.map(n => [n.name, n]));
  assert.equal(byName['wrong-identity'].code, 'principal_mismatch');
  assert.equal(byName['future-target'].code, 'RESPONSE_MALFORMED');
  assert.equal(byName['stale-target'].code, 'WINDOW_STALE');
  assert.equal(byName['revoke-during-authority-await'].code, 'session_revoked');
  assert.equal(byName['revoke-during-authority-await'].observerCaptures, 0, 'observer must never run after revocation');
  assert.equal(byName['authority-timeout'].code, 'authority_timeout');
  assert.equal(byName['authority-timeout'].observerCaptures, 0, 'observer must never run on authority timeout');
  assert.ok(
    byName['authority-timeout'].boundedElapsedMs >= 0 && byName['authority-timeout'].boundedElapsedMs <= 2000,
    `authority timeout must be awaited and bounded, elapsed ${byName['authority-timeout'].boundedElapsedMs}ms`
  );
  assert.equal(byName['bounds-oversize-runner-response'].code, 'observer_failed');
  assert.equal(byName['bounds-oversize-runner-response'].observerCaptureAttempts, 1, 'bounds failure occurs inside the real observer attempt');
});

test('negatives: verification without a trusted verifier is never passed', async () => {
  const { negatives } = await runNegativeSuite();
  const n = negatives.find(x => x.name === 'no-trusted-verifier');
  assert.ok(n, 'no-trusted-verifier negative must run');
  assert.notEqual(n.status, VerificationStatus.PASSED);
  assert.equal(n.neverVerified, true);
});
