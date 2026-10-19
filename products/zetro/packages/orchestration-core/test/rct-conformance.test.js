import { test } from 'node:test';
import assert from 'node:assert';
import { RctAdapterPort } from '../src/rct-adapter-port.js';
import { FakeRctAdapter } from '../src/rct-conformance-fixture.js';
import { States } from '../src/types.js';

function validEnvelope() {
  return {
    id: 'conformance-task-1',
    agent: 'rct-worker',
    objective: 'Refactor module',
    allowedPaths: ['src/patch.js'],
    contextRefs: [],
    acceptance: 'test: pass',
    verification: 'npm-test',
    deadlineMs: 5000,
    budget: { maxContextChars: 1000, maxReplyChars: 1000 }
  };
}

test('RctAdapterPort: validateReceipt validates conformant receipt', () => {
  const env = validEnvelope();
  const validReceipt = {
    id: env.id,
    agent: env.agent,
    state: States.COMPLETED,
    changedFiles: ['src/patch.js'],
    checks: [{ name: 'test', passed: true }],
    evidenceRefs: ['evidence/patch.diff'],
    summary: 'Applied cleanly',
    uncertainty: 'None'
  };

  assert.equal(RctAdapterPort.validateReceipt(validReceipt, env), true);
});

test('RctAdapterPort: validateReceipt rejects non-conformant receipts', () => {
  const env = validEnvelope();

  // Mismatched ID
  assert.equal(RctAdapterPort.validateReceipt({ ...validEnvelope(), id: 'wrong-id' }, env), false);

  // Mismatched agent
  assert.equal(RctAdapterPort.validateReceipt({ ...validEnvelope(), id: env.id, agent: 'wrong-agent' }, env), false);

  // Invalid state
  assert.equal(RctAdapterPort.validateReceipt({ id: env.id, agent: env.agent, state: 'INVALID_STATE' }, env), false);

  // Missing arrays
  assert.equal(RctAdapterPort.validateReceipt({
    id: env.id, agent: env.agent, state: States.COMPLETED, changedFiles: 'not-array'
  }, env), false);
});

test('FakeRctAdapter: success mode produces valid patch and check artifacts', async () => {
  const adapter = new FakeRctAdapter({ mode: 'success', delayMs: 10 });
  const env = validEnvelope();

  const receipt = await adapter.execute(env);
  assert.equal(receipt.id, env.id);
  assert.equal(receipt.state, States.COMPLETED);
  assert.ok(receipt.changedFiles.length > 0);
  assert.ok(receipt.checks.length > 0);
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), true);
});

test('FakeRctAdapter: check_failure mode produces FAILED state with checks', async () => {
  const adapter = new FakeRctAdapter({ mode: 'check_failure', delayMs: 5 });
  const env = validEnvelope();

  const receipt = await adapter.execute(env);
  assert.equal(receipt.state, States.FAILED);
  assert.ok(receipt.checks.some(c => c.name.includes('test') || (c.error && c.error.includes('failed'))));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), true);
});

test('FakeRctAdapter: scope_violation mode rejects out-of-scope modifications', async () => {
  const adapter = new FakeRctAdapter({ mode: 'scope_violation', delayMs: 5 });
  const env = validEnvelope();

  const receipt = await adapter.execute(env);
  assert.equal(receipt.state, States.FAILED);
  assert.ok(receipt.checks.some(c => c.name.includes('scope') || (c.error && c.error.includes('allowedPaths'))));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), true);
});

test('FakeRctAdapter: hang mode respects AbortSignal', async () => {
  const adapter = new FakeRctAdapter({ mode: 'hang' });
  const env = validEnvelope();
  const ac = new AbortController();

  const execPromise = adapter.execute(env, ac.signal);
  setTimeout(() => ac.abort(), 20);

  await assert.rejects(execPromise, /AbortError/);
});

test('FakeRctAdapter: adversarial intruder agent rejected by validateReceipt', async () => {
  const adapter = new FakeRctAdapter({ mode: 'intruder_agent' });
  const env = validEnvelope();
  const receipt = await adapter.execute(env);
  assert.equal(receipt.agent, 'evil-intruder-agent');
  const conf = RctAdapterPort.checkReceiptConformance(receipt, env);
  assert.equal(conf.valid, false);
  assert.ok(conf.reason.includes('Agent identity mismatch'));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), false);
});

test('FakeRctAdapter: adversarial mismatched task ID rejected by validateReceipt', async () => {
  const adapter = new FakeRctAdapter({ mode: 'mismatched_id' });
  const env = validEnvelope();
  const receipt = await adapter.execute(env);
  const conf = RctAdapterPort.checkReceiptConformance(receipt, env);
  assert.equal(conf.valid, false);
  assert.ok(conf.reason.includes('Task ID mismatch'));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), false);
});

test('FakeRctAdapter: adversarial out-of-scope patch rejected by validateReceipt', async () => {
  const adapter = new FakeRctAdapter({ mode: 'outside_scope_patch' });
  const env = validEnvelope();
  const receipt = await adapter.execute(env);
  const conf = RctAdapterPort.checkReceiptConformance(receipt, env);
  assert.equal(conf.valid, false);
  assert.ok(conf.reason.includes('Path scope violation'));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), false);
});

test('FakeRctAdapter: adversarial completed with no checks rejected (worker completion alone)', async () => {
  const adapter = new FakeRctAdapter({ mode: 'completed_no_checks' });
  const env = validEnvelope();
  const receipt = await adapter.execute(env);
  const conf = RctAdapterPort.checkReceiptConformance(receipt, env);
  assert.equal(conf.valid, false);
  assert.ok(conf.reason.includes('COMPLETED state requires non-empty verification checks'));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), false);
});

test('FakeRctAdapter: adversarial completed with failed checks rejected', async () => {
  const adapter = new FakeRctAdapter({ mode: 'completed_failed_checks' });
  const env = validEnvelope();
  const receipt = await adapter.execute(env);
  const conf = RctAdapterPort.checkReceiptConformance(receipt, env);
  assert.equal(conf.valid, false);
  assert.ok(conf.reason.includes('indicates failure'));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), false);
});

test('FakeRctAdapter: adversarial forged check bare string rejected', async () => {
  const adapter = new FakeRctAdapter({ mode: 'forged_checks_strings' });
  const env = validEnvelope();
  const receipt = await adapter.execute(env);
  const conf = RctAdapterPort.checkReceiptConformance(receipt, env);
  assert.equal(conf.valid, false);
  assert.ok(conf.reason.includes('string labels'));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), false);
});

test('FakeRctAdapter: adversarial forged check empty object rejected', async () => {
  const adapter = new FakeRctAdapter({ mode: 'forged_checks_empty_object' });
  const env = validEnvelope();
  const receipt = await adapter.execute(env);
  const conf = RctAdapterPort.checkReceiptConformance(receipt, env);
  assert.equal(conf.valid, false);
  assert.ok(conf.reason.includes('Check name must be a non-empty string'));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), false);
});

test('FakeRctAdapter: adversarial forged check malformed boolean string rejected', async () => {
  const adapter = new FakeRctAdapter({ mode: 'forged_checks_malformed_boolean' });
  const env = validEnvelope();
  const receipt = await adapter.execute(env);
  const conf = RctAdapterPort.checkReceiptConformance(receipt, env);
  assert.equal(conf.valid, false);
  assert.ok(conf.reason.includes('strict boolean'));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), false);
});

test('FakeRctAdapter: adversarial forged check number boolean rejected', async () => {
  const adapter = new FakeRctAdapter({ mode: 'forged_checks_number_boolean' });
  const env = validEnvelope();
  const receipt = await adapter.execute(env);
  const conf = RctAdapterPort.checkReceiptConformance(receipt, env);
  assert.equal(conf.valid, false);
  assert.ok(conf.reason.includes('strict boolean'));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), false);
});

test('RctAdapterPort: validateVerifierEvidence verifies legitimate evidence and rejects forged evidence', () => {
  const env = validEnvelope();
  const attemptId = 'att-42';

  // Valid verifier evidence
  const validEv = {
    taskId: env.id,
    attemptId,
    verified: true,
    checks: [{ name: 'npm-test', passed: true }]
  };
  assert.equal(RctAdapterPort.validateVerifierEvidence(validEv, env, attemptId).valid, true);

  // missingattempt: Missing attemptId is strictly rejected
  const missingAttemptRes = RctAdapterPort.validateVerifierEvidence({ ...validEv, attemptId: undefined }, env, attemptId);
  assert.equal(missingAttemptRes.valid, false);
  assert.match(missingAttemptRes.reason, /attemptId is required/);

  const emptyAttemptRes = RctAdapterPort.validateVerifierEvidence({ ...validEv, attemptId: '' }, env, attemptId);
  assert.equal(emptyAttemptRes.valid, false);
  assert.match(emptyAttemptRes.reason, /attemptId is required/);

  // Mismatched task ID
  assert.equal(RctAdapterPort.validateVerifierEvidence({ ...validEv, taskId: 'wrong-task' }, env, attemptId).valid, false);

  // Mismatched attempt ID
  assert.equal(RctAdapterPort.validateVerifierEvidence({ ...validEv, attemptId: 'wrong-att' }, env, attemptId).valid, false);

  // Non-boolean verified
  assert.equal(RctAdapterPort.validateVerifierEvidence({ ...validEv, verified: 'true' }, env, attemptId).valid, false);

  // Failed check
  assert.equal(RctAdapterPort.validateVerifierEvidence({
    ...validEv,
    checks: [{ name: 'npm-test', passed: false }]
  }, env, attemptId).valid, false);

  // Bare string check in verifier evidence
  assert.equal(RctAdapterPort.validateVerifierEvidence({
    ...validEv,
    checks: ['passed']
  }, env, attemptId).valid, false);

  // unrelatedcheck: Unrelated passing check does NOT satisfy envelope verification
  const unrelatedEv = {
    ...validEv,
    checks: [{ name: 'unrelated-dummy-check', passed: true }]
  };
  const unrelatedRes = RctAdapterPort.validateVerifierEvidence(unrelatedEv, env, attemptId);
  assert.equal(unrelatedRes.valid, false);
  assert.match(unrelatedRes.reason, /Required check 'npm-test' was not verified as passed/);

  // Declared checks requirement derived from envelope.declaredChecks
  const envWithDeclared = { ...env, declaredChecks: ['npm-test', 'lint'] };
  assert.equal(RctAdapterPort.validateVerifierEvidence(validEv, envWithDeclared, attemptId).valid, false);
  const fullEv = {
    ...validEv,
    checks: [{ name: 'npm-test', passed: true }, { name: 'lint', passed: true }]
  };
  assert.equal(RctAdapterPort.validateVerifierEvidence(fullEv, envWithDeclared, attemptId).valid, true);

  // Empty verification / no declared checks envelope rejected
  const envNoChecks = { ...env, verification: '', declaredChecks: [] };
  const noChecksRes = RctAdapterPort.validateVerifierEvidence(validEv, envNoChecks, attemptId);
  assert.equal(noChecksRes.valid, false);
  assert.match(noChecksRes.reason, /must declare non-empty verification check IDs/);
});

test('RctAdapterPort: exact check ID matching rejects removeddash, case, underscore, and whitespace regressions', () => {
  const env = validEnvelope();
  const attemptId = 'test-att-regress-1';
  const baseEv = {
    taskId: env.id,
    attemptId,
    verified: true,
    checks: []
  };

  // 1. removeddash: 'node --test' required, but evidence has 'node test'
  const envDash = { ...env, verification: 'node --test' };
  const evRemovedDash = {
    ...baseEv,
    checks: [{ name: 'node test', passed: true }]
  };
  const dashRes = RctAdapterPort.validateVerifierEvidence(evRemovedDash, envDash, attemptId);
  assert.equal(dashRes.valid, false);
  assert.match(dashRes.reason, /Required check 'node --test' was not verified as passed/);

  // 2. case: 'npm-test' required, but evidence has 'NPM-TEST'
  const envCase = { ...env, verification: 'npm-test' };
  const evCase = {
    ...baseEv,
    checks: [{ name: 'NPM-TEST', passed: true }]
  };
  const caseRes = RctAdapterPort.validateVerifierEvidence(evCase, envCase, attemptId);
  assert.equal(caseRes.valid, false);
  assert.match(caseRes.reason, /Required check 'npm-test' was not verified as passed/);

  // 3. underscore: 'test_unit' required, but evidence has 'test-unit'
  const envUnderscore = { ...env, verification: 'test_unit' };
  const evUnderscore = {
    ...baseEv,
    checks: [{ name: 'test-unit', passed: true }]
  };
  const underRes = RctAdapterPort.validateVerifierEvidence(evUnderscore, envUnderscore, attemptId);
  assert.equal(underRes.valid, false);
  assert.match(underRes.reason, /Required check 'test_unit' was not verified as passed/);

  // 4. argumentchanging whitespace: 'node --test test/unit.js' required, but whitespace/args changed
  const envWhitespace = { ...env, verification: 'node --test test/unit.js' };
  const evWhitespace = {
    ...baseEv,
    checks: [{ name: 'node  --test  test/unit.js', passed: true }]
  };
  const whiteRes = RctAdapterPort.validateVerifierEvidence(evWhitespace, envWhitespace, attemptId);
  assert.equal(whiteRes.valid, false);
  assert.ok(whiteRes.reason.includes("Required check 'node --test test/unit.js' was not verified as passed"));

  // Exact match succeeds
  const evExact = {
    ...baseEv,
    checks: [{ name: 'node --test test/unit.js', passed: true }]
  };
  const exactRes = RctAdapterPort.validateVerifierEvidence(evExact, envWhitespace, attemptId);
  assert.equal(exactRes.valid, true);
});

test('FakeRctAdapter: adversarial unbounded fields rejected', async () => {
  const adapter = new FakeRctAdapter({ mode: 'unbounded_fields' });
  const env = validEnvelope();
  const receipt = await adapter.execute(env);
  const conf = RctAdapterPort.checkReceiptConformance(receipt, env);
  assert.equal(conf.valid, false);
  assert.ok(conf.reason.includes('Summary exceeds maximum length'));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), false);
});

test('FakeRctAdapter: adversarial invalid state rejected', async () => {
  const adapter = new FakeRctAdapter({ mode: 'invalid_state' });
  const env = validEnvelope();
  const receipt = await adapter.execute(env);
  const conf = RctAdapterPort.checkReceiptConformance(receipt, env);
  assert.equal(conf.valid, false);
  assert.ok(conf.reason.includes('Invalid receipt state'));
  assert.equal(RctAdapterPort.validateReceipt(receipt, env), false);
});

test('FakeRctAdapter: directory traversal in changedFiles and evidenceRefs rejected', () => {
  const env = validEnvelope();
  // Changed file directory traversal
  assert.equal(RctAdapterPort.validateReceipt({
    id: env.id, agent: env.agent, state: States.COMPLETED,
    changedFiles: ['../../etc/shadow'], checks: [{ name: 'test', passed: true }],
    evidenceRefs: [], summary: 'ok'
  }, env), false);

  // Evidence ref directory traversal
  assert.equal(RctAdapterPort.validateReceipt({
    id: env.id, agent: env.agent, state: States.COMPLETED,
    changedFiles: ['src/patch.js'], checks: [{ name: 'test', passed: true }],
    evidenceRefs: ['../../secrets/key.pem'], summary: 'ok'
  }, env), false);
});
