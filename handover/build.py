"""Builds the one-page diagram (diagram.svg, diagram.html, diagram.png) for the passkey proof of concept.

It FIRST checks every claim the diagram makes against the source code and the SQL migration, and stops without
writing anything if one no longer matches. Numbers shown on the diagram (link lifetime, grant lifetime, token size,
function counts) are read from the code here, not typed in.

Run:  python -I handover/build.py        (add --no-png to skip the browser render)
"""
import html
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------- checks against the code
failures = []
facts = {}


checked = [0]


def check(claim, ok):
    checked[0] += 1
    if not ok:
        failures.append(claim)


tokens = read("src/lib/tokens.ts")
grant = read("src/lib/grant.ts")
admin = read("src/app/admin/actions.ts")
enrol = read("src/app/enrol/actions.ts")
enrol_page = read("src/app/enrol/page.tsx")
enrol_start = read("src/app/enrol/EnrolStart.tsx")
enrol_pk = read("src/app/enrol/passkey/EnrolPasskey.tsx")
signin_btn = read("src/app/PasskeySignInButton.tsx")
signin_act = read("src/app/actions.ts")
session = read("src/lib/session.ts")
amr = read("src/lib/amr.ts")
home = read("src/app/home/page.tsx")
sql = read("supabase/migrations/20261031000000_passkey_poc.sql")
vercel = read("vercel.json")

m = re.search(r"LINK_TTL_SECONDS = (\d+) \* 60", tokens)
check("link lifetime is N minutes in tokens.ts", bool(m))
facts["link_min"] = int(m.group(1)) if m else 0

m = re.search(r"GRANT_TTL_SECONDS = (\d+) \* 60", grant)
check("grant lifetime is N minutes in grant.ts", bool(m))
facts["grant_min"] = int(m.group(1)) if m else 0

m = re.search(r"randomBytes\((\d+)\)\.toString\(\"base64url\"\)", tokens)
check("setup token is random bytes, base64url", bool(m))
facts["token_bits"] = int(m.group(1)) * 8 if m else 0
check("token pepper: keyed HMAC-SHA256 of 'setup-link:' + token", "createHmac(\"sha256\", pepper)" in tokens and "setup-link:${token}" in tokens)

# admin actions
check("adminAction starts with requireAdmin() before reading the form", admin.index("await requireAdmin()") < admin.index("formData.get(\"intent\")"))
check("member account gets a random password", "createUser(" in admin and "randomBytes(32)" in admin)
check("admin_add_member called with the acting admin", "rpc(\"admin_add_member\", { p_actor: admin.id" in admin)
check("issue_setup_link called with the acting admin and a hash", "rpc(\"issue_setup_link\"" in admin and "p_actor: actorId" in admin and "hashToken(token" in admin)
check("link is returned to the screen, not emailed", "originOf()" in admin and "/enrol?t=${token}" in admin and "sendMail" not in admin and "resend" not in admin.lower())

# setup page: GET spends nothing, POST spends
check("GET /enrol page never spends the link", "consume_setup_link" not in enrol_page and "consumeLinkAction" not in enrol_page)
check("Continue (EnrolStart) is what calls the spending action", "consumeLinkAction" in enrol_start)
check("consumeLinkAction spends via consume_setup_link", "rpc(\"consume_setup_link\"" in enrol)
check("then generateLink + verifyOtp", "generateLink({ type: \"magiclink\"" in enrol and "verifyOtp(" in enrol)
check("sets the poc_grant cookie after the link is spent", "createGrantToken(userId" in enrol and enrol.index("rpc(\"consume_setup_link\"") < enrol.index(".set(GRANT_COOKIE"))
check("enrol asks the server before opening the device prompt", enrol_pk.index("ensureEnrolAllowedAction()") < enrol_pk.index("registerPasskey()"))
check("passkey made in the browser through the SDK", "getSupabaseBrowser().auth.registerPasskey()" in enrol_pk)
check("finishEnrolAction checks passkey.list and signs out the setup session", "auth.passkey.list()" in enrol and "signOut({ scope: \"local\" })" in enrol and "GRANT_COOKIE" in enrol)

# sign in
check("sign-in runs in the browser through the SDK, no email", "signInWithPasskey()" in signin_btn and "email" not in signin_btn.lower().replace("email is", ""))
check("server re-checks after sign-in", "getPasskeyUser(client)" in signin_act and "getMember(client)" in signin_act and "redirect(\"/home\")" in signin_act)

# the gate
check("gate uses getClaims, not getSession", "auth.getClaims()" in session and "auth.getSession()" not in session)
check("gate needs amr to list passkey", "hasPasskeyMethod(claims.amr)" in session and "method === \"passkey\"" in amr)
check("member decided by current_member()", "rpc(\"current_member\")" in session)
check("requireAdmin refuses a non-admin", "isAdmin) redirect(\"/home\")" in session)
check("home page checks for itself", "requireMember()" in home)

# database
fn_names = re.findall(r"^create function public\.(\w+)\(", sql, re.M)
facts["fn_total"] = len(fn_names)
to_auth = re.findall(r"^grant execute on function public\.(\w+)\(.*?\) +to authenticated;", sql, re.M)
to_svc = re.findall(r"^grant execute on function public\.(\w+)\(.*?\) +to service_role;", sql, re.M)
facts["fn_auth"] = len(to_auth)
facts["fn_svc"] = len(to_svc)
check("every function is granted to exactly one of authenticated / service_role", sorted(fn_names) == sorted(to_auth + to_svc))
check("every function is SECURITY DEFINER with an empty search_path", len(re.findall(r"security definer", sql)) == len(fn_names) and len(re.findall(r"set search_path = ''", sql)) == len(fn_names))
tables = re.findall(r"^create table public\.(\w+)", sql, re.M)
facts["tables"] = len(tables)
check("every table has row level security on", len(re.findall(r"enable row level security", sql)) == len(tables))
check("every table has all privileges revoked", all(re.search(rf"revoke all on public\.{t}\s+from anon, authenticated, service_role", sql) for t in tables))
check("signed-in functions are exactly the three reads", sorted(to_auth) == ["current_member", "is_admin", "list_members"])
check("current_member reads auth.uid() and not amr (so the passkey rule lives in the app server)", "auth.uid()" in sql and "amr" not in sql)
check("hosted in the Mumbai region (bom1)", "bom1" in vercel)

if failures:
    print("STOP: the diagram no longer matches the code:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print(f"{checked[0]} claims checked against the code and the SQL; all match.")

# ---------------------------------------------------------------- drawing
W, H = 1880, 1260
LANE_X = [50, 400, 750, 1100]
LANE_W = 320
CX = [x + LANE_W // 2 for x in LANE_X]

INK, MUTED, ACCENT, OK, BAD, LINE = "#1f2933", "#52606d", "#1d4ed8", "#166534", "#b42318", "#cbd2d9"
out = []


def e(s):
    return html.escape(s, quote=True)


def text(x, y, s, size=12, weight=400, fill=INK, anchor="start", extra=""):
    out.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" {extra}>{e(s)}</text>')


def wrap(s, width_px, size):
    per = max(8, int(width_px / (size * 0.53)))
    words, lines, cur = s.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > per and cur:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    return lines


def para(x, y, s, width_px, size=12, weight=400, fill=INK, lh=None):
    lh = lh or size + 4
    lines = wrap(s, width_px, size)
    for i, ln in enumerate(lines):
        text(x, y + i * lh, ln, size, weight, fill)
    return y + len(lines) * lh


def arrow(x1, x2, y, label, color=INK, dashed=False, thick=False, tag=False, num=0):
    sw = 2.6 if thick else 1.6
    d = ' stroke-dasharray="5 4"' if dashed else ""
    direction = 1 if x2 > x1 else -1
    sx, ex = x1 + 6 * direction, x2 - 6 * direction
    out.append(f'<line x1="{sx}" y1="{y}" x2="{ex - 8 * direction}" y2="{y}" stroke="{color}" stroke-width="{sw}"{d}/>')
    out.append(f'<polygon points="{ex},{y} {ex - 9 * direction},{y - 4.5} {ex - 9 * direction},{y + 4.5}" fill="{color}"/>')
    text((x1 + x2) / 2, y - 7, label, 12, 500 if thick else 400, color if color != INK else INK, "middle",
         'paint-order="stroke" stroke="#ffffff" stroke-width="5" stroke-linejoin="round"')


def box(cx, ytop, h, s, color=INK, dashed=False, fill="#ffffff", w=300, bold=False):
    d = ' stroke-dasharray="5 4"' if dashed else ""
    out.append(f'<rect x="{cx - w // 2}" y="{ytop}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{color}" stroke-width="1.5"{d}/>')
    lines = wrap(s, w - 16, 12)
    total = len(lines) * 15
    y0 = ytop + (h - total) / 2 + 12
    for i, ln in enumerate(lines):
        text(cx, y0 + i * 15, ln, 12, 600 if bold else 400, color if color != LINE else INK, "middle")


def badge(n, y):
    out.append(f'<circle cx="26" cy="{y}" r="10" fill="{INK}"/>')
    text(26, y + 4, str(n), 11, 700, "#ffffff", "middle")


def sb_tag(y):
    out.append(f'<rect x="1396" y="{y - 8}" width="30" height="16" rx="8" fill="#fef3c7" stroke="#b45309" stroke-width="1"/>')
    text(1411, y + 4, "SB", 10, 700, "#92400e", "middle")


out.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-labelledby="t d" font-family="Segoe UI, system-ui, -apple-system, Roboto, Arial, sans-serif">')
out.append('<title id="t">Passkey-only sign-in: how the proof of concept works</title>')
out.append('<desc id="d">Sequence diagram in three parts: an admin adds a member and gets a one-time setup link, the member registers a passkey, and the member signs in with it. Four columns: the browser, the app server, Supabase Auth and the Supabase database. A side panel shows the check every protected page makes, what is refused, and the work left for the next phase.</desc>')
out.append(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')

text(50, 30, "Passkey-only sign-in: proof of concept", 22, 700)
text(50, 52, "Drawn from the code and checked against it (handover/build.py). SB marks a call you would replace in another stack.", 12.5, 400, MUTED)

# boundaries and lane headers
bounds = [
    (38, 344, "UNTRUSTED: the person's own device", BAD),
    (388, 344, "TRUSTED: our server code (Vercel, Mumbai)", OK),
    (738, 694, "TRUSTED: Supabase, hosted service (Mumbai)", OK),
]
for bx, bw, label, col in bounds:
    out.append(f'<rect x="{bx}" y="64" width="{bw}" height="{H - 64 - 24}" rx="10" fill="none" stroke="{col}" stroke-width="1.4" stroke-dasharray="7 5"/>')
    text(bx + 12, 82, label, 11, 700, col)
heads = [
    ("Browser", "Admin or member. Holds its own session only."),
    ("App server", "Holds the secrets. Decides who gets in."),
    ("Supabase Auth", "Checks the passkey, signs the session token."),
    ("Supabase database", f"No table access. {facts['fn_total']} checked functions."),
]
for i, (h1, h2) in enumerate(heads):
    text(CX[i], 108, h1, 15, 700, INK, "middle")
    text(CX[i], 125, h2, 11.5, 400, MUTED, "middle")
    out.append(f'<line x1="{CX[i]}" y1="136" x2="{CX[i]}" y2="{H - 34}" stroke="{LINE}" stroke-width="1.5" stroke-dasharray="3 5"/>')
text(1411, 100, "SB", 10, 700, "#92400e", "middle")
text(1411, 112, "column", 9, 400, "#92400e", "middle")

# rows
y = 150
SEC_COL = "#eef2ff"


def section(title, sub):
    global y
    out.append(f'<rect x="40" y="{y}" width="1390" height="28" rx="5" fill="{SEC_COL}"/>')
    text(52, y + 19, title, 13.5, 700, ACCENT)
    text(52 + len(title) * 7.4 + 14, y + 19, sub, 12, 400, MUTED)
    y += 38


n = 0


def msg(a, b, label, **kw):
    global y, n
    n += 1
    ay = y + 32
    badge(n, ay)
    arrow(CX[a], CX[b], ay, label, **{k: v for k, v in kw.items() if k != "sb"})
    if kw.get("sb"):
        sb_tag(ay)
    y += 46
    out.append(f'<line x1="40" y1="{y - 1}" x2="1430" y2="{y - 1}" stroke="#eef0f3" stroke-width="1"/>')


def selfbox(lane, label, **kw):
    global y, n
    n += 1
    badge(n, y + 22)
    box(CX[lane], y + 4, 36, label, **{k: v for k, v in kw.items() if k != "sb"})
    if kw.get("sb"):
        sb_tag(y + 22)
    y += 46
    out.append(f'<line x1="40" y1="{y - 1}" x2="1430" y2="{y - 1}" stroke="#eef0f3" stroke-width="1"/>')


B, S, A, D = 0, 1, 2, 3
lm, gm = facts["link_min"], facts["grant_min"]

section("1  Admin adds a member and gets a setup link", "The admin is already signed in with a passkey.")
msg(B, S, "Add member: name and email")
selfbox(S, "requireAdmin(): a passkey session, and the database says admin")
msg(S, A, "Create account with a random password nobody sees", sb=True)
msg(S, D, "admin_add_member(actor, user, name). The database checks the actor is an admin again")
msg(S, D, f"issue_setup_link(actor, user, keyed hash of a {facts['token_bits']}-bit token, {lm} min). The token itself is never stored")
msg(S, B, "Link shown once, with a Copy button", dashed=True)
selfbox(B, "The admin sends the link by hand. The app sends nothing.", dashed=True, color=MUTED)

section("2  Member sets up a passkey", f"The link works once and runs out after {lm} minutes.")
msg(B, S, "GET /enrol?t=... shows a Continue page. Nothing is spent.")
msg(B, S, "POST Continue (server action)")
msg(S, D, "consume_setup_link(hash): one atomic update, returns the user or nothing")
msg(S, A, "generateLink + verifyOtp: a session with amr = otp", sb=True)
selfbox(S, f"Sets the poc_grant cookie: signed, names the person, {gm} minutes")
msg(B, S, "May this session enrol? Needs the grant cookie")
msg(B, A, "registerPasskey(): the device makes the key and it never leaves the device", color=ACCENT, thick=True, sb=True)
msg(B, S, "Finish: check a passkey exists, end the setup session", sb=True)

section("3  Member signs in, every time", "No email typed. The device offers the passkey it holds for this site.")
msg(B, A, "signInWithPasskey(): Supabase checks the signature, session carries amr = passkey", color=ACCENT, thick=True, sb=True)
msg(B, S, "Finish sign-in")
selfbox(S, "THE GATE: getClaims() verifies the token, and amr must list passkey", color=OK, bold=True, fill="#f0fdf4", sb=True)
msg(S, D, "current_member(): the database reads the user from the token", sb=True)
msg(S, B, "Page: You are signed in, with the member's name", dashed=True)
rows_end = y

# right panel
PX, PW = 1460, 390


def panel(ytop, title, color, height):
    out.append(f'<rect x="{PX}" y="{ytop}" width="{PW}" height="{height}" rx="8" fill="#ffffff" stroke="{color}" stroke-width="1.5"/>')
    out.append(f'<rect x="{PX}" y="{ytop}" width="{PW}" height="26" rx="8" fill="{color}"/>')
    out.append(f'<rect x="{PX}" y="{ytop + 18}" width="{PW}" height="8" fill="{color}"/>')
    text(PX + 12, ytop + 18, title, 12.5, 700, "#ffffff")
    return ytop + 46


py = 150
yy = panel(py, "The gate: checked on every protected page and action", OK, 250)
for s in [
    "1. Verify the token's signature and expiry with getClaims(). Never getSession().",
    "2. Its amr must list passkey. A setup-link session (otp) or a password session fails here.",
    "3. The database must say the person is a member (current_member).",
    "4. Admin actions: the database must say admin, and each admin function checks it again.",
]:
    yy = para(PX + 14, yy, s, PW - 28, 12, 400, INK, 16) + 6
para(PX + 14, yy + 2, "Hiding a page is not the check. Each page and action runs it for itself.", PW - 28, 12, 600, OK, 16)
py += 262

yy = panel(py, "Refused, by design", BAD, 238)
for s in [
    "Setup-link session (otp) opening /home or /admin",
    "Password session opening /home or /admin",
    "Missing, forged or expired session cookie",
    "Signed in but not a member",
    "A member calling an admin action",
    "A link used twice, expired, unknown or malformed (all show the same message)",
]:
    yy = para(PX + 14, yy, "x  " + s, PW - 28, 12, 400, INK, 16) + 4
para(PX + 14, yy + 4, "A link that is only visited, for example by a chat preview, stays unspent.", PW - 28, 12, 600, MUTED, 16)
py += 250

yy = panel(py, "Where the secrets live", INK, 176)
for s in [
    "Secret key, token pepper and cookie secret: server only, never sent to the browser.",
    f"Database: {facts['tables']} tables with row level security on and no table access for anyone. "
    f"{facts['fn_total']} functions, {facts['fn_auth']} callable by a signed-in user (reads) and {facts['fn_svc']} by the server only (writes).",
]:
    yy = para(PX + 14, yy, s, PW - 28, 12, 400, INK, 16) + 6
py += 188

yy = panel(py, "Next phase (not built)", MUTED, 252)
items = ["Change codes", "Lost-phone recovery by teammate approval", "Batches and departments", "Audit register",
         "Rate limits and lockouts", "Installable app", "Second admin", "Content-Security-Policy",
         "Database check of the passkey rule (amr)", "External penetration test"]
col_x = [PX + 14, PX + 14 + 184]
for i, it in enumerate(items):
    cx0 = col_x[i % 2]
    ry = yy - 4 + (i // 2) * 36
    out.append(f'<rect x="{cx0}" y="{ry}" width="176" height="30" rx="6" fill="#f5f7fa" stroke="{MUTED}" stroke-width="1" stroke-dasharray="4 3"/>')
    ls = wrap(it, 160, 11)
    for j, ln in enumerate(ls[:2]):
        text(cx0 + 88, ry + (19 if len(ls) == 1 else 13) + j * 12, ln, 11, 400, MUTED, "middle")
py += 264

out.append(f'<rect x="{PX}" y="{py}" width="{PW}" height="{H - 24 - py}" rx="8" fill="#f8fafc" stroke="{LINE}" stroke-width="1"/>')
para(PX + 14, py + 22, "Assumption: a fixed group that an admin adds, as in a closed team list. Public self-signup is not covered.", PW - 28, 11.5, 400, MUTED, 15)
para(PX + 14, py + 70, "Built with AI assistance. Passkeys are tied to the site address and do not carry over to another domain.", PW - 28, 11.5, 400, MUTED, 15)

out.append("</svg>")
svg = "\n".join(out)

with open(os.path.join(HERE, "diagram.svg"), "w", encoding="utf-8") as f:
    f.write(svg)
page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Passkey proof of concept: diagram</title>
<style>body{{margin:0;background:#fff;color:#1f2933;font-family:Segoe UI,system-ui,sans-serif}}main{{overflow-x:auto}}svg{{display:block;max-width:none}}</style>
</head><body><main>{svg}</main></body></html>"""
with open(os.path.join(HERE, "diagram.html"), "w", encoding="utf-8") as f:
    f.write(page)
print(f"wrote diagram.svg and diagram.html (rows end at y={rows_end}, canvas {H})")
if rows_end > H - 30:
    print("WARNING: rows run past the canvas; raise H")

# ---------------------------------------------------------------- the simple diagram (plain words)
SW, SH = 1400, 800
out = []
out.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SW} {SH}" width="{SW}" height="{SH}" role="img" aria-labelledby="t2 d2" font-family="Segoe UI, system-ui, -apple-system, Roboto, Arial, sans-serif">')
out.append('<title id="t2">How people sign in without a password</title>')
out.append('<desc id="d2">Three steps: the admin adds a person and gets a one-time link, the person sets up a passkey on their phone, and from then on the person signs in with the passkey. Below, the one rule every page checks, why it is safe, and what is not in this version.</desc>')
out.append(f'<rect width="{SW}" height="{SH}" fill="#ffffff"/>')
text(50, 52, "Signing in without a password", 30, 700)
text(50, 82, "Three steps. After the first two, the person only ever does step 3.", 16, 400, MUTED)

CARD_W, CARD_Y, CARD_H = 400, 110, 360
cards = [
    (50, "1", "The admin adds a person", "Admin, once for each person", ACCENT,
     "The admin types a name and an email. The app makes a one-time link and shows it once. The admin sends the link to the person, for example on WhatsApp."),
    (500, "2", "The person sets up a passkey", "Person, once", ACCENT,
     f"The person opens the link on their phone and presses Continue. The phone asks for a face or fingerprint and keeps the key. The link works once and runs out after {lm} minutes."),
    (950, "3", "The person signs in", "Person, every time", OK,
     "The person presses Sign in with a passkey and approves with a face or fingerprint. No password, no email to type. The app checks the passkey and lets them in."),
]
for cx0, num, title, who, col, body in cards:
    out.append(f'<rect x="{cx0}" y="{CARD_Y}" width="{CARD_W}" height="{CARD_H}" rx="14" fill="#ffffff" stroke="{col}" stroke-width="2"/>')
    out.append(f'<circle cx="{cx0 + 42}" cy="{CARD_Y + 44}" r="24" fill="{col}"/>')
    text(cx0 + 42, CARD_Y + 53, num, 26, 700, "#ffffff", "middle")
    text(cx0 + 80, CARD_Y + 42, title, 20, 700)
    text(cx0 + 80, CARD_Y + 66, who, 14, 400, MUTED)
    para(cx0 + 26, CARD_Y + 244, body, CARD_W - 52, 16, 400, INK, 23)

# icons, drawn simply, centred in the icon area of each card
iy = CARD_Y + 150  # vertical centre of the icon area
# 1: a person with a plus
c1 = 50 + CARD_W // 2
out.append(f'<circle cx="{c1 - 14}" cy="{iy - 22}" r="17" fill="none" stroke="{ACCENT}" stroke-width="3"/>')
out.append(f'<path d="M {c1 - 52} {iy + 38} Q {c1 - 52} {iy + 4} {c1 - 14} {iy + 4} Q {c1 + 24} {iy + 4} {c1 + 24} {iy + 38} Z" fill="none" stroke="{ACCENT}" stroke-width="3" stroke-linejoin="round"/>')
out.append(f'<line x1="{c1 + 44}" y1="{iy - 8}" x2="{c1 + 44}" y2="{iy + 20}" stroke="{ACCENT}" stroke-width="4" stroke-linecap="round"/>')
out.append(f'<line x1="{c1 + 30}" y1="{iy + 6}" x2="{c1 + 58}" y2="{iy + 6}" stroke="{ACCENT}" stroke-width="4" stroke-linecap="round"/>')
# 2: a phone holding a key
c2 = 500 + CARD_W // 2
out.append(f'<rect x="{c2 - 30}" y="{iy - 48}" width="60" height="100" rx="10" fill="none" stroke="{ACCENT}" stroke-width="3"/>')
out.append(f'<circle cx="{c2 - 6}" cy="{iy - 8}" r="9" fill="none" stroke="{ACCENT}" stroke-width="3"/>')
out.append(f'<line x1="{c2 + 3}" y1="{iy - 8}" x2="{c2 + 20}" y2="{iy - 8}" stroke="{ACCENT}" stroke-width="3" stroke-linecap="round"/>')
out.append(f'<line x1="{c2 + 15}" y1="{iy - 8}" x2="{c2 + 15}" y2="{iy + 2}" stroke="{ACCENT}" stroke-width="3" stroke-linecap="round"/>')
out.append(f'<line x1="{c2 - 8}" y1="{iy + 38}" x2="{c2 + 8}" y2="{iy + 38}" stroke="{ACCENT}" stroke-width="3" stroke-linecap="round"/>')
# 3: an open door with a tick
c3 = 950 + CARD_W // 2
out.append(f'<rect x="{c3 - 32}" y="{iy - 50}" width="64" height="100" rx="4" fill="none" stroke="{OK}" stroke-width="3"/>')
out.append(f'<polyline points="{c3 - 16},{iy} {c3 - 4},{iy + 14} {c3 + 18},{iy - 16}" fill="none" stroke="{OK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>')
# arrows between the cards
for ax in (450, 900):
    out.append(f'<line x1="{ax + 6}" y1="{CARD_Y + CARD_H // 2}" x2="{ax + 38}" y2="{CARD_Y + CARD_H // 2}" stroke="{INK}" stroke-width="3"/>')
    out.append(f'<polygon points="{ax + 46},{CARD_Y + CARD_H // 2} {ax + 33},{CARD_Y + CARD_H // 2 - 8} {ax + 33},{CARD_Y + CARD_H // 2 + 8}" fill="{INK}"/>')

# the one rule
ry = CARD_Y + CARD_H + 26
out.append(f'<rect x="50" y="{ry}" width="1300" height="86" rx="12" fill="#f0fdf4" stroke="{OK}" stroke-width="2"/>')
text(76, ry + 32, "The one rule, checked before every page", 17, 700, OK)
para(76, ry + 58, "Did this person get in with a passkey? A setup link does not count. A password does not count. Only a passkey opens the door.", 1240, 16, 400, INK, 22)

# why it is safe / not in this version
by = ry + 86 + 22
out.append(f'<rect x="50" y="{by}" width="640" height="150" rx="12" fill="#ffffff" stroke="{LINE}" stroke-width="2"/>')
text(76, by + 32, "What protects it", 17, 700)
for i, s in enumerate([
    "Nobody chooses or knows a password, so there is none to steal or guess.",
    f"A setup link works once and dies after {lm} minutes.",
    "The key stays on the person's phone. The app never sees it.",
]):
    text(80, by + 66 + i * 28, "•", 16, 700, OK)
    text(98, by + 66 + i * 28, s, 15)
out.append(f'<rect x="710" y="{by}" width="640" height="150" rx="12" fill="#f8fafc" stroke="{MUTED}" stroke-width="2" stroke-dasharray="7 5"/>')
text(736, by + 32, "Not in this version", 17, 700, MUTED)
para(736, by + 64, "Recovery for a lost phone, a second admin, limits on repeated tries, a record of who did what, and sending the link by email.", 590, 15, 400, MUTED, 22)
text(50, SH - 18, "Proof of concept, built with AI assistance. The detailed version for engineers is diagram.png.", 12.5, 400, MUTED)
out.append("</svg>")
simple = "\n".join(out)
with open(os.path.join(HERE, "diagram-simple.svg"), "w", encoding="utf-8") as f:
    f.write(simple)
with open(os.path.join(HERE, "diagram-simple.html"), "w", encoding="utf-8") as f:
    f.write(page.replace("Passkey proof of concept: diagram", "Passkey proof of concept: simple diagram").replace(svg, simple))
print("wrote diagram-simple.svg and diagram-simple.html")

if "--no-png" not in sys.argv:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        for name, w, h in (("diagram", W, H), ("diagram-simple", SW, SH)):
            pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1.5)
            pg.goto("file:///" + os.path.join(HERE, name + ".html").replace("\\", "/"))
            pg.screenshot(path=os.path.join(HERE, name + ".png"), clip={"x": 0, "y": 0, "width": w, "height": h})
            pg.close()
        b.close()
    print("wrote diagram.png and diagram-simple.png")
