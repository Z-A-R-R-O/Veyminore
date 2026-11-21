import { useSyncExternalStore } from "react";
import { autoSyncStatus, subscribeAutoSync } from "../account/auto-sync";
import { syncPresentation } from "../account/sync-presentation";
import "./save-status.css";
const networkSubscribe = (fn: () => void) => {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
};
export function SaveStatus({
  compact = false,
  failed = false,
}: {
  compact?: boolean;
  failed?: boolean;
}) {
  const message = useSyncExternalStore(subscribeAutoSync, autoSyncStatus);
  const online = useSyncExternalStore(networkSubscribe, () => navigator.onLine);
  const state = syncPresentation(message, online, failed);
  return (
    <div
      className={`save-status ${compact ? "save-status-compact" : ""}`}
      data-save-state={state.kind}
    >
      <button
        type="button"
        aria-label={`${state.label}. ${state.detail} Open Account.`}
        title={state.detail}
        onClick={() => location.assign("/?account=1#profile")}
      >
        <span className="save-status-dot" aria-hidden="true" />
        <span aria-live="polite">{state.label}</span>
      </button>
      {!compact && <small>{state.detail}</small>}
    </div>
  );
}
