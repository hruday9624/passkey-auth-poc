// The same formula as src/lib/tokens.ts (hashToken). A test pins the two together, so a link made by the
// script is accepted by the app.
import { createHmac, randomBytes } from "node:crypto";

export const LINK_TTL_SECONDS = 15 * 60;

export function generateToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token, pepper) {
  return createHmac("sha256", pepper).update(`setup-link:${token}`, "utf8").digest("hex");
}
