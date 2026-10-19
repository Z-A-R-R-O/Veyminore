/**
 * @file capabilities.js
 * Model capability profiles, verification states, and the 4-tier compatibility ladder.
 */

export const VerificationState = Object.freeze({
  VERIFIED: 'verified',
  REPORTED: 'reported',
  UNSUPPORTED: 'unsupported',
  UNKNOWN: 'unknown'
});

export const ModelCompatibilityLevel = Object.freeze({
  LEVEL_1_NATIVE_COMPUTER_USE: 'level_1_native_computer_use',
  LEVEL_2_FUNCTION_CALLING: 'level_2_function_calling',
  LEVEL_3_STRUCTURED_OUTPUT: 'level_3_structured_output',
  LEVEL_4_TEXT_ONLY: 'level_4_text_only'
});

export const CAPABILITY_KEYS = Object.freeze([
  'vision.imageInput',
  'tools.functionCalling',
  'output.structured',
  'execution.nativeComputerUse',
  'runtime.streaming',
  'runtime.local'
]);

export class CapabilityValidationError extends Error {
  constructor(message, details = {}) {
    super(`[ModelCapability] ${message}`);
    this.name = 'CapabilityValidationError';
    this.details = details;
  }
}

/**
 * Creates and normalizes a capability profile object.
 *
 * @param {Object} [rawCaps={}]
 * @returns {Record<string, string>}
 */
export function createCapabilityProfile(rawCaps = {}) {
  const normalizedCaps = {};
  const validStates = Object.values(VerificationState);
  for (const key of ['vision', 'toolCalling', 'structuredOutput', 'nativeComputerUse', 'streaming', 'local']) {
    const val = rawCaps ? rawCaps[key] : undefined;
    if (val && validStates.includes(val)) {
      normalizedCaps[key] = val;
    } else if (typeof val === 'boolean') {
      normalizedCaps[key] = val ? VerificationState.REPORTED : VerificationState.UNSUPPORTED;
    } else {
      normalizedCaps[key] = VerificationState.UNKNOWN;
    }
  }
  return normalizedCaps;
}

/**
 * Validates a dynamic model profile schema.
 *
 * @param {Object} profile
 * @returns {Object} Validated model profile
 */
export function validateModelProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new CapabilityValidationError('Model profile must be a non-null object');
  }

  if (typeof profile.id !== 'string' || profile.id.trim() === '') {
    throw new CapabilityValidationError("Model profile requires non-empty string 'id'");
  }

  if (typeof profile.provider !== 'string' || profile.provider.trim() === '') {
    throw new CapabilityValidationError("Model profile requires non-empty string 'provider'");
  }

  if (typeof profile.model !== 'string' || profile.model.trim() === '') {
    throw new CapabilityValidationError("Model profile requires non-empty string 'model'");
  }

  const enabled = profile.enabled !== false;
  const endpoint = typeof profile.endpoint === 'string' && profile.endpoint.trim() !== ''
    ? profile.endpoint.trim()
    : undefined;

  // Capabilities object validation
  const normalizedCaps = createCapabilityProfile(profile.capabilities);

  // Limits
  const rawLimits = profile.limits || {};
  const normalizedLimits = {
    maxContextTokens: typeof rawLimits.maxContextTokens === 'number' && rawLimits.maxContextTokens > 0
      ? rawLimits.maxContextTokens
      : 32768,
    maxImagesPerRequest: typeof rawLimits.maxImagesPerRequest === 'number' && rawLimits.maxImagesPerRequest > 0
      ? rawLimits.maxImagesPerRequest
      : 1,
    maxRequestsPerMinute: typeof rawLimits.maxRequestsPerMinute === 'number' && rawLimits.maxRequestsPerMinute > 0
      ? rawLimits.maxRequestsPerMinute
      : 60
  };

  // Policy
  const rawPolicy = profile.policy || {};
  const normalizedPolicy = {
    maxActionsPerRun: typeof rawPolicy.maxActionsPerRun === 'number' && rawPolicy.maxActionsPerRun > 0
      ? rawPolicy.maxActionsPerRun
      : 25,
    allowTier2WithoutApproval: rawPolicy.allowTier2WithoutApproval === true
  };

  const compatibilityLevel = determineCompatibilityLevel(normalizedCaps);

  return {
    id: profile.id.trim(),
    provider: profile.provider.trim(),
    model: profile.model.trim(),
    endpoint,
    enabled,
    capabilities: normalizedCaps,
    limits: normalizedLimits,
    policy: normalizedPolicy,
    compatibilityLevel
  };
}

/**
 * Computes the model's tier in the 4-Tier Model Compatibility Ladder.
 *
 * @param {Object} capabilities
 * @returns {string} ModelCompatibilityLevel
 */
export function determineCompatibilityLevel(capabilities) {
  const isVision = capabilities.vision === VerificationState.VERIFIED || capabilities.vision === VerificationState.REPORTED;
  const isNativeComputer = capabilities.nativeComputerUse === VerificationState.VERIFIED || capabilities.nativeComputerUse === VerificationState.REPORTED;
  const isToolCalling = capabilities.toolCalling === VerificationState.VERIFIED || capabilities.toolCalling === VerificationState.REPORTED;
  const isStructuredOutput = capabilities.structuredOutput === VerificationState.VERIFIED || capabilities.structuredOutput === VerificationState.REPORTED;

  if (isVision && isNativeComputer) {
    return ModelCompatibilityLevel.LEVEL_1_NATIVE_COMPUTER_USE;
  }

  if (isVision && isToolCalling) {
    return ModelCompatibilityLevel.LEVEL_2_FUNCTION_CALLING;
  }

  if (isVision && isStructuredOutput) {
    return ModelCompatibilityLevel.LEVEL_3_STRUCTURED_OUTPUT;
  }

  return ModelCompatibilityLevel.LEVEL_4_TEXT_ONLY;
}
