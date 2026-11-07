// Checks the database side against the real project, with throwaway accounts that are deleted at the end.
//
//   node scripts/db-checks.mjs            (takes about 70 seconds: it waits for a 60-second link to expire)
//   node scripts/db-checks.mjs --fast     (skips the expiry wait)
//
// It makes three temporary accounts: A (becomes the temporary admin), B (a member) and C (nobody). It needs NO
// admin to exist yet, because it makes A the admin and then removes A; run it BEFORE the real first admin.
// Deleting an account cascades to its member, admin and link rows. The secret key is never printed.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { generateToken, hashToken } from "./token-hash.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  env[line.slice(0, i)] = line.slice(i + 1).trim();
}
const fast = process.argv.includes("--fast");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, opts);
const anon = () => createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, opts);
const PEPPER = env.TOKEN_PEPPER;
const tag = randomBytes(4).toString("hex");
const password = randomBytes(18).toString("base64url");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : detail ? `  (${detail})` : ""}`);
}
const denied = (res) => !!res.error && /permission denied|not allowed|42501/i.test(`${res.error.code} ${res.error.message}`);
const hasPasskey = (amr) => Array.isArray(amr) && amr.some((a) => a && typeof a === "object" && a.method === "passkey");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function claimsOf(accessToken) {
  return JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
}

async function makeUser(label) {
  const email = `poc-check-${tag}-${label}@example.test`;
  const res = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (res.error || !res.data.user) throw new Error(`could not create ${label}: ${res.error?.message}`);
  return { id: res.data.user.id, email };
}
async function signedIn(user) {
  const c = anon();
  const { data, error } = await c.auth.signInWithPassword({ email: user.email, password });
  if (error || !data.session) throw new Error(`could not sign in ${user.email}: ${error?.message}`);
  return { client: c, token: data.session.access_token };
}
async function issue(actor, target, ttl = 900) {
  const token = generateToken();
  const res = await service.rpc("issue_setup_link", { p_actor: actor, p_user_id: target, p_hmac: hashToken(token, PEPPER), p_ttl_seconds: ttl });
  return { token, res };
}
const consume = (token) => service.rpc("consume_setup_link", { p_hmac: hashToken(token, PEPPER) });

const made = [];
try {
  const existing = await service.rpc("bootstrap_admin", { p_user_id: "00000000-0000-0000-0000-000000000000", p_name: "probe" });
  if (existing.error && /already exists/i.test(existing.error.message)) {
    console.error("An admin already exists in this project, so the throwaway-admin checks cannot run. Stopping without changing anything.");
    process.exit(2);
  }

  const A = await makeUser("a");
  made.push(A);
  const B = await makeUser("b");
  made.push(B);
  const C = await makeUser("c");
  made.push(C);

  // --- first admin and member list
  const boot = await service.rpc("bootstrap_admin", { p_user_id: A.id, p_name: "Check Admin" });
  check("bootstrap_admin makes the first admin", !boot.error, boot.error?.message);
  const boot2 = await service.rpc("bootstrap_admin", { p_user_id: B.id, p_name: "Second" });
  check("bootstrap_admin refuses once an admin exists", denied(boot2), boot2.error?.message);

  const addByStranger = await service.rpc("admin_add_member", { p_actor: C.id, p_user_id: B.id, p_name: "Check Member" });
  check("admin_add_member refuses an actor who is not an admin", denied(addByStranger), addByStranger.error?.message);
  const addByNull = await service.rpc("admin_add_member", { p_actor: null, p_user_id: B.id, p_name: "Check Member" });
  check("admin_add_member refuses a missing actor", denied(addByNull), addByNull.error?.message);
  const add = await service.rpc("admin_add_member", { p_actor: A.id, p_user_id: B.id, p_name: "Check Member" });
  check("admin_add_member works for an admin", !add.error, add.error?.message);

  // --- issuing links
  const byStranger = await issue(C.id, B.id);
  check("issue_setup_link refuses an actor who is not an admin", denied(byStranger.res), byStranger.res.error?.message);
  const forNonMember = await issue(A.id, C.id);
  check("issue_setup_link refuses a target who is not a member", !!forNonMember.res.error && /not a member/i.test(forNonMember.res.error.message), forNonMember.res.error?.message);
  const badTtl = await issue(A.id, B.id, 5);
  check("issue_setup_link refuses a lifetime under 60 seconds", !!badTtl.res.error);
  const noAdminLink = await service.rpc("issue_admin_link", { p_user_id: B.id, p_hmac: hashToken(generateToken(), PEPPER), p_ttl_seconds: 900 });
  check("issue_admin_link refuses a member who is not an admin", denied(noAdminLink), noAdminLink.error?.message);

  // --- spending links
  const first = await issue(A.id, B.id);
  check("issue_setup_link works for an admin", !first.res.error && typeof first.res.data === "string", first.res.error?.message);
  const second = await issue(A.id, B.id);
  const oldOne = await consume(first.token);
  check("a newer link replaces the older unused one", !oldOne.error && oldOne.data === null, JSON.stringify(oldOne.data));
  const spent = await consume(second.token);
  check("consume_setup_link returns the member", !spent.error && spent.data === B.id, spent.error?.message);
  const again = await consume(second.token);
  check("a spent link cannot be used twice", !again.error && again.data === null);
  const junk = await consume(generateToken());
  check("an unknown token returns nothing", !junk.error && junk.data === null);

  // --- what the people themselves can do (their own tokens, publishable key)
  const asA = await signedIn(A);
  const asB = await signedIn(B);
  const asC = await signedIn(C);
  check("a password session does NOT carry the passkey method (the app would refuse it)", !hasPasskey(claimsOf(asA.token).amr) && !hasPasskey(claimsOf(asB.token).amr), JSON.stringify(claimsOf(asA.token).amr));

  const aIsAdmin = await asA.client.rpc("is_admin");
  const bIsAdmin = await asB.client.rpc("is_admin");
  check("is_admin is true for the admin and false for a member", aIsAdmin.data === true && bIsAdmin.data === false, JSON.stringify([aIsAdmin.data, bIsAdmin.data]));
  const aList = await asA.client.rpc("list_members");
  check("list_members works for the admin and shows both people", !aList.error && Array.isArray(aList.data) && aList.data.length === 2, aList.error?.message);
  const states = Object.fromEntries((aList.data ?? []).map((m) => [m.display_name, m.link_state]));
  check("list_members reports the member's link as used", states["Check Member"] === "used", JSON.stringify(states));
  const bList = await asB.client.rpc("list_members");
  check("list_members is refused for a member (an error, not an empty list)", denied(bList), bList.error?.message);
  const cList = await asC.client.rpc("list_members");
  check("list_members is refused for a non-member", denied(cList), cList.error?.message);
  const bMe = await asB.client.rpc("current_member");
  check("current_member returns the member's own row", !bMe.error && bMe.data?.[0]?.display_name === "Check Member" && bMe.data[0].is_admin === false);
  const cMe = await asC.client.rpc("current_member");
  check("current_member returns nothing for a non-member", !cMe.error && Array.isArray(cMe.data) && cMe.data.length === 0);

  // --- check 10: the service-role doors are shut to signed-in users and to the public key
  const bAdd = await asB.client.rpc("admin_add_member", { p_actor: A.id, p_user_id: C.id, p_name: "x" });
  const bIssue = await asB.client.rpc("issue_setup_link", { p_actor: A.id, p_user_id: B.id, p_hmac: hashToken(generateToken(), PEPPER), p_ttl_seconds: 900 });
  const bConsume = await asB.client.rpc("consume_setup_link", { p_hmac: "x".repeat(64) });
  const aIssueAsSelf = await asA.client.rpc("issue_setup_link", { p_actor: A.id, p_user_id: B.id, p_hmac: hashToken(generateToken(), PEPPER), p_ttl_seconds: 900 });
  check("a member's own token cannot call admin_add_member, issue_setup_link or consume_setup_link", denied(bAdd) && denied(bIssue) && denied(bConsume));
  check("even an admin's own token cannot call the service-only functions (a stolen token cannot mint links)", denied(aIssueAsSelf), aIssueAsSelf.error?.message);
  const publicCalls = await Promise.all([anon().rpc("is_admin"), anon().rpc("list_members"), anon().rpc("current_member"), anon().rpc("consume_setup_link", { p_hmac: "x".repeat(64) })]);
  check("the public key alone can call none of the functions", publicCalls.every((r) => denied(r)), JSON.stringify(publicCalls.map((r) => r.error?.message)));

  // --- the tables themselves
  const tables = await Promise.all(["admins", "members", "setup_links"].map((t) => service.from(t).select("*").limit(1)));
  check("the secret key cannot read the tables directly", tables.every((r) => !!r.error), JSON.stringify(tables.map((r) => r.error?.message)));
  const asBTables = await Promise.all(["admins", "members", "setup_links"].map((t) => asB.client.from(t).select("*").limit(1)));
  check("a signed-in member cannot read the tables directly", asBTables.every((r) => !!r.error));

  // --- expiry last, so the earlier link-state check sees the spent link as the latest one
  if (!fast) {
    const shortLived = await issue(A.id, B.id, 60);
    console.log("      waiting 62 seconds for a 60-second link to expire...");
    await sleep(62000);
    const late = await consume(shortLived.token);
    check("an expired link cannot be used", !late.error && late.data === null);
  }
} catch (e) {
  console.error("Check run stopped:", e instanceof Error ? e.message : e);
  results.push({ name: "run completed", ok: false });
} finally {
  for (const u of made) await service.auth.admin.deleteUser(u.id);
  const left = await service.rpc("bootstrap_admin", { p_user_id: "00000000-0000-0000-0000-000000000000", p_name: "probe" });
  const clean = !!left.error && /unknown account/i.test(left.error.message);
  console.log(clean ? "Cleanup: throwaway accounts deleted and no admin left behind." : `Cleanup check unclear: ${left.error?.message}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
