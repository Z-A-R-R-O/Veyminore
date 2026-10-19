/**
 * @file master-prompt.js
 * Versioned Master Prompt System for ZETRO IFZ.
 *
 * Implements the four versioned layers:
 * 1. ZETRO Charter
 * 2. Worker Knowledge
 * 3. Project Context
 * 4. Task Package
 */

import { getPreset, validatePreset } from './presets.js';

export class MasterPromptError extends Error {
  constructor(message, details = {}) {
    super(`[IFZ:MasterPrompt] ${message}`);
    this.name = 'MasterPromptError';
    this.details = details;
  }
}

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
 * Default ZETRO Charter text adhering to IFZ Unified Architecture.
 */
export const DEFAULT_CHARTER_CONTENT = `1. Purpose: ZETRO is one work environment for every registered worker. Every permitted worker can request any compatible worker through IFZ.
2. Central Authority: All requests pass through IFZ as the central prompt, routing, context, and audit layer. Workers do not communicate directly.
3. Verification: Self-report is not completion. Completed work requires independent checks, receipts, and verified effects.
4. Privacy: Exclude credentials, secrets, raw private reasoning, and uncontrolled full transcripts from worker context.
5. Bounded Delegation: Sub-delegation cannot increase authority, scope, time, or usage limits.
6. Exact Workspace Binding: Work is bound to admitted project workspaces. No unauthorized path traversal.`;

export const DEFAULT_CHARTER_PRINCIPLES = Object.freeze([
  'Central Orchestration: All worker assignments and inter-worker requests flow through IFZ.',
  'Independent Verification: Completion requires external evidence, receipts, and test results; self-claims are rejected.',
  'Zero Secret Leakage: Credentials, tokens, and private reasoning are strictly prohibited in context packages.',
  'Strict Authority Ceilings: Delegation and presets may narrow work but can never expand authority or budgets.',
  'Exact Workspace Admittance: All effects are constrained to canonical project workspace boundaries.'
]);

/**
 * Layer 1: Create a versioned ZETRO Charter.
 * Only the user can replace the Charter.
 *
 * @param {object} [options]
 * @param {string} [options.version='1.0.0']
 * @param {string} [options.title='ZETRO Charter']
 * @param {string} [options.content=DEFAULT_CHARTER_CONTENT]
 * @param {string[]} [options.principles=DEFAULT_CHARTER_PRINCIPLES]
 * @returns {Readonly<object>}
 */
export function createCharter({
  version = '1.0.0',
  title = 'ZETRO Charter',
  content = DEFAULT_CHARTER_CONTENT,
  principles = DEFAULT_CHARTER_PRINCIPLES
} = {}) {
  if (typeof version !== 'string' || !version.trim()) {
    throw new MasterPromptError('Charter version must be a non-empty string');
  }
  if (typeof title !== 'string' || !title.trim()) {
    throw new MasterPromptError('Charter title must be a non-empty string');
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw new MasterPromptError('Charter content must be a non-empty string');
  }
  if (!Array.isArray(principles) || principles.length === 0) {
    throw new MasterPromptError('Charter principles must be a non-empty array of strings');
  }

  return deepFreeze({
    layer: 'charter',
    version: version.trim(),
    title: title.trim(),
    content: content.trim(),
    principles: principles.map(p => String(p).trim()),
    author: 'user'
  });
}

/**
 * Layer 2: Create a versioned Worker Knowledge layer.
 * Generated from the worker manifest/registry.
 *
 * @param {object} manifest - Worker manifest or description
 * @param {object} [options]
 * @param {string} [options.version='1.0.0']
 * @returns {Readonly<object>}
 */
export function createWorkerKnowledge(manifest, { version = '1.0.0' } = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new MasterPromptError('Worker manifest must be a non-empty object');
  }
  const workerId = manifest.workerId || manifest.id;
  if (typeof workerId !== 'string' || !workerId.trim()) {
    throw new MasterPromptError('Worker manifest must contain a valid workerId');
  }
  if (typeof version !== 'string' || !version.trim()) {
    throw new MasterPromptError('Worker Knowledge version must be a non-empty string');
  }

  const workerType = manifest.workerType || manifest.type || 'standard';
  const adapterId = manifest.adapterId || manifest.adapter || 'native';
  const capabilities = manifest.capabilities && typeof manifest.capabilities === 'object'
    ? { ...manifest.capabilities }
    : { read: true, write: false, execute: false };

  const tools = Array.isArray(manifest.tools)
    ? [...manifest.tools]
    : Array.isArray(manifest.supportedTools)
      ? [...manifest.supportedTools]
      : [];

  const messageProtocol = manifest.messageProtocol ||
    'All inter-worker communication must pass through IFZ route envelopes. No direct peer dispatch.';

  const delegationMethod = manifest.delegationMethod ||
    'Submit route request envelope to IFZ. Authority, scope, and usage budgets cannot exceed parent envelope.';

  const receiptFormat = manifest.receiptFormat ||
    'Structured markdown receipt documenting exact modified files, focused test commands, verification metrics, and limitations.';

  return deepFreeze({
    layer: 'worker_knowledge',
    version: version.trim(),
    workerId: workerId.trim(),
    workerType: String(workerType).trim(),
    adapterId: String(adapterId).trim(),
    capabilities,
    tools,
    messageProtocol: String(messageProtocol).trim(),
    delegationMethod: String(delegationMethod).trim(),
    receiptFormat: String(receiptFormat).trim()
  });
}

/**
 * Layer 3: Create a versioned Project Context layer.
 * Bounded and versioned. Uncontrolled transcripts are strictly prohibited.
 *
 * @param {object} options
 * @returns {Readonly<object>}
 */
export function createProjectContext({
  version = '1.0.0',
  project = 'zetro',
  workspace,
  milestone = 'current',
  acceptedWork = [],
  pendingWork = [],
  ownership = {},
  relevantFiles = [],
  checks = []
} = {}) {
  if (typeof version !== 'string' || !version.trim()) {
    throw new MasterPromptError('Project Context version must be a non-empty string');
  }
  if (typeof project !== 'string' || !project.trim()) {
    throw new MasterPromptError('Project identity must be a non-empty string');
  }
  if (typeof workspace !== 'string' || !workspace.trim()) {
    throw new MasterPromptError('Canonical workspace path must be a non-empty string');
  }
  if (!Array.isArray(acceptedWork)) {
    throw new MasterPromptError('acceptedWork must be an array');
  }
  if (!Array.isArray(pendingWork)) {
    throw new MasterPromptError('pendingWork must be an array');
  }
  if (!Array.isArray(relevantFiles)) {
    throw new MasterPromptError('relevantFiles must be an array');
  }
  if (!Array.isArray(checks)) {
    throw new MasterPromptError('checks must be an array');
  }

  // Bounds enforcement on context items
  const MAX_CONTEXT_ITEMS = 50;
  if (acceptedWork.length > MAX_CONTEXT_ITEMS) {
    throw new MasterPromptError(`acceptedWork count (${acceptedWork.length}) exceeds bound (${MAX_CONTEXT_ITEMS})`);
  }
  if (pendingWork.length > MAX_CONTEXT_ITEMS) {
    throw new MasterPromptError(`pendingWork count (${pendingWork.length}) exceeds bound (${MAX_CONTEXT_ITEMS})`);
  }
  if (relevantFiles.length > MAX_CONTEXT_ITEMS) {
    throw new MasterPromptError(`relevantFiles count (${relevantFiles.length}) exceeds bound (${MAX_CONTEXT_ITEMS})`);
  }
  if (checks.length > MAX_CONTEXT_ITEMS) {
    throw new MasterPromptError(`checks count (${checks.length}) exceeds bound (${MAX_CONTEXT_ITEMS})`);
  }

  // Reject full uncontrolled transcript payloads
  for (const item of [...acceptedWork, ...pendingWork, ...relevantFiles]) {
    if (item && typeof item === 'object') {
      const keys = Object.keys(item).map(k => k.toLowerCase());
      if (keys.some(k => k.includes('transcript') || k === 'messages' || k === 'rawturns')) {
        throw new MasterPromptError('Full uncontrolled transcript payloads are prohibited in project context');
      }
    }
  }

  const boundedAccepted = acceptedWork.slice(0, MAX_CONTEXT_ITEMS);
  const boundedPending = pendingWork.slice(0, MAX_CONTEXT_ITEMS);
  const boundedFiles = relevantFiles.slice(0, MAX_CONTEXT_ITEMS);
  const boundedChecks = checks.slice(0, MAX_CONTEXT_ITEMS);

  return deepFreeze({
    layer: 'project_context',
    version: version.trim(),
    project: project.trim(),
    workspace: workspace.trim(),
    milestone: String(milestone).trim(),
    acceptedWork: boundedAccepted,
    pendingWork: boundedPending,
    ownership: typeof ownership === 'object' && ownership !== null ? { ...ownership } : {},
    relevantFiles: boundedFiles,
    checks: boundedChecks
  });
}

const SENSITIVE_PATTERN = /(?:bearer\s+[a-zA-Z0-9_\-\.]{16,}|ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]+ PRIVATE KEY-----)/i;
const THINKING_TAG_PATTERN = /<(?:thinking|thought|scratchpad)>[\s\S]*?<\/(?:thinking|thought|scratchpad)>/i;
const ENV_FILE_LINE_PATTERN = /^[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL|AUTH)[A-Z0-9_]*\s*=\s*.+$/im;

/**
 * Layer 4: Create a versioned Task Package layer.
 *
 * @param {object} options
 * @returns {Readonly<object>}
 */
export function createTaskPackage({
  version = '1.0.0',
  taskId,
  runId,
  conversationId = null,
  userObjective,
  routePosition = { index: 1, total: 1 },
  ownedPaths = [],
  allowedActions = ['read', 'write', 'check'],
  limits = { maxSteps: 30, maxBytes: 65536 },
  checks = [],
  requiredOutput = 'Worker receipt with evidence and limitation disclosures',
  cancellationId = null
} = {}) {
  if (typeof version !== 'string' || !version.trim()) {
    throw new MasterPromptError('Task Package version must be a non-empty string');
  }
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw new MasterPromptError('taskId must be a non-empty string');
  }
  if (typeof runId !== 'string' || !runId.trim()) {
    throw new MasterPromptError('runId must be a non-empty string');
  }
  if (typeof userObjective !== 'string' || !userObjective.trim()) {
    throw new MasterPromptError('userObjective must be a non-empty string');
  }
  if (THINKING_TAG_PATTERN.test(userObjective)) {
    throw new MasterPromptError('Forbidden private reasoning tag in userObjective');
  }
  if (SENSITIVE_PATTERN.test(userObjective)) {
    throw new MasterPromptError('Forbidden credential/secret pattern in userObjective');
  }
  if (ENV_FILE_LINE_PATTERN.test(userObjective)) {
    throw new MasterPromptError('Forbidden .env material in userObjective');
  }
  if (!Array.isArray(ownedPaths)) {
    throw new MasterPromptError('ownedPaths must be an array of paths');
  }
  if (!Array.isArray(allowedActions) || allowedActions.length === 0) {
    throw new MasterPromptError('allowedActions must be a non-empty array of action classes');
  }
  if (!limits || typeof limits !== 'object') {
    throw new MasterPromptError('limits must be an object');
  }

  const boundedRoutePosition = {
    index: Number.isSafeInteger(routePosition?.index) && routePosition.index >= 1 ? routePosition.index : 1,
    total: Number.isSafeInteger(routePosition?.total) && routePosition.total >= 1 ? routePosition.total : 1,
    sourceWorker: routePosition?.sourceWorker ? String(routePosition.sourceWorker).trim() : null,
    destinationWorker: routePosition?.destinationWorker ? String(routePosition.destinationWorker).trim() : null
  };

  return deepFreeze({
    layer: 'task_package',
    version: version.trim(),
    taskId: taskId.trim(),
    runId: runId.trim(),
    conversationId: conversationId ? String(conversationId).trim() : null,
    userObjective: userObjective.trim(),
    routePosition: boundedRoutePosition,
    ownedPaths: ownedPaths.map(p => String(p).trim()),
    allowedActions: allowedActions.map(a => String(a).trim()),
    limits: {
      maxSteps: Number.isSafeInteger(limits.maxSteps) && limits.maxSteps > 0 ? limits.maxSteps : 30,
      maxBytes: Number.isSafeInteger(limits.maxBytes) && limits.maxBytes > 0 ? limits.maxBytes : 65536,
      timeoutMs: Number.isSafeInteger(limits.timeoutMs) && limits.timeoutMs > 0 ? limits.timeoutMs : undefined
    },
    checks: Array.isArray(checks) ? [...checks] : [],
    requiredOutput: String(requiredOutput).trim(),
    cancellationId: cancellationId ? String(cancellationId).trim() : null
  });
}

/**
 * Composite Master Prompt container uniting the four versioned layers and preset.
 *
 * @param {object} options
 * @param {object} options.charter - ZETRO Charter layer
 * @param {object} options.workerKnowledge - Worker Knowledge layer
 * @param {object} options.projectContext - Project Context layer
 * @param {object} options.taskPackage - Task Package layer
 * @param {string|object} [options.preset='ZETRO Standard'] - Master Prompt preset
 * @param {string} [options.version='1.0.0'] - Composite prompt version
 * @returns {Readonly<object>}
 */
export function createMasterPrompt({
  charter,
  workerKnowledge,
  projectContext,
  taskPackage,
  preset = 'ZETRO Standard',
  version = '1.0.0'
} = {}) {
  if (!charter || charter.layer !== 'charter') {
    throw new MasterPromptError('A valid Charter layer is required');
  }
  if (!workerKnowledge || workerKnowledge.layer !== 'worker_knowledge') {
    throw new MasterPromptError('A valid Worker Knowledge layer is required');
  }
  if (!projectContext || projectContext.layer !== 'project_context') {
    throw new MasterPromptError('A valid Project Context layer is required');
  }
  if (!taskPackage || taskPackage.layer !== 'task_package') {
    throw new MasterPromptError('A valid Task Package layer is required');
  }

  const resolvedPreset = typeof preset === 'string'
    ? getPreset(preset)
    : preset;

  if (!validatePreset(resolvedPreset)) {
    throw new MasterPromptError('A valid preset must be provided');
  }

  const compositeVersion = `${version}#c${charter.version}:w${workerKnowledge.version}:p${projectContext.version}:t${taskPackage.version}`;

  function render() {
    return [
      `# ${charter.title} (v${charter.version})`,
      charter.content,
      '',
      `## Worker Knowledge: ${workerKnowledge.workerId} (${workerKnowledge.workerType}) [v${workerKnowledge.version}]`,
      `- Capabilities: ${Object.entries(workerKnowledge.capabilities).filter(([, v]) => v).map(([k]) => k).join(', ')}`,
      `- Protocol: ${workerKnowledge.messageProtocol}`,
      `- Delegation: ${workerKnowledge.delegationMethod}`,
      `- Receipt: ${workerKnowledge.receiptFormat}`,
      '',
      `## Project Context: ${projectContext.project} [v${projectContext.version}]`,
      `- Workspace: ${projectContext.workspace}`,
      `- Milestone: ${projectContext.milestone}`,
      `- Ownership: ${JSON.stringify(projectContext.ownership)}`,
      '',
      `## Master Prompt Preset: ${resolvedPreset.name} (v${resolvedPreset.version})`,
      `- Purpose: ${resolvedPreset.purpose}`,
      `- Guidance: ${resolvedPreset.guidance}`,
      '',
      `## Task Package: ${taskPackage.taskId} [v${taskPackage.version}]`,
      `- User Objective: ${taskPackage.userObjective}`,
      `- Route Position: ${taskPackage.routePosition.index} of ${taskPackage.routePosition.total}`,
      `- Owned Paths: ${taskPackage.ownedPaths.join(', ') || 'none'}`,
      `- Allowed Actions: ${taskPackage.allowedActions.join(', ')}`,
      `- Limits: ${JSON.stringify(taskPackage.limits)}`,
      `- Required Output: ${taskPackage.requiredOutput}`
    ].join('\n');
  }

  return deepFreeze({
    version,
    compositeVersion,
    charter,
    workerKnowledge,
    projectContext,
    taskPackage,
    preset: resolvedPreset,
    getLayers() {
      return {
        charter,
        workerKnowledge,
        projectContext,
        taskPackage
      };
    },
    render
  });
}
