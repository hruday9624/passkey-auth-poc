"""One-sheet diagram: how the passkey proof of concept works on Supabase, and the same jobs on other stacks.

Writes diagram-stacks.svg, diagram-stacks.html, diagram-stacks.png beside this file.
The Supabase half repeats facts that build.py already checks against the code and SQL (15-minute link,
8 checked functions, amr = passkey, random password, link spent by a POST). The other-stacks half is general
knowledge about libraries and services and is labelled as untested on the sheet.

Run:  python -I handover/build_stacks.py        (add --no-png to skip the browser render)
"""
import html
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
W = 1880
INK, MUTED, ACCENT, OK, BAD, LINE = "#1f2933", "#52606d", "#1d4ed8", "#166534", "#b42318", "#cbd2d9"
SB_FILL, SB_INK = "#fff4e0", "#8a4b00"
body = []


def e(s):
    return html.escape(s, quote=True)


def text(x, y, s, size=14, weight=400, fill=INK, anchor="start"):
    body.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{e(s)}</text>')


def wrap(s, width_px, size):
    per = max(8, int(width_px / (size * 0.52)))
    lines, cur = [], ""
    for w in s.split():
        if len(cur) + len(w) + 1 > per and cur:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    return lines


def para(x, y, s, width_px, size=14, weight=400, fill=INK, lh=None):
    lh = lh or size + 6
    ls = wrap(s, width_px, size)
    for i, ln in enumerate(ls):
        text(x, y + i * lh, ln, size, weight, fill)
    return len(ls) * lh


def rect(x, y, w, h, stroke=LINE, fill="#ffffff", sw=2, dashed=False, rx=12):
    d = ' stroke-dasharray="7 5"' if dashed else ""
    body.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')


def band(y, letter, title, sub):
    rect(50, y, W - 100, 40, "#c7d2fe", "#eef2ff", 1.5, rx=8)
    text(70, y + 27, letter, 18, 700, ACCENT)
    text(98, y + 27, title, 18, 700, ACCENT)
    text(98 + len(title) * 10.2 + 24, y + 27, sub, 14.5, 400, MUTED)


# ------------------------------------------------------------------ title
text(50, 52, "Passkey sign-in: how the proof of concept works, and how to build it on another stack", 28, 700)
text(50, 82, "Top: what we built (Next.js and Supabase). Bottom: the same jobs on a stack of your own.", 16, 400, MUTED)

# ------------------------------------------------------------------ A. what we built
band(110, "A", "What we built", "The three steps, and who does what in each")
BX = [50, 513, 976, 1439]
BW, BY, BH = 391, 170, 304
boxes = [
    ("Phone or browser", "The person's own device", BAD, True, [
        "Admin types a name and an email, then sends the link by hand.",
        "Member opens the link and presses Continue. The phone makes the key after a face or fingerprint. The key never leaves the phone.",
        "Member presses Sign in with a passkey. The phone signs a challenge. No email typed.",
    ]),
    ("App server", "Next.js on Vercel. Holds the secrets", OK, False, [
        "Checks the admin. Makes a one-time link: a random 256-bit token, only its hash is kept, 15 minutes.",
        "Spends the link when Continue is pressed (opening it spends nothing). Hands over a short setup session.",
        "On every page: verifies the token and requires that it was made by a passkey. Anything else is refused.",
    ]),
    ("Supabase Auth", "Hosted service. Passkeys turned on", OK, False, [
        "Creates the account with a random password nobody sees.",
        "Stores the public key when registerPasskey() runs in the browser.",
        "Checks the signature and issues the session token, marked amr = passkey.",
    ]),
    ("Supabase database", "No table access. 8 checked functions", OK, False, [
        "Stores the member and the hash of the link.",
        "Spends the link in one atomic update: right hash, unused, not expired.",
        "Says who the member is, reading the id from the token, never from a form field.",
    ]),
]
for i, (name, sub, col, dashed, steps) in enumerate(boxes):
    x = BX[i]
    rect(x, BY, BW, BH, col, "#ffffff", 2.2, dashed)
    text(x + 22, BY + 36, name, 20, 700)
    text(x + 22, BY + 58, sub, 13.5, 400, MUTED)
    y = BY + 96
    for n, s in enumerate(steps, 1):
        body.append(f'<circle cx="{x + 34}" cy="{y - 5}" r="13" fill="{ACCENT if n < 3 else OK}"/>')
        text(x + 34, y, str(n), 14, 700, "#ffffff", "middle")
        h = para(x + 60, y, s, BW - 84, 14, 400, INK, 19)
        y += max(h, 19) + 18
# arrows between the boxes
for i in range(3):
    ax1, ax2, ay = BX[i] + BW + 6, BX[i + 1] - 6, BY + 40
    body.append(f'<line x1="{ax1 + 8}" y1="{ay}" x2="{ax2 - 8}" y2="{ay}" stroke="{INK}" stroke-width="2.2"/>')
    body.append(f'<polygon points="{ax2},{ay} {ax2 - 11},{ay - 6} {ax2 - 11},{ay + 6}" fill="{INK}"/>')
    body.append(f'<polygon points="{ax1},{ay} {ax1 + 11},{ay - 6} {ax1 + 11},{ay + 6}" fill="{INK}"/>')
text(BX[0] + BW + 36, BY + 24, "calls", 12.5, 400, MUTED, "middle")
text(BX[1] + BW + 36, BY + 24, "calls", 12.5, 400, MUTED, "middle")
text(BX[2] + BW + 36, BY + 24, "calls", 12.5, 400, MUTED, "middle")
# the rule strip
ry = BY + BH + 18
rect(50, ry, W - 100, 54, OK, "#f0fdf4", 2)
text(74, ry + 33, "The one rule, checked on every page:", 16.5, 700, OK)
text(398, ry + 33, "did this person get in with a passkey? A setup link does not count. A password does not count.", 16, 400, INK)

# ------------------------------------------------------------------ B. other stacks
by = ry + 54 + 34
band(by, "B", "The same jobs on another stack", "Five jobs, whatever you build on")
hy = by + 40 + 14
LX, LW = 50, 280
CXS = [340, 838, 1336]
CW = 494
heads = [("What we used: Supabase", SB_INK, SB_FILL), ("Your own server and a WebAuthn library", ACCENT, "#eef2ff"), ("A managed auth service", OK, "#ecfdf3")]
for (t, col, fill), cx in zip(heads, CXS):
    rect(cx, hy, CW, 38, col, fill, 1.8, rx=8)
    text(cx + 16, hy + 25, t, 15.5, 700, col)

rows = [
    ("Add the member and send the first link",
     "createUser with a random password, then generateLink and verifyOtp to open a short setup session. The link itself is our own token.",
     "Your admin page and a table of one-time tokens (hash only, expiry, used flag). No account session is needed: the server can issue the registration challenge directly.",
     "Use the provider's invite or enrolment feature, or keep the same own-token link in front of it."),
    ("Keep the account and the public key",
     "Supabase Auth holds the user and the passkey's public key. Our own tables hold the member and the link hash.",
     "Two tables you own: users, and credentials (credential id, public key, counter, transports). Works in Postgres, MySQL or MongoDB.",
     "The provider holds both. You keep your own member list and roles."),
    ("Create the passkey (once)",
     "registerPasskey() runs in the browser. Supabase checks the reply and stores the key.",
     "The server makes a challenge and checks the phone's reply with a library, for example SimpleWebAuthn (Node), py_webauthn (Python), Spring Security 6.4+ (Java), Fido2NetLib (.NET), go-webauthn (Go), webauthn-ruby (Rails), webauthn-framework (PHP).",
     "Switch passkeys on in the provider (for example Auth0, AWS Cognito, Keycloak, Clerk or Hanko) and call its SDK."),
    ("Sign in with the passkey (every time)",
     "signInWithPasskey(). No email typed. Supabase checks the signature and issues the session.",
     "Same library, sign-in half. Use discoverable credentials so no email is typed, then issue your own session or JWT.",
     "A hosted login page or an SDK call. The provider issues the token."),
    ("Prove it was a passkey, on every page",
     "The token's amr claim lists passkey. getClaims() verifies the token on the server and the app checks amr.",
     "Your session records method = passkey at sign-in. Check it on the server on every request, and do not trust a client-side object.",
     "Look for a sign-in-method claim in the token. Names differ by provider, so confirm one exists before you rely on it."),
]
y = hy + 38 + 10
for label, a, b, c in rows:
    lh = 20
    n = max(len(wrap(s, CW - 32, 14)) for s in (a, b, c))
    rh = max(n * lh + 26, 70)
    rect(LX, y, LW, rh, LINE, "#f8fafc", 1.5, rx=8)
    para(LX + 16, y + 30, label, LW - 32, 15.5, 700, INK, 20)
    for s, cx, (_, col, _f) in zip((a, b, c), CXS, heads):
        rect(cx, y, CW, rh, LINE, "#ffffff", 1.5, rx=8)
        para(cx + 16, y + 30, s, CW - 32, 14, 400, INK, lh)
    y += rh + 10

# ------------------------------------------------------------------ same everywhere
sy = y + 14
rect(50, sy, W - 100, 132, OK, "#f0fdf4", 2)
text(74, sy + 32, "Same on every stack, because none of it is Supabase", 17, 700, OK)
items = [
    "The setup link is a random token, stored only as a keyed hash, good for one use and 15 minutes.",
    "Opening the link spends nothing. Pressing Continue spends it, so chat previews cannot burn it.",
    "The server checks the sign-in method on every page. Hiding a page is not the check.",
    "Passkeys belong to the site address (the relying-party ID). Pick the final domain before anyone enrols.",
    "Tell people to open links in Safari or Chrome, not inside a chat or mail app.",
]
col_w = (W - 100 - 48 - 24) // 2
for i, s in enumerate(items):
    cx = 74 + (i % 2) * (col_w + 24)
    cy = sy + 62 + (i // 2) * 24
    text(cx, cy, "•", 15, 700, OK)
    para(cx + 16, cy, s, col_w - 16, 13.5, 400, INK, 18)

# ------------------------------------------------------------------ footer
fy = sy + 132 + 34
text(50, fy, "Proof of concept, built with AI assistance. The Supabase half is checked against the code (handover/build.py).", 12.5, 400, MUTED)
text(50, fy + 20, "Library and service names in column 2 and 3 are from general knowledge and were not tested here: confirm current versions and passkey support before choosing. Details: carry-over.md, known-gaps.md.", 12.5, 400, MUTED)
H = fy + 44

svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-labelledby="t3 d3" '
    'font-family="Segoe UI, system-ui, -apple-system, Roboto, Arial, sans-serif">'
    '<title id="t3">Passkey sign-in: Supabase proof of concept and other stacks</title>'
    '<desc id="d3">Top: the three steps (admin adds a person, person sets up a passkey, person signs in) and what the phone, the app server, Supabase Auth and the Supabase database each do. Bottom: a table of the same five jobs done with Supabase, with your own server and a WebAuthn library, and with a managed auth service. Then the five ideas that stay the same on any stack.</desc>'
    f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + "\n".join(body) + "</svg>"
)
page = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    "<title>Passkey proof of concept: stacks diagram</title>"
    "<style>html,body{margin:0;background:#fff}svg{display:block;max-width:100%;height:auto}</style></head><body>"
    + svg + "</body></html>"
)
for name, content in (("diagram-stacks.svg", svg), ("diagram-stacks.html", page)):
    with open(os.path.join(HERE, name), "w", encoding="utf-8") as f:
        f.write(content)
print(f"wrote diagram-stacks.svg and diagram-stacks.html ({W}x{H})")

if "--no-png" not in sys.argv:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1.5)
        pg.goto("file:///" + os.path.join(HERE, "diagram-stacks.html").replace("\\", "/"))
        pg.screenshot(path=os.path.join(HERE, "diagram-stacks.png"), clip={"x": 0, "y": 0, "width": W, "height": H})
        pg.close()
        b.close()
    print("wrote diagram-stacks.png")
