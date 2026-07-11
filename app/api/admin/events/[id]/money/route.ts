import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

// GET /api/admin/events/[id]/money
//
// C1 — the admin MONEY VIEW for one fair. Read-only; moves nothing.
//
// Answers: what is FairSynq holding, who is it owed to, and what have I (the admin)
// already frozen or held? Every figure is read from the LEDGERS — the same rows the
// payout executors read — so the view cannot drift from what will actually be paid.
// It deliberately does NOT recompute money from order fields: that would be a second
// source of truth, which is the mistake the whole payout design avoids.
//
// PLATFORM BALANCE is the one live Stripe read (stripe.balance.retrieve with NO
// stripeAccount param = the PLATFORM's own balance, not a connected account's). It is
// account-wide, NOT per-fair — Stripe has no concept of your fairs. It is reported
// separately and labelled as such, so nobody reads it as "this fair's money".
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)

    const [vendorEarnings, runnerEarnings, organizerEarnings, batches, holds, organizer] =
      await Promise.all([
        db.vendorEarning.findMany({
          where: { eventId: event.id },
          select: {
            id: true, orderId: true, vendorId: true, subtotalCents: true, netCents: true,
            status: true, stripeTransferId: true, paidAt: true, createdAt: true,
            vendor: { select: { name: true, payoutsFrozenAt: true, payoutsFrozenReason: true, stripeVerified: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        db.runnerEarning.findMany({
          where: { eventId: event.id },
          select: {
            id: true, orderId: true, runnerId: true, amountCents: true,
            status: true, stripeTransferId: true, paidAt: true, createdAt: true,
            runner: {
              select: {
                payoutsFrozenAt: true, payoutsFrozenReason: true, stripeVerified: true,
                user: { select: { name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        db.organizerEarning.findMany({
          where: { eventId: event.id },
          select: { id: true, orderId: true, amountCents: true, status: true, batchId: true, paidAt: true },
          orderBy: { createdAt: 'desc' },
        }),
        db.organizerPayout.findMany({
          where: { eventId: event.id },
          select: { id: true, totalCents: true, status: true, stripeTransferId: true, paidAt: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        }),
        // The PASSIVE holds (unconnected / non-positive). Shown separately from admin
        // holds because they mean something completely different: these self-release
        // when the vendor connects; an admin hold never does.
        db.payoutHold.findMany({
          where: { eventId: event.id, resolved: false },
          select: { orderId: true, vendorId: true, amountCents: true, reason: true },
        }),
        event.organizerId
          ? db.fairOrganizer.findUnique({
              where: { id: event.organizerId },
              select: { id: true, name: true, payoutsFrozenAt: true, payoutsFrozenReason: true, stripeVerified: true },
            })
          : Promise.resolve(null),
      ])

    // Owed = accrued/tracked (payable) + held + cancelled. All three are money sitting
    // in the platform balance. 'cancelled' is broken out because it is NOT owed onward
    // — it is money the admin decided isn't the payee's — but it is still HERE, so
    // hiding it would make the fair's money fail to add up.
    const sum = <T,>(rows: T[], pick: (r: T) => number, pred: (r: T) => boolean) =>
      rows.filter(pred).reduce((s, r) => s + pick(r), 0)

    const vendorTotals = {
      payableCents:  sum(vendorEarnings, e => e.subtotalCents, e => e.status === 'accrued'),
      adminHeldCents: sum(vendorEarnings, e => e.subtotalCents, e => e.status === 'held'),
      cancelledCents: sum(vendorEarnings, e => e.subtotalCents, e => e.status === 'cancelled'),
      paidCents:     sum(vendorEarnings, e => e.netCents ?? 0,  e => e.status === 'paid'),
    }
    const runnerTotals = {
      payableCents:  sum(runnerEarnings, e => e.amountCents, e => e.status === 'tracked'),
      adminHeldCents: sum(runnerEarnings, e => e.amountCents, e => e.status === 'held'),
      cancelledCents: sum(runnerEarnings, e => e.amountCents, e => e.status === 'cancelled'),
      paidCents:     sum(runnerEarnings, e => e.amountCents, e => e.status === 'paid'),
    }
    const organizerTotals = {
      payableCents:  sum(organizerEarnings, e => e.amountCents, e => e.status === 'accrued'),
      adminHeldCents: sum(organizerEarnings, e => e.amountCents, e => e.status === 'held'),
      cancelledCents: sum(organizerEarnings, e => e.amountCents, e => e.status === 'cancelled'),
      paidCents:     sum(organizerEarnings, e => e.amountCents, e => e.status === 'paid'),
    }

    // Live platform balance. Best-effort: a Stripe outage must NOT blank the ledger
    // view — the ledgers are the part that matters and they're already read.
    let platformBalance: { availableCents: number; pendingCents: number; currency: string } | null = null
    try {
      const bal = await stripe.balance.retrieve()
      platformBalance = {
        availableCents: bal.available.find(b => b.currency === 'usd')?.amount ?? 0,
        pendingCents:   bal.pending.find(b => b.currency === 'usd')?.amount ?? 0,
        currency: 'usd',
      }
    } catch (err) {
      logger.warn('[AdminMoney] platform balance unavailable', { error: String(err) })
    }

    // Recent admin actions on this fair's money — the audit trail, surfaced.
    const recentActions = await db.adminMoneyAction.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return success({
      fair: { id: event.id, name: event.name, urlSlug: event.urlSlug },

      // ACCOUNT-WIDE, not this fair's. Stripe knows nothing about fairs.
      platformBalance,
      platformBalanceNote:
        'Platform-wide Stripe balance across ALL fairs — not scoped to this fair. Per-fair figures come from the ledgers below.',

      vendors: {
        totals: vendorTotals,
        frozen: vendorEarnings
          .filter(e => e.vendor.payoutsFrozenAt)
          .map(e => ({ vendorId: e.vendorId, name: e.vendor.name, reason: e.vendor.payoutsFrozenReason })),
        earnings: vendorEarnings,
      },
      runners: {
        totals: runnerTotals,
        earnings: runnerEarnings,
      },
      organizer: {
        totals: organizerTotals,
        payee: organizer,
        batches,
        earnings: organizerEarnings,
      },

      // Passive, self-releasing holds — NOT admin holds. Kept visually distinct so an
      // admin never mistakes "waiting for the vendor to connect" for "I stopped this".
      passiveHolds: holds,

      recentAdminActions: recentActions,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
