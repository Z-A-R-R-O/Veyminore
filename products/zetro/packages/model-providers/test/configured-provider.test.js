/**
 * Test Suite: Configured Provider Integration Conformance (W4R-AGR4-exact-metadata-proof)
 *
 * Validates the runtime-compatible integration connecting @zetro/provider-config
 * with @zetro/model-providers, verifying:
 * - Offline-safe fake default
 * - Zero mocked fetch on missing validated metadata snapshot (no timeless static catalog live replacement)
 * - Zero mocked fetch on swapped provider ID proof mismatch
 * - Zero mocked fetch on swapped model ID proof mismatch
 * - Zero mocked fetch on missing key
 * - Zero mocked fetch on disabled live inference
 * - Zero mocked fetch on unapproved provider
 * - Zero mocked fetch on unknown / paid price (no paid fallback)
 * - Zero mocked fetch on stale / future / non-finite proof
 * - Zero mocked fetch on disabled source sharing (prevent silent source transmission)
 * - Both paths for binding shared proof: through config AND through adapter
 * - Enabled synthetic approved fixture tools roundtrip within tokenlimit
 * - Strict credential isolation and zero credential leakage
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import util from 'node:util';

import {
  createConfiguredProvider,
  createRuntimeProvider,
  ConfiguredModelProvider,
  createModelCatalogPort,
  ProviderError,
  FreeRoutingViolationError,
  APPROVED_ENDPOINTS,
  FREE_MODEL_CATALOG,
  getModelMetadata,
  normalizeModelId,
  ModelDiscoveryService
} from '../src/index.js';

import { loadProviderConfig } from '../../provider-config/src/loader.js';
import { createCatalogSnapshotPort } from '../../provider-config/src/catalog-validator.js';

/**
 * Local test fixture helper constructing synthetic mock snapshots for testing gate rejections.
 * Strictly confined to tests; static catalog cannot produce current proofs in production.
 */
function createTestModelSnapshot({
  provider,
  model,
  ttlMs = 60000,
  now = Date.now(),
  checkedAt,
  expiresAt,
  supportedParameters,
  pricing
} = {}) {
  const normProvider = (provider || '').toLowerCase().trim();
  const normModel = normalizeModelId(model, normProvider);
  const catalogEntry = getModelMetadata(normModel, normProvider);
  const effectiveCheckedAt = checkedAt || new Date(now).toISOString();
  const checkedTime = new Date(effectiveCheckedAt).getTime();
  const effectiveExpiresAt = expiresAt !== undefined ? expiresAt : checkedTime + ttlMs;
  const endpoint = APPROVED_ENDPOINTS[normProvider]?.models;

  return {
    id: normModel,
    provider: normProvider,
    displayName: catalogEntry?.displayName || normModel,
    contextWindow: catalogEntry?.contextWindow || 32768,
    toolCalling: true,
    pricing: pricing || {
      inputCostPerM: catalogEntry?.pricing.inputCostPerM ?? 0,
      outputCostPerM: catalogEntry?.pricing.outputCostPerM ?? 0
    },
    isFree: true,
    supportedParameters: supportedParameters || (catalogEntry?.supportedParameters ? [...catalogEntry.supportedParameters] : ['tools', 'max_tokens']),
    negotiatedParameters: {
      tools: true,
      toolChoice: catalogEntry?.supportedParameters?.includes('tool_choice') ?? false,
      parallelToolCalls: catalogEntry?.supportedParameters?.includes('parallel_tool_calls') ?? false,
      maxTokensParam: 'max_tokens',
      temperature: false
    },
    source: endpoint,
    checkedAt: effectiveCheckedAt,
    ttlMs,
    expiresAt: effectiveExpiresAt,
    accountEligibility: 'unknown'
  };
}

test('createConfiguredProvider defaults to offline-safe fake provider with zero network dispatch', async () => {
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    throw new Error('fetch must not be called for fake provider');
  };

  // Default options: empty env object ensures zero actualenv access
  const provider = createConfiguredProvider({
    env: {},
    fetchImpl: mockFetch
  });

  assert.equal(provider.provider, 'fake');
  assert.equal(provider.model, 'fake-model');
  assert.equal(provider.name, 'fake');

  // checkAccess succeeds offline without network
  const access = await provider.checkAccess();
  assert.equal(access.authenticated, true);
  assert.equal(access.modelAvailable, true);
  assert.equal(access.model, 'fake-model');
  assert.equal(access.provenZeroCost, true);
  assert.equal(fetchCount, 0, 'Zero network dispatch for fake checkAccess');

  // next() returns default deterministic tool call without network
  const nextRes = await provider.next({
    messages: [{ role: 'user', content: 'test objective' }],
    tools: ['read_slice', 'submit_receipt']
  });
  assert.ok(nextRes.toolCalls.length >= 1);
  assert.equal(nextRes.toolCalls[0].name, 'read_slice');
  assert.equal(fetchCount, 0, 'Zero network dispatch for fake next');

  // next() with simulated steps shifts injected steps
  const steppingProvider = createConfiguredProvider({
    env: {},
    steps: [
      { name: 'read_slice', args: { path: 'foo.txt', start: 0, length: 50 } },
      { name: 'submit_receipt', args: { summary: 'done' } }
    ],
    fetchImpl: mockFetch
  });

  const step1 = await steppingProvider.next({ messages: [], tools: ['read_slice'] });
  assert.equal(step1.toolCalls[0].name, 'read_slice');
  assert.equal(step1.toolCalls[0].args.path, 'foo.txt');

  const step2 = await steppingProvider.next({ messages: [], tools: ['submit_receipt'] });
  assert.equal(step2.toolCalls[0].name, 'submit_receipt');
  assert.equal(step2.toolCalls[0].args.summary, 'done');

  assert.equal(fetchCount, 0, 'Zero network dispatch across all fake steps');
});

test('Fake provider fails closed if explicitly excluded from approved providers list', async () => {
  let fetchCount = 0;
  const mockFetch = async () => { fetchCount++; };

  const provider = createConfiguredProvider({
    env: {
      ZETRO_PROVIDER: 'fake',
      ZETRO_APPROVED_PROVIDERS: 'groq, opencode' // Excludes fake
    },
    fetchImpl: mockFetch
  });

  await assert.rejects(
    provider.checkAccess(),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('disallowed')
  );

  await assert.rejects(
    provider.next({ messages: [], tools: ['submit_receipt'] }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('disallowed')
  );

  assert.equal(fetchCount, 0, 'Zero fetch on disallowed fake provider');
});

test('Missing snapshot gate: live inference without fresh validated snapshot fails closed with zero mocked fetch', async () => {
  let fetchCount = 0;
  const mockFetch = async () => { fetchCount++; throw new Error('Unreachable'); };

  // Fully authorized config but NO snapshot provided anywhere
  const provider = createConfiguredProvider({
    env: {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: 'gsk_valid_test_key_123',
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    },
    allowLiveCalls: true,
    fetchImpl: mockFetch
    // snapshot is intentionally omitted
  });

  // checkAccess fails closed on missing snapshot with 0 fetch
  await assert.rejects(
    provider.checkAccess(),
    (err) => {
      return (
        err instanceof FreeRoutingViolationError &&
        err.message.includes('Missing fresh validated metadata snapshot') &&
        err.message.includes('Timeless static catalog replacement is prohibited')
      );
    }
  );
  assert.equal(fetchCount, 0, 'Zero fetch on missing snapshot during checkAccess');

  // next() fails closed on missing snapshot with 0 fetch
  await assert.rejects(
    provider.next({
      messages: [{ role: 'user', content: 'hello' }],
      tools: ['read_slice']
    }),
    (err) => {
      return (
        err instanceof FreeRoutingViolationError &&
        err.message.includes('Missing fresh validated metadata snapshot') &&
        err.message.includes('Timeless static catalog replacement is prohibited')
      );
    }
  );
  assert.equal(fetchCount, 0, 'Zero fetch on missing snapshot during next');
});

test('Swapped provider ID proof mismatch: fails closed with zero mocked fetch', async () => {
  let fetchCount = 0;
  const mockFetch = async () => { fetchCount++; throw new Error('Unreachable'); };

  // Configured provider is 'groq' with model 'qwen/qwen3.8-27b'
  const config = loadProviderConfig({
    env: {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: 'gsk_valid_key_123',
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    },
    catalogPort: createModelCatalogPort()
  });

  // BUT snapshot is for 'openrouter' (e.g. meta-llama/llama-3.3-70b-instruct:free)
  const openrouterSnapshot = createTestModelSnapshot({
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free'
  });

  const provider = createConfiguredProvider({
    config,
    snapshot: openrouterSnapshot,
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });

  await assert.rejects(
    provider.checkAccess(),
    (err) => {
      return (
        err instanceof FreeRoutingViolationError &&
        err.message.includes("Metadata proof provider 'openrouter' does not match configured provider 'groq'") &&
        err.message.includes('Swapped provider proof rejected')
      );
    }
  );
  assert.equal(fetchCount, 0, 'Zero fetch on swapped provider proof in checkAccess');

  await assert.rejects(
    provider.next({
      messages: [{ role: 'user', content: 'test' }],
      tools: ['read_slice']
    }),
    (err) => {
      return (
        err instanceof FreeRoutingViolationError &&
        err.message.includes("Metadata proof provider 'openrouter' does not match configured provider 'groq'") &&
        err.message.includes('Swapped provider proof rejected')
      );
    }
  );
  assert.equal(fetchCount, 0, 'Zero fetch on swapped provider proof in next');
});

test('Swapped model ID proof mismatch: fails closed with zero mocked fetch', async () => {
  let fetchCount = 0;
  const mockFetch = async () => { fetchCount++; throw new Error('Unreachable'); };

  // Configured provider is 'groq' with model 'qwen/qwen3.8-27b'
  const config = loadProviderConfig({
    env: {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: 'gsk_valid_key_123',
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    },
    catalogPort: createModelCatalogPort()
  });

  // BUT snapshot is for a DIFFERENT Groq model ('openai/gpt-oss-120b')
  const swappedModelSnapshot = createTestModelSnapshot({
    provider: 'groq',
    model: 'openai/gpt-oss-120b'
  });

  const provider = createConfiguredProvider({
    config,
    snapshot: swappedModelSnapshot,
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });

  await assert.rejects(
    provider.checkAccess(),
    (err) => {
      return (
        err instanceof FreeRoutingViolationError &&
        err.message.includes("Metadata proof model 'openai/gpt-oss-120b' does not match configured model 'qwen/qwen3.8-27b'") &&
        err.message.includes('Swapped model proof rejected')
      );
    }
  );
  assert.equal(fetchCount, 0, 'Zero fetch on swapped model proof in checkAccess');

  await assert.rejects(
    provider.next({
      messages: [{ role: 'user', content: 'test' }],
      tools: ['read_slice']
    }),
    (err) => {
      return (
        err instanceof FreeRoutingViolationError &&
        err.message.includes("Metadata proof model 'openai/gpt-oss-120b' does not match configured model 'qwen/qwen3.8-27b'") &&
        err.message.includes('Swapped model proof rejected')
      );
    }
  );
  assert.equal(fetchCount, 0, 'Zero fetch on swapped model proof in next');
});

test('Missing key gate: fails closed with zero mocked fetch', async () => {
  let fetchCount = 0;
  const mockFetch = async () => { fetchCount++; throw new Error('Unreachable'); };

  // Valid snapshot for groq/qwen
  const validSnapshot = createTestModelSnapshot({
    provider: 'groq',
    model: 'qwen/qwen3.8-27b'
  });

  // All flags enabled except missing GROQ_API_KEY
  const provider = createConfiguredProvider({
    env: {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
      // GROQ_API_KEY is intentionally absent
    },
    snapshot: validSnapshot,
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });

  // checkAccess fails closed with 0 fetch
  await assert.rejects(
    provider.checkAccess(),
    (err) => err instanceof ProviderError && err.message.includes("API key for provider 'groq' is not set")
  );
  assert.equal(fetchCount, 0, 'Zero fetch on missing key during checkAccess');

  // next fails closed with 0 fetch
  await assert.rejects(
    provider.next({
      messages: [{ role: 'user', content: 'hello' }],
      tools: ['read_slice']
    }),
    (err) => err instanceof ProviderError && err.message.includes("API key for provider 'groq' is not set")
  );
  assert.equal(fetchCount, 0, 'Zero fetch on missing key during next');
});

test('Disabled live gate: fails closed with zero mocked fetch', async () => {
  let fetchCount = 0;
  const mockFetch = async () => { fetchCount++; throw new Error('Unreachable'); };

  const validSnapshot = createTestModelSnapshot({
    provider: 'groq',
    model: 'qwen/qwen3.8-27b'
  });

  // Case A: Config liveAllowed is false (ZETRO_LIVE_INFERENCE_ENABLED=0)
  const providerConfigDisabled = createConfiguredProvider({
    env: {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: 'gsk_fake_key_123',
      ZETRO_LIVE_INFERENCE_ENABLED: '0',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    },
    snapshot: validSnapshot,
    allowLiveCalls: true, // Programmatic true must not override config false
    fetchImpl: mockFetch
  });

  await assert.rejects(
    providerConfigDisabled.checkAccess(),
    (err) => err instanceof ProviderError && err.message.includes('Live inference disabled')
  );
  assert.equal(fetchCount, 0, 'Zero fetch when config liveAllowed is false');

  await assert.rejects(
    providerConfigDisabled.next({
      messages: [{ role: 'user', content: 'hello' }],
      tools: ['read_slice']
    }),
    (err) => err instanceof ProviderError && err.message.includes('Live inference disabled')
  );
  assert.equal(fetchCount, 0, 'Zero fetch when config liveAllowed is false on next');

  // Case B: Config liveAllowed is true, but allowLiveCalls option is omitted / false
  const providerOptionDisabled = createConfiguredProvider({
    env: {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: 'gsk_fake_key_123',
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    },
    snapshot: validSnapshot,
    allowLiveCalls: false, // Programmatic false must block execution
    fetchImpl: mockFetch
  });

  await assert.rejects(
    providerOptionDisabled.checkAccess(),
    (err) => err instanceof ProviderError && err.message.includes('Live inference disabled')
  );
  assert.equal(fetchCount, 0, 'Zero fetch when allowLiveCalls is false');

  await assert.rejects(
    providerOptionDisabled.next({
      messages: [{ role: 'user', content: 'hello' }],
      tools: ['read_slice']
    }),
    (err) => err instanceof ProviderError && err.message.includes('Live inference disabled')
  );
  assert.equal(fetchCount, 0, 'Zero fetch when allowLiveCalls is false on next');
});

test('Unapproved provider gate: fails closed with zero mocked fetch', async () => {
  let fetchCount = 0;
  const mockFetch = async () => { fetchCount++; throw new Error('Unreachable'); };

  const validSnapshot = createTestModelSnapshot({
    provider: 'groq',
    model: 'qwen/qwen3.8-27b'
  });

  // Provider is 'groq', but approved list is 'opencode, openrouter'
  const provider = createConfiguredProvider({
    env: {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: 'gsk_fake_key_123',
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'opencode, openrouter',
      ZETRO_FREE_ONLY: '1'
    },
    snapshot: validSnapshot,
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });

  await assert.rejects(
    provider.checkAccess(),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('not been approved')
  );
  assert.equal(fetchCount, 0, 'Zero fetch on unapproved provider during checkAccess');

  await assert.rejects(
    provider.next({
      messages: [{ role: 'user', content: 'hello' }],
      tools: ['read_slice']
    }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('not been approved')
  );
  assert.equal(fetchCount, 0, 'Zero fetch on unapproved provider during next');
});

test('Unknown price and paid fallback prevention gate: fails closed with zero mocked fetch', async () => {
  let fetchCount = 0;
  const mockFetch = async () => { fetchCount++; throw new Error('Unreachable'); };

  // Unverified / paid model not in free catalog
  const provider = createConfiguredProvider({
    env: {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'unverified-paid-model',
      GROQ_API_KEY: 'gsk_fake_key_123',
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    },
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });

  await assert.rejects(
    provider.checkAccess(),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('failed free catalog verification')
  );
  assert.equal(fetchCount, 0, 'Zero fetch on unknown/paid model during checkAccess');

  await assert.rejects(
    provider.next({
      messages: [{ role: 'user', content: 'hello' }],
      tools: ['read_slice']
    }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('failed free catalog verification')
  );
  assert.equal(fetchCount, 0, 'Zero fetch on unknown/paid model during next');
});

test('Stale, future, and non-finite proof gate: fails closed with zero mocked fetch', async () => {
  let fetchCount = 0;
  const mockFetch = async () => { fetchCount++; throw new Error('Unreachable'); };

  const baseEnv = {
    ZETRO_PROVIDER: 'openrouter',
    ZETRO_MODEL: 'meta-llama/llama-3.3-70b-instruct:free',
    OPENROUTER_API_KEY: 'sk-or-test-key-123',
    ZETRO_LIVE_INFERENCE_ENABLED: '1',
    ZETRO_ALLOW_REMOTE_SOURCE: '1',
    ZETRO_APPROVED_PROVIDERS: 'openrouter',
    ZETRO_FREE_ONLY: '1'
  };

  const now = Date.now();

  // 1. Expired snapshot
  const expiredSnapshot = createTestModelSnapshot({
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    checkedAt: new Date(now - 120000).toISOString(),
    ttlMs: 60000,
    expiresAt: now - 60000
  });

  const expiredProvider = createConfiguredProvider({
    env: baseEnv,
    allowLiveCalls: true,
    fetchImpl: mockFetch,
    snapshot: expiredSnapshot
  });

  await assert.rejects(
    expiredProvider.checkAccess(),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('expired')
  );
  assert.equal(fetchCount, 0, 'Zero fetch on expired snapshot during checkAccess');

  await assert.rejects(
    expiredProvider.next({ messages: [{ role: 'user', content: 'hi' }], tools: ['read_slice'] }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('expired')
  );
  assert.equal(fetchCount, 0, 'Zero fetch on expired snapshot during next');

  // 2. Future checkedAt snapshot
  const futureSnapshot = createTestModelSnapshot({
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    checkedAt: new Date(now + 60000).toISOString(),
    ttlMs: 60000,
    expiresAt: now + 120000
  });

  const futureProvider = createConfiguredProvider({
    env: baseEnv,
    allowLiveCalls: true,
    fetchImpl: mockFetch,
    snapshot: futureSnapshot
  });

  await assert.rejects(
    futureProvider.next({ messages: [{ role: 'user', content: 'hi' }], tools: ['read_slice'] }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('in the future')
  );
  assert.equal(fetchCount, 0, 'Zero fetch on future checkedAt snapshot');

  // 3. Non-finite TTL snapshot (ttlMs: Infinity)
  const infinityTtlSnapshot = {
    ...expiredSnapshot,
    checkedAt: new Date(now).toISOString(),
    ttlMs: Infinity,
    expiresAt: Infinity
  };

  const infinityProvider = createConfiguredProvider({
    env: baseEnv,
    allowLiveCalls: true,
    fetchImpl: mockFetch,
    snapshot: infinityTtlSnapshot
  });

  await assert.rejects(
    infinityProvider.next({ messages: [{ role: 'user', content: 'hi' }], tools: ['read_slice'] }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('non-finite')
  );
  assert.equal(fetchCount, 0, 'Zero fetch on Infinity ttlMs snapshot');
});

test('Source code transmission gate: fails closed before fetch to prevent silent source transmission', async () => {
  const validSnapshot = createTestModelSnapshot({
    provider: 'groq',
    model: 'qwen/qwen3.8-27b'
  });

  // checkAccess does not transmit source code; should proceed to models endpoint check
  let modelsChecked = false;
  const modelsFetch = async (url) => {
    if (url === APPROVED_ENDPOINTS.groq.models) {
      modelsChecked = true;
      return { ok: true, json: async () => ({ data: [{ id: 'qwen/qwen3.8-27b' }] }) };
    }
    throw new Error('Unexpected URL');
  };
  const providerWithModelsFetch = createConfiguredProvider({
    env: {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: 'gsk_fake_key_123',
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '0', // Remote source sharing NOT approved
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    },
    snapshot: validSnapshot,
    allowLiveCalls: true,
    fetchImpl: modelsFetch
  });

  const access = await providerWithModelsFetch.checkAccess();
  assert.equal(access.authenticated, true);
  assert.equal(modelsChecked, true);

  // BUT next() transmits user messages (source code) and MUST fail closed before dispatch
  let nextFetchCount = 0;
  const nextMockFetch = async () => { nextFetchCount++; throw new Error('Unreachable'); };
  const providerForNext = createConfiguredProvider({
    env: {
      ZETRO_PROVIDER: 'groq',
      ZETRO_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: 'gsk_fake_key_123',
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '0',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_FREE_ONLY: '1'
    },
    snapshot: validSnapshot,
    allowLiveCalls: true,
    fetchImpl: nextMockFetch
  });

  await assert.rejects(
    providerForNext.next({
      messages: [{ role: 'user', content: 'const privateCode = 42;' }],
      tools: ['read_slice']
    }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('source code transmission is not approved')
  );
  assert.equal(nextFetchCount, 0, 'Zero fetch on next() when source sharing is disabled (silent transmission prevented)');
});

test('Shared proof binding: tests both paths (bound through config AND bound through adapter)', async () => {
  let fetchCount = 0;
  const mockFetch = async (url) => {
    fetchCount++;
    if (url === APPROVED_ENDPOINTS.groq.models) {
      return { ok: true, json: async () => ({ data: [{ id: 'qwen/qwen3.8-27b' }] }) };
    }
    if (url === APPROVED_ENDPOINTS.groq.chat) {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'submit_receipt', arguments: '{}' } }] } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        })
      };
    }
    throw new Error('Unexpected URL');
  };

  const sharedProof = createTestModelSnapshot({
    provider: 'groq',
    model: 'qwen/qwen3.8-27b'
  });

  const baseEnv = {
    ZETRO_PROVIDER: 'groq',
    ZETRO_MODEL: 'qwen/qwen3.8-27b',
    GROQ_API_KEY: 'gsk_test_key_123',
    ZETRO_LIVE_INFERENCE_ENABLED: '1',
    ZETRO_ALLOW_REMOTE_SOURCE: '1',
    ZETRO_APPROVED_PROVIDERS: 'groq',
    ZETRO_FREE_ONLY: '1'
  };

  // PATH 1: Shared proof bound through config (config.snapshot)
  const baseConfig = loadProviderConfig({
    env: baseEnv,
    catalogPort: createModelCatalogPort()
  });
  const config = {
    ...baseConfig,
    snapshot: sharedProof,
    getApiKey: (providerName) => baseConfig.getApiKey(providerName)
  };

  const providerFromConfig = createConfiguredProvider({
    config,
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });

  const access1 = await providerFromConfig.checkAccess();
  assert.equal(access1.authenticated, true);
  const next1 = await providerFromConfig.next({ messages: [], tools: ['submit_receipt'] });
  assert.equal(next1.toolCalls[0].name, 'submit_receipt');

  // PATH 2: Shared proof bound through adapter options (createConfiguredProvider({ snapshot }))
  const freshConfig = loadProviderConfig({
    env: baseEnv,
    catalogPort: createModelCatalogPort()
  });

  const providerFromAdapter = createConfiguredProvider({
    config: freshConfig,
    snapshot: sharedProof, // Bound to adapter
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });

  const access2 = await providerFromAdapter.checkAccess();
  assert.equal(access2.authenticated, true);
  const next2 = await providerFromAdapter.next({ messages: [], tools: ['submit_receipt'] });
  assert.equal(next2.toolCalls[0].name, 'submit_receipt');

  // PATH 3: Shared proof bound dynamically via next({ snapshot })
  const providerDynamic = createConfiguredProvider({
    config: freshConfig,
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });

  const next3 = await providerDynamic.next({
    messages: [],
    tools: ['submit_receipt'],
    snapshot: sharedProof // Injected dynamically at call time
  });
  assert.equal(next3.toolCalls[0].name, 'submit_receipt');

  // PATH 4: Shared proof bound directly to adapter property (adapter.snapshot)
  const providerProperty = createConfiguredProvider({
    config: freshConfig,
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });
  providerProperty.snapshot = sharedProof;
  const access4 = await providerProperty.checkAccess();
  assert.equal(access4.authenticated, true);
  const next4 = await providerProperty.next({ messages: [], tools: ['submit_receipt'] });
  assert.equal(next4.toolCalls[0].name, 'submit_receipt');
});

test('Enabled synthetic approved fixture tools roundtrip within tokenlimit with no credential leakage', async () => {
  const syntheticKey = 'gsk_synthetic_fixture_secret_secret_998877';
  let dispatchedUrl = null;
  let dispatchedOptions = null;
  let fetchCount = 0;

  const mockFetch = async (url, options) => {
    fetchCount++;
    dispatchedUrl = url;
    dispatchedOptions = options;

    if (url === APPROVED_ENDPOINTS.groq.models) {
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'qwen/qwen3.8-27b' }]
        })
      };
    }

    if (url === APPROVED_ENDPOINTS.groq.chat) {
      return {
        ok: true,
        json: async () => ({
          id: 'chatcmpl-test-123',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              tool_calls: [{
                id: 'call_abc_1',
                type: 'function',
                function: {
                  name: 'read_slice',
                  arguments: JSON.stringify({ path: 'src/greeting.txt', start: 0, length: 100 })
                }
              }]
            }
          }],
          usage: {
            prompt_tokens: 35,
            completion_tokens: 22,
            total_tokens: 57
          }
        })
      };
    }

    throw new Error(`Unexpected destination: ${url}`);
  };

  // 1. Ingest synthetic configuration via actual loadProviderConfig
  const env = {
    ZETRO_PROVIDER: 'groq',
    ZETRO_MODEL: 'qwen/qwen3.8-27b',
    GROQ_API_KEY: syntheticKey,
    ZETRO_LIVE_INFERENCE_ENABLED: '1',
    ZETRO_ALLOW_REMOTE_SOURCE: '1',
    ZETRO_APPROVED_PROVIDERS: 'groq',
    ZETRO_FREE_ONLY: '1'
  };

  const catalogPort = createModelCatalogPort();
  const config = loadProviderConfig({ env, catalogPort });

  assert.equal(config.status.ready, true);
  assert.equal(config.status.mode, 'live-approved');
  assert.equal(config.hasApiKey('groq'), true);

  // 2. Instantiate runtime provider with valid fresh snapshot
  const validSnapshot = createTestModelSnapshot({
    provider: 'groq',
    model: 'qwen/qwen3.8-27b'
  });

  const provider = createRuntimeProvider({
    config,
    snapshot: validSnapshot,
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });

  assert.equal(provider.name, 'groq:qwen/qwen3.8-27b');
  assert.equal(provider.provider, 'groq');
  assert.equal(provider.model, 'qwen/qwen3.8-27b');

  // 3. checkAccess roundtrip
  const access = await provider.checkAccess();
  assert.equal(access.authenticated, true);
  assert.equal(access.modelAvailable, true);
  assert.equal(access.model, 'qwen/qwen3.8-27b');
  assert.equal(dispatchedUrl, APPROVED_ENDPOINTS.groq.models);
  assert.equal(dispatchedOptions.redirect, 'error', 'Endpoint containment: redirect: error enforced');

  // 4. next() tool calling roundtrip within token budget
  const nextRes = await provider.next({
    messages: [
      { role: 'system', content: 'You are an RCT worker.' },
      { role: 'user', content: 'Inspect the greeting file.' }
    ],
    tools: ['read_slice', 'propose_patch'],
    maxOutputTokens: 250,
    timeoutMs: 15000
  });

  assert.equal(dispatchedUrl, APPROVED_ENDPOINTS.groq.chat);
  assert.equal(dispatchedOptions.redirect, 'error');

  const sentBody = JSON.parse(dispatchedOptions.body);
  assert.equal(sentBody.model, 'qwen/qwen3.8-27b');
  assert.equal(sentBody.max_completion_tokens, 250, 'Token limit budget correctly passed');
  assert.equal(sentBody.tools.length, 2);

  // Verify response parsed correctly
  assert.equal(nextRes.toolCalls.length, 1);
  assert.equal(nextRes.toolCalls[0].name, 'read_slice');
  assert.equal(nextRes.toolCalls[0].args.path, 'src/greeting.txt');
  assert.equal(nextRes.toolCalls[0].args.start, 0);
  assert.equal(nextRes.toolCalls[0].args.length, 100);

  // Token usage within requested limit (22 <= 250)
  assert.equal(nextRes.usage.inputTokens, 35);
  assert.equal(nextRes.usage.outputTokens, 22);
  assert.ok(nextRes.usage.outputTokens <= 250, 'Output tokens within budget');

  // 5. Strict Zero Credential Leakage Verification
  const serializedProvider = JSON.stringify(provider);
  assert.ok(!serializedProvider.includes(syntheticKey), 'API key must not leak into JSON serialization');

  const inspectedProvider = util.inspect(provider, { showHidden: true, depth: null });
  assert.ok(!inspectedProvider.includes(syntheticKey), 'API key must not leak into util.inspect');

  const providerKeys = Object.keys(provider);
  assert.ok(!providerKeys.includes('apiKey'), 'apiKey must not be an enumerable property on provider');
  assert.ok(!providerKeys.includes('GROQ_API_KEY'), 'GROQ_API_KEY must not be on provider');

  const serializedNext = JSON.stringify(nextRes);
  assert.ok(!serializedNext.includes(syntheticKey), 'API key must not leak into next result');

  const serializedAccess = JSON.stringify(access);
  assert.ok(!serializedAccess.includes(syntheticKey), 'API key must not leak into checkAccess result');
});

test('Static-only catalog metadata cannot produce accepted current proof and fails closed with zero fetch', async () => {
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    throw new Error('Fetch must never be called when proof is static-only');
  };

  const baseEnv = {
    ZETRO_PROVIDER: 'groq',
    ZETRO_MODEL: 'qwen/qwen3.8-27b',
    GROQ_API_KEY: 'gsk_test_key_123',
    ZETRO_LIVE_INFERENCE_ENABLED: '1',
    ZETRO_ALLOW_REMOTE_SOURCE: '1',
    ZETRO_APPROVED_PROVIDERS: 'groq',
    ZETRO_FREE_ONLY: '1'
  };

  const config = loadProviderConfig({
    env: baseEnv,
    catalogPort: createModelCatalogPort()
  });

  // 1. Static entry obtained directly from getModelMetadata or FREE_MODEL_CATALOG
  const staticCatalogEntry = getModelMetadata('qwen/qwen3.8-27b', 'groq');
  assert.ok(staticCatalogEntry, 'Static catalog entry exists');
  assert.equal(staticCatalogEntry.expiresAt, undefined, 'Static catalog entry must not have expiresAt');
  assert.equal(staticCatalogEntry.ttlMs, undefined, 'Static catalog entry must not have ttlMs');

  // Attempting to use raw static metadata as snapshot must fail closed with zero fetch
  const providerWithStaticMeta = createConfiguredProvider({
    config,
    snapshot: staticCatalogEntry,
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });

  await assert.rejects(
    providerWithStaticMeta.checkAccess(),
    (err) => err instanceof FreeRoutingViolationError
  );
  assert.equal(fetchCount, 0, 'Zero fetch on static-only catalog metadata during checkAccess');

  await assert.rejects(
    providerWithStaticMeta.next({ messages: [], tools: ['read_slice'] }),
    (err) => err instanceof FreeRoutingViolationError
  );
  assert.equal(fetchCount, 0, 'Zero fetch on static-only catalog metadata during next');

  // 2. Omitting snapshot completely also fails closed with zero fetch (no timeless fallback)
  const providerWithoutSnapshot = createConfiguredProvider({
    config,
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });

  await assert.rejects(
    providerWithoutSnapshot.checkAccess(),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('Timeless static catalog replacement is prohibited')
  );
  assert.equal(fetchCount, 0, 'Zero fetch on omitted snapshot during checkAccess');

  await assert.rejects(
    providerWithoutSnapshot.next({ messages: [], tools: ['read_slice'] }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('Timeless static catalog replacement is prohibited')
  );
  assert.equal(fetchCount, 0, 'Zero fetch on omitted snapshot during next');
});

test('Real injected discovery metadata works, authorizes execution, and enables inference with live calls', async () => {
  const discoveryCalls = [];
  const chatCalls = [];

  // Mock discovery fetch that simulates approved models endpoint
  const mockDiscoveryFetch = async (url, opts) => {
    discoveryCalls.push({ url, opts });
    if (url === APPROVED_ENDPOINTS.groq.models) {
      return {
        ok: true,
        json: async () => ({
          data: [{
            id: 'qwen/qwen3.8-27b',
            context_length: 131072
          }]
        })
      };
    }
    throw new Error(`Unexpected discovery URL: ${url}`);
  };

  // Mock chat fetch that simulates approved chat endpoint
  const mockChatFetch = async (url, opts) => {
    chatCalls.push({ url, opts });
    if (url === APPROVED_ENDPOINTS.groq.chat) {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [{
                id: 'call_abc',
                type: 'function',
                function: { name: 'submit_receipt', arguments: '{"status":"ok"}' }
              }]
            }
          }],
          usage: { prompt_tokens: 40, completion_tokens: 15 }
        })
      };
    }
    throw new Error(`Unexpected chat URL: ${url}`);
  };

  // 1. Run actual ModelDiscoveryService to obtain a real fresh discovery snapshot
  const discovery = new ModelDiscoveryService({ defaultTtlMs: 30000 });
  const realDiscoverySnapshot = await discovery.discoverModel({
    provider: 'groq',
    modelId: 'qwen/qwen3.8-27b',
    apiKey: 'gsk_real_fixture_key_8899',
    allowLiveCalls: true,
    fetchImpl: mockDiscoveryFetch
  });

  assert.equal(discoveryCalls.length, 1);
  assert.equal(realDiscoverySnapshot.provider, 'groq');
  assert.equal(realDiscoverySnapshot.id, 'qwen/qwen3.8-27b');
  assert.equal(realDiscoverySnapshot.source, APPROVED_ENDPOINTS.groq.models);
  assert.ok(realDiscoverySnapshot.expiresAt > Date.now());
  assert.equal(realDiscoverySnapshot.isFree, true);

  // 2. Supply real discovery snapshot to ConfiguredModelProvider
  const baseEnv = {
    ZETRO_PROVIDER: 'groq',
    ZETRO_MODEL: 'qwen/qwen3.8-27b',
    GROQ_API_KEY: 'gsk_real_fixture_key_8899',
    ZETRO_LIVE_INFERENCE_ENABLED: '1',
    ZETRO_ALLOW_REMOTE_SOURCE: '1',
    ZETRO_APPROVED_PROVIDERS: 'groq',
    ZETRO_FREE_ONLY: '1'
  };

  const config = loadProviderConfig({
    env: baseEnv,
    catalogPort: createModelCatalogPort()
  });

  const provider = createConfiguredProvider({
    config,
    snapshot: realDiscoverySnapshot,
    allowLiveCalls: true,
    fetchImpl: async (url, opts) => {
      // Direct models verification to discovery mock and chat calls to chat mock
      if (url === APPROVED_ENDPOINTS.groq.models) {
        return mockDiscoveryFetch(url, opts);
      }
      return mockChatFetch(url, opts);
    }
  });

  // 3. checkAccess succeeds with real discovery proof
  const access = await provider.checkAccess();
  assert.equal(access.authenticated, true);
  assert.equal(access.modelAvailable, true);
  assert.equal(access.model, 'qwen/qwen3.8-27b');

  // 4. next() succeeds with real discovery proof and dispatches chat call
  const nextRes = await provider.next({
    messages: [{ role: 'user', content: 'Run task' }],
    tools: ['submit_receipt'],
    maxOutputTokens: 100
  });

  assert.equal(chatCalls.length, 1);
  assert.equal(nextRes.toolCalls.length, 1);
  assert.equal(nextRes.toolCalls[0].name, 'submit_receipt');
  assert.equal(nextRes.toolCalls[0].args.status, 'ok');
  assert.equal(nextRes.usage.inputTokens, 40);
  assert.equal(nextRes.usage.outputTokens, 15);
});

