import { describe, expect, it, vi } from "vitest";
import { parseAccountSession } from "../src/account/contracts";
import { WebAccountApi } from "../src/account/web-api";
import { captureLegacyBackup } from "../src/account/legacy-backup";

const operationId = "f1c763fe-44e0-41d7-9d35-3ec5523a7510";
const anonymous = {
  schemaVersion: 1,
  account: null,
  csrfToken: "a".repeat(32),
  expiresAt: null,
};
const guest = {
  ...anonymous,
  account: { id: "account_1", kind: "guest", providers: [], revision: 0 },
  expiresAt: "2026-11-17T00:00:00.000Z",
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

describe("account wire contracts", () => {
  it("keeps the anonymous/local distinction and strips unexpected secrets", () => {
    expect(parseAccountSession(anonymous).account).toBeNull();
    expect(parseAccountSession({ ...guest, SessionTicket: "secret" })).toEqual(
      guest,
    );
  });
  it.each([
    { ...guest, schemaVersion: 2 },
    { ...guest, csrfToken: "bad\r\nheader" },
    { ...guest, expiresAt: "never" },
    { ...guest, account: { ...guest.account, revision: -1 } },
    { ...guest, account: { ...guest.account, kind: "linked" } },
    { ...guest, account: { ...guest.account, providers: ["google"] } },
  ])("rejects malformed or inconsistent server state", (value) => {
    expect(() => parseAccountSession(value)).toThrow("invalid-response");
  });
});

describe("web account transport", () => {
  it("bounds a response body that never finishes", async () => {
    vi.useFakeTimers();
    try {
      const api = new WebAccountApi(
        true,
        async () =>
          ({ ok: true, json: () => new Promise(() => {}) }) as Response,
      );
      const pending = expect(api.session()).rejects.toMatchObject({
        code: "network",
      });
      await vi.advanceTimersByTimeAsync(15000);
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("allows Google verification plus PlayFab time before completing sign-in", async () => {
    vi.useFakeTimers();
    try {
      const linked = {
        ...guest,
        account: { ...guest.account, kind: "linked", providers: ["google"] },
      };
      const request = vi
        .fn()
        .mockResolvedValueOnce(response(anonymous))
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve(response(linked)), 21000),
            ),
        );
      const api = new WebAccountApi(true, request);
      await api.session();
      const pending = api.google("sign-in", {
        operationId,
        idToken: "test-token",
        flowId: "b".repeat(32),
      });
      await vi.advanceTimersByTimeAsync(21000);
      expect((await pending).account?.kind).toBe("linked");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("settles even when the transport ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const api = new WebAccountApi(true, () => new Promise(() => {}));
      const pending = expect(api.session()).rejects.toMatchObject({
        code: "network",
      });
      await vi.advanceTimersByTimeAsync(15000);
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [429, "rate-limited"],
    [503, "unavailable"],
  ])("maps HTTP %s without leaking response details", async (status, code) => {
    const api = new WebAccountApi(true, async () =>
      response({ secret: "private" }, Number(status)),
    );
    await expect(api.session()).rejects.toMatchObject({ code });
  });
  it("accepts confirmed logout and rotates CSRF", async () => {
    const signedOut = { ...anonymous, csrfToken: "b".repeat(32) };
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(guest))
      .mockResolvedValueOnce(response(signedOut))
      .mockResolvedValueOnce(response(guest));
    const api = new WebAccountApi(true, request);
    await api.session();
    expect((await api.logout()).account).toBeNull();
    await api.startGuest(operationId);
    expect(request.mock.calls[2][1].headers["X-CSRF-Token"]).toBe(
      signedOut.csrfToken,
    );
  });
  it("rejects a logout response that still reports a signed-in account", async () => {
    const request = vi.fn().mockImplementation(async () => response(guest));
    const api = new WebAccountApi(true, request);
    await api.session();
    await expect(api.logout()).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
  it("aborts a stalled request after 15 seconds and permits refresh", async () => {
    vi.useFakeTimers();
    try {
      const api = new WebAccountApi(
        true,
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
      );
      const pending = expect(api.session()).rejects.toMatchObject({
        code: "network",
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("is disabled by default and does not contact a service", async () => {
    const request = vi.fn();
    await expect(
      new WebAccountApi(false, request).session(),
    ).rejects.toMatchObject({ code: "not-configured" });
    expect(request).not.toHaveBeenCalled();
  });
  it("bootstraps CSRF and sends only the guest command with same-origin cookies", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(anonymous))
      .mockResolvedValueOnce(response(guest));
    const api = new WebAccountApi(true, request);
    await expect(api.startGuest(operationId)).rejects.toMatchObject({
      code: "invalid-request",
    });
    await api.session();
    await api.startGuest(operationId);
    expect(request.mock.calls[1]).toEqual([
      "/api/arowgo/v1/account/guest",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": anonymous.csrfToken,
        },
        body: JSON.stringify({ schemaVersion: 1, operationId }),
      }),
    ]);
  });
  it("never forwards account IDs or force-link flags and exposes conflicts without provider details", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(guest))
      .mockResolvedValueOnce(
        response({ message: "private provider details" }, 409),
      );
    const api = new WebAccountApi(true, request);
    await api.session();
    const credential = {
      operationId,
      idToken: "one-use-code",
      flowId: "b".repeat(32),
      accountId: "victim",
      forceLink: true,
    };
    await expect(api.google("link", credential)).rejects.toMatchObject({
      code: "identity-conflict",
      message: "Account operation failed: identity-conflict",
    });
    const body = JSON.parse(request.mock.calls[1][1].body);
    expect(body).toEqual({
      schemaVersion: 1,
      operationId,
      idToken: "one-use-code",
      flowId: credential.flowId,
    });
    await expect(api.logout()).rejects.toMatchObject({
      code: "invalid-request",
    });
  });
  it("requires refresh after an uncertain mutation; it never retries a purchase or login automatically", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(anonymous))
      .mockRejectedValueOnce(new Error("sensitive failure"));
    const api = new WebAccountApi(true, request);
    await api.session();
    await expect(api.startGuest(operationId)).rejects.toMatchObject({
      code: "network",
    });
    await expect(api.startGuest(operationId)).rejects.toMatchObject({
      code: "invalid-request",
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("blocks concurrent responses from racing session state", async () => {
    let finish!: (value: Response) => void;
    const request = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const api = new WebAccountApi(true, request);
    const first = api.session();
    await expect(api.session()).rejects.toMatchObject({
      code: "invalid-request",
    });
    finish(response(anonymous));
    await first;
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not accept a late response after cancellation", async () => {
    const controller = new AbortController();
    const request = vi.fn(async () => {
      controller.abort();
      return response(guest);
    });
    const api = new WebAccountApi(true, request);
    await expect(api.session(controller.signal)).rejects.toMatchObject({
      code: "cancelled",
    });
    await expect(api.startGuest(operationId)).rejects.toMatchObject({
      code: "invalid-request",
    });
  });
  it("rejects non-JSON responses without exposing server content", async () => {
    const api = new WebAccountApi(
      true,
      async () => new Response("private html error"),
    );
    await expect(api.session()).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
  it("rejects invalid command IDs before sending credentials", () => {
    const request = vi.fn();
    const api = new WebAccountApi(true, request);
    expect(() => api.startGuest("account_1")).toThrow("invalid-request");
    expect(request).not.toHaveBeenCalled();
  });
});

function store(values: Record<string, string>) {
  return {
    get length() {
      return Object.keys(values).length;
    },
    key: (i: number) => Object.keys(values)[i] ?? null,
    getItem: (key: string) => values[key] ?? null,
  };
}

describe("read-only legacy recovery snapshot", () => {
  it("retains raw profile, corrupt saves and version archives, excluding unrelated or auth data", () => {
    const values = {
      "arowgo.profile.v1": '{"gems":999999}',
      "arowgo.level.bloom-14.v1.content-3": "old-save",
      "arowgo.slice.v1.backup": "{damaged",
      "arowgo.lesson.keys.v1.content-1": "lesson",
      "arowgo.sound.v1": "on",
      "arowgo.auth.token": "secret",
      "another-game.save": "other",
    };
    const before = JSON.stringify(values);
    const backup = captureLegacyBackup(store(values));
    expect(backup.trust).toBe("unverified-local");
    expect(backup.entries).toHaveLength(5);
    expect(backup.entries).toContainEqual({
      key: "arowgo.slice.v1.backup",
      raw: "{damaged",
    });
    expect(JSON.stringify(backup)).not.toContain("secret");
    expect(JSON.stringify(values)).toBe(before);
  });
  it("fails instead of returning an incomplete copy when storage is unavailable", () => {
    const storage = store({ "arowgo.profile.v1": "profile" });
    storage.getItem = () => {
      throw new Error("storage blocked");
    };
    expect(() => captureLegacyBackup(storage)).toThrow("unavailable");
  });
  it("detects changing saves without deleting or overwriting either version", () => {
    const storage = store({ "arowgo.profile.v1": "profile" });
    let reads = 0;
    storage.getItem = () => String(reads++);
    expect(() => captureLegacyBackup(storage)).toThrow("changed");
  });
  it("bounds recovery data without truncating it", () => {
    expect(() =>
      captureLegacyBackup(
        store({ "arowgo.profile.v1": "x".repeat(4 * 1024 * 1024) }),
      ),
    ).toThrow("too-large");
  });
});
