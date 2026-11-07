import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGrantToken, GRANT_TTL_SECONDS, isGranted } from "../src/lib/grant";

const SECRET = "s".repeat(40);
const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const NOW = 1_800_000_000_000;

describe("the setup-step grant cookie", () => {
  it("is valid for the person it names, inside five minutes", () => {
    const t = createGrantToken(USER, SECRET, NOW);
    expect(isGranted(t, USER, SECRET, NOW + 1000)).toBe(true);
    expect(isGranted(t, USER, SECRET, NOW + (GRANT_TTL_SECONDS - 1) * 1000)).toBe(true);
  });

  it("expires", () => {
    const t = createGrantToken(USER, SECRET, NOW);
    expect(isGranted(t, USER, SECRET, NOW + GRANT_TTL_SECONDS * 1000)).toBe(false);
    expect(isGranted(t, USER, SECRET, NOW + 3600_000)).toBe(false);
  });

  it("cannot be lent to another account", () => {
    const t = createGrantToken(USER, SECRET, NOW);
    expect(isGranted(t, OTHER, SECRET, NOW + 1000)).toBe(false);
  });

  it("cannot be forged or signed with another secret", () => {
    const t = createGrantToken(USER, SECRET, NOW);
    expect(isGranted(t, USER, "x".repeat(40), NOW + 1000)).toBe(false);
    const [body] = t.split(".");
    expect(isGranted(`${body}.AAAA`, USER, SECRET, NOW + 1000)).toBe(false);
    const forged = Buffer.from(JSON.stringify({ u: OTHER, exp: 9_999_999_999 })).toString("base64url");
    expect(isGranted(`${forged}.${t.split(".")[1]}`, OTHER, SECRET, NOW + 1000)).toBe(false);
  });

  it("refuses missing or malformed values", () => {
    expect(isGranted(undefined, USER, SECRET, NOW)).toBe(false);
    expect(isGranted("", USER, SECRET, NOW)).toBe(false);
    expect(isGranted("a.b.c", USER, SECRET, NOW)).toBe(false);
    expect(isGranted("x".repeat(600), USER, SECRET, NOW)).toBe(false);
    expect(isGranted(createGrantToken(USER, SECRET, NOW), "", SECRET, NOW + 1000)).toBe(false);
  });
});
