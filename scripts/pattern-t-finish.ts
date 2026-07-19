/** Finish the supervised Pattern-T cleanup (idempotent). Cancels remaining phantoms,
 *  reconciler-attributed. FINAL positive control: Italian Fest payable = $260.00 exactly. */
import { config } from 'dotenv'; config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { reverseAccrualForRefundedPortion } from '../lib/reverse-accrual'
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const EVENT = 'cmni6x63n000011znjwlln5k2', NON_PAYABLE = ['REFUNDED','DECLINED','CANCELLED']
async function payable() { return (await p.vendorEarning.findMany({ where: { eventId: EVENT, status: 'accrued' }, select: { subtotalCents: true } })).reduce((s,r)=>s+r.subtotalCents,0) }
async function main() {
  const acc = await p.vendorEarning.findMany({ where: { eventId: EVENT, status: 'accrued' }, select: { orderId: true, vendorId: true, order: { select: { vendorOrderStatuses: { select: { vendorId: true, status: true } } } } } })
  const remaining = acc.filter(e => NON_PAYABLE.includes(e.order.vendorOrderStatuses.find(v=>v.vendorId===e.vendorId)?.status ?? ''))
  console.log(`Finishing: ${remaining.length} phantoms remain.`)
  let n = 0
  for (const e of remaining) {
    const r = await reverseAccrualForRefundedPortion({ orderId: e.orderId, vendorId: e.vendorId, actor: { id: 'reconciler', type: 'reconciler' }, reason: 'reconciler Pattern-T backstop: accrued on a refunded portion — no earning owed (supervised residual cleanup)', dryRun: false })
    if (r.reversed) n++
  }
  const after = await payable()
  const totalRecCancels = await p.adminMoneyAction.count({ where: { eventId: EVENT, actorType: 'reconciler', action: 'CANCEL' } })
  const stillPhantom = (await p.vendorEarning.findMany({ where: { eventId: EVENT, status: 'accrued' }, select: { orderId: true, vendorId: true, order: { select: { vendorOrderStatuses: { select: { vendorId: true, status: true } } } } } })).filter(e => NON_PAYABLE.includes(e.order.vendorOrderStatuses.find(v=>v.vendorId===e.vendorId)?.status ?? '')).length
  const ok = after === 26000 && stillPhantom === 0 && totalRecCancels === 148
  console.log(`Cancelled ${n} this run. Reconciler CANCEL total=${totalRecCancels}. Remaining phantoms=${stillPhantom}.`)
  console.log(`\n── FINAL POSITIVE CONTROL ──`)
  console.log(`  Italian Fest payable = $${(after/100).toFixed(2)}  (expected $260.00)  ${after===26000?'✅':'❌'}`)
  console.log(`  reconciler CANCELs = ${totalRecCancels} (expected 148)  ${totalRecCancels===148?'✅':'❌'}`)
  console.log(`  remaining phantoms = ${stillPhantom} (expected 0)  ${stillPhantom===0?'✅':'❌'}`)
  console.log(`\n${ok ? '✅ CLEANUP COMPLETE — 148 phantoms cancelled (reconciler), payable = $260.00 exactly.' : '❌ investigate'}`)
}
main().catch(e=>{console.error('💥',e);process.exit(1)}).finally(()=>p.$disconnect())
