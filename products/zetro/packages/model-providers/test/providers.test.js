import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GroqProvider,
  OpenCodeProvider,
  OpenRouterProvider,
  createModelProvider,
  validateFreeRouting,
  validateEndpoint,
  getModelMetadata,
  listFreeModels,
  normalizeModelId,
  FREE_MODEL_CATALOG,
  APPROVED_ENDPOINTS,
  ModelDiscoveryService,
  validateModelSnapshot,
  validateProviderRoute,
  createModelValidatorPort,
  ProviderError,
  RateLimitError,
  FreeTierDepletedError,
  FreeRoutingViolationError,
  ProviderTransportError,
  networkCodes,
  isTransportFailure,
  redactSecrets,
  sanitizeError,
  convertMessages,
  resolveTools
} from '../src/index.js';

// ============================================================================
// 1. Metadata, Catalog & Verified Zero-Pricing Containment
// ============================================================================

test('Free model catalog contains verified metadata with checked dates and official sources', () => {
  const models = listFreeModels();
  assert.ok(models.length >= 10, 'Catalog should contain all verified free models');

  for (const m of models) {
    assert.equal(m.isFree, true, `${m.id} must be marked isFree: true`);
    assert.equal(m.pricing.inputCostPerM, 0, `${m.id} input price must be 0`);
    assert.equal(m.pricing.outputCostPerM, 0, `${m.id} output price must be 0`);
    assert.ok(m.priceEvidence, `${m.id} must provide price evidence`);
    assert.ok(m.source, `${m.id} must provide official source reference`);
    assert.ok(m.checkedAt, `${m.id} must provide verification timestamp`);
    assert.ok(m.dataPolicy, `${m.id} must document data retention policy`);
    assert.ok(m.contextWindow > 0, `${m.id} must declare positive context window`);
    assert.equal(m.toolCalling, true, `${m.id} must support tool calling`);
  }
});

test('getModelMetadata rejects invented metadata for arbitrary :free suffixes', () => {
  assert.equal(getModelMetadata('invented-org/unverified-model:free', 'openrouter'), null);
  assert.equal(getModelMetadata('random-fake:free'), null);
  assert.equal(getModelMetadata('gpt-4o', 'groq'), null);
  assert.equal(getModelMetadata('claude-3-5-sonnet', 'openrouter'), null);
});

test('OpenCode IDs are API slugs and slug normalization maps display names', () => {
  assert.equal(normalizeModelId('DeepSeek V4.1 Flash Free', 'opencode'), 'deepseek-v4.1-flash-free');
  assert.equal(normalizeModelId('GLM-5.3-Flash Free', 'opencode'), 'glm-5.3-flash-free');
  assert.equal(normalizeModelId('Space Bunny Free', 'opencode'), 'space-bunny-free');
  assert.equal(normalizeModelId('deepseek-v4.1-flash', 'opencode'), 'deepseek-v4.1-flash-free');

  const meta = getModelMetadata('deepseek-v4.1-flash-free', 'opencode');
  assert.ok(meta);
  assert.equal(meta.id, 'deepseek-v4.1-flash-free');
  assert.equal(meta.provider, 'opencode');
});

test('validateFreeRouting rejects unknown prices, paid models, and unverified :free suffixes', () => {
  const valid = validateFreeRouting({
    provider: 'groq',
    model: 'qwen/qwen3.8-27b',
    endpoint: APPROVED_ENDPOINTS.groq.chat
  });
  assert.equal(valid.id, 'qwen/qwen3.8-27b');

  assert.throws(() => {
    validateFreeRouting({
      provider: 'openrouter',
      model: 'unknown/unverified:free',
      endpoint: APPROVED_ENDPOINTS.openrouter.chat
    });
  }, FreeRoutingViolationError);

  assert.throws(() => {
    validateFreeRouting({
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      endpoint: 'https://api.openai.com/v1/chat/completions'
    });
  }, FreeRoutingViolationError);

  assert.throws(() => {
    validateFreeRouting({
      provider: 'groq',
      model: 'openai/gpt-4o',
      endpoint: APPROVED_ENDPOINTS.groq.chat
    });
  }, FreeRoutingViolationError);
});

// ============================================================================
// 2. Strict Endpoint Validation & Redirection Rejection
// ============================================================================

test('validateEndpoint rejects unapproved or custom destinations immediately before request', () => {
  assert.equal(validateEndpoint('groq', 'chat', APPROVED_ENDPOINTS.groq.chat), APPROVED_ENDPOINTS.groq.chat);
  assert.equal(validateEndpoint('groq', 'models', APPROVED_ENDPOINTS.groq.models), APPROVED_ENDPOINTS.groq.models);

  assert.throws(
    () => validateEndpoint('groq', 'chat', 'https://attacker.com/openai/v1/chat/completions'),
    FreeRoutingViolationError
  );
  assert.throws(
    () => validateEndpoint('opencode', 'chat', 'https://custom-opencode.ai/v1'),
    FreeRoutingViolationError
  );
  assert.throws(
    () => validateEndpoint('openrouter', 'auth', 'https://openrouter.ai/api/v1/other'),
    FreeRoutingViolationError
  );
});

test('All request paths validate endpoints immediately before fetch and assert zero fetch on rejection', async () => {
  let fetchCount = 0;
  const fakeFetch = async () => {
    fetchCount++;
    return { ok: true, json: async () => ({}) };
  };

  assert.throws(() => {
    new GroqProvider({
      apiKey: 'fake-key-12345',
      fetchImpl: fakeFetch,
      allowLiveCalls: true,
      endpoint: 'https://tampered-groq.com/chat'
    });
  }, FreeRoutingViolationError);
  assert.equal(fetchCount, 0, 'No fetch must be called when destination is unapproved');

  const provider = new GroqProvider({
    apiKey: 'fake-key-12345',
    fetchImpl: fakeFetch,
    allowLiveCalls: true
  });
  provider.modelsEndpoint = 'https://malicious-destination.com/models';

  await assert.rejects(
    provider.checkAccess(),
    FreeRoutingViolationError
  );
  assert.equal(fetchCount, 0, 'No fetch must be called when modelsEndpoint is unapproved');
});

test('Fetch requests strictly configure redirect: error to prevent credential leakage', async () => {
  let capturedChatOptions;
  let capturedModelsOptions;

  const provider = new GroqProvider({
    apiKey: 'fake-key-12345',
    allowLiveCalls: true,
    fetchImpl: async (url, options) => {
      if (url === APPROVED_ENDPOINTS.groq.chat) {
        capturedChatOptions = options;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { tool_calls: [{ function: { name: 'list_paths', arguments: '{}' } }] } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 }
          })
        };
      }
      if (url === APPROVED_ENDPOINTS.groq.models) {
        capturedModelsOptions = options;
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'qwen/qwen3.8-27b' }] })
        };
      }
      throw new Error(`Unexpected url ${url}`);
    }
  });

  await provider.next({ messages: [{ role: 'user', content: 'test' }], tools: ['list_paths'] });
  assert.equal(capturedChatOptions.redirect, 'error');

  await provider.checkAccess();
  assert.equal(capturedModelsOptions.redirect, 'error');
});

// ============================================================================
// 3. Central Explicit Live-Authorization Gate: Strict Literal Boolean True
// ============================================================================

test('allowLiveCalls rejects non-boolean types during construction', () => {
  const rejectedValues = ['false', 'true', '0', '1', 0, 1, {}, []];
  for (const val of rejectedValues) {
    assert.throws(
      () => new GroqProvider({
        apiKey: 'fake-key',
        // @ts-expect-error test rejected types
        allowLiveCalls: val
      }),
      TypeError,
      `Should reject type of ${typeof val} (${String(val)})`
    );
  }
});

test('Injected fetch never runs when allowLiveCalls is false, unset, or string representations', async () => {
  const nonAuthorizedConfigs = [
    {}, // unset
    { allowLiveCalls: false }
  ];

  for (const cfg of nonAuthorizedConfigs) {
    let fetchCalls = 0;
    const spyFetch = async () => {
      fetchCalls++;
      return { ok: true, json: async () => ({}) };
    };

    const provider = new GroqProvider({
      apiKey: 'injected-fake-key',
      fetchImpl: spyFetch,
      ...cfg
    });

    await assert.rejects(
      provider.next({ messages: [{ role: 'user', content: 'hi' }], tools: ['list_paths'] }),
      /Live inference disabled/
    );
    assert.equal(fetchCalls, 0, 'Injected fetch must never run when allowLiveCalls is not literal true');

    await assert.rejects(
      provider.checkAccess(),
      /Live inference disabled/
    );
    assert.equal(fetchCalls, 0, 'Injected fetch must never run when allowLiveCalls is not literal true');
  }
});

// ============================================================================
// 4. Token Accounting: Finite Nonnegative Integer Enforcement
// ============================================================================

test('Token accounting rejects missing, negative, string, or float token usage', async () => {
  const invalidCases = [
    { usage: {} },
    { usage: { prompt_tokens: -1, completion_tokens: 10 } },
    { usage: { prompt_tokens: 10, completion_tokens: -5 } },
    { usage: { prompt_tokens: '100', completion_tokens: '50' } },
    { usage: { prompt_tokens: 12.5, completion_tokens: 5 } },
    { usage: null }
  ];

  for (const c of invalidCases) {
    const provider = new GroqProvider({
      apiKey: 'test-key',
      allowLiveCalls: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { tool_calls: [{ function: { name: 'list_paths', arguments: '{}' } }] } }],
          ...c
        })
      })
    });

    await assert.rejects(
      provider.next({ messages: [{ role: 'user', content: 'test' }], tools: ['list_paths'] }),
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.accountingFailure, true);
        assert.equal(err.remoteUsageUncertain, true);
        assert.ok(err.message.includes('cannot certify'));
        return true;
      }
    );
  }
});

test('Token accounting accepts valid finite nonnegative integers', async () => {
  const provider = new GroqProvider({
    apiKey: 'test-key',
    allowLiveCalls: true,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { tool_calls: [{ function: { name: 'list_paths', arguments: '{}' } }] } }],
        usage: { prompt_tokens: 0, completion_tokens: 42 }
      })
    })
  });

  const res = await provider.next({ messages: [{ role: 'user', content: 'test' }], tools: ['list_paths'] });
  assert.deepEqual(res.usage, { inputTokens: 0, outputTokens: 42 });
});

// ============================================================================
// 5. Tool Validation: Membership & Argument Shape
// ============================================================================

test('Provider rejects tool call when returned tool is outside selected tools', async () => {
  const provider = new GroqProvider({
    apiKey: 'test-key',
    allowLiveCalls: true,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            tool_calls: [{ function: { name: 'propose_patch', arguments: '{"path":"a"}' } }]
          }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
    })
  });

  await assert.rejects(
    provider.next({ messages: [{ role: 'user', content: 'test' }], tools: ['list_paths'] }),
    /returned tool 'propose_patch' which is not in selected tools \(list_paths\)/
  );
});

test('Provider rejects non-array object argument shapes (null, array, primitive)', async () => {
  const malformedArgs = ['null', '[1, 2, 3]', '"string"', '123', 'true'];

  for (const rawArg of malformedArgs) {
    const provider = new GroqProvider({
      apiKey: 'test-key',
      allowLiveCalls: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              tool_calls: [{ function: { name: 'list_paths', arguments: rawArg } }]
            }
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        })
      })
    });

    await assert.rejects(
      provider.next({ messages: [{ role: 'user', content: 'test' }], tools: ['list_paths'] }),
      /expected non-array object/
    );
  }
});

// ============================================================================
// 6. OpenRouter Strict Zero-Cost & Real Model Evidence
// ============================================================================

test('OpenRouter checkAccess verifies key allowance AND real models catalog zero cost', async () => {
  let authChecked = false;
  let modelsChecked = false;

  const provider = new OpenRouterProvider({
    apiKey: 'openrouter-fake-key-777',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    allowLiveCalls: true,
    fetchImpl: async (url) => {
      if (url === APPROVED_ENDPOINTS.openrouter.auth) {
        authChecked = true;
        return {
          ok: true,
          json: async () => ({
            data: {
              label: 'free-user',
              usage: 10,
              limit: 100,
              is_free_tier: true,
              rate_limit: { requests: 20, interval: '10s' }
            }
          })
        };
      }
      if (url === APPROVED_ENDPOINTS.openrouter.models) {
        modelsChecked = true;
        return {
          ok: true,
          json: async () => ({
            data: [{
              id: 'meta-llama/llama-3.3-70b-instruct:free',
              pricing: { prompt: '0', completion: '0', request: '0' },
              supported_parameters: ['tools']
            }]
          })
        };
      }
      throw new Error(`Unexpected destination: ${url}`);
    }
  });

  const check = await provider.checkAccess();
  assert.equal(authChecked, true);
  assert.equal(modelsChecked, true);
  assert.equal(check.authenticated, true);
  assert.equal(check.modelAvailable, true);
  assert.equal(check.provenZeroCost, true);
  assert.equal(check.accountEligibility, 'free_tier');
});

test('OpenRouter checkAccess reports false modelAvailable and false provenZeroCost when absent from catalog', async () => {
  const provider = new OpenRouterProvider({
    apiKey: 'openrouter-fake-key-777',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    allowLiveCalls: true,
    fetchImpl: async (url) => {
      if (url === APPROVED_ENDPOINTS.openrouter.auth) {
        return { ok: true, json: async () => ({ data: { usage: 0, limit: 100, is_free_tier: true } }) };
      }
      if (url === APPROVED_ENDPOINTS.openrouter.models) {
        return { ok: true, json: async () => ({ data: [{ id: 'other-model:free' }] }) };
      }
      throw new Error(`Unexpected destination: ${url}`);
    }
  });

  const check = await provider.checkAccess();
  assert.equal(check.authenticated, true);
  assert.equal(check.modelAvailable, false);
  assert.equal(check.provenZeroCost, false);
});

test('OpenRouter checkAccess rejects absent, missing, malformed or nonzero pricing', async () => {
  const badPricingBodies = [
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free' }] }, // absent pricing
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: {} }] }, // missing prompt/completion
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0' } }] }, // missing completion
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0.0001' } }] }, // nonzero completion
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: 'invalid', completion: '0' } }] }, // malformed
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: false, completion: '0' } }] }, // boolean false
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: [] } }] }, // array []
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '   ', completion: '0' } }] }, // whitespace string
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '', completion: '0' } }] }, // empty string
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: null, completion: '0' } }] }, // null value
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: {}, completion: '0' } }] }, // plain object
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: -0, completion: 0 } }] }, // negative zero
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '-0', completion: '0' } }] } // negative zero string
  ];

  for (const body of badPricingBodies) {
    const provider = new OpenRouterProvider({
      apiKey: 'openrouter-fake-key-777',
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      allowLiveCalls: true,
      fetchImpl: async (url) => {
        if (url === APPROVED_ENDPOINTS.openrouter.auth) {
          return { ok: true, json: async () => ({ data: { usage: 0, limit: 100, is_free_tier: true } }) };
        }
        if (url === APPROVED_ENDPOINTS.openrouter.models) {
          return { ok: true, json: async () => body };
        }
        throw new Error(`Unexpected destination: ${url}`);
      }
    });

    await assert.rejects(
      provider.checkAccess(),
      FreeRoutingViolationError,
      'Missing or nonzero pricing must throw FreeRoutingViolationError and not yield proof'
    );
  }
});

test('OpenRouter checkAccess rejects missing or empty supported_parameters capabilities', async () => {
  const badCapabilityBodies = [
    // Missing supported_parameters
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0' } }] },
    // Empty supported_parameters
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0' }, supported_parameters: [] }] },
    // Missing tools in supported_parameters
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['temperature', 'max_tokens'] }] },
    // Null supported_parameters
    { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0' }, supported_parameters: null }] }
  ];

  for (const body of badCapabilityBodies) {
    const provider = new OpenRouterProvider({
      apiKey: 'openrouter-fake-key-777',
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      allowLiveCalls: true,
      fetchImpl: async (url) => {
        if (url === APPROVED_ENDPOINTS.openrouter.auth) {
          return { ok: true, json: async () => ({ data: { usage: 0, limit: 100, is_free_tier: true } }) };
        }
        if (url === APPROVED_ENDPOINTS.openrouter.models) {
          return { ok: true, json: async () => body };
        }
        throw new Error(`Unexpected destination: ${url}`);
      }
    });

    await assert.rejects(
      provider.checkAccess(),
      FreeRoutingViolationError,
      'Missing or empty supported_parameters must throw FreeRoutingViolationError and not yield proof'
    );
  }
});

// ============================================================================
// 7. Recursive Secret Sanitization Across All Shapes, Plain Objects, and Cycles
// ============================================================================

test('sanitizeError scrubs synthetic keys across plain objects, nested causes, and arrays', () => {
  const CANARY = 'SYNTHETIC_CANARY_KEY_XYZ_999';

  // Plain object with message, cause, errors, and custom fields
  const plainObject = {
    message: `Request failed with ${CANARY}`,
    cause: {
      message: `Inner failure ${CANARY}`,
      token: CANARY
    },
    errors: [
      { message: `Error in batch: ${CANARY}` },
      `String error with ${CANARY}`
    ],
    details: {
      authHeader: `Bearer ${CANARY}`
    }
  };

  sanitizeError(plainObject, [CANARY]);

  assert.equal(plainObject.message.includes(CANARY), false);
  assert.ok(plainObject.message.includes('[REDACTED]'));
  assert.equal(plainObject.cause.message.includes(CANARY), false);
  assert.equal(plainObject.cause.token.includes(CANARY), false);
  assert.equal(plainObject.errors[0].message.includes(CANARY), false);
  assert.equal(plainObject.errors[1].includes(CANARY), false);
  assert.equal(plainObject.details.authHeader.includes(CANARY), false);
});

test('sanitizeError recursively cleans Error instances with plain and Error causes', () => {
  const CANARY = 'SYNTHETIC_CANARY_KEY_XYZ_999';

  const errWithPlainCause = new Error(`Top level: ${CANARY}`);
  errWithPlainCause.cause = {
    message: `Plain cause message with ${CANARY}`,
    secretField: CANARY
  };

  sanitizeError(errWithPlainCause, [CANARY]);
  assert.equal(errWithPlainCause.message.includes(CANARY), false);
  // @ts-expect-error test inspection
  assert.equal(errWithPlainCause.cause.message.includes(CANARY), false);
  // @ts-expect-error test inspection
  assert.equal(errWithPlainCause.cause.secretField.includes(CANARY), false);
});

test('sanitizeError safely terminates on cyclic references in plain objects and Errors', () => {
  const CANARY = 'SYNTHETIC_CANARY_KEY_XYZ_999';

  // Cyclic plain object
  const cyclicPlain = { token: CANARY };
  // @ts-expect-error create cycle
  cyclicPlain.loop = cyclicPlain;

  // Cyclic Error
  const cyclicErr = new Error(`Error: ${CANARY}`);
  // @ts-expect-error create cyclic cause
  cyclicErr.cause = cyclicErr;

  sanitizeError(cyclicPlain, [CANARY]);
  sanitizeError(cyclicErr, [CANARY]);

  assert.equal(cyclicPlain.token.includes(CANARY), false);
  assert.equal(cyclicErr.message.includes(CANARY), false);
});

test('HTTP errors do not echo raw response bodies', async () => {
  const SECRET_BODY = '{"secret_payload":"sensitive_data_12345"}';
  const provider = new GroqProvider({
    apiKey: 'test-key',
    allowLiveCalls: true,
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      text: async () => SECRET_BODY
    })
  });

  try {
    await provider.next({ messages: [{ role: 'user', content: 'test' }], tools: ['list_paths'] });
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err instanceof ProviderError);
    assert.equal(err.message.includes(SECRET_BODY), false, 'Error message must not echo response body');
  }
});

// ============================================================================
// 8. Offline Provider Parity & Factory
// ============================================================================

test('GroqProvider maps messages, tools, tool_choice and usage accurately', async () => {
  const provider = new GroqProvider({
    apiKey: 'groq-key',
    allowLiveCalls: true,
    fetchImpl: async (url, options) => {
      assert.equal(url, APPROVED_ENDPOINTS.groq.chat);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { tool_calls: [{ function: { name: 'list_paths', arguments: '{}' } }] } }],
          usage: { prompt_tokens: 25, completion_tokens: 10 }
        })
      };
    }
  });

  const res = await provider.next({
    messages: [
      { role: 'user', content: 'List files' },
      { role: 'assistant', toolCall: { name: 'list_paths', args: {} } },
      { role: 'tool', content: '["a.txt"]' }
    ],
    tools: ['list_paths']
  });

  assert.deepEqual(res, {
    toolCalls: [{ name: 'list_paths', args: {} }],
    usage: { inputTokens: 25, outputTokens: 10 }
  });
});

test('OpenCodeProvider operates on canonical API slugs', async () => {
  let capturedModel;
  const provider = new OpenCodeProvider({
    apiKey: 'opencode-key',
    model: 'deepseek-v4.1-flash-free',
    allowLiveCalls: true,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      capturedModel = body.model;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { tool_calls: [{ function: { name: 'search', arguments: '{"term":"abc"}' } }] } }],
          usage: { prompt_tokens: 30, completion_tokens: 8 }
        })
      };
    }
  });

  const res = await provider.next({ messages: [{ role: 'user', content: 'search' }], tools: ['search'] });
  assert.equal(capturedModel, 'deepseek-v4.1-flash-free');
  assert.deepEqual(res.toolCalls, [{ name: 'search', args: { term: 'abc' } }]);
});

test('createModelProvider factory instantiates correct adapters', () => {
  const g = createModelProvider({ provider: 'groq', apiKey: 'k', model: 'qwen/qwen3.8-27b', allowLiveCalls: true });
  assert.ok(g instanceof GroqProvider);

  const oc = createModelProvider({ provider: 'opencode', apiKey: 'k', model: 'glm-5.3-flash-free', allowLiveCalls: true });
  assert.ok(oc instanceof OpenCodeProvider);

  const or = createModelProvider({ provider: 'openrouter', apiKey: 'k', model: 'meta-llama/llama-3.3-70b-instruct:free', allowLiveCalls: true });
  assert.ok(or instanceof OpenRouterProvider);

  assert.throws(() => createModelProvider({ provider: 'fake', apiKey: 'k' }), FreeRoutingViolationError);
});

// ============================================================================
// 9. Status & Transport Error Classifications
// ============================================================================

test('HTTP statuses map to correct error classes', async () => {
  const statuses = [
    { code: 400, expected: ProviderError },
    { code: 401, expected: ProviderError },
    { code: 402, expected: FreeTierDepletedError },
    { code: 429, expected: RateLimitError },
    { code: 500, expected: ProviderTransportError },
    { code: 503, expected: ProviderTransportError }
  ];

  for (const s of statuses) {
    const provider = new GroqProvider({
      apiKey: 'test-key',
      allowLiveCalls: true,
      fetchImpl: async () => ({
        ok: false,
        status: s.code,
        headers: { get: () => '10' }
      })
    });

    await assert.rejects(
      provider.next({ messages: [{ role: 'user', content: 'hi' }], tools: ['list_paths'] }),
      (err) => err instanceof s.expected && err.status === s.code
    );
  }
});

test('Transport failure retries once and reports networkCodes on persistent error', async () => {
  let attempts = 0;
  const provider = new GroqProvider({
    apiKey: 'test-key',
    allowLiveCalls: true,
    retryDelayMs: 1,
    fetchImpl: async () => {
      attempts++;
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' })
      });
    }
  });

  await assert.rejects(
    provider.next({ messages: [{ role: 'user', content: 'hi' }], tools: ['list_paths'], timeoutMs: 5000 }),
    (err) => err instanceof ProviderTransportError && err.attempts === 2 && err.networkCodes.includes('ECONNRESET')
  );
  assert.equal(attempts, 2);
});

test('networkCodes recursively resolves codes across cause chains', () => {
  const err = Object.assign(new Error('level1'), {
    code: 'ECONNREFUSED',
    cause: Object.assign(new Error('level2'), { code: 'ETIMEDOUT' })
  });
  const codes = networkCodes(err);
  assert.ok(codes.includes('ECONNREFUSED'));
  assert.ok(codes.includes('ETIMEDOUT'));
});

// ============================================================================
// 10. Bounded Model Discovery, Snapshot Management & Validator Port (W3-AGR4)
// ============================================================================

test('ModelDiscoveryService discovers cohere/north-mini-code:free, negotiates unsupported parameters, and does not invent missing request zero', async () => {
  // 1. OpenRouter default model remains meta-llama/llama-3.3-70b-instruct:free
  const defaultProvider = new OpenRouterProvider({ apiKey: 'fake-test-key-999', allowLiveCalls: true });
  assert.equal(defaultProvider.model, 'meta-llama/llama-3.3-70b-instruct:free');

  // 2. Discover cohere/north-mini-code:free via injected mock fetch with prompt and completion zero, NO request pricing
  let fetchCalled = false;
  const mockModels = {
    data: [
      {
        id: 'cohere/north-mini-code:free',
        name: 'Cohere North Mini Code (Free)',
        context_length: 32768,
        pricing: { prompt: '0', completion: '0' },
        supported_parameters: ['tools', 'temperature', 'max_tokens']
      }
    ]
  };

  const discovery = new ModelDiscoveryService({ defaultTtlMs: 60000 });
  const snapshot = await discovery.discoverModel({
    provider: 'openrouter',
    modelId: 'cohere/north-mini-code:free',
    apiKey: 'fake-test-key-999',
    allowLiveCalls: true,
    fetchImpl: async (url, options) => {
      fetchCalled = true;
      assert.equal(url, APPROVED_ENDPOINTS.openrouter.models);
      assert.equal(options.headers.Authorization, 'Bearer fake-test-key-999');
      return {
        ok: true,
        json: async () => mockModels
      };
    }
  });

  assert.equal(fetchCalled, true);
  assert.equal(snapshot.id, 'cohere/north-mini-code:free');
  assert.equal(snapshot.provider, 'openrouter');
  assert.equal(snapshot.isFree, true);
  // Do NOT invent missing request zero:
  assert.deepEqual(snapshot.pricing, { inputCostPerM: 0, outputCostPerM: 0 });
  assert.equal('requestCost' in snapshot.pricing, false, 'requestCost must not be invented when missing');
  assert.equal(snapshot.toolCalling, true);
  assert.deepEqual(snapshot.supportedParameters, ['tools', 'temperature', 'max_tokens']);
  assert.equal(snapshot.negotiatedParameters.parallelToolCalls, false);
  assert.equal(snapshot.negotiatedParameters.toolChoice, false);
  assert.equal(snapshot.negotiatedParameters.maxTokensParam, 'max_tokens');
  assert.equal(snapshot.negotiatedParameters.tools, true);
  assert.equal(snapshot.accountEligibility, 'unknown');
  assert.ok(snapshot.checkedAt);
  assert.ok(snapshot.ttlMs > 0);
  assert.ok(snapshot.expiresAt > Date.now());

  // 3. Verify outbound parameter capability negotiation during next()
  let cohereSentBody = null;
  const cohereProvider = new OpenRouterProvider({
    apiKey: 'fake-test-key-999',
    model: 'cohere/north-mini-code:free',
    allowLiveCalls: true,
    fetchImpl: async (url, options) => {
      cohereSentBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { tool_calls: [{ function: { name: 'list_paths', arguments: '{}' } }] } }],
          usage: { prompt_tokens: 15, completion_tokens: 5 }
        })
      };
    }
  });

  await cohereProvider.next({
    messages: [{ role: 'user', content: 'test' }],
    tools: ['list_paths'],
    maxOutputTokens: 500
  });

  assert.ok(cohereSentBody);
  // parallel_tool_calls MUST be omitted
  assert.equal('parallel_tool_calls' in cohereSentBody, false, 'parallel_tool_calls must be omitted for models lacking capability');
  // tool_choice MUST be omitted because cohere does not support it
  assert.equal('tool_choice' in cohereSentBody, false, 'tool_choice must be omitted for models lacking capability');
  // max_tokens must be used, max_completion_tokens omitted
  assert.equal(cohereSentBody.max_tokens, 500);
  assert.equal('max_completion_tokens' in cohereSentBody, false, 'max_completion_tokens must be omitted when model only supports max_tokens');
  assert.equal(cohereSentBody.temperature, 0);
  assert.equal(cohereSentBody.model, 'cohere/north-mini-code:free');

  // 4. Contrast with meta-llama/llama-3.3-70b-instruct:free which supports tool_choice and parallel_tool_calls
  let llamaSentBody = null;
  const llamaProvider = new OpenRouterProvider({
    apiKey: 'fake-test-key-999',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    allowLiveCalls: true,
    fetchImpl: async (url, options) => {
      llamaSentBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { tool_calls: [{ function: { name: 'list_paths', arguments: '{}' } }] } }],
          usage: { prompt_tokens: 20, completion_tokens: 10 }
        })
      };
    }
  });

  await llamaProvider.next({
    messages: [{ role: 'user', content: 'test' }],
    tools: ['list_paths'],
    maxOutputTokens: 600
  });

  assert.ok(llamaSentBody);
  assert.equal(llamaSentBody.tool_choice, 'required', 'tool_choice must be included when capability is supported');
  assert.equal(llamaSentBody.parallel_tool_calls, false, 'parallel_tool_calls: false must be included when capability is supported');
  assert.equal(llamaSentBody.max_tokens, 600);
});

test('ModelDiscoveryService rejected paid refresh removes old free cache and transport failures invalidate cache', async () => {
  const discovery = new ModelDiscoveryService({ defaultTtlMs: 60000 });
  const mockFreeModel = {
    data: [{
      id: 'cohere/north-mini-code:free',
      name: 'Cohere North Mini Code (Free)',
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: ['tools', 'max_tokens']
    }]
  };

  // 1. Initial successful discovery caches free model
  await discovery.discoverModel({
    provider: 'openrouter',
    modelId: 'cohere/north-mini-code:free',
    apiKey: 'fake-test-key-999',
    allowLiveCalls: true,
    fetchImpl: async () => ({ ok: true, json: async () => mockFreeModel })
  });

  assert.ok(discovery.getSnapshot('openrouter', 'cohere/north-mini-code:free'), 'Free model snapshot should be cached');

  // 2. Refresh fails due to catalog price change to paid model (e.g. non-zero prompt price)
  const mockPaidModel = {
    data: [{
      id: 'cohere/north-mini-code:free',
      name: 'Cohere North Mini Code (Paid)',
      pricing: { prompt: '0.0001', completion: '0' },
      supported_parameters: ['tools', 'max_tokens']
    }]
  };

  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'fake-test-key-999',
      allowLiveCalls: true,
      forceRefresh: true,
      fetchImpl: async () => ({ ok: true, json: async () => mockPaidModel })
    }),
    FreeRoutingViolationError
  );

  // Rejected paid refresh MUST remove the old free cache so it is NEVER left usable
  assert.equal(
    discovery.getSnapshot('openrouter', 'cohere/north-mini-code:free'),
    null,
    'Old free cache must be removed upon failed refresh'
  );

  // 3. Re-populate free cache
  await discovery.discoverModel({
    provider: 'openrouter',
    modelId: 'cohere/north-mini-code:free',
    apiKey: 'fake-test-key-999',
    allowLiveCalls: true,
    fetchImpl: async () => ({ ok: true, json: async () => mockFreeModel })
  });
  assert.ok(discovery.getSnapshot('openrouter', 'cohere/north-mini-code:free'));

  // 4. Refresh fails due to transport error (e.g. ECONNRESET)
  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'fake-test-key-999',
      allowLiveCalls: true,
      forceRefresh: true,
      fetchImpl: async () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' })
        });
      }
    }),
    ProviderTransportError
  );

  // Transport failure during refresh MUST also invalidate the old cache
  assert.equal(
    discovery.getSnapshot('openrouter', 'cohere/north-mini-code:free'),
    null,
    'Old free cache must be removed upon transport failure during refresh'
  );
});

test('BaseOpenAICompatibleProvider builds complete requests from validated supported parameters (max_tokens vs max_completion_tokens, tool_choice)', async () => {
  // 1. Groq provider with max_completion_tokens and tool_choice
  let groqBody = null;
  const groq = new GroqProvider({
    apiKey: 'fake-test-key-999',
    model: 'qwen/qwen3.8-27b',
    allowLiveCalls: true,
    fetchImpl: async (url, options) => {
      groqBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { tool_calls: [{ function: { name: 'list_paths', arguments: '{}' } }] } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        })
      };
    }
  });

  await groq.next({ messages: [{ role: 'user', content: 'hi' }], tools: ['list_paths'], maxOutputTokens: 400 });
  assert.ok(groqBody);
  assert.equal(groqBody.tool_choice, 'required');
  assert.equal(groqBody.max_completion_tokens, 400);
  assert.equal('max_tokens' in groqBody, false);
  assert.equal(groqBody.parallel_tool_calls, false);
  assert.equal(groqBody.temperature, 0);

  // 2. OpenCode provider with max_tokens and tool_choice
  let openCodeBody = null;
  const openCode = new OpenCodeProvider({
    apiKey: 'fake-test-key-999',
    model: 'deepseek-v4.1-flash-free',
    allowLiveCalls: true,
    fetchImpl: async (url, options) => {
      openCodeBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { tool_calls: [{ function: { name: 'search', arguments: '{}' } }] } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        })
      };
    }
  });

  await openCode.next({ messages: [{ role: 'user', content: 'hi' }], tools: ['search'], maxOutputTokens: 300 });
  assert.ok(openCodeBody);
  assert.equal(openCodeBody.tool_choice, 'required');
  assert.equal(openCodeBody.max_tokens, 300);
  assert.equal('max_completion_tokens' in openCodeBody, false);
  assert.equal('parallel_tool_calls' in openCodeBody, false);
  assert.equal(openCodeBody.temperature, 0);
});

test('ModelDiscoveryService strictly fails closed when allowLiveCalls is false or not literal true', async () => {
  const discovery = new ModelDiscoveryService();
  let fetchRunCount = 0;
  const mockFetch = async () => {
    fetchRunCount++;
    return { ok: true, json: async () => ({ data: [] }) };
  };

  const falsyFlags = [false, undefined, null, 'true', 1, 0, {}];
  for (const flag of falsyFlags) {
    await assert.rejects(
      discovery.discoverModel({
        provider: 'openrouter',
        modelId: 'cohere/north-mini-code:free',
        apiKey: 'fake-test-key-999',
        // @ts-expect-error testing invalid types
        allowLiveCalls: flag,
        fetchImpl: mockFetch
      }),
      (err) => err instanceof ProviderError && err.message.includes('Live inference disabled')
    );
  }

  assert.equal(fetchRunCount, 0, 'Zero network calls must occur when allowLiveCalls is not literal true');
});

test('ModelDiscoveryService handles absent endpoint, 404, malformed body, and transport errors', async () => {
  const discovery = new ModelDiscoveryService();

  // 1. Missing / invalid provider endpoint
  await assert.rejects(
    // @ts-expect-error testing invalid provider
    discovery.discoverModel({ provider: 'unapproved_provider', modelId: 'test', apiKey: 'fake-discovery-key-999', allowLiveCalls: true }),
    FreeRoutingViolationError
  );

  // 2. HTTP 404 from models endpoint
  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'fake-discovery-key-999',
      allowLiveCalls: true,
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null }
      })
    }),
    (err) => err instanceof ProviderError && err.status === 404
  );

  // 3. Malformed JSON response
  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'fake-discovery-key-999',
      allowLiveCalls: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => { throw new SyntaxError('Unexpected token'); }
      })
    }),
    (err) => err instanceof ProviderError && err.message.includes('Malformed')
  );

  // 4. Missing data array in JSON
  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'fake-discovery-key-999',
      allowLiveCalls: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ notData: [] })
      })
    }),
    (err) => err instanceof ProviderError && err.message.includes('missing data array')
  );

  // 5. Network transport failure (ECONNREFUSED)
  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'fake-discovery-key-999',
      allowLiveCalls: true,
      fetchImpl: async () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
        });
      }
    }),
    (err) => err instanceof ProviderTransportError && err.networkCodes.includes('ECONNREFUSED')
  );
});

test('ModelDiscoveryService rejects model absent from catalog, missing pricing, non-zero pricing, or unsupported tools', async () => {
  const discovery = new ModelDiscoveryService();

  // 1. Model absent from catalog
  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'fake-discovery-key-999',
      allowLiveCalls: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ data: [{ id: 'other-model:free' }] })
      })
    }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('not found')
  );

  // 2. Missing pricing object
  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'fake-discovery-key-999',
      allowLiveCalls: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: [{ id: 'cohere/north-mini-code:free', supported_parameters: ['tools'] }]
        })
      })
    }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('missing pricing')
  );

  // 3. Non-zero pricing in catalog (e.g. catalog changed to paid)
  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'fake-discovery-key-999',
      allowLiveCalls: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: [{
            id: 'cohere/north-mini-code:free',
            pricing: { prompt: '0.000001', completion: '0' },
            supported_parameters: ['tools', 'max_tokens']
          }]
        })
      })
    }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('not finite positive zero')
  );

  // 4. Missing tools in supported_parameters
  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'fake-discovery-key-999',
      allowLiveCalls: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: [{
            id: 'cohere/north-mini-code:free',
            pricing: { prompt: '0', completion: '0' },
            supported_parameters: ['temperature', 'max_tokens']
          }]
        })
      })
    }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('lacks verified tool calling')
  );
});

test('ModelDiscoveryService manages TTL caching, forceRefresh, cache invalidation, and clear', async () => {
  let fetchCount = 0;
  const mockModels = {
    data: [{
      id: 'cohere/north-mini-code:free',
      name: 'Cohere North Mini Code (Free)',
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: ['tools', 'max_tokens']
    }]
  };
  const mockFetch = async () => {
    fetchCount++;
    return { ok: true, json: async () => mockModels };
  };

  const discovery = new ModelDiscoveryService({ defaultTtlMs: 20 });

  // 1. First fetch populates cache
  const snap1 = await discovery.discoverModel({
    provider: 'openrouter',
    modelId: 'cohere/north-mini-code:free',
    apiKey: 'fake-discovery-key-999',
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });
  assert.equal(fetchCount, 1);
  assert.equal(snap1.id, 'cohere/north-mini-code:free');

  // 2. Second immediate fetch returns cached snapshot without network hit
  const snap2 = await discovery.discoverModel({
    provider: 'openrouter',
    modelId: 'cohere/north-mini-code:free',
    apiKey: 'fake-discovery-key-999',
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });
  assert.equal(fetchCount, 1, 'Cached snapshot must not trigger network fetch');
  assert.equal(snap2.id, 'cohere/north-mini-code:free');

  // 3. getSnapshot directly accesses cache
  const cached = discovery.getSnapshot('openrouter', 'cohere/north-mini-code:free');
  assert.ok(cached);
  assert.equal(cached.id, 'cohere/north-mini-code:free');

  // 4. forceRefresh bypasses cache
  await discovery.discoverModel({
    provider: 'openrouter',
    modelId: 'cohere/north-mini-code:free',
    apiKey: 'fake-discovery-key-999',
    allowLiveCalls: true,
    forceRefresh: true,
    fetchImpl: mockFetch
  });
  assert.equal(fetchCount, 2, 'forceRefresh must trigger a new fetch');

  // 5. Invalidate specific model
  discovery.invalidate('openrouter', 'cohere/north-mini-code:free');
  assert.equal(discovery.getSnapshot('openrouter', 'cohere/north-mini-code:free'), null);

  // 6. Cache expiration after TTL
  await discovery.discoverModel({
    provider: 'openrouter',
    modelId: 'cohere/north-mini-code:free',
    apiKey: 'fake-discovery-key-999',
    allowLiveCalls: true,
    ttlMs: 15,
    fetchImpl: mockFetch
  });
  assert.equal(fetchCount, 3);
  assert.ok(discovery.getSnapshot('openrouter', 'cohere/north-mini-code:free'));

  // Wait for TTL to expire
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(discovery.getSnapshot('openrouter', 'cohere/north-mini-code:free'), null, 'Expired snapshot must be evicted');

  // 7. Clear removes all snapshots
  await discovery.discoverModel({
    provider: 'openrouter',
    modelId: 'cohere/north-mini-code:free',
    apiKey: 'fake-discovery-key-999',
    allowLiveCalls: true,
    ttlMs: 60000,
    fetchImpl: mockFetch
  });
  assert.ok(discovery.getSnapshot('openrouter', 'cohere/north-mini-code:free'));
  discovery.clear();
  assert.equal(discovery.getSnapshot('openrouter', 'cohere/north-mini-code:free'), null);
});

test('Validator Port exposes standalone validation and correctly validates valid snapshots and routes for AGR-5', () => {
  const port = createModelValidatorPort();
  assert.equal(typeof port.validateSnapshot, 'function');
  assert.equal(typeof port.validateRoute, 'function');
  assert.equal(typeof port.getMetadata, 'function');
  assert.ok(port.approvedEndpoints);

  const now = Date.now();
  const validSnapshot = {
    id: 'cohere/north-mini-code:free',
    provider: 'openrouter',
    displayName: 'Cohere North Mini Code (Free)',
    contextWindow: 32768,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0, requestCost: 0 },
    isFree: true,
    supportedParameters: ['tools', 'temperature', 'max_tokens'],
    negotiatedParameters: { parallelToolCalls: false, tools: true },
    source: APPROVED_ENDPOINTS.openrouter.models,
    checkedAt: new Date(now).toISOString(),
    ttlMs: 60000,
    expiresAt: now + 60000,
    accountEligibility: 'unknown'
  };

  // 1. Valid snapshot passes validation
  const validation = port.validateSnapshot(validSnapshot);
  assert.equal(validation.valid, true);
  assert.equal(validation.provenZeroCost, true);
  assert.equal(validation.toolCalling, true);

  // 2. Snapshot without requestCost (not invented) also passes validation
  const validNoRequestCost = {
    ...validSnapshot,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 }
  };
  const valNoReq = port.validateSnapshot(validNoRequestCost);
  assert.equal(valNoReq.valid, true);

  // 3. allowExpired bypasses expiration check
  const expiredSnapshot = {
    ...validSnapshot,
    checkedAt: new Date(now - 120000).toISOString(),
    expiresAt: now - 60000,
    ttlMs: 60000
  };
  const allowedExpired = port.validateSnapshot(expiredSnapshot, { allowExpired: true });
  assert.equal(allowedExpired.valid, true);

  // 4. Route validation accepts free catalog models and rejects invalid/paid
  const validRoute = port.validateRoute({
    provider: 'openrouter',
    model: 'cohere/north-mini-code:free',
    endpoint: APPROVED_ENDPOINTS.openrouter.chat
  });
  assert.equal(validRoute.id, 'cohere/north-mini-code:free');

  assert.throws(
    () => port.validateRoute({ provider: 'openrouter', model: 'unverified-paid-model', endpoint: APPROVED_ENDPOINTS.openrouter.chat }),
    FreeRoutingViolationError
  );

  // 5. getMetadata returns catalog metadata
  const cohereMeta = port.getMetadata('cohere/north-mini-code:free', 'openrouter');
  assert.ok(cohereMeta);
  assert.equal(cohereMeta.isFree, true);
  assert.equal(cohereMeta.pricing.inputCostPerM, 0);
});

test('Validator Port rejects malformed snapshots across identity, source, timestamps, TTL, capabilities, and pricing', () => {
  const port = createModelValidatorPort();
  const now = Date.now();

  const baseSnapshot = {
    id: 'cohere/north-mini-code:free',
    provider: 'openrouter',
    displayName: 'Cohere North Mini Code (Free)',
    contextWindow: 32768,
    toolCalling: true,
    pricing: { inputCostPerM: 0, outputCostPerM: 0 },
    isFree: true,
    supportedParameters: ['tools', 'temperature', 'max_tokens'],
    source: APPROVED_ENDPOINTS.openrouter.models,
    checkedAt: new Date(now).toISOString(),
    ttlMs: 60000,
    expiresAt: now + 60000
  };

  // 1. Malformed identity & unapproved provider
  assert.throws(() => port.validateSnapshot(null), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot('not an object'), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot([]), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, provider: '' }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, provider: 'evil_provider' }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, id: '' }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, id: 'model-without-free' }), FreeRoutingViolationError);

  // 2. Unapproved / invalid source endpoint
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, source: '' }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, source: 'https://evil.com/models' }), FreeRoutingViolationError);

  // 3. Non-finite, invalid, or incoherent timestamps & TTL
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, checkedAt: 'invalid-date' }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, ttlMs: 0 }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, ttlMs: -100 }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, ttlMs: Infinity }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, ttlMs: NaN }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, expiresAt: 0 }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, expiresAt: -100 }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, expiresAt: Infinity }), FreeRoutingViolationError);

  // Future checkedAt claims must be rejected: evidence cannot be from the future
  assert.throws(
    () => port.validateSnapshot({
      ...baseSnapshot,
      checkedAt: new Date(now + 60000).toISOString(),
      expiresAt: now + 120000,
      ttlMs: 60000
    }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('in the future')
  );

  // Incoherent timestamps: expiresAt earlier than checkedAt
  assert.throws(
    () => port.validateSnapshot({ ...baseSnapshot, checkedAt: new Date(now).toISOString(), expiresAt: now - 1000 }),
    FreeRoutingViolationError
  );
  // Incoherent timestamps: expiresAt does not match checkedAt + ttlMs
  assert.throws(
    () => port.validateSnapshot({ ...baseSnapshot, checkedAt: new Date(now).toISOString(), ttlMs: 60000, expiresAt: now + 999999 }),
    FreeRoutingViolationError
  );

  // Expired snapshot in strict mode
  assert.throws(
    () => port.validateSnapshot({
      ...baseSnapshot,
      checkedAt: new Date(now - 120000).toISOString(),
      ttlMs: 60000,
      expiresAt: now - 60000
    }),
    FreeRoutingViolationError
  );
  // Expired snapshot in non-strict mode returns { valid: false, expired: true }
  const nonStrictExpired = port.validateSnapshot({
    ...baseSnapshot,
    checkedAt: new Date(now - 120000).toISOString(),
    ttlMs: 60000,
    expiresAt: now - 60000
  }, { strict: false });
  assert.equal(nonStrictExpired.valid, false);
  assert.equal(nonStrictExpired.expired, true);

  // 4. Capabilities: non-literal toolCalling, missing/empty supportedParameters, and lack of token limits
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, toolCalling: false }), FreeRoutingViolationError);
  // @ts-expect-error test non-boolean
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, toolCalling: 'true' }), FreeRoutingViolationError);
  // @ts-expect-error test non-boolean
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, toolCalling: 1 }), FreeRoutingViolationError);
  // Missing or empty supportedParameters
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, supportedParameters: undefined }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, supportedParameters: null }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, supportedParameters: [] }), FreeRoutingViolationError);
  // @ts-expect-error test non-string capability
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, supportedParameters: [123] }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, supportedParameters: [''] }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, supportedParameters: ['temperature'] }), FreeRoutingViolationError);
  // Tools-only lacking output token limit
  assert.throws(
    () => port.validateSnapshot({ ...baseSnapshot, supportedParameters: ['tools'] }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('output token limit')
  );
  // Token limit only lacking tools
  assert.throws(
    () => port.validateSnapshot({ ...baseSnapshot, supportedParameters: ['max_tokens'] }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('tools')
  );

  // 5. Pricing: non-zero input, output, or request pricing
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, pricing: null }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, pricing: { inputCostPerM: 0.001, outputCostPerM: 0 } }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, pricing: { inputCostPerM: 0, outputCostPerM: 0.001 } }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, pricing: { inputCostPerM: -0, outputCostPerM: 0 } }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, pricing: { inputCostPerM: 0, outputCostPerM: 0, requestCost: 0.001 } }), FreeRoutingViolationError);
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, pricing: { inputCostPerM: 0, outputCostPerM: 0, requestCost: -0 } }), FreeRoutingViolationError);
  // @ts-expect-error test string requestCost
  assert.throws(() => port.validateSnapshot({ ...baseSnapshot, pricing: { inputCostPerM: 0, outputCostPerM: 0, requestCost: '0' } }), FreeRoutingViolationError);
});

test('ModelDiscoveryService rejects non-finite TTL (Infinity, NaN, <= 0) and tools-only supported_parameters', async () => {
  // Discovery constructor rejects Infinity, NaN, <= 0
  assert.throws(() => new ModelDiscoveryService({ defaultTtlMs: Infinity }), FreeRoutingViolationError);
  assert.throws(() => new ModelDiscoveryService({ defaultTtlMs: NaN }), FreeRoutingViolationError);
  assert.throws(() => new ModelDiscoveryService({ defaultTtlMs: -100 }), FreeRoutingViolationError);
  assert.throws(() => new ModelDiscoveryService({ defaultTtlMs: 0 }), FreeRoutingViolationError);

  const discovery = new ModelDiscoveryService({ defaultTtlMs: 60000 });

  // discoverModel rejects ttlMs: Infinity, NaN, <= 0, > 86400000
  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'test-key',
      allowLiveCalls: true,
      ttlMs: Infinity,
      fetchImpl: async () => ({ ok: true, json: async () => ({}) })
    }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('finite positive number')
  );

  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'test-key',
      allowLiveCalls: true,
      ttlMs: NaN,
      fetchImpl: async () => ({ ok: true, json: async () => ({}) })
    }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('finite positive number')
  );

  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'test-key',
      allowLiveCalls: true,
      ttlMs: -1,
      fetchImpl: async () => ({ ok: true, json: async () => ({}) })
    }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('finite positive number')
  );

  // discoverModel rejects OpenRouter model with tools-only supported_parameters (lacking token limit parameter)
  await assert.rejects(
    discovery.discoverModel({
      provider: 'openrouter',
      modelId: 'cohere/north-mini-code:free',
      apiKey: 'test-key',
      allowLiveCalls: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: [{
            id: 'cohere/north-mini-code:free',
            pricing: { prompt: '0', completion: '0' },
            supported_parameters: ['tools']
          }]
        })
      })
    }),
    (err) => err instanceof FreeRoutingViolationError && err.message.includes('lacks verified output token limit parameter')
  );

  // discoverModel caches finite expiresAt <= Date.now() + 86400000
  const snap = await discovery.discoverModel({
    provider: 'openrouter',
    modelId: 'cohere/north-mini-code:free',
    apiKey: 'test-key',
    allowLiveCalls: true,
    ttlMs: 60000,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        data: [{
          id: 'cohere/north-mini-code:free',
          pricing: { prompt: '0', completion: '0' },
          supported_parameters: ['tools', 'max_tokens']
        }]
      })
    })
  });
  assert.ok(Number.isFinite(snap.expiresAt));
  assert.ok(snap.expiresAt <= Date.now() + 86400000);
  assert.ok(snap.expiresAt > Date.now());
});

test('BaseOpenAICompatibleProvider.next enforces zero-dispatch fail-closed when snapshot has tools-only or absent capabilities', async () => {
  let fetchCallCount = 0;
  const mockFetch = async () => {
    fetchCallCount++;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
    };
  };

  const provider = new GroqProvider({
    apiKey: 'gsk_test12345678901234567890',
    model: 'qwen/qwen3.8-27b',
    allowLiveCalls: true,
    fetchImpl: mockFetch
  });

  const testMessages = [{ role: 'user', content: 'hello' }];
  const testTools = ['read_slice'];

  // 1. next() with tools-only snapshot fails closed with zero fetch calls
  await assert.rejects(
    provider.next({
      messages: testMessages,
      tools: testTools,
      maxOutputTokens: 5,
      snapshot: {
        supportedParameters: ['tools']
      }
    }),
    (err) => {
      return (
        err instanceof FreeRoutingViolationError &&
        err.message.includes('does not support an output token limit parameter') &&
        err.message.includes('Cannot enforce maxOutputTokens budget (5)')
      );
    }
  );
  assert.equal(fetchCallCount, 0, 'Zero network dispatch: fetch must not be called when output token limit is unsupported');

  // 2. Provider constructed with tools-only snapshot fails closed with zero fetch calls
  const toolsOnlyProvider = new GroqProvider({
    apiKey: 'gsk_test12345678901234567890',
    model: 'qwen/qwen3.8-27b',
    allowLiveCalls: true,
    fetchImpl: mockFetch,
    snapshot: {
      supportedParameters: ['tools']
    }
  });

  await assert.rejects(
    toolsOnlyProvider.next({
      messages: testMessages,
      tools: testTools,
      maxOutputTokens: 5
    }),
    (err) => {
      return (
        err instanceof FreeRoutingViolationError &&
        err.message.includes('does not support an output token limit parameter')
      );
    }
  );
  assert.equal(fetchCallCount, 0, 'Zero network dispatch: fetch must not be called when output token limit is unsupported');

  // 3. next() with absent/empty capabilities fails closed with zero fetch calls
  await assert.rejects(
    provider.next({
      messages: testMessages,
      tools: testTools,
      maxOutputTokens: 5,
      snapshot: {
        supportedParameters: []
      }
    }),
    (err) => {
      return (
        err instanceof FreeRoutingViolationError &&
        err.message.includes("lacks verified 'supportedParameters' capability evidence")
      );
    }
  );
  assert.equal(fetchCallCount, 0, 'Zero network dispatch: fetch must not be called when supportedParameters is empty');

  // 4. next() with token-limit-only capabilities (lacking tools) fails closed with zero fetch calls
  await assert.rejects(
    provider.next({
      messages: testMessages,
      tools: testTools,
      maxOutputTokens: 5,
      snapshot: {
        supportedParameters: ['max_tokens']
      }
    }),
    (err) => {
      return (
        err instanceof FreeRoutingViolationError &&
        err.message.includes('does not support tool calling in supportedParameters')
      );
    }
  );
  assert.equal(fetchCallCount, 0, 'Zero network dispatch: fetch must not be called when tool calling is unsupported');

  // 5. next() with valid capabilities (both tools and max_tokens) succeeds and dispatches request with max_tokens: 5
  let dispatchedBody = null;
  const validFetch = async (url, opts) => {
    fetchCallCount++;
    dispatchedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'read_slice', arguments: '{"path":"a.txt"}' }
            }]
          }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
    };
  };

  const validProvider = new GroqProvider({
    apiKey: 'gsk_test12345678901234567890',
    model: 'qwen/qwen3.8-27b',
    allowLiveCalls: true,
    fetchImpl: validFetch
  });

  const res = await validProvider.next({
    messages: testMessages,
    tools: testTools,
    maxOutputTokens: 5,
    snapshot: {
      supportedParameters: ['tools', 'max_tokens']
    }
  });

  assert.equal(fetchCallCount, 1);
  assert.ok(dispatchedBody);
  assert.equal(dispatchedBody.max_tokens, 5, 'Output token budget must be explicitly sent in request body');
  assert.equal(res.toolCalls.length, 1);
});



