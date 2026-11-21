import { it, expect } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { googleIdentityVerifier } from "../server/account/google-identity.mjs";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const certs = { test: publicKey.export({ type: "spki", format: "pem" }) };
const client = new OAuth2Client();
const adapter = {
  verifyIdToken: async ({ idToken, audience }) =>
    client.verifySignedJwtWithCertsAsync(idToken, certs, audience, [
      "accounts.google.com",
      "https://accounts.google.com",
    ]),
};
function jwt(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: "expected-client",
      sub: "google-subject",
      nonce: "flow-nonce",
      iat: now,
      exp: now + 3600,
      ...overrides,
    }),
  ).toString("base64url");
  const input = header + "." + payload;
  return (
    input +
    "." +
    createSign("RSA-SHA256").update(input).sign(privateKey, "base64url")
  );
}
it("verifies a signed token and returns only its subject", async () => {
  expect(
    await googleIdentityVerifier("expected-client", adapter)(
      jwt(),
      "flow-nonce",
    ),
  ).toEqual({ subject: "google-subject" });
});
it.each([
  { aud: "other-client" },
  { iss: "https://attacker.invalid" },
  { exp: 1 },
  { nonce: "wrong" },
  { sub: "" },
])("rejects invalid identity claims %j", async (claims) => {
  await expect(
    googleIdentityVerifier("expected-client", adapter)(
      jwt(claims),
      "flow-nonce",
    ),
  ).rejects.toThrow("google-token-rejected");
});
it("rejects a forged signature", async () => {
  const value = jwt().split(".");
  value[2] = Buffer.alloc(256).toString("base64url");
  await expect(
    googleIdentityVerifier("expected-client", adapter)(
      value.join("."),
      "flow-nonce",
    ),
  ).rejects.toThrow("google-token-rejected");
});
