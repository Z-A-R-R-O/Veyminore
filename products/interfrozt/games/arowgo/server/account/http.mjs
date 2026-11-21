import { createServer } from "node:http";
import { AuthError } from "./service.mjs";

export function createAccountServer({
  service,
  origin = "http://localhost:4173",
  allowedOrigins,
  allowedHosts,
  rateLimiter,
  cookieName = "arowgo_dev_session",
  isProduction = false,
}) {
  const originsList = allowedOrigins ?? [origin];
  if (!isProduction && !allowedOrigins && origin !== "http://localhost:4173") {
    throw new Error("This development server only supports localhost:4173");
  }

  const validOrigins = new Set(originsList);
  const validHosts = new Set(
    allowedHosts ?? [
      "localhost:4173",
      ...originsList.map((o) => {
        try {
          return new URL(o).host;
        } catch {
          return "";
        }
      }).filter(Boolean),
    ],
  );

  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/json");

    function send(status, data, id) {
      if (id) {
        const secureFlag = isProduction || origin.startsWith("https://") ? "; Secure" : "";
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/api/arowgo/v1/account; Max-Age=3600${secureFlag}`,
        );
      }
      res.writeHead(status);
      res.end(JSON.stringify(data));
    }

    try {
      const path = req.url;

      // 1. Unauthenticated Health Probe (Container/LB liveness & readiness check)
      if (req.method === "GET" && path === "/api/arowgo/v1/health") {
        return send(200, {
          status: "ok",
          service: "arowgo-account",
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime()),
          economy: service.isEconomyEnabled ? service.isEconomyEnabled() : false,
        });
      }

      // 2. Sliding window rate limiter check
      if (rateLimiter) {
        const clientIp =
          req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
          req.socket.remoteAddress ||
          "127.0.0.1";
        const rateCheck = rateLimiter.check(clientIp);
        if (!rateCheck.allowed) {
          res.setHeader("Retry-After", String(rateCheck.retryAfter));
          return send(429, {
            error: "rate-limited",
            retryAfter: rateCheck.retryAfter,
          });
        }
      }

      // 3. Host and Origin verification (reject DNS rebinding and cross-site callers)
      if (
        (req.headers.host && !validHosts.has(req.headers.host)) ||
        (req.headers.origin && !validOrigins.has(req.headers.origin))
      ) {
        throw new AuthError(403, "forbidden");
      }

      const id = (req.headers.cookie ?? "")
        .split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1);

      if (req.method === "GET" && path === "/api/arowgo/v1/account/session") {
        const result = service.bootstrap(id);
        return send(200, result.data, result.id);
      }

      if (req.method !== "POST") throw new AuthError(404, "not-found");
      if (
        (req.headers.origin && !validOrigins.has(req.headers.origin)) ||
        req.headers["content-type"]?.split(";")[0] !== "application/json"
      ) {
        throw new AuthError(403, "forbidden");
      }

      let raw = "";
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > (path === "/api/arowgo/v1/account/cloud" ? 600000 : 16000))
          throw new AuthError(413, "too-large");
        raw += chunk.toString();
      }

      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new AuthError(400, "invalid-request");
      }

      const csrf = req.headers["x-csrf-token"];
      if (path === "/api/arowgo/v1/account/economy")
        return send(200, service.economyCommand(id, csrf, body));
      if (path === "/api/arowgo/v1/account/cloud-probe")
        return send(200, await service.probe(id, csrf));
      if (path === "/api/arowgo/v1/account/cloud")
        return send(200, await service.sync(id, csrf, body));
      if (path === "/api/arowgo/v1/account/google/flow")
        return send(200, service.flow(id, csrf, body?.intent));

      let result;
      if (path === "/api/arowgo/v1/account/logout")
        result = service.logout(id, csrf);
      else if (
        path === "/api/arowgo/v1/account/google/sign-in" ||
        path === "/api/arowgo/v1/account/google/link"
      )
        result = await service.google(
          id,
          csrf,
          path.endsWith("/link") ? "link" : "sign-in",
          body,
        );
      else throw new AuthError(404, "not-found");

      send(200, result.data, result.id);
    } catch (error) {
      send(error instanceof AuthError ? error.status : 500, {
        error: error instanceof AuthError ? error.message : "unavailable",
      });
    }
  });
}
