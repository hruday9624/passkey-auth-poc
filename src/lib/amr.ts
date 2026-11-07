/**
 * How a session began is recorded in the verified token's `amr` claim. A session counts as a member's only if
 * it lists "passkey". The auth service also makes sessions for a password and for its own one-time links
 * ("password", "otp"); those must never open a protected page, so passkey-only is enforced where the decision
 * is made and not just by hiding the password form.
 */
export function hasPasskeyMethod(amr: unknown): boolean {
  return Array.isArray(amr) && amr.some((a) => typeof a === "object" && a !== null && (a as { method?: unknown }).method === "passkey");
}
