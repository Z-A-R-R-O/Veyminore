/**
 * Model Providers - Explicit Validator Port for External Consumers (AGR-5)
 *
 * Exposes standalone snapshot, route, and capability validators without
 * coupling or modifying external package configurations.
 */

import { validateFreeRouting, getModelMetadata, APPROVED_ENDPOINTS } from './metadata.js';
import { FreeRoutingViolationError } from './errors.js';

/**
 * Validates a model metadata snapshot against exact identity, source,
 * finite coherent timestamps/TTL, literal tool capabilities, and complete explicit zero prices.
 */
export function validateModelSnapshot(snapshot, { strict = true, allowExpired = false } = {}) {
  function fail(reason, extra = {}) {
    if (strict) {
      throw new FreeRoutingViolationError(reason);
    }
    return { valid: false, reason, ...extra };
  }

  // 1. Snapshot object structure
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return fail('Model snapshot must be a valid non-null plain object');
  }

  // 2. Exact Provider Identity
  if (typeof snapshot.provider !== 'string' || snapshot.provider.trim() === '') {
    return fail("Model snapshot missing valid 'provider' string");
  }
  const normProvider = snapshot.provider.toLowerCase().trim();
  const providerEndpoints = APPROVED_ENDPOINTS[normProvider];
  if (!providerEndpoints) {
    return fail(`Model snapshot has unapproved provider '${snapshot.provider}'. Approved providers: groq, opencode, openrouter`);
  }

  // 3. Exact Model Identity
  if (typeof snapshot.id !== 'string' || snapshot.id.trim() === '') {
    return fail("Model snapshot missing valid 'id' string");
  }
  const normId = snapshot.id.trim();
  if (normProvider === 'openrouter' && !normId.endsWith(':free')) {
    return fail(`OpenRouter snapshot model '${snapshot.id}' must end with ':free' suffix to guarantee zero-cost routing`);
  }

  // 4. Exact Source Identity: must match an approved endpoint for this provider
  if (typeof snapshot.source !== 'string' || snapshot.source.trim() === '') {
    return fail("Model snapshot missing valid 'source' endpoint string");
  }
  const approvedUrls = Object.values(providerEndpoints);
  if (!approvedUrls.includes(snapshot.source.trim())) {
    return fail(
      `Model snapshot source '${snapshot.source}' is not an approved destination for provider '${normProvider}'. Approved destinations: ${approvedUrls.join(', ')}`
    );
  }

  // 5. Finite Coherent Timestamps & TTL
  if (typeof snapshot.checkedAt !== 'string' && typeof snapshot.checkedAt !== 'number') {
    return fail("Model snapshot missing valid 'checkedAt' timestamp");
  }
  const checkedTime = new Date(snapshot.checkedAt).getTime();
  if (!Number.isFinite(checkedTime) || Number.isNaN(checkedTime) || checkedTime <= 0) {
    return fail(`Model snapshot has non-finite or invalid checkedAt timestamp: ${snapshot.checkedAt}`);
  }
  // Reject future checkedAt claims: verification evidence cannot be from the future
  if (checkedTime > Date.now()) {
    return fail(`Model snapshot checkedAt (${snapshot.checkedAt}) is in the future. Future verification claims are prohibited.`);
  }

  if (
    typeof snapshot.ttlMs !== 'number' ||
    !Number.isFinite(snapshot.ttlMs) ||
    snapshot.ttlMs <= 0 ||
    snapshot.ttlMs > 86400000 ||
    Object.is(snapshot.ttlMs, -0)
  ) {
    return fail(`Model snapshot has non-finite or out-of-bounds ttlMs (${snapshot.ttlMs}). Must be a finite positive number <= 86400000ms.`);
  }

  if (
    typeof snapshot.expiresAt !== 'number' ||
    !Number.isFinite(snapshot.expiresAt) ||
    snapshot.expiresAt <= 0 ||
    Object.is(snapshot.expiresAt, -0)
  ) {
    return fail(`Model snapshot has non-finite or non-positive expiresAt: ${snapshot.expiresAt}`);
  }

  // Coherence: expiresAt must be at or after checkedTime and coherent with checkedAt + ttlMs
  if (snapshot.expiresAt < checkedTime) {
    return fail(`Model snapshot expiresAt (${snapshot.expiresAt}) is earlier than checkedAt (${checkedTime})`);
  }
  const expectedExpiresAt = checkedTime + snapshot.ttlMs;
  if (Math.abs(snapshot.expiresAt - expectedExpiresAt) > 1000) {
    return fail(
      `Model snapshot timestamps are incoherent: expiresAt (${snapshot.expiresAt}) does not match checkedAt (${checkedTime}) + ttlMs (${snapshot.ttlMs}) = ${expectedExpiresAt}`
    );
  }

  // Stale / Expired check against current time
  if (!allowExpired && Date.now() >= snapshot.expiresAt) {
    const msg = `Model snapshot proof for '${snapshot.id}' has expired (expired at ${new Date(snapshot.expiresAt).toISOString()})`;
    return fail(msg, { expired: true });
  }

  // 6. Capability Verification: literal tools & mandatory explicit capabilities
  if (typeof snapshot.toolCalling !== 'boolean' || snapshot.toolCalling !== true) {
    return fail(`Model snapshot for '${snapshot.id}' does not prove literal tool calling capability (toolCalling must be boolean true)`);
  }

  // supportedParameters is MANDATORY
  if (!Array.isArray(snapshot.supportedParameters) || snapshot.supportedParameters.length === 0) {
    return fail(`Model snapshot for '${snapshot.id}' missing mandatory explicit 'supportedParameters' array`);
  }

  for (const param of snapshot.supportedParameters) {
    if (typeof param !== 'string' || param.trim() === '') {
      return fail(
        `Model snapshot 'supportedParameters' contains invalid non-string or empty capability: ${typeof param === 'object' ? JSON.stringify(param) : String(param)}`
      );
    }
  }

  const hasToolSupport = snapshot.supportedParameters.includes('tools') || snapshot.supportedParameters.includes('functions');
  if (!hasToolSupport) {
    return fail(`Model snapshot 'supportedParameters' for '${snapshot.id}' lacks verified 'tools' or 'functions' capability`);
  }

  const hasTokenLimit = snapshot.supportedParameters.includes('max_tokens') || snapshot.supportedParameters.includes('max_completion_tokens');
  if (!hasTokenLimit) {
    return fail(`Model snapshot 'supportedParameters' for '${snapshot.id}' lacks verified output token limit capability ('max_tokens' or 'max_completion_tokens')`);
  }

  // 7. Complete Explicit Relevant Zero Prices & Nonzero Request Price Rejection
  const pricing = snapshot.pricing;
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) {
    return fail('Model snapshot pricing must be a valid plain object');
  }

  if (
    typeof pricing.inputCostPerM !== 'number' ||
    !Number.isFinite(pricing.inputCostPerM) ||
    pricing.inputCostPerM !== 0 ||
    Object.is(pricing.inputCostPerM, -0)
  ) {
    return fail(`Model snapshot has invalid or non-zero inputCostPerM (${pricing.inputCostPerM}). Explicit positive zero required.`);
  }

  if (
    typeof pricing.outputCostPerM !== 'number' ||
    !Number.isFinite(pricing.outputCostPerM) ||
    pricing.outputCostPerM !== 0 ||
    Object.is(pricing.outputCostPerM, -0)
  ) {
    return fail(`Model snapshot has invalid or non-zero outputCostPerM (${pricing.outputCostPerM}). Explicit positive zero required.`);
  }

  if (pricing.requestCost !== undefined && pricing.requestCost !== null) {
    if (
      typeof pricing.requestCost !== 'number' ||
      !Number.isFinite(pricing.requestCost) ||
      pricing.requestCost !== 0 ||
      Object.is(pricing.requestCost, -0)
    ) {
      return fail(`Model snapshot has non-zero or invalid requestCost (${pricing.requestCost}). Explicit positive zero required.`);
    }
  }

  return {
    valid: true,
    modelId: normId,
    provider: normProvider,
    provenZeroCost: true,
    toolCalling: true,
    expiresAt: snapshot.expiresAt
  };
}

/**
 * Validates a provider routing specification against approved destinations and verified zero-cost catalog.
 */
export function validateProviderRoute({ provider, model, endpoint }) {
  return validateFreeRouting({ provider, model, endpoint });
}

import { validateQualificationSummary } from './qualification-validator.js';

export { validateQualificationSummary };

/**
 * Creates an instance of the model validator port for external orchestrators (e.g., AGR-5).
 */
export function createModelValidatorPort(options = {}) {
  return {
    validateSnapshot: (snapshot, opts = {}) => validateModelSnapshot(snapshot, { ...options, ...opts }),
    validateRoute: (route, opts = {}) => validateProviderRoute(route),
    validateQualification: (summary, opts = {}) => validateQualificationSummary(summary, { ...options, ...opts }),
    getMetadata: (modelId, provider) => getModelMetadata(modelId, provider),
    approvedEndpoints: { ...APPROVED_ENDPOINTS }
  };
}
