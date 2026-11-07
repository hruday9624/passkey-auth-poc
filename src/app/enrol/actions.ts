"use server";

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { getEnv } from "@/lib/env";
import { hasGrant } from "@/lib/enrol-grant";
import { createGrantToken, GRANT_COOKIE, grantCookieOptions } from "@/lib/grant";
import { hashToken, parseToken } from "@/lib/tokens";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";

export type EnrolState = { error: string | null };

const EXPIRED = "This link has expired or was already used. Ask your admin for a new one.";
const UNAVAILABLE = "The service is unavailable right now. Please try again in a moment.";
// Once the link has been spent, a failure cannot be retried with the same link, so the message must not say "try again".
const SPENT = "Something went wrong and this link was used up. Ask your admin for a new one.";

/**
 * The member pressed Continue on the setup page. Only now is the link spent (a plain visit changes nothing, so
 * a chat app that fetches the link to build a preview cannot use it up).
 *
 * The link carries OUR token, and our own database row is the only thing standing behind it: right person, not
 * expired, not used, still a member, spent atomically. Only then does this server ask the auth service for a
 * one-time sign-in token for that person and exchange it for a session straight away. That token is never in an
 * address or on a screen, so it cannot be used to go round the row's expiry or single use.
 *
 * The admin's approval is then recorded as the signed grant cookie. The session this makes reads `otp`, which
 * the protected pages refuse: it can do one thing, register a passkey.
 */
export async function consumeLinkAction(_prev: EnrolState, formData: FormData): Promise<EnrolState> {
  const token = parseToken(formData.get("t"));
  if (token === null) return { error: EXPIRED };

  try {
    const env = getEnv();
    const service = createServiceClient();
    const { data: userId, error } = await service.rpc("consume_setup_link", { p_hmac: hashToken(token, env.TOKEN_PEPPER) });
    if (error) return { error: UNAVAILABLE };
    if (typeof userId !== "string") return { error: EXPIRED };

    const supabase = await createUserClient();
    const failed = async (): Promise<EnrolState> => {
      await supabase.auth.signOut({ scope: "local" }); // never leave a session for the wrong person
      return { error: SPENT };
    };

    const account = await service.auth.admin.getUserById(userId);
    const email = account.data?.user?.email;
    if (account.error || !email) return { error: SPENT };

    const minted = await service.auth.admin.generateLink({ type: "magiclink", email });
    const hashed = minted.data?.properties?.hashed_token;
    if (minted.error || !hashed || minted.data.user?.id !== userId) return { error: SPENT };

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: hashed,
      type: minted.data.properties.verification_type as "magiclink",
    });
    if (verifyError || data.user?.id !== userId) return failed();

    (await cookies()).set(GRANT_COOKIE, createGrantToken(userId, env.SESSION_COOKIE_SECRET), grantCookieOptions);
  } catch (e) {
    unstable_rethrow(e);
    return { error: UNAVAILABLE };
  }
  redirect("/enrol/passkey");
}

/**
 * Asked by the setup step just before it opens the device prompt. It needs the grant set when the link was
 * spent; anything else (an old session, a password sign-in, an email sign-in the auth service made on its own)
 * is turned away. This guards the interface; see the honest limit in lib/grant.ts.
 */
export async function ensureEnrolAllowedAction(): Promise<{ ok: boolean }> {
  return { ok: await hasGrant() };
}

/**
 * The setup step finished in the browser. Confirms the member really has a passkey now, ends THIS session only,
 * clears the grant, and sends them to the sign-in page, where signing in with the passkey proves it works.
 */
export async function finishEnrolAction(): Promise<EnrolState> {
  try {
    const supabase = await createUserClient();
    const { data, error } = await supabase.auth.passkey.list();
    if (error) return { error: UNAVAILABLE };
    if (!Array.isArray(data) || data.length === 0) return { error: "No passkey was saved. Please try again." };
    await supabase.auth.signOut({ scope: "local" });
    (await cookies()).delete(GRANT_COOKIE);
  } catch (e) {
    unstable_rethrow(e);
    return { error: UNAVAILABLE };
  }
  redirect("/enrol/done");
}
