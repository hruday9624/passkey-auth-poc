import type { Metadata } from "next";
import { EnrolStart } from "./EnrolStart";
import { Shell } from "@/components/Shell";
import { parseToken } from "@/lib/tokens";

export const metadata: Metadata = { title: "Set up a passkey | Proof of concept" };

export const dynamic = "force-dynamic";

// What the admin's link opens. A plain visit changes NOTHING: chat apps and mail scanners fetch links to build
// previews, and a link used up by a preview would be dead before the person saw it. The link is spent only
// when the person presses Continue (EnrolStart, a POST).
export default async function EnrolPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const token = parseToken(t);

  if (token === null) {
    return (
      <Shell narrow>
        <div className="card">
          <h1>Set up a passkey</h1>
          <p className="lede">This link cannot be used. Ask your admin for a new one.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell narrow>
      <div className="card">
        <h1>Set up a passkey</h1>
        <p className="lede">A passkey lets you sign in with your face or fingerprint instead of a password. It takes about a minute.</p>
        <ol className="steps">
          <li>
            <strong>Open this page in Safari or Chrome.</strong> If you are reading it inside WhatsApp or an email app, tap the menu and choose
            &quot;Open in browser&quot;, because those apps often cannot create a passkey.
          </li>
          <li>Press Continue, then Set up a passkey, and approve with your face or fingerprint.</li>
          <li>
            <strong>Keep iCloud Keychain (iPhone) or Google sync (Android) turned on,</strong> so your passkey comes back if you change phones.
          </li>
        </ol>
        <p className="note">This link works once and runs out in 15 minutes.</p>
        <EnrolStart token={token} />
      </div>
    </Shell>
  );
}
