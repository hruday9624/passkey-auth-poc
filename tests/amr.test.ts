import { describe, expect, it } from "vitest";
import { hasPasskeyMethod } from "../src/lib/amr";

describe("hasPasskeyMethod (the passkey-only gate)", () => {
  it("accepts a session that began with a passkey", () => {
    expect(hasPasskeyMethod([{ method: "passkey", timestamp: 1 }])).toBe(true);
    expect(hasPasskeyMethod([{ method: "password" }, { method: "passkey" }])).toBe(true);
  });

  it("refuses the setup-link session (otp) and a password session", () => {
    expect(hasPasskeyMethod([{ method: "otp", timestamp: 1 }])).toBe(false);
    expect(hasPasskeyMethod([{ method: "password", timestamp: 1 }])).toBe(false);
    expect(hasPasskeyMethod([{ method: "magiclink" }])).toBe(false);
  });

  it("refuses anything that is not a list of methods", () => {
    expect(hasPasskeyMethod(undefined)).toBe(false);
    expect(hasPasskeyMethod(null)).toBe(false);
    expect(hasPasskeyMethod([])).toBe(false);
    expect(hasPasskeyMethod("passkey")).toBe(false);
    expect(hasPasskeyMethod(["passkey"])).toBe(false);
    expect(hasPasskeyMethod([null])).toBe(false);
    expect(hasPasskeyMethod({ method: "passkey" })).toBe(false);
  });
});
