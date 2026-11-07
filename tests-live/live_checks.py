"""Live checklist run against the hosted proof of concept, in headless Chrome with virtual authenticators.

    python -I tests-live/live_checks.py

What it does, in order (numbers are the checklist in passkey-poc-scope-2026-10-31.md):
  - issues a fresh link for the existing admin and enrols a VIRTUAL passkey for the admin (the admin's real passkey
    is left alone; the virtual one is deleted again at the end);
  - admin adds a throwaway member in the real page (1, 2);
  - GET-only visits to the link (5), the member's Continue with a setup-link session that must not open the
    protected page (8), passkey enrol (6), passkey sign-in (7);
  - a password session swapped into the cookie jar must not open the protected page (9);
  - a member cannot open the admin page (10, page level; the database level is scripts/db-checks.mjs);
  - sign out (11); a used link and an unknown link give the same message (3, 12);
  - deletes the throwaway member and the admin's virtual passkey.
Check 4 (a link older than 15 minutes) is covered by scripts/db-checks.mjs with a 60-second link, not here.
Nothing secret is printed: links appear only as their first 40 characters.
"""
import base64
import json
import os
import re
import secrets
import subprocess
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = os.environ.get("SITE_ORIGIN", "https://your-app.example")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HELPER = os.path.join(ROOT, "scripts", "live-helper.mjs")
OUT = os.path.join(ROOT, "tests-live", "out")
os.makedirs(OUT, exist_ok=True)

ADMIN = "admin@example.test"
TAG = secrets.token_hex(3)
MEMBER = f"poc-live-{TAG}@example.test"
MEMBER_NAME = f"Live Check {TAG}"
results = []


def check(name, ok, extra=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{extra}]" if extra and not ok else ""), flush=True)


def info(msg):
    print("INFO  " + msg, flush=True)


def helper(*args):
    r = subprocess.run(["node", HELPER, *args], cwd=ROOT, capture_output=True, text=True, timeout=120)
    line = (r.stdout.strip().splitlines() or ["{}"])[-1]
    data = json.loads(line)
    if "error" in data:
        raise RuntimeError(f"helper {args[0]}: {data['error']}")
    return data


def add_virtual_authenticator(ctx, page):
    cdp = ctx.new_cdp_session(page)
    cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options": {
        "protocol": "ctap2", "transport": "internal", "hasResidentKey": True,
        "hasUserVerification": True, "isUserVerified": True, "automaticPresenceSimulation": True}})
    return cdp


def get_status(url):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    try:
        return urllib.request.build_opener(NoRedirect).open(url, timeout=20).status
    except urllib.error.HTTPError as e:
        return e.code


def click(page, selector):
    """Wait for the page's script to finish loading, then click: a click on a server-rendered button before the page
    has hydrated does nothing, which is a test race and not an app fault."""
    page.wait_for_load_state("networkidle")
    page.click(selector)


def enrol(ctx, link, who, page=None):
    """Open a link, press Continue, set up a passkey, land on 'Passkey saved'. Returns the page.
    A virtual authenticator belongs to the page it was added on, so that same page must do the work."""
    page = page or ctx.new_page()
    page.goto(link)
    page.wait_for_selector("button:has-text('Continue')")
    click(page, "button:has-text('Continue')")
    page.wait_for_url("**/enrol/passkey", timeout=60000)
    page.wait_for_selector("button:has-text('Set up a passkey')")
    click(page, "button:has-text('Set up a passkey')")
    page.wait_for_url("**/enrol/done", timeout=60000)
    check(f"{who}: the passkey is saved and the page says so", page.locator("h1:has-text('Passkey saved')").count() == 1)
    return page


def sign_in(page, who):
    page.goto(BASE + "/")
    click(page, "button:has-text('Sign in with a passkey')")
    try:
        page.wait_for_url("**/home", timeout=60000)
    except Exception:
        pass
    ok = page.url.endswith("/home") and page.locator("h1:has-text('You are signed in')").count() == 1
    seen = ""
    if not ok:
        errs = page.locator("p.feedback__error")
        seen = " | on screen: " + (errs.first.inner_text().strip() if errs.count() else "(no error text)")
    check(f"{who}: signing in with the passkey reaches the protected page", ok, page.url + seen)
    return ok


added_admin_passkeys = []
before_admin_passkeys = []

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    try:
        # ------------------------------------------------------------------ plain smoke
        check("live: the sign-in page answers", get_status(BASE + "/") == 200)
        check("live: /home without a session sends the visitor away", get_status(BASE + "/home") in (302, 303, 307, 308))
        check("live: /admin without a session sends the visitor away", get_status(BASE + "/admin") in (302, 303, 307, 308))

        # ------------------------------------------------------------------ the admin gets a virtual passkey
        before_admin_passkeys = helper("list-passkeys", ADMIN)["ids"]
        info(f"admin already holds {len(before_admin_passkeys)} real passkey(s); they are not touched")
        admin_link = helper("admin-link", ADMIN)["link"]
        actx = b.new_context(viewport={"width": 1280, "height": 900})
        ap = actx.new_page()
        add_virtual_authenticator(actx, ap)
        enrol(actx, admin_link, "admin", page=ap)
        added_admin_passkeys = [i for i in helper("list-passkeys", ADMIN)["ids"] if i not in before_admin_passkeys]
        a = ap
        if not sign_in(a, "admin"):
            raise SystemExit("cannot continue without an admin session")
        a.goto(BASE + "/admin")
        a.wait_for_selector("h1:has-text('Members')")
        check("admin: the Members page opens for the admin", True)

        # ------------------------------------------------------------------ 1, 2: admin adds a member and gets a link
        a.fill("input[name=name]", MEMBER_NAME)
        a.fill("input[name=email]", MEMBER)
        click(a, "button:has-text('Add member and make a link')")
        a.wait_for_selector("code.linkbox__url", timeout=30000)
        link = a.locator("code.linkbox__url").inner_text().strip()
        check("1: admin adds a member and the page shows a setup link", link.startswith(BASE + "/enrol?t="), link[:40])
        check("1: the member appears in the list with no password shown anywhere", a.locator(f"td:has-text('{MEMBER}')").count() == 1 and "password" not in a.content().lower())
        info("link starts: " + link[:40] + "...")

        # ------------------------------------------------------------------ 5: GET-only visits do not spend the link
        gets = [get_status(link) for _ in range(3)]
        check("5: three plain visits (a chat app's preview) leave the link unspent", all(s == 200 for s in gets), str(gets))

        # ------------------------------------------------------------------ member: setup-link session must not open the protected page (8)
        mctx = b.new_context(viewport={"width": 390, "height": 844})
        m = mctx.new_page()
        add_virtual_authenticator(mctx, m)
        m.goto(link)
        m.wait_for_selector("button:has-text('Continue')")
        click(m, "button:has-text('Continue')")
        m.wait_for_url("**/enrol/passkey", timeout=60000)
        m.goto(BASE + "/home")
        check("8: the setup-link session alone cannot open the protected page", not m.url.endswith("/home") and m.locator("h1:has-text('You are signed in')").count() == 0, m.url)
        m.goto(BASE + "/admin")
        check("8: nor the admin page", m.locator("h1:has-text('Members')").count() == 0, m.url)

        # ------------------------------------------------------------------ 6: the passkey
        m.goto(BASE + "/enrol/passkey")
        m.wait_for_selector("button:has-text('Set up a passkey')")
        click(m, "button:has-text('Set up a passkey')")
        m.wait_for_url("**/enrol/done", timeout=60000)
        check("6: the member's passkey is saved", m.locator("h1:has-text('Passkey saved')").count() == 1)

        # ------------------------------------------------------------------ 3, 12: a used link and an unknown link read the same
        other = b.new_context(viewport={"width": 390, "height": 844})
        o = other.new_page()
        o.goto(link)
        o.wait_for_selector("button:has-text('Continue')")
        click(o, "button:has-text('Continue')")
        o.wait_for_selector("p.feedback__error", timeout=30000)
        used_msg = o.locator("p.feedback__error").inner_text().strip()
        check("3: a used link cannot be used a second time", "expired or was already used" in used_msg, used_msg)
        o.goto(BASE + "/enrol?t=" + secrets.token_urlsafe(32))
        click(o, "button:has-text('Continue')")
        o.wait_for_selector("p.feedback__error", timeout=30000)
        unknown_msg = o.locator("p.feedback__error").inner_text().strip()
        check("12: an unknown link gives the same message as a used one (nothing leaks)", unknown_msg == used_msg and len(unknown_msg) > 20, unknown_msg)
        o.goto(BASE + "/enrol?t=bad")
        check("12: a malformed link gets a plain refusal", o.locator("text=This link cannot be used").count() == 1)
        o.goto(BASE + "/enrol/passkey")
        check("12: the setup step without a grant is refused", o.locator("button:has-text('Set up a passkey')").count() == 0)
        other.close()

        # ------------------------------------------------------------------ 7: sign in with the passkey
        sign_in(m, "member")
        check("7: the page names the right person", MEMBER_NAME in m.content() and MEMBER in m.content())

        # ------------------------------------------------------------------ 10 (page level)
        m.goto(BASE + "/admin")
        check("10: a member opening the admin page is sent back to the member page", m.url.endswith("/home") and m.locator("h1:has-text('Members')").count() == 0, m.url)

        # ------------------------------------------------------------------ 9: a password session is refused
        sb_cookies = [c for c in mctx.cookies() if c["name"].startswith("sb-") and "auth-token" in c["name"]]
        names = sorted(c["name"] for c in sb_cookies)
        info("session cookie names: " + ", ".join(names))
        base_name = re.sub(r"\.\d+$", "", names[0]) if names else None
        original = {c["name"]: c for c in sb_cookies}
        joined = "".join(original[n]["value"] for n in sorted(original, key=lambda n: (len(n), n)))
        if base_name and joined.startswith("base64-"):
            pw = helper("password-session", MEMBER)["session"]
            pw_value = "base64-" + base64.urlsafe_b64encode(json.dumps(pw).encode()).decode().rstrip("=")
            template = sb_cookies[0]
            mctx.clear_cookies(name=names[0]) if len(names) == 1 else [mctx.clear_cookies(name=n) for n in names]
            mctx.add_cookies([{"name": base_name, "value": pw_value, "domain": template["domain"], "path": "/", "secure": True, "sameSite": "Lax"}])
            m.goto(BASE + "/home")
            refused = not m.url.endswith("/home") and m.locator("h1:has-text('You are signed in')").count() == 0
            check("9: a PASSWORD session in the cookie jar cannot open the protected page", refused, m.url)
            # Positive control: put the real passkey session back, and the same page opens.
            mctx.clear_cookies(name=base_name)
            mctx.add_cookies([{k: v for k, v in c.items() if k in ("name", "value", "domain", "path", "secure", "sameSite", "httpOnly", "expires")} for c in sb_cookies])
            m.goto(BASE + "/home")
            check("9: control: the real passkey session opens it again (so the refusal above was about the method)", m.url.endswith("/home") and m.locator("h1:has-text('You are signed in')").count() == 1, m.url)
        else:
            check("9: the session cookie format was recognised", False, "cookie not in the base64- format")

        # ------------------------------------------------------------------ 11: sign out
        click(m, "button:has-text('Sign out')")
        m.wait_for_load_state("networkidle")
        m.goto(BASE + "/home")
        check("11: after Sign out the protected page no longer opens", not m.url.endswith("/home") and m.locator("h1:has-text('You are signed in')").count() == 0, m.url)

        # ------------------------------------------------------------------ admin view reflects the enrolment
        a.goto(BASE + "/admin")
        a.wait_for_selector("h1:has-text('Members')")
        row = a.locator(f"tr:has-text('{MEMBER}')")
        txt = row.inner_text()
        check("admin list: the member's setup link shows as used", "Link used" in txt, txt)
        check("admin list: the member shows 1 passkey", re.search(r"\b1\b", txt.replace(MEMBER, "")) is not None, txt)
        a.wait_for_load_state("networkidle")
        row.locator("button:has-text('New link')").click()
        a.wait_for_selector("code.linkbox__url", timeout=30000)
        again = a.locator("code.linkbox__url").inner_text().strip()
        check("admin: New link makes a fresh link for an existing member", again.startswith(BASE + "/enrol?t=") and again != link)

        a.screenshot(path=os.path.join(OUT, "admin.png"))
        m.screenshot(path=os.path.join(OUT, "member-signed-out.png"))
    finally:
        # ------------------------------------------------------------------ cleanup
        try:
            helper("delete-user", MEMBER)
            info("throwaway member deleted")
        except Exception as e:
            info(f"member cleanup: {e}")
        for pid in added_admin_passkeys:
            try:
                helper("delete-passkey", ADMIN, pid)
            except Exception as e:
                info(f"admin passkey cleanup: {e}")
        try:
            left = helper("list-passkeys", ADMIN)["ids"]
            info(f"admin passkeys after cleanup: {len(left)} (was {len(before_admin_passkeys)} before the run)")
        except Exception as e:
            info(f"final admin check: {e}")
        b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed.")
sys.exit(1 if failed else 0)
