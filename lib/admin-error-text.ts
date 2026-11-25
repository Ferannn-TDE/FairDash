/**
 * ADMIN ERROR TEXT — what an admin screen shows when the server says no.
 *
 * A stale admin login makes the admin gates (lib/auth.ts) refuse with 403, and the admin screens
 * used to show the server's own words, "Forbidden — admin access required". A 403 on an admin
 * screen now shows ADMIN_NO_ACCESS, and never the server's text. Any other status keeps the
 * caller's text unchanged: this is wording for 403 only (block header-signin-v1, 2026-11-24).
 * Who may do what is decided on the server and is not changed here.
 *
 * Tested by scripts/admin-forbidden-text-test.ts.
 */

export const ADMIN_NO_ACCESS = "You don't have access to do this right now. Sign out, sign back in, and try again."

/** A 403 on an admin screen → ADMIN_NO_ACCESS. Any other status → `otherwise`, unchanged. */
export function adminErrorText(status: number, otherwise: string): string {
  return status === 403 ? ADMIN_NO_ACCESS : otherwise
}
