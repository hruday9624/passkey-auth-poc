"use client";

import { useActionState, useRef, useState } from "react";
import { adminAction, type AdminState } from "./actions";

export type MemberRow = {
  user_id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  link_state: "none" | "pending" | "used" | "expired";
  link_expires_at: string | null;
  passkeys: number | null;
};

const initial: AdminState = { error: null, issued: null };

const LINK_LABEL: Record<MemberRow["link_state"], string> = {
  none: "No link yet",
  pending: "Link waiting",
  used: "Link used",
  expired: "Link expired",
};

// One action hook for both buttons, so the link panel below always shows the latest result. The link is on
// screen once: it is not stored anywhere, and a page reload makes it disappear (issue a new one if needed).
export function AdminBoard({ members }: { members: MemberRow[] }) {
  const [state, action, pending] = useActionState(adminAction, initial);
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false); // The link is selectable on screen, so it can still be copied by hand.
    }
  }

  return (
    <div className="stack">
      <section className="card" aria-labelledby="add-title">
        <h2 id="add-title">Add a member</h2>
        <form
          ref={formRef}
          action={(fd) => {
            fd.set("intent", "add");
            action(fd);
          }}
          aria-busy={pending}
        >
          <label className="field">
            <span>Name</span>
            <input type="text" name="name" required maxLength={80} autoComplete="off" />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" name="email" required maxLength={254} autoComplete="off" />
          </label>
          <button type="submit" disabled={pending} className="btn btn--primary">
            {pending ? "Working..." : "Add member and make a link"}
          </button>
        </form>
        <div className="feedback" aria-live="polite">
          {state.error && (
            <p role="alert" className="feedback__error">
              {state.error}
            </p>
          )}
        </div>

        {state.issued && (
          <div className="linkbox" role="status">
            <strong>
              Setup link for {state.issued.name} ({state.issued.email})
            </strong>
            <code className="linkbox__url">{state.issued.link}</code>
            <button type="button" className="btn btn--primary btn--small" onClick={() => void copy(state.issued!.link)}>
              {copied ? "Copied" : "Copy link"}
            </button>
            <p className="note">
              Send it to them yourself. It works once and runs out at {new Date(state.issued.expiresAt).toLocaleTimeString()}. It will not be shown
              again after you leave this page.
            </p>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="members-title">
        <h2 id="members-title">Members ({members.length})</h2>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Setup link</th>
              <th scope="col">Passkeys</th>
              <th scope="col">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td>
                  {m.display_name} {m.is_admin && <span className="badge">admin</span>}
                </td>
                <td>{m.email}</td>
                <td>
                  <span className={`badge${m.link_state === "used" ? " badge--ok" : m.link_state === "expired" ? " badge--warn" : ""}`}>
                    {LINK_LABEL[m.link_state]}
                  </span>
                </td>
                <td>{m.passkeys === null ? "unknown" : m.passkeys}</td>
                <td>
                  <form
                    action={(fd) => {
                      fd.set("intent", "link");
                      fd.set("userId", m.user_id);
                      action(fd);
                    }}
                  >
                    <button type="submit" disabled={pending} className="btn btn--small">
                      New link
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
