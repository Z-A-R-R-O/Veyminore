export interface SessionIdentity {
  schemaVersion: 'zetro.computer.session.alpha.v1';
  sessionId: string;
  principalId: string;
  agentId: string;
  role: 'worker' | 'coordinator' | 'verifier' | 'user' | 'daemon';
  issuedAt: number;
  expiresAt: number;
}

export interface TargetIdentity {
  targetId: string;
  kind: 'screen' | 'window' | 'region';
  fingerprint?: string;
}

export interface ObserveRequest {
  schemaVersion: 'zetro.computer.observe_request.alpha.v1';
  requestId: string;
  sessionId: string;
  principalId: string;
  capability: string;
  target: TargetIdentity;
  requestedAt: number;
  freshness: { maxAgeMs: number };
  limits: { maxPayloadBytes: number };
}

export interface ObservationTarget {
  targetId: string;
  fingerprint: string;
}

export interface ObservationResult {
  schemaVersion: 'zetro.computer.observation_result.alpha.v1';
  requestId: string;
  sessionId: string;
  target: ObservationTarget;
  capturedAt: number;
  sequence: number;
  payload: { sha256: string; byteLength: number; mimeType: string };
  observedBy: string;
}

export interface VerificationBlock {
  verified: boolean;
  status: 'not_requested' | 'in_progress' | 'passed' | 'failed' | 'inconclusive';
  verifier: string;
  checksPassed: number;
  checksFailed: number;
  checkedAt: number;
}

export interface AuditEvidence {
  schemaVersion: 'zetro.computer.audit_evidence.alpha.v1';
  evidenceId: string;
  sessionId: string;
  requestId: string;
  capability: string;
  resultDigest: string;
  effect: null;
  verification: VerificationBlock;
  createdAt: number;
}

export interface TrustedVerificationContext {
  verifierId: string;
  requestId: string;
  sessionId: string;
  principalId: string | null;
  resultDigest: string;
  checksPassed: number;
  checksFailed: number;
  evidenceVerifier: string;
  observedBy: string;
}

export interface TrustedVerificationBindings {
  requestId: string;
  sessionId: string;
  resultDigest: string;
  principalId?: string;
}

export interface TrustedVerificationVerdict {
  authorized: boolean;
  status: 'passed' | 'failed' | 'inconclusive' | 'in_progress' | 'not_requested';
  bindings?: TrustedVerificationBindings;
  reason?: string;
}

export interface TrustedVerifierPort {
  readonly verifierId: string;
  decide(context: TrustedVerificationContext): TrustedVerificationVerdict;
}

export interface ValidationFailure {
  ok: false;
  schema: string;
  errors: string[];
}

export interface ValidateOptions {
  throwOnError?: boolean;
}

export class ContractValidationError extends Error {
  constructor(message: string, errors?: string[], schema?: string);
  errors: string[];
  schema: string;
  toJSON(): { name: string; message: string; schema: string; errors: string[] };
}

export const COMPUTER_SCHEMA_VERSIONS: Readonly<{
  SESSION_IDENTITY: 'zetro.computer.session.alpha.v1';
  OBSERVE_REQUEST: 'zetro.computer.observe_request.alpha.v1';
  OBSERVATION_RESULT: 'zetro.computer.observation_result.alpha.v1';
  AUDIT_EVIDENCE: 'zetro.computer.audit_evidence.alpha.v1';
}>;

export const PrincipalRole: Readonly<{
  WORKER: 'worker';
  COORDINATOR: 'coordinator';
  VERIFIER: 'verifier';
  USER: 'user';
  DAEMON: 'daemon';
}>;

export const TargetKind: Readonly<{ SCREEN: 'screen'; WINDOW: 'window'; REGION: 'region' }>;

export const VerificationStatus: Readonly<{
  NOT_REQUESTED: 'not_requested';
  IN_PROGRESS: 'in_progress';
  PASSED: 'passed';
  FAILED: 'failed';
  INCONCLUSIVE: 'inconclusive';
}>;

export const SUPPORTED_CAPABILITIES: readonly string[];
export const EFFECTFUL_CAPABILITIES: readonly string[];

export const OBSERVATION_BOUNDS: Readonly<{
  maxPayloadBytes: { min: number; max: number };
  maxAgeMs: { min: number; max: number };
}>;

export const DEFAULT_OBSERVATION_LIMITS: Readonly<{
  maxPayloadBytes: number;
  maxAgeMs: number;
}>;

export function validateSessionIdentity(
  input: unknown,
  options?: ValidateOptions
): SessionIdentity | ValidationFailure;

export function isSessionIdentity(value: unknown): boolean;

export function validateObserveRequest(
  input: unknown,
  options?: ValidateOptions & { session?: Partial<SessionIdentity> }
): ObserveRequest | ValidationFailure;

export function isObserveRequest(value: unknown): boolean;

export function validateObservationResult(
  input: unknown,
  options?: ValidateOptions & { request?: Partial<ObserveRequest>; maxPayloadBytes?: number }
): ObservationResult | ValidationFailure;

export function isObservationResult(value: unknown): boolean;

export function validateAuditEvidence(
  input: unknown,
  options?: ValidateOptions
): AuditEvidence | ValidationFailure;

export function isAuditEvidence(value: unknown): boolean;

export function checkCapability(capability: unknown): {
  ok: boolean;
  capability: unknown;
  reason: 'invalid' | 'effectful' | 'unsupported' | null;
  errors: string[];
};

export function evaluateFreshness(
  observation: { capturedAt?: unknown },
  options?: { now?: number; maxAgeMs?: number }
): {
  ok: boolean;
  status: 'fresh' | 'stale' | 'not_yet_valid' | 'invalid';
  ageMs: number | null;
  errors: string[];
};

export function computeResultDigest(result: unknown): string;

export function computeEvidenceDigest(evidence: unknown): string;

export function createTrustedVerifierPort(
  verifierId: string,
  decide: (context: TrustedVerificationContext) => TrustedVerificationVerdict
): TrustedVerifierPort;

export function verifyObservation(
  result: unknown,
  evidence: unknown | null | undefined,
  options?: {
    now?: number;
    maxAgeMs?: number;
    request?: Partial<ObserveRequest>;
    trust?: TrustedVerifierPort;
  }
): {
  status: 'not_requested' | 'in_progress' | 'passed' | 'failed' | 'inconclusive';
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  checksPassed: number;
  checksFailed: number;
};
