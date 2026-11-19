import { describe, it, expect } from "vitest";
import { syncPresentation } from "../src/account/sync-presentation";
describe("save status presentation", () => {
  it("never shows cloud success for newer local progress", () => {
    expect(
      syncPresentation(
        "New progress saved locally; completed checkpoint is in the cloud.",
        true,
      ).kind,
    ).toBe("local");
  });
  it("prioritizes local save failures over cloud success", () => {
    expect(
      syncPresentation("Completed level saved to cloud.", true, true).label,
    ).toBe("Save failed");
  });
  it("shows verified cloud success, offline, uploading and conflict states", () => {
    expect(syncPresentation("Completed level saved to cloud.", true).kind).toBe(
      "saved",
    );
    expect(
      syncPresentation("Completed level saved to cloud.", false).kind,
    ).toBe("offline");
    expect(
      syncPresentation("Saving completed level to cloud…", true).kind,
    ).toBe("syncing");
    expect(
      syncPresentation("Auto-sync paused: another cloud save exists.", true)
        .kind,
    ).toBe("conflict");
  });
});
