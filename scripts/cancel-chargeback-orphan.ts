/**
 * ONE-OFF, DELIBERATE PROD OPERATION — cancel the chargeback orphan on Italian Fest 2026.
 *
 * WHAT: order cmrgp7oeq0001pcsd81dvtfit (Jul 11 2026). Both vendors' transfers were made, then
 * reversed by a lost dispute (FairSynq fronted the shortfall: the two open dispute_clawback
 * debts Pattern K reports). Their VendorEarning rows stayed 'accrued', so the ledger says
 * All Pro Tees is owed $60.00 and Randy's House of BBQ $40.00 for an order that was charged
 * back. This script cancels exactly those two earnings. Nothing else.
 *
 * NOT TOUCHED: the two dispute debts (what the vendors owe FairSynq is a separate question),
 * the transfers and their Payout rows, the other eight accrued Italian Fest earnings (the
 * stranded Jul 17 and delivered test earnings, left alone on purpose), and every other order.
 *
 * REFUSES (writes nothing at all) unless, for EVERY named vendor on the order:
 *   - the earning exists with the expected subtotal and is 'accrued' (or already cancelled by
 *     this script, which makes a re-run a no-op);
 *   - a Payout row exists for that order + vendor, reversed (reversedAt set, status 'reversed');
 *   - an OPEN dispute_clawback debt exists for that order + vendor.
 *
 * WRITES, per earning, in one transaction: the conditional flip accrued → cancelled and, only if
 * that flip changed the row, one AdminMoneyAction CANCEL (actor admin /
 * script:cancel-chargeback-orphan, reason naming the transfer, reversal and debt, "approved by
 * Feran"). Through guardedPrisma, so the protected-event guard demands ALLOW_PROD_WRITES=true.
 *
 * RECEIPT: counts come from the write results, then a final re-read must show every named earning
 * cancelled with exactly one audit row from this script. Idempotent: a re-run changes nothing.
 *
 * Run (dry run first; the real run needs --confirm and ALLOW_PROD_WRITES=true):
 *   CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx tsx scripts/cancel-chargeback-orphan.ts
 *   CONFIRM_PROD_DB=<ref> ALLOW_PROD_WRITES=true ./scripts/with-prod-db.sh npx tsx scripts/cancel-chargeback-orphan.ts --confirm
 */

import type { PrismaClient } from '@prisma/client'
import { writeMoneyAudit, type MoneyActor } from '../lib/admin-money'

export const ORPHAN_ACTOR: MoneyActor = { id: 'script:cancel-chargeback-orphan', type: 'admin' }

/** The production orphan, as traced read-only on 2026-11-07. */
export const PROD_ORPHAN = {
  orderId: 'cmrgp7oeq0001pcsd81dvtfit',
  vendors: [
    { vendorId: 'cmni6x68q000211znxtpw0076', subtotalCents: 6000 }, // ALL PRO TEES
    { vendorId: 'cmni6x6gz000611znpe5c5hhp', subtotalCents: 4000 }, // RANDY'S HOUSE OF BBQ
  ],
}

export interface OrphanSpec { orderId: string; vendors: { vendorId: string; subtotalCents: number }[] }

export interface OrphanReceipt {
  refused: string | null
  planned: number
  alreadyCancelled: number
  cancelled: number
  ok: boolean
  rows: { vendorId: string; earningId: string; subtotalCents: number; status: string; transferId: string; reversalId: string | null; debtIds: string[] }[]
}

type Client = Pick<PrismaClient, 'vendorEarning' | 'payout' | 'negativeBalanceEvent' | 'adminMoneyAction' | '$transaction'>

export async function cancelChargebackOrphan(client: Client, spec: OrphanSpec, opts: { confirm: boolean }): Promise<OrphanReceipt> {
  const receipt: OrphanReceipt = { refused: null, planned: 0, alreadyCancelled: 0, cancelled: 0, ok: false, rows: [] }
  const refuse = (why: string) => { receipt.refused = why; return receipt }
  if (spec.vendors.length === 0) return refuse('no vendors named')

  const plan: { vendorId: string; earningId: string; eventId: string; subtotalCents: number; transferId: string; reversalId: string | null; debtIds: string[] }[] = []
  for (const v of spec.vendors) {
    const e = await client.vendorEarning.findUnique({
      where: { orderId_vendorId: { orderId: spec.orderId, vendorId: v.vendorId } },
      select: { id: true, eventId: true, status: true, subtotalCents: true },
    })
    if (!e) return refuse(`vendor ${v.vendorId}: no earning on order ${spec.orderId}`)
    if (e.subtotalCents !== v.subtotalCents) return refuse(`vendor ${v.vendorId}: earning is ${e.subtotalCents}¢, expected ${v.subtotalCents}¢`)
    const p = await client.payout.findFirst({
      where: { orderId: spec.orderId, vendorId: v.vendorId },
      select: { stripeTransferId: true, stripeStatus: true, reversedAt: true, stripeReversalId: true },
    })
    if (!p) return refuse(`vendor ${v.vendorId}: no transfer record — not a chargeback orphan`)
    if (p.reversedAt == null || p.stripeStatus !== 'reversed') return refuse(`vendor ${v.vendorId}: transfer ${p.stripeTransferId} is '${p.stripeStatus}', not reversed`)
    const debts = await client.negativeBalanceEvent.findMany({
      where: { orderId: spec.orderId, vendorId: v.vendorId, kind: 'dispute_clawback', status: 'open' },
      select: { id: true },
    })
    if (debts.length === 0) return refuse(`vendor ${v.vendorId}: no open dispute_clawback debt — not a chargeback`)

    if (e.status === 'cancelled') {
      const mine = await client.adminMoneyAction.count({ where: { earningId: e.id, action: 'CANCEL', actorId: ORPHAN_ACTOR.id } })
      if (mine === 0) return refuse(`vendor ${v.vendorId}: earning already cancelled by someone else — leaving it`)
      receipt.alreadyCancelled++
    } else if (e.status !== 'accrued') {
      return refuse(`vendor ${v.vendorId}: earning is '${e.status}', not accrued`)
    }
    plan.push({ vendorId: v.vendorId, earningId: e.id, eventId: e.eventId, subtotalCents: e.subtotalCents, transferId: p.stripeTransferId, reversalId: p.stripeReversalId, debtIds: debts.map(d => d.id) })
    receipt.rows.push({ vendorId: v.vendorId, earningId: e.id, subtotalCents: e.subtotalCents, status: e.status, transferId: p.stripeTransferId, reversalId: p.stripeReversalId, debtIds: debts.map(d => d.id) })
  }
  receipt.planned = receipt.rows.filter(r => r.status === 'accrued').length
  if (!opts.confirm) { receipt.ok = true; return receipt }

  for (const r of plan) {
    const changed = await client.$transaction(async (tx) => {
      const res = await tx.vendorEarning.updateMany({ where: { id: r.earningId, status: 'accrued' }, data: { status: 'cancelled' } })
      if (res.count !== 1) return 0
      await writeMoneyAudit(ORPHAN_ACTOR, r.eventId, {
        action: 'CANCEL',
        payeeType: 'vendor',
        payeeId: r.vendorId,
        orderId: spec.orderId,
        earningId: r.earningId,
        amountCents: r.subtotalCents,
        reason:
          `Chargeback orphan: transfer ${r.transferId} was reversed by the dispute (reversal ${r.reversalId ?? 'unknown'}; ` +
          `open dispute debt ${r.debtIds.join(', ')}), so the vendor is not owed for this order. One-off cleanup, approved by Feran.`,
        metadata: { script: 'cancel-chargeback-orphan', transferId: r.transferId, reversalId: r.reversalId, debtIds: r.debtIds },
      }, tx)
      return 1
    })
    receipt.cancelled += changed
  }

  // Final state, re-read: every named earning cancelled, exactly one audit from this script each.
  let ok = true
  for (const r of plan) {
    const e = await client.vendorEarning.findUnique({ where: { id: r.earningId }, select: { status: true } })
    const audits = await client.adminMoneyAction.count({ where: { earningId: r.earningId, action: 'CANCEL', actorId: ORPHAN_ACTOR.id } })
    if (e?.status !== 'cancelled' || audits !== 1) ok = false
  }
  receipt.ok = ok
  return receipt
}

async function main() {
  const confirm = process.argv.includes('--confirm')
  if (confirm && process.env.ALLOW_PROD_WRITES !== 'true') {
    console.error('🛑 refusing: --confirm is a deliberate prod write — re-run with ALLOW_PROD_WRITES=true')
    process.exit(1)
  }
  const { guardedPrisma } = await import('../lib/prod-write-guard')
  const client = guardedPrisma() as unknown as Client & { $disconnect(): Promise<void> }
  const sumAccrued = async () => (await client.vendorEarning.aggregate({ where: { orderId: PROD_ORPHAN.orderId, status: 'accrued' }, _sum: { subtotalCents: true } }))._sum.subtotalCents ?? 0
  try {
    console.log(`${confirm ? 'REAL RUN' : 'DRY RUN (no writes)'} — chargeback orphan on order ${PROD_ORPHAN.orderId}`)
    const before = await sumAccrued()
    const r = await cancelChargebackOrphan(client, PROD_ORPHAN, { confirm })
    for (const row of r.rows) console.log(' ', JSON.stringify(row))
    if (r.refused) { console.error(`🛑 REFUSED, nothing written: ${r.refused}`); process.exit(1) }
    const after = await sumAccrued()
    console.log(`planned=${r.planned} alreadyCancelled=${r.alreadyCancelled} cancelled=${r.cancelled} (from write results)`)
    console.log(`accrued on this order: $${(before / 100).toFixed(2)} → $${(after / 100).toFixed(2)}`)
    console.log(r.ok ? `✅ final state re-read agrees${confirm ? '' : ' (dry run: would cancel the rows listed)'}` : '❌ final state does NOT match — investigate')
    process.exit(r.ok ? 0 : 1)
  } finally {
    await client.$disconnect()
  }
}

if (process.argv[1]?.endsWith('cancel-chargeback-orphan.ts')) {
  main().catch(e => { console.error('💥', e); process.exit(1) })
}
