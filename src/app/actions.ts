"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { getMember, getPasskeyUser } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";

export type SignInState = { error: string | null };

const FAILED = "Sign-in did not go through. Try again, or ask your admin for a new setup link.";

/**
 * Called by the browser AFTER the passkey ceremony succeeded (Supabase verified a real credential and the
 * session cookies are in place). This is where the server decides for itself: the session must be a passkey
 * session AND the database must say the person is a member. Anything else ends the session and says "denied".
 */
export async function finishSignInAction(): Promise<SignInState> {
  try {
    const client = await createUserClient();
    if (!(await getPasskeyUser(client))) {
      await client.auth.signOut({ scope: "local" });
      return { error: FAILED };
    }
    const result = await getMember(client);
    if (result.status === "error") return { error: "The service is unavailable right now. Please try again in a moment." };
    if (result.status === "none") {
      await client.auth.signOut({ scope: "local" });
      redirect("/?e=denied");
    }
  } catch (e) {
    unstable_rethrow(e);
    return { error: FAILED };
  }
  redirect("/home");
}
