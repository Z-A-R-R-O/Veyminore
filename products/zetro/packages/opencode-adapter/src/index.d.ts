/**
 * Type declarations for @zetro/opencode-adapter.
 */

export interface AdapterModel {
  providerID: string;
  modelID: string;
}

export interface OpenCodeAdapterOptions {
  /** Literal loopback base URL of the local OpenCode server (e.g. http://127.0.0.1:4096). */
  endpoint: string;
  /** Injected fetch implementation. No live network is performed by the adapter itself. */
  fetch: typeof fetch;
  /** Opaque credential callback returning auth header name/value pairs. Values are never logged by the adapter. */
  getCredentialHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Exact pinned project id (GET /project/current). */
  projectID: string;
  /** Exact pinned session id (GET /session/:id). */
  sessionID: string;
  /** Exact pinned workspace directory (GET /path). */
  directory: string;
  /** Exact pinned workspace root (GET /path). */
  root: string;
  /** Agent name used for prompts. Defaults to 'build'. */
  agent?: string;
  /** Per-request timeout in ms. Defaults to 15000. */
  timeoutMs?: number;
  /** Maximum response body size in bytes. Defaults to 1 MiB. */
  maxResponseBytes?: number;
  /** Maximum request body size in bytes. Defaults to 64 KiB. */
  maxRequestBytes?: number;
  /** Optional durable journal port. When provided, restart replays of a known
   *  messageID return duplicate/no-resend instead of resubmitting. */
  journal?: {
    get(messageID: string): { state: string; at: number; reason?: string } | undefined;
    set(messageID: string, entry: { state: string; at: number; reason?: string }): void;
  };
}

export interface PromptResult {
  messageID: string;
  state: 'acknowledged' | 'delivery_unknown' | 'rejected';
  duplicate: boolean;
  resent: false;
}

export interface CorrelateResult {
  messageID: string;
  state: string;
  correlated: boolean;
}

export interface StatusResult {
  raw: unknown;
  completes: false;
  note: string;
}

export interface JournalReceipt {
  messageID: string;
  state: string;
  at: number;
  reason?: string;
}

export interface OpenCodeAdapter {
  verifyIdentity(): Promise<{ projectID: string; sessionID: string; directory: string; root: string }>;
  prompt(input: { messageID: string; text: string; model?: AdapterModel; agentName?: string }): Promise<PromptResult>;
  correlate(messageID: string): Promise<CorrelateResult>;
  status(): Promise<StatusResult>;
  abort(): Promise<{ aborted: boolean }>;
  receipt(messageID: string): JournalReceipt | null;
  freeModel: Readonly<AdapterModel>;
}

export declare class AdapterError extends Error {
  code: string;
  constructor(code: string, message: string, cause?: unknown);
}

export declare const redact: (text: unknown) => string;

export declare function createOpenCodeAdapter(options: OpenCodeAdapterOptions): OpenCodeAdapter;

export declare class JournalError extends Error {
  code: string;
}

export interface FileJournalPort {
  get(messageID: string): { state: string; at: number; reason?: string; digest?: string } | undefined;
  set(messageID: string, entry: { state: string; at: number; reason?: string; digest?: string }): { state: string; at: number; reason?: string; digest?: string };
}

/** Bounded file-backed journal port. Explicit path required. Injected fs-compatible
 *  storage (tests/temp stores) or node:fs. Synchronous get/set; atomic temp-write
 *  + fsync + rename before dispatch. Persists only IDs/state/time/reason/digest —
 *  never credentials, prompt text, or source. Corrupt or partial records fail
 *  closed with JournalError. Not multiprocess-safe. */
export declare function createFileJournal(options: {
  path: string;
  fs?: {
    readFileSync(path: string, encoding: string): string | Buffer;
    writeFileSync(fd: number | string, data: string, encoding?: string): void;
    renameSync(from: string, to: string): void;
    openSync?(path: string, flags: string): number;
    fsyncSync?(fd: number): void;
    closeSync?(fd: number): void;
    mkdirSync?(path: string, opts: { recursive: boolean }): void;
  };
  maxEntries?: number;
}): FileJournalPort;

export interface PinnedModel {
  providerID: 'opencode';
  modelID: 'opencode/mimo-v2.6-flash-free';
}

export declare const MANIFEST_PINNED_MODEL: Readonly<PinnedModel>;

export declare class ManifestError extends Error {
  code: string;
  constructor(code: string, message: string);
}

export interface WorkerManifestCapabilities {
  effects: readonly string[];
  actions: readonly string[];
  canDelegate: boolean;
  supportsCancellation: boolean;
  supportsResume: boolean;
}

export interface WorkerManifestAvailability {
  status: 'available' | 'idle' | 'busy' | 'running';
  observedAt: number;
  sessionState: string;
  completionCertified: false;
}

export interface WorkerManifestQualification {
  status: string;
  verifiedAt: number;
}

export interface WorkerManifest {
  schemaVersion: 'zetro.ifz.worker_manifest.v1';
  workerId: string;
  workerType: 'opencode-worker';
  adapterId: string;
  projectId: string;
  workspaceId: string;
  sessionID: string;
  directory: string;
  gitRoot: string;
  model: Readonly<PinnedModel>;
  capabilities: Readonly<WorkerManifestCapabilities>;
  availability: Readonly<WorkerManifestAvailability>;
  qualification: Readonly<WorkerManifestQualification>;
}

export interface ProjectManifestOptions {
  projectID?: string;
  projectId?: string;
  workspaceId?: string;
  directory?: string;
  sessionID?: string;
  now?: number;
  maxAgeMs?: number;
  registry?: Set<string>;
}

export declare function projectWorkerManifest(claim: Record<string, any>, options?: ProjectManifestOptions): Readonly<WorkerManifest>;
export declare function projectWorkerManifests(claims: Record<string, any>[], options?: ProjectManifestOptions): readonly Readonly<WorkerManifest>[];

