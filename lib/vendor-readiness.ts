// ─────────────────────────────────────────────────────────────────────────────
// Vendor readiness — the SINGLE source of truth for "can customers order from
// this vendor at this fair" (the locked decision-(c) bar).
// ─────────────────────────────────────────────────────────────────────────────
//
// Everything ready-related derives from here so they can never disagree:
//   • the readiness API / checklist UI (what the vendor sees they must finish)
//   • the Phase-5 gates (marketplace visibility + order creation)
//
// THE (c) BAR — a vendor is "ready" (orderable) when ALL of:
//   • approved        — Vendor.status === ACTIVE (organizer approved the application)
//   • stripeConnected — Vendor.stripeVerified === true  (the REAL verified payout
//                       status from Stripe, not merely "has a stripeAccountId")
//   • hasAvailableMenu — ≥1 MenuItem with isAvailable === true
// Booth number is reported (a checklist nicety) but is NOT part of the bar.
//
// Vendors are per-event in this schema (a Vendor row IS an application to one
// fair), so readiness is per-fair.

import { db } from './db'
import { VendorStatus, type Prisma } from '@prisma/client'

// The (c) bar as a Prisma where-fragment. Phase 5's marketplace list/counts filter
// on exactly this, so queries and the readiness function share one definition.
export const readyVendorWhere = {
  status: VendorStatus.ACTIVE,
  stripeVerified: true,
  menuItems: { some: { isAvailable: true } },
} satisfies Prisma.VendorWhereInput

// The (c) bar as an imperative predicate — the mirror of readyVendorWhere for code
// paths that already hold a loaded vendor (the vendor-detail gate, the order
// backstop, the organizer view). computeVendorReadiness uses it too, so there is
// ONE boolean definition of "ready" and it can't drift from the query form.
export function vendorReady(args: { status: string; stripeVerified: boolean; availableMenuCount: number }): boolean {
  return args.status === VendorStatus.ACTIVE && args.stripeVerified === true && args.availableMenuCount > 0
}

// ─── Phase 5 enforcement flag (default OFF) ─────────────────────────────────────
// Gates ALL customer-facing readiness enforcement together (marketplace list,
// vendor detail, order backstop, count badges) so they never disagree. Shipping
// with this OFF changes NOTHING — current behavior exactly. The flip is a
// deliberate, per-fair decision made after the checklist/dashboard/organizer
// nudge have driven vendors to connect.
//
// Single env flag for now (one live fair). The optional `event` param is a seam
// for a future per-event Event.enforceReadiness without reworking call sites — do
// NOT add that schema field yet; just pass the event where callers have it.
export function isVendorReadinessEnforced(_event?: { enforceReadiness?: boolean | null }): boolean {
  // Future: return _event?.enforceReadiness ?? envDefault
  return process.env.ENFORCE_VENDOR_READINESS === 'true'
}

// A Prisma where-fragment that adds the readiness bar ONLY when enforcement is on,
// else an empty object (no behavior change). Surfaces spread this into their where.
export function readinessWhereIfEnforced(event?: { enforceReadiness?: boolean | null }): Prisma.VendorWhereInput {
  return isVendorReadinessEnforced(event) ? readyVendorWhere : {}
}

export interface ReadinessStep {
  key: 'application' | 'stripe' | 'menu' | 'booth'
  label: string
  done: boolean
  required: boolean       // counts toward `ready` (booth does not)
  waiting?: boolean       // application: submitted, awaiting organizer approval
  route: string | null    // the EXISTING page that completes this step (null = no self-serve action)
}

export interface VendorReadiness {
  vendorId: string
  fairSlug: string
  status: VendorStatus
  // Application lifecycle (distinct waiting vs incomplete vs rejected states)
  approved: boolean
  pending: boolean
  rejected: boolean
  // The (c) bar components
  stripeConnected: boolean
  hasAvailableMenu: boolean
  availableMenuCount: number
  // Optional
  boothSet: boolean
  // The verdict — matches readyVendorWhere exactly
  ready: boolean
  steps: ReadinessStep[]
}

/**
 * Compute a vendor's readiness from the real columns — no new data, just a read.
 * Returns null if the vendor doesn't exist. Single DB round-trip (filtered _count
 * for available menu items, same pattern the public vendor list already uses).
 */
export async function computeVendorReadiness(vendorId: string): Promise<VendorReadiness | null> {
  const vendor = await db.vendor.findUnique({
    where: { id: vendorId },
    select: {
      id: true,
      status: true,
      stripeVerified: true,
      boothNumber: true,
      event: { select: { urlSlug: true } },
      _count: { select: { menuItems: { where: { isAvailable: true } } } },
    },
  })
  if (!vendor) return null

  const fairSlug = vendor.event.urlSlug
  const approved = vendor.status === VendorStatus.ACTIVE
  const pending = vendor.status === VendorStatus.PENDING
  const rejected = vendor.status === VendorStatus.REJECTED
  const stripeConnected = vendor.stripeVerified === true
  const availableMenuCount = vendor._count.menuItems
  const hasAvailableMenu = availableMenuCount > 0
  const boothSet = Boolean(vendor.boothNumber && vendor.boothNumber.trim())

  // The (c) bar — booth intentionally excluded. Uses the shared predicate so the
  // checklist verdict and the Phase-5 gates share ONE boolean definition.
  const ready = vendorReady({ status: vendor.status, stripeVerified: vendor.stripeVerified, availableMenuCount })

  const settings = `/vendor/${fairSlug}/settings`
  const steps: ReadinessStep[] = [
    { key: 'application', label: 'Application approved', done: approved, required: true, waiting: pending, route: null },
    { key: 'stripe',      label: 'Connect payouts',     done: stripeConnected,  required: true,  route: settings },
    { key: 'menu',        label: 'Add your menu',        done: hasAvailableMenu, required: true,  route: `/vendor/${fairSlug}/menu` },
    { key: 'booth',       label: 'Set booth number',     done: boothSet,         required: false, route: settings },
  ]

  return {
    vendorId: vendor.id,
    fairSlug,
    status: vendor.status,
    approved,
    pending,
    rejected,
    stripeConnected,
    hasAvailableMenu,
    availableMenuCount,
    boothSet,
    ready,
    steps,
  }
}
