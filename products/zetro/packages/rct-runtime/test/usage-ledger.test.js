import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  runAssignment,
  UsageLedger,
  sha256,
  AuthorityPort,
  createDefaultRegistry,
  isLiteralNonNegativeInteger,
  classifyError,
  ALLOWED_ERROR_CLASSIFICATIONS
} from '../src/index.js';
import { FakeProvider } from '../src/fake-provider.js';
import { GroqProvider } from '../src/groq-provider.js';

describe('Honest Per-Run Usage & Effect Ledger (W3-AGR2)', () => {
  async function withFixture(fn) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rct-ledger-test-'));
    try {
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');
      return await fn(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it('1. Clock Injection: total walltime reflects injected clock deterministically', () => withFixture(async (root) => {
    let mockTime = 10000;
    const steppingClock = () => {
      const current = mockTime;
      mockTime += 500; // each time clock is read, time steps by 500ms
      return current;
    };

    const provider = {
      name: 'stepping-clock-provider',
      async next() {
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'Completed' } }],
          usage: { inputTokens: 50, outputTokens: 25 }
        };
      }
    };

    const result = await runAssignment({
      id: 'clock-injection-task',
      objective: 'Test injected clock',
      acceptance: 'Greeting equals hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello\n' }]
    }, provider, root, {
      isolated: true,
      clock: steppingClock
    });

    assert.ok(result.metrics, 'Metrics object must be present on receipt');
    assert.ok(result.metrics.wallTimeMs > 0, 'Wall time must be measured from injected clock');
    assert.equal(result.elapsedMs, result.metrics.wallTimeMs, 'Receipt elapsedMs must match metrics.wallTimeMs');
    assert.equal(typeof result.metrics.wallTimeMs, 'number');
  }));

  it('2. Success Case: accurate known tokens, tool outputs, and verified result denominator', () => withFixture(async (root) => {
    let turn = 0;
    const provider = {
      name: 'success-provider',
      async next() {
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [{ name: 'read_slice', args: { path: 'src/greeting.txt', start: 0, length: 10 } }],
            usage: { inputTokens: 40, outputTokens: 15 }
          };
        }
        if (turn === 2) {
          return {
            toolCalls: [{ name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } }],
            usage: { inputTokens: 60, outputTokens: 20 }
          };
        }
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'Patched successfully' } }],
          usage: { inputTokens: 30, outputTokens: 10 }
        };
      }
    };

    const result = await runAssignment({
      id: 'success-ledger-task',
      objective: 'Update greeting to hello world',
      acceptance: 'Greeting equals hello world',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
    }, provider, root, { isolated: true });

    assert.equal(result.state, 'review_ready');
    const m = result.metrics;
    assert.ok(m, 'Metrics must be defined');

    // Verified result denominator
    assert.equal(m.verified, true, 'Verified must be true for review_ready task passing independent checks');
    assert.equal(m.denominator, 1, 'Denominator must be 1');

    // Provider attempts and requests
    assert.equal(m.providerAttempts, 3);
    assert.equal(m.successfulRequests, 3);
    assert.equal(m.failedAttempts, 0);
    assert.equal(m.retries, 0);

    // Tokens
    assert.equal(m.hasUnknownUsage, false);
    assert.equal(m.unknownUsageAttempts, 0);
    assert.equal(m.inputTokens, 130); // 40 + 60 + 30
    assert.equal(m.outputTokens, 45); // 15 + 20 + 10
    assert.equal(m.totalTokens, 175);
    assert.equal(m.knownInputTokens, 130);
    assert.equal(m.knownOutputTokens, 45);

    // Tools
    assert.equal(m.toolCalls, 3);
    assert.equal(m.toolCallsSucceeded, 3);
    assert.equal(m.toolCallsRejected, 0);
    assert.ok(m.toolOutputBytes > 0, 'Tool output bytes must be tracked and positive');

    // Checks
    assert.ok(m.checkRuns >= 2, 'Checks must have run after patch and at review');
    assert.equal(m.checkFailures, 0);

    assert.equal(result.remoteUsageUncertain, false);
  }));

  it('3. Failure Case: check failure sets verified=false and records failures without fabricating success', () => withFixture(async (root) => {
    const provider = new FakeProvider([
      { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'wrong text\n' } },
      { name: 'submit_receipt', args: { summary: 'Submitted despite failure' } }
    ]);

    const result = await runAssignment({
      id: 'failure-ledger-task',
      objective: 'Update greeting',
      acceptance: 'Greeting equals hello world',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
    }, provider, root, { isolated: true });

    assert.equal(result.state, 'failed');
    const m = result.metrics;
    assert.equal(m.verified, false, 'Verified denominator must be strictly false on failed run');
    assert.equal(m.denominator, 1);
    assert.ok(m.checkFailures >= 1, 'Check failures must be counted');
    assert.equal(m.repairs, 0);
  }));

  it('4. Retry Case: tracks provider attempts and retries accurately', () => withFixture(async (root) => {
    let callCount = 0;
    const retryProvider = {
      name: 'retry-provider',
      async next() {
        callCount++;
        if (callCount === 1) {
          // Reports 2 attempts and 1 retry
          return {
            toolCalls: [{ name: 'read_slice', args: { path: 'src/greeting.txt', start: 0, length: 10 } }],
            usage: { inputTokens: 40, outputTokens: 10 },
            attempts: 2,
            retries: 1
          };
        }
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'Done' } }],
          usage: { inputTokens: 20, outputTokens: 5 },
          attempts: 1,
          retries: 0
        };
      }
    };

    const result = await runAssignment({
      id: 'retry-ledger-task',
      objective: 'Read file and submit',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, retryProvider, root, { isolated: true });

    const m = result.metrics;
    assert.equal(m.providerAttempts, 3, 'Total provider attempts must sum 2 + 1 = 3');
    assert.equal(m.successfulRequests, 2);
    assert.equal(m.retries, 1, 'Retries must count 1');
    assert.equal(m.failedAttempts, 1, 'Turn 1 had 1 retry failure');
    assert.equal(m.hasUnknownUsage, true, 'Retry failure introduces usage uncertainty');
    assert.equal(m.attempts.length, 3, 'All 3 attempts preserved in history');
    assert.equal(m.attempts[0].ok, false);
    assert.equal(m.attempts[0].status, 'retry_failure');
    assert.equal(m.attempts[1].ok, true);
    assert.equal(m.attempts[1].status, 'success');
    assert.equal(m.attempts[2].ok, true);
    assert.equal(m.attempts[2].status, 'success');
  }));

  it('5. Timeout Case: records failed attempt, marks usage unknown (never 0), and sets remoteUsageUncertain', () => withFixture(async (root) => {
    const timeoutProvider = {
      name: 'timeout-provider',
      async next() {
        const timeoutErr = new Error('HTTP request timed out');
        timeoutErr.name = 'TimeoutError';
        timeoutErr.attempts = 1;
        throw timeoutErr;
      }
    };

    const result = await runAssignment({
      id: 'timeout-ledger-task',
      objective: 'Run with timeout',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, timeoutProvider, root, { isolated: true });

    assert.equal(result.state, 'unknown');
    assert.equal(result.failureReason, 'transport_error');
    assert.equal(result.remoteUsageUncertain, true);

    const m = result.metrics;
    assert.equal(m.verified, false, 'Timed-out task is never verified');
    assert.equal(m.failedAttempts, 1);
    assert.equal(m.hasUnknownUsage, true);
    assert.equal(m.unknownUsage, true);
    assert.equal(m.unknownUsageAttempts, 1);

    // Unknown usage remains unknown, never 0
    assert.equal(m.inputTokens, 'unknown', 'Input tokens must report unknown, NEVER 0');
    assert.equal(m.outputTokens, 'unknown', 'Output tokens must report unknown, NEVER 0');
    assert.equal(m.totalTokens, 'unknown', 'Total tokens must report unknown, NEVER 0');
    assert.equal(m.knownInputTokens, 0);
    assert.equal(m.knownOutputTokens, 0);

    // Failed attempt retained in history
    assert.equal(m.attempts.length, 1);
    assert.equal(m.attempts[0].ok, false);
    assert.equal(m.attempts[0].status, 'failure');
    assert.equal(m.attempts[0].errorName, 'TimeoutError');
  }));

  it('6. Missing Usage Case: provider without usage metrics marks hasUnknownUsage, never claims 0 tokens', () => withFixture(async (root) => {
    const missingUsageProvider = {
      name: 'missing-usage-provider',
      async next() {
        // Omits response.usage completely
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'Finished without usage reported' } }]
        };
      }
    };

    const result = await runAssignment({
      id: 'missing-usage-task',
      objective: 'Test missing usage handling',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, missingUsageProvider, root, { isolated: true });

    assert.equal(result.remoteUsageUncertain, true);
    const m = result.metrics;
    assert.equal(m.hasUnknownUsage, true);
    assert.equal(m.unknownUsageAttempts, 1);
    assert.equal(m.inputTokens, 'unknown', 'Must not fabricate 0 tokens when usage is missing');
    assert.equal(m.outputTokens, 'unknown', 'Must not fabricate 0 tokens');
    assert.equal(m.totalTokens, 'unknown');
  }));

  it('7. No Doublecount on Rejected Tool: rejected tool is counted exactly once with 0 output bytes', () => withFixture(async (root) => {
    let turn = 0;
    const outOfScopeProvider = {
      name: 'unauthorized-tool-provider',
      async next() {
        turn++;
        if (turn === 1) {
          // Calling read_slice on an unauthorized, out-of-scope path
          return {
            toolCalls: [{ name: 'read_slice', args: { path: 'unauthorized/secret.txt', start: 0, length: 100 } }],
            usage: { inputTokens: 30, outputTokens: 10 }
          };
        }
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'Done' } }],
          usage: { inputTokens: 20, outputTokens: 5 }
        };
      }
    };

    const result = await runAssignment({
      id: 'rejected-tool-task',
      objective: 'Attempt out of scope tool',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, outOfScopeProvider, root, { isolated: true });

    assert.equal(result.state, 'failed');
    const m = result.metrics;

    // Total tool calls must be exactly 1 (the rejected tool invocation in turn 0)
    assert.equal(m.toolCalls, 1, 'Rejected tool call must be counted exactly once');
    assert.equal(m.toolCallsRejected, 1, 'Exactly one rejected tool call');
    assert.equal(m.toolCallsSucceeded, 0, 'Zero succeeded tool calls');
    assert.equal(m.toolOutputBytes, 0, 'Rejected tool output bytes must be strictly 0');
  }));

  it('8. Check Failures and Repairs: tracks failing checks and subsequent repairs across turns', () => withFixture(async (root) => {
    const repairProvider = new FakeProvider([
      { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'wrong\n' } },
      { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('wrong\n'), content: 'hello world\n' } },
      { name: 'submit_receipt', args: { summary: 'Repaired successfully' } }
    ]);

    const result = await runAssignment({
      id: 'repair-ledger-task',
      objective: 'Repair check failure',
      acceptance: 'Greeting equals hello world',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
    }, repairProvider, root, { isolated: true });

    assert.equal(result.state, 'review_ready');
    const m = result.metrics;
    assert.equal(m.verified, true);
    assert.ok(m.checkFailures >= 1, 'Check failure in turn 1 must be recorded');
    assert.equal(m.repairs, 1, 'Transition from failing to passing check must record exactly 1 repair');
    assert.ok(m.checkRuns >= 3, 'Checks evaluated after each propose_patch and at final review');
  }));

  it('9. Worker Claim Cannot Certify Verified Success: submit_receipt claim without valid patch fails verified', () => withFixture(async (root) => {
    const claimProvider = new FakeProvider([
      { name: 'submit_receipt', args: { summary: 'I claim 100% completion and perfect results!' } }
    ]);

    const result = await runAssignment({
      id: 'worker-claim-task',
      objective: 'Ensure empty diff cannot certify success',
      acceptance: 'Greeting equals hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello\n' }]
    }, claimProvider, root, { isolated: true });

    assert.equal(result.state, 'failed');
    assert.equal(result.failureReason, 'empty_effective_diff');
    assert.equal(result.workerSummary, 'I claim 100% completion and perfect results!');

    const m = result.metrics;
    assert.equal(m.verified, false, 'Worker summary claim alone must NEVER certify verified success');
    assert.equal(m.denominator, 1);
  }));

  it('10. Security & Privacy: metrics contain zero secrets, prompts, or source code', () => withFixture(async (root) => {
    const secretApiKey = 'gsk_super_secret_groq_api_token_12345';
    const bearerToken = 'Bearer secret_bearer_token_xyz';
    const confidentialPrompt = 'TOP_SECRET_PROMPT_CONTAINING_PROPRIETARY_DATA';
    const sourceCodeContent = 'SECRET_SOURCE_CODE_INTERNAL_LOGIC';

    await writeFile(path.join(root, 'src', 'greeting.txt'), `${sourceCodeContent}\n`);

    const secureProvider = {
      name: 'secure-provider',
      async next({ messages }) {
        // Echo a malformed error containing secrets
        const err = new Error(`Connection to ${secretApiKey} failed with authorization: ${bearerToken}`);
        err.name = 'ProviderTransportError';
        throw err;
      }
    };

    const result = await runAssignment({
      id: 'security-audit-task',
      objective: confidentialPrompt,
      acceptance: 'Contains confidential text',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: sourceCodeContent }]
    }, secureProvider, root, { isolated: true });

    const serializedMetrics = JSON.stringify(result.metrics);

    // Verify absence of sensitive tokens
    assert.ok(!serializedMetrics.includes(secretApiKey), 'API key must not leak into metrics');
    assert.ok(!serializedMetrics.includes('secret_bearer_token'), 'Bearer token must not leak into metrics');
    assert.ok(!serializedMetrics.includes(confidentialPrompt), 'User prompt must not leak into metrics');
    assert.ok(!serializedMetrics.includes(sourceCodeContent), 'Source code content must not leak into metrics');
  }));

  it('11. GroqProvider Retry Preservation: preserves failed attempt, retry count, and uncertain usage on success', () => withFixture(async (root) => {
    let attempts = 0;
    const provider = new GroqProvider({
      apiKey: 'test-key',
      retryDelayMs: 0,
      fetchImpl: async () => {
        attempts++;
        if (attempts === 1) {
          throw new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  function: {
                    name: 'submit_receipt',
                    arguments: JSON.stringify({ summary: 'Finished after retry' })
                  }
                }]
              }
            }],
            usage: { prompt_tokens: 35, completion_tokens: 12 }
          })
        };
      }
    });

    const result = await runAssignment({
      id: 'groq-retry-task',
      objective: 'Submit receipt with retry',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, provider, root, { isolated: true });

    assert.equal(attempts, 2, 'GroqProvider must execute 2 fetch attempts');
    assert.equal(result.remoteUsageUncertain, true, 'Receipt must flag remote usage as uncertain');
    const m = result.metrics;
    assert.equal(m.providerAttempts, 2, 'Total provider attempts must be 2');
    assert.equal(m.retries, 1, 'Retries must count 1');
    assert.equal(m.failedAttempts, 1, 'Failed attempts must count 1 for the retry failure');
    assert.equal(m.hasUnknownUsage, true);
    assert.equal(m.knownInputTokens, 35);
    assert.equal(m.knownOutputTokens, 12);
    assert.equal(m.inputTokens, '35+unknown');
    assert.equal(m.outputTokens, '12+unknown');
    assert.equal(m.totalTokens, '47+unknown');

    // Both attempt 1 and attempt 2 preserved in history
    assert.equal(m.attempts.length, 2);
    assert.equal(m.attempts[0].ok, false);
    assert.equal(m.attempts[0].status, 'retry_failure');
    assert.equal(m.attempts[0].errorName, 'ProviderTransportError');
    assert.equal(m.attempts[0].unknownUsage, true);

    assert.equal(m.attempts[1].ok, true);
    assert.equal(m.attempts[1].status, 'success');
    assert.equal(m.attempts[1].unknownUsage, true);
  }));

  it('12. Malformed Tool Call: retains measured usage on adapter parsing failure and response validation', () => withFixture(async (root) => {
    // 12a. Adapter parsing failure with measured usage
    const adapterErrorProvider = new GroqProvider({
      apiKey: 'test-key',
      retryDelayMs: 0,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: []
            }
          }],
          usage: { prompt_tokens: 17, completion_tokens: 9 }
        })
      })
    });

    const resultA = await runAssignment({
      id: 'malformed-adapter-task',
      objective: 'Run with malformed tool call',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, adapterErrorProvider, root, { isolated: true });

    assert.equal(resultA.state, 'failed');
    assert.equal(resultA.usage.inputTokens, 17, 'Measured input tokens must be retained');
    assert.equal(resultA.usage.outputTokens, 9, 'Measured output tokens must be retained');
    assert.equal(resultA.metrics.knownInputTokens, 17);
    assert.equal(resultA.metrics.knownOutputTokens, 9);
    assert.equal(resultA.metrics.hasUnknownUsage, true);
    assert.equal(resultA.metrics.inputTokens, '17+unknown');
    assert.equal(resultA.metrics.outputTokens, '9+unknown');
    assert.equal(resultA.metrics.attempts.length, 1);
    assert.equal(resultA.metrics.attempts[0].ok, false);
    assert.equal(resultA.metrics.attempts[0].status, 'failure');
    assert.equal(resultA.metrics.attempts[0].errorName, 'MalformedResponseError');

    // 12b. Provider response validation in index.js: malformed toolCalls shape with valid usage
    const malformedResponseProvider = {
      name: 'malformed-response-provider',
      async next() {
        return {
          toolCalls: null,
          usage: { inputTokens: 25, outputTokens: 11 }
        };
      }
    };

    const resultB = await runAssignment({
      id: 'malformed-response-task',
      objective: 'Run with invalid response shape',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, malformedResponseProvider, root, { isolated: true });

    assert.equal(resultB.state, 'failed');
    assert.equal(resultB.usage.inputTokens, 25, 'Measured input tokens must be retained');
    assert.equal(resultB.usage.outputTokens, 11, 'Measured output tokens must be retained');
    assert.equal(resultB.metrics.knownInputTokens, 25);
    assert.equal(resultB.metrics.knownOutputTokens, 11);
    assert.equal(resultB.metrics.hasUnknownUsage, true);
    assert.equal(resultB.metrics.inputTokens, '25+unknown');
    assert.equal(resultB.metrics.outputTokens, '11+unknown');
    assert.equal(resultB.metrics.attempts[0].errorName, 'MalformedResponseError');
  }));

  it('13. Strict Integer Typing: rejects null, booleans, strings, never fabricates 0 known tokens', () => withFixture(async (root) => {
    // Direct unit checks on isLiteralNonNegativeInteger
    assert.equal(isLiteralNonNegativeInteger(0), true);
    assert.equal(isLiteralNonNegativeInteger(42), true);
    assert.equal(isLiteralNonNegativeInteger(null), false);
    assert.equal(isLiteralNonNegativeInteger(undefined), false);
    assert.equal(isLiteralNonNegativeInteger(false), false);
    assert.equal(isLiteralNonNegativeInteger(true), false);
    assert.equal(isLiteralNonNegativeInteger(''), false);
    assert.equal(isLiteralNonNegativeInteger('0'), false);
    assert.equal(isLiteralNonNegativeInteger('10'), false);
    assert.equal(isLiteralNonNegativeInteger(NaN), false);
    assert.equal(isLiteralNonNegativeInteger(Infinity), false);
    assert.equal(isLiteralNonNegativeInteger(-1), false);
    assert.equal(isLiteralNonNegativeInteger(1.5), false);

    // Runtime integration: provider returning null/boolean tokens
    const nonIntegerProvider = {
      name: 'non-integer-provider',
      async next() {
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'Done' } }],
          usage: { inputTokens: null, outputTokens: false }
        };
      }
    };

    const result = await runAssignment({
      id: 'non-integer-tokens-task',
      objective: 'Test non-integer token handling',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, nonIntegerProvider, root, { isolated: true });

    const m = result.metrics;
    assert.equal(m.knownInputTokens, 0);
    assert.equal(m.knownOutputTokens, 0);
    assert.equal(m.hasUnknownUsage, true);
    assert.equal(m.inputTokens, 'unknown', 'null token must NEVER fabricate 0 known tokens');
    assert.equal(m.outputTokens, 'unknown', 'boolean token must NEVER fabricate 0 known tokens');
    assert.equal(m.totalTokens, 'unknown');
  }));

  it('14. Secret Canary Metrics: error names sanitized against frozen allowlist, canaries mapped to UnknownError', () => withFixture(async (root) => {
    // Direct unit checks on classifyError and ALLOWED_ERROR_CLASSIFICATIONS
    assert.equal(Object.isFrozen(ALLOWED_ERROR_CLASSIFICATIONS), true);
    for (const name of ALLOWED_ERROR_CLASSIFICATIONS) {
      assert.equal(classifyError(name), name);
    }
    assert.equal(classifyError('Bearer canary_secret_token_12345'), 'UnknownError');
    assert.equal(classifyError('SomeRandomCustomError'), 'UnknownError');
    assert.equal(classifyError(null), 'UnknownError');
    assert.equal(classifyError(undefined), 'UnknownError');
    assert.equal(classifyError(123), 'UnknownError');

    // Runtime integration: provider throwing synthetic bearer token canary in error.name
    const canaryProvider = {
      name: 'canary-provider',
      async next() {
        const err = new Error('Canary test failure');
        err.name = 'Bearer canary_secret_leak_attempt_98765';
        throw err;
      }
    };

    const result = await runAssignment({
      id: 'canary-audit-task',
      objective: 'Audit secret canary in error.name',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, canaryProvider, root, { isolated: true });

    const m = result.metrics;
    assert.equal(m.attempts.length, 1);
    assert.equal(m.attempts[0].errorName, 'UnknownError', 'Canary in error.name must be mapped to UnknownError');

    const serializedMetrics = JSON.stringify(m);
    assert.ok(!serializedMetrics.includes('canary_secret'), 'Canary must not appear in metrics');
    assert.ok(!serializedMetrics.includes('leak_attempt'), 'Canary string must not appear in metrics');
  }));

  it('15. GroqProvider Body Decode Error: preserves transport retry and marks MalformedResponseError on invalid JSON', () => withFixture(async (root) => {
    let attempts = 0;
    const provider = new GroqProvider({
      apiKey: 'test-key',
      retryDelayMs: 0,
      fetchImpl: async () => {
        attempts++;
        if (attempts === 1) {
          throw new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
        }
        return {
          ok: true,
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON at position 0');
          }
        };
      }
    });

    const result = await runAssignment({
      id: 'groq-body-decode-retry-task',
      objective: 'Handle invalid JSON after retry',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, provider, root, { isolated: true });

    assert.equal(attempts, 2, 'Must have made 2 HTTP attempts');
    assert.equal(result.state, 'failed');
    const m = result.metrics;
    assert.equal(m.providerAttempts, 2, 'Total provider attempts must be 2');
    assert.equal(m.retries, 1, 'Retries must count 1');
    assert.equal(m.failedAttempts, 2, 'Failed attempts must count 2 (1 retry failure + 1 decode failure)');
    assert.equal(m.hasUnknownUsage, true);
    assert.equal(m.attempts.length, 2);
    assert.equal(m.attempts[0].ok, false);
    assert.equal(m.attempts[0].status, 'retry_failure');
    assert.equal(m.attempts[0].errorName, 'ProviderTransportError');
    assert.equal(m.attempts[1].ok, false);
    assert.equal(m.attempts[1].status, 'failure');
    assert.equal(m.attempts[1].errorName, 'MalformedResponseError');
  }));

  it('16. AbortSignal Boundary: cancellation during delayed provider settles unknown with failureReason: aborted and no tool effects', () => withFixture(async (root) => {
    const controller = new AbortController();
    let providerCalled = false;

    const delayedProvider = {
      name: 'delayed-provider',
      async next({ signal }) {
        providerCalled = true;
        assert.ok(signal, 'AbortSignal must be passed to provider.next');
        controller.abort();
        if (signal.aborted) {
          const err = new Error('Operation aborted');
          err.name = 'AbortError';
          throw err;
        }
        return {
          toolCalls: [{ name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'should not happen\n' } }],
          usage: { inputTokens: 10, outputTokens: 5 }
        };
      }
    };

    const result = await runAssignment({
      id: 'abort-during-provider-task',
      objective: 'Test cancellation during provider',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, delayedProvider, root, {
      isolated: true,
      signal: controller.signal
    });

    assert.equal(providerCalled, true, 'Provider was invoked');
    assert.equal(result.state, 'unknown', 'State must be unknown on cancellation');
    assert.equal(result.failureReason, 'aborted', 'failureReason must be aborted');
    assert.equal(result.remoteUsageUncertain, true, 'Remote usage must be uncertain');
    assert.equal(result.metrics.verified, false, 'Aborted task is never verified');
    assert.equal(result.patches.length, 0, 'No patch must be applied');

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path.join(root, 'src', 'greeting.txt'), 'utf8');
    assert.equal(content, 'hello\n', 'File content must not be modified');
  }));

  it('17. AbortSignal Boundary: cancellation before tool execution halts with no tool side-effects', () => withFixture(async (root) => {
    const controller = new AbortController();
    let toolAttempted = false;

    const registry = createDefaultRegistry();
    const originalPropose = registry.tools.get('propose_patch');
    registry.tools.set('propose_patch', {
      ...originalPropose,
      async execute(args, context) {
        toolAttempted = true;
        return originalPropose.execute(args, context);
      }
    });

    const provider = {
      name: 'tool-triggering-provider',
      async next() {
        controller.abort();
        return {
          toolCalls: [{ name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'unauthorized patch\n' } }],
          usage: { inputTokens: 15, outputTokens: 8 }
        };
      }
    };

    const result = await runAssignment({
      id: 'abort-before-tool-task',
      objective: 'Test cancellation before tool execution',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, provider, root, {
      isolated: true,
      signal: controller.signal,
      registry
    });

    assert.equal(result.state, 'unknown');
    assert.equal(result.failureReason, 'aborted');
    assert.equal(toolAttempted, false, 'propose_patch must NOT execute after signal is aborted');
    assert.equal(result.patches.length, 0, 'Zero patches recorded');

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path.join(root, 'src', 'greeting.txt'), 'utf8');
    assert.equal(content, 'hello\n', 'File content must remain original');
  }));

  it('18. AbortSignal Boundary: pre-aborted signal settles immediately with 0 requests and 0 tool calls', () => withFixture(async (root) => {
    const controller = new AbortController();
    controller.abort();

    let providerCalled = false;
    const provider = {
      name: 'never-called-provider',
      async next() {
        providerCalled = true;
        return { toolCalls: [], usage: {} };
      }
    };

    const result = await runAssignment({
      id: 'pre-aborted-task',
      objective: 'Test pre-aborted signal',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, provider, root, {
      isolated: true,
      signal: controller.signal
    });

    assert.equal(providerCalled, false, 'Provider must never be called on pre-aborted signal');
    assert.equal(result.state, 'unknown');
    assert.equal(result.failureReason, 'aborted');
    assert.equal(result.usage.requests, 0, '0 requests made');
    assert.equal(result.metrics.toolCalls, 0, '0 tool calls');
    assert.equal(result.metrics.verified, false);
  }));

  it('19. AbortSignal Boundary: delayed provider completion after abort with measured usage retains tokens and suppresses tools', () => withFixture(async (root) => {
    const controller = new AbortController();
    let toolAttempted = false;

    const registry = createDefaultRegistry();
    const originalPropose = registry.tools.get('propose_patch');
    registry.tools.set('propose_patch', {
      ...originalPropose,
      async execute(args, context) {
        toolAttempted = true;
        return originalPropose.execute(args, context);
      }
    });

    const delayedProvider = {
      name: 'delayed-measured-provider',
      async next({ signal }) {
        assert.ok(signal, 'AbortSignal must be passed to provider.next');
        controller.abort();
        return {
          toolCalls: [{ name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'late content\n' } }],
          usage: { inputTokens: 11, outputTokens: 7 },
          attempts: 1,
          retries: 0
        };
      }
    };

    const result = await runAssignment({
      id: 'abort-delayed-measured-task',
      objective: 'Test late provider accounting with measured tokens',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, delayedProvider, root, {
      isolated: true,
      signal: controller.signal,
      registry
    });

    assert.equal(result.state, 'unknown');
    assert.equal(result.failureReason, 'aborted');
    assert.equal(toolAttempted, false, 'propose_patch tool must NOT be executed after abort');
    assert.equal(result.patches.length, 0, 'No patches applied');
    assert.equal(result.metrics.toolCalls, 0, 'Zero tool calls recorded in metrics');

    // Token & provider accounting on late response
    assert.equal(result.usage.inputTokens, 11, 'Raw input tokens must be accumulated');
    assert.equal(result.usage.outputTokens, 7, 'Raw output tokens must be accumulated');
    assert.equal(result.usage.requests, 1, 'Requests count must be 1');
    assert.equal(result.metrics.providerAttempts, 1, 'Provider attempts must be 1');
    assert.equal(result.metrics.successfulRequests, 1, 'Successful requests must be 1');
    assert.equal(result.metrics.hasUnknownUsage, true, 'hasUnknownUsage must be true due to abort');
    assert.equal(result.metrics.inputTokens, '11+unknown', 'Input tokens must reflect measured+unknown');
    assert.equal(result.metrics.outputTokens, '7+unknown', 'Output tokens must reflect measured+unknown');
    assert.equal(result.metrics.verified, false, 'Aborted run cannot be verified');
    assert.equal(result.remoteUsageUncertain, true, 'remoteUsageUncertain must be true');

    // Workspace untouched
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path.join(root, 'src', 'greeting.txt'), 'utf8');
    assert.equal(content, 'hello\n', 'File content must not be modified');
  }));

  it('20. AbortSignal Boundary: delayed provider completion after abort with missing usage records providerAttempts and unknown tokens', () => withFixture(async (root) => {
    const controller = new AbortController();
    let toolAttempted = false;

    const registry = createDefaultRegistry();
    const originalPropose = registry.tools.get('propose_patch');
    registry.tools.set('propose_patch', {
      ...originalPropose,
      async execute(args, context) {
        toolAttempted = true;
        return originalPropose.execute(args, context);
      }
    });

    const delayedProvider = {
      name: 'delayed-missing-usage-provider',
      async next({ signal }) {
        assert.ok(signal, 'AbortSignal must be passed to provider.next');
        controller.abort();
        return {
          toolCalls: [{ name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'late content\n' } }],
          usage: null,
          attempts: 1,
          retries: 0
        };
      }
    };

    const result = await runAssignment({
      id: 'abort-delayed-missing-usage-task',
      objective: 'Test late provider accounting with missing usage',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, delayedProvider, root, {
      isolated: true,
      signal: controller.signal,
      registry
    });

    assert.equal(result.state, 'unknown');
    assert.equal(result.failureReason, 'aborted');
    assert.equal(toolAttempted, false, 'propose_patch tool must NOT be executed after abort');
    assert.equal(result.patches.length, 0, 'No patches applied');
    assert.equal(result.metrics.toolCalls, 0, 'Zero tool calls recorded in metrics');

    // Missing usage accounting on late response
    assert.equal(result.usage.inputTokens, 0);
    assert.equal(result.usage.outputTokens, 0);
    assert.equal(result.usage.requests, 1);
    assert.equal(result.metrics.providerAttempts, 1, 'Provider attempts must be 1');
    assert.equal(result.metrics.successfulRequests, 1, 'Successful requests must be 1');
    assert.equal(result.metrics.hasUnknownUsage, true, 'hasUnknownUsage must be true');
    assert.equal(result.metrics.inputTokens, 'unknown', 'Input tokens must be unknown without measured tokens');
    assert.equal(result.metrics.outputTokens, 'unknown', 'Output tokens must be unknown without measured tokens');
    assert.equal(result.metrics.verified, false);
    assert.equal(result.remoteUsageUncertain, true);

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path.join(root, 'src', 'greeting.txt'), 'utf8');
    assert.equal(content, 'hello\n');
  }));

  it('21. AbortSignal Boundary: abort during async patch preparation in proposePatch prevents disk write and post-patch checks', () => withFixture(async (root) => {
    const controller = new AbortController();
    const registry = createDefaultRegistry();
    const originalPropose = registry.tools.get('propose_patch');
    let verifyRan = false;

    registry.tools.set('propose_patch', {
      ...originalPropose,
      async execute(args, context) {
        const origVerify = context.verify;
        context.verify = async (...vArgs) => {
          verifyRan = true;
          return origVerify(...vArgs);
        };

        const origResolve = context.workspace.resolveFile.bind(context.workspace);
        let resolveCount = 0;
        context.workspace.resolveFile = async (...rArgs) => {
          resolveCount++;
          const res = await origResolve(...rArgs);
          if (resolveCount === 2) {
            controller.abort();
          }
          return res;
        };
        return originalPropose.execute(args, context);
      }
    });

    const provider = {
      name: 'patching-provider',
      async next() {
        return {
          toolCalls: [{
            name: 'propose_patch',
            args: {
              path: 'src/greeting.txt',
              expectedSha256: sha256('hello\n'),
              content: 'mutated content\n'
            }
          }],
          usage: { inputTokens: 20, outputTokens: 10 }
        };
      }
    };

    const result = await runAssignment({
      id: 'abort-during-patch-prep-task',
      objective: 'Test abort during async patch preparation',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, provider, root, {
      isolated: true,
      signal: controller.signal,
      registry
    });

    assert.equal(result.state, 'unknown', 'State must be unknown');
    assert.equal(result.failureReason, 'aborted', 'failureReason must be aborted');
    assert.equal(result.patches.length, 0, 'Zero patches recorded');
    assert.equal(verifyRan, false, 'Checks must NOT run after abort');
    assert.equal(result.metrics.toolCalls, 1, 'propose_patch was attempted and aborted');
    assert.equal(result.metrics.toolCallsRejected, 1, 'propose_patch aborted counts as rejected');
    assert.equal(result.metrics.toolCallsSucceeded, 0);
    assert.equal(result.metrics.toolOutputBytes, 0);

    const { readFile } = await import('node:fs/promises');
    const diskContent = await readFile(path.join(root, 'src', 'greeting.txt'), 'utf8');
    assert.equal(diskContent, 'hello\n', 'File on disk must remain unchanged (writeFile never called)');
  }));

  it('22. AbortSignal Boundary: return-after-abort completed tool records execution and output in ledger exactly once before abort settlement', () => withFixture(async (root) => {
    const controller = new AbortController();
    let secondProviderTurnAttempted = false;

    const registry = createDefaultRegistry();
    const originalList = registry.tools.get('list_paths');
    registry.tools.set('list_paths', {
      ...originalList,
      async execute(args, context) {
        const res = await originalList.execute(args, context);
        // Abort occurs immediately upon tool completion before the runner settles
        controller.abort();
        return res;
      }
    });

    const provider = {
      name: 'multi-turn-provider',
      turnCount: 0,
      async next() {
        this.turnCount++;
        if (this.turnCount === 1) {
          return {
            toolCalls: [{ name: 'list_paths', args: {} }],
            usage: { inputTokens: 12, outputTokens: 6 }
          };
        }
        secondProviderTurnAttempted = true;
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'done' } }],
          usage: { inputTokens: 5, outputTokens: 2 }
        };
      }
    };

    const result = await runAssignment({
      id: 'abort-after-completed-tool-task',
      objective: 'Test completed tool accounting before abort settlement',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, provider, root, {
      isolated: true,
      signal: controller.signal,
      registry
    });

    // Abort settlement guarantees
    assert.equal(result.state, 'unknown', 'State must settle unknown on abort');
    assert.equal(result.failureReason, 'aborted', 'failureReason must be aborted');
    assert.equal(result.remoteUsageUncertain, true, 'remoteUsageUncertain must be true');
    assert.equal(result.metrics.verified, false, 'Aborted run cannot be verified');
    assert.equal(secondProviderTurnAttempted, false, 'Subsequent turns must be suppressed');

    // Completed tool accounting: exactly once, succeeded with output bytes
    assert.equal(result.metrics.toolCalls, 1, 'Tool call count must be exactly 1');
    assert.equal(result.metrics.toolCallsSucceeded, 1, 'Tool call must be recorded as succeeded');
    assert.equal(result.metrics.toolCallsRejected, 0, 'No tool calls rejected');
    assert.ok(result.metrics.toolOutputBytes > 0, 'Tool output bytes must be recorded > 0');
    assert.equal(result.ledger.toolCallsByName.get('list_paths').calls, 1);
    assert.equal(result.ledger.toolCallsByName.get('list_paths').succeeded, 1);

    // Events and usage
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].tool, 'list_paths');
    assert.equal(result.events[0].ok, true);
    assert.equal(result.usage.inputTokens, 12);
    assert.equal(result.usage.outputTokens, 6);
  }));

  it('23. AbortSignal Boundary: thrown-aborted tool records exactly one rejected tool call with 0 output bytes before abort settlement', () => withFixture(async (root) => {
    const controller = new AbortController();
    let secondProviderTurnAttempted = false;

    const registry = createDefaultRegistry();
    const originalRead = registry.tools.get('read_slice');
    registry.tools.set('read_slice', {
      ...originalRead,
      async execute(args, context) {
        controller.abort();
        const err = new Error('Operation aborted');
        err.name = 'AbortError';
        throw err;
      }
    });

    const provider = {
      name: 'read-slice-provider',
      turnCount: 0,
      async next() {
        this.turnCount++;
        if (this.turnCount === 1) {
          return {
            toolCalls: [{ name: 'read_slice', args: { path: 'src/greeting.txt' } }],
            usage: { inputTokens: 14, outputTokens: 8 }
          };
        }
        secondProviderTurnAttempted = true;
        return {
          toolCalls: [{ name: 'submit_receipt', args: { summary: 'done' } }],
          usage: { inputTokens: 5, outputTokens: 2 }
        };
      }
    };

    const result = await runAssignment({
      id: 'abort-thrown-tool-task',
      objective: 'Test thrown aborted tool accounting before abort settlement',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, provider, root, {
      isolated: true,
      signal: controller.signal,
      registry
    });

    // Abort settlement guarantees
    assert.equal(result.state, 'unknown', 'State must settle unknown on abort');
    assert.equal(result.failureReason, 'aborted', 'failureReason must be aborted');
    assert.equal(result.remoteUsageUncertain, true, 'remoteUsageUncertain must be true');
    assert.equal(result.metrics.verified, false, 'Aborted run cannot be verified');
    assert.equal(secondProviderTurnAttempted, false, 'Subsequent turns must be suppressed');

    // Thrown tool accounting: exactly once, rejected with 0 output bytes
    assert.equal(result.metrics.toolCalls, 1, 'Tool call count must be exactly 1');
    assert.equal(result.metrics.toolCallsSucceeded, 0, 'Succeeded count must be 0');
    assert.equal(result.metrics.toolCallsRejected, 1, 'Tool call must be recorded as rejected');
    assert.equal(result.metrics.toolOutputBytes, 0, 'Tool output bytes must be strictly 0');
    assert.equal(result.ledger.toolCallsByName.get('read_slice').calls, 1);
    assert.equal(result.ledger.toolCallsByName.get('read_slice').rejected, 1);

    // Events and usage
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].tool, 'read_slice');
    assert.equal(result.events[0].ok, false);
    assert.equal(result.events[0].error, 'Operation aborted');
    assert.equal(result.usage.inputTokens, 14);
    assert.equal(result.usage.outputTokens, 8);
  }));

  it('24. AbortSignal Boundary: aborted provider error carrying 2 attempts, 1 retry, and measured tokens preserves accounting exactly once with no effects', () => withFixture(async (root) => {
    const controller = new AbortController();
    let providerCalls = 0;

    const retryAbortProvider = {
      name: 'retry-abort-provider',
      async next({ signal }) {
        providerCalls++;
        controller.abort();
        const err = new Error('Transport abort after retry');
        err.name = 'AbortError';
        err.attempts = 2;
        err.retries = 1;
        err.usage = { inputTokens: 25, outputTokens: 15 };
        throw err;
      }
    };

    const result = await runAssignment({
      id: 'abort-retry-provider-task',
      objective: 'Test aborted provider carrying attempts, retries, and measured tokens',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, retryAbortProvider, root, {
      isolated: true,
      signal: controller.signal
    });

    // Abort settlement guarantees
    assert.equal(result.state, 'unknown', 'State must settle unknown on abort');
    assert.equal(result.failureReason, 'aborted', 'failureReason must be aborted');
    assert.equal(result.remoteUsageUncertain, true, 'remoteUsageUncertain must be true');
    assert.equal(result.metrics.verified, false, 'Aborted run cannot be verified');

    // Dispatched calls count
    assert.equal(providerCalls, 1, 'Provider must have been called exactly once');
    assert.equal(result.usage.requests, 1, 'Only actual dispatched calls counted in requests');
    assert.equal(result.metrics.successfulRequests, 0, 'Zero successful requests');

    // Token accounting: measured tokens preserved from error.usage
    assert.equal(result.usage.inputTokens, 25, 'Input tokens preserved in raw usage');
    assert.equal(result.usage.outputTokens, 15, 'Output tokens preserved in raw usage');
    assert.equal(result.metrics.knownInputTokens, 25);
    assert.equal(result.metrics.knownOutputTokens, 15);
    assert.equal(result.metrics.hasUnknownUsage, true, 'hasUnknownUsage must be true');
    assert.equal(result.metrics.inputTokens, '25+unknown', 'Metric tokens reflect known+unknown');
    assert.equal(result.metrics.outputTokens, '15+unknown', 'Metric tokens reflect known+unknown');

    // Attempts and retries preserved
    assert.equal(result.metrics.providerAttempts, 2, '2 attempts preserved from error');
    assert.equal(result.metrics.retries, 1, '1 retry preserved from error');
    assert.equal(result.metrics.failedAttempts, 2, 'Both attempts counted as failed');

    // Attempt history in ledger
    assert.equal(result.ledger.attempts.length, 2, '2 attempt history entries in ledger');
    assert.equal(result.ledger.attempts[0].ok, false);
    assert.equal(result.ledger.attempts[0].status, 'retry_failure');
    assert.equal(result.ledger.attempts[0].errorName, 'ProviderTransportError');
    assert.equal(result.ledger.attempts[1].ok, false);
    assert.equal(result.ledger.attempts[1].status, 'failure');
    assert.equal(result.ledger.attempts[1].errorName, 'AbortError');

    // Zero tool effects
    assert.equal(result.metrics.toolCalls, 0, 'Zero tool calls executed');
    assert.equal(result.patches.length, 0, 'Zero patches recorded');

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path.join(root, 'src', 'greeting.txt'), 'utf8');
    assert.equal(content, 'hello\n', 'File on disk must remain unchanged');
  }));
});
