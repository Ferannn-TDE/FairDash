/**
 * PREVIEW BYPASS — temporary scaffolding that lets an admin walk a fair's customer flow BEFORE
 * the fair opens (the date-derived live gate correctly hides an upcoming fair's storefront, which
 * also hides it from the people who need to test it).
 *
 * REMOVAL PLAN: this exists only until Italian Fest opens on 2026-08-05. On that date the fair is
 * live, the gate lets everyone through, and this module stops mattering. Delete
 * lib/preview-access.ts, app/api/preview-access, the PreviewBanner + usePreviewAccess in
 * app/fair/[fairSlug]/page.tsx, the health flag, and scripts/preview-bypass-guard.ts — the guard
 * exists partly so the deletion is a single grep for "preview".
 *
 * TWO CONDITIONS, BOTH REQUIRED, BOTH CHECKED SERVER-SIDE:
 *   1. ALLOW_PREVIEW_BYPASS === 'true' — a server env var (deliberately NOT NEXT_PUBLIC_, so it
 *      cannot be flipped in a bundle), default OFF, unset in prod.
 *   2. An authenticated ADMIN session.
 * A signed-out visitor can never pass, even if the flag were somehow set — the flag alone is
 * never sufficient. This is why the decision lives here and is exposed only through an API that
 * runs the auth check, rather than as a client-readable boolean.
 *
 * WHAT IT CHANGES — TWO REAL GATES, and one of them takes money:
 *   1. The storefront UI (app/fair/[fairSlug]/page.tsx) — an upcoming fair's page renders.
 *   2. POST /api/orders (app/api/orders/route.ts:190) — the FAIR_NOT_OPEN refusal is SKIPPED, so
 *      an order can be PLACED and CHARGED for a fair that has not opened.
 * It grants no data the read APIs don't already serve — /api/events/[slug], /api/vendors and the
 * menu queries gate on Event.status === ACTIVE, which an upcoming-but-enabled fair satisfies.
 *
 * ⚠️ It is therefore NOT merely a UI unlock. (This comment previously said it was, and said the
 * order route was unaffected — stale prose on the exact module someone reads to answer that
 * question. The order gate is real; see :46-50 below and orders/route.ts:190.)
 *
 * WHAT IT MUST NOT CHANGE: what any surface SAYS. A previewing admin still sees "Upcoming" on the
 * badge; no copy may claim the fair is live because a tester is inside it. Orders placed in
 * preview are REAL rows against the REAL database — the banner says so in as many words.
 */

/** Condition 1 — the env flag. Server-only, default OFF. */
export function isPreviewBypassEnabled(): boolean {
  return process.env.ALLOW_PREVIEW_BYPASS === 'true'
}

/**
 * The full decision. Both conditions ANDed — kept as a pure function so the guard can prove
 * "flag alone is not enough" and "admin alone is not enough" without a server or a session.
 */
export function computePreviewAccess(input: { flagEnabled: boolean; isAdmin: boolean }): boolean {
  return input.flagEnabled === true && input.isAdmin === true
}

/**
 * The live decision, server-side, NON-THROWING — the one function every caller uses.
 *
 * Two callers now share it: the /api/preview-access probe the storefront asks, and the ORDER
 * WRITE PATH (POST /api/orders), which must refuse an order for a fair that isn't open unless
 * the same preview conditions hold. They must never drift into two answers — that split is
 * exactly what this codebase's through-line class is about, and on the order path the cost is
 * a real charge for a fair that hasn't opened.
 *
 * Returns false (never throws) for a signed-out or non-admin caller: refusal is the ordinary
 * path here, not an error.
 */
export async function hasPreviewAccess(): Promise<boolean> {
  const flagEnabled = isPreviewBypassEnabled()
  // Short-circuit before touching auth: with the flag off, no session can grant access, and an
  // anonymous storefront request shouldn't pay for a Clerk lookup to be told no.
  if (!flagEnabled) return false

  let isAdmin = false
  try {
    const { requireStrictAdminAuth } = await import('./auth')
    await requireStrictAdminAuth()
    isAdmin = true
  } catch {
    isAdmin = false
  }
  return computePreviewAccess({ flagEnabled, isAdmin })
}
