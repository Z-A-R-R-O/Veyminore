import { createServer } from "node:http";
import { AuthError } from "./service.mjs";

export function createAccountServer({
  service,
  origin = "http://localhost:4173",
}) {
  if (origin !== "http://localhost:4173")
    throw new Error("This development server only supports localhost:4173");
  const cookieName = "arowgo_dev_session";
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/json");
    function send(status, data, id) {
      if (id)
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/api/arowgo/v1/account; Max-Age=3600`,
        );
      res.writeHead(status);
      res.end(JSON.stringify(data));
    }
    try {
      // Vite preserves Host. Reject DNS rebinding and unexpected direct callers.
      if (
        req.headers.host !== "localhost:4173" ||
        (req.headers.origin && req.headers.origin !== origin)
      )
        throw new AuthError(403, "forbidden");
      const path = req.url;
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
        req.headers.origin !== origin ||
        req.headers["content-type"]?.split(";")[0] !== "application/json"
      )
        throw new AuthError(403, "forbidden");
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
