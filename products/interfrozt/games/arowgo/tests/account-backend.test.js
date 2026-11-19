import { request as httpRequest } from "node:http";
import { describe, it, expect, vi } from "vitest";
import {
  createAccountService,
  playFabProvider,
  AuthError,
} from "../server/account/service.mjs";
import { createAccountServer } from "../server/account/http.mjs";
const op = "f1c763fe-44e0-41d7-9d35-3ec5523a7510";
function setup(
  provider = {
    login: vi.fn(async () => ({ id: "ABC123", ticket: "private-ticket" })),
    link: vi.fn(async () => {}),
  },
) {
  let time = Date.now();
  const service = createAccountService({
    provider,
    verifyIdentity: async () => {},
    now: () => time,
  });
  const entry = service.bootstrap();
  const flow = service.flow(entry.id, entry.data.csrfToken, "sign-in");
  const body = {
    schemaVersion: 1,
    operationId: op,
    flowId: flow.flowId,
    idToken: "private-code",
  };
  return {
    service,
    entry,
    body,
    provider,
    advance: (n) => {
      time += n;
    },
  };
}
describe("development account backend", () => {
  it("rotates session and keeps provider tickets server-side", async () => {
    const { service, entry, body } = setup();
    const result = await service.google(
      entry.id,
      entry.data.csrfToken,
      "sign-in",
      body,
    );
    expect(result.id).not.toBe(entry.id);
    expect(result.data.account.id).toBe("ABC123");
    expect(JSON.stringify(result)).not.toContain("private-ticket");
    expect(service.bootstrap(entry.id).data.account).toBeNull();
  });
  it("requires matching CSRF, flow intent and session", async () => {
    const { service, entry, body, provider } = setup();
    await expect(
      service.google(entry.id, "wrong", "sign-in", body),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.google(entry.id, entry.data.csrfToken, "link", body),
    ).rejects.toMatchObject({ status: 409 });
    const other = service.bootstrap();
    await expect(
      service.google(other.id, other.data.csrfToken, "sign-in", body),
    ).rejects.toMatchObject({ status: 409 });
    expect(provider.login).not.toHaveBeenCalled();
  });
  it("expires flows and sessions", async () => {
    const { service, entry, body, advance } = setup();
    advance(300001);
    await expect(
      service.google(entry.id, entry.data.csrfToken, "sign-in", body),
    ).rejects.toMatchObject({ status: 409 });
    advance(3600000);
    expect(service.bootstrap(entry.id).data.account).toBeNull();
  });
  it("rejects a replay after provider failure", async () => {
    const provider = {
      login: vi.fn(async () => {
        throw new AuthError(401, "provider-rejected");
      }),
    };
    const { service, entry, body } = setup(provider);
    await expect(
      service.google(entry.id, entry.data.csrfToken, "sign-in", body),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.google(entry.id, entry.data.csrfToken, "sign-in", body),
    ).rejects.toMatchObject({ status: 409 });
    expect(provider.login).toHaveBeenCalledTimes(1);
  });
  it("logout prevents a delayed login response from restoring the session", async () => {
    let finish;
    const { service, entry, body } = setup({
      login: () =>
        new Promise((r) => {
          finish = r;
        }),
    });
    const pending = service.google(
      entry.id,
      entry.data.csrfToken,
      "sign-in",
      body,
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    service.logout(entry.id, entry.data.csrfToken);
    finish({ id: "ABC123", ticket: "private" });
    await expect(pending).rejects.toMatchObject({ status: 401 });
  });
  it("prevents account replacement and preserves original identity on conflict", async () => {
    const { service, entry, body, provider } = setup();
    const first = await service.google(
      entry.id,
      entry.data.csrfToken,
      "sign-in",
      body,
    );
    const flow = service.flow(first.id, first.data.csrfToken, "sign-in");
    provider.login.mockResolvedValue({ id: "DEF456", ticket: "other" });
    await expect(
      service.google(first.id, first.data.csrfToken, "sign-in", {
        ...body,
        flowId: flow.flowId,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(service.bootstrap(first.id).data.account.id).toBe("ABC123");
  });
  it("keeps linking authenticated and returns provider conflicts without reassignment", async () => {
    const { service, entry, body, provider } = setup();
    expect(() =>
      service.flow(entry.id, entry.data.csrfToken, "link"),
    ).toThrow();
    const first = await service.google(
      entry.id,
      entry.data.csrfToken,
      "sign-in",
      body,
    );
    const flow = service.flow(first.id, first.data.csrfToken, "link");
    provider.link.mockRejectedValue(new AuthError(409, "identity-conflict"));
    await expect(
      service.google(first.id, first.data.csrfToken, "link", {
        ...body,
        flowId: flow.flowId,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(service.bootstrap(first.id).data.account.id).toBe("ABC123");
  });
  it("throttles repeated flow creation", () => {
    const { service, entry } = setup();
    for (let i = 0; i < 4; i++)
      service.flow(entry.id, entry.data.csrfToken, "sign-in");
    expect(() =>
      service.flow(entry.id, entry.data.csrfToken, "sign-in"),
    ).toThrow("rate-limited");
  });
});
describe("PlayFab adapter", () => {
  it("parses the data envelope and explicitly disables force-link", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: 200,
            data: { PlayFabId: "ABC123", SessionTicket: "secret" },
          }),
        ),
    );
    const provider = playFabProvider({ titleId: "116A87", request });
    expect(await provider.login("code")).toEqual({
      id: "ABC123",
      ticket: "secret",
    });
    await provider.link("another-code", "secret");
    expect(JSON.parse(request.mock.calls[1][1].body).ForceLink).toBe(false);
    expect(request.mock.calls[1][1].headers["X-Authorization"]).toBe("secret");
  });
  it("sanitizes errors and malformed results", async () => {
    const provider = playFabProvider({
      titleId: "116A87",
      request: async () =>
        new Response(
          JSON.stringify({
            error: "LinkedAccountAlreadyClaimed",
            errorMessage: "private",
          }),
          { status: 400 },
        ),
    });
    await expect(provider.link("code", "ticket")).rejects.toMatchObject({
      status: 409,
      message: "identity-conflict",
    });
    const malformed = playFabProvider({
      titleId: "116A87",
      request: async () =>
        new Response(JSON.stringify({ code: 200, data: {} })),
    });
    await expect(malformed.login("code")).rejects.toThrow(
      "invalid-provider-response",
    );
  });
});
it("HTTP enforces origin/host/CSRF, issues HttpOnly cookie, logs out and rejects oversized bodies", async () => {
  const { service } = setup();
  const server = createAccountServer({ service });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/api/arowgo/v1/account`;
  try {
    expect((await localRequest(url + "/session")).status).toBe(403);
    const first = await localRequest(url + "/session", {
      headers: { Host: "localhost:4173" },
    });
    const cookie = first.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const { csrfToken } = await first.json();
    const headers = {
      Host: "localhost:4173",
      Origin: "http://localhost:4173",
      Cookie: cookie.split(";")[0],
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    };
    expect(
      (
        await localRequest(url + "/logout", {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.example" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await localRequest(url + "/logout", {
          method: "POST",
          headers: { ...headers, "X-CSRF-Token": "bad" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await localRequest(url + "/logout", {
          method: "POST",
          headers,
          body: "x".repeat(17000),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await localRequest(url + "/logout", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

function localRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve(
          new Response(Buffer.concat(chunks), {
            status: res.statusCode,
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [
                k,
                Array.isArray(v) ? v.join(", ") : v,
              ]),
            ),
          }),
        ),
      );
    });
    req.on("error", reject);
    req.end(options.body);
  });
}
