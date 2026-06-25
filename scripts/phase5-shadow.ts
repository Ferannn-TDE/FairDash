import { config } from 'dotenv'; config({ path: '.env.local' })
import { db } from '../lib/db'
import { canAdvance, type MasterStatus } from '../lib/reconcile-order-status'

;(async () => {
  console.log('\n[phase5-shadow] READ-ONLY — bookend analysis (W1 create, W2 placement, W6 payment-fail).\n')

  // W6 race evidence: a 'Payment failed' CANCELLED order that ALSO has vendor rows
  // means it was PLACED (rows created by placePaidOrder) and THEN cancelled by a
  // payment_failed event — i.e. the unguarded `where stripePaymentIntentId` (no
  // status filter) cancelled a non-PENDING order. (PENDING_PAYMENT orders have NO
  // vendor rows — those are created only at placement.)
  const payFailCancelled = await db.order.findMany({
    where: { status: 'CANCELLED' as never, cancellationReason: 'Payment failed' },
    select: { id: true, voidedAt: true, stripeChargeId: true, vendorOrderStatuses: { select: { status: true } } },
  })
  const withRows = payFailCancelled.filter(o => o.vendorOrderStatuses.length > 0)
  const withCharge = payFailCancelled.filter(o => o.stripeChargeId) // charged AND payment-fail-cancelled = suspicious

  console.log(`'Payment failed' CANCELLED orders: ${payFailCancelled.length}`)
  console.log(`  …that have vendor rows (were PLACED then cancelled — W6 race evidence): ${withRows.length}`)
  console.log(`  …that have a stripeChargeId (charged AND payment-fail-cancelled): ${withCharge.length}`)
  withRows.slice(0, 8).forEach(o => console.log(`    ${o.id} rows=[${o.vendorOrderStatuses.map(v => v.status).join(',')}] charge=${o.stripeChargeId ?? '∅'}`))

  // The guard question: would canAdvance even refuse a stale payment-fail on a
  // PLACED order? CANCELLED is a terminal override → canAdvance(PLACED, CANCELLED)
  // is intentionally permissive. So canAdvance does NOT catch this; the fix W6
  // needs is a PENDING_PAYMENT-specific where, not aggregator routing.
  console.log(`\n  canAdvance(PENDING_PAYMENT, CANCELLED) = ${canAdvance('PENDING_PAYMENT' as MasterStatus, 'CANCELLED')}`)
  console.log(`  canAdvance(PLACED, CANCELLED)          = ${canAdvance('PLACED' as MasterStatus, 'CANCELLED')}  ← override is permissive; would NOT refuse a stale pay-fail`)
  console.log(`  canAdvance(COMPLETED, CANCELLED)       = ${canAdvance('COMPLETED' as MasterStatus, 'CANCELLED')}  ← only terminal is protected`)

  await db.$disconnect()
})().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1) })
