// Copies the seven settings from .env.local into the Vercel project's PRODUCTION environment.
//
//   node scripts/push-env.mjs
//
// Each value is handed to the Vercel CLI on its standard input, so it never appears on a command line, in a log
// or on screen; only the NAMES are printed. The three secrets are stored as "sensitive" (write-only in the
// dashboard). The two NEXT_PUBLIC_ values are public by design (they end up in the page code) and must be the
// publishable key, never the secret key: this script refuses to run if that is not the case.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  env[line.slice(0, i)] = line.slice(i + 1).trim();
}

const PUBLIC = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
const SECRET = ["SUPABASE_SECRET_KEY", "TOKEN_PEPPER", "SESSION_COOKIE_SECRET"];

for (const k of [...PUBLIC, ...SECRET]) {
  if (!env[k]) {
    console.error(`Missing ${k} in .env.local`);
    process.exit(1);
  }
}
if (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === env.SUPABASE_SECRET_KEY || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")) {
  console.error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be the publishable key. Nothing was pushed.");
  process.exit(1);
}
if (env.TOKEN_PEPPER === env.SESSION_COOKIE_SECRET) {
  console.error("TOKEN_PEPPER and SESSION_COOKIE_SECRET must differ. Nothing was pushed.");
  process.exit(1);
}

let failed = 0;
for (const name of [...PUBLIC, ...SECRET]) {
  const args = ["--yes", "vercel@latest", "env", "add", name, "production", "--force", ...(SECRET.includes(name) ? ["--sensitive"] : [])];
  const res = spawnSync("npx", args, { cwd: root, input: env[name], encoding: "utf8", shell: true });
  const ok = res.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "ok    " : "FAILED"} ${name}${SECRET.includes(name) ? " (sensitive)" : ""}`);
  if (!ok) console.log((res.stderr || res.stdout || "").split("\n").slice(-4).join("\n").replace(env[name], "<hidden>"));
}
process.exit(failed ? 1 : 0);
