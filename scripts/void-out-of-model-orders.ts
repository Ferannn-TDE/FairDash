/**
 * Void out-of-model test orders via the voidedAt marker. Idempotent.
 *
 * Uses the SAME partition as scripts/classify-out-of-model-orders.ts:
 *   VOID = dev account AND total != subtotal+fee (customer-side mismatch)
 *          AND total == subtotal  (fee recorded but never charged — 7% test era)
 * KEEP (reconciles) and any REVIEW (other mismatch) are NEVER touched.
 *
 * Stripe untouched (test-mode, already settled — no refund). No total rewrite,
 * no delete. Only sets voidedAt + voidReason.
 *
 *   npx tsx scripts/void-out-of-model-orders.ts            # dry-run (default)
 *   npx tsx scripts/void-out-of-model-orders.ts --apply    # write the markers
 */
import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })

const DEV_EMAIL = 'feranmidyro@gmail.com'
const VOID_REASON = 'out-of-model-test-pre-10pct-fee'
const cents = (n: number) => Math.round(n * 100)

async function main() {
  const apply = process.argv.includes('--apply')
  const { db } = await import('../lib/db.js')

  const user = await db.user.findUnique({ where: { email: DEV_EMAIL }, select: { id: true } })
  if (!user) { console.log(`No user for ${DEV_EMAIL}`); await db.$disconnect(); return }

  const orders = await db.order.findMany({
    where: { customerId: user.id },
    select: { id: true, subtotal: true, fairSynqFee: true, deliveryFee: true, serviceCharge: true, total: true, voidedAt: true },
  })

  const toVoid: string[] = []
  let alreadyVoided = 0
  let keep = 0
  let review = 0
  for (const o of orders) {
    const customerSide = cents(o.subtotal) + cents(o.fairSynqFee) + cents(o.deliveryFee ?? 0) + cents(o.serviceCharge ?? 0)
    const reconciles = customerSide === cents(o.total)
    const totalEqualsSubtotal = cents(o.total) === cents(o.subtotal)
    if (reconciles) { keep++; continue }
    if (!totalEqualsSubtotal) { review++; continue } // other mismatch — never auto-void
    if (o.voidedAt) { alreadyVoided++; continue }     // idempotent skip
    toVoid.push(o.id)
  }

  console.log(`\n${DEV_EMAIL}: ${orders.length} orders`)
  console.log(`  KEEP (current-model, reconciles): ${keep}`)
  console.log(`  REVIEW (other mismatch, untouched): ${review}`)
  console.log(`  out-of-model already voided: ${alreadyVoided}`)
  console.log(`  out-of-model to void NOW: ${toVoid.length}`)

  if (!apply) {
    console.log(`\nDRY-RUN — nothing written. Re-run with --apply to set the markers.\n`)
    await db.$disconnect(); return
  }

  const res = await db.order.updateMany({
    where: { id: { in: toVoid }, voidedAt: null },   // belt-and-suspenders idempotency
    data: { voidedAt: new Date(), voidReason: VOID_REASON },
  })

  const totalVoided = await db.order.count({ where: { customerId: user.id, voidedAt: { not: null } } })
  console.log(`\nAPPLIED: voided ${res.count} order(s) this run. Total voided for account now: ${totalVoided}.`)
  console.log(`voidReason='${VOID_REASON}'. Stripe untouched, no totals changed, no rows deleted.\n`)

  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
