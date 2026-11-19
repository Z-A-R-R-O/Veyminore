import React from "react";
import { startCompletionSync } from "./account/auto-sync";
import { createRoot } from "react-dom/client";
import { initializeEconomy, economyOwner } from "./account/economy-runtime";
import "./ui/style.css";
import "./ui/world-scene.css";
import "./ui/results.css";
import "./ui/typography.css";
import "./ui/play-layout.css";
import "./ui/gems.css";
async function launch() {
  try {
    await initializeEconomy();
    const mount = async () => {
      const { Prototype } = await import("./ui/Prototype");
      if (!economyOwner()) startCompletionSync();
      createRoot(document.getElementById("root")!).render(
        <React.StrictMode>
          <Prototype />
        </React.StrictMode>,
      );
    };
    if (economyOwner()) {
      if (!navigator.locks)
        throw Error("This wallet requires a browser with Web Locks.");
      void navigator.locks.request(
        `arowgo-economy-play-${economyOwner()}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            document.getElementById("root")!.textContent =
              "Your account game is open in another tab. Close it and reload here.";
            return;
          }
          await mount();
          await new Promise<void>(() => {});
        },
      );
    } else await mount();
  } catch (e) {
    const root = document.getElementById("root")!;
    root.textContent = `Account wallet paused. ${e instanceof Error ? e.message : "Please reconnect."} `;
    const a = document.createElement("a");
    a.href = "/account-test.html";
    a.textContent = "Open sign-in";
    root.append(a);
  }
}
void launch();
