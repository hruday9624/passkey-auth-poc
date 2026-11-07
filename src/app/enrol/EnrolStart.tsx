"use client";

import { useActionState } from "react";
import { consumeLinkAction, type EnrolState } from "./actions";

const initial: EnrolState = { error: null };

// The Continue button of the setup page. The link's token travels in a hidden field of this form, so pressing the
// button (a POST) is what uses the link up, never merely opening it.
export function EnrolStart({ token }: { token: string }) {
  const [state, action, pending] = useActionState(consumeLinkAction, initial);
  return (
    <form action={action} aria-busy={pending}>
      <input type="hidden" name="t" value={token} />
      <button type="submit" disabled={pending} className="btn btn--primary">
        {pending ? "Checking..." : "Continue"}
      </button>
      <div className="feedback">
        {state.error && (
          <p role="alert" className="feedback__error">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
