import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import {
  cloudProvider,
  packSnapshot,
  unpackSnapshot,
  validateSnapshot,
} from "../server/account/cloud.mjs";

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

function generateRealistic100LevelSnapshot() {
  const levels = [];
  for (let i = 1; i <= 100; i++) {
    const id = `level-${i}`;
    const transcript = Array.from({ length: 28 }, () => crypto.randomUUID());
    const entry = {
      key: i === 1 ? "arowgo.slice.v1" : `arowgo.level.${id}.v1`,
      raw: JSON.stringify({
        levelId: id,
        claimed: true,
        bestStars: 3,
        coins: 25,
        attempts: 2,
        lastPlayed: "2026-11-20T22:00:00.000Z",
        transcript,
      }),
    };
    levels.push(entry);
    levels.push({
      key: entry.key + ".backup",
      raw: entry.raw,
    });
  }
  const profile = {
    key: "arowgo.profile.v1",
    raw: JSON.stringify({
      gems: 50,
      spent: 1250,
      owned: ["classic", "blossom", "frost", "amber", "sanctum"],
      equipped: "sanctum",
      gemGiftClaimed: true,
      welcomeClaimed: true,
    }),
  };
  return validateSnapshot({
    schemaVersion: 1,
    gameId: "arowgo",
    trust: "unverified-local",
    entries: [profile, ...levels],
  });
}

describe("full-history cloud capacity (multi-chunk envelope)", () => {
  it("packs, saves, chunks, and exact-restores realistic 100-level UUID save exceeding 10,700 bytes", async () => {
    const realisticSnapshot = generateRealistic100LevelSnapshot();
    const rawJson = JSON.stringify(realisticSnapshot);
    expect(Buffer.byteLength(rawJson)).toBeGreaterThan(100000); // > 100 KiB

    const packed = packSnapshot(realisticSnapshot);
    // Verifies that realistic 100-level save exceeds the old 10,700-byte cap
    expect(Buffer.byteLength(JSON.stringify(packed))).toBeGreaterThan(10700);

    const { provider, request, objects } = fake();
    const op1 = crypto.randomUUID();

    const result = await provider.save("ticket", {
      expectedVersion: 0,
      operationId: op1,
      snapshot: realisticSnapshot,
    });

    expect(result.version).toBe(1);
    expect(result.save.operationId).toBe(op1);
    expect(result.save.snapshot).toEqual(realisticSnapshot);

    // Verify chunking in PlayFab objects
    const state = objects();
    const headObj = state["arowgo-save-v1"];
    expect(headObj).toBeDefined();
    expect(headObj.snapshot.overflow).toBe(true);
    expect(headObj.snapshot.chunkCount).toBeGreaterThan(1);

    // Verify all chunk objects conform to PlayFab size constraints
    const writes = request.mock.calls.filter(([u]) => u.endsWith("/SetObjects"));
    expect(writes).toHaveLength(1);
    const setObjectsPayload = JSON.parse(writes[0][1].body);
    expect(setObjectsPayload.ExpectedProfileVersion).toBe(0);

    for (const obj of setObjectsPayload.Objects) {
      const bytes = Buffer.byteLength(JSON.stringify(obj.DataObject));
      expect(bytes).toBeLessThanOrEqual(8000);
    }

    // Verify loading and reassembly
    const loaded = await provider.load("ticket");
    expect(loaded.version).toBe(1);
    expect(loaded.save.operationId).toBe(op1);
    expect(loaded.save.snapshot).toEqual(realisticSnapshot);
  });

  it("atomically preserves previous multi-chunk save when updating to a new generation", async () => {
    const snapshot1 = generateRealistic100LevelSnapshot();
    const { provider, objects } = fake();
    const op1 = crypto.randomUUID();

    await provider.save("ticket", {
      expectedVersion: 0,
      operationId: op1,
      snapshot: snapshot1,
    });

    // Save second generation
    const op2 = crypto.randomUUID();
    const snapshot2 = {
      ...snapshot1,
      entries: snapshot1.entries.map((e) =>
        e.key === "arowgo.profile.v1"
          ? { key: e.key, raw: JSON.stringify({ gems: 99, spent: 2000 }) }
          : e,
      ),
    };

    const result2 = await provider.save("ticket", {
      expectedVersion: 1,
      operationId: op2,
      snapshot: snapshot2,
    });

    expect(result2.version).toBe(2);
    expect(result2.save.snapshot).toEqual(snapshot2);

    // Verify current save reassembles to snapshot2
    const currentLoaded = await provider.load("ticket");
    expect(currentLoaded.save.snapshot).toEqual(snapshot2);

    // Verify previous multi-chunk save is preserved in storage
    const state = objects();
    expect(state["arowgo-save-previous-v1"]).toBeDefined();
    expect(state["arowgo-save-previous-v1"].operationId).toBe(op1);
    expect(state["arowgo-save-previous-v1"].snapshot.chunkCount).toBeGreaterThan(1);
  });

  it("fails safely and rejects corrupt or missing chunk objects with invalid-cloud-save", async () => {
    const realisticSnapshot = generateRealistic100LevelSnapshot();
    const { provider, objects } = fake();
    const op1 = crypto.randomUUID();

    await provider.save("ticket", {
      expectedVersion: 0,
      operationId: op1,
      snapshot: realisticSnapshot,
    });

    const state = objects();
    // Tamper with chunk 1 data
    const chunk1Key = "arowgo-save-v1-chunk-1";
    expect(state[chunk1Key]).toBeDefined();

    const originalData = state[chunk1Key].data;
    state[chunk1Key].data = "corrupted_base64_data";

    // Should fail closed with invalid-cloud-save
    await expect(provider.load("ticket")).rejects.toMatchObject({
      message: "invalid-cloud-save",
    });

    // Restore data, but delete chunk 2
    state[chunk1Key].data = originalData;
    delete state["arowgo-save-v1-chunk-2"];

    await expect(provider.load("ticket")).rejects.toMatchObject({
      message: "invalid-cloud-save",
    });
  });

  it("maintains idempotency and optimistic concurrency on large chunked saves", async () => {
    const realisticSnapshot = generateRealistic100LevelSnapshot();
    const { provider, request } = fake();
    const op1 = crypto.randomUUID();

    await provider.save("ticket", {
      expectedVersion: 0,
      operationId: op1,
      snapshot: realisticSnapshot,
    });

    // Retrying with same operationId and same payload succeeds without extra write
    const res = await provider.save("ticket", {
      expectedVersion: 0,
      operationId: op1,
      snapshot: realisticSnapshot,
    });
    expect(res.version).toBe(1);
    expect(request.mock.calls.filter(([u]) => u.endsWith("/SetObjects"))).toHaveLength(1);

    // Stale expectedVersion throws save-conflict (409)
    await expect(
      provider.save("ticket", {
        expectedVersion: 0,
        operationId: crypto.randomUUID(),
        snapshot: realisticSnapshot,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
