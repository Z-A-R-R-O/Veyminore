/**
 * Model Providers - RCT Runtime Conformance Test Suite (W5-AGR4)
 *
 * Verifies end-to-end integration between ConfiguredModelProvider and RCT's
 * public runAssignment entrypoint using isolated snapshots and injected synthetic
 * network/credentials only.
 *
 * Verifies:
 * - Tool schema negotiation and multi-turn execution (read_slice -> propose_patch -> submit_receipt)
 * - Review-ready completion with independent check validation
 * - Source isolation: original source root remains 100% untouched
 * - Token usage accounting propagation to RCT UsageLedger without loss
 * - Transport attempts and retries propagation without lost attempts
 * - AbortSignal propagation and clean cancellation handling
 * - Disabled live inference gate fail-closed (0 mocked fetch)
 * - Current proof exact identity gate fail-closed (0 mocked fetch)
 * - Zero live network calls, zero actualenv reads
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createConfiguredProvider,
  createModelCatalogPort,
  APPROVED_ENDPOINTS,
  ModelDiscoveryService
} from '../src/index.js';

import { loadProviderConfig } from '../../provider-config/src/loader.js';
import { runAssignment, createSnapshot, sha256 } from '../../rct-runtime/src/index.js';

/**
 * Creates an authentic ephemeral discovery snapshot using ModelDiscoveryService
 * with injected synthetic fetch to simulate real remote discovery.
 */
async function createSyntheticDiscoverySnapshot({
  provider = 'groq',
  modelId = 'qwen/qwen3.8-27b',
  apiKey = 'gsk_synthetic_key_123',
  contextLength = 131072,
  ttlMs = 60000
} = {}) {
  const discovery = new ModelDiscoveryService({ defaultTtlMs: ttlMs });
  const mockDiscoveryFetch = async (url) => {
    if (url === APPROVED_ENDPOINTS[provider]?.models) {
      return {
        ok: true,
        json: async () => ({
          data: [{
            id: modelId,
            context_length: contextLength,
            pricing: { prompt: '0', completion: '0' },
            supported_parameters: ['tools', 'max_tokens']
          }]
        })
      };
    }
    throw new Error(`Unexpected discovery URL: ${url}`);
  };

  return await discovery.discoverModel({
    provider,
    modelId,
    apiKey,
    allowLiveCalls: true,
    fetchImpl: mockDiscoveryFetch,
    ttlMs
  });
}

/**
 * Sets up a synthetic source workspace fixture in a temp directory.
 */
async function withSourceWorkspace(fn) {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'rct-conf-src-'));
  try {
    await mkdir(path.join(sourceRoot, 'src'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'hello\n');
    return await fn(sourceRoot);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
}

test('Configured provider -> RCT runAssignment offline success: tools, usage, and source untouched', () => withSourceWorkspace(async (sourceRoot) => {
  const allowedPaths = ['src/greeting.txt'];
  const snapshotWorkspace = await createSnapshot(sourceRoot, allowedPaths);

  try {
    const syntheticKey = 'gsk_fixture_secret_conformance_key_778899';
    const baseEnv = {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: syntheticKey,
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    };

    const config = loadProviderConfig({
      env: baseEnv,
      catalogPort: createModelCatalogPort()
    });

    const discoverySnapshot = await createSyntheticDiscoverySnapshot({
      provider: 'groq',
      modelId: 'qwen/qwen3.8-27b',
      apiKey: syntheticKey
    });

    const dispatchedRequests = [];

    // Mock chat fetch simulating Groq OpenAI-compatible responses across 3 turns
    let turnCount = 0;
    const mockChatFetch = async (url, opts) => {
      turnCount++;
      dispatchedRequests.push({ url, opts, body: JSON.parse(opts.body) });

      assert.equal(url, APPROVED_ENDPOINTS.groq.chat);
      assert.equal(opts.redirect, 'error');

      const body = JSON.parse(opts.body);
      assert.equal(body.model, 'qwen/qwen3.8-27b');
      assert.ok(Array.isArray(body.tools));
      assert.ok(body.tools.some(t => t.function.name === 'read_slice'));
      assert.ok(body.tools.some(t => t.function.name === 'propose_patch'));
      assert.ok(body.tools.some(t => t.function.name === 'submit_receipt'));

      if (turnCount === 1) {
        // Turn 1: Inspect greeting.txt via read_slice
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: 'assistant',
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'read_slice',
                    arguments: JSON.stringify({ path: 'src/greeting.txt', start: 0, length: 100 })
                  }
                }]
              }
            }],
            usage: { prompt_tokens: 30, completion_tokens: 10 }
          })
        };
      }

      if (turnCount === 2) {
        // Turn 2: Apply patch via propose_patch
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: 'assistant',
                tool_calls: [{
                  id: 'call_2',
                  type: 'function',
                  function: {
                    name: 'propose_patch',
                    arguments: JSON.stringify({
                      path: 'src/greeting.txt',
                      expectedSha256: sha256('hello\n'),
                      content: 'hello world\n'
                    })
                  }
                }]
              }
            }],
            usage: { prompt_tokens: 45, completion_tokens: 15 }
          })
        };
      }

      if (turnCount === 3) {
        // Turn 3: Submit receipt
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: 'assistant',
                tool_calls: [{
                  id: 'call_3',
                  type: 'function',
                  function: {
                    name: 'submit_receipt',
                    arguments: JSON.stringify({ summary: 'Updated greeting to hello world' })
                  }
                }]
              }
            }],
            usage: { prompt_tokens: 20, completion_tokens: 5 }
          })
        };
      }

      throw new Error(`Unexpected turnCount ${turnCount}`);
    };

    const provider = createConfiguredProvider({
      config,
      snapshot: discoverySnapshot,
      allowLiveCalls: true,
      fetchImpl: mockChatFetch
    });

    const assignment = {
      id: 'rct-conformance-task',
      objective: 'Update fixture greeting to hello world',
      acceptance: 'Greeting file contains hello world',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }],
      budget: { maxTurns: 10, maxWallMs: 30000, maxInputTokens: 50000, maxOutputTokens: 10000 }
    };

    const result = await runAssignment(assignment, provider, snapshotWorkspace.root, { isolated: true });

    // 1. Verify task outcome
    assert.equal(result.state, 'review_ready', 'Task must reach review_ready state');
    assert.equal(result.checks.length, 1);
    assert.equal(result.checks[0].passed, true, 'Independent check must pass');
    assert.equal(result.patches.length, 1);
    assert.equal(result.workerSummary, 'Updated greeting to hello world');

    // 2. Verify token usage accounting propagation without loss
    assert.equal(result.usage.requests, 3);
    assert.equal(result.usage.inputTokens, 95, 'Input tokens must sum accurately (30 + 45 + 20 = 95)');
    assert.equal(result.usage.outputTokens, 30, 'Output tokens must sum accurately (10 + 15 + 5 = 30)');

    // 3. Verify ledger captured all three turns with valid usage and attempts
    assert.equal(result.ledger.requests, 3);
    assert.equal(result.ledger.providerAttempts, 3);
    assert.equal(result.ledger.retries, 0);
    assert.equal(result.ledger.knownInputTokens, 95);
    assert.equal(result.ledger.knownOutputTokens, 30);
    assert.equal(result.ledger.attempts.length, 3);
    assert.equal(result.ledger.attempts[0].ok, true);
    assert.equal(result.ledger.attempts[1].ok, true);
    assert.equal(result.ledger.attempts[2].ok, true);

    // 4. Verify source isolation: original source remains 100% unchanged
    const sourceIsUnchanged = await snapshotWorkspace.sourceUnchanged();
    assert.equal(sourceIsUnchanged, true, 'Snapshot isolation: original source must be untouched');
    const sourceContent = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8');
    assert.equal(sourceContent, 'hello\n', 'Source file content must remain hello\\n');

    // 5. Verify isolated workspace was updated
    const snapshotContent = await readFile(path.join(snapshotWorkspace.root, 'src', 'greeting.txt'), 'utf8');
    assert.equal(snapshotContent, 'hello world\n', 'Isolated workspace must contain hello world\\n');

    // 6. Verify zero credential leakage
    const serializedResult = JSON.stringify(result);
    assert.ok(!serializedResult.includes(syntheticKey), 'API key must not leak into result serialization');
  } finally {
    await snapshotWorkspace.dispose();
  }
}));

test('Attempts and retries propagate to RCT usage ledger without lost attempts on transient retry', () => withSourceWorkspace(async (sourceRoot) => {
  const allowedPaths = ['src/greeting.txt'];
  const snapshotWorkspace = await createSnapshot(sourceRoot, allowedPaths);

  try {
    const syntheticKey = 'gsk_fixture_secret_retry_key_445566';
    const baseEnv = {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: syntheticKey,
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    };

    const config = loadProviderConfig({
      env: baseEnv,
      catalogPort: createModelCatalogPort()
    });

    const discoverySnapshot = await createSyntheticDiscoverySnapshot({
      provider: 'groq',
      modelId: 'qwen/qwen3.8-27b',
      apiKey: syntheticKey
    });

    let fetchAttempts = 0;
    const mockFetchWithRetry = async (url) => {
      fetchAttempts++;
      if (fetchAttempts === 1) {
        // Attempt 1: Transient network reset
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
        });
      }

      // Attempt 2: Succeeds on retry
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [{
                id: 'call_retry',
                type: 'function',
                function: {
                  name: 'read_slice',
                  arguments: JSON.stringify({ path: 'src/greeting.txt' })
                }
              }]
            }
          }],
          usage: { prompt_tokens: 25, completion_tokens: 12 }
        })
      };
    };

    const provider = createConfiguredProvider({
      config,
      snapshot: discoverySnapshot,
      allowLiveCalls: true,
      fetchImpl: mockFetchWithRetry,
      retryDelayMs: 1
    });

    const assignment = {
      id: 'rct-retry-task',
      objective: 'Read greeting',
      acceptance: 'Read completed',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello\n' }],
      budget: { maxTurns: 1, maxWallMs: 10000, maxInputTokens: 50000, maxOutputTokens: 10000 }
    };

    const result = await runAssignment(assignment, provider, snapshotWorkspace.root, { isolated: true });

    // Verify 2 network attempts were made
    assert.equal(fetchAttempts, 2);

    // Verify RCT ledger accurately records 2 attempts and 1 retry without loss
    assert.equal(result.ledger.providerAttempts, 2, 'UsageLedger must record 2 attempts (no lost attempts)');
    assert.equal(result.ledger.retries, 1, 'UsageLedger must record 1 retry');
    assert.equal(result.ledger.attempts.length, 2);
    assert.equal(result.ledger.attempts[0].ok, false);
    assert.equal(result.ledger.attempts[0].status, 'retry_failure');
    assert.equal(result.ledger.attempts[1].ok, true);
    assert.equal(result.ledger.attempts[1].status, 'success');
    assert.equal(result.usage.inputTokens, 25);
    assert.equal(result.usage.outputTokens, 12);
  } finally {
    await snapshotWorkspace.dispose();
  }
}));

test('Abort signal propagation: cancels execution cleanly and transitions to state unknown/aborted', () => withSourceWorkspace(async (sourceRoot) => {
  const allowedPaths = ['src/greeting.txt'];
  const snapshotWorkspace = await createSnapshot(sourceRoot, allowedPaths);

  try {
    const syntheticKey = 'gsk_fixture_secret_abort_key_112233';
    const baseEnv = {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: syntheticKey,
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    };

    const config = loadProviderConfig({
      env: baseEnv,
      catalogPort: createModelCatalogPort()
    });

    const discoverySnapshot = await createSyntheticDiscoverySnapshot({
      provider: 'groq',
      modelId: 'qwen/qwen3.8-27b',
      apiKey: syntheticKey
    });

    const abortController = new AbortController();

    const mockFetchWithAbort = async () => {
      // Trigger abort while request is in flight
      abortController.abort();
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    };

    const provider = createConfiguredProvider({
      config,
      snapshot: discoverySnapshot,
      allowLiveCalls: true,
      fetchImpl: mockFetchWithAbort
    });

    const assignment = {
      id: 'rct-abort-task',
      objective: 'Abort during execution',
      acceptance: 'Abort handled',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello\n' }],
      budget: { maxTurns: 5, maxWallMs: 10000 }
    };

    const result = await runAssignment(assignment, provider, snapshotWorkspace.root, {
      isolated: true,
      signal: abortController.signal
    });

    // Verify RCT cleanly records unknown/aborted state
    assert.equal(result.state, 'unknown');
    assert.equal(result.failureReason, 'aborted');
  } finally {
    await snapshotWorkspace.dispose();
  }
}));

test('Disabled live inference gate fails closed with zero fetch before RCT execution', () => withSourceWorkspace(async (sourceRoot) => {
  const allowedPaths = ['src/greeting.txt'];
  const snapshotWorkspace = await createSnapshot(sourceRoot, allowedPaths);

  try {
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount++;
      throw new Error('Fetch must not be called when live calls disabled');
    };

    const baseEnv = {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: 'gsk_fixture_secret_key',
      ZETRO_LIVE_INFERENCE_ENABLED: '0', // Disabled live
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    };

    const config = loadProviderConfig({
      env: baseEnv,
      catalogPort: createModelCatalogPort()
    });

    const discoverySnapshot = await createSyntheticDiscoverySnapshot({
      provider: 'groq',
      modelId: 'qwen/qwen3.8-27b'
    });

    const provider = createConfiguredProvider({
      config,
      snapshot: discoverySnapshot,
      allowLiveCalls: false, // Explicit false
      fetchImpl: mockFetch
    });

    const assignment = {
      id: 'rct-disabled-live-task',
      objective: 'Attempt execution without live authorization',
      acceptance: 'Fails closed',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello\n' }]
    };

    const result = await runAssignment(assignment, provider, snapshotWorkspace.root, { isolated: true });

    assert.equal(fetchCount, 0, 'Zero network dispatch when live inference disabled');
    assert.equal(result.state, 'failed');
    assert.equal(result.failureReason, 'worker_or_tool_error');
  } finally {
    await snapshotWorkspace.dispose();
  }
}));

test('Current proof exact identity gate fails closed with zero fetch on mismatched proof', () => withSourceWorkspace(async (sourceRoot) => {
  const allowedPaths = ['src/greeting.txt'];
  const snapshotWorkspace = await createSnapshot(sourceRoot, allowedPaths);

  try {
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount++;
      throw new Error('Fetch must not be called when proof is swapped');
    };

    const baseEnv = {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: 'gsk_fixture_secret_key',
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    };

    const config = loadProviderConfig({
      env: baseEnv,
      catalogPort: createModelCatalogPort()
    });

    // Snapshot is for 'openrouter' instead of 'groq'
    const swappedSnapshot = await createSyntheticDiscoverySnapshot({
      provider: 'openrouter',
      modelId: 'meta-llama/llama-3.3-70b-instruct:free'
    });

    const provider = createConfiguredProvider({
      config,
      snapshot: swappedSnapshot,
      allowLiveCalls: true,
      fetchImpl: mockFetch
    });

    const assignment = {
      id: 'rct-swapped-proof-task',
      objective: 'Attempt execution with swapped proof',
      acceptance: 'Fails closed',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello\n' }]
    };

    const result = await runAssignment(assignment, provider, snapshotWorkspace.root, { isolated: true });

    assert.equal(fetchCount, 0, 'Zero network dispatch on swapped provider proof');
    assert.equal(result.state, 'failed');
    assert.equal(result.failureReason, 'worker_or_tool_error');
  } finally {
    await snapshotWorkspace.dispose();
  }
}));

test('Terminal attempt accounting: Attempt 1 transient ECONNRESET -> Attempt 2 HTTP 403 terminal error preserves attempts, retries, and zero secrets', () => withSourceWorkspace(async (sourceRoot) => {
  const allowedPaths = ['src/greeting.txt'];
  const snapshotWorkspace = await createSnapshot(sourceRoot, allowedPaths);

  try {
    const syntheticKey = 'gsk_fixture_secret_terminal_http_403_key_998877';
    const baseEnv = {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: syntheticKey,
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    };

    const config = loadProviderConfig({
      env: baseEnv,
      catalogPort: createModelCatalogPort()
    });

    const discoverySnapshot = await createSyntheticDiscoverySnapshot({
      provider: 'groq',
      modelId: 'qwen/qwen3.8-27b',
      apiKey: syntheticKey
    });

    let fetchCalls = 0;
    const mockFetch = async () => {
      fetchCalls++;
      if (fetchCalls === 1) {
        // Attempt 1: Transient transport failure (ECONNRESET)
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error(`connection reset with ${syntheticKey}`), { code: 'ECONNRESET' })
        });
      }

      // Attempt 2: Terminal HTTP 403 error
      return {
        ok: false,
        status: 403,
        headers: new Headers(),
        text: async () => `Forbidden access for secret ${syntheticKey}`
      };
    };

    const provider = createConfiguredProvider({
      config,
      snapshot: discoverySnapshot,
      allowLiveCalls: true,
      fetchImpl: mockFetch,
      retryDelayMs: 1
    });

    const assignment = {
      id: 'terminal-http-task',
      objective: 'Run assignment encountering transient then terminal HTTP 403',
      acceptance: 'Fail safely with exact attempt accounting',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello\n' }],
      budget: { maxTurns: 1, maxWallMs: 10000 }
    };

    const result = await runAssignment(assignment, provider, snapshotWorkspace.root, { isolated: true });

    // 1. Verify 2 physical fetches were made
    assert.equal(fetchCalls, 2, 'Must make exactly 2 fetches (1 initial + 1 retry)');

    // 2. Verify state and failure classification
    assert.equal(result.state, 'failed');
    assert.equal(result.failureReason, 'worker_or_tool_error');

    // 3. Verify exact attempt and retry accounting in UsageLedger
    assert.equal(result.ledger.requests, 1);
    assert.equal(result.ledger.providerAttempts, 2, 'UsageLedger must record exactly 2 attempts');
    assert.equal(result.ledger.retries, 1, 'UsageLedger must record exactly 1 retry');
    assert.equal(result.ledger.hasUnknownUsage, true, 'Terminal HTTP error must flag unknownUsage');
    assert.equal(result.ledger.unknownUsageAttempts, 2, 'Both attempts must be counted in unknownUsageAttempts');
    assert.equal(result.ledger.attempts.length, 2);

    // Attempt 1 record: retry_failure
    assert.equal(result.ledger.attempts[0].attempt, 1);
    assert.equal(result.ledger.attempts[0].ok, false);
    assert.equal(result.ledger.attempts[0].status, 'retry_failure');
    assert.equal(result.ledger.attempts[0].errorName, 'ProviderTransportError');
    assert.equal(result.ledger.attempts[0].unknownUsage, true);

    // Attempt 2 record: failure
    assert.equal(result.ledger.attempts[1].attempt, 2);
    assert.equal(result.ledger.attempts[1].ok, false);
    assert.equal(result.ledger.attempts[1].status, 'failure');
    assert.equal(result.ledger.attempts[1].unknownUsage, true);

    // 4. Verify strict zero credential leakage
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(syntheticKey), 'Secret key must not appear in serialized RCT result');
  } finally {
    await snapshotWorkspace.dispose();
  }
}));

test('Terminal attempt accounting: Attempt 1 transient ECONNRESET -> Attempt 2 invalid JSON preserves attempts and retries', () => withSourceWorkspace(async (sourceRoot) => {
  const allowedPaths = ['src/greeting.txt'];
  const snapshotWorkspace = await createSnapshot(sourceRoot, allowedPaths);

  try {
    const syntheticKey = 'gsk_fixture_secret_terminal_json_key_113355';
    const baseEnv = {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: syntheticKey,
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    };

    const config = loadProviderConfig({
      env: baseEnv,
      catalogPort: createModelCatalogPort()
    });

    const discoverySnapshot = await createSyntheticDiscoverySnapshot({
      provider: 'groq',
      modelId: 'qwen/qwen3.8-27b',
      apiKey: syntheticKey
    });

    let fetchCalls = 0;
    const mockFetch = async () => {
      fetchCalls++;
      if (fetchCalls === 1) {
        // Attempt 1: Transient transport failure (ECONNRESET)
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error(`network reset ${syntheticKey}`), { code: 'ECONNRESET' })
        });
      }

      // Attempt 2: HTTP 200 with invalid JSON body
      return {
        ok: true,
        json: async () => {
          throw new SyntaxError(`Unexpected token < in JSON at position 0 containing ${syntheticKey}`);
        }
      };
    };

    const provider = createConfiguredProvider({
      config,
      snapshot: discoverySnapshot,
      allowLiveCalls: true,
      fetchImpl: mockFetch,
      retryDelayMs: 1
    });

    const assignment = {
      id: 'terminal-json-task',
      objective: 'Run assignment encountering transient then malformed JSON response',
      acceptance: 'Fail safely with exact attempt accounting',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello\n' }],
      budget: { maxTurns: 1, maxWallMs: 10000 }
    };

    const result = await runAssignment(assignment, provider, snapshotWorkspace.root, { isolated: true });

    assert.equal(fetchCalls, 2);
    assert.equal(result.state, 'failed');
    assert.equal(result.failureReason, 'worker_or_tool_error');

    assert.equal(result.ledger.providerAttempts, 2, 'UsageLedger must record 2 attempts');
    assert.equal(result.ledger.retries, 1, 'UsageLedger must record 1 retry');
    assert.equal(result.ledger.hasUnknownUsage, true);
    assert.equal(result.ledger.unknownUsageAttempts, 2);
    assert.equal(result.ledger.attempts.length, 2);
    assert.equal(result.ledger.attempts[0].status, 'retry_failure');
    assert.equal(result.ledger.attempts[1].status, 'failure');
    assert.equal(result.ledger.attempts[1].errorName, 'ProviderError');

    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(syntheticKey), 'Secret key must not appear in serialized RCT result');
  } finally {
    await snapshotWorkspace.dispose();
  }
}));

test('Terminal attempt accounting: Attempt 1 transient ECONNRESET -> Attempt 2 tool error with valid usage records exact attempts and measured tokens', () => withSourceWorkspace(async (sourceRoot) => {
  const allowedPaths = ['src/greeting.txt'];
  const snapshotWorkspace = await createSnapshot(sourceRoot, allowedPaths);

  try {
    const syntheticKey = 'gsk_fixture_secret_terminal_tool_usage_key_224466';
    const baseEnv = {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: syntheticKey,
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    };

    const config = loadProviderConfig({
      env: baseEnv,
      catalogPort: createModelCatalogPort()
    });

    const discoverySnapshot = await createSyntheticDiscoverySnapshot({
      provider: 'groq',
      modelId: 'qwen/qwen3.8-27b',
      apiKey: syntheticKey
    });

    let fetchCalls = 0;
    const mockFetch = async () => {
      fetchCalls++;
      if (fetchCalls === 1) {
        // Attempt 1: Transient transport failure (ECONNRESET)
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error(`reset ${syntheticKey}`), { code: 'ECONNRESET' })
        });
      }

      // Attempt 2: Tool validation error (tool name not in selected tools), but valid token usage returned
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [{
                id: 'call_disallowed',
                type: 'function',
                function: {
                  name: 'unauthorized_shell_exec',
                  arguments: JSON.stringify({ command: `echo ${syntheticKey}` })
                }
              }]
            }
          }],
          usage: { prompt_tokens: 55, completion_tokens: 22 }
        })
      };
    };

    const provider = createConfiguredProvider({
      config,
      snapshot: discoverySnapshot,
      allowLiveCalls: true,
      fetchImpl: mockFetch,
      retryDelayMs: 1
    });

    const assignment = {
      id: 'terminal-tool-usage-task',
      objective: 'Run assignment encountering transient then tool error with valid token usage',
      acceptance: 'Record measured token usage and exact attempt accounting',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello\n' }],
      budget: { maxTurns: 1, maxWallMs: 10000 }
    };

    const result = await runAssignment(assignment, provider, snapshotWorkspace.root, { isolated: true });

    assert.equal(fetchCalls, 2);
    assert.equal(result.state, 'failed');
    assert.equal(result.failureReason, 'worker_or_tool_error');

    // Strict measured token accounting from Attempt 2
    assert.equal(result.usage.inputTokens, 55, 'Must record inputTokens (55) from body.usage despite tool failure');
    assert.equal(result.usage.outputTokens, 22, 'Must record outputTokens (22) from body.usage despite tool failure');
    assert.equal(result.ledger.knownInputTokens, 55);
    assert.equal(result.ledger.knownOutputTokens, 22);

    // Exact attempt and retry accounting
    assert.equal(result.ledger.providerAttempts, 2, 'UsageLedger must record 2 attempts');
    assert.equal(result.ledger.retries, 1, 'UsageLedger must record 1 retry');
    assert.equal(result.ledger.hasUnknownUsage, true, 'Failure on attempt 2 still marks ledger hasUnknownUsage true');
    assert.equal(result.ledger.unknownUsageAttempts, 2);
    assert.equal(result.ledger.attempts.length, 2);
    assert.equal(result.ledger.attempts[0].status, 'retry_failure');
    assert.equal(result.ledger.attempts[1].status, 'failure');
    assert.equal(result.ledger.attempts[1].errorName, 'ProviderError');

    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(syntheticKey), 'Secret key must not appear in serialized RCT result');
  } finally {
    await snapshotWorkspace.dispose();
  }
}));

test('Terminal attempt accounting: Attempt 1 transient ECONNRESET -> Attempt 2 token accounting failure records attempts with unknown usage', () => withSourceWorkspace(async (sourceRoot) => {
  const allowedPaths = ['src/greeting.txt'];
  const snapshotWorkspace = await createSnapshot(sourceRoot, allowedPaths);

  try {
    const syntheticKey = 'gsk_fixture_secret_terminal_missing_usage_key_335577';
    const baseEnv = {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: syntheticKey,
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    };

    const config = loadProviderConfig({
      env: baseEnv,
      catalogPort: createModelCatalogPort()
    });

    const discoverySnapshot = await createSyntheticDiscoverySnapshot({
      provider: 'groq',
      modelId: 'qwen/qwen3.8-27b',
      apiKey: syntheticKey
    });

    let fetchCalls = 0;
    const mockFetch = async () => {
      fetchCalls++;
      if (fetchCalls === 1) {
        // Attempt 1: Transient transport failure (ECONNRESET)
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error(`network reset ${syntheticKey}`), { code: 'ECONNRESET' })
        });
      }

      // Attempt 2: Tool call is valid, but token usage is missing/negative
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [{
                id: 'call_valid',
                type: 'function',
                function: {
                  name: 'read_slice',
                  arguments: JSON.stringify({ path: 'src/greeting.txt' })
                }
              }]
            }
          }],
          usage: { prompt_tokens: -1, completion_tokens: 10 }
        })
      };
    };

    const provider = createConfiguredProvider({
      config,
      snapshot: discoverySnapshot,
      allowLiveCalls: true,
      fetchImpl: mockFetch,
      retryDelayMs: 1
    });

    const assignment = {
      id: 'terminal-missing-usage-task',
      objective: 'Run assignment encountering transient then missing token accounting',
      acceptance: 'Record zero known tokens and exact attempt accounting with unknown usage',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello\n' }],
      budget: { maxTurns: 1, maxWallMs: 10000 }
    };

    const result = await runAssignment(assignment, provider, snapshotWorkspace.root, { isolated: true });

    assert.equal(fetchCalls, 2);
    assert.equal(result.state, 'failed');
    assert.equal(result.failureReason, 'worker_or_tool_error');

    // Missing/negative token usage must NOT fabricate tokens
    assert.equal(result.usage.inputTokens, 0);
    assert.equal(result.usage.outputTokens, 0);
    assert.equal(result.ledger.knownInputTokens, 0);
    assert.equal(result.ledger.knownOutputTokens, 0);

    // Exact attempt and retry accounting
    assert.equal(result.ledger.providerAttempts, 2, 'UsageLedger must record 2 attempts');
    assert.equal(result.ledger.retries, 1, 'UsageLedger must record 1 retry');
    assert.equal(result.ledger.hasUnknownUsage, true);
    assert.equal(result.ledger.unknownUsageAttempts, 2);
    assert.equal(result.ledger.attempts.length, 2);
    assert.equal(result.ledger.attempts[0].status, 'retry_failure');
    assert.equal(result.ledger.attempts[1].status, 'failure');
    assert.equal(result.ledger.attempts[1].errorName, 'ProviderError');

    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(syntheticKey), 'Secret key must not appear in serialized RCT result');
  } finally {
    await snapshotWorkspace.dispose();
  }
}));

test('Abort during retry backoff after first ECONNRESET records exactly 1 attempt, 0 retries, and unknown usage with actual fetch counter 1', () => withSourceWorkspace(async (sourceRoot) => {
  const allowedPaths = ['src/greeting.txt'];
  const snapshotWorkspace = await createSnapshot(sourceRoot, allowedPaths);

  try {
    const syntheticKey = 'gsk_fixture_secret_abort_backoff_key_556677';
    const baseEnv = {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: syntheticKey,
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    };

    const config = loadProviderConfig({
      env: baseEnv,
      catalogPort: createModelCatalogPort()
    });

    const discoverySnapshot = await createSyntheticDiscoverySnapshot({
      provider: 'groq',
      modelId: 'qwen/qwen3.8-27b',
      apiKey: syntheticKey
    });

    let actualFetchCounter = 0;
    const abortController = new AbortController();

    const mockFetchWithBackoffAbort = async () => {
      actualFetchCounter++;
      if (actualFetchCounter === 1) {
        // Trigger abort during the 40ms retry backoff before second fetch is dispatched
        setTimeout(() => abortController.abort(), 10);
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error(`network reset ${syntheticKey}`), { code: 'ECONNRESET' })
        });
      }

      throw new Error(`Second fetch must never be dispatched after abort during retry backoff (actualFetchCounter=${actualFetchCounter})`);
    };

    const provider = createConfiguredProvider({
      config,
      snapshot: discoverySnapshot,
      allowLiveCalls: true,
      fetchImpl: mockFetchWithBackoffAbort,
      retryDelayMs: 40
    });

    const assignment = {
      id: 'abort-during-backoff-task',
      objective: 'Run assignment aborted during retry backoff',
      acceptance: 'Record 1 attempt, 0 retries, unknown usage, and state unknown',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello\n' }],
      budget: { maxTurns: 1, maxWallMs: 10000 }
    };

    const result = await runAssignment(assignment, provider, snapshotWorkspace.root, {
      isolated: true,
      signal: abortController.signal
    });

    // 1. Verify actual fetch counter: only 1 fetch was dispatched
    assert.equal(actualFetchCounter, 1, 'Actual fetch counter must be exactly 1');

    // 2. Verify state and failure classification
    assert.equal(result.state, 'unknown');
    assert.equal(result.failureReason, 'aborted');

    // 3. Verify attempt, retry, and unknown usage accounting in UsageLedger
    assert.equal(result.ledger.requests, 1);
    assert.equal(result.ledger.providerAttempts, 1, 'Provider attempts must be exactly 1 (not 2)');
    assert.equal(result.ledger.retries, 0, 'Retries must be exactly 0 (second fetch was never dispatched)');
    assert.equal(result.ledger.hasUnknownUsage, true, 'hasUnknownUsage must be true');
    assert.equal(result.ledger.unknownUsageAttempts, 1, 'unknownUsageAttempts must be exactly 1');
    assert.equal(result.ledger.attempts.length, 1);
    assert.equal(result.ledger.attempts[0].attempt, 1);
    assert.equal(result.ledger.attempts[0].ok, false);
    assert.equal(result.ledger.attempts[0].errorName, 'AbortError');
    assert.equal(result.ledger.attempts[0].unknownUsage, true);

    // 4. Verify strict zero credential leakage
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(syntheticKey), 'Secret key must not appear in serialized RCT result');
  } finally {
    await snapshotWorkspace.dispose();
  }
}));
