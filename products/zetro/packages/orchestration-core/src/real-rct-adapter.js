import { RctAdapterPort } from './rct-adapter-port.js';
import { States, Bounds } from './types.js';
import {
  createSnapshot,
  runAssignment,
  sha256,
  createWorkspaceAdmission,
  validateWorkspaceAdmission,
  validateExecutionIdentity
} from '../../rct-runtime/src/index.js';
import { RctPolicyPort } from '../../policy/src/index.js';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const RESERVED_RUNTIME_OPTIONS = new Set([
  'workspaceAdmission',
  'admission',
  'executionIdentity',
  'taskId',
  'attemptId',
  'workspaceId',
  'sourceRoot',
  'sourceBaselineRoot',
  'sourceBaselineHash',
  'canonicalRoot',
  'isolated',
  'isolatedRoot',
  'signal',
  'abortSignal',
  'policyPort',
  'authority'
]);

/**
 * Normalizes relative path to forward slashes without leading/trailing slashes or dot segments.
 *
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
  if (typeof p !== 'string') return '';
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

/**
 * Computes deterministic composite SHA-256 hash for multi-file baselines.
 * Serializes normalized entries sorted alphabetically as `path:hash\n...`.
 *
 * @param {Record<string, string>} sourceHashes
 * @returns {string} SHA-256 hex digest
 */
export function computeCompositeSourceHash(sourceHashes) {
  if (!sourceHashes || typeof sourceHashes !== 'object' || Array.isArray(sourceHashes)) {
    throw new Error('sourceHashes must be an object');
  }
  const entries = Object.entries(sourceHashes)
    .map(([k, v]) => [normalizePath(k), typeof v === 'string' ? v.trim() : ''])
    .sort(([a], [b]) => a[0].localeCompare(b[0]));
  const serialized = entries.map(([k, v]) => `${k}:${v}`).join('\n');
  return sha256(Buffer.from(serialized, 'utf8'));
}

/**
 * Authoritative baseline proof validation.
 * Enforces complete canonical admitted file/hash coverage against actual snapshot sourceHashes.
 * Strictly rejects:
 * - Empty proof (empty sourceHashes object or empty scalar sourceHash string)
 * - Missing proof (neither sourceHashes nor sourceHash provided)
 * - Unknown map entries (paths in proof not present in admitted files)
 * - Incomplete proof (admitted files missing from proof)
 * - Duplicate/conflicting proof (mismatch between sourceHashes and scalar sourceHash)
 * - Multifile scalar partial matches (multifile scalar MUST be exact composite only)
 *
 * @param {import('./types.js').TaskEnvelope} envelope
 * @param {{ files?: string[], sourceHashes: Record<string, string> }} snapshot
 * @returns {boolean} true if baseline validation passes; throws descriptive Error otherwise.
 */
export function validateSourceBaseline(envelope, snapshot) {
  if (!snapshot || !snapshot.sourceHashes) {
    throw new Error('Snapshot source hashes unavailable for baseline verification');
  }

  const rawSnapshotFiles = snapshot.files || Object.keys(snapshot.sourceHashes);
  const snapshotFiles = rawSnapshotFiles.map(normalizePath);
  if (!Array.isArray(snapshotFiles) || snapshotFiles.length === 0) {
    throw new Error('Snapshot contains no admitted files');
  }

  const rawSourceHashes = envelope.sourceHashes;
  const rawSourceHash = envelope.sourceHash;

  const hasSourceHashes = rawSourceHashes !== undefined && rawSourceHashes !== null;
  const hasSourceHash = rawSourceHash !== undefined && rawSourceHash !== null;

  // 1. Missing proof: neither provided
  if (!hasSourceHashes && !hasSourceHash) {
    throw new Error('Missing source baseline proof: envelope must specify complete sourceHashes or sourceHash');
  }

  let sourceHashesMap = null;

  // 2. Validate sourceHashes map if provided
  if (hasSourceHashes) {
    if (typeof rawSourceHashes !== 'object' || Array.isArray(rawSourceHashes)) {
      throw new Error('Invalid source baseline proof: sourceHashes must be an object');
    }
    const rawKeys = Object.keys(rawSourceHashes);
    if (rawKeys.length === 0) {
      throw new Error('Empty source baseline proof: sourceHashes cannot be empty');
    }

    sourceHashesMap = {};
    for (const [rawK, rawV] of Object.entries(rawSourceHashes)) {
      const cleanK = normalizePath(rawK);
      if (!cleanK) {
        throw new Error('Invalid path in sourceHashes: path cannot be empty');
      }
      if (typeof rawV !== 'string' || !rawV.trim()) {
        throw new Error(`Invalid hash value in source baseline proof for '${rawK}'`);
      }
      const trimmedV = rawV.trim();

      // Check duplicate conflict within raw keys
      if (sourceHashesMap[cleanK] !== undefined && sourceHashesMap[cleanK] !== trimmedV) {
        throw new Error(`Conflicting duplicate entries in source baseline proof for '${cleanK}'`);
      }

      // Check unknown map entry: path must be an admitted file in snapshot
      if (snapshot.sourceHashes[cleanK] === undefined) {
        throw new Error(`Unknown entry in source baseline proof: '${cleanK}' is not an admitted file`);
      }

      sourceHashesMap[cleanK] = trimmedV;
    }

    // Require complete canonical coverage: every admitted file must be in sourceHashes
    for (const f of snapshotFiles) {
      if (sourceHashesMap[f] === undefined) {
        throw new Error(`Incomplete source baseline proof: missing hash for admitted file '${f}'`);
      }
      if (sourceHashesMap[f] !== snapshot.sourceHashes[f]) {
        throw new Error(`Source baseline hash mismatch for '${f}': expected '${sourceHashesMap[f]}', got '${snapshot.sourceHashes[f]}'`);
      }
    }
  }

  // 3. Validate sourceHash if provided
  if (hasSourceHash) {
    if (typeof rawSourceHash === 'object' && !Array.isArray(rawSourceHash)) {
      const rawKeys = Object.keys(rawSourceHash);
      if (rawKeys.length === 0) {
        throw new Error('Empty source baseline proof: sourceHash object cannot be empty');
      }
      const objectHashProof = {};
      for (const [rawK, rawV] of Object.entries(rawSourceHash)) {
        const cleanK = normalizePath(rawK);
        if (!cleanK) {
          throw new Error('Invalid path in sourceHash object: path cannot be empty');
        }
        if (typeof rawV !== 'string' || !rawV.trim()) {
          throw new Error(`Invalid hash value in source baseline proof for '${rawK}'`);
        }
        const trimmedV = rawV.trim();

        if (objectHashProof[cleanK] !== undefined && objectHashProof[cleanK] !== trimmedV) {
          throw new Error(`Conflicting duplicate entries in source baseline proof for '${cleanK}'`);
        }

        if (snapshot.sourceHashes[cleanK] === undefined) {
          throw new Error(`Unknown entry in source baseline proof: '${cleanK}' is not an admitted file`);
        }
        objectHashProof[cleanK] = trimmedV;
      }

      for (const f of snapshotFiles) {
        if (objectHashProof[f] === undefined) {
          throw new Error(`Incomplete source baseline proof: missing hash for admitted file '${f}' in sourceHash`);
        }
        if (objectHashProof[f] !== snapshot.sourceHashes[f]) {
          throw new Error(`Source baseline hash mismatch for '${f}': expected '${objectHashProof[f]}', got '${snapshot.sourceHashes[f]}'`);
        }
      }

      if (sourceHashesMap) {
        for (const f of snapshotFiles) {
          if (sourceHashesMap[f] !== objectHashProof[f]) {
            throw new Error(`Conflicting source baseline proof: sourceHashes['${f}'] does not match sourceHash['${f}']`);
          }
        }
      }
    } else if (typeof rawSourceHash === 'string') {
      const scalarHash = rawSourceHash.trim();
      if (!scalarHash) {
        throw new Error('Empty source baseline proof: sourceHash string cannot be empty');
      }

      if (sourceHashesMap) {
        if (snapshotFiles.length === 1) {
          const singleFile = snapshotFiles[0];
          if (sourceHashesMap[singleFile] !== scalarHash) {
            throw new Error(`Conflicting source baseline proof: scalar sourceHash '${scalarHash}' does not match sourceHashes '${sourceHashesMap[singleFile]}'`);
          }
        } else {
          const expectedComposite = computeCompositeSourceHash(sourceHashesMap);
          if (scalarHash !== expectedComposite) {
            throw new Error(`Conflicting source baseline proof: scalar sourceHash '${scalarHash}' does not match composite of sourceHashes '${expectedComposite}'`);
          }
        }
      }

      if (snapshotFiles.length === 1) {
        const singleFile = snapshotFiles[0];
        const actualHash = snapshot.sourceHashes[singleFile];
        if (scalarHash !== actualHash) {
          throw new Error(`Source baseline hash mismatch for '${singleFile}': expected '${scalarHash}', got '${actualHash}'`);
        }
      } else {
        // Multi-file: scalar MUST be exact composite only
        const composite = computeCompositeSourceHash(snapshot.sourceHashes);
        if (scalarHash !== composite) {
          throw new Error(`Source baseline hash mismatch: expected composite '${scalarHash}', got '${composite}'`);
        }
      }
    } else {
      throw new Error('Invalid source baseline proof: sourceHash must be a string or object');
    }
  }

  return true;
}

/**
 * Real RCT Adapter implementing the RctAdapterPort interface.
 * Connects orchestration-core TaskManager with the real rct-runtime offline execution
 * engine using private snapshots and offline/fake model providers.
 */
export class RealRctAdapter extends RctAdapterPort {
  /**
   * @param {Object} options
   * @param {Object} options.provider - Provider instance implementing next()
   * @param {string} [options.sourceRoot] - Default workspace source root if not specified in envelope
   * @param {boolean} [options.autoDisposeSnapshot=false] - Whether to dispose snapshot on completion
   * @param {Object} [options.runtimeOptions] - Extra options passed directly to runAssignment
   * @param {Object} [options.policyPort] - Injected RctPolicyPort instance
   * @param {Object} [options.authority] - Injected authority evaluator
   * @param {Object} [options.policyService] - Injected PolicyService instance
   */
  constructor(options = {}) {
    super();
    this.provider = options.provider;
    this.sourceRoot = options.sourceRoot || null;
    this.autoDisposeSnapshot = options.autoDisposeSnapshot ?? false;
    this.runtimeOptions = options.runtimeOptions || {};
    this.policyPort = options.policyPort || null;
    this.authority = options.authority || null;
    this.policyService = options.policyService || null;
    this.latestSnapshot = null;
    this.latestReceipt = null;
    this.latestAdmission = null;
    this.latestExecutionIdentity = null;
    this.executionHistory = [];
  }

  /**
   * Execute task envelope through real rct-runtime with authoritative WorkspaceAdmission
   * and executionIdentity.
   *
   * Invariants Enforced:
   * 1. Identity is derived strictly from authoritative persisted task, attempt, and workspace.
   * 2. Hostile options cannot overwrite root, attempt, policy, or signal.
   * 3. Authoritative WorkspaceAdmission binds exact canonical snapshot root, source baseline root,
   *    and complete cryptographic baseline hash.
   * 4. Mismatched admission or attempt rejects before any provider execution or tool effects.
   * 5. Shared RctPolicyPort used if compatible and exact trusted grant authority injected;
   *    never invents worker authority.
   *
   * @param {import('./types.js').TaskEnvelope} envelope
   * @param {AbortSignal|Object} [optionsOrSignal]
   * @returns {Promise<import('./types.js').TaskReceipt>}
   */
  async execute(envelope, optionsOrSignal) {
    if (!envelope || typeof envelope !== 'object') {
      throw new Error('Task envelope is required');
    }
    const authoritativeTaskId = envelope.id;
    if (!authoritativeTaskId || typeof authoritativeTaskId !== 'string') {
      throw new Error('envelope.id is required and must be a string');
    }

    const sourceRoot = envelope.workspaceRoot || this.sourceRoot;
    if (!sourceRoot) {
      throw new Error('workspaceRoot is required for RealRctAdapter');
    }
    const canonicalSourceRoot = resolve(sourceRoot);

    // Hostile sourceRoot override checks
    if (this.sourceRoot && resolve(this.sourceRoot) !== canonicalSourceRoot) {
      throw new Error(`Source root mismatch: adapter sourceRoot '${this.sourceRoot}' differs from envelope.workspaceRoot '${envelope.workspaceRoot}'`);
    }
    if (optionsOrSignal?.sourceRoot && resolve(optionsOrSignal.sourceRoot) !== canonicalSourceRoot) {
      throw new Error(`Source root override mismatch: optionsOrSignal.sourceRoot '${optionsOrSignal.sourceRoot}' cannot overwrite authoritative envelope.workspaceRoot '${sourceRoot}'`);
    }
    if (this.runtimeOptions.sourceRoot && resolve(this.runtimeOptions.sourceRoot) !== canonicalSourceRoot) {
      throw new Error(`Source root override mismatch: runtimeOptions.sourceRoot '${this.runtimeOptions.sourceRoot}' cannot overwrite authoritative envelope.workspaceRoot '${sourceRoot}'`);
    }
    if (this.runtimeOptions.sourceBaselineRoot && resolve(this.runtimeOptions.sourceBaselineRoot) !== canonicalSourceRoot) {
      throw new Error(`Source baseline root override mismatch: runtimeOptions.sourceBaselineRoot '${this.runtimeOptions.sourceBaselineRoot}' cannot overwrite authoritative sourceRoot '${sourceRoot}'`);
    }

    // Resolve authoritative attemptId and workspaceId
    const authoritativeAttemptId = optionsOrSignal?.attemptId ||
      envelope.attemptId ||
      optionsOrSignal?.attempt?.attemptId ||
      `${authoritativeTaskId}-att-1`;

    const authoritativeWorkspaceId = optionsOrSignal?.workspaceId ||
      envelope.workspaceId ||
      `ws-${authoritativeTaskId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

    // Hostile identity overrides check
    if (this.runtimeOptions.taskId && this.runtimeOptions.taskId !== authoritativeTaskId) {
      throw new Error(`Task ID mismatch: runtimeOptions.taskId '${this.runtimeOptions.taskId}' cannot overwrite authoritative '${authoritativeTaskId}'`);
    }
    if (this.runtimeOptions.attemptId && this.runtimeOptions.attemptId !== authoritativeAttemptId) {
      throw new Error(`Attempt ID mismatch: runtimeOptions.attemptId '${this.runtimeOptions.attemptId}' cannot overwrite authoritative '${authoritativeAttemptId}'`);
    }
    if (this.runtimeOptions.workspaceId && this.runtimeOptions.workspaceId !== authoritativeWorkspaceId) {
      throw new Error(`Workspace ID mismatch: runtimeOptions.workspaceId '${this.runtimeOptions.workspaceId}' cannot overwrite authoritative '${authoritativeWorkspaceId}'`);
    }

    if (optionsOrSignal?.executionIdentity) {
      const reqId = optionsOrSignal.executionIdentity;
      if (reqId.taskId && reqId.taskId !== authoritativeTaskId) {
        throw new Error(`Execution identity taskId mismatch: current '${reqId.taskId}' does not match authoritative '${authoritativeTaskId}'`);
      }
      if (reqId.attemptId && reqId.attemptId !== authoritativeAttemptId) {
        throw new Error(`Execution identity attemptId mismatch (stale attempt rejection): current '${reqId.attemptId}' does not match authoritative '${authoritativeAttemptId}'`);
      }
      if (reqId.workspaceId && reqId.workspaceId !== authoritativeWorkspaceId) {
        throw new Error(`Execution identity workspaceId mismatch: current '${reqId.workspaceId}' does not match authoritative '${authoritativeWorkspaceId}'`);
      }
    }

    if (this.runtimeOptions.executionIdentity) {
      const reqId = this.runtimeOptions.executionIdentity;
      if (reqId.taskId && reqId.taskId !== authoritativeTaskId) {
        throw new Error(`Execution identity taskId mismatch: runtimeOptions taskId '${reqId.taskId}' cannot overwrite authoritative '${authoritativeTaskId}'`);
      }
      if (reqId.attemptId && reqId.attemptId !== authoritativeAttemptId) {
        throw new Error(`Execution identity attemptId mismatch (stale attempt rejection): runtimeOptions attemptId '${reqId.attemptId}' cannot overwrite authoritative '${authoritativeAttemptId}'`);
      }
      if (reqId.workspaceId && reqId.workspaceId !== authoritativeWorkspaceId) {
        throw new Error(`Execution identity workspaceId mismatch: runtimeOptions workspaceId '${reqId.workspaceId}' cannot overwrite authoritative '${authoritativeWorkspaceId}'`);
      }
    }

    const abortSignal = optionsOrSignal instanceof AbortSignal
      ? optionsOrSignal
      : (optionsOrSignal?.signal || optionsOrSignal?.abortSignal || null);

    this.executionHistory.push({
      id: envelope.id,
      agent: envelope.agent,
      timestamp: Date.now()
    });

    if (abortSignal?.aborted) {
      const abortErr = new Error('AbortError');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    // 1. Create isolated private snapshot from sourceRoot
    const allowedPaths = Array.isArray(envelope.allowedPaths) ? envelope.allowedPaths : [];
    if (allowedPaths.length === 0) {
      throw new Error('allowedPaths must be a non-empty array of file paths');
    }

    const snapshot = await createSnapshot(sourceRoot, allowedPaths);
    this.latestSnapshot = snapshot;
    const canonicalSnapshotRoot = resolve(snapshot.root);

    // Hostile canonicalRoot override check
    if (optionsOrSignal?.canonicalRoot && resolve(optionsOrSignal.canonicalRoot) !== canonicalSnapshotRoot) {
      if (this.autoDisposeSnapshot) await snapshot.dispose().catch(() => {});
      throw new Error(`Canonical root override mismatch: optionsOrSignal.canonicalRoot '${optionsOrSignal.canonicalRoot}' cannot overwrite snapshot root '${canonicalSnapshotRoot}'`);
    }
    if (this.runtimeOptions.canonicalRoot && resolve(this.runtimeOptions.canonicalRoot) !== canonicalSnapshotRoot) {
      if (this.autoDisposeSnapshot) await snapshot.dispose().catch(() => {});
      throw new Error(`Canonical root override mismatch: runtimeOptions.canonicalRoot '${this.runtimeOptions.canonicalRoot}' cannot overwrite snapshot root '${canonicalSnapshotRoot}'`);
    }

    // 2. Authoritative Admitted Baseline Validation BEFORE provider execution
    // Enforces complete canonical coverage, rejects empty/unknown/missing/duplicate/conflicting proof.
    // Throws on mismatch, guaranteeing ZERO provider calls.
    try {
      validateSourceBaseline(envelope, snapshot);
    } catch (baselineErr) {
      if (this.autoDisposeSnapshot) {
        await snapshot.dispose().catch(() => {});
      }
      throw baselineErr;
    }

    // 3. Compute Baseline Hash & Wire Authoritative Workspace Admission & Execution Identity
    const snapshotFileKeys = Object.keys(snapshot.sourceHashes);
    const baselineHash = snapshotFileKeys.length === 1
      ? snapshot.sourceHashes[snapshotFileKeys[0]]
      : computeCompositeSourceHash(snapshot.sourceHashes);

    const normalizedAllowedPaths = allowedPaths.map(normalizePath).sort();
    const readPaths = Array.isArray(envelope.scope?.readPaths)
      ? envelope.scope.readPaths.map(normalizePath).sort()
      : [...normalizedAllowedPaths];
    const writePaths = Array.isArray(envelope.scope?.writePaths)
      ? envelope.scope.writePaths.map(normalizePath).sort()
      : [...normalizedAllowedPaths];

    let admission;
    const passedAdmission = optionsOrSignal?.workspaceAdmission ||
      optionsOrSignal?.admission ||
      this.runtimeOptions.workspaceAdmission ||
      this.runtimeOptions.admission;

    if (passedAdmission) {
      const validated = validateWorkspaceAdmission(passedAdmission, {
        throwOnError: true,
        verifyDigest: Boolean(passedAdmission.admissionDigest)
      });

      if (validated.taskId !== authoritativeTaskId) {
        if (this.autoDisposeSnapshot) await snapshot.dispose().catch(() => {});
        throw new Error(`Workspace admission taskId mismatch: expected '${authoritativeTaskId}', got '${validated.taskId}'`);
      }
      if (validated.attemptId !== authoritativeAttemptId) {
        if (this.autoDisposeSnapshot) await snapshot.dispose().catch(() => {});
        throw new Error(`Execution identity attemptId mismatch (stale attempt rejection): current '${authoritativeAttemptId}' does not match admitted '${validated.attemptId}'`);
      }
      if (validated.workspaceId !== authoritativeWorkspaceId) {
        if (this.autoDisposeSnapshot) await snapshot.dispose().catch(() => {});
        throw new Error(`Workspace admission workspaceId mismatch: expected '${authoritativeWorkspaceId}', got '${validated.workspaceId}'`);
      }
      if (resolve(validated.canonicalRoot) !== canonicalSnapshotRoot) {
        if (this.autoDisposeSnapshot) await snapshot.dispose().catch(() => {});
        throw new Error(`Workspace admission canonicalRoot mismatch: expected '${canonicalSnapshotRoot}', got '${resolve(validated.canonicalRoot)}'`);
      }
      if (resolve(validated.sourceBaselineRoot) !== canonicalSourceRoot) {
        if (this.autoDisposeSnapshot) await snapshot.dispose().catch(() => {});
        throw new Error(`Workspace admission sourceBaselineRoot mismatch: expected '${canonicalSourceRoot}', got '${resolve(validated.sourceBaselineRoot)}'`);
      }
      if (validated.sourceBaselineHash && validated.sourceBaselineHash.toLowerCase() !== baselineHash.toLowerCase()) {
        if (this.autoDisposeSnapshot) await snapshot.dispose().catch(() => {});
        throw new Error(`Workspace admission sourceBaselineHash mismatch: expected '${baselineHash}', got '${validated.sourceBaselineHash}'`);
      }

      if (validated.scope) {
        const admittedPaths = new Set([
          ...(validated.scope.readPaths || []),
          ...(validated.scope.writePaths || []),
          ...(validated.scope.createPaths || [])
        ]);
        for (const p of normalizedAllowedPaths) {
          if (!admittedPaths.has(p)) {
            if (this.autoDisposeSnapshot) await snapshot.dispose().catch(() => {});
            throw new Error(`Path '${p}' is outside workspace admission scope`);
          }
        }
      }

      admission = validated;
    } else {
      admission = createWorkspaceAdmission({
        workspaceId: authoritativeWorkspaceId,
        taskId: authoritativeTaskId,
        attemptId: authoritativeAttemptId,
        canonicalRoot: canonicalSnapshotRoot,
        sourceBaselineRoot: canonicalSourceRoot,
        sourceBaselineHash: baselineHash,
        scope: {
          readPaths,
          writePaths,
          createPaths: []
        },
        admittedAt: Date.now(),
        admittedBy: 'coordinator'
      });
    }

    const executionIdentity = validateExecutionIdentity({
      taskId: authoritativeTaskId,
      attemptId: authoritativeAttemptId,
      workspaceId: authoritativeWorkspaceId
    });

    this.latestAdmission = admission;
    this.latestExecutionIdentity = executionIdentity;

    // 4. PolicyPort and Authority Resolution (never invent worker authority)
    let trustedPolicyPort = optionsOrSignal?.policyPort || this.policyPort || null;
    let trustedAuthority = optionsOrSignal?.authority || this.authority || null;
    const policyService = optionsOrSignal?.policyService || this.policyService || null;

    if (!trustedPolicyPort && policyService) {
      trustedPolicyPort = new RctPolicyPort(policyService, { workspaceAdmission: admission });
    }

    if (trustedPolicyPort) {
      if (trustedPolicyPort.admittedWorkspace) {
        const portWs = trustedPolicyPort.admittedWorkspace;
        if (portWs.taskId && portWs.taskId !== authoritativeTaskId) {
          if (this.autoDisposeSnapshot) await snapshot.dispose().catch(() => {});
          throw new Error(`PolicyPort workspace admission taskId mismatch: '${portWs.taskId}' vs '${authoritativeTaskId}'`);
        }
        if (portWs.attemptId && portWs.attemptId !== authoritativeAttemptId) {
          if (this.autoDisposeSnapshot) await snapshot.dispose().catch(() => {});
          throw new Error(`PolicyPort workspace admission attemptId mismatch: '${portWs.attemptId}' vs '${authoritativeAttemptId}'`);
        }
      } else {
        trustedPolicyPort.admittedWorkspace = admission;
        trustedPolicyPort.admittedWorkspaceRoot = admission.canonicalRoot;
        trustedPolicyPort.admittedSourceBaselineRoot = admission.sourceBaselineRoot;
      }
    }

    try {
      // 5. Prepare RCT assignment from envelope
      let checks = [];
      if (Array.isArray(envelope.rctChecks) && envelope.rctChecks.length > 0) {
        checks = envelope.rctChecks;
      } else if (Array.isArray(envelope.checks) && envelope.checks.length > 0) {
        checks = envelope.checks;
      } else {
        // Fallback: checks derived from envelope.declaredChecks or paths
        const declared = RctAdapterPort.getRequiredCheckIds(envelope);
        checks = declared.map((d, i) => ({
          type: 'contains',
          path: allowedPaths[i % allowedPaths.length],
          text: d
        }));
      }

      const budget = envelope.budget || {};
      const assignment = {
        taskId: authoritativeTaskId,
        objective: envelope.objective || envelope.prompt || 'Execute task in isolated workspace',
        acceptance: envelope.acceptance || 'All checks pass',
        allowedPaths,
        checks,
        budget: {
          maxTurns: Math.min(budget.maxTurns || 6, 20),
          maxInputTokens: Math.min(budget.maxInputTokens || 10000, 100000),
          maxOutputTokens: Math.min(budget.maxOutputTokens || 5000, 100000),
          maxPromptChars: Math.min(budget.maxPromptChars || 20000, 100000),
          maxReadBytes: Math.min(budget.maxReadBytes || 16384, 65536),
          maxWriteBytes: Math.min(budget.maxWriteBytes || 16384, 65536),
          maxWallMs: Math.min(envelope.deadlineMs || budget.maxWallMs || 30000, 300000)
        }
      };

      // 6. Wrap provider to honor cancellation signal and guarantee zero subsequent tool effects
      const provider = this.provider;
      const wrappedProvider = {
        name: provider?.name || 'offline-provider',
        async next(params) {
          if (abortSignal?.aborted) {
            const err = new Error('AbortError');
            err.name = 'AbortError';
            throw err;
          }

          return await new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => {
              if (settled) return;
              settled = true;
              const err = new Error('AbortError');
              err.name = 'AbortError';
              reject(err);
            };

            if (abortSignal?.aborted) {
              onAbort();
              return;
            }

            abortSignal?.addEventListener('abort', onAbort, { once: true });

            Promise.resolve(provider.next({ ...params, signal: abortSignal, abortSignal }))
              .then(res => {
                if (settled) return;
                settled = true;
                abortSignal?.removeEventListener('abort', onAbort);
                if (abortSignal?.aborted) {
                  onAbort();
                } else {
                  resolve(res);
                }
              })
              .catch(err => {
                if (settled) return;
                settled = true;
                abortSignal?.removeEventListener('abort', onAbort);
                reject(err);
              });
          });
        }
      };

      // Strip reserved keys from runtimeOptions so hostile options cannot overwrite root/attempt/policy/signal
      const safeRuntimeOptions = {};
      for (const [k, v] of Object.entries(this.runtimeOptions)) {
        if (!RESERVED_RUNTIME_OPTIONS.has(k)) {
          safeRuntimeOptions[k] = v;
        }
      }

      // 7. Run assignment against isolated snapshot with public signal options & authoritative admission
      let rctReceipt;
      try {
        rctReceipt = await runAssignment(
          assignment,
          wrappedProvider,
          snapshot.root,
          {
            ...safeRuntimeOptions,
            isolated: true,
            signal: abortSignal,
            abortSignal: abortSignal,
            workspaceAdmission: admission,
            admission,
            executionIdentity,
            sourceRoot: canonicalSourceRoot,
            sourceBaselineHash: baselineHash,
            policyPort: trustedPolicyPort,
            authority: trustedAuthority
          }
        );
      } catch (runErr) {
        if (runErr.name === 'AbortError' || abortSignal?.aborted) {
          const abortErr = new Error('AbortError');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        throw runErr;
      }

      // Consume AGR2 receipt from signal port
      this.latestReceipt = rctReceipt;

      // 8. Map RCT receipt to conformant TaskReceipt for TaskManager & RctAdapterPort
      const allRctChecksPassed = Array.isArray(rctReceipt?.checks) &&
        rctReceipt.checks.length > 0 &&
        rctReceipt.checks.every(c => c.passed === true);

      let state;
      if (abortSignal?.aborted) {
        state = States.CANCELLED;
      } else if (rctReceipt?.state === 'review_ready') {
        state = States.COMPLETED;
      } else if (rctReceipt?.state === 'failed' || !allRctChecksPassed) {
        state = States.FAILED;
      } else {
        state = States.UNKNOWN;
      }

      // Map checks using declared check IDs when available, preserving exact check identity
      const declaredCheckIds = RctAdapterPort.getRequiredCheckIds(envelope);
      const mappedChecks = (rctReceipt?.checks || []).map((c, i) => {
        const checkName = declaredCheckIds[i] || c.path || `check-${i}`;
        return {
          name: checkName,
          passed: Boolean(c.passed),
          type: c.type,
          path: c.path
        };
      });

      const summary = (rctReceipt?.workerSummary && typeof rctReceipt.workerSummary === 'string' && rctReceipt.workerSummary.trim())
        ? rctReceipt.workerSummary.slice(0, Bounds.MAX_STRING_CHARS)
        : (state === States.COMPLETED
          ? 'RCT worker reported completion'
          : (state === States.CANCELLED ? 'Execution cancelled by operator request' : 'RCT execution ended'));

      const uncertainty = (abortSignal?.aborted || rctReceipt?.failureReason === 'aborted')
        ? 'Cancelled: execution aborted by cancellation signal'
        : (rctReceipt?.remoteUsageUncertain ? 'Usage uncertain: remote transport error occurred' : 'None');

      const changedFiles = Array.isArray(rctReceipt?.changedPaths) ? rctReceipt.changedPaths : [];
      const evidenceRefs = (rctReceipt?.patches || []).map((_, idx) => `evidence/patch-${idx}.diff`);
      if (evidenceRefs.length === 0 && changedFiles.length > 0) {
        evidenceRefs.push(`evidence/${envelope.id}-diff.patch`);
      }

      const conformantReceipt = {
        id: envelope.id,
        agent: envelope.agent,
        state,
        summary,
        uncertainty,
        changedFiles,
        checks: mappedChecks,
        evidenceRefs,
        snapshot,
        workspaceAdmission: admission,
        executionIdentity,
        rawRctReceipt: rctReceipt
      };

      return conformantReceipt;
    } catch (err) {
      if (this.autoDisposeSnapshot && snapshot) {
        await snapshot.dispose().catch(() => {});
      }
      if (err.name === 'AbortError' || abortSignal?.aborted) {
        const abortErr = new Error('AbortError');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      throw err;
    } finally {
      if (this.autoDisposeSnapshot && this.latestSnapshot) {
        await this.latestSnapshot.dispose().catch(() => {});
      }
    }
  }

  async dispose() {
    if (this.latestSnapshot) {
      await this.latestSnapshot.dispose().catch(() => {});
      this.latestSnapshot = null;
    }
  }
}

/**
 * Creates an independent RCT verifier that audits the snapshot workspace directly,
 * verifies source unchanged against authoritative baseline, and checks exact assigned
 * criteria outside worker claims.
 *
 * Missing machine-verifiable criteria are strictly rejected and never substituted with worker claims.
 *
 * @param {Object} [options]
 * @param {string} [options.name='independent-rct-verifier']
 * @returns {{ name: string, verify: Function }}
 */
export function createIndependentRctVerifier(options = {}) {
  const verifierName = options.name || 'independent-rct-verifier';

  return {
    name: verifierName,
    async verify(envelope, receipt, context) {
      const snapshot = receipt?.snapshot || options.snapshot;
      if (!snapshot) {
        return {
          taskId: envelope.id,
          attemptId: context?.attemptId,
          verified: false,
          checks: [],
          error: 'Snapshot not available for independent verification'
        };
      }

      // 1. Independent check: Verify that original source directory remains completely unchanged
      const sourceUnchanged = await snapshot.sourceUnchanged();
      if (!sourceUnchanged) {
        return {
          taskId: envelope.id,
          attemptId: context?.attemptId,
          verified: false,
          checks: [],
          error: 'Source integrity violation: source files were modified directly'
        };
      }

      // 2. Authoritative baseline validation: source files must match baseline proof
      try {
        validateSourceBaseline(envelope, snapshot);
      } catch (baselineErr) {
        return {
          taskId: envelope.id,
          attemptId: context?.attemptId,
          verified: false,
          checks: [],
          error: baselineErr.message
        };
      }

      // 3. Strict rejection of missing criteria:
      // Independent verifier strictly requires explicit machine-verifiable criteria.
      // Worker claims from receipt.checks are NEVER substituted!
      const assignedChecks = envelope.checks || envelope.rctChecks || [];
      if (!Array.isArray(assignedChecks) || assignedChecks.length === 0) {
        return {
          taskId: envelope.id,
          attemptId: context?.attemptId,
          verified: false,
          checks: [],
          error: 'No machine-verifiable assignment criteria declared: independent verifier strictly rejects missing criteria and never substitutes worker claims'
        };
      }

      const requiredCheckIds = RctAdapterPort.getRequiredCheckIds(envelope);
      const verifiedChecks = [];

      for (let i = 0; i < assignedChecks.length; i++) {
        const check = assignedChecks[i];
        const checkId = requiredCheckIds[i] || check.name || check.path || `check-${i}`;

        try {
          const filePath = join(snapshot.root, ...check.path.split('/'));
          const content = await readFile(filePath, 'utf8');

          let passed = false;
          if (check.type === 'equals') {
            passed = content === check.text;
          } else if (check.type === 'contains') {
            passed = content.includes(check.text);
          }

          verifiedChecks.push({
            name: checkId,
            passed,
            sha256: sha256(Buffer.from(content)),
            path: check.path
          });
        } catch (err) {
          verifiedChecks.push({
            name: checkId,
            passed: false,
            error: err.message
          });
        }
      }

      const allChecksPass = verifiedChecks.length > 0 && verifiedChecks.every(c => c.passed === true);
      const verified = sourceUnchanged && allChecksPass;

      return {
        taskId: envelope.id,
        attemptId: context?.attemptId,
        verified,
        checks: verifiedChecks,
        sourceUnchanged,
        sourceHashes: snapshot.sourceHashes,
        verifier: verifierName
      };
    }
  };
}
