import { describe, expect, it } from "vitest";
import { generateToken, hashToken, LINK_TTL_SECONDS, parseToken } from "../src/lib/tokens";
// @ts-expect-error - plain ESM script, no types
import * as script from "../scripts/token-hash.mjs";

const PEPPER = "p".repeat(40);

describe("setup-link tokens", () => {
  it("makes 43-character base64url tokens that differ every time", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("accepts only token-shaped input", () => {
    expect(parseToken(generateToken())).not.toBeNull();
    expect(parseToken("short")).toBeNull();
    expect(parseToken("has spaces and ?? symbols that are long enough to pass length")).toBeNull();
    expect(parseToken(undefined)).toBeNull();
    expect(parseToken(["a".repeat(40)])).toBeNull();
    expect(parseToken("a".repeat(201))).toBeNull();
  });

  it("hashes to 64 hex characters, depends on the pepper, and never contains the token", () => {
    const t = generateToken();
    const h = hashToken(t, PEPPER);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(hashToken(t, "q".repeat(40))).not.toBe(h);
    expect(hashToken(t + "x", PEPPER)).not.toBe(h);
  });

  it("is the same formula in the admin script, so a script link is accepted by the app", () => {
    const t = generateToken();
    expect(script.hashToken(t, PEPPER)).toBe(hashToken(t, PEPPER));
    expect(script.LINK_TTL_SECONDS).toBe(LINK_TTL_SECONDS);
  });

  it("keeps the link lifetime at 15 minutes, as the scope file says", () => {
    expect(LINK_TTL_SECONDS).toBe(900);
  });
});
