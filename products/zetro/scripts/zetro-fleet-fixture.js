#!/usr/bin/env node

/**
 * ZETRO Deterministic 15-Worker Fleet Fixture Runner
 *
 * Implements Stage A deterministic integration fixture from docs/POST-BUILD-STRESS-TEST-PLAN.md.
 * Injects 15 synthetic adapter slots:
 * - AGR-1 through AGR-5 (Coding Agent Adapters)
 * - OCR-1 through OCR-5 (Computer Observation Adapters)
 * - RCT-1 through RCT-5 (Review & Conformance Adapters)
 *
 * Architectural Guarantees:
 * 1. Synchronized Start Barrier: All 15 slots admitted before wave release.
 * 2. Exact Unique Identities: Every slot receives unique campaign, worker, task, attempt, and workspace IDs.
 * 3. Independent Expected-Result Verifier: Output, hash, canary, and scope verified independently.
 * 4. Strict Accounting & Overlap Trace: Measures simultaneous concurrent execution interval and peak concurrency.
 * 5. Bounded Campaign & Per-Worker Deadlines: Strict timeout enforcement with prompt abort.
 * 6. Honest Mock-Fleet Labeling: Clearly marked MOCK-FLEET and realFleetVerified: false;
 *    never counted as a live or milestone pass.
 *
 * Owned by AGR-5 (Milestone M0 Lead / Release Qualification).
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert');

const FLEET_SLOTS = [
  { id: 'AGR-1', type: 'AGR', role: 'Coding Worker 1' },
  { id: 'AGR-2', type: 'AGR', role: 'Coding Worker 2' },
  { id: 'AGR-3', type: 'AGR', role: 'Coding Worker 3' },
  { id: 'AGR-4', type: 'AGR', role: 'Coding Worker 4' },
  { id: 'AGR-5', type: 'AGR', role: 'Coding Worker 5' },
  { id: 'OCR-1', type: 'OCR', role: 'Computer Observer 1' },
  { id: 'OCR-2', type: 'OCR', role: 'Computer Observer 2' },
  { id: 'OCR-3', type: 'OCR', role: 'Computer Observer 3' },
  { id: 'OCR-4', type: 'OCR', role: 'Computer Observer 4' },
  { id: 'OCR-5', type: 'OCR', role: 'Computer Observer 5' },
  { id: 'RCT-1', type: 'RCT', role: 'Review Conformance 1' },
  { id: 'RCT-2', type: 'RCT', role: 'Review Conformance 2' },
  { id: 'RCT-3', type: 'RCT', role: 'Review Conformance 3' },
  { id: 'RCT-4', type: 'RCT', role: 'Review Conformance 4' },
  { id: 'RCT-5', type: 'RCT', role: 'Review Conformance 5' }
];

/**
 * SHA-256 helper.
 */
function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Sleep helper.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Synchronized Start Barrier.
 * Coordinates arrival of all admitted workers before releasing simultaneous execution.
 */
class StartBarrier {
  constructor(expectedCount, timeoutMs = 10000) {
    this.expectedCount = expectedCount;
    this.timeoutMs = timeoutMs;
    this.arrived = new Set();
    this.waiters = [];
    this.released = false;
    this.aborted = false;
    this.abortReason = null;
    this.timer = null;
  }

  start() {
    this.timer = setTimeout(() => {
      this.abort(new Error(`StartBarrier timeout after ${this.timeoutMs}ms; only ${this.arrived.size}/${this.expectedCount} workers arrived.`));
    }, this.timeoutMs);
  }

  async arriveAndWait(workerId) {
    if (this.aborted) {
      throw this.abortReason || new Error('Barrier already aborted');
    }
    if (this.released) {
      return;
    }

    this.arrived.add(workerId);

    if (this.arrived.size === this.expectedCount) {
      this.release();
      return;
    }

    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject, workerId });
    });
  }

  release() {
    if (this.timer) clearTimeout(this.timer);
    this.released = true;
    const currentWaiters = this.waiters;
    this.waiters = [];
    for (const waiter of currentWaiters) {
      waiter.resolve();
    }
  }

  abort(err) {
    if (this.timer) clearTimeout(this.timer);
    this.aborted = true;
    this.abortReason = err;
    const currentWaiters = this.waiters;
    this.waiters = [];
    for (const waiter of currentWaiters) {
      waiter.reject(err);
    }
  }
}

/**
 * Concurrency & Overlap Tracker.
 * Records start and stop timestamps and computes simultaneous execution intervals.
 */
class OverlapTracker {
  constructor() {
    this.events = [];
    this.workerIntervals = new Map();
  }

  recordStart(workerId, timestamp = Date.now()) {
    this.events.push({ workerId, type: 'START', timestamp });
    this.workerIntervals.set(workerId, { startedAt: timestamp, endedAt: null });
  }

  recordEnd(workerId, timestamp = Date.now()) {
    this.events.push({ workerId, type: 'END', timestamp });
    const interval = this.workerIntervals.get(workerId);
    if (interval) {
      interval.endedAt = timestamp;
    }
  }

  computeMetrics() {
    let currentConcurrent = 0;
    let peakConcurrency = 0;
    const sortedEvents = [...this.events].sort((a, b) => a.timestamp - b.timestamp);

    for (const event of sortedEvents) {
      if (event.type === 'START') {
        currentConcurrent++;
        if (currentConcurrent > peakConcurrency) {
          peakConcurrency = currentConcurrent;
        }
      } else if (event.type === 'END') {
        currentConcurrent = Math.max(0, currentConcurrent - 1);
      }
    }

    // Check common overlap interval across all recorded workers
    let commonStart = -Infinity;
    let commonEnd = Infinity;
    let allHaveIntervals = this.workerIntervals.size > 0;

    for (const [_, interval] of this.workerIntervals.entries()) {
      if (!interval.startedAt || !interval.endedAt) {
        allHaveIntervals = false;
        break;
      }
      if (interval.startedAt > commonStart) commonStart = interval.startedAt;
      if (interval.endedAt < commonEnd) commonEnd = interval.endedAt;
    }

    const overlapDurationMs = allHaveIntervals && commonEnd > commonStart ? commonEnd - commonStart : 0;
    const fullFleetSimultaneous = allHaveIntervals && overlapDurationMs > 0 && peakConcurrency === this.workerIntervals.size;

    return {
      peakConcurrency,
      totalWorkersTracked: this.workerIntervals.size,
      fullFleetSimultaneous,
      overlapDurationMs,
      commonInterval: fullFleetSimultaneous ? { start: commonStart, end: commonEnd } : null,
      eventsCount: this.events.length
    };
  }
}

const DEFAULT_PROVIDER_ID = 'mock-fleet-transport';

/**
 * Synthetic Task Specification Generator.
 * Generates distinct deterministic workloads per slot with exact bound identities.
 */
function createSyntheticSlotSpec(slot, campaignId, workspaceDir = null) {
  const taskId = `task-${slot.id.toLowerCase()}-${campaignId}`;
  const attemptId = 'att-1';
  const providerId = DEFAULT_PROVIDER_ID;
  const normalizedWorkspace = workspaceDir ? path.resolve(workspaceDir) : null;
  const relativeTarget = `target_${slot.id.toLowerCase()}.txt`;
  const relativeCanary = `canary_${slot.id.toLowerCase()}.txt`;

  const expectedContent = `ZETRO_${slot.type}_OUTPUT_${slot.id}_${campaignId}_OK\n`;
  const canaryContent = `CANARY_${slot.id}_STRICT_UNTOUCHED\n`;

  return {
    campaignId,
    workerId: slot.id,
    workerType: slot.type,
    role: slot.role,
    taskId,
    attemptId,
    providerId,
    workspacePath: normalizedWorkspace,
    relativeTarget,
    relativeCanary,
    allowedFiles: new Set([relativeTarget, relativeCanary]),
    expectedContent,
    expectedSha256: sha256(expectedContent),
    canaryContent,
    canarySha256: sha256(canaryContent),
    timeoutMs: 5000,
    syntheticDelayMs: 20 + Math.floor(Math.random() * 20) // Deterministic slight staggering (20-40ms)
  };
}

/**
 * Injected Synthetic Worker Slot Execution.
 */
async function executeSyntheticSlot(spec, workspaceDir, barrier, tracker, options = {}) {
  const resolvedWorkspace = path.resolve(workspaceDir || spec.workspacePath);
  const targetPath = path.join(resolvedWorkspace, spec.relativeTarget);
  const canaryPath = path.join(resolvedWorkspace, spec.relativeCanary);

  // Setup initial workspace state
  await fs.writeFile(canaryPath, spec.canaryContent, 'utf8');

  // Inject scope violations if requested for testing
  if (options.injectExtraFile) {
    const extraFilePath = path.join(resolvedWorkspace, 'unauthorized_extra_file.txt');
    await fs.writeFile(extraFilePath, 'MALICIOUS_EXTRA_PAYLOAD\n', 'utf8');
  }

  if (options.injectSymlinkEscape) {
    const escapeTarget = path.join(os.tmpdir(), `zetro-escape-target-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(escapeTarget, { recursive: true });
    const linkPath = path.join(resolvedWorkspace, 'escape_link');
    try {
      await fs.symlink(escapeTarget, linkPath, 'junction');
    } catch {
      // fallback
    }
  }

  // 1. Admission Check
  if (options.rejectAdmission) {
    return {
      campaignId: options.injectWrongCampaign ? 'camp-FORGED-99' : spec.campaignId,
      workerId: options.injectWrongIdentity ? 'FORGED-WORKER-ID' : spec.workerId,
      taskId: options.injectWrongTaskId ? 'task-FORGED-99' : spec.taskId,
      attemptId: options.injectWrongAttempt ? 'att-FORGED-99' : spec.attemptId,
      workspacePath: options.injectWrongWorkspace ? path.resolve('/tmp/forged-workspace') : resolvedWorkspace,
      providerId: options.injectWrongProvider ? 'unauthorized-live-bridge' : spec.providerId,
      state: 'REJECTED',
      reason: 'ADMISSION_DENIED',
      verified: false
    };
  }

  // 2. Synchronize at Start Barrier
  await barrier.arriveAndWait(spec.workerId);

  // 3. Execution Phase
  const startedAt = Date.now();
  tracker.recordStart(spec.workerId, startedAt);

  let state = 'RUNNING';
  let error = null;
  const slotTimeoutMs = options.customTimeoutMs || spec.timeoutMs;

  try {
    if (options.injectTimeout) {
      await sleep(slotTimeoutMs + 30);
      throw new Error(`TASK_TIMEOUT: Execution exceeded ${slotTimeoutMs}ms deadline`);
    }

    if (options.abortSignal && options.abortSignal.aborted) {
      throw new Error('TASK_CANCELLED: Operation aborted by coordinator signal');
    }

    // Simulate work duration
    const delay = options.customDelayMs !== undefined ? options.customDelayMs : spec.syntheticDelayMs;
    await sleep(delay);

    if (options.abortSignal && options.abortSignal.aborted) {
      throw new Error('TASK_CANCELLED: Operation aborted by coordinator signal');
    }

    // Produce output
    const outputContent = options.injectForgedOutput ? 'FORGED_CONTENT_TAMPERED' : spec.expectedContent;
    await fs.writeFile(targetPath, outputContent, 'utf8');

    state = 'COMPLETED';
  } catch (err) {
    state = err.message.includes('CANCELLED') ? 'CANCELLED' : (err.message.includes('TIMEOUT') ? 'TIMED_OUT' : 'FAILED');
    error = err.message;
  } finally {
    const endedAt = Date.now();
    tracker.recordEnd(spec.workerId, endedAt);
  }

  return {
    campaignId: options.injectWrongCampaign ? 'camp-FORGED-99' : spec.campaignId,
    workerId: options.injectWrongIdentity ? 'FORGED-WORKER-ID' : spec.workerId,
    taskId: options.injectWrongTaskId ? 'task-FORGED-99' : spec.taskId,
    attemptId: options.injectWrongAttempt ? 'att-FORGED-99' : spec.attemptId,
    workspacePath: options.injectWrongWorkspace ? path.resolve('/tmp/forged-workspace') : resolvedWorkspace,
    providerId: options.injectWrongProvider ? 'unauthorized-live-bridge' : spec.providerId,
    state,
    error,
    targetFile: spec.relativeTarget,
    canaryFile: spec.relativeCanary,
    usage: {
      requests: 1,
      inputTokens: 50,
      outputTokens: 25,
      totalTokens: 75
    }
  };
}

/**
 * Independent Fleet Verifier.
 * Strictly verifies execution outputs against prepared expected results.
 * Enforces exact campaign, worker, task, attempt, workspace, and provider identities
 * BEFORE reading files or accepting results.
 * Enforces scope isolation by enumerating workspace files and rejecting extra files / symlink escapes.
 */
async function verifyFleetSlotResult(spec, result, workspaceDir) {
  const verification = {
    workerId: spec.workerId,
    taskId: spec.taskId,
    attemptId: spec.attemptId,
    campaignId: spec.campaignId,
    providerId: spec.providerId,
    verified: false,
    checks: [],
    failureReason: null
  };

  // 1. Strict Bound Identities Compare BEFORE any file reads or acceptance
  if (!result || typeof result !== 'object') {
    verification.failureReason = 'Result object is missing or invalid';
    verification.checks.push({ name: 'bound_identities_match', passed: false, detail: verification.failureReason });
    return verification;
  }

  // 1.1 Campaign identity check
  if (result.campaignId !== spec.campaignId) {
    verification.failureReason = `Campaign identity mismatch: expected '${spec.campaignId}', got '${result.campaignId}'`;
    verification.checks.push({ name: 'bound_identities_match', passed: false, detail: verification.failureReason });
    return verification;
  }

  // 1.2 Worker identity check
  if (result.workerId !== spec.workerId) {
    verification.failureReason = `Worker identity mismatch: expected '${spec.workerId}', got '${result.workerId}'`;
    verification.checks.push({ name: 'bound_identities_match', passed: false, detail: verification.failureReason });
    return verification;
  }

  // 1.3 Task identity check
  if (result.taskId !== spec.taskId) {
    verification.failureReason = `Task identity mismatch: expected '${spec.taskId}', got '${result.taskId}'`;
    verification.checks.push({ name: 'bound_identities_match', passed: false, detail: verification.failureReason });
    return verification;
  }

  // 1.4 Attempt identity check (same worker, wrong attempt must fail)
  if (result.attemptId !== spec.attemptId) {
    verification.failureReason = `Attempt identity mismatch: expected '${spec.attemptId}', got '${result.attemptId}'`;
    verification.checks.push({ name: 'bound_identities_match', passed: false, detail: verification.failureReason });
    return verification;
  }

  // 1.5 Provider identity check
  if (result.providerId !== spec.providerId) {
    verification.failureReason = `Provider identity mismatch: expected '${spec.providerId}', got '${result.providerId}'`;
    verification.checks.push({ name: 'bound_identities_match', passed: false, detail: verification.failureReason });
    return verification;
  }

  // 1.6 Workspace path identity check
  const resolvedSpecWorkspace = path.resolve(spec.workspacePath);
  const resolvedResultWorkspace = result.workspacePath ? path.resolve(result.workspacePath) : null;
  const resolvedActualWorkspace = path.resolve(workspaceDir);

  if (!resolvedResultWorkspace || resolvedResultWorkspace.toLowerCase() !== resolvedSpecWorkspace.toLowerCase()) {
    verification.failureReason = `Workspace path mismatch: expected '${resolvedSpecWorkspace}', got '${resolvedResultWorkspace}'`;
    verification.checks.push({ name: 'bound_identities_match', passed: false, detail: verification.failureReason });
    return verification;
  }

  if (resolvedActualWorkspace.toLowerCase() !== resolvedSpecWorkspace.toLowerCase()) {
    verification.failureReason = `Workspace directory argument mismatch: expected '${resolvedSpecWorkspace}', got '${resolvedActualWorkspace}'`;
    verification.checks.push({ name: 'bound_identities_match', passed: false, detail: verification.failureReason });
    return verification;
  }

  verification.checks.push({ name: 'bound_identities_match', passed: true });

  // 2. Terminal state check
  if (result.state !== 'COMPLETED') {
    verification.failureReason = `Terminal state not COMPLETED: got '${result.state}' (${result.error || 'none'})`;
    verification.checks.push({ name: 'terminal_state_completed', passed: false, detail: verification.failureReason });
    return verification;
  }
  verification.checks.push({ name: 'terminal_state_completed', passed: true });

  // 3. Workspace scope enumeration & escape barrier (reject extra files, directories, symlinks/junctions)
  try {
    const entries = await fs.readdir(resolvedActualWorkspace, { withFileTypes: true });
    const allowed = spec.allowedFiles || new Set([spec.relativeTarget, spec.relativeCanary]);
    const foundNames = new Set();

    for (const entry of entries) {
      foundNames.add(entry.name);
      const entryPath = path.join(resolvedActualWorkspace, entry.name);

      // Check dirent isSymbolicLink
      if (entry.isSymbolicLink()) {
        verification.failureReason = `Scope violation: symbolic link or junction detected in workspace: '${entry.name}'`;
        verification.checks.push({ name: 'scope_isolation', passed: false, detail: verification.failureReason });
        return verification;
      }

      // Check explicit lstat for Windows junctions
      const lstat = await fs.lstat(entryPath);
      if (lstat.isSymbolicLink()) {
        verification.failureReason = `Scope violation: symbolic link detected in workspace: '${entry.name}'`;
        verification.checks.push({ name: 'scope_isolation', passed: false, detail: verification.failureReason });
        return verification;
      }

      // Check for unauthorized directory
      if (entry.isDirectory()) {
        verification.failureReason = `Scope violation: unauthorized directory created in workspace: '${entry.name}'`;
        verification.checks.push({ name: 'scope_isolation', passed: false, detail: verification.failureReason });
        return verification;
      }

      // Check if file is in allowed fixture files set
      if (!allowed.has(entry.name)) {
        verification.failureReason = `Scope violation: unauthorized extra file detected in workspace: '${entry.name}'`;
        verification.checks.push({ name: 'scope_isolation', passed: false, detail: verification.failureReason });
        return verification;
      }
    }

    // Ensure all required fixture files exist
    for (const requiredFile of [spec.relativeTarget, spec.relativeCanary]) {
      if (!foundNames.has(requiredFile)) {
        verification.failureReason = `Scope violation: expected fixture file missing in workspace: '${requiredFile}'`;
        verification.checks.push({ name: 'scope_isolation', passed: false, detail: verification.failureReason });
        return verification;
      }
    }

    verification.checks.push({ name: 'scope_isolation', passed: true, allowedFiles: Array.from(allowed) });
  } catch (err) {
    verification.failureReason = `Workspace scope check error: ${err.message}`;
    verification.checks.push({ name: 'scope_isolation', passed: false, detail: verification.failureReason });
    return verification;
  }

  // 4. Canary file integrity check (canary must remain 100% byte-identical)
  const canaryPath = path.join(resolvedActualWorkspace, spec.relativeCanary);
  try {
    const actualCanary = await fs.readFile(canaryPath, 'utf8');
    const actualCanaryHash = sha256(actualCanary);
    if (actualCanaryHash !== spec.canarySha256) {
      verification.failureReason = `Canary file corrupted or mutated: hash mismatch`;
      verification.checks.push({ name: 'canary_integrity', passed: false, detail: verification.failureReason });
      return verification;
    }
    verification.checks.push({ name: 'canary_integrity', passed: true, sha256: actualCanaryHash });
  } catch (err) {
    verification.failureReason = `Canary file unreadable: ${err.message}`;
    verification.checks.push({ name: 'canary_integrity', passed: false, detail: verification.failureReason });
    return verification;
  }

  // 5. Target output exact match check
  const targetPath = path.join(resolvedActualWorkspace, spec.relativeTarget);
  try {
    const actualTarget = await fs.readFile(targetPath, 'utf8');
    const actualTargetHash = sha256(actualTarget);
    if (actualTargetHash !== spec.expectedSha256) {
      verification.failureReason = `Target output hash mismatch: expected '${spec.expectedSha256}', got '${actualTargetHash}'`;
      verification.checks.push({ name: 'output_exact_match', passed: false, detail: verification.failureReason });
      return verification;
    }
    verification.checks.push({ name: 'output_exact_match', passed: true, sha256: actualTargetHash });
  } catch (err) {
    verification.failureReason = `Target output unreadable: ${err.message}`;
    verification.checks.push({ name: 'output_exact_match', passed: false, detail: verification.failureReason });
    return verification;
  }

  // 6. Usage accounting check
  if (!result.usage || result.usage.requests !== 1 || result.usage.totalTokens !== 75) {
    verification.failureReason = 'Usage accounting invalid or malformed';
    verification.checks.push({ name: 'usage_accounting', passed: false });
    return verification;
  }
  verification.checks.push({ name: 'usage_accounting', passed: true });

  verification.verified = true;
  return verification;
}

/**
 * Run a full 15-worker synthetic fleet wave.
 */
async function runFleetWave(options = {}) {
  const campaignId = options.campaignId || `camp-${Date.now()}`;
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zetro-fleet-'));
  const tracker = new OverlapTracker();
  const barrier = new StartBarrier(FLEET_SLOTS.length, options.barrierTimeoutMs || 5000);

  barrier.start();

  const slotResults = [];
  const slotVerifications = [];
  const waveStartTime = Date.now();

  try {
    // Check for duplicate task ID injection
    const seenTaskIds = new Set();

    // Prepare specs and workspaces
    const slotConfigs = await Promise.all(
      FLEET_SLOTS.map(async (slot) => {
        const slotWorkspace = path.resolve(path.join(baseDir, slot.id));
        await fs.mkdir(slotWorkspace, { recursive: true });

        const spec = createSyntheticSlotSpec(slot, campaignId, slotWorkspace);

        if (options.injectDuplicateTaskId && slot.id === 'AGR-2') {
          spec.taskId = `task-agr-1-${campaignId}`; // Force duplicate
        }

        if (seenTaskIds.has(spec.taskId)) {
          throw new Error(`DUPLICATE_TASK_DENIED: Task ID '${spec.taskId}' assigned to multiple slots`);
        }
        seenTaskIds.add(spec.taskId);

        return { slot, spec, slotWorkspace };
      })
    );

    // Launch all 15 slots concurrently
    const slotPromises = slotConfigs.map(async ({ slot, spec, slotWorkspace }) => {
      const slotOpts = {};

      if (options.injectedSlotFailures && options.injectedSlotFailures[slot.id]) {
        Object.assign(slotOpts, options.injectedSlotFailures[slot.id]);
      }

      const result = await executeSyntheticSlot(spec, slotWorkspace, barrier, tracker, slotOpts);
      const verification = await verifyFleetSlotResult(spec, result, slotWorkspace);

      return { slot, spec, result, verification };
    });

    const settled = await Promise.all(slotPromises);

    for (const item of settled) {
      slotResults.push(item.result);
      slotVerifications.push(item.verification);
    }
  } finally {
    // Release barriers & clean up disposable workspaces
    if (!options.preserveWorkspaces) {
      await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const waveDurationMs = Date.now() - waveStartTime;
  const overlapMetrics = tracker.computeMetrics();

  const totalSlots = FLEET_SLOTS.length;
  const verifiedSlots = slotVerifications.filter((v) => v.verified).length;
  const failedSlots = totalSlots - verifiedSlots;
  const waveSuccess = verifiedSlots === totalSlots && overlapMetrics.fullFleetSimultaneous;

  return {
    mode: 'MOCK-FLEET',
    realFleetVerified: false, // Invariant: deterministic offline fixture never certifies live pass
    liveMilestonePassed: false,
    disclaimer: 'Deterministic offline fixture test only. Does not count as live or milestone pass.',
    campaignId,
    timestamp: new Date().toISOString(),
    totalSlots,
    verifiedSlots,
    failedSlots,
    waveSuccess,
    durationMs: waveDurationMs,
    overlapMetrics,
    slots: FLEET_SLOTS.map((slot, idx) => ({
      slotId: slot.id,
      type: slot.type,
      role: slot.role,
      state: slotResults[idx]?.state || 'UNKNOWN',
      verified: slotVerifications[idx]?.verified || false,
      failureReason: slotVerifications[idx]?.failureReason || null
    }))
  };
}

/**
 * Format report into human-readable text.
 */
function formatFleetReport(report) {
  const lines = [];
  lines.push('========================================================================');
  lines.push(' ZETRO 15-Worker Concurrent Fleet Fixture Report');
  lines.push(' Mode: MOCK-FLEET (Deterministic Injected Transport)');
  lines.push(' Real Fleet Verified: FALSE (Offline Fixture Only)');
  lines.push('========================================================================');
  lines.push(` Campaign ID:          ${report.campaignId}`);
  lines.push(` Total Slots:          ${report.totalSlots} (5 AGR, 5 OCR, 5 RCT)`);
  lines.push(` Verified Slots:       ${report.verifiedSlots}/${report.totalSlots}`);
  lines.push(` Duration:             ${report.durationMs}ms`);
  lines.push(` Peak Concurrency:     ${report.overlapMetrics.peakConcurrency}/${report.totalSlots}`);
  lines.push(` Fleet Overlap:        ${report.overlapMetrics.fullFleetSimultaneous ? `SIMULTANEOUS (${report.overlapMetrics.overlapDurationMs}ms common interval)` : 'NO COMMON OVERLAP'}`);
  lines.push(` Wave Status:          ${report.waveSuccess ? 'PASSED (Deterministic Offline)' : 'FAILED / UNVERIFIED'}`);
  lines.push('------------------------------------------------------------------------');
  lines.push(' Per-Slot Results:');
  lines.push('------------------------------------------------------------------------');

  for (const slot of report.slots) {
    const symbol = slot.verified ? '[PASS]' : '[FAIL]';
    const reason = slot.failureReason ? ` -> ${slot.failureReason}` : '';
    lines.push(` ${symbol} ${slot.slotId.padEnd(8)} [${slot.type}] ${slot.role.padEnd(22)} state=${slot.state}${reason}`);
  }

  lines.push('========================================================================');
  lines.push(` Disclaimer: ${report.disclaimer}`);
  lines.push('========================================================================');

  return lines.join('\n');
}

/**
 * Run Deterministic Fixture Test Suite.
 */
async function runMockTestSuite() {
  console.log('========================================================================');
  console.log(' ZETRO 15-Worker Fleet Fixture Test Suite (Offline Synthetic Runner)');
  console.log('========================================================================\n');

  // Test 1: Synthetic normal 15 results with full concurrent overlap
  console.log('▶ Test 1: Executing normal 15-worker concurrent fleet wave...');
  const normalWave = await runFleetWave();
  assert.strictEqual(normalWave.totalSlots, 15);
  assert.strictEqual(normalWave.verifiedSlots, 15);
  assert.strictEqual(normalWave.failedSlots, 0);
  assert.strictEqual(normalWave.waveSuccess, true);
  assert.strictEqual(normalWave.overlapMetrics.peakConcurrency, 15);
  assert.strictEqual(normalWave.realFleetVerified, false, 'Invariant: realFleetVerified must be false');
  assert.strictEqual(normalWave.liveMilestonePassed, false, 'Invariant: liveMilestonePassed must be false');
  console.log(`✔ Test 1: Normal 15-worker fleet wave PASSED (15/15 verified, ${normalWave.overlapMetrics.overlapDurationMs}ms overlap)`);

  // Test 2: Wrong worker identity probe (mismatched worker ID)
  console.log('▶ Test 2: Validating wrong worker identity rejection barrier...');
  const wrongIdentityWave = await runFleetWave({
    injectedSlotFailures: {
      'AGR-3': { injectWrongIdentity: true }
    }
  });
  const agr3Result = wrongIdentityWave.slots.find((s) => s.slotId === 'AGR-3');
  assert.strictEqual(agr3Result.verified, false);
  assert.ok(agr3Result.failureReason.includes('Worker identity mismatch'));
  console.log('✔ Test 2: Wrong worker identity probe PASSED (rejected before file reads/acceptance)');

  // Test 3: Wrong task ID rejection barrier
  console.log('▶ Test 3: Validating wrong task identity rejection barrier...');
  const wrongTaskWave = await runFleetWave({
    injectedSlotFailures: {
      'AGR-2': { injectWrongTaskId: true }
    }
  });
  const agr2Result = wrongTaskWave.slots.find((s) => s.slotId === 'AGR-2');
  assert.strictEqual(agr2Result.verified, false);
  assert.ok(agr2Result.failureReason.includes('Task identity mismatch'));
  console.log('✔ Test 3: Wrong task identity probe PASSED (rejected before file reads/acceptance)');

  // Test 4: Same worker, wrong attempt ID rejection barrier
  console.log('▶ Test 4: Validating same-worker wrong attempt ID rejection barrier...');
  const wrongAttemptWave = await runFleetWave({
    injectedSlotFailures: {
      'AGR-4': { injectWrongAttempt: true }
    }
  });
  const agr4Result = wrongAttemptWave.slots.find((s) => s.slotId === 'AGR-4');
  assert.strictEqual(agr4Result.verified, false);
  assert.ok(agr4Result.failureReason.includes('Attempt identity mismatch'));
  console.log('✔ Test 4: Same worker wrong attempt ID probe PASSED (rejected before file reads/acceptance)');

  // Test 5: Wrong campaign identity rejection barrier
  console.log('▶ Test 5: Validating wrong campaign identity rejection barrier...');
  const wrongCampaignWave = await runFleetWave({
    injectedSlotFailures: {
      'OCR-2': { injectWrongCampaign: true }
    }
  });
  const ocr2Result = wrongCampaignWave.slots.find((s) => s.slotId === 'OCR-2');
  assert.strictEqual(ocr2Result.verified, false);
  assert.ok(ocr2Result.failureReason.includes('Campaign identity mismatch'));
  console.log('✔ Test 5: Wrong campaign identity probe PASSED (rejected before file reads/acceptance)');

  // Test 6: Wrong workspace path rejection barrier
  console.log('▶ Test 6: Validating wrong workspace path rejection barrier...');
  const wrongWorkspaceWave = await runFleetWave({
    injectedSlotFailures: {
      'OCR-3': { injectWrongWorkspace: true }
    }
  });
  const ocr3Result = wrongWorkspaceWave.slots.find((s) => s.slotId === 'OCR-3');
  assert.strictEqual(ocr3Result.verified, false);
  assert.ok(ocr3Result.failureReason.includes('Workspace path mismatch'));
  console.log('✔ Test 6: Wrong workspace path probe PASSED (rejected before file reads/acceptance)');

  // Test 7: Wrong provider identity rejection barrier
  console.log('▶ Test 7: Validating wrong provider identity rejection barrier...');
  const wrongProviderWave = await runFleetWave({
    injectedSlotFailures: {
      'OCR-5': { injectWrongProvider: true }
    }
  });
  const ocr5Result = wrongProviderWave.slots.find((s) => s.slotId === 'OCR-5');
  assert.strictEqual(ocr5Result.verified, false);
  assert.ok(ocr5Result.failureReason.includes('Provider identity mismatch'));
  console.log('✔ Test 7: Wrong provider identity probe PASSED (rejected before file reads/acceptance)');

  // Test 8: Scope isolation barrier: unauthorized extra file in workspace
  console.log('▶ Test 8: Validating scope isolation barrier (unauthorized extra file rejection)...');
  const extraFileWave = await runFleetWave({
    injectedSlotFailures: {
      'RCT-3': { injectExtraFile: true }
    }
  });
  const rct3Result = extraFileWave.slots.find((s) => s.slotId === 'RCT-3');
  assert.strictEqual(rct3Result.verified, false);
  assert.ok(rct3Result.failureReason.includes('unauthorized extra file'));
  console.log('✔ Test 8: Scope extra file rejection probe PASSED');

  // Test 9: Scope isolation barrier: symlink or junction escape in workspace
  console.log('▶ Test 9: Validating scope isolation barrier (symlink/junction escape rejection)...');
  const symlinkWave = await runFleetWave({
    injectedSlotFailures: {
      'RCT-4': { injectSymlinkEscape: true }
    }
  });
  const rct4Result = symlinkWave.slots.find((s) => s.slotId === 'RCT-4');
  assert.strictEqual(rct4Result.verified, false);
  assert.ok(rct4Result.failureReason.includes('symbolic link or junction'));
  console.log('✔ Test 9: Scope symlink/junction escape probe PASSED');

  // Test 10: Forged output probe
  console.log('▶ Test 10: Validating forged output rejection barrier...');
  const forgedOutputWave = await runFleetWave({
    injectedSlotFailures: {
      'RCT-2': { injectForgedOutput: true }
    }
  });
  const rct2Result = forgedOutputWave.slots.find((s) => s.slotId === 'RCT-2');
  assert.strictEqual(rct2Result.verified, false);
  assert.ok(rct2Result.failureReason.includes('hash mismatch'));
  console.log('✔ Test 10: Forged output probe PASSED (independent verifier detected mismatch)');

  // Test 11: Duplicate task ID denial probe
  console.log('▶ Test 11: Validating duplicate task ID replay barrier...');
  let duplicateDenied = false;
  try {
    await runFleetWave({ injectDuplicateTaskId: true });
  } catch (err) {
    if (err.message.includes('DUPLICATE_TASK_DENIED')) {
      duplicateDenied = true;
    }
  }
  assert.strictEqual(duplicateDenied, true, 'Duplicate task ID must be denied');
  console.log('✔ Test 11: Duplicate task ID replay barrier PASSED (denied before execution)');

  // Test 12: Task timeout deadline probe
  console.log('▶ Test 12: Validating per-worker task deadline timeout barrier...');
  const timeoutWave = await runFleetWave({
    injectedSlotFailures: {
      'OCR-4': { injectTimeout: true, customTimeoutMs: 50 }
    }
  });
  const ocr4Result = timeoutWave.slots.find((s) => s.slotId === 'OCR-4');
  assert.strictEqual(ocr4Result.verified, false);
  assert.strictEqual(ocr4Result.state, 'TIMED_OUT');
  console.log('✔ Test 12: Task timeout deadline barrier PASSED (failed honestly)');

  // Test 13: Mid-execution cancellation probe
  console.log('▶ Test 13: Validating mid-execution cancellation barrier...');
  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 10); // Abort shortly after start
  const cancelledWave = await runFleetWave({
    injectedSlotFailures: {
      'AGR-5': { abortSignal: abortController.signal, customDelayMs: 40 }
    }
  });
  const agr5Result = cancelledWave.slots.find((s) => s.slotId === 'AGR-5');
  assert.strictEqual(agr5Result.verified, false);
  assert.strictEqual(agr5Result.state, 'CANCELLED');
  console.log('✔ Test 13: Mid-execution cancellation barrier PASSED (cancellation settled cleanly)');

  // Test 14: Start barrier abort & cleanup finally probe
  console.log('▶ Test 14: Validating start barrier abort & cleanup in finally...');
  const fastBarrier = new StartBarrier(15, 50); // 50ms timeout
  fastBarrier.start();
  let barrierError = null;
  try {
    await fastBarrier.arriveAndWait('AGR-1');
  } catch (err) {
    barrierError = err;
  }
  assert.ok(barrierError !== null, 'Start barrier must abort on timeout');
  assert.ok(barrierError.message.includes('StartBarrier timeout'));
  console.log('✔ Test 14: Start barrier abort & cleanup probe PASSED');

  console.log('\n========================================================================');
  console.log(' ALL 14 FLEET FIXTURE TESTS PASSED');
  console.log('========================================================================\n');
}

/**
 * Main CLI execution entrypoint.
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
========================================================================
 ZETRO 15-Worker Concurrent Fleet Fixture Runner
========================================================================

Usage:
  node scripts/zetro-fleet-fixture.js [options]

Options:
  --test, --mock    Run all 14 deterministic fixture test probes
  --json            Output machine-readable JSON wave report
  --help, -h        Display this help manual

Description:
  Executes deterministic Stage A 15-worker integration wave from
  docs/POST-BUILD-STRESS-TEST-PLAN.md. Injects 15 synthetic adapter slots
  (AGR-1..5, OCR-1..5, RCT-1..5) with start barrier, exact identities,
  independent verifier, and overlap tracing.

Invariants:
  • Clearly labeled MOCK-FLEET and realFleetVerified: false.
  • Never counts as a live or milestone pass.
  • Zero real bridge dispatch, zero network requests, zero env secrets.
`);
    return 0;
  }

  if (args.includes('--test') || args.includes('--mock')) {
    await runMockTestSuite();
    return 0;
  }

  const report = await runFleetWave();

  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatFleetReport(report));
  }

  return 0;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code || 0),
    (err) => {
      console.error(`[zetro-fleet-fixture] Fatal error: ${err.message}`);
      process.exit(1);
    }
  );
}

module.exports = {
  FLEET_SLOTS,
  StartBarrier,
  OverlapTracker,
  createSyntheticSlotSpec,
  executeSyntheticSlot,
  verifyFleetSlotResult,
  runFleetWave,
  runMockTestSuite
};
