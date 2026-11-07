# Passkey sign-in: proof of concept

A small working example of passkey-only sign-in for a fixed group of people. An admin adds a member and gets a one-time setup link. The member opens it on their phone, registers a passkey, and signs in with it from then on. There is no password page. It is a first pass, not production-ready.

Built with AI assistance and checked by running it. Next.js 16 and Supabase (hosted auth and database), chosen for speed, not as a recommendation.

## Read these first, in this order

1. `handover/diagram-stacks.png`: how it works on Supabase, and how the same jobs are done on other stacks.
2. `handover/carry-over.md`: which ideas move to any stack, and which lines are Supabase-specific.
3. `handover/known-gaps.md`: what was tested, what was not, and the known gaps.

`handover/diagram.png` and `diagram-simple.png` show the same flow in more and less detail.

## The one rule worth keeping

Only a session created by a passkey sign-in may open the protected area. A password session, or the session from a setup link, must be refused. Here that check is `src/lib/amr.ts`, applied in `src/lib/session.ts`.

## Where things are

| Path | What it is |
|---|---|
| `src/app/` | Pages: sign-in, setup-link flow (`enrol/`), protected page (`home/`), admin page (`admin/`) |
| `src/lib/` | Session check, setup-link tokens, config |
| `supabase/migrations/` | The database: tables, rules, and the functions that issue and spend links |
| `scripts/` | Create the first admin, check the database rules |
| `tests/` | Unit tests (`npm test`) |
| `tests-live/` | Browser checks against a deployed copy, using a simulated passkey |

## Running it (Supabase route)

1. Create a Supabase project. In its Auth settings, turn on Passkeys and set the relying-party ID to the exact host you will deploy to. A passkey is tied to that host, and changing it later invalidates every passkey.
2. Apply `supabase/migrations/20261031000000_passkey_poc.sql` in the SQL editor.
3. Copy `.env.local.example` to `.env.local` and fill it in. `TOKEN_PEPPER` and `SESSION_COOKIE_SECRET` are random strings of 32 or more characters. `SUPABASE_SECRET_KEY` is server-only: never expose it or commit it.
4. `npm ci`, then deploy somewhere with HTTPS on the host from step 1. Passkeys do not work on `localhost` or on preview URLs. `vercel.json` pins the region to Mumbai; change or delete that.
5. Create the first admin: `node scripts/admin-link.mjs you@example.com "Your Name"`. Open the link it prints, in Safari or Chrome on your phone, within 15 minutes.
6. The admin page then adds members and shows each member's setup link once, with a Copy button. Send it yourself, as there is no email service.

`npm test` and `npm run typecheck` need no setup. The scripts in `scripts/` and `tests-live/` talk to a real project and read `SITE_ORIGIN` (the deployed address).

## Not included

- No password sign-in. That page is yours to build; keep the rule above.
- No email sending, no member removal, and one admin only (see `known-gaps.md`).
- `AGENTS.md` is a note that `create-next-app` generates for coding assistants. Ignore it.
