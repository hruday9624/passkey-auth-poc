import { createHmac, randomBytes } from "node:crypto";

// The setup-link token: OUR OWN random secret (256 bits, 43 characters of base64url). Only a keyed hash is stored,
// never the token. The auth service's own sign-in token is made on the server at the moment the member presses
// Continue and is never in an address or on a screen, so it cannot be used to go round the link's expiry,
// single use or the database row behind it.
//
// Dependency-free on purpose, so scripts/token-hash.mjs can share the same formula and a test can pin them together.

/** How long an issued link stays valid. The database also bounds this to 1 to 60 minutes. */
export const LINK_TTL_SECONDS = 15 * 60;

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,200}$/;

/** A fresh token. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The token from the address, or null when it cannot be one of our links. */
export function parseToken(t: unknown): string | null {
  return typeof t === "string" && TOKEN_SHAPE.test(t) ? t : null;
}

/** Keyed hash of a token, hex, 64 characters. The prefix keeps it distinct from any other hash made with the same pepper. */
export function hashToken(token: string, pepper: string): string {
  return createHmac("sha256", pepper).update(`setup-link:${token}`, "utf8").digest("hex");
}
