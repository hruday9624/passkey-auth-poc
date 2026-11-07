import "server-only";
import { headers } from "next/headers";

/**
 * https://host for the link the admin copies. A passkey belongs to ONE site address, so the link must point at
 * the production address even if the admin happens to be on another alias of the same project. Vercel provides
 * that address as VERCEL_PROJECT_PRODUCTION_URL; with none (local development) the request's own host is used.
 * Only ever shown to the admin.
 */
export async function originOf(): Promise<string> {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production && /^[a-z0-9.-]+$/i.test(production)) return `https://${production}`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Browsers always send Origin on cross-site POSTs and scripts cannot remove it. A present, different origin is
 * rejected; an absent one (curl, tests, same-origin navigation) is allowed because it cannot come from a
 * cross-site page.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
