import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
// This host times out with automatic family selection; process-local IPv4 routing was verified.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);
import { createAccountService, playFabProvider } from "./service.mjs";
import { createAccountServer } from "./http.mjs";
import { googleIdentityVerifier } from "./google-identity.mjs";
import { cloudProvider } from "./cloud.mjs";
import { createCloudProbe } from "./cloud-probe.mjs";
import { mkdirSync } from "node:fs";

if (process.env.NODE_ENV === "production")
  throw new Error("Development authentication spike cannot run in production");
let economy;
if (process.env.AROWGO_ECONOMY === "1") {
  mkdirSync(new URL("../../.local/", import.meta.url), { recursive: true });
  const { openWalletLedger } = await import("../economy/wallet.mjs");
  economy = openWalletLedger(
    new URL("../../.local/economy.sqlite", import.meta.url),
  );
}
const service = createAccountService({
  economy,
  cloudProbe:
    process.env.AROWGO_CLOUD_PROBE === "1"
      ? createCloudProbe({ titleId: "116A87" })
      : undefined,
  cloud:
    process.env.AROWGO_CLOUD_SYNC === "1"
      ? cloudProvider({ titleId: "116A87" })
      : undefined,
  provider: playFabProvider({ titleId: "116A87" }),
  verifyIdentity: googleIdentityVerifier(
    "169221851812-g5sp0sl7ingtl54t748qr0sajfnu6ej6.apps.googleusercontent.com",
  ),
});
createAccountServer({ service }).listen(4174, "127.0.0.1", () => {
  console.log(
    "AROWGO development account API listening on 127.0.0.1:4174. Open http://localhost:4173/account-test.html",
  );
});
