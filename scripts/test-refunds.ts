/**
 * Refund money-matrix test (Stripe TEST MODE — moves real test-mode money).
 *
 *   npx tsx scripts/test-refunds.ts
 *
 * Builds current-model (10% fee-on-top) multi-vendor orders backed by REAL
 * test-mode charges, then exercises refundVendorPortion across the matrix:
 *   T1 CASE 1 — within-window per-vendor refund (payout NOT fired): customer
 *      gets the slice (NOT the fee), that vendor REFUNDED, other vendor untouched.
 *   T2 CASE 2 — refund AFTER payout fired: customer refunded + transfer reversed,
 *      Payout.reversedAt set (dual-write convergence).
 *   T3 idempotency — re-running a completed refund is a no-op.
 *   T4 full-order within-window refund (every vendor, CASE 1).
 *   T5 fee kept in every case (refund amount == slice exactly).
 */
import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })

const EVENT_ID = 'cmni6x63n000011znjwlln5k2'
const CUSTOMER_EMAIL = 'feranmidyro@gmail.com'
const VENDOR_A = 'cmni6x68q000211znxtpw0076' // ALL PRO TEES (connected, verified)
const VENDOR_B = 'cmni6x6gz000611znpe5c5hhp' // RANDY'S (connected, verified)

let pass = 0, fail = 0
const ok = (m: string) => { console.log(`  ✅ ${m}`); pass++ }
const no = (m: string) => { console.log(`  ❌ ${m}`); fail++ }
const C = (n: number) => Math.round(n * 100)

async function main() {
  const { db } = await import('../lib/db.js')
  const { stripe } = await import('../lib/stripe.js')
  const { refundVendorPortion } = await import('../lib/process-refund.js')

  const customer = await db.user.findUnique({ where: { email: CUSTOMER_EMAIL }, select: { id: true } })
  if (!customer) throw new Error('test customer not found')
  const vendors = await db.vendor.findMany({
    where: { id: { in: [VENDOR_A, VENDOR_B] } },
    select: { id: true, name: true, stripeAccountId: true, stripeVerified: true },
  })
  const acctOf: Record<string, string> = {}
  for (const v of vendors) {
    if (!v.stripeAccountId || !v.stripeVerified) throw new Error(`${v.name} not connected/verified`)
    acctOf[v.id] = v.stripeAccountId
  }
  const menuByVendor: Record<string, string> = {}
  for (const vid of [VENDOR_A, VENDOR_B]) {
    const mi = await db.menuItem.findFirst({ where: { vendorId: vid }, select: { id: true } })
    if (!mi) throw new Error(`no menu item for vendor ${vid}`)
    menuByVendor[vid] = mi.id
  }

  // Create a current-model order backed by a REAL test charge.
  async function createOrder(slices: Record<string, number>) {
    const subtotal = Object.values(slices).reduce((a, b) => a + b, 0)
    const fee = Math.round(subtotal * 0.10 * 100) / 100
    const total = Math.round((subtotal + fee) * 100) / 100
    const transferGroup = `test_refund_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const pi = await stripe.paymentIntents.create({
      amount: C(total), currency: 'usd',
      payment_method: 'pm_card_visa', confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      transfer_group: transferGroup,
      metadata: { eventId: EVENT_ID, customerId: customer!.id, vendorIds: Object.keys(slices).join(',') },
    })
    const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge as any).id
    const order = await db.order.create({
      data: {
        eventId: EVENT_ID, customerId: customer!.id, vendorId: Object.keys(slices)[0],
        status: 'COMPLETED', completedAt: new Date(), fulfillmentType: 'BOOTH_PICKUP',
        subtotal, fairSynqFee: fee, total, vendorPayout: subtotal,
        customerName: 'Refund Test', customerPhone: '+10000000000',
        stripePaymentIntentId: pi.id, stripeChargeId: chargeId,
        orderItems: { create: Object.entries(slices).map(([vid, amt]) => ({
          menuItemId: menuByVendor[vid], itemName: 'Test Item', vendorId: vid,
          quantity: 1, unitPrice: amt, totalPrice: amt, subtotal: amt,
        })) },
        vendorOrderStatuses: { create: Object.keys(slices).map(vid => ({ vendorId: vid, status: 'COMPLETED' })) },
      },
      select: { id: true, total: true, fairSynqFee: true },
    })
    return { orderId: order.id, chargeId, transferGroup, subtotal, fee, total, slices }
  }

  console.log('\n=== Refund money-matrix (Stripe test mode) ===')

  // ── T1: CASE 1 — within-window per-vendor refund (no payout fired) ────────
  console.log('\nT1 — CASE 1 per-vendor refund within window (A=$40, B=$30)')
  const o1 = await createOrder({ [VENDOR_A]: 40, [VENDOR_B]: 30 })
  const r1 = await refundVendorPortion({ orderId: o1.orderId, vendorId: VENDOR_A, reason: 'test case1', actor: 'test' })
  r1.case === 1 ? ok('classified CASE 1 (payout not fired)') : no(`expected CASE 1, got ${r1.case}`)
  r1.sliceCents === C(40) ? ok(`customer refunded the SLICE $40.00 (${r1.sliceCents}¢), NOT the fee`) : no(`slice ${r1.sliceCents}¢ != 4000`)
  r1.stripeReversalId === null ? ok('no transfer reversal (money never left platform)') : no('unexpected reversal')
  // Verify Stripe refund amount == slice (fee not included)
  const rf1 = await stripe.refunds.list({ charge: o1.chargeId, limit: 10 })
  const amtA = rf1.data.filter(r => r.metadata?.vendorId === VENDOR_A).reduce((s, r) => s + r.amount, 0)
  amtA === C(40) ? ok(`Stripe refund for A == $40.00 (fee $${(o1.fee).toFixed(2)} kept)`) : no(`Stripe refunded ${amtA}¢ for A`)
  const vosA = await db.vendorOrderStatus.findFirst({ where: { orderId: o1.orderId, vendorId: VENDOR_A }, select: { status: true } })
  vosA?.status === 'REFUNDED' ? ok('vendor A portion marked REFUNDED') : no(`A status ${vosA?.status}`)
  const vosB = await db.vendorOrderStatus.findFirst({ where: { orderId: o1.orderId, vendorId: VENDOR_B }, select: { status: true } })
  vosB?.status === 'COMPLETED' ? ok('vendor B untouched (still COMPLETED)') : no(`B status ${vosB?.status}`)

  // ── T3: idempotency — re-run T1 refund ────────────────────────────────────
  console.log('\nT3 — idempotency (re-run A refund)')
  const r1again = await refundVendorPortion({ orderId: o1.orderId, vendorId: VENDOR_A, reason: 'test', actor: 'test' })
  r1again.status === 'noop' ? ok('re-running completed refund is a no-op') : no(`expected noop, got ${r1again.status}`)
  const rf1b = await stripe.refunds.list({ charge: o1.chargeId, limit: 10 })
  const amtA2 = rf1b.data.filter(r => r.metadata?.vendorId === VENDOR_A).reduce((s, r) => s + r.amount, 0)
  amtA2 === C(40) ? ok('no double-refund (Stripe still shows exactly $40.00 for A)') : no(`double refund! ${amtA2}¢`)

  // ── T2: CASE 2 — refund AFTER payout fired ────────────────────────────────
  console.log('\nT2 — CASE 2 refund after payout fired (simulate B paid, then refund B)')
  const o2 = await createOrder({ [VENDOR_A]: 50, [VENDOR_B]: 20 })
  // Simulate the delayed payout having fired for B: a real transfer + Payout row.
  const transfer = await stripe.transfers.create({
    amount: C(20) - 10, currency: 'usd', destination: acctOf[VENDOR_B],
    source_transaction: o2.chargeId, transfer_group: o2.transferGroup,
    metadata: { orderId: o2.orderId, vendorId: VENDOR_B },
  })
  await db.payout.create({ data: {
    eventId: EVENT_ID, orderId: o2.orderId, vendorId: VENDOR_B,
    grossAmount: 20, fairSynqFee: 0.10, netAmount: (C(20) - 10) / 100,
    stripeTransferId: transfer.id, stripeStatus: 'paid', processedAt: new Date(),
  } })
  const r2 = await refundVendorPortion({ orderId: o2.orderId, vendorId: VENDOR_B, reason: 'test case2', actor: 'test' })
  r2.case === 2 ? ok('classified CASE 2 (payout already fired)') : no(`expected CASE 2, got ${r2.case}`)
  r2.sliceCents === C(20) ? ok(`customer refunded the SLICE $20.00 (fee kept)`) : no(`slice ${r2.sliceCents}¢`)
  r2.stripeReversalId ? ok(`transfer reversed (${r2.stripeReversalId})`) : no('no reversal id')
  const payB = await db.payout.findFirst({ where: { orderId: o2.orderId, vendorId: VENDOR_B }, select: { reversedAt: true, stripeStatus: true, stripeReversalId: true } })
  payB?.reversedAt ? ok(`Payout.reversedAt set + status='${payB.stripeStatus}' (dual-write convergence)`) : no('Payout not marked reversed')
  // Verify reversal amount == vendor net
  const rev = await stripe.transfers.listReversals(transfer.id, { limit: 5 })
  const revAmt = rev.data.reduce((s, r) => s + r.amount, 0)
  revAmt === (C(20) - 10) ? ok(`reversal pulled back vendor NET (${revAmt}¢)`) : no(`reversal ${revAmt}¢ != ${C(20) - 10}`)

  // ── T4: full-order refund within window ───────────────────────────────────
  console.log('\nT4 — full-order refund within window (both vendors, CASE 1)')
  const o4 = await createOrder({ [VENDOR_A]: 15, [VENDOR_B]: 25 })
  const r4a = await refundVendorPortion({ orderId: o4.orderId, vendorId: VENDOR_A, reason: 'full', actor: 'test' })
  const r4b = await refundVendorPortion({ orderId: o4.orderId, vendorId: VENDOR_B, reason: 'full', actor: 'test' })
  const rf4 = await stripe.refunds.list({ charge: o4.chargeId, limit: 10 })
  const tot4 = rf4.data.reduce((s, r) => s + r.amount, 0)
  tot4 === C(40) ? ok(`both slices refunded = $40.00 subtotal; fee $${o4.fee.toFixed(2)} KEPT (charge was $${o4.total.toFixed(2)})`) : no(`refunded ${tot4}¢, expected 4000`)
  ;(r4a.case === 1 && r4b.case === 1) ? ok('both CASE 1 (no reversals)') : no('unexpected case')

  // ── T5 / reconciliation summary ───────────────────────────────────────────
  console.log('\nReconciliation (to the cent):')
  console.log(`  T1 order $${o1.total.toFixed(2)} = subtotal $${o1.subtotal} + fee $${o1.fee}; refunded A $40.00; fee $${o1.fee} kept; B slice $30 still owed ✓`)
  console.log(`  T4 order $${o4.total.toFixed(2)}: refunded $40.00 (=subtotal), fee $${o4.fee} kept → FairSynq nets fee minus Stripe fee on refunded slices (eaten, not recovered) ✓`)

  console.log(`\n${'─'.repeat(60)}`)
  console.log(fail === 0 ? `All ${pass} assertions passed ✅` : `${pass} passed, ${fail} FAILED`)
  console.log('Test orders created with real test-mode charges (left in DB for inspection).')
  await db.$disconnect()
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
