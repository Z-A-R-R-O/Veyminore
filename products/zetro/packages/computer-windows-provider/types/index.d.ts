export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeWindowRecord {
  hwnd: number;
  processId: number;
  processName: string;
  minimized: boolean;
  visible: boolean;
  generation: string;
  title: string;
  bounds: WindowBounds;
  dpi: number;
}

export interface NativeEnumerateResult {
  generation: string;
  observedAt: number;
  windows: NativeWindowRecord[];
}

export interface NativeAutomationInfo {
  supported: boolean;
  controlType?: string;
  name?: string;
}

export interface NativeInspectResult {
  status: 'inspected';
  window: NativeWindowRecord;
  automation: NativeAutomationInfo;
}

export interface NativeReadTextResult {
  status: 'read';
  hwnd: number;
  processId: number;
  method: string;
  text: string;
  charCount: number;
}

export interface NativeWriteTextResult {
  status: 'written';
  hwnd: number;
  processId: number;
  method: string;
  charsWritten: number;
}

export interface ReadTextOptions {
  expectedPid?: number;
  expectedStart?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const MAX_TEXT_LENGTH: number;
export const MAX_TEXT_BYTES: number;

export interface WriteTextOptions {
  expectedPid: number;
  expectedStart: string;
  sessionId: string;
  grantExpiry: number;
  inputEnabled: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  clockNow?: number;
}

export declare class ProtocolError extends Error {
  readonly details: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>);
}

export declare class ProcessRunnerError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  readonly details: Record<string, unknown>;
  constructor(message: string, options?: { code?: string; cause?: unknown; details?: Record<string, unknown> });
}

export declare class CaptureBackendError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(message: string, options?: { code?: string; details?: Record<string, unknown> });
}

export declare function parseHelperEnumerateOutput(
  stdout: string,
  options?: { clockNow?: number; maxWindows?: number }
): NativeEnumerateResult;

export declare function parseHelperInspectOutput(
  stdout: string,
  options?: { clockNow?: number }
): NativeInspectResult;

export declare function parseHelperReadTextOutput(stdout: string): NativeReadTextResult;

export declare function parseHelperWriteTextOutput(stdout: string): NativeWriteTextResult;

export declare function buildHelperEnumerateArgs(options?: { limit?: number; includeTitles?: boolean }): string[];
export declare function buildHelperInspectArgs(hwnd: number): string[];
export declare function buildHelperReadTextArgs(hwnd: number, options?: { expectedPid?: number; expectedStart?: string }): string[];
export declare function buildHelperWriteTextArgs(hwnd: number, text: string, options: WriteTextOptions): string[];

export interface WindowsProcessRunner {
  run(
    spec: { kind: 'enumerate'; limit?: number; maxWindows?: number },
    opts?: { signal?: AbortSignal }
  ): Promise<{ ok: boolean; stdout: string; stderr: string }>;
  inspect(
    hwnd: number,
    opts?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<{ ok: boolean; stdout: string; stderr: string }>;
  readText(hwnd: number, opts?: ReadTextOptions): Promise<NativeReadTextResult>;
  writeText(hwnd: number, text: string, opts: WriteTextOptions): Promise<NativeWriteTextResult>;
}

export declare function createWindowsProcessRunner(options?: {
  helperPath?: string;
  execFileImpl?: Function;
  timeoutMs?: number;
  maxResponseBytes?: number;
  includeTitles?: boolean;
}): WindowsProcessRunner;

export interface WindowsCaptureBackend {
  status: 'supported' | 'unsupported';
  independentlyTested?: boolean;
  capture(
    target: { hwnd: number; processId: number },
    opts?: { signal?: AbortSignal }
  ): Promise<Record<string, unknown>>;
}

export declare function createWindowsCaptureBackend(options?: {
  status?: 'supported' | 'unsupported';
  independentlyTested?: boolean;
  captureImpl?: Function;
}): WindowsCaptureBackend;

export interface WindowsObserverOptions {
  helperPath?: string;
  execFileImpl?: Function;
  captureBackend?: WindowsCaptureBackend;
  createObserverImpl?: Function;
  maxWindows?: number;
  maxTitleChars?: number;
  maxResponseBytes?: number;
  maxAgeMs?: number;
  timeoutMs?: number;
  includeTitles?: boolean;
  clock?: () => number;
}

export interface WindowsObserver {
  enumerate(req?: { limit?: number; timeoutMs?: number; signal?: AbortSignal }): Promise<any>;
  observeWindow(req: any): Promise<any>;
  getCapabilities(): any;
  getLastSnapshot(): any;
  config: Readonly<Record<string, unknown>>;
  processRunner: WindowsProcessRunner;
  captureBackend: WindowsCaptureBackend;
  inspectWindow(hwnd: number, opts?: object): Promise<NativeInspectResult>;
  readText(hwnd: number, opts?: ReadTextOptions): Promise<NativeReadTextResult>;
  writeText(hwnd: number, text: string, opts: WriteTextOptions): Promise<NativeWriteTextResult>;
}

export declare function createWindowsObserver(options?: WindowsObserverOptions): WindowsObserver;
