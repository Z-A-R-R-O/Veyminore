import { randomUUID } from "node:crypto";
import { cloudProvider } from "./cloud.mjs";
import { AuthError } from "./service.mjs";
const fixture = (gems) => ({
  schemaVersion: 1,
  gameId: "arowgo",
  trust: "unverified-local",
  entries: [
    {
      key: "arowgo.profile.v1",
      raw: JSON.stringify({
        version: 2,
        name: "Sync test only",
        avatar: "world",
        owned: ["classic"],
        equipped: "classic",
        gems,
        gemGiftClaimed: true,
        timeBoosts: [],
        spent: 0,
        openings: 0,
        welcomeClaimed: false,
        lastReward: null,
      }),
    },
  ],
});
export function createCloudProbe({ titleId, request = fetch }) {
  const test = cloudProvider({ titleId, request, testNamespace: true });
  const real = cloudProvider({ titleId, request });
  return async (ticket) => {
    const before = await real.load(ticket);
    const initial = await test.load(ticket);
    const first = await test.save(ticket, {
      expectedVersion: initial.version,
      operationId: randomUUID(),
      snapshot: fixture(19),
    });
    const read = await test.load(ticket);
    if (
      JSON.stringify(read.save?.snapshot) !==
      JSON.stringify(first.save.snapshot)
    )
      throw new AuthError(502, "probe-readback-failed");
    const second = await test.save(ticket, {
      expectedVersion: read.version,
      operationId: randomUUID(),
      snapshot: fixture(7),
    });
    let conflict = false;
    try {
      await test.save(ticket, {
        expectedVersion: read.version,
        operationId: randomUUID(),
        snapshot: fixture(99),
      });
    } catch (e) {
      if (e.status === 409) conflict = true;
      else throw e;
    }
    if (!conflict) throw new AuthError(502, "probe-conflict-failed");
    const restored = await test.save(ticket, {
      expectedVersion: second.version,
      operationId: randomUUID(),
      snapshot: first.save.snapshot,
    });
    const final = await test.load(ticket),
      after = await real.load(ticket);
    if (
      JSON.stringify(final.save?.snapshot) !==
        JSON.stringify(first.save.snapshot) ||
      JSON.stringify(before.save) !== JSON.stringify(after.save)
    )
      throw new AuthError(502, "probe-preservation-failed");
    console.log(
      "Cloud probe: real PlayFab write/read/conflict/restore passed; normal cloud save unchanged.",
    );
    return {
      passed: true,
      snapshot: restored.save.snapshot,
      checks: [
        "write",
        "readback",
        "conflict",
        "cloud-restore",
        "normal-save-unchanged",
      ],
    };
  };
}
