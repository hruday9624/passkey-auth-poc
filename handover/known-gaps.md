# Known gaps, and what was tested on which devices

Proof of concept, written 2026-10-31. Expect a first pass to be roughly 70 to 80 percent of the way to something you could rely on; the list below is how that gap is made of. It is **not production-ready**.

## What was tested, and how

| Test | How it was run | Result |
|---|---|---|
| Database rules (28 checks, throwaway accounts, cleaned up afterwards) | Script against the real Supabase project | 28 of 28 pass |
| Browser run on the live address (25 checks) | Automated Chrome, headless, with a **virtual** passkey (a software stand-in for a device) | 25 of 25 pass |
| Unit tests (token, grant cookie, `amr` rule) | Local | 13 of 13 pass |
| Type check, lint, production build | Local | clean |
| **One real phone** | The builder, by hand: admin adds a member, link copied and sent to the phone, passkey set up, signed in | **worked.** Android phone, in Chrome and Edge. Phone model not recorded. |

### The twelve acceptance checks

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | Admin adds a member | pass | automated run on the live site; no password is shown |
| 2 | Admin gets a setup link, works once in a fresh browser | pass | automated run; also the real phone |
| 3 | Link used twice is refused | pass | automated run |
| 4 | Link after 15 minutes is refused | **partly tested** | The database refuses an expired link (tested with a 60-second link). We did not wait 15 minutes through the live page. |
| 5 | Link opened by a preview (GET only) stays unspent | pass | automated run: three plain visits, then the link still worked |
| 6 | Enrol a passkey | pass | automated run; real phone |
| 7 | Sign in with the passkey, correct name shown | pass | automated run; real phone |
| 8 | Setup-link session alone cannot open the protected page | pass | automated run |
| 9 | Password session cannot open the protected page | pass | automated run: a real password session was put into the browser's cookies and refused; putting the passkey session back opened the page, so the refusal was about the sign-in method |
| 10 | Non-admin cannot use admin actions | pass | database checks (the database function refuses); and a member who opens the admin page is sent back. A member calling the admin action directly from the browser was not run as a browser test. |
| 11 | Sign out ends access | pass | automated run |
| 12 | Unknown email or bad link gives the same neutral message | pass | automated run |

## Not tested

- **iPhone and Safari** (iOS or Mac). Untested unless noted above.
- **Firefox.**
- **The QR / "use a phone to sign in on a computer" route.**
- **Links opened inside WhatsApp, a mail app or other in-app browsers.** The setup page tells people to open it in Safari or Chrome, but we have not tried the in-app case.
- **A second device for the same member**, and a passkey synced through iCloud or Google across devices. (Proven earlier on a different project, not on this one.)
- **Slow phones and slow networks.** A button pressed before the page has finished loading may do nothing. Not seen in testing; it is possible.
- **Load, many users, many admins.** Not tried.

## Gaps by design (next phase, not built)

These were left out on purpose, so the proof of concept stays small. They are the diagram's grey "next phase" boxes.

- **No recovery for a lost phone.** The admin can issue a new link, but that **adds** a passkey and **does not remove** the lost one. The admin page shows how many passkeys a member has, with no way to remove one. Removing a member is not built either.
- **One admin.** If the admin loses their phone, someone with the server's secret key has to re-run the bootstrap script. A second admin is next phase.
- **No rate limits or lockouts** on sign-in attempts, link attempts or adding members. Setup links carry 256 bits of randomness, so guessing one is not realistic, but nothing slows down someone who tries.
- **No audit log.** Nothing records who added whom, or who signed in.
- **No Content-Security-Policy.** Basic security headers are set (no framing, no sniffing, HSTS, same-origin referrer).
- **No external penetration test.** One careful read of the code by the builder, nothing independent.
- **No automatic email.** The admin copies the link and sends it by hand.

## Gaps in the design that you should know about

- **The passkey rule lives in the app server, not in the database.** Every protected page and action refuses a session that was not made by a passkey. But the database functions that read a person's own record trust any valid Supabase session. Someone holding a password or setup-link session could call those reads straight at Supabase, bypassing our pages, and see their **own** member row (an admin's session could also list members). No table is reachable and no write is open to them, so the exposure is small, but the rule is not enforced at the lowest level. The fix is a check on how the session began inside the database functions.
- **The enrolment grant guards the page, not the auth service.** A person who has just spent a valid link holds a setup session and could call Supabase to register a passkey without the page. They already hold a valid link, so this gives them nothing new, but it is noted in the code too (`lib/grant.ts`).
- **Session lifetime** is the Supabase project default. We did not tune it. A shorter lifetime limits how long a stolen session is useful.
- **Passkeys will not carry over.** They belong to the demo address they were created on. On your domain every tester enrols again.
- **Hosting.** The demo runs on Vercel's free Hobby plan, which is for non-commercial use. Fine for a test; move it before anything real. The database is a new Supabase project used only for this.
- **Test data.** The demo has one admin account. Test members created from the admin page stay until deleted.

## How to try it

1. Ask us for the admin's setup link, or sign in at the demo address if you already enrolled the admin passkey.
2. On the Members page, add a person (any name and email) and copy the link.
3. Open the link on the device you want to test, in Safari or Chrome. Press Continue, then "Set up a passkey".
4. Go to the sign-in page and press "Sign in with a passkey".

Please report: device, browser, what you pressed, what you saw, and the exact message if there was one.
