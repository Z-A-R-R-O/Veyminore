/**
 * @file context-package.js
 * Versioned Fresh-Worker Context Package & Acknowledgment for ZETRO IFZ.
 *
 * Implements:
 * - 8-step boot package in documented order
 * - Strict structural safety: rejects cycles, accessors, unsafe prototypes, excessive nesting,
 *   oversized collections, and oversized UTF-8 byte values
 * - Structural rejection of secrets, credentials, .env material, private reasoning/model-thinking,
 *   and full-transcript payloads at every nested level
 * - Strict non-widening of destination, workspace, paths, effects, and budgets
 * - Acknowledgment as admission evidence only (never dispatch, completion, or verification)
 */

import { getPreset, applyPreset } from './presets.js';
import {
  createCharter,
  createWorkerKnowledge,
  createProjectContext,
  createTaskPackage
} from './master-prompt.js';

export class ContextPackageError extends Error {
  constructor(message, details = {}) {
    super(`[IFZ:ContextPackage] ${message}`);
    this.name = 'ContextPackageError';
    this.details = details;
  }
}

export class ContextPackageBoundsError extends ContextPackageError {
  constructor(message, details = {}) {
    super(`Bounds exceeded: ${message}`, details);
    this.name = 'ContextPackageBoundsError';
  }
}

export class ContextPackageSecurityError extends ContextPackageError {
  constructor(message, details = {}) {
    super(`Security policy violation: ${message}`, details);
    this.name = 'ContextPackageSecurityError';
  }
}

export class AcknowledgmentVerificationError extends ContextPackageError {
  constructor(message, details = {}) {
    super(`Acknowledgment failed verification: ${message}`, details);
    this.name = 'AcknowledgmentVerificationError';
  }
}

// Strict limits and bounds
export const DEFAULT_MAX_PACKAGE_BYTES = 65536; // 64 KB
export const HARD_CEILING_PACKAGE_BYTES = 131072; // 128 KB
export const MAX_STRING_BYTES = 16384; // 16 KB per string value
export const MAX_NESTING_DEPTH = 10;
export const MAX_ARRAY_LENGTH = 100;
export const MAX_OBJECT_KEYS = 100;

export const MAX_ENTRY_BOUNDS = Object.freeze({
  maxOwnedPaths: 50,
  maxRelevantFiles: 50,
  maxAcceptedWork: 50,
  maxPendingWork: 50,
  maxChecks: 20,
  maxTools: 30
});

// Forbidden secret keys in objects (structural rejection)
const FORBIDDEN_SECRET_KEYS = new Set([
  'secret',
  'password',
  'token',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'credential',
  'credentials',
  'auth',
  'authorization',
  'cookie',
  'sessionsecret',
  'session_secret',
  'accesskey',
  'access_key',
  'secretkey',
  'secret_key',
  'clientsecret',
  'client_secret',
  'authtoken',
  'auth_token',
  'bearer',
  'privatetoken',
  'private_token',
  'refreshtoken',
  'refresh_token'
]);

// Forbidden private reasoning keys in objects (structural rejection)
const FORBIDDEN_REASONING_KEYS = new Set([
  'thinking',
  'privatereasoning',
  'private_reasoning',
  'internalreasoning',
  'internal_reasoning',
  'scratchpad',
  'hiddenthoughts',
  'hidden_thoughts',
  'thought',
  'thoughts',
  'chainofthought',
  'chain_of_thought',
  'modelthinking',
  'model_thinking'
]);

// Forbidden full transcript keys in objects (structural rejection)
const FORBIDDEN_TRANSCRIPT_KEYS = new Set([
  'transcript',
  'fulltranscript',
  'full_transcript',
  'uncontrolledtranscript',
  'uncontrolled_transcript',
  'rawturns',
  'raw_turns',
  'conversationhistory',
  'conversation_history'
]);

// Secret regex patterns (structural rejection)
const SECRET_PATTERNS = [
  /bearer\s+[a-zA-Z0-9_\-\.]{16,}/i,
  /ghp_[a-zA-Z0-9]{36}/,
  /gho_[a-zA-Z0-9]{36}/,
  /sk-[a-zA-Z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----/
];

// .env content patterns (structural rejection)
const ENV_FILE_LINE_PATTERN = /^[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL|AUTH|DATABASE|URL|PASS)[A-Z0-9_]*\s*=\s*.+$/im;

// Private reasoning XML tag patterns (structural rejection)
const THINKING_TAG_PATTERN = /<(?:thinking|thought|scratchpad)>[\s\S]*?<\/(?:thinking|thought|scratchpad)>/i;

/**
 * Deep-freeze an object recursively.
 * @template T
 * @param {T} obj
 * @returns {Readonly<T>}
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null && !Object.isFrozen(obj[key])) {
      deepFreeze(obj[key]);
    }
  }
  return obj;
}

/**
 * Structural safety validator.
 * Rejects:
 * - Circular references
 * - Accessors (getters/setters)
 * - Unsafe prototypes and non-plain objects
 * - Excessive nesting (> MAX_NESTING_DEPTH)
 * - Oversized arrays (> MAX_ARRAY_LENGTH) or objects (> MAX_OBJECT_KEYS)
 * - Strings exceeding MAX_STRING_BYTES
 * - Credential / secret fields
 * - .env material
 * - Private reasoning / model thinking fields
 * - Full-transcript payloads
 *
 * @param {*} data
 * @param {string} [path='$']
 * @param {number} [depth=0]
 * @param {Set<object>} [seen=new Set()]
 */
export function assertStructuralSafety(data, path = '$', depth = 0, seen = new Set()) {
  if (depth > MAX_NESTING_DEPTH) {
    throw new ContextPackageBoundsError(
      `Nesting depth (${depth}) exceeds maximum allowed depth (${MAX_NESTING_DEPTH}) at ${path}`
    );
  }

  if (data === null || data === undefined) {
    return;
  }

  const type = typeof data;

  if (type === 'number' || type === 'boolean') {
    return;
  }

  if (type === 'string') {
    const bytes = Buffer.byteLength(data, 'utf8');
    if (bytes > MAX_STRING_BYTES) {
      throw new ContextPackageBoundsError(
        `String byte size (${bytes} B) exceeds maximum allowed string limit (${MAX_STRING_BYTES} B) at ${path}`
      );
    }

    // Structural rejection of private reasoning tags
    if (THINKING_TAG_PATTERN.test(data)) {
      throw new ContextPackageSecurityError(
        `Forbidden private reasoning/model-thinking tag detected at ${path}`
      );
    }

    // Structural rejection of .env material
    if (ENV_FILE_LINE_PATTERN.test(data)) {
      throw new ContextPackageSecurityError(
        `Forbidden .env material detected at ${path}`
      );
    }

    // Structural rejection of secret token patterns
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(data)) {
        throw new ContextPackageSecurityError(
          `Forbidden credential/secret pattern detected at ${path}`
        );
      }
    }

    return;
  }

  if (type !== 'object') {
    throw new ContextPackageSecurityError(
      `Unsupported or unsafe data type "${type}" at ${path}`
    );
  }

  // Reject circular references
  if (seen.has(data)) {
    throw new ContextPackageError(
      `Circular reference detected at ${path}`
    );
  }
  seen.add(data);

  if (Array.isArray(data)) {
    if (data.length > MAX_ARRAY_LENGTH) {
      throw new ContextPackageBoundsError(
        `Array length (${data.length}) exceeds maximum bound (${MAX_ARRAY_LENGTH}) at ${path}`
      );
    }

    // Check for full transcript array payloads (e.g. array of { role, content } turns)
    if (data.length > 5 && data.every(item => item && typeof item === 'object' && ('role' in item || 'content' in item))) {
      throw new ContextPackageSecurityError(
        `Full uncontrolled transcript payload detected at ${path}; only bounded summaries permitted`
      );
    }

    for (let i = 0; i < data.length; i++) {
      assertStructuralSafety(data[i], `${path}[${i}]`, depth + 1, seen);
    }
    seen.delete(data);
    return;
  }

  // Object checks
  // 1. Prototype safety
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) {
    throw new ContextPackageSecurityError(
      `Unsafe prototype or non-plain object detected at ${path}`
    );
  }

  // 2. Reject __proto__ property poisoning
  if (Object.prototype.hasOwnProperty.call(data, '__proto__')) {
    throw new ContextPackageSecurityError(
      `Unsafe __proto__ property detected at ${path}`
    );
  }

  const keys = Object.getOwnPropertyNames(data);
  if (keys.length > MAX_OBJECT_KEYS) {
    throw new ContextPackageBoundsError(
      `Object key count (${keys.length}) exceeds maximum bound (${MAX_OBJECT_KEYS}) at ${path}`
    );
  }

  for (const key of keys) {
    // 3. Reject accessors (getters/setters)
    const desc = Object.getOwnPropertyDescriptor(data, key);
    if (desc && (desc.get !== undefined || desc.set !== undefined)) {
      throw new ContextPackageSecurityError(
        `Unsafe accessor (getter/setter) detected for property "${key}" at ${path}`
      );
    }

    const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 4. Reject credential / secret fields
    if (FORBIDDEN_SECRET_KEYS.has(lowerKey)) {
      throw new ContextPackageSecurityError(
        `Forbidden credential/secret field detected: "${key}" at ${path}`
      );
    }

    // 5. Reject private reasoning / model-thinking fields
    if (FORBIDDEN_REASONING_KEYS.has(lowerKey)) {
      throw new ContextPackageSecurityError(
        `Forbidden private reasoning/model-thinking field detected: "${key}" at ${path}`
      );
    }

    // 6. Reject full transcript payloads
    if (FORBIDDEN_TRANSCRIPT_KEYS.has(lowerKey)) {
      throw new ContextPackageSecurityError(
        `Forbidden full-transcript payload field detected: "${key}" at ${path}`
      );
    }

    assertStructuralSafety(data[key], `${path}.${key}`, depth + 1, seen);
  }

  seen.delete(data);
}

/**
 * Defense-in-depth text sanitization.
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeText(text) {
  if (typeof text !== 'string') return text;
  let sanitized = text;
  sanitized = sanitized.replace(THINKING_TAG_PATTERN, '[REDACTED_PRIVATE_REASONING]');
  sanitized = sanitized.replace(ENV_FILE_LINE_PATTERN, '[REDACTED_ENV_SECRET]');
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(new RegExp(pattern.source, 'gi'), '[REDACTED_SECRET]');
  }
  return sanitized;
}

/**
 * Defense-in-depth data sanitization.
 *
 * @param {*} data
 * @returns {*}
 */
export function sanitizeData(data) {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    return sanitizeText(data);
  }
  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item));
  }
  if (typeof data === 'object') {
    const cleaned = {};
    for (const [key, val] of Object.entries(data)) {
      const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (FORBIDDEN_SECRET_KEYS.has(lowerKey)) {
        cleaned[key] = '[REDACTED_SECRET]';
        continue;
      }
      if (FORBIDDEN_REASONING_KEYS.has(lowerKey) || FORBIDDEN_TRANSCRIPT_KEYS.has(lowerKey)) {
        continue;
      }
      cleaned[key] = sanitizeData(val);
    }
    return cleaned;
  }
  return String(data);
}

/**
 * Compute composite context version from individual layer versions.
 *
 * @param {object} versions
 * @returns {string}
 */
export function computeCompositeVersion({
  charterVersion,
  workerKnowledgeVersion,
  projectContextVersion,
  taskPackageVersion,
  presetVersion
}) {
  return `cv1#c${charterVersion}:w${workerKnowledgeVersion}:p${projectContextVersion}:t${taskPackageVersion}:s${presetVersion}`;
}

/**
 * Build a bounded fresh-worker package in the documented 8-step order:
 * 1. Send the ZETRO Charter.
 * 2. Send the worker identity and capability contract.
 * 3. Send the current project context.
 * 4. Send the selected Master Prompt preset.
 * 5. Send the task package.
 * 6. Send the allowed tools and scope.
 * 7. Send the required evidence.
 * 8. Send the delegation and receipt protocols.
 *
 * Enforces:
 * - Structural safety (no cycles, accessors, unsafe prototypes, excessive depth)
 * - Structural rejection of secrets, .env, private reasoning, and full transcripts
 * - Invariant: presets and context packages never widen destination, project, workspace,
 *   paths, effects, time/tokens/provider attempts/worker count/depth/branches, or delegation authority.
 *
 * @param {object} params
 * @returns {Readonly<object>}
 */
export function buildFreshWorkerPackage({
  worker,
  adapter,
  project,
  workspace,
  task,
  routePosition = { index: 1, total: 1 },
  charter,
  workerKnowledge,
  projectContext,
  taskPackage,
  preset = 'ZETRO Standard',
  tools = [],
  scope = {},
  evidence = [],
  delegationProtocol = null,
  limits = {},
  baseAuthority = null
} = {}) {
  // 1. Structural safety verification of all input parameters
  assertStructuralSafety(worker, 'params.worker');
  assertStructuralSafety(task, 'params.task');
  assertStructuralSafety(scope, 'params.scope');
  assertStructuralSafety(tools, 'params.tools');
  assertStructuralSafety(evidence, 'params.evidence');
  if (limits) assertStructuralSafety(limits, 'params.limits');
  if (charter) assertStructuralSafety(charter, 'params.charter');
  if (workerKnowledge) assertStructuralSafety(workerKnowledge, 'params.workerKnowledge');
  if (projectContext) assertStructuralSafety(projectContext, 'params.projectContext');
  if (taskPackage) assertStructuralSafety(taskPackage, 'params.taskPackage');

  // 2. Validate required identity parameters
  if (!worker || typeof worker !== 'object') {
    throw new ContextPackageError('Worker specification is required');
  }
  const workerId = worker.workerId || worker.id;
  if (typeof workerId !== 'string' || !workerId.trim()) {
    throw new ContextPackageError('Valid workerId is required');
  }

  const adapterId = (typeof adapter === 'string' ? adapter : adapter?.adapterId) || worker.adapterId || 'native';
  if (typeof adapterId !== 'string' || !adapterId.trim()) {
    throw new ContextPackageError('Valid adapterId is required');
  }

  const projectId = (typeof project === 'string' ? project : project?.id || project?.name) || 'zetro';
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new ContextPackageError('Valid project identity is required');
  }

  const canonicalWorkspace = (typeof workspace === 'string' ? workspace : workspace?.path) || projectContext?.workspace;
  if (typeof canonicalWorkspace !== 'string' || !canonicalWorkspace.trim()) {
    throw new ContextPackageError('Canonical workspace path is required');
  }

  if (!task || typeof task !== 'object') {
    throw new ContextPackageError('Task specification is required');
  }
  const taskId = task.taskId || taskPackage?.taskId;
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw new ContextPackageError('Valid taskId is required');
  }

  const runId = task.runId || taskPackage?.runId || `run-${Date.now()}`;

  // 3. Non-widening invariant against baseAuthority (if provided)
  if (baseAuthority && typeof baseAuthority === 'object') {
    if (baseAuthority.destination && baseAuthority.destination !== workerId) {
      throw new ContextPackageSecurityError(
        `Context package cannot widen destination from "${baseAuthority.destination}" to "${workerId}"`
      );
    }
    if (baseAuthority.workspace && baseAuthority.workspace !== canonicalWorkspace) {
      throw new ContextPackageSecurityError(
        `Context package cannot widen workspace from "${baseAuthority.workspace}" to "${canonicalWorkspace}"`
      );
    }
    if (baseAuthority.project && baseAuthority.project !== projectId) {
      throw new ContextPackageSecurityError(
        `Context package cannot widen project from "${baseAuthority.project}" to "${projectId}"`
      );
    }
    if (Array.isArray(baseAuthority.ownedPaths) && Array.isArray(scope.ownedPaths)) {
      const unauthorizedPaths = scope.ownedPaths.filter(p => !baseAuthority.ownedPaths.includes(p));
      if (unauthorizedPaths.length > 0) {
        throw new ContextPackageSecurityError(
          `Context package cannot widen owned paths: [${unauthorizedPaths.join(', ')}]`
        );
      }
    }
    if (Array.isArray(baseAuthority.allowedActions) && Array.isArray(scope.allowedActions)) {
      const unauthorizedActions = scope.allowedActions.filter(a => !baseAuthority.allowedActions.includes(a));
      if (unauthorizedActions.length > 0) {
        throw new ContextPackageSecurityError(
          `Context package cannot widen allowed actions: [${unauthorizedActions.join(', ')}]`
        );
      }
    }
    if (baseAuthority.readOnly === true && scope.readOnly === false) {
      throw new ContextPackageSecurityError('Context package cannot disable readOnly on a readOnly base');
    }

    // Budget checks against baseAuthority
    const baseLimits = baseAuthority.limits || {};
    const effectiveInputLimits = { ...task.limits, ...limits };
    const limitKeys = [
      'maxSteps', 'maxPackageBytes', 'timeoutMs', 'maxTokens',
      'maxProviderAttempts', 'maxWorkers', 'maxDepth', 'maxBranches'
    ];
    for (const key of limitKeys) {
      if (Number.isSafeInteger(baseLimits[key]) && Number.isSafeInteger(effectiveInputLimits[key])) {
        if (effectiveInputLimits[key] > baseLimits[key]) {
          throw new ContextPackageBoundsError(
            `Context package cannot widen limit ${key}: ${effectiveInputLimits[key]} > ${baseLimits[key]}`
          );
        }
      }
    }
  }

  // 4. Resolve / construct the 4 versioned layers
  if (Array.isArray(tools) && tools.length > MAX_ENTRY_BOUNDS.maxTools) {
    throw new ContextPackageBoundsError(
      `Tools count (${tools.length}) exceeds bound (${MAX_ENTRY_BOUNDS.maxTools})`
    );
  }
  if (Array.isArray(worker?.tools) && worker.tools.length > MAX_ENTRY_BOUNDS.maxTools) {
    throw new ContextPackageBoundsError(
      `Worker tools count (${worker.tools.length}) exceeds bound (${MAX_ENTRY_BOUNDS.maxTools})`
    );
  }

  const effectiveCharter = charter || createCharter();
  const effectiveWorkerKnowledge = workerKnowledge || createWorkerKnowledge({
    workerId,
    adapterId,
    capabilities: worker.capabilities || {},
    tools: Array.isArray(tools) && tools.length > 0 ? tools : worker.tools || []
  });

  const effectiveProjectContext = projectContext || createProjectContext({
    project: projectId,
    workspace: canonicalWorkspace,
    milestone: project?.milestone || 'current',
    acceptedWork: project?.acceptedWork || [],
    pendingWork: project?.pendingWork || [],
    ownership: project?.ownership || {},
    relevantFiles: project?.relevantFiles || [],
    checks: project?.checks || []
  });

  const effectiveTaskPackage = taskPackage || createTaskPackage({
    taskId,
    runId,
    conversationId: task.conversationId || null,
    userObjective: task.userObjective || task.objective || task.goal || 'Perform assigned task',
    routePosition,
    ownedPaths: scope.ownedPaths || task.ownedPaths || [],
    allowedActions: scope.allowedActions || task.allowedActions || ['read', 'write', 'check'],
    limits: { ...task.limits, ...limits },
    checks: task.checks || evidence,
    requiredOutput: task.requiredOutput || 'Worker receipt with evidence and limitation disclosures',
    cancellationId: task.cancellationId || null
  });

  // 5. Apply preset with strict non-widening
  const baseOptionsForPreset = {
    destination: workerId,
    project: projectId,
    workspace: canonicalWorkspace,
    ownedPaths: scope.ownedPaths || effectiveTaskPackage.ownedPaths,
    allowedActionClasses: effectiveTaskPackage.allowedActions,
    readOnly: Boolean(worker.readOnly || scope.readOnly),
    limits: {
      maxPackageBytes: limits.maxPackageBytes || DEFAULT_MAX_PACKAGE_BYTES,
      maxSteps: limits.maxSteps || effectiveTaskPackage.limits.maxSteps,
      maxFiles: limits.maxFiles || MAX_ENTRY_BOUNDS.maxRelevantFiles,
      timeoutMs: limits.timeoutMs || effectiveTaskPackage.limits.timeoutMs,
      maxTokens: limits.maxTokens,
      maxProviderAttempts: limits.maxProviderAttempts,
      maxWorkers: limits.maxWorkers,
      maxDepth: limits.maxDepth,
      maxBranches: limits.maxBranches
    },
    security: {
      allowExternalSend: Boolean(worker.capabilities?.allowExternalSend || scope.allowExternalSend)
    },
    requiredEvidence: Array.isArray(evidence) ? evidence : []
  };

  const narrowedConfig = applyPreset(baseOptionsForPreset, preset);
  const resolvedPreset = getPreset(narrowedConfig.presetId || preset);

  // 6. Construct tools & scope
  const ownedPaths = Array.isArray(narrowedConfig.ownedPaths)
    ? narrowedConfig.ownedPaths
    : Array.isArray(scope.ownedPaths)
      ? scope.ownedPaths.map(p => String(p).trim())
      : effectiveTaskPackage.ownedPaths;

  if (ownedPaths.length > MAX_ENTRY_BOUNDS.maxOwnedPaths) {
    throw new ContextPackageBoundsError(
      `Owned paths count (${ownedPaths.length}) exceeds bound (${MAX_ENTRY_BOUNDS.maxOwnedPaths})`
    );
  }

  if (Array.isArray(tools) && tools.length > MAX_ENTRY_BOUNDS.maxTools) {
    throw new ContextPackageBoundsError(
      `Tools count (${tools.length}) exceeds bound (${MAX_ENTRY_BOUNDS.maxTools})`
    );
  }

  const effectiveTools = Array.isArray(tools) ? [...tools] : [];
  const effectiveScope = {
    ownedPaths: Object.freeze(ownedPaths),
    readPaths: Object.freeze(Array.isArray(scope.readPaths) ? scope.readPaths.map(p => String(p).trim()) : []),
    forbiddenPaths: Object.freeze(Array.isArray(scope.forbiddenPaths) ? scope.forbiddenPaths.map(p => String(p).trim()) : ['.env', '.git']),
    allowedActions: narrowedConfig.allowedActionClasses,
    readOnly: narrowedConfig.readOnly
  };

  // 7. Construct required evidence
  const effectiveEvidence = narrowedConfig.requiredEvidence;
  if (effectiveEvidence.length > MAX_ENTRY_BOUNDS.maxChecks) {
    throw new ContextPackageBoundsError(
      `Evidence checks count (${effectiveEvidence.length}) exceeds bound (${MAX_ENTRY_BOUNDS.maxChecks})`
    );
  }

  // 8. Construct delegation & receipt protocol (bounded by parent authority)
  const effectiveDelegationProtocol = delegationProtocol || {
    messageProtocol: effectiveWorkerKnowledge.messageProtocol,
    delegationMethod: effectiveWorkerKnowledge.delegationMethod,
    receiptFormat: effectiveWorkerKnowledge.receiptFormat,
    authorityCeiling: {
      allowedActionClasses: narrowedConfig.allowedActionClasses,
      maxSteps: narrowedConfig.limits.maxSteps,
      readOnly: narrowedConfig.readOnly,
      destination: workerId,
      workspace: canonicalWorkspace
    }
  };

  // 9. Context versions & bindings
  const contextVersions = {
    charterVersion: effectiveCharter.version,
    workerKnowledgeVersion: effectiveWorkerKnowledge.version,
    projectContextVersion: effectiveProjectContext.version,
    taskPackageVersion: effectiveTaskPackage.version,
    presetVersion: resolvedPreset.version,
    compositeVersion: computeCompositeVersion({
      charterVersion: effectiveCharter.version,
      workerKnowledgeVersion: effectiveWorkerKnowledge.version,
      projectContextVersion: effectiveProjectContext.version,
      taskPackageVersion: effectiveTaskPackage.version,
      presetVersion: resolvedPreset.version
    })
  };

  const bindings = {
    workerId,
    adapterId,
    project: projectId,
    workspace: canonicalWorkspace,
    taskId,
    runId,
    routePosition: {
      index: Number.isSafeInteger(routePosition.index) ? routePosition.index : 1,
      total: Number.isSafeInteger(routePosition.total) ? routePosition.total : 1,
      sourceWorker: routePosition.sourceWorker ? String(routePosition.sourceWorker).trim() : null,
      destinationWorker: workerId
    },
    contextVersions: Object.freeze(contextVersions)
  };

  // 10. Construct the 8 ordered sections in exact documented order
  const rawSections = [
    {
      step: 1,
      name: 'charter',
      title: '1. ZETRO Charter',
      content: {
        title: effectiveCharter.title,
        version: effectiveCharter.version,
        content: effectiveCharter.content,
        principles: effectiveCharter.principles
      }
    },
    {
      step: 2,
      name: 'workerContract',
      title: '2. Worker Identity and Capability Contract',
      content: {
        workerId,
        workerType: effectiveWorkerKnowledge.workerType,
        adapterId,
        capabilities: effectiveWorkerKnowledge.capabilities,
        tools: effectiveTools,
        version: effectiveWorkerKnowledge.version
      }
    },
    {
      step: 3,
      name: 'projectContext',
      title: '3. Current Project Context',
      content: {
        project: projectId,
        workspace: canonicalWorkspace,
        milestone: effectiveProjectContext.milestone,
        acceptedWork: effectiveProjectContext.acceptedWork,
        pendingWork: effectiveProjectContext.pendingWork,
        ownership: effectiveProjectContext.ownership,
        relevantFiles: effectiveProjectContext.relevantFiles,
        checks: effectiveProjectContext.checks,
        version: effectiveProjectContext.version
      }
    },
    {
      step: 4,
      name: 'preset',
      title: '4. Selected Master Prompt Preset',
      content: {
        preset: resolvedPreset.name,
        presetId: resolvedPreset.id,
        version: resolvedPreset.version,
        purpose: resolvedPreset.purpose,
        guidance: resolvedPreset.guidance,
        readOnly: narrowedConfig.readOnly,
        allowedActionClasses: narrowedConfig.allowedActionClasses,
        limits: narrowedConfig.limits
      }
    },
    {
      step: 5,
      name: 'taskPackage',
      title: '5. Task Package',
      content: {
        taskId,
        runId,
        userObjective: effectiveTaskPackage.userObjective,
        routePosition: bindings.routePosition,
        ownedPaths: effectiveScope.ownedPaths,
        allowedActions: effectiveScope.allowedActions,
        limits: narrowedConfig.limits,
        requiredOutput: effectiveTaskPackage.requiredOutput,
        version: effectiveTaskPackage.version
      }
    },
    {
      step: 6,
      name: 'toolsAndScope',
      title: '6. Allowed Tools and Scope',
      content: {
        tools: effectiveTools,
        scope: effectiveScope
      }
    },
    {
      step: 7,
      name: 'requiredEvidence',
      title: '7. Required Evidence',
      content: {
        requiredEvidence: effectiveEvidence,
        checks: effectiveTaskPackage.checks
      }
    },
    {
      step: 8,
      name: 'delegationProtocol',
      title: '8. Delegation and Receipt Protocols',
      content: effectiveDelegationProtocol
    }
  ];

  // 11. Structural safety verification on the assembled sections
  for (const sec of rawSections) {
    assertStructuralSafety(sec.content, `section.${sec.name}`);
  }

  // 12. Defense-in-depth sanitization of sections
  const sanitizedSections = rawSections.map(s => ({
    step: s.step,
    name: s.name,
    title: s.title,
    content: sanitizeData(s.content)
  }));

  // 13. Byte bound check before output
  const serialized = JSON.stringify({ bindings, scope: effectiveScope, sections: sanitizedSections });
  const totalBytes = Buffer.byteLength(serialized, 'utf8');
  const allowedByteLimit = Math.min(narrowedConfig.limits.maxPackageBytes, HARD_CEILING_PACKAGE_BYTES);

  if (totalBytes > allowedByteLimit) {
    throw new ContextPackageBoundsError(
      `Package byte size (${totalBytes} B) exceeds allowed budget (${allowedByteLimit} B)`,
      { totalBytes, allowedByteLimit }
    );
  }

  return deepFreeze({
    packageId: `pkg-${taskId}-${Date.now()}`,
    totalBytes,
    maxByteBudget: allowedByteLimit,
    bindings: deepFreeze(bindings),
    scope: deepFreeze(effectiveScope),
    preset: resolvedPreset,
    limits: narrowedConfig.limits,
    sections: deepFreeze(sanitizedSections),
    acknowledgmentRequired: true
  });
}

/**
 * Create a worker acknowledgment object.
 *
 * NOTE: An acknowledgment is admission evidence ONLY.
 * It must never represent dispatch, completion, or verification.
 *
 * @param {object} params
 * @param {string} params.workerId
 * @param {string} params.workspace
 * @param {string} params.taskId
 * @param {object} params.scope
 * @param {string} params.contextVersion
 * @param {number} [params.timestamp=Date.now()]
 * @returns {Readonly<object>}
 */
export function createWorkerAcknowledgment({
  workerId,
  workspace,
  taskId,
  scope,
  contextVersion,
  timestamp = Date.now()
} = {}) {
  if (typeof workerId !== 'string' || !workerId.trim()) {
    throw new ContextPackageError('Acknowledgment requires workerId');
  }
  if (typeof workspace !== 'string' || !workspace.trim()) {
    throw new ContextPackageError('Acknowledgment requires workspace');
  }
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw new ContextPackageError('Acknowledgment requires taskId');
  }
  if (!scope || typeof scope !== 'object') {
    throw new ContextPackageError('Acknowledgment requires scope object');
  }
  if (typeof contextVersion !== 'string' || !contextVersion.trim()) {
    throw new ContextPackageError('Acknowledgment requires contextVersion string');
  }

  // Structural safety check on acknowledgment payload
  assertStructuralSafety(scope, 'acknowledgment.scope');

  return deepFreeze({
    acknowledged: true,
    evidenceType: 'admission_evidence',
    isDispatch: false,
    isCompletion: false,
    isVerification: false,
    workerId: workerId.trim(),
    workspace: workspace.trim(),
    taskId: taskId.trim(),
    scope: {
      ownedPaths: Array.isArray(scope.ownedPaths) ? [...scope.ownedPaths] : [],
      allowedActions: Array.isArray(scope.allowedActions) ? [...scope.allowedActions] : [],
      readOnly: Boolean(scope.readOnly)
    },
    contextVersion: contextVersion.trim(),
    timestamp: typeof timestamp === 'number' ? timestamp : Date.now()
  });
}

/**
 * Verify that a worker acknowledgment strictly matches the context package.
 *
 * NOTE: An acknowledgment is admission evidence ONLY.
 * It confirms admission to workspace and context version.
 * It never implies dispatch, execution, completion, or verification.
 *
 * @param {object} contextPackage
 * @param {object} acknowledgment
 * @returns {{ valid: boolean, evidenceType: string, isDispatch: boolean, isCompletion: boolean, isVerification: boolean, reason?: string }}
 */
export function verifyWorkerAcknowledgment(contextPackage, acknowledgment) {
  if (!contextPackage || typeof contextPackage !== 'object') {
    return {
      valid: false,
      evidenceType: 'admission_evidence',
      isDispatch: false,
      isCompletion: false,
      isVerification: false,
      reason: 'Invalid context package provided for verification'
    };
  }
  if (!acknowledgment || typeof acknowledgment !== 'object') {
    return {
      valid: false,
      evidenceType: 'admission_evidence',
      isDispatch: false,
      isCompletion: false,
      isVerification: false,
      reason: 'Invalid acknowledgment object provided'
    };
  }

  // Invariant: Acknowledgment must never claim dispatch, completion, or verification
  if (acknowledgment.isDispatch === true || acknowledgment.isCompletion === true || acknowledgment.isVerification === true) {
    return {
      valid: false,
      evidenceType: 'admission_evidence',
      isDispatch: false,
      isCompletion: false,
      isVerification: false,
      reason: 'Acknowledgment is admission evidence only; cannot claim dispatch, completion, or verification'
    };
  }

  if (acknowledgment.acknowledged !== true) {
    return {
      valid: false,
      evidenceType: 'admission_evidence',
      isDispatch: false,
      isCompletion: false,
      isVerification: false,
      reason: 'Acknowledgment flag must be true'
    };
  }

  // 1. Identity match
  if (acknowledgment.workerId !== contextPackage.bindings.workerId) {
    return {
      valid: false,
      evidenceType: 'admission_evidence',
      isDispatch: false,
      isCompletion: false,
      isVerification: false,
      reason: `Worker identity mismatch: expected "${contextPackage.bindings.workerId}", received "${acknowledgment.workerId}"`
    };
  }

  // 2. Workspace match
  if (acknowledgment.workspace !== contextPackage.bindings.workspace) {
    return {
      valid: false,
      evidenceType: 'admission_evidence',
      isDispatch: false,
      isCompletion: false,
      isVerification: false,
      reason: `Workspace mismatch: expected "${contextPackage.bindings.workspace}", received "${acknowledgment.workspace}"`
    };
  }

  // 3. Task match
  if (acknowledgment.taskId !== contextPackage.bindings.taskId) {
    return {
      valid: false,
      evidenceType: 'admission_evidence',
      isDispatch: false,
      isCompletion: false,
      isVerification: false,
      reason: `Task identity mismatch: expected "${contextPackage.bindings.taskId}", received "${acknowledgment.taskId}"`
    };
  }

  // 4. Context version match
  const expectedComposite = contextPackage.bindings.contextVersions?.compositeVersion;
  if (acknowledgment.contextVersion !== expectedComposite) {
    return {
      valid: false,
      evidenceType: 'admission_evidence',
      isDispatch: false,
      isCompletion: false,
      isVerification: false,
      reason: `Context version mismatch: expected "${expectedComposite}", received "${acknowledgment.contextVersion}"`
    };
  }

  // 5. Scope match
  const expectedScope = contextPackage.scope;
  const ackScope = acknowledgment.scope;
  if (!ackScope || typeof ackScope !== 'object') {
    return {
      valid: false,
      evidenceType: 'admission_evidence',
      isDispatch: false,
      isCompletion: false,
      isVerification: false,
      reason: 'Acknowledgment is missing scope object'
    };
  }

  // Check ownedPaths
  if (expectedScope.ownedPaths.length > 0) {
    const ackOwned = Array.isArray(ackScope.ownedPaths) ? ackScope.ownedPaths : [];
    const missingPaths = expectedScope.ownedPaths.filter(p => !ackOwned.includes(p));
    if (missingPaths.length > 0) {
      return {
        valid: false,
        evidenceType: 'admission_evidence',
        isDispatch: false,
        isCompletion: false,
        isVerification: false,
        reason: `Scope ownedPaths mismatch: missing [${missingPaths.join(', ')}]`
      };
    }
  }

  // Check readOnly constraint
  if (expectedScope.readOnly && !ackScope.readOnly) {
    return {
      valid: false,
      evidenceType: 'admission_evidence',
      isDispatch: false,
      isCompletion: false,
      isVerification: false,
      reason: 'Scope mismatch: readOnly is required by context package but not acknowledged'
    };
  }

  return {
    valid: true,
    evidenceType: 'admission_evidence',
    isDispatch: false,
    isCompletion: false,
    isVerification: false
  };
}
