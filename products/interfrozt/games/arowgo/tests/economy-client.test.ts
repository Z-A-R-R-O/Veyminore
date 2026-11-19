import { describe, it, expect, vi } from "vitest";
import { EconomyClient } from "../src/account/economy-api";
import {
  activateAccountCopy,
  migrationPacket,
} from "../src/account/economy-migration";
import { guest } from "../src/storage/profile";
import { newSession, resolve } from "../src/application/session";
import { levels } from "../src/domain/campaign";
function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}
describe("account wallet client safety", () => {
  it("persists intent before sending and retries uncertain requests with the same operation", async () => {
    const s = storage(),
      calls: any[] = [];
    let fail = true;
    const request = async (i: any) => {
      calls.push(i);
      if (fail) {
        fail = false;
        throw Error("lost response");
      }
      return { wallet: { coins: 10, revision: 1 } };
    };
    const c = new EconomyClient("ABC", s, request);
    await expect(
      c.run("purchase", { action: "chest" }, true),
    ).rejects.toThrow();
    const restarted = new EconomyClient("ABC", s, request);
    await restarted.run("purchase", { action: "chest" }, true);
    await restarted.run("purchase", { action: "chest" }, true);
    expect(calls).toHaveLength(2);
    expect(calls[0].operationId).toBe(calls[1].operationId);
    await expect(restarted.run("purchase", { action: "gift" })).rejects.toThrow(
      "pending-operation-differs",
    );
  });
  it("does not send if intent cannot be saved", async () => {
    const req = vi.fn();
    const s = storage();
    s.setItem = () => {
      throw Error("disk");
    };
    await expect(
      new EconomyClient("ABC", s, req).run("p", { action: "gift" }),
    ).rejects.toThrow("disk");
    expect(req).not.toHaveBeenCalled();
  });
  it("isolates intent receipts between accounts", async () => {
    const s = storage(),
      req = vi.fn(async () => ({ ok: true }));
    await new EconomyClient("ABC", s, req).run(
      "gift",
      { action: "gift" },
      true,
    );
    await new EconomyClient("DEF", s, req).run(
      "gift",
      { action: "gift" },
      true,
    );
    expect(req).toHaveBeenCalledTimes(2);
  });
  it("copies without changing source and never switches binding after partial storage failure", () => {
    const s = storage();
    s.setItem("arowgo.profile.v1", "original");
    const backup = {
      schemaVersion: 1 as const,
      gameId: "arowgo" as const,
      trust: "unverified-local" as const,
      entries: [{ key: "arowgo.profile.v1", raw: "original" }],
    };
    const write = s.setItem;
    s.setItem = (k, v) => {
      if (k.includes(".save.")) throw Error("full");
      write(k, v);
    };
    expect(() => activateAccountCopy(s, "ABC", backup)).toThrow("full");
    expect(s.getItem("arowgo.economy.binding.v1")).toBeNull();
    expect(s.getItem("arowgo.profile.v1")).toBe("original");
    s.setItem = write;
    activateAccountCopy(s, "ABC", backup);
    expect(s.getItem("arowgo.economy.binding.v1")).toBe("ABC");
    expect(s.getItem("arowgo.profile.v1")).toBe("original");
    expect(() => activateAccountCopy(s, "DEF", backup)).toThrow();
  });
  it("preserves exact balances, collection and boost data in migration recovery", async () => {
    const p = {
      ...guest(),
      gems: 19,
      gemGiftClaimed: true,
      timeBoosts: ["old-attempt"],
    };
    const b = {
      schemaVersion: 1 as const,
      gameId: "arowgo" as const,
      trust: "unverified-local" as const,
      entries: [{ key: "arowgo.profile.v1", raw: JSON.stringify(p) }],
    };
    const packet = await migrationPacket("ABC", b);
    expect(packet.manifest).toMatchObject({
      coins: 0,
      gems: 19,
      owned: ["classic"],
    });
    expect(packet.backup.entries[0].raw).toBe(b.entries[0].raw);
    await expect(
      migrationPacket("ABC", {
        ...b,
        entries: [{ key: "arowgo.profile.v1", raw: '{"gems":999}' }],
      }),
    ).rejects.toThrow();
  });
  it("records select and erase moves in order without inventing a transcript for legacy attempts", () => {
    let s = newSession(levels[0], "test");
    s = resolve(levels[0], s, {
      id: "a",
      attemptId: "test",
      type: "select",
      arrowId: "A",
    }).state;
    s = resolve(levels[0], s, {
      id: "b",
      attemptId: "test",
      type: "erase",
      arrowId: "B",
    }).state;
    expect(s.moveLog).toEqual([
      { type: "select", arrowId: "A" },
      { type: "erase", arrowId: "B" },
    ]);
    delete s.moveLog;
    expect(
      resolve(levels[0], s, {
        id: "c",
        attemptId: "test",
        type: "erase",
        arrowId: "C",
      }).state.moveLog,
    ).toBeUndefined();
  });
});
