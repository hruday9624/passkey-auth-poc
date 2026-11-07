// Makes the FIRST admin, or issues a fresh setup link for an existing admin who lost their phone.
//
//   node scripts/admin-link.mjs <email> [display name]
//
// Run by whoever holds the secret key (it reads .env.local next to this folder). It prints a one-time setup
// link; open that link in Safari or Chrome on the admin's device and register a passkey. No password exists
// anywhere: the account gets a random password nobody sees. The link is a secret for 15 minutes; do not paste
// it into a shared channel. The secret key is never printed.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { generateToken, hashToken, LINK_TTL_SECONDS } from "./token-hash.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return env;
}

const [emailArg, ...nameParts] = process.argv.slice(2);
const email = (emailArg ?? "").trim().toLowerCase();
const name = nameParts.join(" ").trim() || "Admin";
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: node scripts/admin-link.mjs <email> [display name]");
  process.exit(1);
}

const env = loadEnv();
for (const k of ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "TOKEN_PEPPER"]) {
  if (!env[k]) {
    console.error(`Missing ${k} in .env.local`);
    process.exit(1);
  }
}
// The passkey belongs to one address, so the link must use the production one.
const origin = (process.env.SITE_ORIGIN || "https://your-app.example").replace(/\/$/, "");

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

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

let user = await findUser();
let created = false;
if (!user) {
  const res = await db.auth.admin.createUser({ email, password: randomBytes(32).toString("base64url"), email_confirm: true });
  if (res.error || !res.data.user) {
    console.error("Could not create the account:", res.error?.message ?? "unknown error");
    process.exit(1);
  }
  user = res.data.user;
  created = true;
}

if (created) {
  const boot = await db.rpc("bootstrap_admin", { p_user_id: user.id, p_name: name });
  if (boot.error) {
    // Roll the new account back so a refused bootstrap leaves nothing behind.
    await db.auth.admin.deleteUser(user.id);
    console.error("Refused:", boot.error.message, "(an admin already exists; use that admin's email to get a new link)");
    process.exit(1);
  }
}

const token = generateToken();
const issued = await db.rpc("issue_admin_link", { p_user_id: user.id, p_hmac: hashToken(token, env.TOKEN_PEPPER), p_ttl_seconds: LINK_TTL_SECONDS });
if (issued.error) {
  console.error("Refused:", issued.error.message, "(that email is not an admin)");
  process.exit(1);
}

console.log(created ? `Admin created: ${email}` : `Admin found: ${email}`);
console.log(`Setup link (works once, expires ${issued.data}):`);
console.log(`${origin}/enrol?t=${token}`);
