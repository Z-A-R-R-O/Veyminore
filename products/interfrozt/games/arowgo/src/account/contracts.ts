/** B01 wire contract. These endpoints require a trusted service; none is deployed yet. */
export const ACCOUNT_SCHEMA_VERSION = 1;

export interface AccountIdentity {
  /** An opaque AROWGO identifier, never a client-supplied authorization credential. */
  id: string;
  kind: "guest" | "linked";
  providers: "google"[];
  revision: number;
}

export interface AccountSession {
  schemaVersion: 1;
  account: AccountIdentity | null;
  /** CSRF token only. Authentication lives in a server-owned HttpOnly cookie. */
  csrfToken: string;
  expiresAt: string | null;
}

export type AccountErrorCode =
  | "google-token-rejected"
  | "google-verification-timeout"
  | "oidc-not-configured"
  | "playfab-network-timeout"
  | "provider-rejected"
  | "provider-unavailable"
  | "invalid-flow"
  | "operation-pending"
  | "invalid-provider-response"
  | "not-configured"
  | "invalid-request"
  | "invalid-response"
  | "network"
  | "cancelled"
  | "unauthorized"
  | "forbidden"
  | "identity-conflict"
  | "rate-limited"
  | "unavailable";

export class AccountError extends Error {
  constructor(public readonly code: AccountErrorCode) {
    // Never copy provider responses, auth codes or server error bodies into logs/UI.
    super(`Account operation failed: ${code}`);
    this.name = "AccountError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isOperationId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Reconstruct only known fields; never expose a provider ticket from a response. */
export function parseAccountSession(value: unknown): AccountSession {
  const invalid = () => new AccountError("invalid-response");
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.csrfToken !== "string" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(value.csrfToken)
  )
    throw invalid();
  if (value.account === null) {
    if (value.expiresAt !== null) throw invalid();
    return {
      schemaVersion: 1,
      account: null,
      csrfToken: value.csrfToken,
      expiresAt: null,
    };
  }
  const account = value.account;
  if (
    !record(account) ||
    typeof account.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(account.id) ||
    (account.kind !== "guest" && account.kind !== "linked") ||
    !Array.isArray(account.providers) ||
    account.providers.some((p) => p !== "google") ||
    account.providers.length !== (account.kind === "guest" ? 0 : 1) ||
    typeof account.revision !== "number" ||
    !Number.isSafeInteger(account.revision) ||
    account.revision < 0 ||
    typeof value.expiresAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value.expiresAt) ||
    !Number.isFinite(Date.parse(value.expiresAt))
  )
    throw invalid();
  return {
    schemaVersion: 1,
    account: {
      id: account.id,
      kind: account.kind,
      providers: [...account.providers],
      revision: account.revision,
    },
    csrfToken: value.csrfToken,
    expiresAt: value.expiresAt,
  };
}
