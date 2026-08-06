/**
 * VENDOR OPERATOR ADMITTANCE — STEP 3: the operator-facing view of the door.
 *
 * Turns "what does VendorMember.approvalStatus say about this human" into what the portal door
 * decides and what the gate screen shows. Pure: facts in, verdict out. No I/O, no session.
 *
 * ⚠️ THIS FILE HAS NO IMPORTS, AND THAT IS LOAD-BEARING — DO NOT ADD ANY. ⚠️
 * A `'use client'` component imports from here (VendorOperatorGateScreen). The last attempt at
 * this exact feature shipped a client file that reached a server-only policy helper, which
 * transitively pulled `lib/db` → `@prisma/client` into the browser bundle and killed the portal
 * on first page load — after `tsc --noEmit` and all 90 suites passed on it, twice. Type-checking
 * cannot see a bundle boundary; only `npm run build` can. The cheapest permanent defence is a
 * policy module with nothing to pull, so the string-union below is written out by hand instead
 * of imported from `@prisma/client`. It is checked against the real enum by the guard
 * (scripts/vendor-operator-gate-test.ts), which reads schema.prisma — so hand-writing it cannot
 * drift silently, and no client file gains an edge into the server graph.
 */

/** Mirrors the shared Prisma `ApprovalStatus` enum. Pinned to schema.prisma by the guard. */
export type VendorApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

/** ADMITTED → the portal. AWAITING/DECLINED → the gate screen. */
export type VendorOperatorState = 'ADMITTED' | 'AWAITING' | 'DECLINED'

/** One VendorMember row, reduced to only what admittance depends on. */
export interface VendorOperatorFacts {
  approvalStatus: VendorApprovalStatus
  rejectionReason: string | null
}

export interface VendorOperatorView {
  state: VendorOperatorState
  /** Shown to the operator, and (step 4) the message the API gate will refuse with. Null when
   *  ADMITTED. Kept HERE so the screen and the eventual 403 cannot drift into two answers —
   *  the same discipline organizerPortalState applies on the organizer side. */
  message: string | null
  /** The admin's rejectionReason, surfaced to the operator. This is the payload the whole
   *  required-reason rule exists to deliver: a refused operator learns why instead of hitting a
   *  silent wall. Null unless DECLINED with a reason recorded. */
  reason: string | null
}

export const VENDOR_AWAITING_MESSAGE =
  'Your access to this booth is awaiting approval from a FairSynq admin.'
export const VENDOR_DECLINED_MESSAGE =
  'Your access to operate this booth was declined.'

/**
 * ADMITTED FOR ANY BOOTH — the deliberate simplification, stated so nobody inherits it silently.
 *
 * One APPROVED membership admits this human to the WHOLE vendor portal, including any other
 * booth they hold a membership on. At today's scale (4 operators, each on exactly one booth)
 * "approved for any" and "approved for this one" are the same set, so this is exact, not a
 * gamble. It stops being exact the moment one human operates booths at two fairs and an admin
 * approves them at one and not the other: this admits them at both.
 *
 * PER-FAIR ADMISSION IS THE POST-FAIR REFINEMENT. It belongs at the fair-scoped layer
 * (app/vendor/[fairSlug]/), which knows which booth is being asked for; this door does not —
 * it guards the un-scoped /vendor prefix too. Doing it here would mean resolving a fair from a
 * pathname in the authority guard, which is worse than the gap it closes.
 *
 * PRECEDENCE when nothing is APPROVED: a PENDING row outranks a REJECTED one. An in-flight
 * review is the more truthful thing to show — "we haven't decided" rather than a refusal that a
 * later application has already superseded. (Unreachable at 1:1, correct when it isn't.)
 */
export function vendorOperatorState(memberships: VendorOperatorFacts[]): VendorOperatorView {
  if (memberships.some(m => m.approvalStatus === 'APPROVED')) {
    return { state: 'ADMITTED', message: null, reason: null }
  }

  if (memberships.some(m => m.approvalStatus === 'PENDING')) {
    return { state: 'AWAITING', message: VENDOR_AWAITING_MESSAGE, reason: null }
  }

  // Everything left is REJECTED — surface the first recorded reason. An empty membership list
  // never reaches here: the door's existence check refuses that case before this is called.
  const declined = memberships.find(m => m.approvalStatus === 'REJECTED')
  return {
    state: 'DECLINED',
    message: VENDOR_DECLINED_MESSAGE,
    reason: declined?.rejectionReason ?? null,
  }
}

/**
 * THE CARVE-OUT — deadlock prevention, and the reason this gate cannot be a blanket wall.
 *
 * A PENDING or DECLINED operator must still reach the pages that could make them viable:
 *   /vendor/<fairSlug>/onboarding — finish the application an admin is waiting on
 *   /vendor/<fairSlug>/settings   — profile fixes AND Stripe Connect, which is launched from
 *                                   this page (settings/page.tsx → POST /api/vendors/[id]/stripe/connect)
 * Walling these would be a deadlock: refused for being incomplete, then locked out of the only
 * screens that complete it. Connect matters most — an operator with no payout destination can
 * never become approvable, and the admin reviewing them has nothing new to look at.
 *
 * ⚠️ THREE SEGMENTS, EXACTLY. `/vendor/settings` is NOT this — it is `[fairSlug]` with the slug
 * "settings", a fair page that MUST stay gated. A suffix match like endsWith('/settings') would
 * hand a stranger the portal by naming a fair correctly. The segment count is the whole defence.
 *
 * NOTE these are PAGES. The vendor API routes are not under app/vendor/ and are not gated by
 * this door at all — re-verifying the accept-verb server-side is step 4, deliberately not here.
 */
export const VENDOR_GATE_CARVE_OUT_SEGMENTS = ['onboarding', 'settings'] as const

export type VendorCarveOutSegment = (typeof VENDOR_GATE_CARVE_OUT_SEGMENTS)[number]

/**
 * The ONE place a carve-out URL is built. The gate screen's escape buttons and the door's
 * allowlist must name the same routes, and they used to be two hand-written copies of that set —
 * the two-copies-one-lies shape. A screen linking somewhere the door does not carve out is a
 * button that bounces the operator straight back to the wall, which is the deadlock wearing a
 * disguise. Derive, don't repeat: isVendorGateCarveOut(vendorCarveOutPath(s, seg)) is true for
 * every segment by construction, and the guard asserts that round-trip.
 */
export function vendorCarveOutPath(fairSlug: string, segment: VendorCarveOutSegment): string {
  return `/vendor/${fairSlug}/${segment}`
}

export function isVendorGateCarveOut(pathname: string): boolean {
  const segments = pathname.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean)
  // ['vendor', '<fairSlug>', '<leaf>'] — nothing shorter, nothing deeper.
  if (segments.length !== 3) return false
  if (segments[0] !== 'vendor') return false
  return (VENDOR_GATE_CARVE_OUT_SEGMENTS as readonly string[]).includes(segments[2])
}
