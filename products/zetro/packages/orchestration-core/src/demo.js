/**
 * ZETRO Orchestration Core - Complete Offline Lifecycle Demo
 *
 * Demonstrates the full durable worker lifecycle using:
 * - Authoritative SqliteTaskStore
 * - RealRctAdapter connecting to rct-runtime offline execution
 * - Independent RCT verifier directly auditing snapshot on disk
 * - All core lifecycle APIs: run, status, events, cancel, evidence
 * - Guaranteed source root immutability
 * - Delayed provider completion barrier with dual source/snapshot inspection
 * - Explicit derived invariant assertions for states, integrity, evidence, and cancellation
 *
 * Usage:
 *   node packages/orchestration-core/src/demo.js
 *   node packages/orchestration-core/src/cli.js demo
 *   node packages/orchestration-core/src/demo.js --fault=corrupt_source (negative fixture)
 */

import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  TaskManager,
  SqliteTaskStore,
  States,
  RealRctAdapter,
  createIndependentRctVerifier
} from './index.js';
import { sha256 } from '../../rct-runtime/src/index.js';

export async function runLifecycleDemo(options = {}) {
  const log = options.silent ? () => {} : console.log;
  const injectFault = options.injectFault || null;

  log('===============================================================');
  log('   ZETRO Orchestration Core - Offline Lifecycle Demo');
  log('===============================================================\n');

  let wsDir = null;
  let dbDir = null;
  let store = null;
  let managerA = null;
  let managerB = null;
  let adapterA = null;
  let adapterB = null;
  let retainDb = Boolean(options.retainDb);

  try {
    // -----------------------------------------------------------------
    // 1. Initialize Synthetic Workspace Source
    // -----------------------------------------------------------------
    wsDir = await mkdtemp(join(tmpdir(), 'zetro-demo-ws-'));
    const filePath = 'src/calculator.js';
    const initialContent = 'export function add(a, b) { return 0; }\n';
    await mkdir(join(wsDir, 'src'), { recursive: true });
    await writeFile(join(wsDir, filePath), initialContent, 'utf8');
    const initialHash = sha256(Buffer.from(initialContent));

    log('[1. Workspace Setup]');
    log(`    Source Root : ${wsDir}`);
    log(`    Target File : ${filePath}`);
    log(`    Initial Hash: ${initialHash}`);
    log(`    Content     : ${initialContent.trim()}\n`);

    // -----------------------------------------------------------------
    // 2. Initialize Authoritative SQLite Task Store
    // -----------------------------------------------------------------
    let isExplicitDb = false;
    let dbPath = null;
    if (options.dbPath) {
      dbPath = resolve(options.dbPath);
      dbDir = dirname(dbPath);
      await mkdir(dbDir, { recursive: true });
      isExplicitDb = true;
    } else if (options.dataDir) {
      dbDir = resolve(options.dataDir);
      await mkdir(dbDir, { recursive: true });
      dbPath = join(dbDir, 'tasks.db');
      isExplicitDb = true;
    } else {
      dbDir = await mkdtemp(join(tmpdir(), 'zetro-demo-db-'));
      dbPath = join(dbDir, 'tasks.db');
    }

    retainDb = isExplicitDb || Boolean(options.retainDb);

    if (typeof options.onPathsCreated === 'function') {
      options.onPathsCreated({ wsDir, dbDir, dbPath });
    }
    store = new SqliteTaskStore(dbPath);
    await store.init();

    log('[2. Authoritative Task Store]');
    log(`    Database    : SQLite (node:sqlite)`);
    log(`    Path        : ${dbPath}`);
    log(`    Status      : Initialized with WAL durability${retainDb ? ' (persistent; retained upon exit)' : ''}\n`);

    // -----------------------------------------------------------------
    // 3. Scenario A: Successful Run with Independent Verification
    // -----------------------------------------------------------------
    log('---------------------------------------------------------------');
    log(' Scenario A: Run -> Independent Verification -> COMPLETED');
    log('---------------------------------------------------------------');

    const targetContent = 'export function add(a, b) { return a + b; }\n';
    let providerTurn = 0;

    const offlineProvider = {
      name: 'demo-offline-rct-provider',
      async next() {
        providerTurn++;
        if (providerTurn === 1) {
          return {
            toolCalls: [{
              name: 'propose_patch',
              args: {
                path: filePath,
                expectedSha256: initialHash,
                content: targetContent
              }
            }],
            usage: { inputTokens: 120, outputTokens: 45 }
          };
        }
        return {
          toolCalls: [{
            name: 'submit_receipt',
            args: { summary: 'Implemented add(a, b) in calculator.js' }
          }],
          usage: { inputTokens: 95, outputTokens: 30 }
        };
      }
    };

    adapterA = new RealRctAdapter({
      provider: offlineProvider,
      sourceRoot: wsDir
    });
    const verifierA = createIndependentRctVerifier({ name: 'authoritative-rct-verifier' });
    managerA = new TaskManager(store, adapterA, { verifier: verifierA });
    await managerA.init();

    const taskIdA = 'task-demo-success-1';
    const envelopeA = {
      id: taskIdA,
      agent: 'worker-rct-1',
      objective: 'Implement addition in calculator.js',
      workspaceRoot: wsDir,
      allowedPaths: [filePath],
      contextRefs: ['docs/SPEC.md'],
      acceptance: 'Calculator add returns sum of operands',
      verification: filePath,
      declaredChecks: [filePath],
      sourceHash: initialHash,
      sourceHashes: { [filePath]: initialHash },
      checks: [
        { type: 'equals', path: filePath, text: targetContent }
      ],
      deadlineMs: 15000,
      budget: { maxContextChars: 10000, maxReplyChars: 2000, maxTurns: 4, maxWallMs: 15000 }
    };

    // API 1: run()
    log(`[API: run()] Dispatching TaskEnvelope: ${envelopeA.id}`);
    const runResultA = await managerA.run(envelopeA);
    log(`    Result State: ${runResultA.state}`);

    // API 2: status()
    const statusA = managerA.status(taskIdA);
    log(`[API: status()]`);
    log(`    Task ID     : ${statusA.id}`);
    log(`    Task State  : ${statusA.state}`);
    log(`    Attempt ID  : ${statusA.latestAttempt?.attemptId}`);
    log(`    Attempt St. : ${statusA.latestAttempt?.state}`);
    log(`    Uncertainty : ${statusA.uncertainty}`);

    // API 3: events()
    const eventsA = managerA.events(taskIdA);
    log(`[API: events()] Audit Log (${eventsA.length} recorded events):`);
    for (const ev of eventsA) {
      const payloadDesc = ev.payload ? JSON.stringify(ev.payload) : '';
      log(`    - [${ev.eventType}] ${payloadDesc}`);
    }

    // API 4: evidence()
    const evidenceA = managerA.evidence(taskIdA);
    log(`[API: evidence()] Persisted Artifacts (${evidenceA.artifacts.length}):`);
    for (const art of evidenceA.artifacts) {
      log(`    - [${art.artifactType}] ${art.uri}`);
      if (art.artifactType === 'verifier_evidence') {
        log(`      Verified: ${art.metadata?.verified}, Verifier: ${art.metadata?.verifier}`);
        log(`      Checks: ${JSON.stringify(art.metadata?.checks)}`);
      }
    }

    // Fault injection for negative fixture testing
    if (injectFault === 'corrupt_source') {
      await writeFile(join(wsDir, filePath), 'CORRUPTED_SOURCE_MODIFIED_OUTSIDE_RCT\n', 'utf8');
    }

    // Verify Source Immutability
    const sourceAfterA = await readFile(join(wsDir, filePath), 'utf8');
    const sourceUnchangedA = (sourceAfterA === initialContent);
    log(`[Source Root Integrity]`);
    log(`    Original Source Byte-Identical: ${sourceUnchangedA}`);

    // Verify Snapshot Workspace State
    let snapshotPatchedA = false;
    let snapContentA = '';
    if (adapterA.latestSnapshot) {
      snapContentA = await readFile(join(adapterA.latestSnapshot.root, filePath), 'utf8');
      snapshotPatchedA = (snapContentA === targetContent);
      log(`[Snapshot Workspace]`);
      log(`    Isolated Patch Applied Cleanly: ${snapshotPatchedA}`);
      log(`    Content: ${snapContentA.trim()}`);
    }

    // -----------------------------------------------------------------
    // Derived Invariant Assertions: Scenario A
    // -----------------------------------------------------------------
    log(`[Assertions: Scenario A] Verifying invariants...`);
    assert.equal(runResultA.state, States.COMPLETED, 'Task run() result must be COMPLETED');
    assert.equal(statusA.state, States.COMPLETED, 'Task state in SQLite store must be COMPLETED');
    assert.equal(statusA.latestAttempt?.state, States.COMPLETED, 'Latest attempt state must be COMPLETED');
    assert.equal(statusA.latestAttempt?.attemptNumber, 1, 'Attempt number must be 1');
    assert.equal(sourceUnchangedA, true, 'Original source root must remain 100% byte-identical');
    assert.equal(sourceAfterA, initialContent, 'Source file content must match initialContent');
    assert.equal(snapshotPatchedA, true, 'Snapshot file must be cleanly patched with targetContent');
    assert.equal(snapContentA, targetContent, 'Snapshot file content must match targetContent');
    assert.ok(evidenceA.artifacts.length >= 3, 'Evidence must contain at least 3 artifacts');
    const admissionArtifactA = evidenceA.artifacts.find(a => a.artifactType === 'workspace_admission');
    assert.ok(admissionArtifactA, 'workspace_admission artifact must exist in SQLite store');
    assert.ok(admissionArtifactA.metadata?.admissionDigest, 'workspace_admission must have admissionDigest');

    const verifierEvidenceA = evidenceA.artifacts.find(a => a.artifactType === 'verifier_evidence');
    assert.ok(verifierEvidenceA, 'verifier_evidence artifact must exist in SQLite store');
    assert.equal(verifierEvidenceA.metadata?.verified, true, 'Verifier metadata must report verified: true');
    assert.equal(verifierEvidenceA.metadata?.verifier, 'authoritative-rct-verifier', 'Verifier name must match');
    assert.equal(verifierEvidenceA.metadata?.checks?.[0]?.name, filePath, 'Check name must match target path');
    assert.equal(verifierEvidenceA.metadata?.checks?.[0]?.passed, true, 'Check must pass');
    assert.equal(verifierEvidenceA.metadata?.checks?.[0]?.sha256, sha256(Buffer.from(targetContent)), 'Check sha256 must match targetContent hash');

    assert.ok(eventsA.length >= 6, 'Audit log must record at least 6 lifecycle events');
    assert.ok(eventsA.some(e => e.eventType === 'INTENT_RECORDED' && e.payload?.intent === 'DISPATCH_CALL'), 'Must log DISPATCH_CALL intent');
    assert.ok(eventsA.some(e => e.eventType === 'STATE_TRANSITION' && e.payload?.to === States.COMPLETED), 'Must log COMPLETED transition');
    log(`    All Scenario A invariants verified.\n`);

    // -----------------------------------------------------------------
    // 4. Scenario B: Active Cancellation with Delayed Provider Barrier
    // -----------------------------------------------------------------
    log('---------------------------------------------------------------');
    log(' Scenario B: Cancel -> Barrier Settle -> Dual Inspection');
    log('---------------------------------------------------------------');

    let delayedProviderSettled = false;
    let resolveDelayedBarrier;
    const delayedBarrier = new Promise(resolve => {
      resolveDelayedBarrier = resolve;
    });

    let delayedProviderTurns = 0;
    const slowProvider = {
      name: 'demo-delayed-provider',
      async next({ signal }) {
        delayedProviderTurns++;
        return new Promise(resolve => {
          setTimeout(() => {
            delayedProviderSettled = true;
            const res = {
              toolCalls: [{
                name: 'propose_patch',
                args: {
                  path: filePath,
                  expectedSha256: initialHash,
                  content: 'export function add() { return "late_unauthorized"; }\n'
                }
              }],
              usage: { inputTokens: 15, outputTokens: 10 }
            };
            resolve(res);
            resolveDelayedBarrier(res);
          }, 350);
        });
      }
    };

    adapterB = new RealRctAdapter({
      provider: slowProvider,
      sourceRoot: wsDir
    });
    managerB = new TaskManager(store, adapterB, { verifier: verifierA });
    await managerB.init();

    const taskIdB = 'task-demo-cancel-1';
    const envelopeB = {
      id: taskIdB,
      agent: 'worker-rct-1',
      objective: 'Demonstrate active cancellation barrier',
      workspaceRoot: wsDir,
      allowedPaths: [filePath],
      contextRefs: ['docs/SPEC.md'],
      acceptance: 'Cancelled task must have zero effects',
      verification: filePath,
      declaredChecks: [filePath],
      sourceHash: initialHash,
      sourceHashes: { [filePath]: initialHash },
      checks: [
        { type: 'equals', path: filePath, text: targetContent }
      ],
      deadlineMs: 15000,
      budget: { maxContextChars: 10000, maxReplyChars: 2000, maxTurns: 2, maxWallMs: 15000 }
    };

    log(`[Dispatch] Starting task: ${taskIdB}`);
    const runPromiseB = managerB.run(envelopeB);

    // Give provider 60ms to initiate before operator cancellation
    await new Promise(r => setTimeout(r, 60));

    // API 5: cancel()
    log(`[API: cancel()] Operator triggers cancellation: ${taskIdB}`);
    const cancelResult = managerB.cancel(taskIdB);
    log(`    Cancel Accepted: ${cancelResult.cancelled}`);

    // Await the task manager run promise
    await runPromiseB;

    // Explicit Delayed Provider Barrier: Wait until 350ms provider timer settles
    log(`[Barrier] Awaiting explicit delayed provider response completion...`);
    await delayedBarrier;
    log(`    Delayed provider response completed in background.`);

    // Fault injection for cancellation testing
    if (injectFault === 'late_snapshot_mutation') {
      if (adapterB.latestSnapshot) {
        await writeFile(join(adapterB.latestSnapshot.root, filePath), 'UNAUTHORIZED_LATE_MUTATION\n', 'utf8');
      }
    }

    // Dual Inspection: Inspect BOTH source AND snapshot after barrier
    const sourceAfterB = await readFile(join(wsDir, filePath), 'utf8');
    const sourceUnchangedB = (sourceAfterB === initialContent);

    let snapshotUnchangedB = false;
    let snapContentB = '';
    if (adapterB.latestSnapshot) {
      snapContentB = await readFile(join(adapterB.latestSnapshot.root, filePath), 'utf8');
      snapshotUnchangedB = (snapContentB === initialContent);
    }

    const statusB = managerB.status(taskIdB);
    const evidenceB = managerB.evidence(taskIdB);

    log(`[Dual Inspection After Cancellation Barrier]`);
    log(`    Original Source Unchanged : ${sourceUnchangedB}`);
    log(`    Snapshot Workspace Intact : ${snapshotUnchangedB} (zero late tool effects)`);
    log(`    Final Task State          : ${statusB.state}`);
    log(`    Final Attempt State       : ${statusB.latestAttempt?.state}`);
    log(`    Persisted Artifacts Count : ${evidenceB.artifacts.length}`);

    // Consumed AGR2 Receipt Inspection
    const rctReceipt = adapterB.latestReceipt;
    log(`[Consumed AGR2 Signal Port Receipt]`);
    log(`    Receipt State             : ${rctReceipt?.state}`);
    log(`    Failure Reason            : ${rctReceipt?.failureReason}`);
    log(`    Remote Usage Uncertain    : ${rctReceipt?.remoteUsageUncertain}\n`);

    // -----------------------------------------------------------------
    // Derived Invariant Assertions: Scenario B
    // -----------------------------------------------------------------
    log(`[Assertions: Scenario B] Verifying invariants...`);
    assert.equal(cancelResult.cancelled, true, 'cancel() must return cancelled: true');
    assert.equal(delayedProviderSettled, true, 'Delayed provider response completion barrier must have settled');
    assert.equal(sourceUnchangedB, true, 'Original source must remain 100% byte-identical after cancellation');
    assert.equal(sourceAfterB, initialContent, 'Source content must match initialContent after cancellation');
    assert.equal(snapshotUnchangedB, true, 'Snapshot workspace must remain unmodified (zero late tool effects)');
    assert.equal(snapContentB, initialContent, 'Snapshot content must match initialContent');
    assert.equal(statusB.state, States.CANCELLED, 'Task state in store must be CANCELLED');
    assert.equal(statusB.latestAttempt?.state, States.CANCELLED, 'Attempt state in store must be CANCELLED');
    assert.equal(evidenceB.artifacts.length, 0, 'Cancelled task must have strictly zero artifacts persisted');
    assert.ok(rctReceipt, 'Adapter must consume AGR2 receipt from signal port');
    assert.equal(rctReceipt.state, 'unknown', 'RCT receipt state on abort must be unknown');
    assert.equal(rctReceipt.failureReason, 'aborted', 'RCT receipt failureReason on abort must be aborted');
    assert.equal(rctReceipt.remoteUsageUncertain, true, 'Remote usage must be flagged uncertain');
    log(`    All Scenario B invariants verified.\n`);

    log('===============================================================');
    log('   Lifecycle Demo Completed Successfully: All Invariants Pass');
    log('===============================================================\n');

    return {
      success: true,
      scenarioA: {
        taskId: taskIdA,
        state: statusA.state,
        sourceUnchanged: sourceUnchangedA,
        snapshotPatched: snapshotPatchedA,
        artifactsCount: evidenceA.artifacts.length
      },
      scenarioB: {
        taskId: taskIdB,
        state: statusB.state,
        sourceUnchanged: sourceUnchangedB,
        snapshotUnchanged: snapshotUnchangedB,
        artifactsCount: evidenceB.artifacts.length,
        receiptState: rctReceipt?.state,
        failureReason: rctReceipt?.failureReason
      },
      workspaceRoot: wsDir,
      databaseDir: dbDir,
      dbPath,
      retained: retainDb
    };
  } finally {
    // Guaranteed cleanup across success and failure without swallowing actual errors
    const cleanupErrors = [];

    try {
      if (managerA) managerA.close();
    } catch (err) {
      cleanupErrors.push(err);
    }

    try {
      if (managerB) managerB.close();
    } catch (err) {
      cleanupErrors.push(err);
    }

    try {
      if (store) store.close();
    } catch (err) {
      cleanupErrors.push(err);
    }

    try {
      if (adapterA) await adapterA.dispose();
    } catch (err) {
      cleanupErrors.push(err);
    }

    try {
      if (adapterB) await adapterB.dispose();
    } catch (err) {
      cleanupErrors.push(err);
    }

    try {
      if (wsDir) await rm(wsDir, { recursive: true, force: true });
    } catch (err) {
      cleanupErrors.push(err);
    }

    try {
      if (dbDir && !retainDb) await rm(dbDir, { recursive: true, force: true });
    } catch (err) {
      cleanupErrors.push(err);
    }

    if (cleanupErrors.length > 0) {
      throw new Error(`Cleanup failed: ${cleanupErrors.map(e => e.message || e).join('; ')}`);
    }
  }
}

// Direct invocation CLI runner
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('demo.js')) {
  const faultArg = process.argv.find(a => a.startsWith('--fault='));
  const injectFault = faultArg ? faultArg.split('=')[1] : null;
  const dataDirIdx = process.argv.indexOf('--data-dir');
  const dataDir = dataDirIdx !== -1 ? process.argv[dataDirIdx + 1] : null;
  const dbIdx = process.argv.indexOf('--db');
  const dbPath = dbIdx !== -1 ? process.argv[dbIdx + 1] : null;

  runLifecycleDemo({ injectFault, dataDir, dbPath }).catch(err => {
    console.error('\n[DEMO INVARIANT FAILURE]');
    console.error(err.message || err);
    process.exit(1);
  });
}
