import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";

// This host times out with automatic family selection; process-local IPv4 routing was verified.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);

import { createAccountService, playFabProvider } from "./service.mjs";
import { createAccountServer } from "./http.mjs";
import { googleIdentityVerifier } from "./google-identity.mjs";
import { cloudProvider } from "./cloud.mjs";
import { createCloudProbe } from "./cloud-probe.mjs";
import { openSessionStore } from "./session-store.mjs";
import { createRateLimiter } from "./rate-limiter.mjs";

const isProduction = process.env.NODE_ENV === "production";
const isProductionServer = process.env.AROWGO_PRODUCTION_SERVER === "1";

if (isProduction && !isProductionServer) {
  throw new Error(
    "Development authentication spike cannot run in production without explicit AROWGO_PRODUCTION_SERVER=1 and configured storage",
  );
}

const dataDir = process.env.AROWGO_DATA_DIR
  ? resolve(process.env.AROWGO_DATA_DIR)
  : fileURLToPath(new URL("../../.local/", import.meta.url));

mkdirSync(dataDir, { recursive: true });

let economy;
if (process.env.AROWGO_ECONOMY === "1" || isProductionServer) {
  const { openWalletLedger } = await import("../economy/wallet.mjs");
  const dbPath = join(dataDir, "economy.sqlite");
  economy = openWalletLedger(dbPath);
}

let sessionStore;
if (isProductionServer || process.env.AROWGO_DURABLE_SESSIONS === "1") {
  const sessionDbPath = join(dataDir, "sessions.sqlite");
  sessionStore = openSessionStore(sessionDbPath);
}

const rateLimiter = createRateLimiter({
  windowMs: Number(process.env.AROWGO_RATE_LIMIT_WINDOW_MS || 60000),
  maxRequests: Number(process.env.AROWGO_RATE_LIMIT_MAX || 120),
});

const service = createAccountService({
  economy,
  sessionStore,
  cloudProbe:
    process.env.AROWGO_CLOUD_PROBE === "1"
      ? createCloudProbe({ titleId: process.env.PLAYFAB_TITLE_ID || "116A87" })
      : undefined,
  cloud:
    process.env.AROWGO_CLOUD_SYNC === "1"
      ? cloudProvider({ titleId: process.env.PLAYFAB_TITLE_ID || "116A87" })
      : undefined,
  provider: playFabProvider({
    titleId: process.env.PLAYFAB_TITLE_ID || "116A87",
  }),
  verifyIdentity: googleIdentityVerifier(
    process.env.GOOGLE_CLIENT_ID ||
      "169221851812-g5sp0sl7ingtl54t748qr0sajfnu6ej6.apps.googleusercontent.com",
  ),
});

const port = Number(process.env.PORT || 4174);
const host = isProductionServer
  ? (process.env.AROWGO_HOST || "0.0.0.0")
  : "127.0.0.1";

const origin = isProductionServer
  ? (process.env.AROWGO_ALLOWED_ORIGIN || "https://arowgo.vercel.app")
  : "http://localhost:4173";

const allowedOrigins = process.env.AROWGO_ALLOWED_ORIGIN
  ? [process.env.AROWGO_ALLOWED_ORIGIN]
  : isProductionServer
    ? ["https://arowgo.vercel.app"]
    : ["http://localhost:4173"];

const server = createAccountServer({
  service,
  origin,
  allowedOrigins,
  rateLimiter,
  isProduction: isProductionServer,
});

server.listen(port, host, () => {
  console.log(
    `AROWGO account API listening on ${host}:${port} (mode: ${isProductionServer ? "production" : "development"}). Health: http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/api/arowgo/v1/health`,
  );
});
