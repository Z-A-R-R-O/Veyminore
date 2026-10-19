/**
 * @zetro/model-providers
 *
 * Dependency-free, provider-neutral model provider adapters with strict free-only routing.
 */

export {
  BaseOpenAICompatibleProvider,
  convertMessages,
  resolveTools,
  extractMeasuredUsage,
  STANDARD_TOOL_SCHEMAS,
  sleep
} from './base.js';

export { GroqProvider } from './groq.js';
export { OpenCodeProvider } from './opencode.js';
export { OpenRouterProvider } from './openrouter.js';
export { createModelProvider } from './factory.js';

export {
  ConfiguredModelProvider,
  createConfiguredProvider,
  createRuntimeProvider,
  createModelCatalogPort
} from './configured-provider.js';

export {
  TransportLifecyclePort,
  createTransportLifecyclePort,
  wrapFetchWithTransportLifecycle
} from './transport-port.js';

export {
  APPROVED_ENDPOINTS,
  FREE_MODEL_CATALOG,
  getModelMetadata,
  listFreeModels,
  validateFreeRouting,
  validateEndpoint,
  normalizeModelId
} from './metadata.js';

export {
  ModelDiscoveryService
} from './discovery.js';

export {
  validateModelSnapshot,
  validateProviderRoute,
  createModelValidatorPort,
  validateQualificationSummary
} from './validator-port.js';

export {
  ProviderError,
  RateLimitError,
  FreeTierDepletedError,
  FreeRoutingViolationError,
  ProviderTransportError,
  networkCodes,
  isTransportFailure,
  redactSecrets,
  redactError,
  sanitizeError,
  createHttpError
} from './errors.js';
