import { Shell } from "@/components/Shell";
import { requireMember } from "@/lib/session";

export const dynamic = "force-dynamic";

// The placeholder protected page. It stands in for the app's real content: what matters is that it opens only
// for a verified PASSKEY session of a member, checked here and not just by a redirect from elsewhere.
export default async function HomePage() {
  const member = await requireMember();
  return (
    <Shell signedIn isAdmin={member.isAdmin}>
      <div className="card">
        <h1>You are signed in</h1>
        <p className="lede">
          Welcome, <strong>{member.displayName}</strong> ({member.email}). You got here with a passkey, and the server checked that.
        </p>
        <p className="note">This page is a placeholder for the real app. Nothing else is behind it.</p>
      </div>
    </Shell>
  );
}
