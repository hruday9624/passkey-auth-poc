import type { Metadata } from "next";
import { EnrolPasskey } from "./EnrolPasskey";
import { Shell } from "@/components/Shell";
import { hasGrant } from "@/lib/enrol-grant";

export const metadata: Metadata = { title: "Set up a passkey | Proof of concept" };

export const dynamic = "force-dynamic";

// The setup step. Reachable only with the grant set when the member presses Continue and spends the link. Anyone
// else sees the same plain message, so the page says nothing about whether an account or a link exists.
export default async function EnrolPasskeyPage() {
  const allowed = await hasGrant();
  return (
    <Shell narrow>
      <div className="card">
        <h1>Set up a passkey</h1>
        {allowed ? (
          <>
            <p className="lede">Press the button, then approve with your face or fingerprint when your device asks.</p>
            <EnrolPasskey />
          </>
        ) : (
          <p className="lede">This setup has run out of time. Ask your admin for a new link.</p>
        )}
      </div>
    </Shell>
  );
}
