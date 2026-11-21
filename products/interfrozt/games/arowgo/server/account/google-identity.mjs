import { OAuth2Client } from "google-auth-library";
import { AuthError } from "./service.mjs";

export function googleIdentityVerifier(audience, client = new OAuth2Client()) {
  return async (idToken, nonce) => {
    let timer;
    try {
      const ticket = await Promise.race([
        client.verifyIdToken({ idToken, audience }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new AuthError(504, "google-verification-timeout")),
            8000,
          );
        }),
      ]);
      const payload = ticket.getPayload();
      if (
        !payload ||
        payload.aud !== audience ||
        !["accounts.google.com", "https://accounts.google.com"].includes(
          payload.iss,
        ) ||
        !payload.sub ||
        payload.nonce !== nonce ||
        !payload.exp ||
        payload.exp <= Date.now() / 1000
      )
        throw new AuthError(401, "google-token-rejected");
      return { subject: payload.sub };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(401, "google-token-rejected");
    } finally {
      clearTimeout(timer);
    }
  };
}
