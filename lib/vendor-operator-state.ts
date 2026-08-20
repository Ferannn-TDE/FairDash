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

/** Mirrors the Prisma `VendorStatus` enum. Pinned to schema.prisma by the guard. */
export type VendorBoothStatus = 'PENDING' | 'ACTIVE' | 'PAUSED' | 'SUSPENDED' | 'REJECTED'

/**
 * THE BOOTH AXIS — "may this booth trade right now". The second of the two independent
 * questions (schema.prisma:374 spells out the pair); this file's other half answers the
 * operator axis, "may this human operate it". Neither implies the other.
 *
 * ACTIVE and nothing else. That is already the de-facto rule in three server places —
 * order creation (app/api/orders/route.ts:249), the public vendor read
 * (app/api/vendors/[id]/route.ts:93), and readiness (lib/vendor-readiness.ts:108) — and the
 * vendor dashboard's online toggle states it in prose ("usable ONLY when status === ACTIVE",
 * lib/vendor-online-state.ts:8). It lives HERE now so the server gate and the client badge
 * name the same rule instead of four hand-rolled comparisons that can drift apart.
 *
 * ⚠️ NOT the same question as vendorReady() (lib/vendor-readiness.ts:35). That is the (c) bar —
 * ACTIVE *plus* Stripe *plus* a menu — which decides whether CUSTOMERS can see and order from
 * the booth. This decides whether the booth's own operator may act as a live booth. A booth can
 * pass this and fail that (approved, no menu yet); do not substitute one for the other.
 */
export function boothMayOperate(status: string): boolean {
  return status === 'ACTIVE'
}

/**
 * Why a booth may not operate, worded for its own operator. Null when it may.
 *
 * PENDING is deliberately NOT phrased as a fault: `Vendor.status` DEFAULTS to PENDING
 * (schema.prisma:249), so every booth that ever existed passed through it while its operator
 * was still filling the application in. "Not approved yet" is the honest reading, not "refused".
 */
export function boothOperatingMessage(status: string): string | null {
  if (boothMayOperate(status)) return null
  switch (status) {
    case 'PENDING':   return 'This booth is still awaiting approval, so it cannot trade yet.'
    case 'PAUSED':    return 'This booth has been paused by the organizer — contact them to be reactivated.'
    case 'SUSPENDED': return 'This booth has been suspended — contact the organizer.'
    case 'REJECTED':  return 'This booth’s application was declined, so it cannot trade.'
    default:          return 'This booth is not in an operating state.'
  }
}

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
 * this door at all — the server-side re-verification is requireVendorMayOperate() in lib/auth.ts
 * (step 4, now built). It gates ACTING as a booth: the order lifecycle
 * (orders/[id]/vendor-status) and the online/busy verbs (vendors/[id] PATCH). The routes behind
 * the two carve-out pages — vendors/[id]/stripe/*, vendors/[id]/documents — are deliberately
 * NOT gated by it, for the same deadlock reason the carve-out exists. Keep them that way.
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

/**
 * Every view the vendor portal shell can link to, for an ADMITTED operator.
 * (`onboarding` is deliberately absent — it is reached from the gate screen and from the
 * exits-only nav below, not offered as a standing view to someone already working.)
 */
export const VENDOR_PORTAL_NAV_KEYS = ['dashboard', 'orders', 'menu', 'analytics', 'settings'] as const

export type VendorNavKey = (typeof VENDOR_PORTAL_NAV_KEYS)[number] | VendorCarveOutSegment

/**
 * WHICH NAV THE SHELL MAY RENDER — the fix for a real hole, not a cosmetic one.
 *
 * The door is a PAGE gate, and a page gate does not re-run on soft navigation. So while a gated
 * operator is legitimately sitting on a carve-out page (settings/onboarding — which they MUST
 * still reach), the portal shell around them was rendering its full sidebar, and its Dashboard
 * link soft-navigated them straight back into the portal the door had just refused them. The
 * carve-out built to prevent a deadlock was handing out a working way back in.
 *
 * A non-admitted operator therefore gets EXACTLY the carve-out routes as navigation — the same
 * set the door allows and the same set the gate screen links to, by construction rather than by
 * a third hand-written list. Nothing that re-enters the portal.
 *
 * ⚠️ THIS CLOSES THE VISIBLE PATH, NOT THE GATE. A history back/forward, or a soft navigation
 * from a carve-out page, still reaches the dashboard shell, because no layout-level change can
 * survive a soft navigation. (A TYPED URL does not: that is a hard request, the layout re-runs,
 * and the door refuses it — scripts/vendor-operator-gate-test.ts pins that.) Do not read this
 * function as an authorization boundary; it decides what is OFFERED, and the API decides what
 * is SERVED.
 *
 * WHAT SERVES IS NOW REAL: requireVendorMayOperate() (lib/auth.ts) refuses a non-admitted
 * operator on the action verbs, so reaching the shell no longer means being able to use it.
 * This function is therefore back to being what it looks like — navigation polish. If a product
 * decision later wants Dashboard visible to a pending operator, changing THIS is safe; changing
 * VENDOR_GATE_CARVE_OUT_SEGMENTS is not — that constant is also the door's allowlist
 * (isVendorGateCarveOut) and the gate screen's exit set, so adding a key there opens the page.
 */
export function vendorShellNavKeys(state: VendorOperatorState): readonly VendorNavKey[] {
  return state === 'ADMITTED' ? VENDOR_PORTAL_NAV_KEYS : VENDOR_GATE_CARVE_OUT_SEGMENTS
}

export function isVendorGateCarveOut(pathname: string): boolean {
  const segments = pathname.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean)
  // ['vendor', '<fairSlug>', '<leaf>'] — nothing shorter, nothing deeper.
  if (segments.length !== 3) return false
  if (segments[0] !== 'vendor') return false
  return (VENDOR_GATE_CARVE_OUT_SEGMENTS as readonly string[]).includes(segments[2])
}
