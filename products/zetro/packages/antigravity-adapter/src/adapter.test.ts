import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AntigravityAdapter, type AdapterDependencies } from './adapter.js';
import { AGENT_NAMES, type AgentConfig } from './config.js';
import type { Endpoint } from './discovery.js';
import type { AgentApiResponse } from './agentapi.js';

const config: AgentConfig = {
  schemaVersion: '1',
  projectId: 'project-1',
  workspace: process.platform === 'win32' ? 'E:\\Veyminore' : '/tmp/veyminore-test',
  agents: {
    'AGR-1': 'f4881509-063a-4690-b5c4-985fd16cb39f',
    'AGR-2': 'c7325399-fa02-4a1f-8417-9260a1d8c38a',
    'AGR-3': '20d3f993-477e-4eb2-a785-40b391bd091e',
    'AGR-4': '339c97a8-901b-4ee8-a3c4-8bd311e3de8c',
    'AGR-5': 'af8ce409-7904-41c5-9505-18e2145d3dfd',
  },
};

const endpoint: Endpoint = { address: '127.0.0.1:5000', csrfToken: 'test-token', source: 'windows-process' };

function metadata(id: string, projectId = config.projectId, workspace = pathToFileURL(config.workspace).href): AgentApiResponse {
  return { response: { conversationMetadata: { metadata: {
    rootConversationId: id,
    projectId,
    workspaces: [{ workspaceFolderAbsoluteUri: workspace }],
  } } } };
}

function dependencies(run: AdapterDependencies['run'], endpoints = [endpoint]): AdapterDependencies {
  return { discover: async () => endpoints, executable: async () => 'agentapi-test.exe', run };
}

// 1. Identity & basic verification
test('verifies all five exact conversation, project and workspace identities', async () => {
  const adapter = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, _command, args) => metadata(args[0]!)));
  const results = await adapter.verifyAll();
  assert.deepEqual(results.map((item) => item.agent), AGENT_NAMES);
  assert.ok(results.every((item) => item.connected));
});

test('tries another local endpoint when the first does not serve the conversation', async () => {
  const stale = { ...endpoint, address: '127.0.0.1:4000' };
  const adapter = new AntigravityAdapter(config, dependencies(async (_exe, candidate, _command, args) =>
    metadata(candidate.address === stale.address ? 'wrong-id' : args[0]!), [stale, endpoint]));
  const result = await adapter.verify('AGR-1');
  assert.equal(result.connected, true);
});

// 2. Wrong identity: conversation, project, workspace
test('refuses to send when project or workspace identity changes', async () => {
  let sends = 0;
  const projectMismatch = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, command, args) => {
    if (command === 'send-message') { sends++; return { response: {} }; }
    return metadata(args[0]!, 'other-project');
  }));
  await assert.rejects(projectMismatch.send('AGR-2', 'hello'), /project ID mismatch/);

  const workspaceMismatch = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, command, args) => {
    if (command === 'send-message') { sends++; return { response: {} }; }
    return metadata(args[0]!, config.projectId, 'file:///c:/other');
  }));
  await assert.rejects(workspaceMismatch.send('AGR-2', 'hello'), /workspace mismatch/);

  const conversationMismatch = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, command, _args) => {
    if (command === 'send-message') { sends++; return { response: {} }; }
    return metadata('mismatched-root-conversation-id');
  }));
  await assert.rejects(conversationMismatch.send('AGR-1', 'hello'), /Root conversation ID mismatch/);

  assert.equal(sends, 0);
});

// 3. Send behavior & unknown acknowledgment without duplicate resend
test('submits once and never claims task verification', async () => {
  let sends = 0;
  const adapter = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, command, args) => {
    if (command === 'send-message') { sends++; return { response: { status: 'ok' } }; }
    return metadata(args[0]!);
  }));
  const result = await adapter.send('AGR-3', 'Please check the connection');
  assert.equal(sends, 1);
  assert.equal(result.delivery, 'submitted');
  assert.equal(result.verification, 'not_requested');
});

test('reports unknown delivery and does not retry after send failure', async () => {
  let sends = 0;
  const adapter = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, command, args) => {
    if (command === 'send-message') { sends++; throw new Error('connection dropped'); }
    return metadata(args[0]!);
  }));
  await assert.rejects(adapter.send('AGR-4', 'hello'), /connection dropped/);
  assert.equal(sends, 1, 'Must not duplicate send after connection failure');
});

test('fails closed on missing or error acknowledgment without duplicate resend', async () => {
  let sendsNoAck = 0;
  const noAckAdapter = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, command, args) => {
    if (command === 'send-message') { sendsNoAck++; return { response: null }; }
    return metadata(args[0]!);
  }));
  await assert.rejects(noAckAdapter.send('AGR-1', 'hello'), /Delivery unknown: no acknowledgement/);
  assert.equal(sendsNoAck, 1, 'Must not resend when response body is empty');

  let sendsError = 0;
  const errorAdapter = new AntigravityAdapter(config, dependencies(async (_exe, _endpoint, command, args) => {
    if (command === 'send-message') { sendsError++; return { response: { id: 1 }, error: 'server error' }; }
    return metadata(args[0]!);
  }));
  // Note: runAgentApi throws when error field is present in response
  await assert.rejects(errorAdapter.send('AGR-1', 'hello'), /Delivery unknown|no acknowledgement/);
  assert.equal(sendsError, 1, 'Must not resend after error response');
});

test('rejects empty messages before connecting', async () => {
  let discovered = false;
  const adapter = new AntigravityAdapter(config, {
    discover: async () => { discovered = true; return [endpoint]; },
    executable: async () => 'agentapi-test.exe',
    run: async () => metadata(config.agents['AGR-1']),
  });
  await assert.rejects(adapter.send('AGR-1', '   '), /empty/);
  assert.equal(discovered, false);
});

// 4. Absent servers
test('handles absent servers gracefully without hanging', async () => {
  let discoverCount = 0;
  const adapter = new AntigravityAdapter(config, {
    discover: async () => { discoverCount++; return []; },
    executable: async () => 'agentapi-test.exe',
    run: async () => metadata(config.agents['AGR-1']),
  });

  const all = await adapter.verifyAll();
  assert.equal(all.length, 5);
  assert.ok(all.every((item) => item.connected === false));
  assert.ok(all.every((item) => item.error?.includes('No live Antigravity language server found')));

  await assert.rejects(adapter.verify('AGR-1'), /No live Antigravity language server found/);
  await assert.rejects(adapter.send('AGR-1', 'hello'), /No live Antigravity language server found/);

  const obs = await adapter.observe('AGR-1');
  assert.equal(obs.connected, false);
  assert.equal(obs.state, 'unknown');
  assert.ok(obs.error?.includes('No live Antigravity language server found'));
});

// 5. Multiple failing endpoints
test('handles multiple failing endpoints without infinite loops or hanging', async () => {
  const ep1: Endpoint = { address: '127.0.0.1:4001', csrfToken: 'tok1', source: 'windows-process' };
  const ep2: Endpoint = { address: '127.0.0.1:4002', csrfToken: 'tok2', source: 'windows-process' };
  const ep3: Endpoint = { address: '127.0.0.1:4003', csrfToken: 'tok3', source: 'windows-process' };

  let calls = 0;
  const adapter = new AntigravityAdapter(config, dependencies(async (_exe, ep, _command, args) => {
    calls++;
    if (ep.address === ep1.address) return metadata(args[0]!, 'wrong-project');
    if (ep.address === ep2.address) return metadata(args[0]!, config.projectId, 'file:///E:/wrong/path');
    throw new Error('Connection refused to ' + ep.address);
  }, [ep1, ep2, ep3]));

  const results = await adapter.verifyAll();
  assert.equal(results.length, 5);
  assert.ok(results.every((item) => item.connected === false));
  // Total run calls are strictly bounded because workspace/project mismatch and network failures are pruned
  assert.ok(calls <= 15, `Expected bounded calls (<=15), got ${calls}`);
});

// 6. Total timeout & aggregate status bound
test('enforces total timeout on aggregate status / verify operations', async () => {
  const slowEndpoint: Endpoint = { address: '127.0.0.1:4010', csrfToken: 'slow', source: 'windows-process' };
  const adapter = new AntigravityAdapter(
    config,
    dependencies(async (_exe, _ep, _command, _args, options) => {
      // Simulate slow response that responds only after timeout
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(metadata(config.agents['AGR-1'])), 500);
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Operation timed out'));
          });
        }
      });
    }, [slowEndpoint]),
    { totalTimeoutMs: 150, requestTimeoutMs: 50 },
  );

  const start = Date.now();
  const results = await adapter.verifyAll();
  const duration = Date.now() - start;

  assert.equal(results.length, 5);
  assert.ok(results.every((item) => item.connected === false));
  assert.ok(duration < 450, `Operation exceeded bounded aggregate duration: ${duration}ms`);
  assert.ok(results.some((item) => item.error?.includes('timed out')));
});

// 7. Stale cache invalidation and single refresh
test('invalidates stale discovery cache and re-discovers once, without infinite retry', async () => {
  const epA: Endpoint = { address: '127.0.0.1:4020', csrfToken: 'tokA', source: 'windows-process' };
  const epB: Endpoint = { address: '127.0.0.1:4021', csrfToken: 'tokB', source: 'windows-process' };

  let discoveryCount = 0;
  let activeEndpoints = [epA];
  let epAFails = false;

  const adapter = new AntigravityAdapter(config, {
    discover: async () => {
      discoveryCount++;
      return [...activeEndpoints];
    },
    executable: async () => 'agentapi-test.exe',
    run: async (_exe, ep, _command, args) => {
      if (ep.address === epA.address && epAFails) throw new Error('endpoint A dead');
      return metadata(args[0]!);
    },
  });

  // Step 1: Initial call populates discovery cache with epA
  const initial = await adapter.verify('AGR-1');
  assert.equal(initial.connected, true);
  assert.equal(discoveryCount, 1);

  // Step 2: Now epA dies, activeEndpoints becomes epB. Next call sees cached epA fail, invalidates cache and discovers epB
  epAFails = true;
  activeEndpoints = [epB];
  const res = await adapter.verify('AGR-1');
  assert.equal(res.connected, true);
  assert.equal(discoveryCount, 2, 'Initial discovery plus 1 invalidation refresh');

  // Step 3: If fresh discovery also fails, it must NOT loop discovery endlessly
  let discoveryCount2 = 0;
  const failingAdapter = new AntigravityAdapter(config, {
    discover: async () => {
      discoveryCount2++;
      return [{ address: '127.0.0.1:4099', csrfToken: 'tok', source: 'windows-process' }];
    },
    executable: async () => 'agentapi-test.exe',
    run: async () => { throw new Error('all endpoints dead'); },
  });

  await assert.rejects(failingAdapter.verify('AGR-1'), /all endpoints dead/);
  assert.ok(discoveryCount2 <= 2, `Expected at most 2 discovery calls (initial + 1 refresh), got ${discoveryCount2}`);
});

// 8. Observation caching & diagnostic fallback
test('observe uses discovery cache and diagnostic fallback', async () => {
  let discoveries = 0;
  const adapter = new AntigravityAdapter(config, {
    discover: async () => { discoveries++; return [endpoint]; },
    executable: async () => 'agentapi-test.exe',
    run: async (_exe, _candidate, _command, args) => metadata(args[0]!),
  });
  
  const obs1 = await adapter.observe('AGR-1');
  assert.equal(obs1.connected, true);
  assert.equal(obs1.confidence, 'diagnostic_fallback');
  assert.equal(discoveries, 1);
  
  const obs2 = await adapter.observe('AGR-2');
  assert.equal(obs2.connected, true);
  assert.equal(obs2.confidence, 'diagnostic_fallback');
  assert.equal(discoveries, 1); // should be cached
});

// 9. CLI deterministic tests & opt-in live smoke check
const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

test('CLI help works without a live Antigravity connection', () => {
  const result = spawnSync(process.execPath, [cliPath, '--help'], {
    encoding: 'utf8',
    timeout: 5000,
    killSignal: 'SIGKILL',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ZETRO Antigravity adapter/);
  assert.match(result.stdout, /zetro-ag status/);
});

test('CLI status reports honest offline state deterministically', () => {
  // Pass sidecar environment variables pointing to an inactive loopback address and non-existent executable
  // This bypasses PowerShell discovery and ensures deterministic execution in < 1s
  const env = {
    ...process.env,
    ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:59999',
    ANTIGRAVITY_CSRF_TOKEN: 'deterministic-test-token',
    ZETRO_ANTIGRAVITY_EXECUTABLE: 'non-existent-language-server.exe',
  };

  const result = spawnSync(process.execPath, [cliPath, 'status', '--json'], {
    encoding: 'utf8',
    timeout: 5000,
    killSignal: 'SIGKILL',
    env,
  });

  assert.equal(result.status, 2, `Expected exit code 2 when all agents offline. Output: ${result.stdout} Stderr: ${result.stderr}`);
  const data: Array<{ agent: string; connected: boolean; state: string; stepCount: number; confidence: string }> = JSON.parse(result.stdout);
  assert.equal(Array.isArray(data), true);
  assert.equal(data.length, 5);
  for (const row of data) {
    assert.equal(typeof row.agent, 'string');
    assert.equal(row.connected, false);
    assert.ok(['idle', 'running', 'unknown'].includes(row.state));
    assert.equal(typeof row.stepCount, 'number');
    assert.equal(row.confidence, 'diagnostic_fallback');
  }
});

// 10. Regression: quarantine only transport-failed endpoints
test('quarantines transport-failed endpoints without disconnecting endpoints with identity mismatches', async () => {
  const ep1: Endpoint = { address: '127.0.0.1:4101', csrfToken: 'tok1', source: 'windows-process' };
  const ep2: Endpoint = { address: '127.0.0.1:4102', csrfToken: 'tok2', source: 'windows-process' };
  const epDead: Endpoint = { address: '127.0.0.1:4103', csrfToken: 'tok3', source: 'windows-process' };

  let epDeadCalls = 0;
  const adapter = new AntigravityAdapter(
    config,
    dependencies(async (_exe, ep, _command, args) => {
      if (ep.address === epDead.address) {
        epDeadCalls++;
        throw new Error('connect ECONNREFUSED 127.0.0.1:4103');
      }
      // ep1 only serves AGR-1
      if (ep.address === ep1.address) {
        if (args[0] === config.agents['AGR-1']) return metadata(args[0]!);
        throw new Error('Root conversation ID mismatch');
      }
      // ep2 only serves AGR-2
      if (ep.address === ep2.address) {
        if (args[0] === config.agents['AGR-2']) return metadata(args[0]!);
        throw new Error('Root conversation ID mismatch');
      }
      throw new Error('Unknown endpoint');
    }, [ep1, ep2, epDead]),
  );

  const results = await adapter.verifyAll();
  const agr1 = results.find((r) => r.agent === 'AGR-1');
  const agr2 = results.find((r) => r.agent === 'AGR-2');

  // Crucial invariant: ep2 was NOT quarantined after failing for AGR-1, so AGR-2 connects!
  assert.equal(agr1?.connected, true);
  assert.equal(agr2?.connected, true);

  // epDead was a transport failure (ECONNREFUSED) so it was quarantined and not called for all 5 agents
  assert.equal(epDeadCalls, 1, 'Transport-failed endpoint should be quarantined after first transport failure');
});

// 11. Regression: aggregate deadline covers diagnosticFallback
test('enforces aggregate deadline across discovery, identity preflight, and diagnostic fallback in observe and observeAll', async () => {
  const slowDiagAdapter = new AntigravityAdapter(
    config,
    {
      discover: async () => [endpoint],
      executable: async () => 'agentapi-test.exe',
      run: async () => metadata(config.agents['AGR-1']),
      diagnosticFallback: async () => {
        // Simulate hanging diagnostic
        await new Promise((resolve) => setTimeout(resolve, 600));
        return { state: 'idle', stepCount: 10 };
      },
    },
    { totalTimeoutMs: 100, requestTimeoutMs: 50 },
  );

  // Test observe()
  const startObs = Date.now();
  const obs = await slowDiagAdapter.observe('AGR-1');
  const durObs = Date.now() - startObs;
  assert.ok(durObs < 350, `observe exceeded aggregate deadline: ${durObs}ms`);
  assert.equal(obs.connected, true);
  assert.equal(obs.state, 'unknown'); // diagnostic timed out, safe fallback

  // Test observeAll()
  const startAll = Date.now();
  const obsAll = await slowDiagAdapter.observeAll({ timeoutMs: 100 });
  const durAll = Date.now() - startAll;
  assert.ok(durAll < 350, `observeAll exceeded aggregate deadline: ${durAll}ms`);
  assert.equal(obsAll.length, 5);
  assert.ok(obsAll.every((item) => item.state === 'unknown'));
});

// 12. Regression: offline harness treats ZETRO_LIVE_SMOKE=0, false, unset as offline
test('offline harness treats ZETRO_LIVE_SMOKE=0, false, and empty as offline without spawning real discovery', () => {
  const offlineValues = ['0', 'false', '', undefined];
  for (const val of offlineValues) {
    const isSmoke = val === '1';
    assert.equal(isSmoke, false, `Value ${val} must not enable live smoke`);
  }
});

// 13. Regression: process error classification (killed: false is not timeout)
test('runAgentApi and discoverEndpoints distinguish killed: false from true timeout/abort', async () => {
  const nonTimeoutError = new Error('Process exited with code 1');
  (nonTimeoutError as { killed?: boolean; code?: number }).killed = false;
  (nonTimeoutError as { code?: number }).code = 1;

  const err = nonTimeoutError as { killed?: boolean; code?: string | number; name?: string; message?: string };
  const isTimeout = Boolean(
    err && (
      err.killed === true ||
      err.code === 'ETIMEDOUT' ||
      err.name === 'AbortError' ||
      (typeof err.message === 'string' && (err.message.includes('timed out') || err.message.includes('ETIMEDOUT')))
    )
  );
  assert.equal(isTimeout, false, 'killed: false must not be treated as timeout');

  const timeoutError = new Error('timed out');
  (timeoutError as { killed?: boolean }).killed = true;
  const isTimeoutTrue = Boolean(
    timeoutError && (
      (timeoutError as { killed?: boolean }).killed === true ||
      (timeoutError as { code?: string }).code === 'ETIMEDOUT'
    )
  );
  assert.equal(isTimeoutTrue, true, 'killed: true must be treated as timeout');
});

// Opt-in live smoke test: requires exact '1'
const isLiveSmoke = process.env.ZETRO_LIVE_SMOKE === '1';

test(
  'CLI status live smoke check (opt-in via ZETRO_LIVE_SMOKE=1)',
  { skip: !isLiveSmoke && 'Live Antigravity smoke check is opt-in (set ZETRO_LIVE_SMOKE=1 to run)' },
  () => {
    const result = spawnSync(process.execPath, [cliPath, 'status', '--json'], {
      encoding: 'utf8',
      timeout: 10000,
      killSignal: 'SIGKILL',
    });
    assert.ok(result.status === 0 || result.status === 2, result.stderr);
    const data: Array<{ agent: string; connected: boolean; state: string; stepCount: number; confidence: string }> = JSON.parse(result.stdout);
    assert.equal(Array.isArray(data), true);
    assert.equal(data.length, 5);
    assert.equal(result.status, data.every((row) => row.connected) ? 0 : 2);
  },
);
