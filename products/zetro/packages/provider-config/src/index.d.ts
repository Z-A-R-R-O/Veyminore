/**
 * Type declarations for @zetro/provider-config
 */

export interface KeysPresent {
  readonly groq: boolean;
  readonly opencode: boolean;
  readonly openrouter: boolean;
}

export interface ConfigStatus {
  readonly ready: boolean;
  readonly mode: 'offline-safe' | 'live-approved' | 'unready' | 'invalid-config' | 'invalid-provider';
  readonly reasons: readonly string[];
}

export interface ModelVerification {
  readonly verified: boolean;
  readonly eligible: boolean;
  readonly isFree: boolean;
  readonly pricingProof: string | null;
  readonly reason: string;
}

export interface PublicProviderConfig {
  readonly provider: string;
  readonly model: string;
  readonly liveAllowed: boolean;
  readonly sourceSharingApproved: boolean;
  readonly providerApproved: boolean;
  readonly approvedProvidersList: readonly string[] | null;
  readonly freeOnly: boolean;
  readonly maxCostUsd: number;
  readonly concurrency: number;
  readonly keysPresent: KeysPresent;
  readonly invalidFlags: readonly string[];
  readonly modelVerification: ModelVerification;
  readonly status: ConfigStatus;
}

export interface ZetroProviderConfig extends PublicProviderConfig {
  getApiKey(providerName: string): string | undefined;
  hasApiKey(providerName: string): boolean;
  getPublicConfig(): PublicProviderConfig;
  toJSON(): PublicProviderConfig;
}

export interface LoadProviderConfigOptions {
  env?: Record<string, string | undefined>;
  envFile?: string;
  syntheticEnvContent?: string;
  catalogValidator?: (params: { provider: string; model: string; freeOnly: boolean; maxCostUsd: number }) => any;
  catalogPort?: any;
  cwd?: string;
  injectedNodeVersion?: string;
  injectedSqliteAvailable?: boolean | (() => boolean);
}

export interface DiagnosticItem {
  name: string;
  status: 'PASS' | 'INFO' | 'WARN' | 'FAIL';
  message: string;
  sqliteAvailable?: boolean;
}

export interface DoctorReport extends PublicProviderConfig {
  timestamp: string;
  nodeVersion?: string;
  diagnostics: DiagnosticItem[];
}

export interface DoctorCliResult {
  exitCode: number;
  report: DoctorReport | null;
  output: string;
}

export interface BooleanFlagResult {
  value: boolean;
  isValid: boolean;
  isDefault: boolean;
  error?: string;
}

export function parseStrictBooleanFlag(value: unknown, flagName: string, defaultValue?: boolean): BooleanFlagResult;
export function parseStrictBoolean(value: unknown, defaultValue?: boolean): boolean;
export function isStrictTrue(value: unknown): boolean;
export function isStrictFalse(value: unknown): boolean;

export function parseStrictInteger(value: unknown, flagName: string, options?: { min?: number; max?: number; defaultValue?: number }): { value: number; isValid: boolean; isDefault: boolean; error?: string };
export function parseStrictCost(value: unknown, flagName: string, options?: { freeOnly?: boolean; maxLimit?: number }): { value: number; isValid: boolean; isDefault: boolean; error?: string };

export function validateModelEligibility(params: { provider: string; model: string; freeOnly: boolean; maxCostUsd: number; catalogPort?: any }): ModelVerification;
export function createCatalogSnapshotPort(catalogSnapshot: Record<string, Record<string, any>>): (params: { provider: string; model: string; freeOnly: boolean; maxCostUsd: number }) => any;

export function parseDotEnv(content: string): Record<string, string>;
export function parseDotEnvFile(filePath: string): Record<string, string>;

export function loadProviderConfig(options?: LoadProviderConfigOptions): ZetroProviderConfig;

export function getDoctorReport(configOrOptions?: ZetroProviderConfig | LoadProviderConfigOptions): DoctorReport;
export function formatDoctorReport(report: DoctorReport): string;
export function runDoctorCli(argv?: string[], io?: { stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream; env?: Record<string, string | undefined> }): DoctorCliResult;

export const MIN_NODE_VERSION: string;
export function isNodeVersionSupported(currentVersion: string, minVersion?: string): boolean;
export function isDatabaseSyncAvailable(probe?: boolean | (() => boolean)): boolean;
export function checkNodeRuntime(
  versionOrOptions?: string | { version?: string; minVersion?: string; sqliteAvailable?: boolean | (() => boolean) },
  minVersionOrOptions?: string | { minVersion?: string; sqliteAvailable?: boolean | (() => boolean) },
  options?: { sqliteAvailable?: boolean | (() => boolean) }
): DiagnosticItem;

export const KNOWN_PROVIDERS: readonly string[];
export const DEFAULT_MODELS: Readonly<Record<string, string>>;
