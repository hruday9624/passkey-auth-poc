import "server-only";
import { redirect } from "next/navigation";
import { hasPasskeyMethod } from "./amr";
import { createUserClient } from "./supabase/server";

type UserClient = Awaited<ReturnType<typeof createUserClient>>;

export type SignedIn = { id: string; email: string | null };
export type Member = { displayName: string; email: string; isAdmin: boolean };

/**
 * The verified user id of a PASSKEY session, or null. getClaims() verifies the token (signature, expiry); a
 * forged or expired cookie gives null. getSession() must never be used for this on the server. A session made
 * by a password or a one-time link (the setup link) reads null here.
 */
export async function getPasskeyUser(client?: UserClient): Promise<SignedIn | null> {
  const supabase = client ?? (await createUserClient());
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  if (!hasPasskeyMethod(claims.amr)) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

/**
 * The signed-in user's member row, decided by the DATABASE from the verified token (current_member reads
 * auth.uid()), never from anything this code passes in. "none": signed in but not a member. "error": the check
 * itself failed (an outage is never read as a denial or as an approval).
 */
export async function getMember(client: UserClient): Promise<{ status: "ok"; member: Member } | { status: "none" } | { status: "error" }> {
  const { data, error } = await client.rpc("current_member");
  if (error) return { status: "error" };
  const row = Array.isArray(data) ? (data[0] as { display_name?: unknown; email?: unknown; is_admin?: unknown } | undefined) : undefined;
  if (!row || typeof row.display_name !== "string" || typeof row.email !== "string") return { status: "none" };
  return { status: "ok", member: { displayName: row.display_name, email: row.email, isAdmin: row.is_admin === true } };
}

/**
 * Call at the top of EVERY protected page and server operation. A redirect to these pages is not
 * authorization; each page must check for itself.
 */
export async function requireMember(): Promise<Member> {
  const client = await createUserClient();
  if (!(await getPasskeyUser(client))) redirect("/");
  const result = await getMember(client);
  if (result.status === "error") redirect("/?e=unavailable");
  if (result.status === "none") redirect("/?e=denied");
  return result.member;
}

/** Members who are admins, checked by the database. Everyone else goes back to the member page. */
export async function requireAdmin(): Promise<Member & { id: string }> {
  const client = await createUserClient();
  const user = await getPasskeyUser(client);
  if (!user) redirect("/");
  const result = await getMember(client);
  if (result.status === "error") redirect("/?e=unavailable");
  if (result.status === "none") redirect("/?e=denied");
  if (!result.member.isAdmin) redirect("/home");
  return { ...result.member, id: user.id };
}
