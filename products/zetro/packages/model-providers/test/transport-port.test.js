import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BaseOpenAICompatibleProvider,
  createModelProvider,
  createConfiguredProvider,
  createTransportLifecyclePort,
  wrapFetchWithTransportLifecycle,
  ProviderError,
  ProviderTransportError
} from '../src/index.js';

const VALID_SNAPSHOT = Object.freeze({
  id: 'qwen/qwen3.8-27b',
  provider: 'groq',
  displayName: 'Qwen 3.8 27B',
  contextWindow: 131072,
  toolCalling: true,
  pricing: { inputCostPerM: 0, outputCostPerM: 0, requestCost: 0 },
  isFree: true,
  supportedParameters: ['tools', 'tool_choice', 'max_tokens', 'temperature'],
  source: 'verified-test',
  checkedAt: new Date().toISOString(),
  ttlMs: 3600000,
  expiresAt: Date.now() + 3600000,
  accountEligibility: 'verified'
});

describe('W6R-AGR4-reservation-dispatch-boundary Conformance Suite', () => {
  // Test 1: abortinsidereserve
  it('abortinsidereserve: Abort during async reserve that resolves ok:true results in 0 physical fetches', async () => {
    let physicalFetches = 0;
    const mockFetch = async () => {
      physicalFetches++;
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    };

    const ac = new AbortController();
    const reservations = [];

    const transportPort = createTransportLifecyclePort({
      reserve: async (ctx) => {
        reservations.push(ctx);
        // Abort while reserve is in-flight
        ac.abort();
        // Even if reserve resolves ok: true after abort was signaled
        return { ok: true };
      }
    });

    const provider = new BaseOpenAICompatibleProvider({
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      apiKey: 'gsk_test_secret_12345',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      modelsEndpoint: 'https://api.groq.com/openai/v1/models',
      fetchImpl: mockFetch,
      allowLiveCalls: true,
      snapshot: VALID_SNAPSHOT,
      transportPort
    });

    await assert.rejects(
      async () => {
        await provider.next({
          messages: [{ role: 'user', content: 'test abort in reserve' }],
          tools: ['submit_receipt'],
          signal: ac.signal
        });
      },
      (err) => {
        assert.equal(err.name, 'AbortError');
        assert.equal(err.attempts, 0, 'Must record 0 attempts when aborted inside reserve');
        assert.equal(err.retries, 0, 'Must record 0 retries');
        return true;
      }
    );

    assert.equal(physicalFetches, 0, 'Physical fetch count must be exactly 0 when aborted during reservation');
    assert.equal(reservations.length, 1, 'Reservation must have been entered once');
  });

  // Test 2: slowreserve deadline
  it('slowreserve deadline: Slow or hanging reservation is bounded by remaining deadline with 0 physical fetches', async () => {
    let physicalFetches = 0;
    const mockFetch = async () => {
      physicalFetches++;
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    };

    const transportPort = createTransportLifecyclePort({
      reserve: async () => {
        // Simulates slow or hanging reservation
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { ok: true };
      }
    });

    const provider = new BaseOpenAICompatibleProvider({
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      apiKey: 'gsk_test_secret_12345',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      modelsEndpoint: 'https://api.groq.com/openai/v1/models',
      fetchImpl: mockFetch,
      allowLiveCalls: true,
      snapshot: VALID_SNAPSHOT,
      transportPort
    });

    const start = Date.now();
    await assert.rejects(
      async () => {
        await provider.next({
          messages: [{ role: 'user', content: 'test slow reserve' }],
          tools: ['submit_receipt'],
          timeoutMs: 50 // Short 50ms deadline
        });
      },
      (err) => {
        assert(err instanceof ProviderTransportError, `Expected ProviderTransportError, got ${err.name}`);
        assert(
          err.networkCodes?.includes('ETIMEDOUT') || err.message.includes('deadline expired'),
          `Error must indicate timeout: ${err.message}`
        );
        assert.equal(err.attempts, 0, 'Must record 0 attempts when deadline expired during reservation');
        return true;
      }
    );

    const elapsed = Date.now() - start;
    assert(elapsed < 200, `Reservation wait must be bounded by remaining deadline, took ${elapsed}ms`);
    assert.equal(physicalFetches, 0, 'Zero physical fetches dispatched on slow reservation timeout');
  });

  // Test 3: malformedok
  it('malformedok: Non-literal ok:true (string, number, null, missing) fails closed with 0 physical fetches', async () => {
    const malformedCases = [
      { ok: 'true' }, // string
      { ok: 1 },      // truthy number
      { ok: null },   // null
      {},             // missing ok
      undefined       // undefined return
    ];

    for (const malformed of malformedCases) {
      let physicalFetches = 0;
      const mockFetch = async () => {
        physicalFetches++;
        return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      };

      const transportPort = createTransportLifecyclePort({
        reserve: async () => malformed
      });

      const provider = new BaseOpenAICompatibleProvider({
        provider: 'groq',
        model: 'qwen/qwen3.8-27b',
        apiKey: 'gsk_test_secret_12345',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        modelsEndpoint: 'https://api.groq.com/openai/v1/models',
        fetchImpl: mockFetch,
        allowLiveCalls: true,
        snapshot: VALID_SNAPSHOT,
        transportPort
      });

      await assert.rejects(
        async () => {
          await provider.next({
            messages: [{ role: 'user', content: 'test malformed ok' }],
            tools: ['submit_receipt']
          });
        },
        (err) => {
          assert(err instanceof ProviderError, 'Must throw ProviderError on non-literal ok:true');
          assert.equal(err.reservationDenied, true, 'Must indicate reservationDenied: true');
          assert.equal(err.attempts, 0, 'Must record 0 attempts');
          assert.equal(err.retries, 0, 'Must record 0 retries');
          return true;
        }
      );

      assert.equal(
        physicalFetches,
        0,
        `Malformed reservation ${JSON.stringify(malformed)} must fail closed with 0 physical fetches`
      );
    }
  });

  // Test 4: validreserve
  it('validreserve: Literal ok:true proceeds normally to dispatch physical fetch', async () => {
    let physicalFetches = 0;
    const mockFetch = async () => {
      physicalFetches++;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'call_valid',
                    type: 'function',
                    function: {
                      name: 'submit_receipt',
                      arguments: JSON.stringify({ valid: true })
                    }
                  }
                ]
              }
            }
          ],
          usage: { prompt_tokens: 30, completion_tokens: 15 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const reservations = [];
    const reports = [];

    const transportPort = createTransportLifecyclePort({
      reserve: async (ctx) => {
        reservations.push(ctx);
        return { ok: true };
      },
      report: async (ctx) => {
        reports.push(ctx);
      }
    });

    const provider = new BaseOpenAICompatibleProvider({
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      apiKey: 'gsk_test_secret_12345',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      modelsEndpoint: 'https://api.groq.com/openai/v1/models',
      fetchImpl: mockFetch,
      allowLiveCalls: true,
      snapshot: VALID_SNAPSHOT,
      transportPort
    });

    const result = await provider.next({
      messages: [{ role: 'user', content: 'test valid reserve' }],
      tools: ['submit_receipt']
    });

    assert.equal(physicalFetches, 1, 'Must dispatch exactly 1 physical fetch');
    assert.equal(result.attempts, 1);
    assert.equal(result.retries, 0);
    assert.equal(reservations.length, 1);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].ok, true);
    assert.equal(reports[0].status, 200);
  });

  // Test 5: retryactualcount
  it('retryactualcount: Transient failures retry and accurately count physical fetches, reservations, and reports', async () => {
    let physicalFetches = 0;
    const mockFetch = async () => {
      physicalFetches++;
      if (physicalFetches === 1) {
        const err = new TypeError('fetch failed');
        err.cause = { code: 'ECONNRESET' };
        throw err;
      }
      if (physicalFetches === 2) {
        const err = new TypeError('fetch failed');
        err.cause = { code: 'ETIMEDOUT' };
        throw err;
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'call_retry',
                    type: 'function',
                    function: {
                      name: 'submit_receipt',
                      arguments: JSON.stringify({ retried: true })
                    }
                  }
                ]
              }
            }
          ],
          usage: { prompt_tokens: 50, completion_tokens: 25 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const reservations = [];
    const reports = [];

    const transportPort = createTransportLifecyclePort({
      reserve: async (ctx) => {
        reservations.push({ ...ctx });
        return { ok: true };
      },
      report: async (ctx) => {
        reports.push({ ...ctx });
      }
    });

    const provider = new BaseOpenAICompatibleProvider({
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      apiKey: 'gsk_test_secret_12345',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      modelsEndpoint: 'https://api.groq.com/openai/v1/models',
      fetchImpl: mockFetch,
      allowLiveCalls: true,
      retryDelayMs: 15,
      maxRetries: 3,
      snapshot: VALID_SNAPSHOT,
      transportPort
    });

    const result = await provider.next({
      messages: [{ role: 'user', content: 'test retry counts' }],
      tools: ['submit_receipt']
    });

    assert.equal(physicalFetches, 3, 'Must have physically dispatched exactly 3 fetches');
    assert.equal(result.attempts, 3, 'Attempts must report 3');
    assert.equal(result.retries, 2, 'Retries must report 2');

    assert.equal(reservations.length, 3, 'Must have reserved before each of the 3 physical dispatches');
    assert.equal(reservations[0].attempt, 1);
    assert.equal(reservations[1].attempt, 2);
    assert.equal(reservations[2].attempt, 3);

    assert.equal(reports.length, 3, 'Must have reported each of the 3 physical dispatches');
    assert.equal(reports[0].ok, false);
    assert.equal(reports[0].unknownUsage, true);
    assert.equal(reports[1].ok, false);
    assert.equal(reports[1].unknownUsage, true);
    assert.equal(reports[2].ok, true);
    assert.equal(reports[2].status, 200);
    assert.deepEqual(reports[2].usage, { inputTokens: 50, outputTokens: 25 });
  });

  // Test 6: reservationdenial0fetch
  it('reservationdenial0fetch: Reservation denial before dispatch results in 0 physical fetches', async () => {
    let physicalFetches = 0;
    const mockFetch = async () => {
      physicalFetches++;
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    };

    const reservations = [];
    const reports = [];

    const transportPort = createTransportLifecyclePort({
      reserve: async (ctx) => {
        reservations.push(ctx);
        return { ok: false, reason: 'Campaign budget depleted: limit exceeded' };
      },
      report: async (ctx) => {
        reports.push(ctx);
      }
    });

    const provider = new BaseOpenAICompatibleProvider({
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      apiKey: 'gsk_test_secret_12345',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      modelsEndpoint: 'https://api.groq.com/openai/v1/models',
      fetchImpl: mockFetch,
      allowLiveCalls: true,
      snapshot: VALID_SNAPSHOT,
      transportPort
    });

    await assert.rejects(
      async () => {
        await provider.next({
          messages: [{ role: 'user', content: 'test request' }],
          tools: ['submit_receipt']
        });
      },
      (err) => {
        assert(err instanceof ProviderError, 'Should throw ProviderError on reservation denial');
        assert.equal(err.reservationDenied, true, 'Error must indicate reservationDenied: true');
        assert.equal(err.attempts, 0, 'Must record 0 attempts when denied before dispatch');
        assert.equal(err.retries, 0, 'Must record 0 retries');
        assert(err.message.includes('Campaign budget depleted'), 'Error must contain denial reason');
        return true;
      }
    );

    assert.equal(physicalFetches, 0, 'Physical fetch count must be exactly 0 on reservation denial');
    assert.equal(reservations.length, 1, 'Exactly one reservation must have been attempted');
    assert.equal(reservations[0].attempt, 1, 'Reservation must be for attempt 1');
    assert.equal(reports.length, 0, 'No post-dispatch report should occur if fetch never ran');
  });

  // Test 7: abortbackoff noextrareserve
  it('abortbackoff noextrareserve: Abort during retry backoff triggers zero extra reservations', async () => {
    let physicalFetches = 0;
    const ac = new AbortController();

    const mockFetch = async () => {
      physicalFetches++;
      const connErr = new TypeError('fetch failed');
      connErr.cause = { code: 'ECONNRESET' };
      // Schedule abort to fire during retry backoff
      setTimeout(() => {
        ac.abort();
      }, 10);
      throw connErr;
    };

    const reservations = [];
    const reports = [];

    const transportPort = createTransportLifecyclePort({
      reserve: async (ctx) => {
        reservations.push({ ...ctx });
        return { ok: true };
      },
      report: async (ctx) => {
        reports.push({ ...ctx });
      }
    });

    const provider = new BaseOpenAICompatibleProvider({
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      apiKey: 'gsk_test_secret_12345',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      modelsEndpoint: 'https://api.groq.com/openai/v1/models',
      fetchImpl: mockFetch,
      allowLiveCalls: true,
      retryDelayMs: 60,
      maxRetries: 3,
      snapshot: VALID_SNAPSHOT,
      transportPort
    });

    await assert.rejects(
      async () => {
        await provider.next({
          messages: [{ role: 'user', content: 'test abort' }],
          tools: ['submit_receipt'],
          signal: ac.signal
        });
      },
      (err) => {
        assert.equal(err.name, 'AbortError');
        assert.equal(err.attempts, 1, 'Must report attempts: 1 when aborted during backoff');
        assert.equal(err.retries, 0, 'Must report retries: 0 when attempt 2 was never dispatched');
        return true;
      }
    );

    assert.equal(physicalFetches, 1, 'Only attempt 1 was ever physically dispatched');
    assert.equal(reservations.length, 1, 'Must have triggered zero extra reservations beyond attempt 1');
    assert.equal(reservations[0].attempt, 1, 'Reservation must be attempt 1');
    assert.equal(reports.length, 1, 'Must report only attempt 1 failure');
  });

  // Test 8: terminal403stop no nextattempt
  it('terminal403stop no nextattempt: Terminal HTTP 403 stops execution immediately with zero subsequent attempt reservations', async () => {
    let physicalFetches = 0;
    const mockFetch = async () => {
      physicalFetches++;
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const reservations = [];
    const reports = [];

    const transportPort = createTransportLifecyclePort({
      reserve: async (ctx) => {
        reservations.push({ ...ctx });
        return { ok: true };
      },
      report: async (ctx) => {
        reports.push({ ...ctx });
      }
    });

    const provider = new BaseOpenAICompatibleProvider({
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      apiKey: 'gsk_test_secret_12345',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      modelsEndpoint: 'https://api.groq.com/openai/v1/models',
      fetchImpl: mockFetch,
      allowLiveCalls: true,
      retryDelayMs: 20,
      maxRetries: 3,
      snapshot: VALID_SNAPSHOT,
      transportPort
    });

    await assert.rejects(
      async () => {
        await provider.next({
          messages: [{ role: 'user', content: 'test 403' }],
          tools: ['submit_receipt']
        });
      },
      (err) => {
        assert(err instanceof ProviderError);
        assert.equal(err.status, 403);
        assert.equal(err.attempts, 1);
        assert.equal(err.retries, 0);
        return true;
      }
    );

    assert.equal(physicalFetches, 1, 'Must have dispatched exactly 1 physical fetch');
    assert.equal(reservations.length, 1, 'Zero subsequent reservations after terminal 403');
    assert.equal(reservations[0].attempt, 1);
    assert.equal(reports.length, 1, 'Must report terminal 403 failure');
    assert.equal(reports[0].ok, false);
    assert.equal(reports[0].status, 403);
    assert.equal(reports[0].unknownUsage, true);
  });

  // Test 9: hangingbody boundedremainingdeadline
  it('hangingbody boundedremainingdeadline: Hanging response body read is strictly bounded by the remaining request deadline', async () => {
    let physicalFetches = 0;
    const mockFetch = async () => {
      physicalFetches++;
      // Headers arrive promptly (status 200), but response body stream never resolves
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => new Promise(() => {}), // Hanging JSON read
        body: {
          cancel: () => {}
        }
      };
    };

    const reservations = [];
    const reports = [];

    const transportPort = createTransportLifecyclePort({
      reserve: async (ctx) => {
        reservations.push({ ...ctx });
        return { ok: true };
      },
      report: async (ctx) => {
        reports.push({ ...ctx });
      }
    });

    const provider = new BaseOpenAICompatibleProvider({
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      apiKey: 'gsk_test_secret_12345',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      modelsEndpoint: 'https://api.groq.com/openai/v1/models',
      fetchImpl: mockFetch,
      allowLiveCalls: true,
      maxRetries: 1,
      snapshot: VALID_SNAPSHOT,
      transportPort
    });

    const start = Date.now();
    await assert.rejects(
      async () => {
        // Enforce tight 60ms deadline
        await provider.next({
          messages: [{ role: 'user', content: 'test hanging body' }],
          tools: ['submit_receipt'],
          timeoutMs: 60
        });
      },
      (err) => {
        assert(err instanceof ProviderTransportError, `Expected ProviderTransportError, got ${err.name}`);
        assert(
          err.networkCodes?.includes('ETIMEDOUT') || err.message.includes('timed out'),
          `Error must indicate timeout, got: ${err.message}`
        );
        assert.equal(err.attempts, 1);
        assert.equal(err.remoteUsageUncertain, true);
        return true;
      }
    );

    const elapsed = Date.now() - start;
    assert(elapsed < 2000, `Hanging body read must be bounded by remaining deadline, took ${elapsed}ms`);
    assert.equal(physicalFetches, 1, 'Must have made 1 fetch');
    assert.equal(reservations.length, 1);
    assert.equal(reports.length, 1, 'Must have reported timeout failure to transportPort');
    assert.equal(reports[0].ok, false);
    assert.equal(reports[0].status, 200);
    assert.equal(reports[0].unknownUsage, true);
  });

  // Test 10: wrapFetchWithTransportLifecycle interoperability
  it('wrapFetchWithTransportLifecycle: Transparent fetch-level reservation, reporting, abort and malformed checks', async () => {
    let rawFetchCalls = 0;
    const rawFetch = async (url, init) => {
      rawFetchCalls++;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const reservations = [];
    const reports = [];
    const port = createTransportLifecyclePort({
      reserve: async (ctx) => {
        reservations.push(ctx);
        return { ok: true };
      },
      report: async (ctx) => {
        reports.push(ctx);
      }
    });

    const wrappedFetch = wrapFetchWithTransportLifecycle(rawFetch, port, { provider: 'openrouter', model: 'free-model' });

    const resp = await wrappedFetch('https://api.openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: '{}'
    });

    assert.equal(resp.status, 200);
    assert.equal(rawFetchCalls, 1);
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].provider, 'openrouter');
    assert.equal(reports.length, 1);
    assert.equal(reports[0].ok, true);
    assert.equal(reports[0].status, 200);

    // Test bypass when lifecycleHandled: true
    const resp2 = await wrappedFetch('https://api.openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: '{}',
      lifecycleHandled: true
    });

    assert.equal(resp2.status, 200);
    assert.equal(rawFetchCalls, 2);
    assert.equal(reservations.length, 1, 'Bypassed reservation when lifecycleHandled: true');
    assert.equal(reports.length, 1, 'Bypassed reporting when lifecycleHandled: true');

    // Test malformed reservation rejection in wrapper
    const malformedPort = createTransportLifecyclePort({
      reserve: async () => ({ ok: 'truthy' })
    });
    const malformedWrapped = wrapFetchWithTransportLifecycle(rawFetch, malformedPort);
    await assert.rejects(
      async () => {
        await malformedWrapped('https://api.openrouter.ai/api/v1/chat/completions', {});
      },
      (err) => {
        assert(err.message.includes('literal ok: true required'));
        return true;
      }
    );
    assert.equal(rawFetchCalls, 2, 'No fetch on malformed reservation');
  });

  // Test 11: ConfiguredModelProvider offline fake provider integration with transportPort
  it('ConfiguredModelProvider fake provider invokes transportPort reserve and report with literal ok:true', async () => {
    const reservations = [];
    const reports = [];
    const port = createTransportLifecyclePort({
      reserve: async (ctx) => {
        reservations.push(ctx);
        return { ok: true };
      },
      report: async (ctx) => {
        reports.push(ctx);
      }
    });

    const fakeConfig = {
      provider: 'fake',
      model: 'fake-model',
      providerApproved: true,
      liveAllowed: false,
      getApiKey: () => undefined
    };

    const provider = createConfiguredProvider({
      config: fakeConfig,
      allowLiveCalls: false,
      transportPort: port
    });

    const result = await provider.next({
      messages: [{ role: 'user', content: 'hello fake' }],
      tools: ['submit_receipt']
    });

    assert.equal(result.attempts, 1);
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].provider, 'fake');
    assert.equal(reports.length, 1);
    assert.equal(reports[0].ok, true);
    assert.equal(reports[0].status, 200);

    // Test fake provider fails closed on malformed ok
    const badPort = createTransportLifecyclePort({
      reserve: async () => ({ ok: 'yes' })
    });
    const badProvider = createConfiguredProvider({
      config: fakeConfig,
      allowLiveCalls: false,
      transportPort: badPort
    });
    await assert.rejects(
      async () => {
        await badProvider.next({
          messages: [{ role: 'user', content: 'test' }],
          tools: ['submit_receipt']
        });
      },
      (err) => {
        assert(err instanceof ProviderError);
        assert.equal(err.reservationDenied, true);
        return true;
      }
    );
  });
});
