import { randomBytes } from "node:crypto";

const token = () => randomBytes(32).toString("base64url");
export class AuthError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

/** Verified Google ID tokens are exchanged through the configured PlayFab OIDC connection. */
export function playFabProvider({
  titleId,
  connectionId = "google-web",
  request = fetch,
}) {
  if (!/^[A-F0-9]+$/i.test(titleId))
    throw new Error("Invalid title configuration");
  async function call(method, body, ticket) {
    let result;
    try {
      const response = await request(
        `https://${titleId}.playfabapi.com/Client/${method}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(12000),
          headers: {
            "Content-Type": "application/json",
            ...(ticket ? { "X-Authorization": ticket } : {}),
          },
          body: JSON.stringify(body),
        },
      );
      result = await response.json();
      if (!response.ok || result.code !== 200) {
        if (
          [
            "InvalidIdentityProviderId",
            "InvalidOpenIdConnection",
            "OpenIdConnectionNotFound",
          ].includes(result.error)
        )
          throw new AuthError(503, "oidc-not-configured");
        if (
          result.error === "LinkedAccountAlreadyClaimed" ||
          result.error === "AccountAlreadyLinked"
        )
          throw new AuthError(409, "identity-conflict");
        if (
          [
            "InvalidGoogleToken",
            "GoogleOAuthError",
            "GoogleOAuthNotConfiguredForTitle",
          ].includes(result.error)
        )
          throw new AuthError(401, "provider-rejected");
        throw new AuthError(502, "provider-unavailable");
      }
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (
        ["UND_ERR_CONNECT_TIMEOUT", "ENOTFOUND", "EAI_AGAIN"].includes(
          error.cause?.code,
        ) ||
        error.name === "TimeoutError"
      )
        throw new AuthError(504, "playfab-network-timeout");
      throw new AuthError(502, "provider-unavailable");
    }
    return result.data;
  }
  return {
    async login(code) {
      const data = await call("LoginWithOpenIdConnect", {
        TitleId: titleId,
        IdToken: code,
        ConnectionId: connectionId,
        CreateAccount: true,
      });
      if (
        !data ||
        !/^[A-F0-9]+$/i.test(data.PlayFabId ?? "") ||
        typeof data.SessionTicket !== "string" ||
        !data.SessionTicket
      )
        throw new AuthError(502, "invalid-provider-response");
      return { id: data.PlayFabId, ticket: data.SessionTicket };
    },
    async link(code, ticket) {
      await call(
        "LinkOpenIdConnect",
        { IdToken: code, ConnectionId: connectionId, ForceLink: false },
        ticket,
      );
    },
  };
}

/** Single-process development spike only. Restart signs everyone out. No wallet/import writes. */
export function createAccountService({
  provider,
  cloud,
  cloudProbe,
  economy,
  verifyIdentity,
  now = Date.now,
}) {
  const sessions = new Map();
  const ttl = 60 * 60 * 1000;
  function prune() {
    for (const [id, s] of sessions) if (s.expires <= now()) sessions.delete(id);
  }
  function create() {
    prune();
    if (sessions.size >= 500) throw new AuthError(429, "rate-limited");
    const id = token();
    const s = {
      csrf: token(),
      expires: now() + ttl,
      account: null,
      ticket: null,
      flow: null,
      busy: false,
      cloudBusy: false,
      attempts: [],
    };
    sessions.set(id, s);
    return { id, s };
  }
  function get(id) {
    prune();
    const s = sessions.get(id);
    if (!s) throw new AuthError(401, "unauthorized");
    return s;
  }
  function view(s) {
    return {
      schemaVersion: 1,
      account: s.account,
      csrfToken: s.csrf,
      expiresAt: s.account ? new Date(s.expires).toISOString() : null,
    };
  }
  function csrf(s, value) {
    if (typeof value !== "string" || value !== s.csrf)
      throw new AuthError(403, "forbidden");
  }
  return {
    economyCommand(id, csrfToken, body) {
      if (!economy) throw new AuthError(503, "economy-disabled");
      const s = get(id);
      csrf(s, csrfToken);
      if (!s.account) throw new AuthError(401, "unauthorized");
      if (body?.expectedAccountId && body.expectedAccountId !== s.account.id)
        throw new AuthError(409, "account-changed");
      try {
        if (body?.action === "wallet")
          return {
            ...economy.overview(s.account.id),
            wallet: economy.get(s.account.id),
            transactions: economy.history(s.account.id),
            inventory: economy.inventory(s.account.id),
          };
        if (body?.action === "begin")
          return economy.begin(s.account.id, body.operationId, body.levelId);
        if (body?.action === "complete")
          return economy.complete(
            s.account.id,
            body.operationId,
            body.attemptId,
            body.moves,
            body.elapsedMs,
          );
        if (body?.action === "equip")
          return economy.equip(
            s.account.id,
            body.operationId,
            body.skin,
            body.expectedRevision,
          );
        if (body?.action === "gift")
          return economy.gift(s.account.id, body.operationId);
        if (body?.action === "chest")
          return economy.chest(
            s.account.id,
            body.operationId,
            body.crateId,
            body.currency,
            body.welcome ?? false,
          );
        if (body?.action === "boost")
          return economy.boost(s.account.id, body.operationId, body.attemptId);
        throw new AuthError(400, "invalid-request");
      } catch (error) {
        if (error instanceof AuthError) throw error;
        if (
          [
            "operation-conflict",
            "level-locked",
            "too-many-attempts",
            "already-claimed",
            "insufficient-funds",
            "preference-conflict",
          ].includes(error.message)
        )
          throw new AuthError(409, error.message);
        if (
          [
            "invalid-operation",
            "unknown-level",
            "invalid-attempt",
            "invalid-completion",
            "incomplete-level",
            "invalid-purchase",
            "skin-not-owned",
            "invalid-preference",
          ].includes(error.message)
        )
          throw new AuthError(400, error.message);
        throw new AuthError(503, "economy-unavailable");
      }
    },
    async probe(id, csrfToken) {
      if (!cloudProbe) throw new AuthError(503, "probe-disabled");
      const s = get(id);
      csrf(s, csrfToken);
      if (!s.account || !s.ticket) throw new AuthError(401, "unauthorized");
      if (s.busy) throw new AuthError(409, "operation-pending");
      s.busy = s.cloudBusy = true;
      try {
        const result = await cloudProbe(s.ticket);
        if (sessions.get(id) !== s || s.expires <= now())
          throw new AuthError(401, "unauthorized");
        return result;
      } finally {
        s.busy = s.cloudBusy = false;
      }
    },
    bootstrap(id) {
      prune();
      const current = sessions.get(id);
      const entry = current ? { id, s: current } : create();
      return { id: entry.id, data: view(entry.s) };
    },
    async sync(id, csrfToken, body) {
      if (!cloud) throw new AuthError(503, "cloud-disabled");
      const s = get(id);
      csrf(s, csrfToken);
      if (!s.account || !s.ticket) throw new AuthError(401, "unauthorized");
      if (body?.accountId !== s.account.id)
        throw new AuthError(409, "account-changed");
      if (s.busy) throw new AuthError(409, "operation-pending");
      if (!["load", "save"].includes(body?.action))
        throw new AuthError(400, "invalid-request");
      s.busy = true;
      s.cloudBusy = true;
      try {
        const data =
          body.action === "load"
            ? await cloud.load(s.ticket)
            : await cloud.save(s.ticket, body);
        if (sessions.get(id) !== s || s.expires <= now())
          throw new AuthError(401, "unauthorized");
        return { ...data, accountId: s.account.id };
      } finally {
        s.busy = false;
        s.cloudBusy = false;
      }
    },
    flow(id, csrfToken, intent) {
      const s = get(id);
      csrf(s, csrfToken);
      if (intent !== "sign-in" && intent !== "link")
        throw new AuthError(400, "invalid-request");
      if (s.busy) throw new AuthError(409, "operation-pending");
      if (intent === "link" && !s.account)
        throw new AuthError(401, "unauthorized");
      s.attempts = s.attempts.filter((t) => t > now() - 60000);
      if (s.attempts.length >= 5) throw new AuthError(429, "rate-limited");
      s.attempts.push(now());
      s.flow = { id: token(), intent, expires: now() + 5 * 60000 };
      return { flowId: s.flow.id };
    },
    async google(id, csrfToken, intent, body) {
      const s = get(id);
      csrf(s, csrfToken);
      if (
        !body ||
        body.schemaVersion !== 1 ||
        typeof body.idToken !== "string" ||
        !body.idToken ||
        body.idToken.length > 8192 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          body.operationId ?? "",
        )
      )
        throw new AuthError(400, "invalid-request");
      if (
        s.busy ||
        !s.flow ||
        s.flow.id !== body.flowId ||
        s.flow.intent !== intent ||
        s.flow.expires <= now()
      )
        throw new AuthError(409, "invalid-flow");
      const nonce = s.flow.id;
      s.flow = null;
      s.busy = true; // Consume before awaiting: a token cannot be replayed against the same flow.
      try {
        if (!verifyIdentity)
          throw new AuthError(503, "verification-not-configured");
        await verifyIdentity(body.idToken, nonce);
        if (sessions.get(id) !== s || s.expires <= now())
          throw new AuthError(401, "unauthorized");
        let identity;
        if (intent === "link") {
          if (!s.account || !s.ticket) throw new AuthError(401, "unauthorized");
          await provider.link(body.idToken, s.ticket);
          identity = { id: s.account.id, ticket: s.ticket };
        } else identity = await provider.login(body.idToken);
        if (sessions.get(id) !== s || s.expires <= now())
          throw new AuthError(401, "unauthorized");
        // Do not silently replace an authenticated player's account.
        if (s.account && s.account.id !== identity.id)
          throw new AuthError(409, "identity-conflict");
        sessions.delete(id);
        const next = create();
        next.s.account = {
          id: identity.id,
          kind: "linked",
          providers: ["google"],
          revision: 0,
        };
        next.s.ticket = identity.ticket;
        return { id: next.id, data: view(next.s) };
      } finally {
        s.busy = false;
      }
    },
    logout(id, csrfToken) {
      const s = get(id);
      csrf(s, csrfToken);
      if (s.cloudBusy) throw new AuthError(409, "operation-pending");
      sessions.delete(id);
      const next = create();
      return { id: next.id, data: view(next.s) };
    },
  };
}
