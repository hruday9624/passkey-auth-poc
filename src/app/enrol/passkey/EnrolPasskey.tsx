"use client";

import { useState, useTransition } from "react";
import { ensureEnrolAllowedAction, finishEnrolAction } from "../actions";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

const FAILED = "Setting up the passkey did not go through. Please try again.";
const EXPIRED = "This setup has run out of time. Ask your admin for a new link.";

// The device prompt. The ceremony runs entirely in the browser through the SDK (the passkey never leaves the
// device); the server is asked first whether this session may do it, and told afterwards so it can check a
// passkey really exists and end this session.
export function EnrolPasskey() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function setup() {
    setMessage(null);
    start(async () => {
      try {
        const { ok } = await ensureEnrolAllowedAction();
        if (!ok) {
          setMessage(EXPIRED);
          return;
        }
        const { error } = await getSupabaseBrowser().auth.registerPasskey();
        if (error) {
          // A closed or cancelled prompt is a plain "no", not a failure to report.
          setMessage(error.name === "NotAllowedError" ? null : FAILED);
          return;
        }
        const result = await finishEnrolAction(); // redirects on success
        if (result?.error) setMessage(result.error);
      } catch {
        setMessage(FAILED);
      }
    });
  }

  return (
    <div>
      <button type="button" onClick={setup} disabled={pending} className="btn btn--primary">
        {pending ? "Working..." : "Set up a passkey"}
      </button>
      <div className="feedback">
        {message && (
          <p role="alert" className="feedback__error">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
