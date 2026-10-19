export type ErrorCode =
  | 'REQUEST_INVALID'
  | 'OBSERVER_TIMEOUT'
  | 'OBSERVER_CANCELLED'
  | 'RESPONSE_MALFORMED'
  | 'RESPONSE_TOO_LARGE'
  | 'WINDOW_MISSING'
  | 'WINDOW_STALE'
  | 'WINDOW_MINIMIZED'
  | 'WINDOW_NOT_VISIBLE'
  | 'GENERATION_MISMATCH'
  | 'PROCESS_MISMATCH'
  | 'CAPTURE_UNSUPPORTED'
  | 'ARTIFACT_INVALID'
  | 'INLINE_PIXELS_REJECTED'
  | 'PORT_REVOKED';

export declare const ERROR_CODES: readonly ErrorCode[];

export declare class ObserverError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>);
}

export interface RunnerSpec {
  kind: 'enumerate' | 'inspect';
  limit?: number;
  maxWindows?: number;
  windowHandle?: number;
  expected?: NativeIdentityExpectation;
}

export interface ProcessRunner {
  run(
    spec: RunnerSpec,
    opts: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<{ ok?: boolean; stdout: string; stderr?: string }>;
}

export interface CaptureBackend {
  status: 'supported' | 'unsupported';
  independentlyTested?: boolean;
  capture(
    target: { hwnd: number; processId: number },
    opts: { signal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
}

export interface ObserverOptions {
  processRunner: ProcessRunner;
  captureBackend?: CaptureBackend | null;
  clock?: () => number;
  maxWindows?: number;
  maxTitleChars?: number;
  maxResponseBytes?: number;
  maxAgeMs?: number;
  timeoutMs?: number;
  includeTitles?: boolean;
}

export interface WindowMeta {
  hwnd: number;
  processId: number;
  processName: string;
  minimized: boolean;
  visible: boolean;
  generation: string;
  title?: string;
  titleChars?: number;
}

export interface SnapshotMeta {
  generation: string;
  observedAt: number;
  ageMs: number;
  truncated: boolean;
  dropped: number;
}

export interface Snapshot extends SnapshotMeta {
  windows: WindowMeta[];
}

export interface ArtifactRef {
  mime: string;
  width: number;
  height: number;
  bytes: number;
  ref: string;
  artifactId?: string;
  sha256?: string;
}

export type CaptureInfo =
  | { status: 'not_requested'; artifact: null }
  | { status: 'unsupported'; artifact: null; reason: 'NATIVE_CAPTURE_UNSUPPORTED' }
  | { status: 'captured'; artifact: ArtifactRef; retention: string; attestation: string };

export interface ObserveRequest {
  hwnd: number;
  expectedGeneration?: string | number;
  expectedProcessId?: number;
  maxAgeMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  capture?: boolean;
  requireCapture?: boolean;
}

export interface ObserveResult {
  status: 'observed';
  window: WindowMeta;
  snapshot: SnapshotMeta;
  capture: CaptureInfo;
}

export interface Capabilities {
  read: {
    enumerateWindows: true;
    observeWindow: true;
    freshnessChecks: true;
    generationChecks: true;
    futureTimestampRejection: true;
    strictFlagTypes: true;
    timeout: true;
    cancellation: true;
    boundedResponses: true;
  };
  nativeCapture: 'supported' | 'unsupported';
  nativeCaptureAttestation: string;
  effects: { mouse: false; keyboard: false; clipboard: false; shell: false };
}

export interface Observer {
  enumerate(req?: { limit?: number; timeoutMs?: number; signal?: AbortSignal }): Promise<Snapshot>;
  observeWindow(req: ObserveRequest): Promise<ObserveResult>;
  getCapabilities(): Capabilities;
  getLastSnapshot(): Snapshot | null;
  config: Readonly<Record<string, unknown>>;
}

export declare function createObserver(options: ObserverOptions): Observer;

export interface NativeObservationRecord {
  windowHandle: number;
  processId: number;
  processStartedAt: number;
  generation: string;
  displayId: number;
  minimized: boolean;
  visible: boolean;
  title?: string;
}

export interface NativeEnumerateResponse {
  windows: NativeObservationRecord[];
  generation: string | number;
  observedAt: number;
}

export interface NativeInspectResponse {
  window: NativeObservationRecord;
  observedAt: number;
}

export interface NativeCaptureResponse {
  artifact: {
    mime: string;
    width: number;
    height: number;
    bytes: number;
    artifactId?: string;
    uri?: string;
    sha256?: string;
  };
  [key: string]: unknown;
}

export interface NativeIdentityExpectation {
  processId?: number;
  processStartedAt?: number;
  generation?: string | number;
  displayId?: number;
}

export interface NativeObservationPortCallOptions {
  signal?: AbortSignal;
}

/**
 * Small injected port implemented by a separate native provider package
 * (AGR4). This package never imports that implementation and never executes
 * native code itself. `independentlyTested` is a caller assertion only —
 * never native-verified proof.
 */
export interface NativeObservationPort {
  independentlyTested?: boolean;
  enumerate(
    params: { maxWindows: number },
    opts: NativeObservationPortCallOptions,
  ): Promise<NativeEnumerateResponse>;
  inspect(
    params: { windowHandle: number },
    opts: NativeObservationPortCallOptions,
  ): Promise<NativeInspectResponse | null>;
  capture(
    params: {
      windowHandle: number;
      processId: number;
      processStartedAt: number;
      generation: string;
      displayId: number;
    },
    opts: NativeObservationPortCallOptions,
  ): Promise<NativeCaptureResponse>;
}

export interface NativeObservationAdapterOptions {
  port?: NativeObservationPort | null;
  clock?: () => number;
  maxWindows?: number;
  maxTitleChars?: number;
  maxResponseBytes?: number;
  maxAgeMs?: number;
  timeoutMs?: number;
}

export interface NativeAdapterCapabilities {
  read: {
    enumerate: true;
    inspect: true;
    capture: true;
    freshness: true;
    identityRecheckBeforeAfter: true;
    timeout: true;
    cancellation: true;
    boundedResponses: true;
  };
  provider: 'injected' | 'missing';
  nativeCapture: 'supported' | 'unsupported';
  nativeCaptureAttestation: string;
  effects: { mouse: false; keyboard: false; clipboard: false; shell: false };
}

export interface NativeObservationAdapter {
  enumerate(req?: {
    limit?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<SnapshotMeta & { windows: NativeObservationRecord[] }>;
  inspect(
    req: { windowHandle: number; expected?: NativeIdentityExpectation },
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<NativeObservationRecord & { observedAt: number; ageMs: number }>;
  capture(
    target: {
      windowHandle?: number;
      hwnd?: number;
      processId?: number;
      pid?: number;
      processStartedAt?: number;
      generation?: string | number;
      displayId?: number;
    },
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<{
    status: 'captured';
    artifact: ArtifactRef & { artifactId: string };
    target: NativeObservationRecord;
    identityRecheck: { before: number; after: number };
    attestation: string;
    retention: string;
  }>;
  run(
    spec: RunnerSpec,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<{ ok: true; stdout: string }>;
  getCapabilities(): NativeAdapterCapabilities;
  revoke(): void;
  readonly revoked: boolean;
  status: 'supported' | 'unsupported';
  independentlyTested: boolean;
}

export declare function createNativeObservationAdapter(
  options?: NativeObservationAdapterOptions,
): NativeObservationAdapter;

export type IfzState =
  | 'available'
  | 'idle'
  | 'running'
  | 'reportedComplete'
  | 'verifiedComplete'
  | 'unavailable'
  | 'interrupted'
  | 'uncertain';

export type IfzRejection =
  | 'EVENT_MALFORMED'
  | 'EVENT_TOO_LARGE'
  | 'EVENT_FUTURE'
  | 'EVENT_STALE'
  | 'EVENT_MISMATCH'
  | 'EVENT_REORDERED'
  | 'EVENT_DUPLICATE';

export interface IfzObserverEvent {
  id: string;
  seq: number;
  at: number;
  kind: string;
  source: string;
  project?: string;
  workspace?: string;
  evidence?: string[];
}

export interface IfzPublicStatus {
  state: IfzState;
  subtext: string;
  ageMs: number | null;
  source: string | null;
  project: string | null;
  workspace: string | null;
  seq: number | null;
  evidence: readonly string[];
  admitted: number;
  rejections: { total: number; byCode: Record<IfzRejection, number> };
}

export interface IfzProjectorOptions {
  clock?: () => number;
  maxAgeMs?: number;
  maxEventBytes?: number;
  maxSubtextBytes?: number;
  maxSourceChars?: number;
  maxIdChars?: number;
  maxEvidenceRefs?: number;
  maxEvidenceRefChars?: number;
  recentIdLimit?: number;
}

export interface IfzProjector {
  accept(event: unknown): { admitted: boolean; code: IfzRejection | null };
  project(): IfzPublicStatus;
  stats(): { admitted: number; rejected: number; lastSeq: number | null; source: string | null };
  reset(): void;
  config: Readonly<Record<string, number>>;
}

export declare function createIfzProjector(options?: IfzProjectorOptions): IfzProjector;

export default createObserver;
