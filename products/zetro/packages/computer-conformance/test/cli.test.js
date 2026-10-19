import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReport,
  serializeReport,
  summarizeScenarios,
  REPORT_SCHEMA_VERSION,
  REPORT_MAX_BYTES,
  ACTUAL_PACKAGES,
  EXIT
} from '../src/cli.js';

test('cli report identity: schema, mode, nativeVerified=false, actual packages', async () => {
  const report = await buildReport();
  assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.equal(report.mode, 'offline-integration');
  assert.equal(report.nativeVerified, false);
  assert.equal(report.blocked, false);
  const names = report.packages.map(p => p.name);
  assert.deepEqual(names, ACTUAL_PACKAGES.map(p => p.name));
  assert.ok(names.includes('computer-contract'));
  assert.ok(names.includes('computer-runtime'));
  assert.ok(names.includes('computer-observer'));
  assert.equal(report.exitCode, EXIT.PASS);
  assert.equal(report.failures, 0);
});

test('cli report: per-scenario outcomes present and passing', async () => {
  const report = await buildReport();
  const byName = Object.fromEntries(report.scenarios.map(s => [s.name, s]));
  assert.equal(byName['offline-integration-happy-path'].outcome, 'pass');
  assert.equal(byName['offline-integration-happy-path'].verificationStatus, 'passed');
  const expectedNegatives = [
    'wrong-identity', 'future-target', 'stale-target', 'revoke-during-authority-await',
    'authority-timeout', 'bounds-oversize-runner-response', 'no-trusted-verifier'
  ];
  for (const name of expectedNegatives) {
    assert.ok(byName[name], `missing negative scenario: ${name}`);
    assert.ok(['rejected', 'never_verified'].includes(byName[name].outcome), `${name} outcome: ${byName[name].outcome}`);
  }
});

test('cli report is bounded in size', async () => {
  const report = await buildReport();
  const json = serializeReport(report);
  assert.ok(Buffer.byteLength(json, 'utf8') <= REPORT_MAX_BYTES, `report exceeds byte bound`);
});

test('serializeReport bound uses UTF-8 bytes, not string length (multibyte regression)', () => {
  // 6000 CJK chars => 18000 UTF-8 bytes (plus JSON overhead) but string.length far below the byte bound
  const multibyte = { text: '界'.repeat(6000) };
  const json = JSON.stringify(multibyte, null, 2);
  assert.ok(json.length < REPORT_MAX_BYTES, 'precondition: string length is under the bound');
  assert.ok(Buffer.byteLength(json, 'utf8') > REPORT_MAX_BYTES, 'precondition: UTF-8 bytes exceed the bound');
  assert.throws(() => serializeReport(multibyte), /exceeds bounded size: \d+ bytes > 16384 bytes/);
  // multibyte report just under the byte bound is accepted
  const under = { text: '界'.repeat(100) };
  const underJson = JSON.stringify(under, null, 2);
  assert.ok(Buffer.byteLength(underJson, 'utf8') <= REPORT_MAX_BYTES);
  assert.equal(serializeReport(under), underJson);
});

test('negative failure propagation: any non-pass outcome yields nonzero exit', () => {
  const clean = summarizeScenarios([
    { name: 'a', outcome: 'pass' },
    { name: 'b', outcome: 'rejected' },
    { name: 'c', outcome: 'never_verified' }
  ]);
  assert.equal(clean.failures, 0);
  assert.deepEqual(clean.failureNames, []);

  const dirty = summarizeScenarios([
    { name: 'a', outcome: 'pass' },
    { name: 'b', outcome: 'unknown' },
    { name: 'c', outcome: 'fail' }
  ]);
  assert.equal(dirty.failures, 2);
  assert.deepEqual(dirty.failureNames, ['b', 'c']);
  const exitCode = dirty.failures > 0 ? EXIT.SCENARIO_FAILURE : EXIT.PASS;
  assert.equal(exitCode, EXIT.SCENARIO_FAILURE);
});

test('native-live fails closed: blocked, never self-certified, nonzero exit', async () => {
  const report = await buildReport({ nativeLive: true });
  assert.equal(report.mode, 'native-live');
  assert.equal(report.nativeVerified, false);
  assert.equal(report.blocked, true);
  assert.equal(report.exitCode, EXIT.NATIVE_LIVE_BLOCKED);
  assert.notEqual(report.exitCode, EXIT.PASS);
  assert.ok(report.reason.includes('fail-closed'));
  assert.ok(report.scenarios.every(s => s.outcome === 'blocked'));
});
