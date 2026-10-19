/**
 * @file index.js
 * Public entry point for @zetro/model-gateway.
 */

export {
  ACTION_CONTRACT_VERSION,
  ComputerActionType,
  MouseButton,
  ClickType,
  RiskLevel,
  ComputerActionValidationError,
  validateComputerAction
} from './contracts/action-contract.js';

export {
  VerificationState,
  ModelCompatibilityLevel,
  CAPABILITY_KEYS,
  CapabilityValidationError,
  validateModelProfile,
  createCapabilityProfile,
  determineCompatibilityLevel
} from './contracts/capabilities.js';

export {
  ModelGatewayError,
  ProviderTimeoutError,
  QuotaExceededError,
  CapabilityMismatchError,
  AdapterTranslationError,
  createModelProviderPort
} from './contracts/model-provider.js';

export {
  ModelProviderRegistry,
  RegistryEvent,
  ModelRegistryError
} from './registry/provider-registry.js';

export {
  CapabilityProbe,
  TEST_1X1_PNG_BASE64
} from './registry/capability-probe.js';

export {
  compileAnthropicTools,
  compileOpenAITools,
  compileGeminiTools,
  parseAnthropicComputerAction,
  parseOpenAIComputerAction,
  parseGeminiComputerAction,
  parseStructuredJsonAction
} from './adapters/schema-compiler.js';

export { createOpenAICompatibleAdapter } from './adapters/openai-compatible.js';
export { createAnthropicAdapter } from './adapters/anthropic.js';
export { createGeminiAdapter } from './adapters/gemini.js';

export {
  createMcpServer,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION
} from './mcp/mcp-server.js';
