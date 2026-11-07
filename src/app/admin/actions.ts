"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { originOf } from "@/lib/origin";
import { requireAdmin } from "@/lib/session";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";
import { generateToken, hashToken, LINK_TTL_SECONDS } from "@/lib/tokens";

export type IssuedLink = { name: string; email: string; link: string; expiresAt: string };
export type AdminState = { error: string | null; issued: IssuedLink | null };

const UNAVAILABLE = "The service is unavailable right now. Please try again in a moment.";
const BAD_FORM = "Check the form and try again.";

const email = z.email().max(254);
const name = z.string().min(1).max(80);
const userId = z.uuid();

type Service = ReturnType<typeof createServiceClient>;

/**
 * Makes one link for a member. The token is random, only its keyed hash is stored, and the database checks
 * again that the acting admin really is an admin. The link exists on screen once and nowhere else.
 */
async function issue(service: Service, actorId: string, memberId: string, person: { name: string; email: string }): Promise<IssuedLink | null> {
  const token = generateToken();
  const { data, error } = await service.rpc("issue_setup_link", {
    p_actor: actorId,
    p_user_id: memberId,
    p_hmac: hashToken(token, getEnv().TOKEN_PEPPER),
    p_ttl_seconds: LINK_TTL_SECONDS,
  });
  if (error || typeof data !== "string") return null;
  return { ...person, link: `${await originOf()}/enrol?t=${token}`, expiresAt: data };
}

/**
 * Both admin buttons (add a member, new link for a member) come through here. The FIRST line decides who is
 * asking: requireAdmin() needs a verified PASSKEY session whose user the database says is an admin. Hiding the
 * page is not the check. The acting admin's id then goes to the database functions, which check it again.
 */
export async function adminAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const admin = await requireAdmin();
  const intent = formData.get("intent");

  try {
    const service = createServiceClient();

    if (intent === "add") {
      const e = email.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
      const n = name.safeParse(String(formData.get("name") ?? "").trim());
      if (!e.success || !n.success) return { error: BAD_FORM, issued: null };

      // The account has a random password that nobody ever sees: passkeys are the only way in. (A known
      // password could still make a session through the auth service; the protected pages refuse it anyway.)
      const created = await service.auth.admin.createUser({ email: e.data, password: randomBytes(32).toString("base64url"), email_confirm: true });
      const newId = created.data?.user?.id;
      if (created.error || !newId) return { error: "That email could not be added. It may already be in use.", issued: null };

      const added = await service.rpc("admin_add_member", { p_actor: admin.id, p_user_id: newId, p_name: n.data });
      if (added.error) {
        await service.auth.admin.deleteUser(newId); // no half-made account
        return { error: "That email could not be added. It may already be in use.", issued: null };
      }

      revalidatePath("/admin");
      const issued = await issue(service, admin.id, newId, { name: n.data, email: e.data });
      if (!issued) return { error: "The member was added, but the link could not be made. Use New link on their row.", issued: null };
      return { error: null, issued };
    }

    if (intent === "link") {
      const id = userId.safeParse(formData.get("userId"));
      if (!id.success) return { error: BAD_FORM, issued: null };

      // Who the member is comes from the database (the admin-only list), not from the form.
      const list = await (await createUserClient()).rpc("list_members");
      if (list.error || !Array.isArray(list.data)) return { error: UNAVAILABLE, issued: null };
      const row = (list.data as { user_id: string; email: string; display_name: string }[]).find((m) => m.user_id === id.data);
      if (!row) return { error: BAD_FORM, issued: null };

      const issued = await issue(service, admin.id, id.data, { name: row.display_name, email: row.email });
      revalidatePath("/admin");
      if (!issued) return { error: UNAVAILABLE, issued: null };
      return { error: null, issued };
    }

    return { error: BAD_FORM, issued: null };
  } catch (err) {
    unstable_rethrow(err);
    return { error: UNAVAILABLE, issued: null };
  }
}
