import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// "An admin's setup link was spent for THIS person a moment ago." Set when a member presses Continue on a valid
// link, and read by the setup step before it opens the device prompt. It is signed, names the person, and
// expires after five minutes, so a visitor cannot forge one or lend one to another account.
//
// Honest limit: the browser talks to Supabase directly with the member's own token, so this guards the INTERFACE
// (the page and a casual user of a left-open browser), not someone who already holds the token and calls the
// auth service by hand. How the session began (`amr` = otp) is deliberately NOT used as the approval: the auth
// service also makes one-time sessions for its own email flows.
export const GRANT_COOKIE = "poc_grant";
export const GRANT_TTL_SECONDS = 5 * 60;

type Payload = { u: string; exp: number };

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`grant:${body}`, "utf8").digest("base64url");
}

export function createGrantToken(userId: string, secret: string, now: number = Date.now()): string {
  const payload: Payload = { u: userId, exp: Math.floor(now / 1000) + GRANT_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** True only for a genuine, unexpired grant issued to this same person. */
export function isGranted(token: string | undefined, userId: string, secret: string, now: number = Date.now()): boolean {
  if (!token || token.length > 512 || !userId) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [body, mac] = parts as [string, string];

  const expected = Buffer.from(sign(body, secret), "utf8");
  const given = Buffer.from(mac, "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;

  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Payload>;
    return p.u === userId && typeof p.exp === "number" && p.exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

export const grantCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: GRANT_TTL_SECONDS,
} as const;
