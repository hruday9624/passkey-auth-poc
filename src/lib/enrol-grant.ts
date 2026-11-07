import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "./env";
import { GRANT_COOKIE, isGranted } from "./grant";
import { createUserClient } from "./supabase/server";

/**
 * Does this signed-in session hold the grant set when a setup link was spent, naming THIS person? No session, a
 * failed token check or a grant for someone else all read as "no". Kept out of the "use server" file on purpose:
 * everything exported from there becomes a public endpoint.
 */
export async function hasGrant(): Promise<boolean> {
  const grant = (await cookies()).get(GRANT_COOKIE)?.value;
  const { data, error } = await (await createUserClient()).auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return false;
  return isGranted(grant, sub, getEnv().SESSION_COOKIE_SECRET);
}
