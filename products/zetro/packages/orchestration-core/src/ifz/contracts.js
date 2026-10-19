/**
 * @file ifz/contracts.js
 * Validated schema definitions, validators, and factories for IFZ Unified Architecture.
 *
 * Enforces:
 * 1. Exact identities: worker, adapter, project, workspace, task, run, conversation, cancellation.
 * 2. Distinct effect classes: read, write, create, execute, external-send, inference, computer.
 * 3. Strict boolean typing (literal booleans required, no truthy coercion).
 * 4. Canonical route strategies: parallel, sequential, review-chain, first-verified, compare, bounded-delegation (no underscore aliases).
 * 5. Input bounds and defenses: rejects non-plain objects, accessors, unsafe prototypes, control characters, NaN/Infinity, duplicates, malformed nested arrays, and cyclic payloads.
 * 6. Authority growth prevention: child envelopes / delegations cannot exceed parent scopes or budgets.
 * 7. Secret-free, privacy-preserving delivery receipts (no prompts, credentials, or raw reasoning).
 * 8. Deep freeze immutability on all validated contract objects.
 */

import { createHash } from 'node:crypto';

export const SCHEMA_VERSIONS = Object.freeze({
  WORKER_MANIFEST: 'zetro.ifz.worker_manifest.v1',
  TASK_ENVELOPE: 'zetro.ifz.task_envelope.v1',
  ROUTE_REQUEST: 'zetro.ifz.route_request.v1',
  CONTEXT_REFERENCE: 'zetro.ifz.context_reference.v1',
  PUBLIC_EVENT: 'zetro.ifz.public_event.v1',
  DELIVERY_RECEIPT: 'zetro.ifz.delivery_receipt.v1'
});

export const EFFECT_CLASSES = Object.freeze([
  'read',
  'write',
  'create',
  'execute',
  'external-send',
  'inference',
  'computer'
]);

export const ROUTE_STRATEGIES = Object.freeze([
  'parallel',
  'sequential',
  'review-chain',
  'first-verified',
  'compare',
  'bounded-delegation'
]);

export const CONTEXT_KINDS = Object.freeze([
  'project_context',
  'task_package',
  'master_prompt',
  'attachment',
  'shared_context',
  'evidence'
]);

export const PUBLIC_EVENT_TYPES = Object.freeze([
  'user_prompt',
  'ifz_route_plan',
  'worker_request',
  'worker_public_status',
  'worker_result',
  'verification_result',
  'handoff',
  'question',
  'approval_request',
  'failure',
  'cancellation'
]);

export const WORKER_AVAILABILITY_STATUSES = Object.freeze([
  'idle',
  'available',
  'busy',
  'running',
  'unavailable',
  'offline'
]);

export const RECEIPT_STATUSES = Object.freeze([
  'submitted',
  'completed',
  'failed',
  'cancelled',
  'uncertain',
  'rejected'
]);

export const MAX_PAYLOAD_DEPTH = 16;
export const MAX_ARRAY_LENGTH = 512;
export const MAX_OBJECT_KEYS = 128;
export const MAX_STRING_BYTES = 65536; // 64 KB
export const MAX_IDENTITY_BYTES = 256;
export const MAX_TOTAL_BYTES = 1048576; // 1 MB
export const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F-\x9F]/;
export const FORBIDDEN_PROPERTY_NAMES = Object.freeze(['__proto__', 'prototype', 'constructor']);

const PROHIBITED_RECEIPT_FIELDS = Object.freeze([
  'prompt',
  'promptText',
  'source',
  'sourceCode',
  'secrets',
  'secret',
  'password',
  'token',
  'credentials',
  'credential',
  'rawReasoning',
  'privateReasoning',
  'modelThinking'
]);

export class IfzValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'IfzValidationError';
    this.errors = errors;
  }
}

export class IfzAuthorityGrowthError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'IfzAuthorityGrowthError';
    this.details = details;
  }
}

export class IfzConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'IfzConflictError';
    this.details = details;
  }
}

/**
 * Checks whether an entity is a plain object without custom prototype.
 * @param {unknown} val
 * @returns {boolean}
 */
export function isPlainObject(val) {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

/**
 * Validates payload bounds, detects circular references, forbids accessors,
 * prototype pollution, NaN, Infinity, and control characters.
 *
 * @param {unknown} input
 * @param {object} [options]
 * @returns {boolean}
 */
export function sanitizeAndBoundPayload(input, {
  maxDepth = MAX_PAYLOAD_DEPTH,
  maxTotalBytes = MAX_TOTAL_BYTES,
  allowControlChars = false
} = {}) {
  let totalBytes = 0;
  const activeStack = new Set();

  function traverse(node, currentDepth, path) {
    if (node === null || node === undefined) {
      totalBytes += 4;
      if (totalBytes > maxTotalBytes) {
        throw new IfzValidationError(`Payload serialized size exceeds maximum limit of ${maxTotalBytes} bytes`);
      }
      return;
    }

    if (typeof node === 'boolean') {
      totalBytes += 4;
      if (totalBytes > maxTotalBytes) {
        throw new IfzValidationError(`Payload serialized size exceeds maximum limit of ${maxTotalBytes} bytes`);
      }
      return;
    }

    if (typeof node === 'number') {
      if (Number.isNaN(node) || !Number.isFinite(node)) {
        throw new IfzValidationError(`NaN and Infinity are prohibited in contract payloads at ${path}`);
      }
      totalBytes += 8;
      if (totalBytes > maxTotalBytes) {
        throw new IfzValidationError(`Payload serialized size exceeds maximum limit of ${maxTotalBytes} bytes`);
      }
      return;
    }

    if (typeof node === 'string') {
      const bytes = Buffer.byteLength(node, 'utf8');
      if (bytes > MAX_STRING_BYTES) {
        throw new IfzValidationError(`String at ${path} exceeds maximum byte length (${bytes} > ${MAX_STRING_BYTES})`);
      }
      if (!allowControlChars && CONTROL_CHAR_REGEX.test(node)) {
        throw new IfzValidationError(`Control characters detected in string at ${path}`);
      }
      totalBytes += bytes;
      if (totalBytes > maxTotalBytes) {
        throw new IfzValidationError(`Payload serialized size exceeds maximum limit of ${maxTotalBytes} bytes`);
      }
      return;
    }

    if (typeof node === 'function' || typeof node === 'symbol' || typeof node === 'bigint') {
      throw new IfzValidationError(`Unsupported primitive type '${typeof node}' at ${path}`);
    }

    if (typeof node === 'object') {
      if (activeStack.has(node)) {
        throw new IfzValidationError(`Circular reference detected at ${path}; cyclic structures are prohibited`);
      }
      activeStack.add(node);

      try {
        if (currentDepth > maxDepth) {
          throw new IfzValidationError(`Payload nesting depth at ${path} exceeds maximum limit of ${maxDepth}`);
        }

        if (Array.isArray(node)) {
          if (node.length > MAX_ARRAY_LENGTH) {
            throw new IfzValidationError(`Array at ${path} length (${node.length}) exceeds maximum allowed length of ${MAX_ARRAY_LENGTH}`);
          }
          totalBytes += 2;
          for (let i = 0; i < node.length; i++) {
            traverse(node[i], currentDepth + 1, `${path}[${i}]`);
          }
          return;
        }

        const proto = Object.getPrototypeOf(node);
        if (proto !== Object.prototype && proto !== null) {
          throw new IfzValidationError(`Non-plain object detected at ${path}; only plain objects are permitted`);
        }

        const descriptors = Object.getOwnPropertyDescriptors(node);
        const keys = Object.keys(descriptors);

        if (keys.length > MAX_OBJECT_KEYS) {
          throw new IfzValidationError(`Object at ${path} key count (${keys.length}) exceeds maximum limit of ${MAX_OBJECT_KEYS}`);
        }

        for (const key of keys) {
          if (FORBIDDEN_PROPERTY_NAMES.includes(key)) {
            throw new IfzValidationError(`Forbidden property name '${key}' detected at ${path}`);
          }
          const desc = descriptors[key];
          if (typeof desc.get === 'function' || typeof desc.set === 'function') {
            throw new IfzValidationError(`Property accessor (getter/setter) '${key}' prohibited at ${path}`);
          }
          const keyBytes = Buffer.byteLength(key, 'utf8');
          totalBytes += keyBytes + 2;
          traverse(node[key], currentDepth + 1, `${path}.${key}`);
        }
      } finally {
        activeStack.delete(node);
      }
      return;
    }

    throw new IfzValidationError(`Unexpected value at ${path}`);
  }

  traverse(input, 0, '$');
  return true;
}

/**
 * Deep freezes an object recursively with cycle and bounded checks.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  sanitizeAndBoundPayload(obj);
  const seen = new WeakSet();

  function freezeRecursive(val) {
    if (val === null || typeof val !== 'object' || Object.isFrozen(val)) return val;
    if (seen.has(val)) return val;
    seen.add(val);
    Object.freeze(val);
    for (const key of Object.getOwnPropertyNames(val)) {
      const prop = val[key];
      if (prop !== null && typeof prop === 'object') {
        freezeRecursive(prop);
      }
    }
    return val;
  }

  return freezeRecursive(obj);
}

/**
 * Deep clones any JSON-serializable value with cycle detection and bounding.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  sanitizeAndBoundPayload(obj);
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Deterministic canonical JSON stringification for hashing.
 */
export function canonicalJson(val) {
  sanitizeAndBoundPayload(val);
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map(canonicalJson).join(',')}]`;
  }
  const keys = Object.keys(val).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(val[k])}`).join(',')}}`;
}

/**
 * Computes canonical SHA-256 digest in hex.
 */
export function computeSha256(data) {
  const serialized = typeof data === 'string' ? data : canonicalJson(data);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

export function validateIdentity(val, fieldName, errors) {
  if (typeof val !== 'string') {
    errors.push(`${fieldName} must be a non-empty string`);
    return null;
  }
  const trimmed = val.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    errors.push(`${fieldName} must be a non-empty string between 1 and 128 characters`);
    return null;
  }
  if (CONTROL_CHAR_REGEX.test(val)) {
    errors.push(`${fieldName} contains forbidden control characters`);
    return null;
  }
  const bytes = Buffer.byteLength(val, 'utf8');
  if (bytes > MAX_IDENTITY_BYTES) {
    errors.push(`${fieldName} exceeds maximum identity bytes (${MAX_IDENTITY_BYTES})`);
    return null;
  }
  return trimmed;
}

export function validateStrictBoolean(val, fieldName, errors) {
  if (typeof val !== 'boolean') {
    errors.push(`${fieldName} must be a strict boolean (true/false), got ${typeof val}`);
    return false;
  }
  return val;
}

export function validatePositiveInt(val, fieldName, errors, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < min || val > max) {
    errors.push(`${fieldName} must be an integer between ${min} and ${max}`);
    return null;
  }
  return val;
}

export function validateEffectsArray(effects, fieldName, errors) {
  if (!Array.isArray(effects)) {
    errors.push(`${fieldName} must be an array of effect classes`);
    return [];
  }
  if (effects.length > EFFECT_CLASSES.length) {
    errors.push(`${fieldName} exceeds maximum allowable distinct effects (${EFFECT_CLASSES.length})`);
    return [];
  }
  const clean = [];
  const seen = new Set();
  for (let i = 0; i < effects.length; i++) {
    const eff = effects[i];
    if (typeof eff !== 'string' || !EFFECT_CLASSES.includes(eff)) {
      errors.push(`${fieldName}[${i}] contains unknown effect class '${eff}'; allowed: ${EFFECT_CLASSES.join(', ')}`);
    } else if (seen.has(eff)) {
      errors.push(`${fieldName} contains duplicate effect '${eff}'`);
    } else {
      seen.add(eff);
      clean.push(eff);
    }
  }
  return clean;
}

export function validateStringArray(arr, fieldName, errors, { allowEmpty = true, maxItems = 128 } = {}) {
  if (!Array.isArray(arr)) {
    errors.push(`${fieldName} must be an array of strings`);
    return [];
  }
  if (!allowEmpty && arr.length === 0) {
    errors.push(`${fieldName} must not be empty`);
    return [];
  }
  if (arr.length > maxItems) {
    errors.push(`${fieldName} exceeds maximum allowed length of ${maxItems}`);
    return [];
  }
  const clean = [];
  const seen = new Set();
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeof item !== 'string') {
      errors.push(`${fieldName}[${i}] must be a string, got ${typeof item}`);
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      errors.push(`${fieldName}[${i}] must not be empty or whitespace-only`);
      continue;
    }
    if (CONTROL_CHAR_REGEX.test(item)) {
      errors.push(`${fieldName}[${i}] contains forbidden control characters`);
      continue;
    }
    if (seen.has(trimmed)) {
      errors.push(`${fieldName} contains duplicate entry '${trimmed}'`);
      continue;
    }
    seen.add(trimmed);
    clean.push(trimmed);
  }
  return clean;
}

/**
 * Validates a WorkerManifest object.
 */
export function validateWorkerManifest(input, { throwOnError = true } = {}) {
  sanitizeAndBoundPayload(input);
  const errors = [];

  if (!isPlainObject(input)) {
    const err = new IfzValidationError('WorkerManifest must be a plain object', ['Root must be a plain object']);
    if (throwOnError) throw err;
    return null;
  }

  if (input.schemaVersion !== SCHEMA_VERSIONS.WORKER_MANIFEST) {
    errors.push(`schemaVersion must be '${SCHEMA_VERSIONS.WORKER_MANIFEST}', got '${input.schemaVersion}'`);
  }

  const workerId = validateIdentity(input.workerId, 'workerId', errors);
  const workerType = validateIdentity(input.workerType, 'workerType', errors);
  const adapterId = validateIdentity(input.adapterId, 'adapterId', errors);
  const projectId = validateIdentity(input.projectId, 'projectId', errors);
  const workspaceId = validateIdentity(input.workspaceId, 'workspaceId', errors);
  const revision = validatePositiveInt(input.revision, 'revision', errors, { min: 1 });

  // Capabilities
  let cleanCapabilities = {};
  if (!input.capabilities || !isPlainObject(input.capabilities)) {
    errors.push('capabilities must be a plain object');
  } else {
    const effects = validateEffectsArray(input.capabilities.effects, 'capabilities.effects', errors);
    const actions = validateStringArray(input.capabilities.actions || [], 'capabilities.actions', errors, { allowEmpty: true, maxItems: 64 });
    const contextTypes = validateStringArray(input.capabilities.contextTypes || [], 'capabilities.contextTypes', errors, { allowEmpty: true, maxItems: 32 });
    const canDelegate = validateStrictBoolean(input.capabilities.canDelegate, 'capabilities.canDelegate', errors);
    const supportsCancellation = validateStrictBoolean(input.capabilities.supportsCancellation, 'capabilities.supportsCancellation', errors);
    const supportsResume = validateStrictBoolean(input.capabilities.supportsResume, 'capabilities.supportsResume', errors);

    cleanCapabilities = {
      effects,
      actions,
      contextTypes,
      canDelegate,
      supportsCancellation,
      supportsResume
    };
  }

  // Limits
  let cleanLimits = { maxConcurrency: 1, maxDurationMs: 60000 };
  if (input.limits !== undefined) {
    if (!input.limits || !isPlainObject(input.limits)) {
      errors.push('limits must be a plain object');
    } else {
      const maxConcurrency = validatePositiveInt(input.limits.maxConcurrency ?? 1, 'limits.maxConcurrency', errors, { min: 1, max: 256 });
      const maxDurationMs = validatePositiveInt(input.limits.maxDurationMs ?? 60000, 'limits.maxDurationMs', errors, { min: 100, max: 3600000 });
      cleanLimits = {
        maxConcurrency: maxConcurrency ?? 1,
        maxDurationMs: maxDurationMs ?? 60000
      };
    }
  }

  // Delegation
  let cleanDelegation = { canDelegate: false, maxDelegationDepth: 0, allowedDelegateTypes: [] };
  const rawDelegation = input.delegation ?? (input.capabilities ? { canDelegate: input.capabilities.canDelegate, maxDelegationDepth: 2 } : {});
  if (!rawDelegation || !isPlainObject(rawDelegation)) {
    errors.push('delegation must be a plain object');
  } else {
    const canDelegate = validateStrictBoolean(rawDelegation.canDelegate ?? cleanCapabilities.canDelegate ?? false, 'delegation.canDelegate', errors);
    const maxDelegationDepth = validatePositiveInt(rawDelegation.maxDelegationDepth ?? 0, 'delegation.maxDelegationDepth', errors, { min: 0, max: 10 });
    const allowedDelegateTypes = validateStringArray(rawDelegation.allowedDelegateTypes || [], 'delegation.allowedDelegateTypes', errors, { allowEmpty: true, maxItems: 32 });
    cleanDelegation = {
      canDelegate,
      maxDelegationDepth: maxDelegationDepth ?? 0,
      allowedDelegateTypes
    };
  }

  // Qualification
  let cleanQualification = { roles: [], certifications: [], tags: [], level: 'standard' };
  if (input.qualification !== undefined) {
    if (!input.qualification || !isPlainObject(input.qualification)) {
      errors.push('qualification must be a plain object');
    } else {
      const roles = validateStringArray(input.qualification.roles || [], 'qualification.roles', errors, { allowEmpty: true, maxItems: 32 });
      const certifications = validateStringArray(input.qualification.certifications || [], 'qualification.certifications', errors, { allowEmpty: true, maxItems: 32 });
      const tags = validateStringArray(input.qualification.tags || [], 'qualification.tags', errors, { allowEmpty: true, maxItems: 32 });
      const level = input.qualification.level ? validateIdentity(input.qualification.level, 'qualification.level', errors) : 'standard';
      cleanQualification = {
        roles,
        certifications,
        tags,
        level: level || 'standard'
      };
    }
  }

  // Observation & Availability
  const rawObs = input.observation || input.availability;
  let cleanObservation = {};
  if (!rawObs || !isPlainObject(rawObs)) {
    errors.push('observation or availability must be a plain object');
  } else {
    const status = rawObs.status;
    if (typeof status !== 'string' || !WORKER_AVAILABILITY_STATUSES.includes(status)) {
      errors.push(`observation.status must be one of: ${WORKER_AVAILABILITY_STATUSES.join(', ')}; completion must not be implied`);
    }
    const observedAt = validatePositiveInt(rawObs.observedAt, 'observation.observedAt', errors, { min: 1 });
    cleanObservation = {
      status,
      observedAt: observedAt ?? Date.now()
    };
  }

  if (errors.length > 0) {
    const err = new IfzValidationError(`WorkerManifest validation failed: ${errors.join('; ')}`, errors);
    if (throwOnError) throw err;
    return null;
  }

  return deepFreeze({
    schemaVersion: SCHEMA_VERSIONS.WORKER_MANIFEST,
    workerId,
    workerType,
    adapterId,
    revision,
    projectId,
    workspaceId,
    observation: cleanObservation,
    availability: { ...cleanObservation },
    capabilities: cleanCapabilities,
    limits: cleanLimits,
    delegation: cleanDelegation,
    qualification: cleanQualification,
    metadata: input.metadata && isPlainObject(input.metadata) ? deepClone(input.metadata) : {}
  });
}

/**
 * Creates and validates a WorkerManifest.
 */
export function createWorkerManifest(params) {
  sanitizeAndBoundPayload(params);
  const obs = params.observation || params.availability || {
    status: 'available',
    observedAt: Date.now()
  };

  const raw = {
    schemaVersion: SCHEMA_VERSIONS.WORKER_MANIFEST,
    revision: 1,
    limits: { maxConcurrency: 1, maxDurationMs: 60000 },
    observation: {
      status: obs.status ?? 'available',
      observedAt: obs.observedAt ?? Date.now()
    },
    delegation: {
      canDelegate: params.capabilities?.canDelegate ?? false,
      maxDelegationDepth: 2,
      allowedDelegateTypes: []
    },
    qualification: {
      roles: [],
      certifications: [],
      tags: [],
      level: 'standard'
    },
    ...params
  };
  return validateWorkerManifest(raw, { throwOnError: true });
}

/**
 * Validates a ContextReference object.
 */
export function validateContextReference(input, { throwOnError = true } = {}) {
  sanitizeAndBoundPayload(input);
  const errors = [];
  if (!isPlainObject(input)) {
    const err = new IfzValidationError('ContextReference must be a plain object', ['Root must be a plain object']);
    if (throwOnError) throw err;
    return null;
  }

  if (input.schemaVersion !== SCHEMA_VERSIONS.CONTEXT_REFERENCE) {
    errors.push(`schemaVersion must be '${SCHEMA_VERSIONS.CONTEXT_REFERENCE}', got '${input.schemaVersion}'`);
  }

  const contextId = validateIdentity(input.contextId, 'contextId', errors);
  const conversationId = validateIdentity(input.conversationId, 'conversationId', errors);
  const runId = validateIdentity(input.runId, 'runId', errors);

  if (typeof input.kind !== 'string' || !CONTEXT_KINDS.includes(input.kind)) {
    errors.push(`kind must be one of: ${CONTEXT_KINDS.join(', ')}, got '${input.kind}'`);
  }

  if (typeof input.digest !== 'string' || !/^[a-f0-9]{64}$/i.test(input.digest)) {
    errors.push('digest must be a 64-character hex SHA-256 string');
  }

  const byteLength = validatePositiveInt(input.byteLength, 'byteLength', errors, { min: 0, max: 104857600 });
  const createdAt = validatePositiveInt(input.createdAt, 'createdAt', errors, { min: 1 });

  if (errors.length > 0) {
    const err = new IfzValidationError(`ContextReference validation failed: ${errors.join('; ')}`, errors);
    if (throwOnError) throw err;
    return null;
  }

  return deepFreeze({
    schemaVersion: SCHEMA_VERSIONS.CONTEXT_REFERENCE,
    contextId,
    conversationId,
    runId,
    kind: input.kind,
    version: input.version || '1.0.0',
    digest: input.digest.toLowerCase(),
    byteLength: byteLength ?? 0,
    uri: typeof input.uri === 'string' ? input.uri : null,
    summary: typeof input.summary === 'string' ? input.summary.slice(0, 300) : null,
    createdAt: createdAt ?? Date.now()
  });
}

/**
 * Creates and validates a ContextReference.
 */
export function createContextReference(params) {
  const raw = {
    schemaVersion: SCHEMA_VERSIONS.CONTEXT_REFERENCE,
    version: '1.0.0',
    createdAt: Date.now(),
    ...params
  };
  return validateContextReference(raw, { throwOnError: true });
}

/**
 * Validates a RouteRequest object.
 * Enforces canonical route strategy identifiers without underscore aliases.
 */
export function validateRouteRequest(input, { throwOnError = true } = {}) {
  sanitizeAndBoundPayload(input);
  const errors = [];
  if (!isPlainObject(input)) {
    const err = new IfzValidationError('RouteRequest must be a plain object', ['Root must be a plain object']);
    if (throwOnError) throw err;
    return null;
  }

  if (input.schemaVersion !== SCHEMA_VERSIONS.ROUTE_REQUEST) {
    errors.push(`schemaVersion must be '${SCHEMA_VERSIONS.ROUTE_REQUEST}', got '${input.schemaVersion}'`);
  }

  const requestId = validateIdentity(input.requestId, 'requestId', errors);
  const runId = validateIdentity(input.runId, 'runId', errors);
  const conversationId = validateIdentity(input.conversationId, 'conversationId', errors);
  const sourceWorkerId = validateIdentity(input.sourceWorkerId, 'sourceWorkerId', errors);

  const destinationWorkerIds = validateStringArray(input.destinationWorkerIds, 'destinationWorkerIds', errors, { allowEmpty: false, maxItems: 64 });

  if (typeof input.strategy !== 'string' || !ROUTE_STRATEGIES.includes(input.strategy)) {
    errors.push(`strategy must be one of: ${ROUTE_STRATEGIES.join(', ')}, got '${input.strategy}'`);
  }

  if (typeof input.objective !== 'string' || input.objective.trim().length === 0 || input.objective.length > 2000) {
    errors.push('objective must be a non-empty string up to 2000 characters');
  }

  const requiredEffects = validateEffectsArray(input.requiredEffects, 'requiredEffects', errors);

  let cleanContextRefs = [];
  if (Array.isArray(input.contextReferences)) {
    cleanContextRefs = input.contextReferences.map((ref, idx) => {
      try {
        return validateContextReference(ref, { throwOnError: true });
      } catch (err) {
        errors.push(`contextReferences[${idx}] invalid: ${err.message}`);
        return null;
      }
    }).filter(Boolean);
  }

  const maxDelegationDepth = validatePositiveInt(input.maxDelegationDepth ?? 2, 'maxDelegationDepth', errors, { min: 0, max: 10 });
  const requestedAt = validatePositiveInt(input.requestedAt ?? Date.now(), 'requestedAt', errors, { min: 1 });

  if (errors.length > 0) {
    const err = new IfzValidationError(`RouteRequest validation failed: ${errors.join('; ')}`, errors);
    if (throwOnError) throw err;
    return null;
  }

  return deepFreeze({
    schemaVersion: SCHEMA_VERSIONS.ROUTE_REQUEST,
    requestId,
    runId,
    conversationId,
    sourceWorkerId,
    destinationWorkerIds,
    strategy: input.strategy,
    objective: input.objective.trim(),
    requiredEffects,
    contextReferences: cleanContextRefs,
    maxDelegationDepth: maxDelegationDepth ?? 2,
    requestedAt: requestedAt ?? Date.now()
  });
}

/**
 * Creates and validates a RouteRequest.
 */
export function createRouteRequest(params) {
  const raw = {
    schemaVersion: SCHEMA_VERSIONS.ROUTE_REQUEST,
    strategy: 'sequential',
    maxDelegationDepth: 2,
    requestedAt: Date.now(),
    requiredEffects: [],
    contextReferences: [],
    ...params
  };
  return validateRouteRequest(raw, { throwOnError: true });
}

/**
 * Validates a TaskEnvelope object.
 * Enforces exact IDs, Master Prompt/context versions, scopes, and budgets.
 */
export function validateTaskEnvelope(input, { throwOnError = true } = {}) {
  sanitizeAndBoundPayload(input);
  const errors = [];
  if (!isPlainObject(input)) {
    const err = new IfzValidationError('TaskEnvelope must be a plain object', ['Root must be a plain object']);
    if (throwOnError) throw err;
    return null;
  }

  if (input.schemaVersion !== SCHEMA_VERSIONS.TASK_ENVELOPE) {
    errors.push(`schemaVersion must be '${SCHEMA_VERSIONS.TASK_ENVELOPE}', got '${input.schemaVersion}'`);
  }

  const taskId = validateIdentity(input.taskId, 'taskId', errors);
  const runId = validateIdentity(input.runId, 'runId', errors);
  const conversationId = validateIdentity(input.conversationId, 'conversationId', errors);
  const parentTaskId = input.parentTaskId ? validateIdentity(input.parentTaskId, 'parentTaskId', errors) : null;
  const sourceWorkerId = validateIdentity(input.sourceWorkerId, 'sourceWorkerId', errors);
  const destinationWorkerId = validateIdentity(input.destinationWorkerId, 'destinationWorkerId', errors);
  const projectId = validateIdentity(input.projectId, 'projectId', errors);
  const workspaceId = validateIdentity(input.workspaceId, 'workspaceId', errors);
  const cancellationId = validateIdentity(input.cancellationId, 'cancellationId', errors);

  if (typeof input.objective !== 'string' || input.objective.trim().length === 0 || input.objective.length > 2000) {
    errors.push('objective must be a non-empty string up to 2000 characters');
  }

  const masterPromptVersion = validateIdentity(input.masterPromptVersion, 'masterPromptVersion', errors);
  const contextVersion = input.contextVersion ? validateIdentity(input.contextVersion, 'contextVersion', errors) : '1.0.0';

  // Scopes
  let cleanScopes = {};
  if (!input.scopes || !isPlainObject(input.scopes)) {
    errors.push('scopes must be a plain object');
  } else {
    const effects = validateEffectsArray(input.scopes.effects, 'scopes.effects', errors);
    const readPaths = validateStringArray(input.scopes.readPaths || [], 'scopes.readPaths', errors, { allowEmpty: true, maxItems: 64 });
    const writePaths = validateStringArray(input.scopes.writePaths || [], 'scopes.writePaths', errors, { allowEmpty: true, maxItems: 64 });
    const createPaths = validateStringArray(input.scopes.createPaths || [], 'scopes.createPaths', errors, { allowEmpty: true, maxItems: 64 });
    cleanScopes = {
      effects,
      readPaths,
      writePaths,
      createPaths
    };
  }

  // Budgets
  let cleanBudgets = {};
  const rawBudgets = input.budgets ?? input.limits ?? {};
  if (!isPlainObject(rawBudgets)) {
    errors.push('budgets must be a plain object');
  } else {
    const timeBudgetMs = validatePositiveInt(rawBudgets.timeBudgetMs ?? rawBudgets.maxDurationMs ?? 60000, 'budgets.timeBudgetMs', errors, { min: 100, max: 3600000 });
    const tokenBudget = validatePositiveInt(rawBudgets.tokenBudget ?? 100000, 'budgets.tokenBudget', errors, { min: 1, max: 10000000 });
    const providerBudget = validatePositiveInt(rawBudgets.providerBudget ?? 5, 'budgets.providerBudget', errors, { min: 1, max: 100 });
    const workerBudget = validatePositiveInt(rawBudgets.workerBudget ?? 10, 'budgets.workerBudget', errors, { min: 1, max: 64 });
    const depthBudget = validatePositiveInt(rawBudgets.depthBudget ?? rawBudgets.maxDelegationDepth ?? 2, 'budgets.depthBudget', errors, { min: 0, max: 10 });
    const branchBudget = validatePositiveInt(rawBudgets.branchBudget ?? 4, 'budgets.branchBudget', errors, { min: 1, max: 64 });

    cleanBudgets = {
      timeBudgetMs: timeBudgetMs ?? 60000,
      tokenBudget: tokenBudget ?? 100000,
      providerBudget: providerBudget ?? 5,
      workerBudget: workerBudget ?? 10,
      depthBudget: depthBudget ?? 2,
      branchBudget: branchBudget ?? 4
    };
  }

  // Limits view (kept in sync)
  const delegationDepth = validatePositiveInt(input.limits?.delegationDepth ?? 0, 'limits.delegationDepth', errors, { min: 0, max: 10 });
  const cleanLimits = {
    delegationDepth: delegationDepth ?? 0,
    maxDelegationDepth: cleanBudgets.depthBudget,
    maxDurationMs: cleanBudgets.timeBudgetMs
  };

  let cleanContextRefs = [];
  if (Array.isArray(input.contextReferences)) {
    cleanContextRefs = input.contextReferences.map((ref, idx) => {
      try {
        return validateContextReference(ref, { throwOnError: true });
      } catch (err) {
        errors.push(`contextReferences[${idx}] invalid: ${err.message}`);
        return null;
      }
    }).filter(Boolean);
  }

  const dispatchedAt = validatePositiveInt(input.dispatchedAt ?? Date.now(), 'dispatchedAt', errors, { min: 1 });

  if (errors.length > 0) {
    const err = new IfzValidationError(`TaskEnvelope validation failed: ${errors.join('; ')}`, errors);
    if (throwOnError) throw err;
    return null;
  }

  return deepFreeze({
    schemaVersion: SCHEMA_VERSIONS.TASK_ENVELOPE,
    taskId,
    runId,
    conversationId,
    parentTaskId,
    sourceWorkerId,
    destinationWorkerId,
    objective: input.objective.trim(),
    masterPromptVersion,
    contextVersion,
    contextReferences: cleanContextRefs,
    projectId,
    workspaceId,
    scopes: cleanScopes,
    budgets: cleanBudgets,
    limits: cleanLimits,
    cancellationId,
    dispatchedAt: dispatchedAt ?? Date.now()
  });
}

/**
 * Creates and validates a TaskEnvelope.
 */
export function createTaskEnvelope(params) {
  const timeBudgetMs = params.budgets?.timeBudgetMs ?? params.limits?.maxDurationMs ?? 60000;
  const depthBudget = params.budgets?.depthBudget ?? params.limits?.maxDelegationDepth ?? 2;

  const raw = {
    schemaVersion: SCHEMA_VERSIONS.TASK_ENVELOPE,
    parentTaskId: null,
    contextVersion: '1.0.0',
    contextReferences: [],
    scopes: { effects: ['read'], readPaths: [], writePaths: [], createPaths: [] },
    limits: { delegationDepth: params.limits?.delegationDepth ?? 0, maxDelegationDepth: depthBudget, maxDurationMs: timeBudgetMs },
    budgets: {
      timeBudgetMs,
      tokenBudget: 100000,
      providerBudget: 5,
      workerBudget: 10,
      depthBudget,
      branchBudget: 4,
      ...params.budgets
    },
    dispatchedAt: Date.now(),
    ...params
  };
  return validateTaskEnvelope(raw, { throwOnError: true });
}

/**
 * Validates a PublicEvent object.
 */
export function validatePublicEvent(input, { throwOnError = true } = {}) {
  sanitizeAndBoundPayload(input);
  const errors = [];
  if (!isPlainObject(input)) {
    const err = new IfzValidationError('PublicEvent must be a plain object', ['Root must be a plain object']);
    if (throwOnError) throw err;
    return null;
  }

  if (input.schemaVersion !== SCHEMA_VERSIONS.PUBLIC_EVENT) {
    errors.push(`schemaVersion must be '${SCHEMA_VERSIONS.PUBLIC_EVENT}', got '${input.schemaVersion}'`);
  }

  const eventId = validateIdentity(input.eventId, 'eventId', errors);
  const runId = validateIdentity(input.runId, 'runId', errors);
  const conversationId = validateIdentity(input.conversationId, 'conversationId', errors);
  const taskId = validateIdentity(input.taskId, 'taskId', errors);
  const producerWorkerId = validateIdentity(input.producerWorkerId, 'producerWorkerId', errors);
  const targetWorkerId = input.targetWorkerId ? validateIdentity(input.targetWorkerId, 'targetWorkerId', errors) : null;

  if (typeof input.eventType !== 'string' || !PUBLIC_EVENT_TYPES.includes(input.eventType)) {
    errors.push(`eventType must be one of: ${PUBLIC_EVENT_TYPES.join(', ')}, got '${input.eventType}'`);
  }

  if (typeof input.summary !== 'string' || input.summary.trim().length === 0 || input.summary.length > 500) {
    errors.push('summary must be a short public status string up to 500 characters');
  }

  if (input.details && isPlainObject(input.details)) {
    for (const field of PROHIBITED_RECEIPT_FIELDS) {
      if (input.details[field] !== undefined) {
        errors.push(`PublicEvent details cannot contain sensitive field '${field}'`);
      }
    }
  }

  const timestamp = validatePositiveInt(input.timestamp ?? Date.now(), 'timestamp', errors, { min: 1 });

  if (errors.length > 0) {
    const err = new IfzValidationError(`PublicEvent validation failed: ${errors.join('; ')}`, errors);
    if (throwOnError) throw err;
    return null;
  }

  return deepFreeze({
    schemaVersion: SCHEMA_VERSIONS.PUBLIC_EVENT,
    eventId,
    runId,
    conversationId,
    taskId,
    eventType: input.eventType,
    producerWorkerId,
    targetWorkerId,
    status: input.status || 'running',
    summary: input.summary.trim(),
    details: input.details ? deepClone(input.details) : {},
    timestamp: timestamp ?? Date.now()
  });
}

/**
 * Creates and validates a PublicEvent.
 */
export function createPublicEvent(params) {
  const raw = {
    schemaVersion: SCHEMA_VERSIONS.PUBLIC_EVENT,
    status: 'running',
    targetWorkerId: null,
    details: {},
    timestamp: Date.now(),
    ...params
  };
  return validatePublicEvent(raw, { throwOnError: true });
}

/**
 * Validates a DeliveryReceipt object.
 */
export function validateDeliveryReceipt(input, { throwOnError = true, verifyDigest = false } = {}) {
  sanitizeAndBoundPayload(input);
  const errors = [];
  if (!isPlainObject(input)) {
    const err = new IfzValidationError('DeliveryReceipt must be a plain object', ['Root must be a plain object']);
    if (throwOnError) throw err;
    return null;
  }

  if (input.schemaVersion !== SCHEMA_VERSIONS.DELIVERY_RECEIPT) {
    errors.push(`schemaVersion must be '${SCHEMA_VERSIONS.DELIVERY_RECEIPT}', got '${input.schemaVersion}'`);
  }

  for (const field of PROHIBITED_RECEIPT_FIELDS) {
    if (input[field] !== undefined) {
      errors.push(`DeliveryReceipt must not store '${field}'`);
    }
  }

  const receiptId = validateIdentity(input.receiptId, 'receiptId', errors);
  const taskId = validateIdentity(input.taskId, 'taskId', errors);
  const runId = validateIdentity(input.runId, 'runId', errors);
  const conversationId = validateIdentity(input.conversationId, 'conversationId', errors);
  const workerId = validateIdentity(input.workerId, 'workerId', errors);

  if (typeof input.status !== 'string' || !RECEIPT_STATUSES.includes(input.status)) {
    errors.push(`status must be one of: ${RECEIPT_STATUSES.join(', ')}, got '${input.status}'`);
  }

  const delivered = validateStrictBoolean(input.delivered, 'delivered', errors);
  const effectsObserved = validateStrictBoolean(input.effectsObserved, 'effectsObserved', errors);

  const appliedEffects = validateEffectsArray(input.appliedEffects || [], 'appliedEffects', errors);

  let cleanVerification = { verified: false, verifierId: null, checksPassed: 0, checksFailed: 0 };
  if (!input.verification || !isPlainObject(input.verification)) {
    errors.push('verification must be a plain object');
  } else {
    const verified = validateStrictBoolean(input.verification.verified, 'verification.verified', errors);
    const verifierId = input.verification.verifierId ? validateIdentity(input.verification.verifierId, 'verification.verifierId', errors) : null;
    const checksPassed = validatePositiveInt(input.verification.checksPassed ?? 0, 'verification.checksPassed', errors, { min: 0 });
    const checksFailed = validatePositiveInt(input.verification.checksFailed ?? 0, 'verification.checksFailed', errors, { min: 0 });

    if (verified && (checksPassed ?? 0) === 0 && (checksFailed ?? 0) === 0) {
      errors.push('verification.verified cannot be true without verifier checks record');
    }

    cleanVerification = {
      verified,
      verifierId,
      checksPassed: checksPassed ?? 0,
      checksFailed: checksFailed ?? 0
    };
  }

  const dispatchedAt = validatePositiveInt(input.dispatchedAt, 'dispatchedAt', errors, { min: 1 });
  const completedAt = validatePositiveInt(input.completedAt, 'completedAt', errors, { min: 1 });

  if (dispatchedAt && completedAt && completedAt < dispatchedAt) {
    errors.push(`completedAt (${completedAt}) cannot be before dispatchedAt (${dispatchedAt})`);
  }

  if (typeof input.receiptDigest !== 'string' || !/^[a-f0-9]{64}$/i.test(input.receiptDigest)) {
    errors.push('receiptDigest must be a 64-character hex SHA-256 string');
  } else if (verifyDigest) {
    const computed = computeSha256({
      schemaVersion: SCHEMA_VERSIONS.DELIVERY_RECEIPT,
      receiptId,
      taskId,
      runId,
      conversationId,
      workerId,
      status: input.status,
      delivered,
      effectsObserved,
      appliedEffects,
      verification: cleanVerification,
      dispatchedAt,
      completedAt
    });
    if (computed.toLowerCase() !== input.receiptDigest.toLowerCase()) {
      errors.push(`receiptDigest tampering detected: expected '${computed}', got '${input.receiptDigest}'`);
    }
  }

  if (errors.length > 0) {
    const err = new IfzValidationError(`DeliveryReceipt validation failed: ${errors.join('; ')}`, errors);
    if (throwOnError) throw err;
    return null;
  }

  return deepFreeze({
    schemaVersion: SCHEMA_VERSIONS.DELIVERY_RECEIPT,
    receiptId,
    taskId,
    runId,
    conversationId,
    workerId,
    status: input.status,
    delivered,
    effectsObserved,
    appliedEffects,
    verification: cleanVerification,
    dispatchedAt,
    completedAt,
    receiptDigest: input.receiptDigest.toLowerCase()
  });
}

/**
 * Creates and validates a DeliveryReceipt with computed digest.
 */
export function createDeliveryReceipt(params) {
  const raw = {
    schemaVersion: SCHEMA_VERSIONS.DELIVERY_RECEIPT,
    appliedEffects: [],
    dispatchedAt: params.dispatchedAt ?? Date.now(),
    completedAt: params.completedAt ?? Date.now(),
    ...params
  };

  if (!raw.receiptDigest) {
    raw.receiptDigest = computeSha256({
      schemaVersion: SCHEMA_VERSIONS.DELIVERY_RECEIPT,
      receiptId: raw.receiptId,
      taskId: raw.taskId,
      runId: raw.runId,
      conversationId: raw.conversationId,
      workerId: raw.workerId,
      status: raw.status,
      delivered: raw.delivered,
      effectsObserved: raw.effectsObserved,
      appliedEffects: raw.appliedEffects || [],
      verification: raw.verification,
      dispatchedAt: raw.dispatchedAt,
      completedAt: raw.completedAt
    });
  }

  return validateDeliveryReceipt(raw, { throwOnError: true, verifyDigest: true });
}

/**
 * Validates that a delegated child task envelope or route request does not grow authority beyond its parent.
 *
 * @param {object} parentEnvelope - Authoritative parent TaskEnvelope
 * @param {object} childCandidate - Proposed child TaskEnvelope or RouteRequest
 * @throws {IfzAuthorityGrowthError} If authority growth is detected
 */
export function assertNoAuthorityGrowth(parentEnvelope, childCandidate) {
  if (!parentEnvelope || !childCandidate) {
    throw new IfzAuthorityGrowthError('Both parent and child objects are required for authority check');
  }

  // 1. Effects authority check
  const parentEffects = new Set(parentEnvelope.scopes?.effects || []);
  const childEffects = childCandidate.scopes?.effects || childCandidate.requiredEffects || [];

  for (const eff of childEffects) {
    if (!parentEffects.has(eff)) {
      throw new IfzAuthorityGrowthError(
        `Authority growth rejected: child requests effect '${eff}' not granted to parent`,
        { ungrantedEffect: eff, parentEffects: [...parentEffects] }
      );
    }
  }

  // 2. Paths authority check
  const parentWrite = new Set(parentEnvelope.scopes?.writePaths || []);
  const childWrite = childCandidate.scopes?.writePaths || [];
  for (const p of childWrite) {
    if (parentWrite.size > 0 && !parentWrite.has(p)) {
      throw new IfzAuthorityGrowthError(
        `Authority growth rejected: child requests write path '${p}' outside parent scope`,
        { ungrantedPath: p, parentWritePaths: [...parentWrite] }
      );
    }
  }

  const parentCreate = new Set(parentEnvelope.scopes?.createPaths || []);
  const childCreate = childCandidate.scopes?.createPaths || [];
  for (const p of childCreate) {
    if (parentCreate.size > 0 && !parentCreate.has(p)) {
      throw new IfzAuthorityGrowthError(
        `Authority growth rejected: child requests create path '${p}' outside parent scope`,
        { ungrantedPath: p, parentCreatePaths: [...parentCreate] }
      );
    }
  }

  // 3. Delegation depth & depth budget check
  const parentMaxDepth = parentEnvelope.budgets?.depthBudget ?? parentEnvelope.limits?.maxDelegationDepth ?? 2;
  const parentCurrentDepth = parentEnvelope.limits?.delegationDepth ?? 0;
  const childRequestedDepth = childCandidate.maxDelegationDepth ?? childCandidate.budgets?.depthBudget ?? childCandidate.limits?.delegationDepth ?? (parentCurrentDepth + 1);

  if (childRequestedDepth > parentMaxDepth) {
    throw new IfzAuthorityGrowthError(
      `Authority growth rejected: delegation depth ${childRequestedDepth} exceeds maximum allowed depth ${parentMaxDepth}`,
      { childRequestedDepth, parentMaxDepth }
    );
  }

  // 4. Budgets check (when child declares budgets)
  if (parentEnvelope.budgets && childCandidate.budgets) {
    if (childCandidate.budgets.timeBudgetMs && childCandidate.budgets.timeBudgetMs > parentEnvelope.budgets.timeBudgetMs) {
      throw new IfzAuthorityGrowthError(
        `Authority growth rejected: child timeBudgetMs (${childCandidate.budgets.timeBudgetMs}) exceeds parent limit (${parentEnvelope.budgets.timeBudgetMs})`,
        { childTime: childCandidate.budgets.timeBudgetMs, parentTime: parentEnvelope.budgets.timeBudgetMs }
      );
    }

    if (childCandidate.budgets.tokenBudget && childCandidate.budgets.tokenBudget > parentEnvelope.budgets.tokenBudget) {
      throw new IfzAuthorityGrowthError(
        `Authority growth rejected: child tokenBudget (${childCandidate.budgets.tokenBudget}) exceeds parent limit (${parentEnvelope.budgets.tokenBudget})`,
        { childTokens: childCandidate.budgets.tokenBudget, parentTokens: parentEnvelope.budgets.tokenBudget }
      );
    }

    if (childCandidate.budgets.branchBudget && childCandidate.budgets.branchBudget > parentEnvelope.budgets.branchBudget) {
      throw new IfzAuthorityGrowthError(
        `Authority growth rejected: child branchBudget (${childCandidate.budgets.branchBudget}) exceeds parent limit (${parentEnvelope.budgets.branchBudget})`,
        { childBranches: childCandidate.budgets.branchBudget, parentBranches: parentEnvelope.budgets.branchBudget }
      );
    }
  }

  return true;
}
