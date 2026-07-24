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
 * WHAT IT CHANGES: access to the storefront UI, nothing else. It grants NO data the APIs don't
 * already serve — /api/events/[slug], /api/vendors and the menu queries gate on
 * Event.status === ACTIVE (which an upcoming-but-enabled fair already satisfies), and
 * POST /api/orders likewise. The bypass is a UI unlock, not an authorization change.
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
