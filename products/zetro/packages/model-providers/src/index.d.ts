/**
 * @zetro/model-providers
 *
 * TypeScript definitions for dependency-free model providers and contracts.
 */

export interface ModelPricing {
  inputCostPerM: number;
  outputCostPerM: number;
  requestCost?: number;
}

export interface ModelMetadata {
  id: string;
  provider: 'groq' | 'opencode' | 'openrouter';
  displayName: string;
  contextWindow: number;
  toolCalling: boolean;
  pricing: ModelPricing;
  isFree: boolean;
  priceEvidence: string;
  source: string;
  checkedAt: string;
  dataPolicy: string;
  eligibility: string;
  supportedParameters?: string[];
}

export interface ModelSnapshot {
  id: string;
  provider: string;
  displayName: string;
  contextWindow: number;
  toolCalling: boolean;
  pricing: ModelPricing;
  isFree: boolean;
  supportedParameters: string[];
  negotiatedParameters: {
    parallelToolCalls: boolean;
    tools: boolean;
    toolChoice?: boolean;
    maxTokensParam?: 'max_tokens' | 'max_completion_tokens' | null;
    temperature?: boolean;
  };
  source: string;
  checkedAt: string;
  ttlMs: number;
  expiresAt: number;
  accountEligibility: string;
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  toolCall?: {
    id?: string;
    name: string;
    args: Record<string, unknown>;
  };
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ProviderToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface NextResult {
  toolCalls: ProviderToolCall[];
  usage: ProviderUsage;
  attempts?: number;
  retries?: number;
}

export interface CheckAccessResult {
  authenticated: boolean;
  modelAvailable: boolean;
  model: string;
  accountEligibility?: string;
  provenZeroCost?: boolean;
  limits?: unknown;
}

export interface TransportReserveContext {
  provider: string;
  model: string;
  attempt: number;
  remainingMs: number;
  signal?: AbortSignal | null;
  url?: string;
  [key: string]: unknown;
}

export interface TransportReservationResult {
  ok: boolean;
  reason?: string;
  retryAfterMs?: number;
}

export interface TransportReportContext {
  provider: string;
  model: string;
  attempt: number;
  ok: boolean;
  status: number | null;
  error: unknown | null;
  usage?: ProviderUsage;
  unknownUsage: boolean;
  durationMs: number;
  remainingMs: number;
  url?: string;
  [key: string]: unknown;
}

export interface TransportLifecyclePort {
  reserve(context: TransportReserveContext): Promise<TransportReservationResult> | TransportReservationResult;
  report(context: TransportReportContext): Promise<void> | void;
}

export function createTransportLifecyclePort(handlers?: {
  reserve?: (context: TransportReserveContext) => Promise<TransportReservationResult> | TransportReservationResult;
  report?: (context: TransportReportContext) => Promise<void> | void;
} | TransportLifecyclePort): TransportLifecyclePort;

export function wrapFetchWithTransportLifecycle(
  fetchImpl: typeof fetch,
  lifecyclePort: TransportLifecyclePort | { reserve?: Function; report?: Function },
  defaultContext?: Record<string, unknown>
): typeof fetch;

export interface NextOptions {
  messages: ProviderMessage[];
  tools: (string | ToolDefinition)[];
  maxOutputTokens?: number;
  timeoutMs?: number;
  snapshot?: Partial<ModelSnapshot> | null;
  signal?: AbortSignal | null;
  transportPort?: TransportLifecyclePort | null;
}

export interface ModelProvider {
  name: string;
  metadata?: ModelMetadata;
  checkAccess(timeoutMs?: number): Promise<CheckAccessResult>;
  next(options: NextOptions): Promise<NextResult>;
}

export interface BaseProviderOptions {
  provider: string;
  apiKey: string;
  model: string;
  endpoint: string;
  modelsEndpoint?: string | null;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  maxRetries?: number;
  defaultHeaders?: Record<string, string>;
  allowLiveCalls?: boolean;
  snapshot?: Partial<ModelSnapshot> | null;
  transportPort?: TransportLifecyclePort | null;
  transportLifecycle?: TransportLifecyclePort | null;
}

export class BaseOpenAICompatibleProvider implements ModelProvider {
  constructor(options: BaseProviderOptions);
  name: string;
  provider: string;
  apiKey: string;
  model: string;
  endpoint: string;
  modelsEndpoint: string | null;
  fetchImpl: typeof fetch;
  retryDelayMs: number;
  maxRetries: number;
  defaultHeaders: Record<string, string>;
  allowLiveCalls: boolean;
  metadata: ModelMetadata;
  secrets: string[];
  transportPort: TransportLifecyclePort | null;
  assertLiveGate(): void;
  checkAccess(timeoutMs?: number): Promise<CheckAccessResult>;
  next(options: NextOptions): Promise<NextResult>;
}

export interface GroqProviderOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  modelsEndpoint?: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  allowLiveCalls?: boolean;
}

export class GroqProvider extends BaseOpenAICompatibleProvider {
  constructor(options?: GroqProviderOptions);
}

export interface OpenCodeProviderOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  modelsEndpoint?: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  allowLiveCalls?: boolean;
}

export class OpenCodeProvider extends BaseOpenAICompatibleProvider {
  constructor(options?: OpenCodeProviderOptions);
}

export interface OpenRouterProviderOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  modelsEndpoint?: string;
  authEndpoint?: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  httpReferer?: string;
  xTitle?: string;
  allowLiveCalls?: boolean;
}

export class OpenRouterProvider extends BaseOpenAICompatibleProvider {
  constructor(options?: OpenRouterProviderOptions);
  authEndpoint: string;
}

export interface CreateProviderOptions {
  provider: 'groq' | 'opencode' | 'openrouter' | string;
  model?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  allowLiveCalls?: boolean;
  transportPort?: TransportLifecyclePort | null;
  [key: string]: unknown;
}

export function createModelProvider(options: CreateProviderOptions): ModelProvider;

export class ModelDiscoveryService {
  constructor(options?: { defaultTtlMs?: number });
  defaultTtlMs: number;
  snapshots: Map<string, ModelSnapshot>;
  getSnapshot(provider: string, modelId: string): ModelSnapshot | null;
  invalidate(provider: string, modelId: string): void;
  clear(): void;
  discoverModel(options: {
    provider: string;
    modelId: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    ttlMs?: number;
    allowLiveCalls?: boolean;
    forceRefresh?: boolean;
  }): Promise<ModelSnapshot>;
}

export interface QualificationSummaryResult {
  qualified: boolean;
  provider: string | null;
  model: string | null;
  reason: string | null;
  violations: string[];
  metrics: {
    planned: number;
    attempted: number;
    verified: number;
    failures: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    wallMs: number;
  } | null;
}

export interface ModelValidatorPort {
  validateSnapshot(snapshot: unknown, options?: { strict?: boolean; allowExpired?: boolean }): { valid: boolean; modelId?: string; provider?: string; provenZeroCost?: boolean; toolCalling?: boolean; expiresAt?: number; reason?: string; expired?: boolean };
  validateRoute(route: { provider: string; model: string; endpoint?: string }): ModelMetadata;
  validateQualification(summary: unknown, options?: { strict?: boolean; snapshot?: Partial<ModelSnapshot> | null; maxAgeMs?: number | null; minTrials?: number }): QualificationSummaryResult;
  getMetadata(modelId: string, provider?: string): ModelMetadata | null;
  approvedEndpoints: typeof APPROVED_ENDPOINTS;
}

export function validateModelSnapshot(snapshot: unknown, options?: { strict?: boolean; allowExpired?: boolean }): { valid: boolean; modelId?: string; provider?: string; provenZeroCost?: boolean; toolCalling?: boolean; expiresAt?: number; reason?: string; expired?: boolean };
export function validateProviderRoute(route: { provider: string; model: string; endpoint?: string }): ModelMetadata;
export function validateQualificationSummary(summary: unknown, options?: { strict?: boolean; snapshot?: Partial<ModelSnapshot> | null; maxAgeMs?: number | null; minTrials?: number }): QualificationSummaryResult;
export function createModelValidatorPort(options?: Record<string, unknown>): ModelValidatorPort;

export const APPROVED_ENDPOINTS: {
  groq: { chat: string; models: string };
  opencode: { chat: string; models: string };
  openrouter: { chat: string; auth: string; models: string };
};

export const FREE_MODEL_CATALOG: Record<string, ModelMetadata>;

export function getModelMetadata(modelId: string, provider?: string | null): ModelMetadata | null;
export function listFreeModels(provider?: string | null): ModelMetadata[];
export function validateFreeRouting(options: { provider: string; model: string; endpoint?: string }): ModelMetadata;
export function validateEndpoint(provider: string, purpose: string, endpoint: string): string;
export function normalizeModelId(modelId: string, provider?: string): string;

export class ProviderError extends Error {
  constructor(message: string, options?: { status?: number | null; retryAfter?: string | null; provider?: string | null; secrets?: string[]; cause?: unknown; attempts?: number; retries?: number; usage?: ProviderUsage; remoteUsageUncertain?: boolean });
  status: number | null;
  retryAfter: string | null;
  provider: string | null;
  cause?: unknown;
  accountingFailure?: boolean;
  remoteUsageUncertain?: boolean;
  attempts?: number;
  retries?: number;
  usage?: ProviderUsage;
}

export class RateLimitError extends ProviderError {
  constructor(message?: string, options?: { retryAfter?: string | null; provider?: string | null; secrets?: string[]; cause?: unknown; attempts?: number; retries?: number; usage?: ProviderUsage; remoteUsageUncertain?: boolean });
}

export class FreeTierDepletedError extends ProviderError {
  constructor(message?: string, options?: { status?: number; provider?: string | null; secrets?: string[]; cause?: unknown; attempts?: number; retries?: number; usage?: ProviderUsage; remoteUsageUncertain?: boolean });
}

export class FreeRoutingViolationError extends ProviderError {
  constructor(message?: string, options?: { status?: number; provider?: string | null; secrets?: string[]; cause?: unknown; attempts?: number; retries?: number; usage?: ProviderUsage; remoteUsageUncertain?: boolean });
}

export class ProviderTransportError extends ProviderError {
  constructor(message?: string, options?: { attempts?: number; retries?: number; networkCodes?: string[]; status?: number | null; retryAfter?: string | null; provider?: string | null; secrets?: string[]; cause?: unknown; remoteUsageUncertain?: boolean });
  attempts: number;
  retries: number;
  networkCodes: string[];
}

export function networkCodes(error: unknown): string[];
export function isTransportFailure(error: unknown): boolean;
export function redactSecrets(text: string, secrets?: string[]): string;
export function sanitizeError(target: unknown, secrets?: string[], seen?: WeakSet<object>): unknown;
export function redactError(error: unknown, secrets?: string[]): unknown;
export function createHttpError(response: Response, providerName: string, secrets?: string[], attempts?: number): ProviderError;
export function extractMeasuredUsage(body: unknown): ProviderUsage | undefined;

export const STANDARD_TOOL_SCHEMAS: Record<string, ToolDefinition>;
export function convertMessages(messages: unknown): unknown[];
export function resolveTools(tools: unknown): ToolDefinition[];
export function sleep(ms: number): Promise<void>;

export interface ConfiguredProviderOptions {
  config?: any;
  env?: Record<string, string | undefined>;
  envFile?: string;
  syntheticEnvContent?: string;
  loadConfigImpl?: (options: any) => any;
  catalogPort?: any;
  allowLiveCalls?: boolean;
  fetchImpl?: typeof fetch;
  snapshot?: Partial<ModelSnapshot> | null;
  steps?: Array<{ name: string; args: Record<string, unknown> }> | null;
  transportPort?: TransportLifecyclePort | null;
  [key: string]: unknown;
}

export class ConfiguredModelProvider implements ModelProvider {
  constructor(options?: ConfiguredProviderOptions);
  name: string;
  provider: string;
  model: string;
  config: any;
  allowLiveCalls: boolean;
  fetchImpl: typeof fetch;
  snapshot: Partial<ModelSnapshot> | null;
  steps: Array<{ name: string; args: Record<string, unknown> }> | null;
  transportPort: TransportLifecyclePort | null;
  secrets: string[];
  checkAccess(timeoutMs?: number): Promise<CheckAccessResult>;
  next(options: NextOptions): Promise<NextResult>;
}

export function createConfiguredProvider(options?: ConfiguredProviderOptions): ConfiguredModelProvider;
export const createRuntimeProvider: typeof createConfiguredProvider;
export function createModelCatalogPort(): (params: { provider: string; model: string; freeOnly?: boolean; maxCostUsd?: number }) => any;

