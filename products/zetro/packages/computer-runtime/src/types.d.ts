/**
 * Type declarations for @zetro/computer-runtime (OCR-2).
 * Ports are injected; the core performs no desktop calls.
 */

export type SessionStateValue = 'active' | 'revoked' | 'stopped';

export type SessionErrorCodeValue =
  | 'missing_principal'
  | 'missing_token'
  | 'missing_session'
  | 'invalid_token'
  | 'principal_mismatch'
  | 'session_not_found'
  | 'session_expired'
  | 'session_revoked'
  | 'session_stopped'
  | 'target_mismatch'
  | 'authority_denied'
  | 'authority_unavailable'
  | 'observer_failed'
  | 'observation_cancelled'
  | 'observation_limit_exceeded'
  | 'concurrency_limit_exceeded'
  | 'authority_timeout'
  | 'observer_timeout'
  | 'invalid_observation_schema'
  | 'contract_invalid';

export interface ClockPort {
  now(): number;
}

export type TokenVerdict =
  | { valid: true; principalId: string; claims?: Record<string, unknown> }
  | { valid: false; reason?: string };

export interface TokenVerifierPort {
  verify(args: { token: string; principalId: string; sessionId?: string }): TokenVerdict;
}

export interface AuthorityDecision {
  allowed: boolean;
  reason?: string;
  grantId?: string;
  details?: Record<string, unknown>;
}

export interface AuthorityPort {
  evaluateScreenCapture(
    params: { principalId: string; sessionId: string; displayId?: string | number; frames?: number },
    options?: Record<string, unknown>
  ): AuthorityDecision;
}

export interface ObservationSignal {
  aborted: boolean;
  onAbort(cb: () => void): void;
}

export interface ObserverPort {
  capture(args: {
    sessionId: string;
    displayId: string | number;
    frames: number;
    maxBytes: number;
    signal: ObservationSignal;
  }): Promise<{ frames: object[]; bytes: number }>;
}

export interface AuditEvent {
  at: number;
  type: string;
  operation: string;
  correlationId: string;
  principalId: string | null;
  sessionId: string | null;
  [key: string]: unknown;
}

export interface AuditSinkPort {
  write(event: AuditEvent): void;
}

export interface ValidationPort {
  validate(
    operation: string,
    payload: Record<string, unknown>
  ): { valid: boolean; errors?: string[] };
}

export interface ComputerSessionLimits {
  maxObservationsPerSession?: number;
  maxFramesPerObservation?: number;
  maxBytesPerObservation?: number;
  maxFrameInlineBytes?: number;
  maxStringFieldBytes?: number;
  maxMetadataBytes?: number;
  maxConcurrentObservationsPerSession?: number;
  authorityTimeoutMs?: number;
  observerTimeoutMs?: number;
  defaultTtlMs?: number;
  minTtlMs?: number;
  maxTtlMs?: number;
}

export interface ComputerSessionPorts {
  clock: ClockPort;
  tokenVerifier: TokenVerifierPort;
  authorityPort: AuthorityPort;
  observer: ObserverPort;
  auditSink: AuditSinkPort;
  validationPort?: ValidationPort;
  idFactory?: (prefix: string) => string;
  limits?: ComputerSessionLimits;
}

export interface SessionSnapshot {
  sessionId: string;
  principalId: string;
  targetDisplayId: string | number;
  state: SessionStateValue;
  createdAt: number;
  expiresAt: number;
  observationCount: number;
  revokeReason: string | null;
  stopReason: string | null;
}

export type SessionResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true; correlationId: string } & T)
  | { ok: false; code: SessionErrorCodeValue; details?: Record<string, unknown> };

export type StartRequest = {
  token: string;
  principalId: string;
  targetDisplayId?: string | number;
  ttlMs?: number;
  correlationId?: string;
};

export type SessionRefRequest = {
  token: string;
  principalId: string;
  sessionId: string;
  correlationId?: string;
};

export type ObserveRequest = SessionRefRequest & {
  displayId?: string | number;
  frames?: number;
};

export type TerminateRequest = SessionRefRequest & {
  reason?: string;
};

export declare class ComputerSession {
  constructor(ports: ComputerSessionPorts);
  now(): number;
  getSession(sessionId: string): SessionSnapshot | null;
  start(req: StartRequest): SessionResult<{ session: SessionSnapshot }>;
  status(req: SessionRefRequest): SessionResult<{ state: 'active' | 'expired' | 'revoked' | 'stopped'; session: SessionSnapshot }>;
  observe(req: ObserveRequest): Promise<
    SessionResult<{ frames: object[]; bytes: number; observationIndex: number }>
  >;
  revoke(req: TerminateRequest): SessionResult<{ state: SessionStateValue; cancelledObservations: number; session: SessionSnapshot }>;
  emergencyStop(req: TerminateRequest): SessionResult<{ state: SessionStateValue; cancelledObservations: number; session: SessionSnapshot }>;
}

export declare const SessionState: Readonly<{
  ACTIVE: 'active';
  REVOKED: 'revoked';
  STOPPED: 'stopped';
}>;

export declare const SessionErrorCode: Readonly<Record<string, SessionErrorCodeValue>>;

export declare const AuditEventType: Readonly<{
  SESSION_STARTED: 'session_started';
  SESSION_STATUS: 'session_status';
  OBSERVATION_DELIVERED: 'observation_delivered';
  OBSERVATION_CANCELLED: 'observation_cancelled';
  OBSERVATION_DENIED: 'observation_denied';
  SESSION_REVOKED: 'session_revoked';
  SESSION_STOPPED: 'session_stopped';
  OPERATION_DENIED: 'operation_denied';
}>;

/* ---- IFZ route-wide cancellation coordinator ---- */

export type BranchStateValue = 'queued' | 'active' | 'completed' | 'cancelled' | 'stopped';
export type DeliveryStateValue = 'none' | 'delivered' | 'uncertain' | 'failed' | 'reconciled_delivered' | 'reconciled_failed';
export type RouteStateValue = 'open' | 'cancelled';

export interface RouteIdentity {
  runId: string;
  taskId: string;
  branchId: string;
  sessionId: string;
  workerId: string;
  workspaceId: string;
  cancellationId: string;
  attemptId: string;
}

export interface CancellationPort {
  send(msg: {
    cancellationId: string; runId: string; taskId: string; branchId: string;
    sessionId: string; workerId: string; workspaceId: string; attemptId: string; reason: string;
  }): Promise<{ status: 'delivered' | 'timeout' | 'unknown' | 'failed' }> | { status: 'delivered' | 'timeout' | 'unknown' | 'failed' };
}

export interface BranchControlPort {
  end(args: { sessionId: string; branchId: string; cancellationId: string }): unknown;
  stop(args: { sessionId: string; branchId: string; reason?: string }): unknown;
}

export interface InputLeasePort {
  isValid(args: { sessionId: string; workerId: string }): boolean;
}

export interface RouteCancellationPorts {
  clock: ClockPort;
  cancellationPort: CancellationPort;
  branchControl?: BranchControlPort;
  inputLease?: InputLeasePort;
  auditSink?: AuditSinkPort;
  idFactory?: (prefix: string) => string;
}

export type CancelResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; code: string; details?: Record<string, unknown> };

export declare const BranchState: Readonly<{ QUEUED: 'queued'; ACTIVE: 'active'; COMPLETED: 'completed'; CANCELLED: 'cancelled'; STOPPED: 'stopped' }>;
export declare const DeliveryState: Readonly<Record<string, DeliveryStateValue>>;
export declare const RouteState: Readonly<{ OPEN: 'open'; CANCELLED: 'cancelled' }>;
export declare const CancelErrorCode: Readonly<Record<string, string>>;

export declare class RouteCancellationCoordinator {
  constructor(ports: RouteCancellationPorts);
  now(): number;
  admit(identity: RouteIdentity, options?: { requiresInput?: boolean }): CancelResult<{ branchKey: string; state: BranchStateValue }>;
  tryStart(identity: RouteIdentity): CancelResult<{ state: BranchStateValue }>;
  cancel(identity: RouteIdentity, options?: { reason?: string }): Promise<CancelResult<{ idempotent?: boolean; cancellationId: string; branches: Array<{ branchId: string; outcome: string }> }>>;
  reconcile(identity: RouteIdentity, outcome: 'delivered' | 'not_delivered'): CancelResult<{ delivery: DeliveryStateValue; state: BranchStateValue }>;
  resendCancellation(identity: RouteIdentity, options?: { reason?: string }): Promise<CancelResult<{ outcome: string; delivery: DeliveryStateValue; state: BranchStateValue }>>;
  stop(identity: RouteIdentity, options?: { reason?: string }): CancelResult<{ state: BranchStateValue }>;
  complete(identity: RouteIdentity): CancelResult<{ state: BranchStateValue; completedUnderUncertainCancellation: boolean }>;
  status(identity: RouteIdentity): CancelResult<{
    routeState: RouteStateValue; cancellationId: string | null;
    state: BranchStateValue; delivery: DeliveryStateValue;
    lastOutcome: string; completedUnderUncertainCancellation: boolean;
  }>;
}
