// Small helper the live browser run calls (tests-live/live_checks.py). It prints ONE line of JSON and never prints
// a key. Reads .env.local next to this folder.
//
//   admin-link <email>                       a fresh setup link for an existing admin  -> {"link": "..."}
//   list-passkeys <email>                    -> {"ids": ["..."]}
//   delete-passkey <email> <passkeyId>       -> {"ok": true}
//   delete-user <email>                      -> {"ok": true}   (cascades to member and link rows)
//   password-session <email>                 gives the account a password and signs in with it -> {"session": {...}}
//                                            used only to prove that a PASSWORD session is refused by the app
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { generateToken, hashToken, LINK_TTL_SECONDS } from "./token-hash.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  env[line.slice(0, i)] = line.slice(i + 1).trim();
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, opts);
const out = (o) => console.log(JSON.stringify(o));
const fail = (m) => {
  out({ error: m });
  process.exit(1);
};

const [cmd, emailArg, extra] = process.argv.slice(2);
const email = (emailArg ?? "").toLowerCase();

async function findUser() {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

const user = await findUser();
if (!user) fail("no such account");

if (cmd === "admin-link") {
  const token = generateToken();
  const r = await db.rpc("issue_admin_link", { p_user_id: user.id, p_hmac: hashToken(token, env.TOKEN_PEPPER), p_ttl_seconds: LINK_TTL_SECONDS });
  if (r.error) fail(r.error.message);
  out({ link: `${(process.env.SITE_ORIGIN || "https://your-app.example").replace(/\/$/, "")}/enrol?t=${token}` });
} else if (cmd === "list-passkeys") {
  const r = await db.auth.admin.passkey.listPasskeys({ userId: user.id });
  if (r.error) fail(r.error.message);
  out({ ids: (r.data ?? []).map((p) => p.id) });
} else if (cmd === "delete-passkey") {
  const r = await db.auth.admin.passkey.deletePasskey({ userId: user.id, passkeyId: extra });
  if (r.error) fail(r.error.message);
  out({ ok: true });
} else if (cmd === "delete-user") {
  const r = await db.auth.admin.deleteUser(user.id);
  if (r.error) fail(r.error.message);
  out({ ok: true });
} else if (cmd === "password-session") {
  const password = randomBytes(18).toString("base64url");
  const u = await db.auth.admin.updateUserById(user.id, { password });
  if (u.error) fail(u.error.message);
  const c = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) fail(s.error?.message ?? "no session");
  out({ session: s.data.session });
} else {
  fail("unknown command");
}
