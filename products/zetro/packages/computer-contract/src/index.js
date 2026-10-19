import { createHash } from 'node:crypto';

export class ContractValidationError extends Error {
  constructor(message, errors = [], schema = '') {
    super(message);
    this.name = 'ContractValidationError';
    this.errors = Array.isArray(errors) ? errors : [errors];
    this.schema = schema;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ContractValidationError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      schema: this.schema,
      errors: this.errors
    };
  }
}

function fail(errors, schema, throwOnError) {
  if (throwOnError) {
    throw new ContractValidationError(
      `Validation failed for ${schema}: ${errors.join('; ')}`,
      errors,
      schema
    );
  }
  return { ok: false, schema, errors };
}

export const COMPUTER_SCHEMA_VERSIONS = Object.freeze({
  SESSION_IDENTITY: 'zetro.computer.session.alpha.v1',
  OBSERVE_REQUEST: 'zetro.computer.observe_request.alpha.v1',
  OBSERVATION_RESULT: 'zetro.computer.observation_result.alpha.v1',
  AUDIT_EVIDENCE: 'zetro.computer.audit_evidence.alpha.v1'
});

export const PrincipalRole = Object.freeze({
  WORKER: 'worker',
  COORDINATOR: 'coordinator',
  VERIFIER: 'verifier',
  USER: 'user',
  DAEMON: 'daemon'
});

export const TargetKind = Object.freeze({
  SCREEN: 'screen',
  WINDOW: 'window',
  REGION: 'region'
});

export const VerificationStatus = Object.freeze({
  NOT_REQUESTED: 'not_requested',
  IN_PROGRESS: 'in_progress',
  PASSED: 'passed',
  FAILED: 'failed',
  INCONCLUSIVE: 'inconclusive'
});

export const SUPPORTED_CAPABILITIES = Object.freeze(['observe']);

export const EFFECTFUL_CAPABILITIES = Object.freeze([
  'file_write',
  'file_create',
  'file_delete',
  'shell_exec',
  'desktop_input',
  'clipboard_write',
  'browser_navigate',
  'browser_action',
  'provider_call'
]);

export const OBSERVATION_BOUNDS = Object.freeze({
  maxPayloadBytes: Object.freeze({ min: 1, max: 1048576 }),
  maxAgeMs: Object.freeze({ min: 0, max: 300000 })
});

export const DEFAULT_OBSERVATION_LIMITS = Object.freeze({
  maxPayloadBytes: 65536,
  maxAgeMs: 30000
});

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const HEX_SHA256_REGEX = /^[a-f0-9]{64}$/i;
const MIME_REGEX = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

function isNonEmptyObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEpochMs(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function checkUnknownKeys(input, allowed, errors, label = '') {
  const prefix = label ? `${label}: ` : '';
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      errors.push(`${prefix}unknown field '${key}' is not allowed`);
    }
  }
}

function isIdField(value) {
  return typeof value === 'string' && ID_REGEX.test(value);
}

function isSha256Field(value) {
  return typeof value === 'string' && HEX_SHA256_REGEX.test(value);
}

function isIntegerWithin(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function guard(value, validate) {
  try {
    const result = validate();
    return result && result.ok !== false;
  } catch {
    return false;
  }
}

export function checkCapability(capability) {
  if (typeof capability !== 'string' || capability.length === 0) {
    return {
      ok: false,
      capability,
      reason: 'invalid',
      errors: ['capability must be a non-empty string']
    };
  }
  if (SUPPORTED_CAPABILITIES.includes(capability)) {
    return { ok: true, capability, reason: null, errors: [] };
  }
  if (EFFECTFUL_CAPABILITIES.includes(capability)) {
    return {
      ok: false,
      capability,
      reason: 'effectful',
      errors: [
        `capability '${capability}' performs effects and is not allowed by the read-only Computer contract`
      ]
    };
  }
  return {
    ok: false,
    capability,
    reason: 'unsupported',
    errors: [
      `capability '${capability}' is not supported by the Computer alpha contract (supported: ${SUPPORTED_CAPABILITIES.join(', ')})`
    ]
  };
}

export function validateSessionIdentity(input, { throwOnError = true } = {}) {
  const errors = [];
  const schema = COMPUTER_SCHEMA_VERSIONS.SESSION_IDENTITY;

  if (!isNonEmptyObject(input)) {
    return fail(['SessionIdentity must be a non-null object'], schema, throwOnError);
  }

  checkUnknownKeys(
    input,
    ['schemaVersion', 'sessionId', 'principalId', 'agentId', 'role', 'issuedAt', 'expiresAt'],
    errors
  );

  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}'`);
  }
  if (!isIdField(input.sessionId)) {
    errors.push('sessionId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (!isIdField(input.principalId)) {
    errors.push('principalId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (!isIdField(input.agentId)) {
    errors.push('agentId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (typeof input.role !== 'string' || !Object.values(PrincipalRole).includes(input.role)) {
    errors.push(`role must be one of: ${Object.values(PrincipalRole).join(', ')}`);
  }
  if (!isEpochMs(input.issuedAt)) {
    errors.push('issuedAt must be a positive finite epoch ms integer');
  }
  if (!isEpochMs(input.expiresAt)) {
    errors.push('expiresAt must be a positive finite epoch ms integer');
  }
  if (isEpochMs(input.issuedAt) && isEpochMs(input.expiresAt) && input.expiresAt <= input.issuedAt) {
    errors.push('expiresAt must be greater than issuedAt');
  }

  if (errors.length > 0) {
    return fail(errors, schema, throwOnError);
  }

  return {
    schemaVersion: schema,
    sessionId: input.sessionId,
    principalId: input.principalId,
    agentId: input.agentId,
    role: input.role,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt
  };
}

export function isSessionIdentity(value) {
  return guard(value, () => validateSessionIdentity(value, { throwOnError: false }));
}

export function validateObserveRequest(input, { throwOnError = true, session } = {}) {
  const errors = [];
  const schema = COMPUTER_SCHEMA_VERSIONS.OBSERVE_REQUEST;

  if (!isNonEmptyObject(input)) {
    return fail(['ObserveRequest must be a non-null object'], schema, throwOnError);
  }

  checkUnknownKeys(
    input,
    ['schemaVersion', 'requestId', 'sessionId', 'principalId', 'capability', 'target', 'requestedAt', 'freshness', 'limits'],
    errors
  );

  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}'`);
  }
  if (!isIdField(input.requestId)) {
    errors.push('requestId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (!isIdField(input.sessionId)) {
    errors.push('sessionId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (!isIdField(input.principalId)) {
    errors.push('principalId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  const capabilityCheck = checkCapability(input.capability);
  if (!capabilityCheck.ok) {
    errors.push(...capabilityCheck.errors);
  }

  if (!isNonEmptyObject(input.target)) {
    errors.push('target must be an object');
  } else {
    checkUnknownKeys(input.target, ['targetId', 'kind', 'fingerprint'], errors, 'target');
    if (!isIdField(input.target.targetId)) {
      errors.push('target.targetId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
    }
    if (typeof input.target.kind !== 'string' || !Object.values(TargetKind).includes(input.target.kind)) {
      errors.push(`target.kind must be one of: ${Object.values(TargetKind).join(', ')}`);
    }
    if (input.target.fingerprint !== undefined && !isSha256Field(input.target.fingerprint)) {
      errors.push('target.fingerprint must be a 64-char hex SHA-256');
    }
  }

  if (!isEpochMs(input.requestedAt)) {
    errors.push('requestedAt must be a positive finite epoch ms integer');
  }

  if (!isNonEmptyObject(input.freshness)) {
    errors.push('freshness must be an object');
  } else {
    checkUnknownKeys(input.freshness, ['maxAgeMs'], errors, 'freshness');
    if (!isIntegerWithin(input.freshness.maxAgeMs, OBSERVATION_BOUNDS.maxAgeMs.min, OBSERVATION_BOUNDS.maxAgeMs.max)) {
      errors.push(
        `freshness.maxAgeMs must be an integer within ${OBSERVATION_BOUNDS.maxAgeMs.min}..${OBSERVATION_BOUNDS.maxAgeMs.max}`
      );
    }
  }

  if (!isNonEmptyObject(input.limits)) {
    errors.push('limits must be an object');
  } else {
    checkUnknownKeys(input.limits, ['maxPayloadBytes'], errors, 'limits');
    if (
      !isIntegerWithin(
        input.limits.maxPayloadBytes,
        OBSERVATION_BOUNDS.maxPayloadBytes.min,
        OBSERVATION_BOUNDS.maxPayloadBytes.max
      )
    ) {
      errors.push(
        `limits.maxPayloadBytes must be an integer within ${OBSERVATION_BOUNDS.maxPayloadBytes.min}..${OBSERVATION_BOUNDS.maxPayloadBytes.max}`
      );
    }
  }

  if (session !== undefined) {
    if (!isNonEmptyObject(session)) {
      errors.push('session option must be a SessionIdentity object');
    } else if (!isIdField(session.sessionId) || !isIdField(session.principalId)) {
      errors.push('session option must carry sessionId and principalId');
    } else {
      if (input.sessionId !== session.sessionId) {
        errors.push(
          `sessionId '${input.sessionId}' does not match session identity '${session.sessionId}'`
        );
      }
      if (input.principalId !== session.principalId) {
        errors.push(
          `principalId '${input.principalId}' does not match session identity '${session.principalId}'`
        );
      }
    }
  }

  if (errors.length > 0) {
    return fail(errors, schema, throwOnError);
  }

  return {
    schemaVersion: schema,
    requestId: input.requestId,
    sessionId: input.sessionId,
    principalId: input.principalId,
    capability: input.capability,
    target: {
      targetId: input.target.targetId,
      kind: input.target.kind,
      ...(input.target.fingerprint !== undefined
        ? { fingerprint: input.target.fingerprint.toLowerCase() }
        : {})
    },
    requestedAt: input.requestedAt,
    freshness: { maxAgeMs: input.freshness.maxAgeMs },
    limits: { maxPayloadBytes: input.limits.maxPayloadBytes }
  };
}

export function isObserveRequest(value) {
  return guard(value, () => validateObserveRequest(value, { throwOnError: false }));
}

export function validateObservationResult(
  input,
  { throwOnError = true, request, maxPayloadBytes = DEFAULT_OBSERVATION_LIMITS.maxPayloadBytes } = {}
) {
  const errors = [];
  const schema = COMPUTER_SCHEMA_VERSIONS.OBSERVATION_RESULT;

  if (!isNonEmptyObject(input)) {
    return fail(['ObservationResult must be a non-null object'], schema, throwOnError);
  }

  checkUnknownKeys(
    input,
    ['schemaVersion', 'requestId', 'sessionId', 'target', 'capturedAt', 'sequence', 'payload', 'observedBy'],
    errors
  );

  if (
    !isIntegerWithin(
      maxPayloadBytes,
      OBSERVATION_BOUNDS.maxPayloadBytes.min,
      OBSERVATION_BOUNDS.maxPayloadBytes.max
    )
  ) {
    errors.push(
      `maxPayloadBytes option must be a finite positive integer within ${OBSERVATION_BOUNDS.maxPayloadBytes.min}..${OBSERVATION_BOUNDS.maxPayloadBytes.max}`
    );
  }

  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}'`);
  }
  if (!isIdField(input.requestId)) {
    errors.push('requestId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (!isIdField(input.sessionId)) {
    errors.push('sessionId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  if (!isNonEmptyObject(input.target)) {
    errors.push('target must be an object');
  } else {
    checkUnknownKeys(input.target, ['targetId', 'fingerprint'], errors, 'target');
    if (!isIdField(input.target.targetId)) {
      errors.push('target.targetId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
    }
    if (!isSha256Field(input.target.fingerprint)) {
      errors.push('target.fingerprint must be a 64-char hex SHA-256');
    }
  }

  if (!isEpochMs(input.capturedAt)) {
    errors.push('capturedAt must be a positive finite epoch ms integer');
  }
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    errors.push('sequence must be a non-negative integer');
  }
  if (!isIdField(input.observedBy)) {
    errors.push('observedBy must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  let byteLength = null;
  if (!isNonEmptyObject(input.payload)) {
    errors.push('payload must be an object');
  } else {
    checkUnknownKeys(input.payload, ['sha256', 'byteLength', 'mimeType'], errors, 'payload');
    if (!isSha256Field(input.payload.sha256)) {
      errors.push('payload.sha256 must be a 64-char hex SHA-256');
    }
    if (!Number.isSafeInteger(input.payload.byteLength) || input.payload.byteLength < 1) {
      errors.push('payload.byteLength must be a positive integer');
    } else {
      byteLength = input.payload.byteLength;
      if (byteLength > OBSERVATION_BOUNDS.maxPayloadBytes.max) {
        errors.push(
          `payload.byteLength ${byteLength} exceeds maximum ${OBSERVATION_BOUNDS.maxPayloadBytes.max}`
        );
      } else if (byteLength > maxPayloadBytes) {
        errors.push(`payload.byteLength ${byteLength} exceeds the configured limit ${maxPayloadBytes}`);
      }
    }
    if (
      typeof input.payload.mimeType !== 'string' ||
      input.payload.mimeType.length === 0 ||
      input.payload.mimeType.length > 128 ||
      !MIME_REGEX.test(input.payload.mimeType)
    ) {
      errors.push('payload.mimeType must be a valid MIME type string up to 128 chars');
    }
  }

  if (request !== undefined) {
    if (!isNonEmptyObject(request)) {
      errors.push('request option must be an ObserveRequest object');
    } else {
      if (request.requestId !== input.requestId) {
        errors.push('requestId does not match observe request');
      }
      if (request.sessionId !== input.sessionId) {
        errors.push('sessionId does not match observe request');
      }
      if (isNonEmptyObject(request.target) && isNonEmptyObject(input.target)) {
        if (request.target.targetId !== input.target.targetId) {
          errors.push('target identity does not match observe request');
        }
        if (request.target.fingerprint !== undefined) {
          if (!isSha256Field(request.target.fingerprint)) {
            errors.push('request.target.fingerprint must be a 64-char hex SHA-256');
          } else if (
            isSha256Field(input.target.fingerprint) &&
            request.target.fingerprint.toLowerCase() !== input.target.fingerprint.toLowerCase()
          ) {
            errors.push('target fingerprint does not match observe request');
          }
        }
      }
      if (isNonEmptyObject(request.limits)) {
        if (
          !isIntegerWithin(
            request.limits.maxPayloadBytes,
            OBSERVATION_BOUNDS.maxPayloadBytes.min,
            OBSERVATION_BOUNDS.maxPayloadBytes.max
          )
        ) {
          errors.push(
            'request.limits.maxPayloadBytes must be a finite positive integer within OBSERVATION_BOUNDS'
          );
        } else if (byteLength !== null && byteLength > request.limits.maxPayloadBytes) {
          errors.push(
            `payload.byteLength ${byteLength} exceeds request limits.maxPayloadBytes ${request.limits.maxPayloadBytes}`
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    return fail(errors, schema, throwOnError);
  }

  return {
    schemaVersion: schema,
    requestId: input.requestId,
    sessionId: input.sessionId,
    target: {
      targetId: input.target.targetId,
      fingerprint: input.target.fingerprint.toLowerCase()
    },
    capturedAt: input.capturedAt,
    sequence: input.sequence,
    payload: {
      sha256: input.payload.sha256.toLowerCase(),
      byteLength: input.payload.byteLength,
      mimeType: input.payload.mimeType
    },
    observedBy: input.observedBy
  };
}

export function isObservationResult(value) {
  return guard(value, () => validateObservationResult(value, { throwOnError: false }));
}

export function validateAuditEvidence(input, { throwOnError = true } = {}) {
  const errors = [];
  const schema = COMPUTER_SCHEMA_VERSIONS.AUDIT_EVIDENCE;

  if (!isNonEmptyObject(input)) {
    return fail(['AuditEvidence must be a non-null object'], schema, throwOnError);
  }

  checkUnknownKeys(
    input,
    ['schemaVersion', 'evidenceId', 'sessionId', 'requestId', 'capability', 'resultDigest', 'effect', 'verification', 'createdAt'],
    errors
  );

  if (input.schemaVersion !== schema) {
    errors.push(`schemaVersion must be '${schema}'`);
  }
  if (!isIdField(input.evidenceId)) {
    errors.push('evidenceId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (!isIdField(input.sessionId)) {
    errors.push('sessionId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (!isIdField(input.requestId)) {
    errors.push('requestId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }

  const capabilityCheck = checkCapability(input.capability);
  if (!capabilityCheck.ok) {
    errors.push(...capabilityCheck.errors);
  }

  if (!isSha256Field(input.resultDigest)) {
    errors.push('resultDigest must be a 64-char hex SHA-256');
  }

  if (!('effect' in input)) {
    errors.push('effect is required and must be null (read-only contract defines no effects)');
  } else if (input.effect !== null) {
    errors.push('effect must be null: the read-only Computer contract defines no effects');
  }

  if (!isNonEmptyObject(input.verification)) {
    errors.push('verification must be an object');
  } else {
    checkUnknownKeys(
      input.verification,
      ['verified', 'status', 'verifier', 'checksPassed', 'checksFailed', 'checkedAt'],
      errors,
      'verification'
    );
    const v = input.verification;
    const verifiedOk = typeof v.verified === 'boolean';
    if (!verifiedOk) {
      errors.push('verification.verified must be a boolean');
    }
    const statusOk =
      typeof v.status === 'string' && Object.values(VerificationStatus).includes(v.status);
    if (!statusOk) {
      errors.push(`verification.status must be one of: ${Object.values(VerificationStatus).join(', ')}`);
    }
    if (typeof v.verifier !== 'string' || v.verifier.length === 0 || v.verifier.length > 128) {
      errors.push('verification.verifier must be a non-empty string up to 128 chars');
    }
    const passedOk = Number.isSafeInteger(v.checksPassed) && v.checksPassed >= 0;
    if (!passedOk) {
      errors.push('verification.checksPassed must be a non-negative integer');
    }
    const failedOk = Number.isSafeInteger(v.checksFailed) && v.checksFailed >= 0;
    if (!failedOk) {
      errors.push('verification.checksFailed must be a non-negative integer');
    }
    if (!isEpochMs(v.checkedAt)) {
      errors.push('verification.checkedAt must be a positive finite epoch ms integer');
    }
    if (verifiedOk && statusOk && passedOk && failedOk) {
      if (v.verified === true) {
        if (v.status !== VerificationStatus.PASSED) {
          errors.push("verification.verified cannot be true unless status is 'passed'");
        }
        if (v.checksPassed === 0) {
          errors.push('verification.verified cannot be true with checksPassed === 0');
        }
        if (v.checksFailed > 0) {
          errors.push(`verification.verified cannot be true with checksFailed === 0 (${v.checksFailed})`);
        }
      } else if (v.status === VerificationStatus.PASSED) {
        errors.push("verification.status cannot be 'passed' unless verified is true");
      }
      if (v.status === VerificationStatus.FAILED && v.checksFailed === 0) {
        errors.push("verification.status 'failed' requires checksFailed > 0");
      }
    }
  }

  if (!isEpochMs(input.createdAt)) {
    errors.push('createdAt must be a positive finite epoch ms integer');
  }

  if (errors.length > 0) {
    return fail(errors, schema, throwOnError);
  }

  return {
    schemaVersion: schema,
    evidenceId: input.evidenceId,
    sessionId: input.sessionId,
    requestId: input.requestId,
    capability: input.capability,
    resultDigest: input.resultDigest.toLowerCase(),
    effect: null,
    verification: {
      verified: input.verification.verified,
      status: input.verification.status,
      verifier: input.verification.verifier,
      checksPassed: input.verification.checksPassed,
      checksFailed: input.verification.checksFailed,
      checkedAt: input.verification.checkedAt
    },
    createdAt: input.createdAt
  };
}

export function isAuditEvidence(value) {
  return guard(value, () => validateAuditEvidence(value, { throwOnError: false }));
}

export function evaluateFreshness(
  observation,
  { now = Date.now(), maxAgeMs = DEFAULT_OBSERVATION_LIMITS.maxAgeMs } = {}
) {
  if (!isNonEmptyObject(observation) || !isEpochMs(observation.capturedAt)) {
    return {
      ok: false,
      status: 'invalid',
      ageMs: null,
      errors: ['observation.capturedAt must be a positive finite epoch ms integer']
    };
  }
  const errors = [];
  if (!Number.isSafeInteger(now)) {
    errors.push('now must be an epoch ms integer');
  }
  if (!isIntegerWithin(maxAgeMs, OBSERVATION_BOUNDS.maxAgeMs.min, OBSERVATION_BOUNDS.maxAgeMs.max)) {
    errors.push(
      `maxAgeMs must be an integer within ${OBSERVATION_BOUNDS.maxAgeMs.min}..${OBSERVATION_BOUNDS.maxAgeMs.max}`
    );
  }
  if (errors.length > 0) {
    return { ok: false, status: 'invalid', ageMs: null, errors };
  }
  const ageMs = now - observation.capturedAt;
  if (ageMs < 0) {
    return {
      ok: false,
      status: 'not_yet_valid',
      ageMs,
      errors: [`capturedAt is ${-ageMs}ms in the future`]
    };
  }
  if (ageMs > maxAgeMs) {
    return {
      ok: false,
      status: 'stale',
      ageMs,
      errors: [`observation age ${ageMs}ms exceeds maxAgeMs ${maxAgeMs}`]
    };
  }
  return { ok: true, status: 'fresh', ageMs, errors: [] };
}

function canonicalJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Cannot canonically serialize non-finite number: ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Unsupported type for canonical JSON serialization: ${typeof value}`);
  }
  if (seen.has(value)) {
    throw new TypeError('Circular structure detected in canonical JSON serialization');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map(item => canonicalJson(item === undefined ? null : item, seen)).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const key of keys) {
      const val = value[key];
      if (val === undefined || typeof val === 'function' || typeof val === 'symbol') {
        continue;
      }
      parts.push(`${JSON.stringify(key)}:${canonicalJson(val, seen)}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function sha256Hex(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function computeResultDigest(result) {
  return sha256Hex(result);
}

export function computeEvidenceDigest(evidence) {
  return sha256Hex(evidence);
}

function evaluateTrustedAuthority(trust, resultSchema, evidenceSchema, structural, request) {
  if (trust === undefined || trust === null) {
    return {
      state: 'missing',
      detail:
        'no trusted verifier port injected; trust cannot be established from worker-controlled evidence'
    };
  }
  if (typeof trust !== 'object' || typeof trust.decide !== 'function' || typeof trust.verifierId !== 'string') {
    return {
      state: 'error',
      detail: 'trust must be a port constructed via createTrustedVerifierPort(verifierId, decide)'
    };
  }
  const structuralPassed = structural.filter(check => check.ok).length;
  const identitySource = isNonEmptyObject(request) ? request : null;
  const context = Object.freeze({
    verifierId: trust.verifierId,
    requestId: identitySource ? identitySource.requestId : resultSchema.requestId,
    sessionId: identitySource ? identitySource.sessionId : resultSchema.sessionId,
    principalId: identitySource ? identitySource.principalId : null,
    resultDigest: computeResultDigest(resultSchema),
    checksPassed: structuralPassed,
    checksFailed: structural.length - structuralPassed,
    evidenceVerifier: evidenceSchema.verification.verifier,
    observedBy: resultSchema.observedBy
  });
  let verdict;
  try {
    verdict = trust.decide(context);
  } catch (err) {
    return {
      state: 'error',
      detail: `trusted verifier threw: ${err && err.message ? err.message : 'unknown error'}`
    };
  }
  if (!isNonEmptyObject(verdict)) {
    return { state: 'error', detail: 'trusted verifier must return a verdict object' };
  }
  if (verdict.authorized !== true) {
    if (verdict.status === VerificationStatus.FAILED) {
      return { state: 'failed', detail: 'trusted verifier rejected and reported failure (honored)' };
    }
    return {
      state: 'inconclusive',
      detail: `trusted verifier did not authorize (status '${verdict.status}')`
    };
  }
  if (verdict.status !== VerificationStatus.PASSED) {
    return {
      state: 'inconclusive',
      detail: `trusted verifier authorized but status is '${verdict.status}'`
    };
  }
  const bindings = verdict.bindings;
  if (!isNonEmptyObject(bindings)) {
    return {
      state: 'mismatch',
      detail: 'trusted verdict missing exact bindings (requestId, sessionId, resultDigest)'
    };
  }
  if (
    bindings.requestId !== context.requestId ||
    bindings.sessionId !== context.sessionId ||
    bindings.resultDigest !== context.resultDigest
  ) {
    return {
      state: 'mismatch',
      detail: 'trusted verdict bindings do not exactly match request/session/resultDigest'
    };
  }
  if (bindings.principalId !== undefined) {
    if (context.principalId === null || bindings.principalId !== context.principalId) {
      return {
        state: 'mismatch',
        detail: 'trusted verdict principalId does not match the bound request principal'
      };
    }
  }
  return {
    state: 'granted',
    detail: `trusted verifier '${trust.verifierId}' authorizes this exact observation`
  };
}

export function createTrustedVerifierPort(verifierId, decide) {
  if (!isIdField(verifierId)) {
    throw new ContractValidationError(
      'createTrustedVerifierPort: verifierId must be a string matching ^[a-zA-Z0-9_-]{1,64}$',
      ['verifierId is invalid'],
      'zetro.computer.trusted_verifier_port.v0'
    );
  }
  if (typeof decide !== 'function') {
    throw new ContractValidationError(
      'createTrustedVerifierPort: decide must be a function (context) => verdict',
      ['decide must be a function'],
      'zetro.computer.trusted_verifier_port.v0'
    );
  }
  return Object.freeze({ verifierId, decide });
}

export function verifyObservation(result, evidence, { now = Date.now(), maxAgeMs, request, trust } = {}) {
  if (evidence === null || evidence === undefined) {
    return {
      status: VerificationStatus.NOT_REQUESTED,
      checks: [],
      checksPassed: 0,
      checksFailed: 0
    };
  }

  const checks = [];
  const resultSchema = validateObservationResult(result, { throwOnError: false });
  const resultOk = resultSchema && resultSchema.ok !== false;
  checks.push({
    name: 'observation_schema',
    ok: Boolean(resultOk),
    detail: resultOk ? 'valid' : (resultSchema?.errors ?? ['invalid observation']).join('; ')
  });

  let admittedRequest = null;
  let requestOk = true;
  let requestDetail = 'no request supplied';
  if (request !== undefined && request !== null) {
    const reqSchema = validateObserveRequest(request, { throwOnError: false });
    const reqValid = Boolean(reqSchema && reqSchema.ok !== false);
    if (!reqValid) {
      requestOk = false;
      requestDetail = `admitted request invalid: ${(reqSchema?.errors ?? ['invalid request']).join('; ')}`;
    } else {
      admittedRequest = reqSchema;
      const bound = validateObservationResult(result, {
        throwOnError: false,
        request: admittedRequest
      });
      if (bound && bound.ok !== false) {
        requestDetail = 'request admitted and bound to observation (identity, fingerprint, limits)';
      } else {
        requestOk = false;
        requestDetail = `observation does not bind to admitted request: ${(bound?.errors ?? ['binding failure']).join('; ')}`;
      }
    }
  }
  checks.push({ name: 'request_admission', ok: requestOk, detail: requestDetail });

  const evidenceSchema = validateAuditEvidence(evidence, { throwOnError: false });
  const evidenceOk = evidenceSchema && evidenceSchema.ok !== false;
  checks.push({
    name: 'evidence_schema',
    ok: Boolean(evidenceOk),
    detail: evidenceOk ? 'valid' : (evidenceSchema?.errors ?? ['invalid evidence']).join('; ')
  });

  const structural = [];
  if (resultOk && evidenceOk) {
    structural.push({
      name: 'session_binding',
      ok: result.sessionId === evidence.sessionId,
      detail:
        result.sessionId === evidence.sessionId
          ? 'session bound'
          : `session '${result.sessionId}' does not match evidence '${evidence.sessionId}'`
    });
    structural.push({
      name: 'request_binding',
      ok: result.requestId === evidence.requestId,
      detail:
        result.requestId === evidence.requestId
          ? 'request bound'
          : `request '${result.requestId}' does not match evidence '${evidence.requestId}'`
    });
    const separate =
      typeof evidence.verification.verifier === 'string' &&
      evidence.verification.verifier !== result.observedBy;
    structural.push({
      name: 'verifier_separation',
      ok: separate,
      detail: separate
        ? 'trusted verifier distinct from observing worker'
        : `verifier '${evidence.verification.verifier}' must differ from observedBy '${result.observedBy}': a worker cannot verify its own observation`
    });
    const readOnlyOk =
      evidence.effect === null && SUPPORTED_CAPABILITIES.includes(evidence.capability);
    structural.push({
      name: 'capability_read_only',
      ok: readOnlyOk,
      detail: readOnlyOk
        ? 'read-only capability and null effect confirmed'
        : 'evidence declares an effect or a capability outside the read-only set'
    });
    const computed = computeResultDigest(resultSchema);
    const digestOk = evidence.resultDigest === computed;
    structural.push({
      name: 'result_digest',
      ok: digestOk,
      detail: digestOk
        ? 'result digest matches evidence'
        : `result digest mismatch: computed '${computed}', evidence '${evidence.resultDigest}'`
    });
  } else {
    for (const name of ['session_binding', 'request_binding', 'verifier_separation', 'capability_read_only', 'result_digest']) {
      structural.push({ name, ok: false, detail: 'skipped: schema invalid' });
    }
  }
  checks.push(...structural);

  let verdictState = 'inconclusive';
  let verdictDetail = 'skipped: evidence invalid';
  if (evidenceOk) {
    const verdict = evidence.verification;
    if (verdict.verified === true && verdict.status === VerificationStatus.PASSED) {
      verdictState = 'pass';
      verdictDetail = 'worker evidence claims passed (label only, not authority)';
    } else if (verdict.status === VerificationStatus.FAILED) {
      verdictState = 'fail';
      verdictDetail = 'worker evidence reports failure (honored)';
    } else {
      verdictState = 'inconclusive';
      verdictDetail = `worker evidence verdict is '${verdict.status}' (not conclusive)`;
    }
  }
  checks.push({
    name: 'verification_verdict',
    ok: verdictState === 'pass',
    detail: verdictDetail
  });

  let trustState = 'skipped';
  let trustDetail = 'skipped: schema invalid';
  if (resultOk && evidenceOk && requestOk) {
    const trustOutcome = evaluateTrustedAuthority(
      trust,
      resultSchema,
      evidenceSchema,
      structural,
      admittedRequest
    );
    trustState = trustOutcome.state;
    trustDetail = trustOutcome.detail;
  } else if (resultOk && evidenceOk && !requestOk) {
    trustDetail = 'skipped: request admission failed';
  }
  checks.push({
    name: 'trusted_authority',
    ok: trustState === 'granted',
    detail: trustDetail
  });

  let freshnessOk = false;
  let freshnessDetail = 'skipped: observation invalid';
  if (resultOk) {
    const fresh = evaluateFreshness(result, { now, maxAgeMs });
    freshnessOk = fresh.ok;
    freshnessDetail = fresh.status;
  }
  checks.push({ name: 'freshness', ok: freshnessOk, detail: freshnessDetail });

  let status;
  if (!resultOk || !evidenceOk) {
    status = VerificationStatus.INCONCLUSIVE;
  } else if (!requestOk) {
    status = VerificationStatus.FAILED;
  } else if (structural.some(check => !check.ok)) {
    status = VerificationStatus.FAILED;
  } else if (verdictState === 'fail') {
    status = VerificationStatus.FAILED;
  } else if (verdictState !== 'pass') {
    status = VerificationStatus.INCONCLUSIVE;
  } else if (trustState === 'failed' || trustState === 'mismatch') {
    status = VerificationStatus.FAILED;
  } else if (trustState !== 'granted') {
    status = VerificationStatus.INCONCLUSIVE;
  } else if (!freshnessOk) {
    status = VerificationStatus.INCONCLUSIVE;
  } else {
    status = VerificationStatus.PASSED;
  }

  const checksPassed = checks.filter(check => check.ok).length;
  const checksFailed = checks.filter(check => !check.ok).length;
  return { status, checks, checksPassed, checksFailed };
}
