import type { Metadata } from "next";
import { AdminBoard, type MemberRow } from "./AdminBoard";
import { Shell } from "@/components/Shell";
import { requireAdmin } from "@/lib/session";
import { createServiceClient, createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Members | Proof of concept" };

export const dynamic = "force-dynamic";

type Row = Omit<MemberRow, "passkeys" | "link_state"> & { link_state: string };

// How many passkeys a member has saved, from the auth service's admin API. Shown so a tester can see an enrolment
// really landed. A failed lookup is shown as "unknown", never as zero.
async function passkeyCount(service: ReturnType<typeof createServiceClient>, userId: string): Promise<number | null> {
  try {
    const { data, error } = await service.auth.admin.passkey.listPasskeys({ userId });
    return error || !Array.isArray(data) ? null : data.length;
  } catch {
    return null;
  }
}

const STATES = new Set(["none", "pending", "used", "expired"]);

export default async function AdminPage() {
  await requireAdmin(); // the database decides; a non-admin is sent back to /home

  // The list itself is admin-only inside the database (list_members raises for anyone else).
  const { data, error } = await (await createUserClient()).rpc("list_members");
  if (error || !Array.isArray(data)) {
    return (
      <Shell signedIn isAdmin>
        <div className="card">
          <h1>Members</h1>
          <p role="alert" className="feedback__error">
            The member list is unavailable right now. Please try again in a moment.
          </p>
        </div>
      </Shell>
    );
  }

  const service = createServiceClient();
  const rows = data as Row[];
  const counts = await Promise.all(rows.map((r) => passkeyCount(service, r.user_id)));
  const members: MemberRow[] = rows.map((r, i) => ({
    ...r,
    link_state: STATES.has(r.link_state) ? (r.link_state as MemberRow["link_state"]) : "none",
    passkeys: counts[i] ?? null,
  }));

  return (
    <Shell signedIn isAdmin>
      <h1>Members</h1>
      <p className="lede">Add a person, copy their one-time setup link, and send it to them yourself.</p>
      <AdminBoard members={members} />
    </Shell>
  );
}
