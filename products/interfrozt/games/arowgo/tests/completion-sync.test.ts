import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CompletionSync,
  type SyncAnchor,
} from "../src/account/completion-sync";
import { Controller } from "../src/application/controller";
import { SaveStore } from "../src/storage/save";
import { levels } from "../src/domain/campaign";
import { safeArrows } from "../src/domain/rules";
const snap = (gems: number) => ({
  schemaVersion: 1 as const,
  gameId: "arowgo" as const,
  trust: "unverified-local" as const,
  entries: [{ key: "arowgo.profile.v1", raw: JSON.stringify({ gems }) }],
});
function setup() {
  let anchor: SyncAnchor | null = {
      accountId: "ABC",
      version: 1,
      pending: null,
    },
    local = snap(19),
    cloud = {
      accountId: "ABC",
      version: 1,
      save: { savedAt: "now", operationId: "old", snapshot: snap(20) },
    };
  const status = vi.fn();
  const request = vi.fn(
    async (
      _account: string,
      action: string,
      input?: Record<string, unknown>,
    ) => {
      if (action === "save")
        cloud = {
          ...cloud,
          version: cloud.version + 1,
          save: {
            savedAt: "now",
            operationId: String(input!.operationId),
            snapshot: input!.snapshot as typeof local,
          },
        };
      return cloud;
    },
  );
  const engine = new CompletionSync({
    read: () => anchor,
    write: (a) => {
      anchor = a;
    },
    snapshot: () => local,
    request,
    lock: (job) => job(),
    id: () => crypto.randomUUID(),
    status,
  });
  return {
    engine,
    request,
    status,
    get anchor() {
      return anchor;
    },
    get local() {
      return local;
    },
    setAnchor: (a: SyncAnchor | null) => {
      anchor = a;
    },
    setLocal: (g: number) => {
      local = snap(g);
    },
    setCloud: (version: number, gems: number) => {
      cloud = {
        ...cloud,
        version,
        save: { ...cloud.save, snapshot: snap(gems) },
      };
    },
  };
}
describe("completion sync", () => {
  it("uploads exact balances with expected revision and never mutates local data", async () => {
    const s = setup();
    s.engine.completed();
    await vi.waitFor(() => expect(s.anchor?.pending).toBeNull());
    expect(s.request.mock.calls[1][2]).toMatchObject({
      expectedVersion: 1,
      snapshot: snap(19),
    });
    expect(s.anchor?.version).toBe(2);
    expect(s.local).toEqual(snap(19));
  });
  it("does not upload without a confirmed account anchor", async () => {
    const s = setup();
    s.setAnchor(null);
    s.engine.completed();
    await s.engine.flush();
    expect(s.request).not.toHaveBeenCalled();
  });
  it("pauses on a different remote revision without overwriting either save", async () => {
    const s = setup();
    s.setCloud(9, 100);
    s.engine.completed();
    await vi.waitFor(() =>
      expect(s.status).toHaveBeenLastCalledWith(
        expect.stringContaining("another cloud save"),
      ),
    );
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.anchor?.version).toBe(1);
    expect(s.local).toEqual(snap(19));
  });
  it("preserves pending work offline and retries after connectivity returns", async () => {
    const s = setup();
    s.request.mockRejectedValueOnce(Error("offline"));
    s.engine.completed();
    await vi.waitFor(() =>
      expect(s.status).toHaveBeenLastCalledWith(
        expect.stringContaining("paused"),
      ),
    );
    expect(s.anchor?.pending).toBeTruthy();
    await s.engine.flush();
    expect(s.anchor?.pending).toBeNull();
  });
  it("reconciles a lost-response commit without another balance write", async () => {
    const s = setup();
    s.setCloud(2, 19);
    s.engine.completed();
    await vi.waitFor(() => expect(s.anchor?.version).toBe(2));
    expect(s.request.mock.calls.every((c) => c[1] === "load")).toBe(true);
  });
  it("does not bind data to a changed account", async () => {
    const s = setup();
    s.request.mockResolvedValueOnce({
      accountId: "OTHER",
      version: 1,
      save: null,
    } as never);
    s.engine.completed();
    await vi.waitFor(() =>
      expect(s.status).toHaveBeenLastCalledWith(
        expect.stringContaining("paused"),
      ),
    );
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.anchor?.accountId).toBe("ABC");
  });
  it("coalesces a completion arriving while an upload is in progress", async () => {
    const s = setup();
    const real = s.request.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    s.request.mockImplementationOnce(async (...args) => {
      await gate;
      return real(...args);
    });
    s.engine.completed();
    await vi.waitFor(() => expect(s.request).toHaveBeenCalledTimes(1));
    s.setLocal(7);
    s.engine.completed();
    release();
    await vi.waitFor(() => expect(s.anchor?.pending).toBeNull());
    expect(
      s.request.mock.calls
        .filter((c) => c[1] === "save")
        .map((c) => (c[2]!.snapshot as ReturnType<typeof snap>).entries[0].raw),
    ).toEqual(['{"gems":19}', '{"gems":7}']);
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("persisted campaign completion trigger", () => {
  it.each([
    [true, "story", 1],
    [false, "story", 0],
    [true, "practice", 0],
  ] as const)(
    "persisted=%s mode=%s emits %s completion",
    (saved, mode, count) => {
      const target = new EventTarget();
      vi.stubGlobal("window", target);
      const notice = vi.fn();
      target.addEventListener("arowgo-level-saved", notice);
      const storage = {
        getItem: () => null,
        setItem: () => {
          if (!saved) throw Error("quota");
        },
      };
      const c = new Controller(levels[0], new SaveStore(storage, levels[0]));
      c.restart(mode);
      while (c.state.status === "playing")
        c.select(safeArrows(levels[0], c.state.active)[0]);
      expect(c.state.status).toBe("complete");
      expect(notice).toHaveBeenCalledTimes(count);
      c.select("A");
      expect(notice).toHaveBeenCalledTimes(count);
    },
  );
});
