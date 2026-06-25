/**
 * DRY-RUN classifier for out-of-model test orders. READ-ONLY — writes nothing.
 *
 * Confirmed context: feranmidyro@gmail.com (dev account) placed test orders
 * under an old 7% subtotal-only fee model (fee recorded but NOT added to the
 * charge), predating the current 10% fee-on-top model. These fail the current
 * money identity and the reconciler correctly refuses to pay them.
 *
 * This lists the full blast radius BEFORE anything is voided, and — critically —
 * proves the criterion excludes every current-model (10%, fee-on-top) order.
 *
 * Classification per order (money in integer cents):
 *   customerSide = subtotal + fairSynqFee + deliveryFee + serviceCharge
 *   KEEP   (current-model)  : total == customerSide        → reconciles, payable
 *   VOID   (out-of-model)   : total != customerSide AND total == subtotal
 *                             (fee omitted from the charge — the test signature)
 *   REVIEW (other mismatch) : fails to reconcile some OTHER way → do NOT auto-void
 *
 *   npx tsx scripts/classify-out-of-model-orders.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })

const DEV_EMAIL = 'feranmidyro@gmail.com'
const cents = (n: number) => Math.round(n * 100)

async function main() {
  const { db } = await import('../lib/db.js')

  const user = await db.user.findUnique({ where: { email: DEV_EMAIL }, select: { id: true } })
  if (!user) { console.log(`No user for ${DEV_EMAIL}`); await db.$disconnect(); return }

  const orders = await db.order.findMany({
    where: { customerId: user.id },
    select: {
      id: true, status: true, createdAt: true,
      subtotal: true, fairSynqFee: true, deliveryFee: true, serviceCharge: true, total: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const VOID: typeof orders = []
  const KEEP: typeof orders = []
  const REVIEW: typeof orders = []

  for (const o of orders) {
    const customerSide = cents(o.subtotal) + cents(o.fairSynqFee) + cents(o.deliveryFee ?? 0) + cents(o.serviceCharge ?? 0)
    const reconciles = customerSide === cents(o.total)
    const totalEqualsSubtotal = cents(o.total) === cents(o.subtotal)
    if (reconciles) KEEP.push(o)
    else if (totalEqualsSubtotal) VOID.push(o)
    else REVIEW.push(o)
  }

  const row = (o: typeof orders[number]) => {
    const rate = o.subtotal > 0 ? (o.fairSynqFee / o.subtotal * 100).toFixed(1) + '%' : '—'
    return `  ${o.id}  ${o.createdAt.toISOString().slice(0, 10)}  charge=$${o.total.toFixed(2).padStart(7)}  ` +
      `sub=$${o.subtotal.toFixed(2).padStart(7)} fee=$${o.fairSynqFee.toFixed(2).padStart(6)} total=$${o.total.toFixed(2).padStart(7)}  ` +
      `rate=${rate.padStart(6)}  ${o.status}`
  }

  console.log(`\n=== VOID candidates (out-of-model: total==subtotal, fee not added) — ${VOID.length} ===`)
  VOID.forEach(o => console.log(row(o)))

  console.log(`\n=== KEEP (current-model, reconciles: total==subtotal+fee) — ${KEEP.length} ===`)
  KEEP.forEach(o => console.log(row(o)))

  if (REVIEW.length) {
    console.log(`\n=== ⚠ REVIEW (fails to reconcile some OTHER way — NOT auto-voided) — ${REVIEW.length} ===`)
    REVIEW.forEach(o => console.log(row(o)))
  }

  // Safety proof: no KEEP order is in the VOID set, and every KEEP reconciles.
  const keepAllReconcile = KEEP.every(o =>
    cents(o.subtotal) + cents(o.fairSynqFee) + cents(o.deliveryFee ?? 0) + cents(o.serviceCharge ?? 0) === cents(o.total))
  const keepRates = [...new Set(KEEP.map(o => o.subtotal > 0 ? Math.round(o.fairSynqFee / o.subtotal * 100) : 0))].sort()
  const voidRates = [...new Set(VOID.map(o => o.subtotal > 0 ? Math.round(o.fairSynqFee / o.subtotal * 100) : 0))].sort()

  console.log('\n' + '─'.repeat(70))
  console.log(`TOTALS for ${DEV_EMAIL}: ${orders.length} orders`)
  console.log(`  VOID (out-of-model): ${VOID.length}`)
  console.log(`  KEEP (current-model): ${KEEP.length}   all reconcile? ${keepAllReconcile ? 'YES ✅' : 'NO ❌'}`)
  console.log(`  REVIEW (other):       ${REVIEW.length}`)
  console.log(`  implied fee rates — VOID: ${voidRates.map(r => r + '%').join(', ')}   KEEP: ${keepRates.map(r => r + '%').join(', ')}`)
  console.log('─'.repeat(70))
  console.log('\nDRY-RUN ONLY — nothing was written. Confirm the list before voiding.\n')

  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
