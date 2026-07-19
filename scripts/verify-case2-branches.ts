/**
 * Prove BOTH CASE 2 reversal branches + the migrated decline path, live (test mode).
 *   npx tsx scripts/verify-case2-branches.ts
 *
 * B1 CASE 2 sufficient balance → clean reversal, vendor debited, customer refunded,
 *    NO NegativeBalanceEvent. (Seed available balance with test token tok_bypassPending.)
 * B2 CASE 2 insufficient balance → reversal still completes, customer refunded,
 *    FairSynq fronts the gap, NegativeBalanceEvent 'open'.
 * D1 vendor-decline → per-vendor refund via engine: slice refunded (fee kept),
 *    Refund row COMPLETED, portion stays DECLINED (markVendorStatus:false), no reversal.
 */
import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })

const EVENT_ID = 'cmni6x63n000011znjwlln5k2'
const CUSTOMER_EMAIL = 'feranmidyro@gmail.com'
const VENDOR_A = 'cmni6x68q000211znxtpw0076'
const VENDOR_B = 'cmni6x6gz000611znpe5c5hhp'
let pass = 0, fail = 0
const ok = (m: string) => { console.log(`  ✅ ${m}`); pass++ }
const no = (m: string) => { console.log(`  ❌ ${m}`); fail++ }
const C = (n: number) => Math.round(n * 100)

async function main() {
  const { guardedPrisma } = await import('../lib/prod-write-guard.js'); const db = guardedPrisma()
  const { stripe } = await import('../lib/stripe.js')
  const { refundVendorPortion } = await import('../lib/process-refund.js')
  const customer = await db.user.findUnique({ where: { email: CUSTOMER_EMAIL }, select: { id: true } })
  const vendors = await db.vendor.findMany({ where: { id: { in: [VENDOR_A, VENDOR_B] } }, select: { id: true, stripeAccountId: true } })
  const acctOf: Record<string, string> = {}; vendors.forEach(v => acctOf[v.id] = v.stripeAccountId!)
  const menu: Record<string, string> = {}
  for (const vid of [VENDOR_A, VENDOR_B]) menu[vid] = (await db.menuItem.findFirst({ where: { vendorId: vid }, select: { id: true } }))!.id

  async function order(slices: Record<string, number>, completed = true) {
    const subtotal = Object.values(slices).reduce((a, b) => a + b, 0)
    const fee = Math.round(subtotal * 0.1 * 100) / 100, total = Math.round((subtotal + fee) * 100) / 100
    const tg = `c2_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const pi = await stripe.paymentIntents.create({ amount: C(total), currency: 'usd', payment_method: 'pm_card_visa', confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: 'never' }, transfer_group: tg, metadata: { eventId: EVENT_ID, customerId: customer!.id } })
    const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge as any).id
    const o = await db.order.create({ data: {
      eventId: EVENT_ID, customerId: customer!.id, vendorId: Object.keys(slices)[0],
      status: completed ? 'COMPLETED' : 'PLACED', completedAt: completed ? new Date() : null, fulfillmentType: 'BOOTH_PICKUP',
      subtotal, fairSynqFee: fee, total, vendorPayout: subtotal, customerName: 'C2', customerPhone: '+10000000000',
      stripePaymentIntentId: pi.id, stripeChargeId: chargeId,
      orderItems: { create: Object.entries(slices).map(([vid, amt]) => ({ menuItemId: menu[vid], itemName: 'I', vendorId: vid, quantity: 1, unitPrice: amt, totalPrice: amt, subtotal: amt })) },
      vendorOrderStatuses: { create: Object.keys(slices).map(vid => ({ vendorId: vid, status: completed ? 'COMPLETED' : 'PLACED' })) },
    }, select: { id: true } })
    return { orderId: o.id, chargeId, tg }
  }
  async function fakePayout(orderId: string, vendorId: string, tg: string, chargeId: string, sliceDollars: number) {
    const net = C(sliceDollars) - 10
    const tr = await stripe.transfers.create({ amount: net, currency: 'usd', destination: acctOf[vendorId], source_transaction: chargeId, transfer_group: tg, metadata: { orderId, vendorId } })
    await db.payout.create({ data: { eventId: EVENT_ID, orderId, vendorId, grossAmount: sliceDollars, fairSynqFee: 0.1, netAmount: net / 100, stripeTransferId: tr.id, stripeStatus: 'paid', processedAt: new Date() } })
    return { transferId: tr.id, net }
  }

  console.log('\n=== CASE 2 both branches + decline path (live test mode) ===')

  // B1 — sufficient balance → clean reversal
  console.log('\nB1 — CASE 2 SUFFICIENT balance (seed available via tok_bypassPending)')
  const o1 = await order({ [VENDOR_A]: 50, [VENDOR_B]: 20 })
  const p1 = await fakePayout(o1.orderId, VENDOR_B, o1.tg, o1.chargeId, 20)
  // Seed AVAILABLE balance on vendor B via a plain platform→connected transfer
  // (no source_transaction → lands as available in test mode, unlike the order's
  // source-bound transfer whose funds stay pending against the charge).
  await stripe.transfers.create({ amount: 8000, currency: 'usd', destination: acctOf[VENDOR_B], description: 'test available balance seed' })
  const balBefore = await stripe.balance.retrieve({}, { stripeAccount: acctOf[VENDOR_B] })
  const availBefore = balBefore.available.find(b => b.currency === 'usd')?.amount ?? 0
  console.log(`     vendor B available before reversal: ${availBefore}¢ (need ${p1.net}¢)`)
  const r1 = await refundVendorPortion({ orderId: o1.orderId, vendorId: VENDOR_B, reason: 'B1', actor: 'verify' })
  r1.stripeReversalId ? ok(`clean reversal ${r1.stripeReversalId}`) : no('no reversal')
  r1.negativeBalanceCents === 0 ? ok('NO fronting needed (balance sufficient)') : no(`fronted ${r1.negativeBalanceCents}¢ unexpectedly`)
  const nb1 = await db.negativeBalanceEvent.findFirst({ where: { orderId: o1.orderId } })
  !nb1 ? ok('NO NegativeBalanceEvent written (clean branch)') : no('unexpected NegativeBalanceEvent')
  const sr1 = await stripe.refunds.retrieve(r1.stripeRefundId!)
  sr1.amount === C(20) ? ok('customer refunded $20.00 slice (fee kept)') : no(`refund ${sr1.amount}¢`)
  const pay1 = await db.payout.findFirst({ where: { orderId: o1.orderId, vendorId: VENDOR_B }, select: { reversedAt: true, stripeStatus: true } })
  pay1?.reversedAt && pay1.stripeStatus === 'reversed' ? ok('Payout.reversedAt set + status reversed') : no('payout not converged')

  // B2 — insufficient balance → customer refunded + gap tracked
  console.log('\nB2 — CASE 2 INSUFFICIENT balance (fresh transfer, funds pending)')
  const o2 = await order({ [VENDOR_A]: 50, [VENDOR_B]: 22 })
  const p2 = await fakePayout(o2.orderId, VENDOR_A, o2.tg, o2.chargeId, 50) // pay A so A is CASE 2
  const r2 = await refundVendorPortion({ orderId: o2.orderId, vendorId: VENDOR_A, reason: 'B2', actor: 'verify' })
  r2.stripeReversalId ? ok(`reversal ${r2.stripeReversalId} still completed`) : no('no reversal')
  const sr2 = await stripe.refunds.retrieve(r2.stripeRefundId!)
  sr2.amount === C(50) ? ok('customer STILL refunded $50.00 in full') : no(`refund ${sr2.amount}¢`)
  const nb2 = await db.negativeBalanceEvent.findFirst({ where: { orderId: o2.orderId, vendorId: VENDOR_A }, select: { amountCents: true, status: true } })
  r2.negativeBalanceCents > 0 && nb2?.status === 'open' ? ok(`gap tracked: ${nb2.amountCents}¢ fronted (open)`) : no(`expected open gap, got ${JSON.stringify(nb2)}`)

  // D1 — vendor-decline → engine refund, stays DECLINED
  console.log('\nD1 — vendor-decline → per-vendor engine refund (markVendorStatus:false)')
  const o3 = await order({ [VENDOR_A]: 30, [VENDOR_B]: 18 }, false) // PLACED
  await db.vendorOrderStatus.updateMany({ where: { orderId: o3.orderId, vendorId: VENDOR_A }, data: { status: 'DECLINED', declinedAt: new Date() } })
  const r3 = await refundVendorPortion({ orderId: o3.orderId, vendorId: VENDOR_A, reason: 'vendor_declined', actor: `vendor:${VENDOR_A}`, markVendorStatus: false })
  const sr3 = await stripe.refunds.retrieve(r3.stripeRefundId!)
  sr3.amount === C(30) ? ok('declined vendor slice refunded $30.00 (fee kept)') : no(`refund ${sr3.amount}¢`)
  r3.case === 1 && !r3.stripeReversalId ? ok('CASE 1 (no reversal — payout never fired)') : no('expected CASE 1')
  const vos = await db.vendorOrderStatus.findFirst({ where: { orderId: o3.orderId, vendorId: VENDOR_A }, select: { status: true } })
  vos?.status === 'DECLINED' ? ok('portion STAYS DECLINED (history-safe), not overwritten to REFUNDED') : no(`status became ${vos?.status}`)
  const rfRow = await db.refund.findUnique({ where: { orderId_vendorId: { orderId: o3.orderId, vendorId: VENDOR_A } }, select: { status: true } })
  rfRow?.status === 'COMPLETED' ? ok('Refund row COMPLETED records the money') : no(`refund row ${rfRow?.status}`)

  console.log(`\n${'─'.repeat(60)}`)
  console.log(fail === 0 ? `All ${pass} assertions passed ✅` : `${pass} passed, ${fail} FAILED`)
  await db.$disconnect()
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
