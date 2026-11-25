"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { provisionPasskeyUser } from "@/lib/provision";
import { requireAdmin } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";

export type IssuedLink = { name: string; email: string; link: string; expiresAt: string };
export type AdminState = { error: string | null; issued: IssuedLink | null };

const UNAVAILABLE = "The service is unavailable right now. Please try again in a moment.";
const BAD_FORM = "Check the form and try again.";

const email = z.email().max(254);
const name = z.string().min(1).max(80);
const userId = z.uuid();

async function runProvision(actorId: string, targetEmail: string, targetName: string): Promise<AdminState> {
  const result = await provisionPasskeyUser({
    email: targetEmail,
    displayName: targetName,
    eventSource: "admin",
    idempotencyKey: `admin:${randomUUID()}`,
    issuedBy: actorId,
  });

  revalidatePath("/admin");

  if (result.status === "failed") {
    return { error: result.error, issued: null };
  }
  if (result.status === "already_processed") {
    return { error: UNAVAILABLE, issued: null };
  }

  return {
    error: null,
    issued: {
      name: targetName,
      email: targetEmail,
      link: result.setupUrl,
      expiresAt: result.expiresAt,
    },
  };
}

/**
 * Both admin buttons (add a member, new link for a member) come through here. The FIRST line decides who is
 * asking: requireAdmin() needs a verified PASSKEY session whose user the database says is an admin.
 */
export async function adminAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const admin = await requireAdmin();
  const intent = formData.get("intent");

  try {
    if (intent === "add") {
      const e = email.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
      const n = name.safeParse(String(formData.get("name") ?? "").trim());
      if (!e.success || !n.success) return { error: BAD_FORM, issued: null };

      return await runProvision(admin.id, e.data, n.data);
    }

    if (intent === "link") {
      const id = userId.safeParse(formData.get("userId"));
      if (!id.success) return { error: BAD_FORM, issued: null };

      // Who the member is comes from the database (the admin-only list), not from the form.
      const list = await (await createUserClient()).rpc("list_members");
      if (list.error || !Array.isArray(list.data)) return { error: UNAVAILABLE, issued: null };
      const row = (list.data as { user_id: string; email: string; display_name: string }[]).find((m) => m.user_id === id.data);
      if (!row) return { error: BAD_FORM, issued: null };

      return await runProvision(admin.id, row.email, row.display_name);
    }

    return { error: BAD_FORM, issued: null };
  } catch (err) {
    unstable_rethrow(err);
    return { error: UNAVAILABLE, issued: null };
  }
}
