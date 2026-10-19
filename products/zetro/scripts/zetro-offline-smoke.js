#!/usr/bin/env node

/**
 * ZETRO Product-Level Offline Integration Smoke Entrypoint
 *
 * Validates cross-package orchestration invariants offline in isolated synthetic environments:
 * 1. Positive lifecycle: admit -> isolatedsnapshot -> oneworker -> independent exactcheck verification -> durable evidence -> reviewready, source unchanged
 * 2. Negative 1: disabledlive zero network (unapproved live inference / remote provider fails closed with 0 network calls)
 * 3. Negative 2: missinggrant deniedeffect (tool execution without active policy grant fails closed with no_matching_grant)
 * 4. Negative 3: stalehash predispatch (mismatched baseline hash rejected before provider dispatch; 0 provider calls, 0 artifacts)
 * 5. Negative 4: cancellation completedresponse barrier no lateeffect (cancellation blocks late provider response / tool effects; 0 artifacts)
 *
 * Owned by AGR-5 (M0 Lead / Release Qualification).
 */

const { mkdtemp, writeFile, readFile, rm, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert');

const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Dynamically import workspace ESM packages using portable file URLs.
 */
async function loadModules() {
  const orchPath = pathToFileURL(path.resolve(ROOT_DIR, 'packages/orchestration-core/src/index.js')).href;
  const rctPath = pathToFileURL(path.resolve(ROOT_DIR, 'packages/rct-runtime/src/index.js')).href;
  const policyPath = pathToFileURL(path.resolve(ROOT_DIR, 'packages/policy/src/index.js')).href;
  const provCfgPath = pathToFileURL(path.resolve(ROOT_DIR, 'packages/provider-config/src/index.js')).href;
  const modelProvPath = pathToFileURL(path.resolve(ROOT_DIR, 'packages/model-providers/src/index.js')).href;

  const [orch, rct, policy, provCfg, modelProv] = await Promise.all([
    import(orchPath),
    import(rctPath),
    import(policyPath),
    import(provCfgPath),
    import(modelProvPath)
  ]);

  return { orch, rct, policy, provCfg, modelProv };
}

/**
 * Scenario 1 (Positive Lifecycle):
 * admit -> isolatedsnapshot -> oneworker -> independent exactcheck verification -> durable evidence -> reviewready, source unchanged
 */
async function runPositiveScenario(modules) {
  const { TaskManager, SqliteTaskStore, States, RealRctAdapter, createIndependentRctVerifier } = modules.orch;
  const { sha256 } = modules.rct;
  const { PolicyService, RctPolicyPort } = modules.policy;
  const { loadProviderConfig } = modules.provCfg;
  const { createConfiguredProvider } = modules.modelProv;

  const wsDir = await mkdtemp(path.join(tmpdir(), 'zetro-smoke-pos-ws-'));
  const dbDir = await mkdtemp(path.join(tmpdir(), 'zetro-smoke-pos-db-'));

  try {
    await mkdir(path.join(wsDir, 'src'), { recursive: true });
    const initialContent = 'console.log("initial-source");\n';
    await writeFile(path.join(wsDir, 'src/app.js'), initialContent, 'utf8');
    const initialHash = sha256(Buffer.from(initialContent));
    const targetContent = 'console.log("patched-by-worker");\n';

    // 1. Configured offline provider via @zetro/provider-config + @zetro/model-providers
    const positiveConfig = loadProviderConfig({ env: { ZETRO_PROVIDER: 'fake' } });
    assert.strictEqual(positiveConfig.provider, 'fake', 'Must configure fake offline provider');
    assert.strictEqual(positiveConfig.status.mode, 'offline-safe', 'Must be in offline-safe mode');
    assert.strictEqual(positiveConfig.status.ready, true, 'Configured provider must be ready');

    const configuredProvider = createConfiguredProvider({
      config: positiveConfig,
      steps: [
        {
          name: 'propose_patch',
          args: { path: 'src/app.js', expectedSha256: initialHash, content: targetContent }
        },
        {
          name: 'submit_receipt',
          args: { summary: 'Applied target patch for smoke verification' }
        }
      ]
    });

    let measuredProviderCalls = 0;
    const origNext = configuredProvider.next.bind(configuredProvider);
    configuredProvider.next = async (params) => {
      measuredProviderCalls++;
      return await origNext(params);
    };

    // 2. PolicyService grants & RctPolicyPort authority integration
    const policyService = new PolicyService({ clock: () => Date.now() });
    const rctPort = new RctPolicyPort(policyService);

    // Track observed policy evaluations to prove authorized effects are observed by policy
    const observedPolicyEffects = [];
    const origEvaluate = rctPort.evaluateSync.bind(rctPort);
    rctPort.evaluateSync = (req) => {
      const decision = origEvaluate(req);
      observedPolicyEffects.push({
        tool: req.tool,
        effect: req.effect,
        path: req.args?.path,
        allowed: decision.allowed,
        reason: decision.reason,
        grantId: decision.grantId
      });
      return decision;
    };

    // Issue explicit grants for the task assignment
    const grants = rctPort.createAssignmentGrants({
      id: 'task-smoke-pos-1',
      agent: 'RCT-1',
      sessionId: 'task-smoke-pos-1',
      scope: {
        readPaths: ['src/app.js'],
        writePaths: ['src/app.js']
      },
      checks: [{ type: 'equals', path: 'src/app.js', text: targetContent }]
    });
    assert.ok(grants.length > 0, 'Grants must be issued by PolicyService');

    // 3. RealRctAdapter wired with configured provider and PolicyService authority
    const store = new SqliteTaskStore(path.join(dbDir, 'tasks.db'));
    const adapter = new RealRctAdapter({
      provider: configuredProvider,
      sourceRoot: wsDir,
      authority: rctPort,
      policyPort: rctPort
    });
    const verifier = createIndependentRctVerifier();
    const manager = new TaskManager(store, adapter, { verifier });
    await manager.init();

    const envelope = {
      id: 'task-smoke-pos-1',
      agent: 'worker-smoke-pos',
      objective: 'Verify complete positive lifecycle flow with policy authority',
      workspaceRoot: wsDir,
      allowedPaths: ['src/app.js'],
      contextRefs: [],
      acceptance: 'Application prints patched-by-worker',
      verification: 'src/app.js',
      declaredChecks: ['src/app.js'],
      sourceHash: initialHash,
      sourceHashes: { 'src/app.js': initialHash },
      assignmentDigest: 'digest-smoke-pos-1',
      checks: [{ type: 'equals', path: 'src/app.js', text: targetContent }],
      deadlineMs: 10000,
      budget: { maxContextChars: 10000, maxReplyChars: 2000, maxTurns: 4, maxWallMs: 10000 }
    };

    const result = await manager.run(envelope);

    assert.strictEqual(result.state, States.COMPLETED, `Task state must be COMPLETED, got ${result.state}`);
    assert.strictEqual(result.latestAttempt?.state, States.COMPLETED, 'Latest attempt state must be COMPLETED');

    // Verify observed effects by policy: prove actual authorized effects observed
    assert.ok(observedPolicyEffects.length >= 2, 'Policy must have observed tool invocations');
    const writeEffect = observedPolicyEffects.find(e => e.tool === 'propose_patch');
    assert.ok(writeEffect, 'propose_patch write effect must be evaluated by policy');
    assert.strictEqual(writeEffect.allowed, true, 'Write effect must be authorized');
    assert.strictEqual(writeEffect.reason, 'authorized', 'Write effect reason must be authorized');
    assert.ok(writeEffect.grantId, 'Write effect must have matched an active PolicyService grant');

    const submitEffect = observedPolicyEffects.find(e => e.tool === 'submit_receipt');
    assert.ok(submitEffect, 'submit_receipt effect must be evaluated by policy');
    assert.strictEqual(submitEffect.allowed, true, 'Submit effect must be authorized');

    // Verify grant exists in PolicyService
    const activeGrant = policyService.getGrant(writeEffect.grantId);
    assert.ok(activeGrant, 'Matched write grant must exist in PolicyService');

    // Verify durable evidence in store
    const evidence = manager.evidence('task-smoke-pos-1');
    const verifierArtifact = evidence.artifacts.find(a => a.artifactType === 'verifier_evidence');
    assert.ok(verifierArtifact, 'Durable verifier_evidence artifact must be persisted');
    assert.strictEqual(verifierArtifact.metadata?.verified, true, 'Verifier metadata must indicate verified: true');
    assert.ok(Array.isArray(verifierArtifact.metadata?.checks), 'Verifier checks must be an array');
    assert.ok(verifierArtifact.metadata.checks.length > 0, 'Verifier checks must not be empty');
    assert.ok(verifierArtifact.metadata.checks.every(c => c.passed === true), 'All independent checks must pass');
    assert.strictEqual(verifierArtifact.metadata?.verifier, 'independent-rct-verifier', 'Verifier name must be independent-rct-verifier');

    const evidenceArtifact = evidence.artifacts.find(a => a.artifactType === 'evidence');
    assert.ok(evidenceArtifact, 'Evidence artifact with worker summary must be persisted');
    assert.strictEqual(evidenceArtifact.metadata?.summary, 'Applied target patch for smoke verification');

    const patchArtifact = evidence.artifacts.find(a => a.artifactType === 'patch');
    assert.ok(patchArtifact, 'Durable patch artifact must be persisted');

    // Verify source isolation invariant: source root remained untouched
    const sourceAfter = await readFile(path.join(wsDir, 'src/app.js'), 'utf8');
    assert.strictEqual(sourceAfter, initialContent, 'Source root must remain bitwise identical (isolated snapshot)');
    assert.strictEqual(sha256(Buffer.from(sourceAfter)), initialHash, 'Source root hash must match initial hash');

    assert.strictEqual(measuredProviderCalls, 2, 'Provider must have been invoked for exactly 2 steps');

    manager.close();

    return {
      passed: true,
      details: {
        taskState: result.state,
        attemptState: result.latestAttempt?.state,
        turns: measuredProviderCalls,
        actualCalls: measuredProviderCalls,
        verified: verifierArtifact.metadata.verified,
        checksCount: verifierArtifact.metadata.checks.length,
        artifactsCount: evidence.artifacts.length,
        policyEffectsCount: observedPolicyEffects.length,
        writeGrantId: writeEffect.grantId,
        sourceUnchanged: true
      }
    };
  } finally {
    await rm(wsDir, { recursive: true, force: true }).catch(() => {});
    await rm(dbDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Scenario 2 (Negative 1: disabledlive zero network):
 * Remote provider without live approval fails closed before socket creation; 0 network calls.
 */
async function runDisabledLiveScenario(modules) {
  const { loadProviderConfig, getDoctorReport } = modules.provCfg;
  const { ConfiguredModelProvider, ProviderError } = modules.modelProv;

  let networkCalls = 0;
  const mockFetch = async () => {
    networkCalls++;
    throw new Error('NETWORK_ACCESS_VIOLATION: Zero network calls permitted during disabled-live smoke');
  };

  const config = loadProviderConfig({
    env: {
      ZETRO_PROVIDER: 'groq',
      GROQ_API_KEY: 'gsk_synthetic_offline_test_key_00000000000000000000',
      ZETRO_LIVE_INFERENCE_ENABLED: '0',
      ZETRO_ALLOW_REMOTE_SOURCE: '0'
    }
  });

  // Verify configuration gates fail closed
  assert.strictEqual(config.liveAllowed, false, 'liveAllowed must be false when ZETRO_LIVE_INFERENCE_ENABLED=0');

  // Verify doctor diagnostic reports fail
  const doctor = getDoctorReport(config);
  assert.strictEqual(doctor.ready, false, 'Doctor report must report ready: false');
  const liveDiag = doctor.diagnostics.find(d => d.name === 'Live Execution');
  assert.ok(liveDiag, 'Doctor must include Live Execution diagnostic');
  assert.strictEqual(liveDiag.status, 'FAIL', 'Live Execution diagnostic must be FAIL');

  // Verify ConfiguredModelProvider runtime gate blocks dispatch with 0 network calls
  const provider = new ConfiguredModelProvider({
    config,
    allowLiveCalls: false,
    fetchImpl: mockFetch
  });

  let threwExpected = false;
  try {
    await provider.next({
      messages: [{ role: 'user', content: 'offline smoke probe' }]
    });
  } catch (err) {
    if (err instanceof ProviderError && err.message.includes('Live inference disabled')) {
      threwExpected = true;
    } else {
      throw err;
    }
  }

  assert.strictEqual(threwExpected, true, 'Provider must throw ProviderError on disabled live inference');
  assert.strictEqual(networkCalls, 0, 'Zero network calls must be executed when live inference is disabled');

  return {
    passed: true,
    details: {
      liveAllowed: config.liveAllowed,
      doctorReady: doctor.ready,
      networkCalls: 0,
      blockedByGate: true
    }
  };
}

/**
 * Scenario 3 (Negative 2: missinggrant deniedeffect):
 * Tool execution without active matching policy grant fails closed with no_matching_grant.
 */
async function runMissingGrantScenario(modules) {
  const { PolicyService, RctPolicyPort } = modules.policy;
  const { ScopedWorkspace, createDefaultRegistry, sha256 } = modules.rct;

  const wsDir = await mkdtemp(path.join(tmpdir(), 'zetro-smoke-grant-ws-'));

  try {
    const initialContent = 'console.log("unmodified-grant-test");\n';
    await writeFile(path.join(wsDir, 'app.js'), initialContent, 'utf8');
    const initialHash = sha256(Buffer.from(initialContent));

    const policyService = new PolicyService({ clock: () => Date.now() });
    const rctPort = new RctPolicyPort(policyService);

    // 1. Direct evaluation against policy port returns denied with no_matching_grant
    const evalResult = await rctPort.evaluate({
      tool: 'propose_patch',
      effect: 'write',
      capability: 'file:write',
      args: { path: 'app.js', expectedSha256: initialHash, content: 'unauthorized-content\n' },
      assignment: { id: 'task-neg-grant', agent: 'worker-smoke-grant' }
    });

    assert.strictEqual(evalResult.allowed, false, 'Policy port must deny action without matching grant');
    assert.strictEqual(evalResult.reason, 'no_matching_grant', 'Denial reason must be no_matching_grant');

    // 2. Integration with ScopedWorkspace & ToolRegistry fails closed and denies disk effect
    const ws = new ScopedWorkspace(wsDir, ['app.js'], { writePaths: ['app.js'] });
    const registry = createDefaultRegistry({ authority: rctPort });

    let registryDenied = false;
    let denialMessage = '';
    try {
      await registry.execute(
        {
          name: 'propose_patch',
          args: { path: 'app.js', expectedSha256: initialHash, content: 'unauthorized-content\n' }
        },
        {
          workspace: ws,
          assignment: { id: 'task-neg-grant', agent: 'worker-smoke-grant', checks: [] }
        }
      );
    } catch (err) {
      registryDenied = true;
      denialMessage = err.message;
    }

    assert.strictEqual(registryDenied, true, 'Tool registry must throw error when authority denies');
    assert.strictEqual(denialMessage, 'no_matching_grant', 'Error message must reflect authority denial');

    // Verify denied effect: file on disk remained completely untouched
    const diskContent = await readFile(path.join(wsDir, 'app.js'), 'utf8');
    assert.strictEqual(diskContent, initialContent, 'Disk file must remain untouched after denied tool invocation');

    return {
      passed: true,
      details: {
        portAllowed: evalResult.allowed,
        reason: evalResult.reason,
        registryDenied: true,
        diskUntouched: true
      }
    };
  } finally {
    await rm(wsDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Scenario 4 (Negative 3: stalehash predispatch):
 * Mismatched / stale source baseline hash rejected before provider dispatch; 0 provider calls, 0 artifacts.
 */
async function runStaleHashScenario(modules) {
  const { TaskManager, SqliteTaskStore, States, RealRctAdapter } = modules.orch;

  const wsDir = await mkdtemp(path.join(tmpdir(), 'zetro-smoke-stale-ws-'));
  const dbDir = await mkdtemp(path.join(tmpdir(), 'zetro-smoke-stale-db-'));

  try {
    await mkdir(path.join(wsDir, 'src'), { recursive: true });
    const initialContent = 'console.log("disk-v1");\n';
    await writeFile(path.join(wsDir, 'src/app.js'), initialContent, 'utf8');

    let providerCalls = 0;
    const staleProvider = {
      name: 'stale-test-provider',
      async next() {
        providerCalls++;
        throw new Error('PROVIDER_CALL_VIOLATION: Provider must not be called when baseline hash is stale');
      }
    };

    const store = new SqliteTaskStore(path.join(dbDir, 'stale.db'));
    const adapter = new RealRctAdapter({ provider: staleProvider, sourceRoot: wsDir });
    const manager = new TaskManager(store, adapter);
    await manager.init();

    // Dispatched with mismatched hash
    const staleEnvelope = {
      id: 'task-smoke-stale-1',
      agent: 'worker-smoke-stale',
      objective: 'Verify stale hash pre-dispatch rejection',
      workspaceRoot: wsDir,
      allowedPaths: ['src/app.js'],
      contextRefs: [],
      acceptance: 'App prints patched',
      verification: 'src/app.js',
      declaredChecks: ['src/app.js'],
      sourceHash: '0000000000000000000000000000000000000000000000000000000000000000',
      sourceHashes: { 'src/app.js': '0000000000000000000000000000000000000000000000000000000000000000' },
      checks: [{ type: 'equals', path: 'src/app.js', text: 'patched\n' }],
      deadlineMs: 5000,
      budget: { maxContextChars: 10000, maxReplyChars: 2000, maxTurns: 2, maxWallMs: 5000 }
    };

    const staleResult = await manager.run(staleEnvelope);

    // Verify task failed closed
    assert.strictEqual(staleResult.state, States.FAILED, `Stale task state must be FAILED, got ${staleResult.state}`);
    assert.ok(staleResult.error.includes('Source baseline hash mismatch'), `Error must report hash mismatch, got ${staleResult.error}`);

    // Verify 0 provider calls were made
    assert.strictEqual(providerCalls, 0, 'Provider must not be called when baseline hash is stale');

    // Verify 0 artifacts persisted
    const evidence = manager.evidence('task-smoke-stale-1');
    assert.strictEqual(evidence.artifacts.length, 0, 'Zero artifacts must be recorded on pre-dispatch failure');

    // Verify source untouched
    const sourceContent = await readFile(path.join(wsDir, 'src/app.js'), 'utf8');
    assert.strictEqual(sourceContent, initialContent, 'Source file must remain untouched');

    manager.close();

    return {
      passed: true,
      details: {
        taskState: staleResult.state,
        providerCalls: 0,
        artifactsCount: evidence.artifacts.length,
        errorMessage: staleResult.error
      }
    };
  } finally {
    await rm(wsDir, { recursive: true, force: true }).catch(() => {});
    await rm(dbDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Scenario 5 (Negative 4: cancellation completedresponse barrier no lateeffect):
 * Task cancellation sets States.CANCELLED, abort signal barrier drops late provider response, 0 artifacts.
 */
async function runCancellationBarrierScenario(modules) {
  const { TaskManager, SqliteTaskStore, States, RealRctAdapter } = modules.orch;
  const { sha256 } = modules.rct;

  const wsDir = await mkdtemp(path.join(tmpdir(), 'zetro-smoke-cancel-ws-'));
  const dbDir = await mkdtemp(path.join(tmpdir(), 'zetro-smoke-cancel-db-'));

  try {
    await mkdir(path.join(wsDir, 'src'), { recursive: true });
    const initialContent = 'console.log("cancel-initial");\n';
    await writeFile(path.join(wsDir, 'src/app.js'), initialContent, 'utf8');
    const initialHash = sha256(Buffer.from(initialContent));

    // Explicit synchronization barriers eliminating sleep/timing race conditions
    let providerStartedResolve;
    const providerStarted = new Promise(r => { providerStartedResolve = r; });

    let releaseProviderResolve;
    const releaseProvider = new Promise(r => { releaseProviderResolve = r; });

    let providerCompletedResolve;
    const providerCompleted = new Promise(r => { providerCompletedResolve = r; });

    let providerCallCount = 0;
    let lateResponseResolved = false;

    const barrierSlowProvider = {
      name: 'barrier-slow-cancel-provider',
      async next({ signal }) {
        providerCallCount++;
        providerStartedResolve();

        // Hold execution until the test explicitly releases the provider after cancellation
        await releaseProvider;

        lateResponseResolved = true;
        const res = {
          toolCalls: [{
            name: 'propose_patch',
            args: { path: 'src/app.js', expectedSha256: initialHash, content: 'late-unauthorized-content\n' }
          }],
          usage: { inputTokens: 10, outputTokens: 10 }
        };
        providerCompletedResolve();
        return res;
      }
    };

    const store = new SqliteTaskStore(path.join(dbDir, 'cancel.db'));
    const adapter = new RealRctAdapter({ provider: barrierSlowProvider, sourceRoot: wsDir });
    const manager = new TaskManager(store, adapter);
    await manager.init();

    const cancelEnvelope = {
      id: 'task-smoke-cancel-1',
      agent: 'worker-smoke-cancel',
      objective: 'Verify cancellation barrier blocks late effects',
      workspaceRoot: wsDir,
      allowedPaths: ['src/app.js'],
      contextRefs: [],
      acceptance: 'App prints patched',
      verification: 'src/app.js',
      declaredChecks: ['src/app.js'],
      sourceHash: initialHash,
      sourceHashes: { 'src/app.js': initialHash },
      checks: [{ type: 'equals', path: 'src/app.js', text: 'patched\n' }],
      deadlineMs: 10000,
      budget: { maxContextChars: 10000, maxReplyChars: 2000, maxTurns: 2, maxWallMs: 10000 }
    };

    // 1. Dispatch task to runner
    const runPromise = manager.run(cancelEnvelope);

    // 2. Wait deterministically until provider is actively executing in-flight
    await providerStarted;
    assert.strictEqual(providerCallCount, 1, 'Provider must have been invoked and active in-flight');

    // 3. Request cancellation while provider is held in-flight
    const cancelRes = manager.cancel('task-smoke-cancel-1');
    assert.strictEqual(cancelRes.cancelled, true, 'Cancellation request must return cancelled: true');

    // 4. Release the provider so its late response callback completes
    releaseProviderResolve();
    await providerCompleted;
    assert.strictEqual(lateResponseResolved, true, 'Late provider response callback must have completed execution');

    // 5. Await task runner completion
    const finalResult = await runPromise;

    // 6. Assert all cancellation invariants while manager and store are STILL OPEN
    assert.strictEqual(finalResult.state, States.CANCELLED, `Final state must be CANCELLED, got ${finalResult.state}`);

    const persistedTask = store.getTask('task-smoke-cancel-1');
    assert.strictEqual(persistedTask.state, States.CANCELLED, 'Persisted store task state must be CANCELLED');

    const evidence = manager.evidence('task-smoke-cancel-1');
    assert.strictEqual(evidence.artifacts.length, 0, 'Zero artifacts must be persisted for cancelled task');

    // 7. Verify source file on disk is completely untouched
    const sourceContent = await readFile(path.join(wsDir, 'src/app.js'), 'utf8');
    assert.strictEqual(sourceContent, initialContent, 'Source file must remain untouched after cancellation');

    // 8. Verify snapshot file was not mutated with late patch
    const adapterSnapshot = adapter.latestSnapshot;
    if (adapterSnapshot) {
      const snapContent = await readFile(path.join(adapterSnapshot.root, 'src/app.js'), 'utf8');
      assert.strictEqual(snapContent, initialContent, 'Isolated snapshot file must not have received late patch effect');
    }

    // 9. Close manager and store after all assertions complete
    manager.close();

    return {
      passed: true,
      details: {
        taskState: finalResult.state,
        cancelled: cancelRes.cancelled,
        lateResponseCompleted: lateResponseResolved,
        artifactsCount: evidence.artifacts.length,
        sourceUntouched: true,
        snapshotUntouched: true
      }
    };
  } finally {
    await rm(wsDir, { recursive: true, force: true }).catch(() => {});
    await rm(dbDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Main offline smoke suite runner.
 */
async function runOfflineSmoke(options = {}) {
  const jsonMode = options.json === true || process.argv.includes('--json');
  const startTime = Date.now();

  const modules = await loadModules();

  const scenarioDefs = [
    {
      id: 'positive_lifecycle',
      name: 'admit -> isolatedsnapshot -> oneworker -> independent exactcheck verification -> durable evidence -> reviewready, source unchanged',
      fn: runPositiveScenario
    },
    {
      id: 'disabledlive_zero_network',
      name: 'disabledlive zero network (unapproved live inference / remote provider fails closed with 0 network calls)',
      fn: runDisabledLiveScenario
    },
    {
      id: 'missinggrant_deniedeffect',
      name: 'missinggrant deniedeffect (RCT tool request without active matching policy grant fails closed with no_matching_grant)',
      fn: runMissingGrantScenario
    },
    {
      id: 'stalehash_predispatch',
      name: 'stalehash predispatch (mismatched / stale source baseline hash rejected before provider dispatch; 0 provider calls, 0 artifacts)',
      fn: runStaleHashScenario
    },
    {
      id: 'cancellation_barrier_no_lateeffect',
      name: 'cancellation completedresponse barrier no lateeffect (cancellation drops late provider response, 0 artifacts)',
      fn: runCancellationBarrierScenario
    }
  ];

  const results = [];
  let allPassed = true;

  if (!jsonMode) {
    console.log('[ZETRO Offline Smoke] Starting product-level integration smoke suite (5 scenarios)...');
  }

  for (let i = 0; i < scenarioDefs.length; i++) {
    const s = scenarioDefs[i];
    const sStart = Date.now();
    try {
      const res = await s.fn(modules);
      const sDuration = Date.now() - sStart;
      results.push({
        id: s.id,
        name: s.name,
        passed: true,
        durationMs: sDuration,
        details: res.details
      });
      if (!jsonMode) {
        console.log(`✔ [${i + 1}/${scenarioDefs.length}] Scenario: ${s.name} (${sDuration}ms)`);
      }
    } catch (err) {
      allPassed = false;
      const sDuration = Date.now() - sStart;
      results.push({
        id: s.id,
        name: s.name,
        passed: false,
        durationMs: sDuration,
        error: err.message,
        stack: err.stack
      });
      if (!jsonMode) {
        console.error(`✖ [${i + 1}/${scenarioDefs.length}] Scenario: ${s.name} (${sDuration}ms) FAILED: ${err.message}`);
      }
    }
  }

  const totalDuration = Date.now() - startTime;
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;

  const summary = {
    ok: allPassed,
    totalScenarios: scenarioDefs.length,
    passed: passedCount,
    failed: failedCount,
    durationMs: totalDuration,
    scenarios: results
  };

  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('');
    console.log(`ℹ pass ${passedCount}`);
    console.log(`ℹ fail ${failedCount}`);
    console.log(`[ZETRO Offline Smoke] ${allPassed ? 'ALL 5 SCENARIOS PASSED' : 'SMOKE FAILED'} (${totalDuration}ms)`);
  }

  return summary;
}

if (require.main === module) {
  runOfflineSmoke()
    .then(summary => {
      process.exit(summary.ok ? 0 : 1);
    })
    .catch(err => {
      console.error('[ZETRO Offline Smoke] Fatal execution error:', err);
      process.exit(1);
    });
}

module.exports = {
  runOfflineSmoke,
  runPositiveScenario,
  runDisabledLiveScenario,
  runMissingGrantScenario,
  runStaleHashScenario,
  runCancellationBarrierScenario
};
