import { describe, it, expect, vi } from "vitest";
import {
  cloudProvider,
  packSnapshot,
  unpackSnapshot,
  validateSnapshot,
} from "../server/account/cloud.mjs";
import { createAccountService } from "../server/account/service.mjs";
import { createCloudProbe } from "../server/account/cloud-probe.mjs";
const operationId = "f1c763fe-44e0-41d7-9d35-3ec5523a7510";
const snapshot = {
  schemaVersion: 1,
  gameId: "arowgo",
  trust: "unverified-local",
  entries: [
    { key: "arowgo.profile.v1", raw: '{"gems":19,"spent":100}' },
    { key: "arowgo.slice.v1", raw: '{"coins":410,"bestStars":3}' },
  ],
};
function fake() {
  let version = 0,
    objects = {};
  const request = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    let data;
    if (url.endsWith("/GetEntityToken"))
      data = {
        Entity: { Id: "ENTITY", Type: "title_player_account" },
        EntityToken: "private",
      };
    else if (url.endsWith("/GetObjects"))
      data = {
        ProfileVersion: version,
        Objects: Object.fromEntries(
          Object.entries(objects).map(([k, v]) => [k, { DataObject: v }]),
        ),
      };
    else {
      if (body.ExpectedProfileVersion !== version)
        return new Response(
          JSON.stringify({ code: 409, error: "EntityProfileVersionMismatch" }),
          { status: 409 },
        );
      for (const object of body.Objects)
        objects[object.ObjectName] = object.DataObject;
      data = { ProfileVersion: ++version };
    }
    return new Response(JSON.stringify({ code: 200, data }));
  });
  return {
    provider: cloudProvider({ titleId: "116A87", request }),
    request,
    bump: () => version++,
    objects: () => objects,
  };
}
describe("cloud persistence", () => {
  it("runs the live-test workflow only against probe objects, preserving a populated normal save", async () => {
    const { provider, request } = fake();
    await provider.save("ticket", {
      expectedVersion: 0,
      operationId,
      snapshot,
    });
    request.mockClear();
    const result = await createCloudProbe({ titleId: "116A87", request })(
      "ticket",
    );
    expect(result.passed).toBe(true);
    expect(JSON.parse(result.snapshot.entries[0].raw).gems).toBe(19);
    const writes = request.mock.calls.filter(([url]) =>
      url.endsWith("/SetObjects"),
    );
    expect(writes).toHaveLength(3);
    for (const [, init] of writes)
      expect(
        JSON.parse(init.body).Objects.every((o) =>
          o.ObjectName.startsWith("arowgo-sync-probe-"),
        ),
      ).toBe(true);
    expect((await provider.load("ticket")).save.snapshot).toEqual(snapshot);
  });
  it("round trips exact currency and progress bytes; rejects corruption", () => {
    const packed = packSnapshot(snapshot);
    expect(unpackSnapshot(packed)).toEqual(snapshot);
    expect(() => unpackSnapshot({ ...packed, hash: "wrong" })).toThrow(
      "invalid-cloud-save",
    );
  });
  it("rejects unknown keys, excessive payloads and duplicate keys", () => {
    expect(() =>
      validateSnapshot({ ...snapshot, entries: [{ key: "token", raw: "x" }] }),
    ).toThrow();
    expect(() =>
      validateSnapshot({
        ...snapshot,
        entries: [snapshot.entries[0], snapshot.entries[0]],
      }),
    ).toThrow();
    expect(() =>
      packSnapshot({
        ...snapshot,
        entries: [{ key: "arowgo.profile.v1", raw: "x".repeat(600000) }],
      }),
    ).toThrow();
  });
  it("uses entity from session ticket, version precondition, and retains the previous save", async () => {
    const { provider, request } = fake();
    expect((await provider.load("ticket")).save).toBeNull();
    const first = await provider.save("ticket", {
      expectedVersion: 0,
      operationId,
      snapshot,
    });
    expect(first.version).toBe(1);
    const next = {
      ...snapshot,
      entries: [{ key: "arowgo.profile.v1", raw: '{"gems":12}' }],
    };
    await provider.save("ticket", {
      expectedVersion: 1,
      operationId: operationId.replace("f1", "a1"),
      snapshot: next,
    });
    const writes = request.mock.calls
      .filter(([u]) => u.endsWith("/SetObjects"))
      .map(([, i]) => JSON.parse(i.body));
    expect(writes[1].ExpectedProfileVersion).toBe(1);
    expect(unpackSnapshot(writes[1].Objects[1].DataObject.snapshot)).toEqual(
      snapshot,
    );
    expect(writes[1].Entity.Id).toBe("ENTITY");
  });
  it("rejects stale devices without overwriting cloud", async () => {
    const { provider } = fake();
    await provider.save("ticket", {
      expectedVersion: 0,
      operationId,
      snapshot,
    });
    await expect(
      provider.save("ticket", {
        expectedVersion: 0,
        operationId: operationId.replace("f1", "a1"),
        snapshot,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await provider.load("ticket")).version).toBe(1);
  });
  it("retries a committed operation without duplicate writes, but rejects changed payload", async () => {
    const { provider, request } = fake();
    const input = { expectedVersion: 0, operationId, snapshot };
    await provider.save("ticket", input);
    await provider.save("ticket", input);
    expect(
      request.mock.calls.filter(([u]) => u.endsWith("/SetObjects")),
    ).toHaveLength(1);
    await expect(
      provider.save("ticket", {
        ...input,
        snapshot: { ...snapshot, entries: [] },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("enforces provider compare-and-set when a concurrent write happens after reading", async () => {
    const { request, bump } = fake();
    const race = async (url, init) => {
      if (url.endsWith("/SetObjects")) bump();
      return request(url, init);
    };
    const provider = cloudProvider({ titleId: "116A87", request: race });
    await expect(
      provider.save("ticket", { expectedVersion: 0, operationId, snapshot }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("keeps cloud unavailable unless explicitly configured", async () => {
    const s = createAccountService({ provider: {} });
    await expect(s.sync("x", "x", { action: "load" })).rejects.toMatchObject({
      status: 503,
    });
  });
  it("rejects anonymous, wrong CSRF and wrong account requests", async () => {
    const cloud = { load: vi.fn(async () => ({ version: 0, save: null })) };
    const s = createAccountService({
      provider: { login: async () => ({ id: "ABC", ticket: "secret" }) },
      verifyIdentity: async () => {},
      cloud,
    });
    const a = s.bootstrap();
    await expect(
      s.sync(a.id, a.data.csrfToken, { action: "load", accountId: "ABC" }),
    ).rejects.toMatchObject({ status: 401 });
    const flow = s.flow(a.id, a.data.csrfToken, "sign-in");
    const b = await s.google(a.id, a.data.csrfToken, "sign-in", {
      schemaVersion: 1,
      operationId,
      flowId: flow.flowId,
      idToken: "test",
    });
    await expect(
      s.sync(b.id, "bad", { action: "load", accountId: "ABC" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      s.sync(b.id, b.data.csrfToken, { action: "load", accountId: "OTHER" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(cloud.load).not.toHaveBeenCalled();
    expect(
      (
        await s.sync(b.id, b.data.csrfToken, {
          action: "load",
          accountId: "ABC",
        })
      ).accountId,
    ).toBe("ABC");
    expect(cloud.load).toHaveBeenCalledWith("secret");
  });
});
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
it("continues to read previously stored gzip payloads exactly", () => {
  const json = JSON.stringify(snapshot);
  const old = {
    encoding: "gzip-base64",
    data: gzipSync(json).toString("base64"),
    hash: createHash("sha256").update(json).digest("hex"),
  };
  expect(unpackSnapshot(old)).toEqual(snapshot);
  expect(() => unpackSnapshot({ ...old, encoding: "unknown" })).toThrow(
    "invalid-cloud-save",
  );
});

it("atomically preserves large current and previous saves with bounded overflow fragments", async () => {
  const { provider, request, objects } = fake();
  const large = {
    ...snapshot,
    entries: [
      {
        key: "arowgo.profile.v1",
        raw: Array.from({ length: 210 }, (_, i) =>
          createHash("sha256").update(String(i)).digest("hex"),
        ).join(""),
      },
    ],
  };
  expect(
    Buffer.byteLength(JSON.stringify(packSnapshot(large))),
  ).toBeGreaterThan(8000);
  const first = await provider.save("ticket", {
    expectedVersion: 0,
    operationId,
    snapshot: large,
  });
  expect(first.save.snapshot).toEqual(large);
  const secondId = operationId.replace("f1", "a1");
  const second = {
    ...large,
    entries: [{ ...large.entries[0], raw: large.entries[0].raw + "changed" }],
  };
  await provider.save("ticket", {
    expectedVersion: 1,
    operationId: secondId,
    snapshot: second,
  });
  expect((await provider.load("ticket")).save.snapshot).toEqual(second);
  const state = objects(),
    tails = state["arowgo-save-overflow-v1"].records;
  const previous = state["arowgo-save-previous-v1"];
  expect(
    unpackSnapshot({
      ...previous.snapshot,
      data: previous.snapshot.data + tails[previous.operationId],
    }),
  ).toEqual(large);
  const writes = request.mock.calls.filter(([u]) => u.endsWith("/SetObjects"));
  expect(writes).toHaveLength(2);
  for (const [, init] of writes) {
    const body = JSON.parse(init.body);
    expect(body.Objects.length).toBeLessThanOrEqual(3);
    for (const object of body.Objects)
      expect(
        Buffer.byteLength(JSON.stringify(object.DataObject)),
      ).toBeLessThanOrEqual(8000);
  }
  await provider.save("ticket", {
    expectedVersion: 1,
    operationId: secondId,
    snapshot: second,
  });
  expect(
    request.mock.calls.filter(([u]) => u.endsWith("/SetObjects")),
  ).toHaveLength(2);
  await expect(
    provider.save("ticket", {
      expectedVersion: 1,
      operationId: operationId.replace("f1", "b1"),
      snapshot: large,
    }),
  ).rejects.toMatchObject({ status: 409 });
  delete tails[secondId];
  await expect(provider.load("ticket")).rejects.toMatchObject({
    message: "invalid-cloud-save",
  });
});
