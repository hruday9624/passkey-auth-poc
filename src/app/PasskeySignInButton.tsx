"use client";

import { useRef, useState, useTransition } from "react";
import { finishSignInAction } from "./actions";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

const FAILED = "Passkey sign-in did not go through. Try again, or ask your admin for a new setup link.";

// The sign-in button. The WebAuthn ceremony runs entirely in the browser through the SDK: success means a real
// credential was verified by Supabase and the session cookies are in place. Only then is the server asked to
// finish, and the server re-checks everything itself. A cancelled picker (NotAllowedError) is silent; every
// other failure shows a message and the button stays usable. No email is typed (discoverable credentials).
export function PasskeySignInButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fired = useRef(false);

  async function signIn() {
    setError(null);
    if (pending || fired.current) return;
    fired.current = true;
    let finished = false;
    try {
      const { error: e } = await getSupabaseBrowser().auth.signInWithPasskey();
      if (e) {
        if (e.name !== "NotAllowedError") setError(FAILED);
        return;
      }
      finished = true;
    } catch {
      setError(FAILED);
      return;
    } finally {
      if (!finished) fired.current = false;
    }
    start(() => {
      void finishSignInAction().then((state) => {
        // The successful path redirects; what comes back is only a failure.
        if (state?.error) setError(state.error);
        fired.current = false;
      });
    });
  }

  return (
    <div>
      <button type="button" onClick={() => void signIn()} disabled={pending} className="btn btn--primary">
        {pending ? "Signing in..." : "Sign in with a passkey"}
      </button>
      <div className="feedback">
        {error && (
          <p role="alert" className="feedback__error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
