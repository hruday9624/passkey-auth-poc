import { redirect } from "next/navigation";
import { PasskeySignInButton } from "./PasskeySignInButton";
import { Shell } from "@/components/Shell";
import { getMember, getPasskeyUser } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  denied: "That passkey is not allowed in here. Ask your admin.",
  unavailable: "The service is unavailable right now. Please try again in a moment.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;

  // Already signed in with a passkey and a member: go straight in.
  const client = await createUserClient();
  if (await getPasskeyUser(client)) {
    const result = await getMember(client);
    if (result.status === "ok") redirect("/home");
  }

  const message = typeof e === "string" ? MESSAGES[e] : undefined;

  return (
    <Shell narrow>
      <div className="card">
        <h1>Sign in</h1>
        <p className="lede">Use the passkey on this device. Your phone or computer will ask for your face, fingerprint or screen lock.</p>
        <PasskeySignInButton />
        {message && (
          <p role="alert" className="feedback__error">
            {message}
          </p>
        )}
        <p className="note">New here? Your admin sends you a one-time setup link. Open it in Safari or Chrome.</p>
      </div>
    </Shell>
  );
}
