import { AccountError } from "./contracts";
import { developmentAccountConfig as config } from "./development-config";
import { WebAccountApi } from "./web-api";
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: {
            client_id: string;
            nonce: string;
            auto_select: boolean;
            callback: (result: { credential?: string }) => void;
          }): void;
          renderButton(
            element: HTMLElement,
            options: { theme: string; size: string; text: string },
          ): void;
          disableAutoSelect(): void;
        };
      };
    };
  }
}
const status = document.querySelector<HTMLElement>("#status")!;
const login = document.querySelector<HTMLButtonElement>("#login")!;
const logout = document.querySelector<HTMLButtonElement>("#logout")!;
const holder = document.querySelector<HTMLElement>("#google-button")!;
const check = document.querySelector<HTMLButtonElement>("#check")!;
const card = document.querySelector<HTMLElement>(".card")!;
const help = document.querySelector<HTMLElement>("#help")!;
const heading = document.querySelector<HTMLElement>("#heading")!;
const details = document.querySelector<HTMLElement>("#details")!;
const diagnostic = document.querySelector<HTMLElement>("#diagnostic")!;
const continueLink = document.querySelector<HTMLElement>("#continue")!;
const api = new WebAccountApi(true);
let generation = 0;
function present(state: string, title: string, message: string, step: number) {
  card.dataset.state = state;
  heading.textContent = title;
  status.textContent = message;
  document.querySelector(".state-icon")!.textContent =
    state === "success" ? "✓" : state === "error" ? "!" : "↗";
  document
    .querySelectorAll<HTMLElement>("[data-step]")
    .forEach((item, index) => {
      item.dataset.active = String(index === step);
      item.dataset.done = String(index < step);
    });
}
function success(id: string) {
  holder.replaceChildren();
  present(
    "success",
    "You’re connected",
    "Google sign-in succeeded. Your PlayFab account is ready.",
    3,
  );
  diagnostic.textContent = `PlayFab account: ${id}`;
  details.hidden = false;
  help.textContent =
    "Your local saves are unchanged. Signing in does not upload or replace saves. Manage available save options from Profile → Account.";
  login.hidden = check.hidden = true;
  logout.hidden = continueLink.hidden = false;
  logout.disabled = false;
}
function fail(stage: string, error?: unknown) {
  holder.replaceChildren();
  const code = error instanceof AccountError ? error.code : "connection-error";
  const messages: Record<string, string> = {
    "oidc-not-configured":
      "PlayFab could not find the google-web connection for this title.",
    "playfab-network-timeout":
      "The server could not reach PlayFab in time. Please try again.",
    "google-verification-timeout":
      "Google’s verification service did not respond in time.",
    "google-token-rejected":
      "Google’s sign-in credential could not be verified. Start a fresh sign-in.",
    "invalid-flow":
      "This sign-in attempt expired or was already used. Please start again.",
    "provider-unavailable":
      "PlayFab did not complete the sign-in. Your Google consent alone does not complete this step.",
    network:
      "The account service did not respond in time. Check status before retrying.",
  };
  present("error", "Let’s try that again", messages[code] ?? stage, 2);
  diagnostic.textContent = `${stage} · ${code}`;
  details.hidden = false;
  help.textContent = "Nothing has been changed in your local game saves.";
  check.hidden = false;
  check.disabled = false;
  login.hidden = false;
  login.disabled = false;
  login.textContent = "Restart sign-in";
}
login.onclick = () => location.reload();
async function boot() {
  if (location.origin !== config.webOrigin) {
    fail("Open http://localhost:4173/account-test.html");
    return;
  }
  const session = await api.session();
  logout.disabled = !session.account;
  if (session.account) {
    success(session.account.id);
    return;
  }
  present(
    "loading",
    "Preparing Google sign-in",
    "Account service connected. Loading Google…",
    1,
  );
  const script = document.createElement("script");
  script.src = "https://accounts.google.com/gsi/client";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("script timeout")), 10000);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("script unavailable"));
    };
    document.head.append(script);
  });
  const response = await fetch("/api/arowgo/v1/account/google/flow", {
    method: "POST",
    credentials: "same-origin",
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken,
    },
    body: JSON.stringify({ intent: "sign-in" }),
  });
  if (!response.ok)
    throw new AccountError(
      response.status === 429 ? "rate-limited" : "unavailable",
    );
  const { flowId } = await response.json();
  if (typeof flowId !== "string") throw new Error("flow");
  window.google!.accounts.id.initialize({
    client_id: config.googleWebClientId,
    nonce: flowId,
    auto_select: false,
    callback: async (result) => {
      if (!result.credential) {
        fail("Google returned no sign-in credential");
        return;
      }
      const current = ++generation;
      holder.replaceChildren();
      login.hidden = false;
      login.disabled = true;
      check.hidden = true;
      present(
        "busy",
        "Connecting your account",
        "Google responded. Verifying your identity and connecting to PlayFab…",
        2,
      );
      help.textContent =
        "This can take up to 30 seconds. Please keep this page open.";
      try {
        const resultSession = await api.google("sign-in", {
          idToken: result.credential,
          flowId,
          operationId: crypto.randomUUID(),
        });
        if (current !== generation) return;
        success(resultSession.account!.id);
      } catch (error) {
        if (current === generation) fail("Backend sign-in failed", error);
      }
    },
  });
  window.google!.accounts.id.renderButton(holder, {
    theme: "outline",
    size: "large",
    text: "signin_with",
  });
  login.hidden = true;
  present(
    "ready",
    "Welcome to AROWGO",
    "Choose your Google account to continue.",
    1,
  );
  help.textContent =
    "If the Google window closes without a result, restart sign-in. For blocked popups, open this page in Chrome or Edge.";
  login.hidden = false;
  login.disabled = false;
  login.textContent = "Restart sign-in";
}
check.onclick = async () => {
  check.disabled = true;
  try {
    const session = await api.session();
    if (session.account) success(session.account.id);
    else fail("No signed-in session was found. Please restart sign-in.");
  } catch (error) {
    fail("Could not check the account service", error);
  } finally {
    check.disabled = false;
  }
};
logout.onclick = async () => {
  logout.disabled = true;
  try {
    await api.logout();
    window.google?.accounts.id.disableAutoSelect();
    location.reload();
  } catch (error) {
    fail("Sign out failed", error);
  }
};
void boot().catch((error) => fail("Could not initialize sign-in", error));
