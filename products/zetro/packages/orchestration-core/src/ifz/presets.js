/**
 * @file presets.js
 * Versioned Master Prompt Presets for ZETRO IFZ.
 *
 * Implements ZETRO Standard, ECO, Build, Review, Design, Qualification, and Recovery presets.
 * Enforces the invariant: A preset may narrow work; it cannot weaken authority,
 * security, destination, or usage limits.
 */

export class PresetError extends Error {
  constructor(message, details = {}) {
    super(`[IFZ:Preset] ${message}`);
    this.name = 'PresetError';
    this.details = details;
  }
}

export class InvalidPresetApplicationError extends PresetError {
  constructor(message, details = {}) {
    super(`Cannot apply preset: ${message}`, details);
    this.name = 'InvalidPresetApplicationError';
  }
}

export const PRESET_NAMES = Object.freeze([
  'ZETRO Standard',
  'ECO Mode',
  'Build Mode',
  'Review Mode',
  'Design Mode',
  'Qualification Mode',
  'Recovery Mode'
]);

export const PRESET_IDS = Object.freeze([
  'standard',
  'eco',
  'build',
  'review',
  'design',
  'qualification',
  'recovery'
]);

const RAW_PRESETS = {
  standard: {
    id: 'standard',
    name: 'ZETRO Standard',
    version: '1.0.0',
    purpose: 'Normal product work',
    description: 'Standard product engineering, balancing implementation, testing, and review.',
    allowedActionClasses: ['read', 'write', 'create', 'execute', 'check'],
    readOnly: false,
    limits: {
      maxPackageBytes: 65536,
      maxSteps: 50,
      maxFiles: 50
    },
    requiredEvidence: ['test_run', 'work_receipt'],
    guidance: 'Follow normal ZETRO engineering guidelines. Verify all code changes with focused tests. Preserve documentation integrity and docstrings.'
  },
  eco: {
    id: 'eco',
    name: 'ECO Mode',
    version: '1.0.0',
    purpose: 'Small context, focused reads, and bounded checks',
    description: 'Resource-conserving mode with minimal context, targeted reads, and short turn execution.',
    allowedActionClasses: ['read', 'write', 'check'],
    readOnly: false,
    limits: {
      maxPackageBytes: 24576,
      maxSteps: 15,
      maxFiles: 10
    },
    requiredEvidence: ['work_receipt'],
    guidance: 'Minimize token and context consumption. Focus strictly on assigned target files. Avoid broad repository scans.'
  },
  build: {
    id: 'build',
    name: 'Build Mode',
    version: '1.0.0',
    purpose: 'Implementation with focused verification',
    description: 'Engineering implementation mode focused on code authoring, build resolution, and unit tests.',
    allowedActionClasses: ['read', 'write', 'create', 'execute', 'check'],
    readOnly: false,
    limits: {
      maxPackageBytes: 65536,
      maxSteps: 40,
      maxFiles: 30
    },
    requiredEvidence: ['build_clean', 'test_run', 'work_receipt'],
    guidance: 'Focus on incremental implementation. Run focused unit tests after changes. Ensure clean build and zero regression.'
  },
  review: {
    id: 'review',
    name: 'Review Mode',
    version: '1.0.0',
    purpose: 'Read-only inspection and evidence',
    description: 'Inspection and audit mode with strictly enforced read-only boundaries. Prohibits writes and destructive operations.',
    allowedActionClasses: ['read', 'check'],
    readOnly: true,
    limits: {
      maxPackageBytes: 49152,
      maxSteps: 20,
      maxFiles: 50
    },
    requiredEvidence: ['audit_report', 'findings_summary'],
    guidance: 'Inspect code and artifacts without mutating files or repository state. Report findings, discrepancies, and conformance evidence.'
  },
  design: {
    id: 'design',
    name: 'Design Mode',
    version: '1.0.0',
    purpose: 'Product and interface work',
    description: 'Product architecture, contract definition, UX specifications, and non-destructive prototyping.',
    allowedActionClasses: ['read', 'write', 'create', 'check'],
    readOnly: false,
    limits: {
      maxPackageBytes: 49152,
      maxSteps: 25,
      maxFiles: 20
    },
    requiredEvidence: ['architecture_spec', 'interface_contract'],
    guidance: 'Design interfaces, specifications, and architecture documents. Adhere to Satoshi typography and IFZ conventions.'
  },
  qualification: {
    id: 'qualification',
    name: 'Qualification Mode',
    version: '1.0.0',
    purpose: 'Strict independent testing',
    description: 'Adversarial and conformance testing mode requiring independent verifier evidence for all acceptance criteria.',
    allowedActionClasses: ['read', 'execute', 'check'],
    readOnly: true,
    limits: {
      maxPackageBytes: 65536,
      maxSteps: 30,
      maxFiles: 40
    },
    requiredEvidence: ['independent_verification', 'conformance_matrix', 'test_run'],
    guidance: 'Execute independent test suites and conformance checks. Self-reporting is not accepted as evidence.'
  },
  recovery: {
    id: 'recovery',
    name: 'Recovery Mode',
    version: '1.0.0',
    purpose: 'Inspect interrupted work before dispatch',
    description: 'Diagnostic and reconciliation mode to inspect interrupted or uncertain states before further action.',
    allowedActionClasses: ['read', 'check'],
    readOnly: true,
    limits: {
      maxPackageBytes: 32768,
      maxSteps: 15,
      maxFiles: 15
    },
    requiredEvidence: ['state_reconciliation_report', 'clean_baseline_check'],
    guidance: 'Inspect interrupted tasks, journals, and dirty workspace state. Reconcile differences before proposing dispatch or continuation.'
  }
};

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

export const PRESET_DEFINITIONS = deepFreeze(
  Object.fromEntries(Object.entries(RAW_PRESETS).map(([k, v]) => [k, { ...v, limits: { ...v.limits }, allowedActionClasses: [...v.allowedActionClasses], requiredEvidence: [...v.requiredEvidence] }]))
);

/**
 * Resolve a preset by name or identifier.
 *
 * @param {string} nameOrId
 * @returns {Readonly<object>}
 */
export function getPreset(nameOrId) {
  if (typeof nameOrId !== 'string' || !nameOrId.trim()) {
    throw new PresetError('Preset identifier must be a non-empty string');
  }
  const normalized = nameOrId.trim().toLowerCase().replace(/\s+/g, '_');
  for (const [id, preset] of Object.entries(PRESET_DEFINITIONS)) {
    if (id === normalized || preset.name.toLowerCase() === nameOrId.trim().toLowerCase()) {
      return preset;
    }
  }
  // Try matching prefix before "mode"
  const stripped = normalized.replace(/_mode$/, '');
  if (PRESET_DEFINITIONS[stripped]) {
    return PRESET_DEFINITIONS[stripped];
  }
  throw new PresetError(`Unknown preset: "${nameOrId}"`);
}

/**
 * List all available presets.
 *
 * @returns {ReadonlyArray<object>}
 */
export function listPresets() {
  return Object.values(PRESET_DEFINITIONS);
}

/**
 * Validate preset shape.
 *
 * @param {object} preset
 * @returns {boolean}
 */
export function validatePreset(preset) {
  if (!preset || typeof preset !== 'object') return false;
  if (typeof preset.id !== 'string' || !preset.id) return false;
  if (typeof preset.name !== 'string' || !preset.name) return false;
  if (typeof preset.version !== 'string' || !preset.version) return false;
  if (typeof preset.purpose !== 'string' || !preset.purpose) return false;
  if (!Array.isArray(preset.allowedActionClasses) || preset.allowedActionClasses.length === 0) return false;
  if (typeof preset.readOnly !== 'boolean') return false;
  if (!preset.limits || typeof preset.limits !== 'object') return false;
  if (!Number.isSafeInteger(preset.limits.maxPackageBytes) || preset.limits.maxPackageBytes <= 0) return false;
  if (!Number.isSafeInteger(preset.limits.maxSteps) || preset.limits.maxSteps <= 0) return false;
  return true;
}

/**
 * Apply a preset to a base execution or task configuration.
 *
 * Core Invariant: A preset may narrow work. It cannot weaken authority,
 * security, destination, or usage limits.
 *
 * @param {object} baseOptions - Baseline authority and policy configuration
 * @param {string|object} presetInput - Preset name, id, or preset object
 * @returns {object} Safe narrowed configuration
 */
export function applyPreset(baseOptions = {}, presetInput) {
  if (!baseOptions || typeof baseOptions !== 'object') {
    throw new InvalidPresetApplicationError('Base options must be an object');
  }

  const preset = typeof presetInput === 'string'
    ? getPreset(presetInput)
    : presetInput;

  if (!validatePreset(preset)) {
    throw new InvalidPresetApplicationError('Invalid preset structure provided');
  }

  // 1. Destination Invariant: Preset cannot change or expand destination
  const destination = baseOptions.destination !== undefined
    ? baseOptions.destination
    : null;

  if (preset.destination && destination && preset.destination !== destination) {
    throw new InvalidPresetApplicationError(
      `Preset cannot widen destination from "${destination}" to "${preset.destination}"`
    );
  }

  // 2. Project & Workspace Invariant: Preset cannot widen project or workspace
  const project = baseOptions.project !== undefined ? baseOptions.project : null;
  if (preset.project && project && preset.project !== project) {
    throw new InvalidPresetApplicationError(
      `Preset cannot widen project from "${project}" to "${preset.project}"`
    );
  }

  const workspace = baseOptions.workspace !== undefined ? baseOptions.workspace : null;
  if (preset.workspace && workspace && preset.workspace !== workspace) {
    throw new InvalidPresetApplicationError(
      `Preset cannot widen workspace from "${workspace}" to "${preset.workspace}"`
    );
  }

  // 3. Paths Invariant: Preset cannot expand ownedPaths beyond base
  const baseOwnedPaths = Array.isArray(baseOptions.ownedPaths) ? baseOptions.ownedPaths : null;
  let effectiveOwnedPaths = baseOwnedPaths;
  if (Array.isArray(preset.ownedPaths)) {
    if (baseOwnedPaths !== null) {
      const unauthorizedPaths = preset.ownedPaths.filter(p => !baseOwnedPaths.includes(p));
      if (unauthorizedPaths.length > 0) {
        throw new InvalidPresetApplicationError(
          `Preset cannot widen owned paths beyond base: [${unauthorizedPaths.join(', ')}]`
        );
      }
      effectiveOwnedPaths = preset.ownedPaths;
    } else {
      effectiveOwnedPaths = preset.ownedPaths;
    }
  }

  // 4. ReadOnly Invariant: If base is readOnly, preset cannot make it writable
  const baseReadOnly = Boolean(baseOptions.readOnly);
  if (baseReadOnly && preset.readOnly === false && presetInput && typeof presetInput === 'object') {
    throw new InvalidPresetApplicationError('Preset cannot disable read-only constraint on a read-only base');
  }
  const effectiveReadOnly = baseReadOnly || preset.readOnly;

  // 5. Authority / Action Classes Invariant:
  // Base allowed action classes define the absolute ceiling.
  // The preset strictly narrows work: effective actions = intersection(base, preset).
  const baseActionClasses = Array.isArray(baseOptions.allowedActionClasses)
    ? baseOptions.allowedActionClasses
    : ['read', 'write', 'create', 'execute', 'check'];

  if (baseOptions.strictAuthority === true) {
    const unauthorizedClasses = preset.allowedActionClasses.filter(c => !baseActionClasses.includes(c));
    if (unauthorizedClasses.length > 0) {
      throw new InvalidPresetApplicationError(
        `Preset cannot expand action classes beyond base authority: [${unauthorizedClasses.join(', ')}]`
      );
    }
  }

  // Resulting action classes are the strict intersection (narrows work)
  let effectiveActionClasses = preset.allowedActionClasses.filter(c => baseActionClasses.includes(c));
  if (effectiveReadOnly) {
    // If effectiveReadOnly is true, strip mutating classes
    effectiveActionClasses = effectiveActionClasses.filter(c => c === 'read' || c === 'check');
  }

  // 6. Security Invariant: Preset cannot weaken security flags
  const baseSecurity = baseOptions.security || {};
  const effectiveSecurity = { ...baseSecurity };
  if (baseSecurity.allowExternalSend === false && preset.allowExternalSend === true) {
    throw new InvalidPresetApplicationError('Preset cannot enable external sends when prohibited by base security');
  }

  // 7. Usage Limits Invariant:
  // Presets must NEVER widen time, tokens, provider attempts, worker count, depth, branches, or byte limits.
  const baseLimits = baseOptions.limits || {};
  const presetLimits = preset.limits || {};

  const budgetKeys = [
    { key: 'maxPackageBytes', label: 'byte limit' },
    { key: 'maxSteps', label: 'step limit' },
    { key: 'maxFiles', label: 'file limit' },
    { key: 'timeoutMs', label: 'time limit' },
    { key: 'maxTokens', label: 'token limit' },
    { key: 'maxProviderAttempts', label: 'provider attempts' },
    { key: 'maxWorkers', label: 'worker count' },
    { key: 'maxDepth', label: 'delegation depth' },
    { key: 'maxBranches', label: 'branch count' }
  ];

  const effectiveLimits = {};
  for (const { key, label } of budgetKeys) {
    const hasBase = Number.isSafeInteger(baseLimits[key]) && baseLimits[key] > 0;
    const hasPreset = Number.isSafeInteger(presetLimits[key]) && presetLimits[key] > 0;

    if (hasBase && hasPreset) {
      if (baseOptions.strictLimits === true && presetLimits[key] > baseLimits[key]) {
        throw new InvalidPresetApplicationError(
          `Preset cannot widen ${label} (${key}): ${presetLimits[key]} > ${baseLimits[key]}`
        );
      }
      // Never widen: clamp to minimum of base and preset
      effectiveLimits[key] = Math.min(baseLimits[key], presetLimits[key]);
    } else if (hasBase) {
      effectiveLimits[key] = baseLimits[key];
    } else if (hasPreset) {
      effectiveLimits[key] = presetLimits[key];
    }
  }

  // 8. Delegation Authority Invariant
  if (baseOptions.allowDelegation === false && preset.allowDelegation === true) {
    throw new InvalidPresetApplicationError('Preset cannot enable delegation when disabled by base authority');
  }

  // Required evidence: union of base required evidence and preset required evidence
  const baseEvidence = Array.isArray(baseOptions.requiredEvidence) ? baseOptions.requiredEvidence : [];
  const presetEvidence = Array.isArray(preset.requiredEvidence) ? preset.requiredEvidence : [];
  const effectiveEvidence = Array.from(new Set([...baseEvidence, ...presetEvidence]));

  return Object.freeze({
    ...baseOptions,
    destination,
    project,
    workspace,
    ownedPaths: effectiveOwnedPaths ? Object.freeze([...effectiveOwnedPaths]) : undefined,
    readOnly: effectiveReadOnly,
    allowedActionClasses: Object.freeze(effectiveActionClasses),
    limits: Object.freeze(effectiveLimits),
    security: Object.freeze(effectiveSecurity),
    requiredEvidence: Object.freeze(effectiveEvidence),
    preset: preset.name,
    presetId: preset.id,
    presetVersion: preset.version,
    presetGuidance: preset.guidance
  });
}
