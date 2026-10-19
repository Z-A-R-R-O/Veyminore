/**
 * Model Providers - OpenRouter Adapter
 *
 * OpenRouter adapter with strict :free route enforcement, account limit verification,
 * and explicit model availability checks distinguishing account eligibility from route cost.
 */

import { BaseOpenAICompatibleProvider } from './base.js';
import { APPROVED_ENDPOINTS, validateEndpoint } from './metadata.js';
import {
  isTransportFailure,
  networkCodes,
  createHttpError,
  ProviderTransportError,
  ProviderError,
  FreeTierDepletedError,
  FreeRoutingViolationError,
  redactError
} from './errors.js';

function assertExplicitZeroCost(val, name, model, secrets) {
  if (typeof val !== 'number' && typeof val !== 'string') {
    throw new FreeRoutingViolationError(
      `OpenRouter model '${model}' ${name} pricing (${typeof val === 'object' ? JSON.stringify(val) : String(val)}) must be an explicit numeric or string zero. Rejected non-number/non-string type.`,
      { provider: 'openrouter', secrets }
    );
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '' || !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
      throw new FreeRoutingViolationError(
        `OpenRouter model '${model}' ${name} pricing (${JSON.stringify(val)}) is empty, whitespace, or non-numeric. Rejected invalid pricing string.`,
        { provider: 'openrouter', secrets }
      );
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num !== 0 || Object.is(num, -0)) {
      throw new FreeRoutingViolationError(
        `OpenRouter model '${model}' ${name} pricing (${val}) is not finite positive zero. Proven zero cost required.`,
        { provider: 'openrouter', secrets }
      );
    }
    return num;
  }

  if (!Number.isFinite(val) || val !== 0 || Object.is(val, -0)) {
    throw new FreeRoutingViolationError(
      `OpenRouter model '${model}' ${name} pricing (${val}) is not finite positive zero. Proven zero cost required.`,
      { provider: 'openrouter', secrets }
    );
  }
  return val;
}

export class OpenRouterProvider extends BaseOpenAICompatibleProvider {
  constructor({
    apiKey = process.env.OPENROUTER_API_KEY,
    model = 'meta-llama/llama-3.3-70b-instruct:free',
    endpoint = APPROVED_ENDPOINTS.openrouter.chat,
    modelsEndpoint = APPROVED_ENDPOINTS.openrouter.models,
    authEndpoint = APPROVED_ENDPOINTS.openrouter.auth,
    fetchImpl = globalThis.fetch,
    retryDelayMs = 400,
    httpReferer = 'https://zetro.veyminore.internal',
    xTitle = 'ZETRO RCT',
    allowLiveCalls = false,
    ...rest
  } = {}) {
    super({
      provider: 'openrouter',
      apiKey,
      model,
      endpoint,
      modelsEndpoint,
      fetchImpl,
      retryDelayMs,
      allowLiveCalls,
      defaultHeaders: {
        'HTTP-Referer': httpReferer,
        'X-Title': xTitle
      },
      ...rest
    });

    this.authEndpoint = authEndpoint;
  }

  async checkAccess(timeoutMs = 20000) {
    this.assertLiveGate();

    // Strictly validate auth and models endpoints immediately before request
    validateEndpoint('openrouter', 'auth', this.authEndpoint);
    validateEndpoint('openrouter', 'models', this.modelsEndpoint);

    const boundedTimeout = Math.max(1, Math.min(timeoutMs, 60000));

    // Phase 1: Verify key authentication & account free eligibility
    let authResponse;
    try {
      authResponse = await this.fetchImpl(this.authEndpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...this.defaultHeaders
        },
        redirect: 'error',
        signal: AbortSignal.timeout(boundedTimeout)
      });
    } catch (err) {
      if (isTransportFailure(err)) {
        throw new ProviderTransportError('OpenRouter checkAccess transport failure on auth', {
          cause: err,
          networkCodes: networkCodes(err),
          secrets: this.secrets,
          provider: 'openrouter'
        });
      }
      throw redactError(err, this.secrets);
    }

    if (!authResponse.ok) {
      throw createHttpError(authResponse, 'openrouter', this.secrets);
    }

    let authBody;
    try {
      authBody = await authResponse.json();
    } catch (err) {
      throw new ProviderError('Malformed OpenRouter auth response JSON', {
        cause: err,
        provider: 'openrouter',
        secrets: this.secrets
      });
    }

    const keyData = authBody?.data;
    if (!keyData || typeof keyData !== 'object') {
      throw new ProviderError('Malformed OpenRouter auth response', {
        provider: 'openrouter',
        secrets: this.secrets
      });
    }

    const usage = keyData.usage ?? 0;
    const limit = keyData.limit ?? null;

    if (limit !== null && usage >= limit) {
      throw new FreeTierDepletedError('OpenRouter account free-tier credit/allowance depleted', {
        provider: 'openrouter',
        secrets: this.secrets,
        status: 402
      });
    }

    // Phase 2: Query models endpoint to verify actual model availability & proven zero cost
    let modelsResponse;
    try {
      modelsResponse = await this.fetchImpl(this.modelsEndpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...this.defaultHeaders
        },
        redirect: 'error',
        signal: AbortSignal.timeout(boundedTimeout)
      });
    } catch (err) {
      if (isTransportFailure(err)) {
        throw new ProviderTransportError('OpenRouter checkAccess transport failure on models', {
          cause: err,
          networkCodes: networkCodes(err),
          secrets: this.secrets,
          provider: 'openrouter'
        });
      }
      throw redactError(err, this.secrets);
    }

    if (!modelsResponse.ok) {
      throw createHttpError(modelsResponse, 'openrouter', this.secrets);
    }

    let modelsBody;
    try {
      modelsBody = await modelsResponse.json();
    } catch (err) {
      throw new ProviderError('Malformed OpenRouter models response JSON', {
        cause: err,
        provider: 'openrouter',
        secrets: this.secrets
      });
    }

    if (!Array.isArray(modelsBody?.data)) {
      throw new ProviderError('Malformed OpenRouter models response', {
        provider: 'openrouter',
        secrets: this.secrets
      });
    }

    const foundModel = modelsBody.data.find(item => item?.id === this.model);
    if (!foundModel) {
      return {
        authenticated: true,
        modelAvailable: false,
        model: this.model,
        accountEligibility: keyData.is_free_tier ? 'free_tier' : 'standard',
        provenZeroCost: false,
        limits: {
          usage,
          limit,
          isFreeTier: Boolean(keyData.is_free_tier),
          rateLimit: keyData.rate_limit ?? null
        }
      };
    }

    // Explicitly validate pricing structure: missing, malformed, or non-zero pricing must not yield proof
    const pricing = foundModel.pricing;
    if (!pricing || typeof pricing !== 'object') {
      throw new FreeRoutingViolationError(
        `OpenRouter model '${this.model}' is missing pricing evidence from models endpoint. Missing pricing cannot authorize inference.`,
        { provider: 'openrouter', secrets: this.secrets }
      );
    }

    assertExplicitZeroCost(pricing.prompt, 'prompt', this.model, this.secrets);
    assertExplicitZeroCost(pricing.completion, 'completion', this.model, this.secrets);
    if (pricing.request !== undefined && pricing.request !== null) {
      assertExplicitZeroCost(pricing.request, 'request', this.model, this.secrets);
    }

    // Explicit tool calling capability verification: missing or empty supported_parameters must not prove tools
    const supported = foundModel.supported_parameters;
    const hasTools = Array.isArray(supported) &&
      supported.length > 0 &&
      (supported.includes('tools') || supported.includes('functions'));

    if (!hasTools) {
      throw new FreeRoutingViolationError(
        `OpenRouter model '${this.model}' lacks verified tool calling evidence in supported_parameters (${JSON.stringify(supported)}). Models without verified tool support cannot authorize inference.`,
        { provider: 'openrouter', secrets: this.secrets }
      );
    }

    return {
      authenticated: true,
      modelAvailable: true,
      model: this.model,
      accountEligibility: keyData.is_free_tier ? 'free_tier' : 'standard',
      provenZeroCost: true,
      limits: {
        usage,
        limit,
        isFreeTier: Boolean(keyData.is_free_tier),
        rateLimit: keyData.rate_limit ?? null
      }
    };
  }
}
