// Where a sign-in page sends someone after sign-in and after sign-up. Moved out of RoleAuthCard
// unchanged (2026-11-17) so the ?redirect= rules can be tested; the tab a visitor is on plays no
// part, so switching tabs never loses the return URL. Tests: scripts/signin-copy-test.ts [4].
import { safeRedirect } from '@/lib/safe-redirect'

// SIGN-IN GOES THROUGH ONBOARDING TOO — for the OPERATOR roles only.
//
// Sign-in used to land straight on `dest` (the portal), which meant /onboarding — the ONLY code
// that unions a role into publicMetadata.roles[] — ran on sign-UP and never again. So an existing
// account could never acquire a second role. Onboarding is idempotent and additive, so the hop is
// safe for the single-role case and is the whole fix for the multi-role one. `dest` rides along as
// ?redirect= so the user still lands where they were going.
//
// SCOPED TO vendor | organizer | runner, deliberately:
//   • customer — this card fronts CHECKOUT (?redirect=/fair/…/checkout). Customer access is
//     ungated, so the hop would grant nothing while adding a Clerk write + redirect to the money
//     path.
//   • admin    — not one of onboarding's VALID_ROLES; it would degrade to 'customer'.
export const ONBOARDING_ROLES = ['vendor', 'organizer', 'runner']

export interface AuthDestinations { dest: string; afterSignIn: string; afterSignUp: string }

export function authDestinations(role: string, rawRedirect: string | null, redirectTo: string): AuthDestinations {
  const dest = safeRedirect(rawRedirect, redirectTo)
  // Preserve the return URL through sign-up too — onboarding honors ?redirect=, so a customer who
  // creates an account at checkout still lands back at checkout. Only a validated in-app path.
  const redirectParam = dest !== redirectTo ? dest : null
  const afterSignUp = `/onboarding?role=${role}${redirectParam ? `&redirect=${encodeURIComponent(redirectParam)}` : ''}`
  const afterSignIn = ONBOARDING_ROLES.includes(role)
    ? `/onboarding?role=${role}&redirect=${encodeURIComponent(dest)}`
    : dest
  return { dest, afterSignIn, afterSignUp }
}
