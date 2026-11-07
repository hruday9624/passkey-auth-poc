import Link from "next/link";

// The page frame. `signedIn` shows the navigation and the sign-out button; the sign-out is a plain POST form,
// so it works without script and the same-origin check on the route applies.
export function Shell({
  children,
  narrow = false,
  signedIn = false,
  isAdmin = false,
}: {
  children: React.ReactNode;
  narrow?: boolean;
  signedIn?: boolean;
  isAdmin?: boolean;
}) {
  return (
    <div className="shell">
      <header className="topbar">
        <span className="topbar__name">Passkey sign-in · proof of concept</span>
        {signedIn && (
          <nav className="topbar__nav" aria-label="Main">
            <Link href="/home">Home</Link>
            {isAdmin && <Link href="/admin">Members</Link>}
            <form action="/api/sign-out" method="post">
              <button type="submit" className="btn btn--small">
                Sign out
              </button>
            </form>
          </nav>
        )}
      </header>
      <main className={narrow ? "main main--narrow" : "main"}>{children}</main>
    </div>
  );
}
