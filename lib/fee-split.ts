// Item 10 / B1.13 STAGE 4 — the Exhibit A split for a feeModel 2 order (BATCH-1 §19 S4-Q1, S4-Q4).
//
// ensureOrderFeeSplit() is called by processOrderPayout for feeModel 2 orders only:
//   - FIRST RUN: plan the split from the REAL Stripe fee with planExhibitAPayout, then write the
//     OrderFeeSplit, one OrderFeeSplitVendor per vendor and (curbside fee or tip > 0) the held
//     PartnerEarning in ONE transaction, BEFORE any transfer.
//   - EVERY LATER RUN (a retry, a held vendor released once connected): read the stored split and
//     pay from it. Never a recalculation, so a vendor paid later gets exactly the share computed
//     the first time, and the rows never change.
// Returns lines in the same shape as lib/payout-split.ts splitStripeFee(), so the payout's outcome
// rules (pay / hold / skip / blocked / already_paid), transfers and Payout rows are reused as is.
import { Prisma } from '@prisma/client'
import { db } from './db'
import { logger } from './logger'
import { planExhibitAPayout, type CardFeesPaidBy } from './fees/exhibit-a'
import type { VendorPayoutLine } from './payout-split'

export interface FeeModel2Split {
  lines: VendorPayoutLine[]
  realStripeFeeCents: number
  fairsynqNetCents: number
  partnerNetCents: number
  created: boolean
}

export async function ensureOrderFeeSplit(input: {
  orderId: string
  eventId: string
  vendorFoodCents: Record<string, number>
  serviceFeeCents: number
  runnerFeeCents: number // the curbside fee (stored in Order.deliveryFee)
  tipCents: number
  cardFeesPaidBy: CardFeesPaidBy
  realStripeFeeCents: number
  /** B1.19: each vendor's stored tax (OrderVendorTax, both parts). Absent = no tax. */
  vendorTaxCents?: Record<string, number>
}): Promise<FeeModel2Split> {
  const existing = await readSplit(input.orderId)
  if (existing) {
    if (existing.realStripeFeeCents !== input.realStripeFeeCents) {
      logger.error('[FeeSplit] stored split fee differs from the balance transaction; paying from the STORED split', {
        orderId: input.orderId, stored: existing.realStripeFeeCents, now: input.realStripeFeeCents,
      })
    }
    return { ...existing, created: false }
  }

  const plan = planExhibitAPayout({
    vendorFoodCents: input.vendorFoodCents,
    serviceFeeCents: input.serviceFeeCents,
    curbsideFeeCents: input.runnerFeeCents,
    tipCents: input.tipCents,
    realStripeFeeCents: input.realStripeFeeCents,
    cardFeesPaidBy: input.cardFeesPaidBy,
    vendorTaxCents: input.vendorTaxCents, // B1.19: paid out with each vendor's food; its processing rides with them
  })
  const vendorIds = Object.keys(input.vendorFoodCents)
  const partnerBase = input.runnerFeeCents + input.tipCents
  try {
    await db.$transaction(async (tx) => {
      const split = await tx.orderFeeSplit.create({
        data: {
          orderId: input.orderId, eventId: input.eventId,
          realStripeFeeCents: input.realStripeFeeCents,
          fairsynqShareCents: plan.feeShares.fairsynq ?? 0,
          fairsynqNetCents: plan.fairsynqNetCents,
          partnerShareCents: plan.feeShares.partner ?? 0,
          partnerNetCents: plan.partnerNetCents,
          cardFeesPaidBy: input.cardFeesPaidBy,
        },
      })
      await tx.orderFeeSplitVendor.createMany({
        data: vendorIds.map(vendorId => ({
          splitId: split.id, orderId: input.orderId, vendorId,
          foodCents: input.vendorFoodCents[vendorId], taxCents: input.vendorTaxCents?.[vendorId] ?? 0,
          feeShareCents: plan.feeShares[vendorId] ?? 0,
          payCents: plan.vendorPayoutCents[vendorId],
        })),
      })
      if (partnerBase > 0) {
        await tx.partnerEarning.create({
          data: { eventId: input.eventId, orderId: input.orderId, amountCents: plan.partnerNetCents, status: 'held' },
        })
      }
    })
  } catch (err) {
    // A concurrent first run created it first (orderId is unique): pay from theirs.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const theirs = await readSplit(input.orderId)
      if (theirs) return { ...theirs, created: false }
    }
    throw err
  }
  logger.warn('[FeeSplit] Exhibit A split recorded', {
    orderId: input.orderId, realStripeFeeCents: input.realStripeFeeCents, feeShares: plan.feeShares,
    fairsynqNetCents: plan.fairsynqNetCents, partnerHeldCents: partnerBase > 0 ? plan.partnerNetCents : 0,
  })
  const stored = await readSplit(input.orderId)
  return { ...stored!, created: true }
}

async function readSplit(orderId: string): Promise<Omit<FeeModel2Split, 'created'> | null> {
  const s = await db.orderFeeSplit.findUnique({ where: { orderId }, include: { vendors: true } })
  if (!s) return null
  // The line's feeShareCents is what is WITHHELD from the vendor's transfer, and it is what the payout writes to
  // Payout.fairSynqFee and VendorEarning.feeShareCents. In PLATFORM mode FairSynq absorbs the vendor's processing,
  // so nothing is withheld: 0, and withheld = gross − net holds in both modes. The absorbed share stays recorded
  // on the split row (OrderFeeSplitVendor.feeShareCents) and in FairSynq's net. (Record fix, 2026-11-20.)
  const platform = s.cardFeesPaidBy === 'PLATFORM'
  return {
    lines: s.vendors
      .sort((a, b) => a.vendorId.localeCompare(b.vendorId))
      .map(v => ({ vendorId: v.vendorId, subtotalCents: v.foodCents, feeShareCents: platform ? 0 : v.feeShareCents, transferCents: v.payCents, taxCents: v.taxCents })),
    realStripeFeeCents: s.realStripeFeeCents,
    fairsynqNetCents: s.fairsynqNetCents,
    partnerNetCents: s.partnerNetCents,
  }
}
