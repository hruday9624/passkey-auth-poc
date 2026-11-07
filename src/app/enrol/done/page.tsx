import Link from "next/link";
import type { Metadata } from "next";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "Passkey saved | Proof of concept" };

// Static on purpose: it reads no session and says the same to everyone who arrives.
export default function EnrolDonePage() {
  return (
    <Shell narrow>
      <div className="card">
        <h1>Passkey saved</h1>
        <p className="lede">Now sign in with it. That confirms it works.</p>
        <Link href="/" className="btn btn--primary">
          Go to sign in
        </Link>
      </div>
    </Shell>
  );
}
