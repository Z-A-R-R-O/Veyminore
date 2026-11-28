import {
  economyOwner,
  economyMessage,
  subscribeEconomy,
} from "../account/economy-runtime";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  autoSyncEnabled,
  autoSyncStatus,
  subscribeAutoSync,
  retryCompletionSync,
} from "../account/auto-sync";
import { WebAccountApi } from "../account/web-api";
import { developmentAccountConfig } from "../account/development-config";
import type { AccountIdentity } from "../account/contracts";

/** Identity only: deliberately has no access to profile/save writers. */
export function ProfileAccount() {
  const walletMessage = useSyncExternalStore(subscribeEconomy, economyMessage);
  const syncEnabled = autoSyncEnabled && !economyOwner();
  const syncMessage = useSyncExternalStore(subscribeAutoSync, autoSyncStatus);
  const enabled =
    import.meta.env.DEV &&
    (location.origin === developmentAccountConfig.webOrigin ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1");
  const [api] = useState(() => new WebAccountApi(enabled));
  const [account, setAccount] = useState<AccountIdentity | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const alive = useRef(true);
  async function refresh(signOut = false) {
    if (busy.current || !enabled) return;
    busy.current = true;
    setState("loading");
    try {
      // Refresh CSRF and identity before a user-initiated logout.
      const current = await api.session();
      const result = signOut && current.account ? await api.logout() : current;
      if (!alive.current) return;
      setAccount(result.account);
      setState("ready");
      setMessage(
        signOut ? "Signed out. Your local progress is unchanged." : "",
      );
    } catch {
      if (!alive.current) return;
      setState("error");
      setMessage(
        "Could not confirm your account status. Your local progress is still on this device.",
      );
    } finally {
      busy.current = false;
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", focus);
    };
  }, [api]);
  return (
    <section className="profile-account" aria-label="Account connection">
      <h2>
        {enabled && state === "ready" && account
          ? "Google connected"
          : "Your account"}
      </h2>
      <p>
        {enabled && import.meta.env.VITE_AROWGO_CLOUD_SYNC === "1"
          ? autoSyncEnabled
            ? "Progress saves on this device first. Completed levels upload automatically after cloud setup; conflicts pause uploads. Restores stay manual."
            : "Progress is saved on this device. Use Manage cloud save to back up or restore a complete save, including its balances. Sync is manual."
          : "Progress is saved on this device. Cloud saves and currency sync are not enabled yet."}
      </p>
      {!enabled ? (
        <p role="status">
          Account sign-in is available in the localhost development preview
          only. Keep playing here to retain this browser’s saves.
        </p>
      ) : (
        <>
          <p role="status">
            {state === "loading"
              ? "Checking your account…"
              : message ||
                (account
                  ? "Your Google account is connected to PlayFab."
                  : "Connect Google without changing your local progress.")}
          </p>
          {state === "ready" && account && (
            <small className="account-id">Account: {account.id}</small>
          )}
          {economyOwner() && <p role="status">{walletMessage}</p>}
          <div className="account-actions">
            {economyOwner() && <a href="/economy.html">Account recovery</a>}
            {state === "ready" && account && !economyOwner() && (
              <a href="/economy.html">Review or restore account</a>
            )}
            {economyOwner() && (
              <button
                onClick={() =>
                  window.dispatchEvent(new Event("arowgo-level-saved"))
                }
              >
                Retry account sync
              </button>
            )}
            {state === "ready" && account && syncEnabled && (
              <button onClick={retryCompletionSync}>Retry auto-sync</button>
            )}
            {state === "ready" &&
              account &&
              !economyOwner() &&
              import.meta.env.VITE_AROWGO_CLOUD_SYNC === "1" && (
                <a href="/cloud-save.html">Manage cloud save</a>
              )}
            {state === "ready" && !account && (
              <a
                className="primary-button google-signin-button"
                href="/account-test.html"
              >
                <span className="google-signin-mark">
                  <img
                    src="/assets/google-signin.svg"
                    width="20"
                    height="20"
                    alt=""
                  />
                </span>
                Sign in with Google
              </a>
            )}
            {state === "ready" && account && (
              <button onClick={() => void refresh(true)}>Sign out</button>
            )}
            {state === "error" && (
              <button onClick={() => void refresh()}>
                Retry account connection
              </button>
            )}
          </div>
          {state === "ready" && account && syncEnabled && (
            <p role="status">{syncMessage}</p>
          )}
        </>
      )}
      <small>
        Signing in or out does not import, merge, delete or upload your local
        saves.
      </small>
    </section>
  );
}
