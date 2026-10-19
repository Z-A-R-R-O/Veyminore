import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runConformance,
  runScenario,
  createMockPorts,
  createIntegrationEntrypoints,
  SCENARIOS
} from '../src/index.js';

test('mock verification: all conformance scenarios pass against fake ports', async () => {
  const report = await runConformance({ mode: 'mock' });
  assert.equal(report.verification, 'mock-verification');
  assert.equal(report.blocked, false);
  assert.equal(report.results.length, SCENARIOS.length);
  for (const r of report.results) {
    assert.equal(r.ok, true, `${r.name} failed: ${JSON.stringify(r.error)}`);
  }
});

test('lifecycle scenario produces an audit export digest', async () => {
  const ports = createMockPorts();
  const r = await runScenario('lifecycle', ports);
  assert.equal(r.ok, true);
  assert.match(r.auditExportDigest, /^fnv1a-32:/);
});

test('stale target is rejected', async () => {
  const r = await runScenario('stale-target', createMockPorts());
  assert.equal(r.ok, true);
});

test('expired grant is rejected at observation begin', async () => {
  const r = await runScenario('expired-grant', createMockPorts());
  assert.equal(r.ok, true);
});

test('canceled pending observation rejects observer claims', async () => {
  const r = await runScenario('canceled-pending-observation', createMockPorts());
  assert.equal(r.ok, true);
});

test('malicious (untrusted) observer claim is rejected', async () => {
  const r = await runScenario('malicious-observer-claim', createMockPorts());
  assert.equal(r.ok, true);
});

test('forged evidence digest fails identity check', async () => {
  const r = await runScenario('evidence-identity', createMockPorts());
  assert.equal(r.ok, true);
});

test('regression: wrong observe target rejected after await boundary', async () => {
  const r = await runScenario('wrong-target-during-observe', createMockPorts());
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
});

test('regression: observe after revoke rejected (authority re-checked at effect boundary)', async () => {
  const r = await runScenario('revoke-during-observe', createMockPorts());
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
});

test('regression: observe after grant expiry rejected at effect boundary', async () => {
  const r = await runScenario('expiry-during-observe', createMockPorts());
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
});

test('regression: beginObservation rejects target different from grant target', async () => {
  const r = await runScenario('direct-wrong-target-creation', createMockPorts());
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
});

test('regression: begin and observe at exactly expiresAt are rejected (>= not >)', async () => {
  const r = await runScenario('exact-expiry', createMockPorts());
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
});

test('custom fake ports are injectable', async () => {
  const custom = createMockPorts();
  const r = await runScenario('lifecycle', custom, { subject: 'bob' });
  assert.equal(r.ok, true);
});

test('native-live is always blocked fail-closed, never passed', async () => {
  const report = await runConformance({ mode: 'native-live' });
  assert.equal(report.blocked, true);
  assert.ok(report.missing.includes('OCR-1:contract'));
  assert.ok(report.missing.includes('OCR-2:session'));
  assert.ok(report.missing.includes('OCR-3:observer'));
  for (const r of report.results) {
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
  }
});

test('native-live stays blocked even with caller-supplied ports/labels (no self-certification)', async () => {
  const wiring = createIntegrationEntrypoints({
    ocr1: createMockPorts().contractPort,
    ocr2: createMockPorts().sessionPort,
    ocr3: createMockPorts().observerPort
  });
  assert.equal(wiring.available, false, 'wiring alone must never be available');
  assert.equal(wiring.attested, false);
  const report = await runConformance({ mode: 'native-live', integration: wiring });
  assert.equal(report.blocked, true);
  for (const r of report.results) {
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
  }
});

test('integration entrypoint reports missing OCR packages precisely', () => {
  const e = createIntegrationEntrypoints({});
  assert.equal(e.available, false);
  assert.equal(e.wiringComplete, false);
  assert.deepEqual(e.missing, ['OCR-1:contract', 'OCR-2:session', 'OCR-3:observer']);
});

test('authentication failure is surfaced', async () => {
  const ports = createMockPorts();
  await assert.rejects(
    () => ports.contractPort.authenticate({ subject: 'alice', credential: 'wrong' }),
    (e) => e.code === 'AUTH_FAILED'
  );
});
