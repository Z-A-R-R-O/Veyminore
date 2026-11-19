export function syncPresentation(
  message: string,
  online: boolean,
  failed = false,
) {
  if (failed)
    return {
      kind: "error",
      label: "Save failed",
      detail:
        "Local saving failed. Keep this page open; progress is in memory only.",
    };
  if (!online)
    return {
      kind: "offline",
      label: "Saved locally",
      detail:
        "Offline. Your device keeps progress; pending uploads retry when connected.",
    };
  if (message.includes("another cloud save"))
    return {
      kind: "conflict",
      label: "Save conflict",
      detail:
        "Local progress is safe. Compare both saves in Account before choosing.",
    };
  if (message.includes("paused"))
    return { kind: "error", label: "Saved locally", detail: message };
  if (message.startsWith("Saving completed"))
    return {
      kind: "syncing",
      label: "Syncing",
      detail: "Uploading your completed-level checkpoint. Play can continue.",
    };
  if (message === "Completed level saved to cloud.")
    return {
      kind: "saved",
      label: "Cloud saved",
      detail: "Your completed-level checkpoint was verified in the cloud.",
    };
  return {
    kind: "local",
    label: "Saved locally",
    detail:
      "Progress stays on this device. Set up or check cloud saving in Account.",
  };
}
