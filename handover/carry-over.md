# What carries over to your stack

Proof of concept for passkey-only sign-in. The diagram is `diagram.png` beside this file. This note is for the team that will rebuild it in their own stack.

The demo is built on Next.js and Supabase (hosted auth and database). That was a choice made for speed, not a recommendation. What matters to you is which ideas stand on their own and which lines are Supabase calls you would replace. The diagram marks the second kind with an **SB** tag.

Built with AI assistance, and read and checked by a person. Treat it as a first pass: it works end to end and the checks below pass, but it has not had a security review (see `known-gaps.md`).

**Assumption, to confirm:** the user group is fixed, and an admin adds each member. Public self-signup is not covered. Your stack, auth provider, user count and whether passkeys sit beside passwords are all unknown to us. Nothing below depends on them being a particular way.

## Portable: reuse these ideas as they are

| # | Idea | Why it matters | Where in the demo |
|---|---|---|---|
| 1 | **Admin issues a one-time setup link.** The member never picks a password and nobody signs up by themselves. | Removes the password and the signup page, and so the usual attacks on both. | `admin/actions.ts` |
| 2 | **Our own random token, stored only as a keyed hash.** 256 bits, HMAC-SHA256 with a server-side secret ("pepper"). The database holds the hash, never the token. | A database leak does not leak working links. | `lib/tokens.ts` |
| 3 | **Opening the link spends nothing; pressing Continue spends it.** The page that the link opens only shows a button. The button sends a POST that spends the link in one atomic database update (right hash, unused, not expired). | Chat apps and mail scanners fetch links to make previews. If a GET spent the link, it would be dead before the person saw it. | `enrol/page.tsx`, `enrol/actions.ts` |
| 4 | **Expiry and single use are enforced by the database row, not by the browser.** 15 minutes, once. | A link cannot be replayed or kept. | `consume_setup_link` in the SQL |
| 5 | **A session counts only if it was made by a passkey.** The signed session token records how it began (`amr`). Every protected page and action checks that `passkey` is listed, on the server. | Closes the back door: a setup-link session or a password session exists but gets nowhere. | `lib/amr.ts`, `lib/session.ts` |
| 6 | **Verify the token on the server, never trust a client-side session object.** Check signature and expiry on every protected request. | A forged or expired cookie is refused. | `lib/session.ts` (`getClaims`) |
| 7 | **Every account gets a random password nobody sees.** | If your auth system always keeps a password field, a known password could still make a session. A random one means none can. | `admin/actions.ts` |
| 8 | **Hiding a page is not the check.** Every protected page and server action runs its own access check. An admin action is checked again inside the database. | A missed redirect cannot open an admin function. | `lib/session.ts`, SQL functions |
| 9 | **The database, not the form, says who the member is.** Identity comes from the verified token, never from a field the browser sends. | A member cannot name themselves someone else. | `current_member` in the SQL |
| 10 | **No table access for anyone. The app reaches data only through a short list of checked functions** (3 reads for signed-in users, 5 writes for the server only). | One place to review, small surface. | the SQL migration |
| 11 | **Passkeys belong to the site address.** The browser ties each passkey to the domain it was made on (the "relying-party ID"). Pick the final domain before anyone enrols. | **Test passkeys made on the demo address will not work on your production domain.** Every tester will need to enrol again there. | (WebAuthn itself) |
| 12 | **Tell people to open the link in Safari or Chrome**, not inside WhatsApp or a mail app. | Many in-app browsers cannot create a passkey. | `enrol/page.tsx` |

## Supabase-specific: replace these in your stack

| Demo call (SB tag) | What it does | What you need instead |
|---|---|---|
| `auth.admin.createUser` | Creates the member's account with the random password | Your user-creation call |
| `auth.admin.generateLink` + `auth.verifyOtp` | After the link is spent, makes a short-lived session so the member can register a passkey | Any way to create a "registration only" session for that one person, or sign the registration challenge for them directly. The session reads `otp`, and the protected pages refuse it. |
| `auth.registerPasskey()` | The browser runs the passkey creation (WebAuthn) and Supabase stores the public key | A WebAuthn library for your server (the registration half), plus a place to store the credential id and public key per user. |
| `auth.signInWithPasskey()` | The browser runs the passkey sign-in with no email typed, and Supabase verifies the signature and issues a session | The WebAuthn sign-in half, using discoverable credentials so no email is typed, then your own session token. |
| `auth.getClaims()` and the `amr` claim | Verifies the token and reports how the session began | Your session token should record how it began. If you build sessions yourself, set a field such as `method = passkey` at sign-in and check it on every request. |
| `auth.passkey.list()` and `auth.admin.passkey.listPasskeys` | Confirms the member has a passkey, and shows the count to the admin | A query on your credential table. |
| `auth.uid()` inside the SQL functions | Gives the database the caller's id from the token | Whatever your database or API layer uses to know who is calling. |
| Dashboard settings | **Relying-party ID** (the domain the passkeys belong to), the allowed origins, and the **session token lifetime** | Your own configuration. Set the relying-party ID to the final domain before enrolling anyone, and decide a token lifetime on purpose (shorter is safer; we left the demo's at the project default and did not tune it). |

Two Supabase facts to carry in your head if you ever test against it:
- The relying-party ID is a dashboard setting, not a deploy setting. Changing it later silently kills every passkey made before.
- Passkeys work only on the real address, not on `localhost` or on preview deployments.

## What you must decide, because the demo does not

- **How the link reaches the member.** The demo only shows the link with a Copy button, and the admin sends it by hand. Automatic email needs a mail service in your stack.
- **Lost phone.** The demo has no recovery. The admin can issue a new link, which adds a passkey. It does not remove the lost one. See `known-gaps.md`.
- **Where the passkey rule is enforced.** In the demo it is checked in the app server on every request. The database itself does not check how the session began. If your design makes the database the final authority, add that check there too.
- **More than one admin, rate limits, an audit log**, and so on. The diagram lists them as next phase.

## One more caution

Passkeys remove passwords. They do not remove the question "who may be added, and by whom". That one is the admin's job, and the strength of the whole system rests on that admin account and on how the setup link is delivered.
