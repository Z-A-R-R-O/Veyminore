import {
  AccountError,
  isOperationId,
  parseAccountSession,
  type AccountSession,
  type AccountErrorCode,
} from "./contracts";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Web only. Capacitor must use a separately verified native credential/session adapter. */
export class WebAccountApi {
  private csrfToken?: string;
  private busy = false;

  constructor(
    private readonly enabled = false,
    private readonly request: Fetch = (input, init) => fetch(input, init),
  ) {}

  session(signal?: AbortSignal): Promise<AccountSession> {
    return this.call("session", undefined, signal);
  }

  startGuest(
    operationId: string,
    signal?: AbortSignal,
  ): Promise<AccountSession> {
    this.validateOperation(operationId);
    return this.call("guest", { schemaVersion: 1, operationId }, signal);
  }

  /** Google ID token is verified by the backend against this session's nonce. */
  google(
    intent: "sign-in" | "link",
    input: { operationId: string; idToken: string; flowId: string },
    signal?: AbortSignal,
  ): Promise<AccountSession> {
    this.validateOperation(input.operationId);
    if (
      (intent !== "sign-in" && intent !== "link") ||
      typeof input.idToken !== "string" ||
      input.idToken.length < 1 ||
      input.idToken.length > 8192 ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(input.flowId)
    )
      throw new AccountError("invalid-request");
    // Whitelist properties: even a cast/malicious caller cannot inject an account ID.
    return this.call(
      `google/${intent}`,
      {
        schemaVersion: 1,
        operationId: input.operationId,
        idToken: input.idToken,
        flowId: input.flowId,
      },
      signal,
    );
  }

  logout(signal?: AbortSignal): Promise<AccountSession> {
    return this.call("logout", { schemaVersion: 1 }, signal);
  }

  private validateOperation(id: string) {
    if (!isOperationId(id)) throw new AccountError("invalid-request");
  }

  private async call(
    route: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AccountSession> {
    if (!this.enabled) throw new AccountError("not-configured");
    // Prevent old session responses from racing logout/link responses in this instance.
    if (this.busy || (body && !this.csrfToken))
      throw new AccountError("invalid-request");
    this.busy = true;
    const timeout = new AbortController();
    let rejectDeadline!: (error: AccountError) => void;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const timer = setTimeout(
      () => {
        rejectDeadline(new AccountError("network"));
        timeout.abort();
      },
      route.startsWith("google/") ? 30_000 : 15_000,
    );
    const abort = () => timeout.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const response = await Promise.race([
        this.request(`/api/arowgo/v1/account/${route}`, {
          method: body ? "POST" : "GET",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: body
            ? {
                "Content-Type": "application/json",
                "X-CSRF-Token": this.csrfToken!,
              }
            : { Accept: "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: timeout.signal,
        }),
        deadline,
      ]);
      if (!response.ok) {
        const codes: Record<number, AccountErrorCode> = {
          401: "unauthorized",
          403: "forbidden",
          409: "identity-conflict",
          429: "rate-limited",
        };
        let detail: unknown;
        try {
          detail = (await Promise.race([response.json(), deadline])).error;
        } catch {
          /* Ignore non-JSON upstream bodies. */
        }
        const allowed: AccountErrorCode[] = [
          "google-token-rejected",
          "google-verification-timeout",
          "oidc-not-configured",
          "playfab-network-timeout",
          "provider-rejected",
          "provider-unavailable",
          "invalid-flow",
          "operation-pending",
          "invalid-provider-response",
        ];
        throw new AccountError(
          allowed.includes(detail as AccountErrorCode)
            ? (detail as AccountErrorCode)
            : (codes[response.status] ?? "unavailable"),
        );
      }
      let json: unknown;
      try {
        json = await Promise.race([response.json(), deadline]);
      } catch {
        if (timeout.signal.aborted) throw new AccountError("network");
        throw new AccountError("invalid-response");
      }
      const result = parseAccountSession(json);
      if (
        (route === "logout" && result.account !== null) ||
        (route === "guest" && result.account === null) ||
        (route.startsWith("google/") && result.account?.kind !== "linked")
      )
        throw new AccountError("invalid-response");
      if (timeout.signal.aborted)
        throw new AccountError(signal?.aborted ? "cancelled" : "network");
      this.csrfToken = result.csrfToken;
      return result;
    } catch (error) {
      // A failed mutation may have committed; require a session refresh before another.
      this.csrfToken = undefined;
      if (signal?.aborted) throw new AccountError("cancelled");
      if (error instanceof AccountError) throw error;
      throw new AccountError("network");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      this.busy = false;
    }
  }
}
