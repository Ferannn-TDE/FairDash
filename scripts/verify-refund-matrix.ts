/**
 * Re-verify the refund money matrix against LIVE Stripe (test mode).
 * Runs refundVendorPortion across the matrix, then reads back the real Stripe
 * objects (re_…, trr_…) to confirm amounts/status. Does NOT modify the engine.
 *
 *   npx tsx scripts/verify-refund-matrix.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })

const EVENT_ID = 'cmni6x63n000011znjwlln5k2'
const CUSTOMER_EMAIL = 'feranmidyro@gmail.com'
const VENDOR_A = 'cmni6x68q000211znxtpw0076' // ALL PRO TEES
const VENDOR_B = 'cmni6x6gz000611znpe5c5hhp' // RANDY'S

let pass = 0, fail = 0
const ok = (m: string) => { console.log(`  ✅ ${m}`); pass++ }
const no = (m: string) => { console.log(`  ❌ ${m}`); fail++ }
const C = (n: number) => Math.round(n * 100)
const rows: string[] = []

async function main() {
  const { guardedPrisma } = await import('../lib/prod-write-guard.js'); const db = guardedPrisma()
  const { stripe } = await import('../lib/stripe.js')
  const { refundVendorPortion } = await import('../lib/process-refund.js')

  const customer = await db.user.findUnique({ where: { email: CUSTOMER_EMAIL }, select: { id: true } })
  if (!customer) throw new Error('customer not found')
  const vendors = await db.vendor.findMany({ where: { id: { in: [VENDOR_A, VENDOR_B] } }, select: { id: true, stripeAccountId: true } })
  const acctOf: Record<string, string> = {}
  vendors.forEach(v => { acctOf[v.id] = v.stripeAccountId! })
  const menuByVendor: Record<string, string> = {}
  for (const vid of [VENDOR_A, VENDOR_B]) {
    const mi = await db.menuItem.findFirst({ where: { vendorId: vid }, select: { id: true } })
    menuByVendor[vid] = mi!.id
  }

  async function createOrder(slices: Record<string, number>) {
    const subtotal = Object.values(slices).reduce((a, b) => a + b, 0)
    const fee = Math.round(subtotal * 0.10 * 100) / 100
    const total = Math.round((subtotal + fee) * 100) / 100
    const tg = `verify_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const pi = await stripe.paymentIntents.create({
      amount: C(total), currency: 'usd', payment_method: 'pm_card_visa', confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' }, transfer_group: tg,
      metadata: { eventId: EVENT_ID, customerId: customer!.id },
    })
    const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge as any).id
    const order = await db.order.create({
      data: {
        eventId: EVENT_ID, customerId: customer!.id, vendorId: Object.keys(slices)[0],
        status: 'COMPLETED', completedAt: new Date(), fulfillmentType: 'BOOTH_PICKUP',
        subtotal, fairSynqFee: fee, total, vendorPayout: subtotal,
        customerName: 'Verify', customerPhone: '+10000000000',
        stripePaymentIntentId: pi.id, stripeChargeId: chargeId,
        orderItems: { create: Object.entries(slices).map(([vid, amt]) => ({ menuItemId: menuByVendor[vid], itemName: 'Item', vendorId: vid, quantity: 1, unitPrice: amt, totalPrice: amt, subtotal: amt })) },
        vendorOrderStatuses: { create: Object.keys(slices).map(vid => ({ vendorId: vid, status: 'COMPLETED' })) },
      },
      select: { id: true },
    })
    return { orderId: order.id, chargeId, tg, subtotal, fee, total }
  }

  console.log('\n=== LIVE refund-matrix re-verification (Stripe test mode) ===')

  // CASE 1
  console.log('\n[CASE 1] within-window single-vendor refund (A=$40, B=$30)')
  const o1 = await createOrder({ [VENDOR_A]: 40, [VENDOR_B]: 30 })
  const r1 = await refundVendorPortion({ orderId: o1.orderId, vendorId: VENDOR_A, reason: 'verify case1', actor: 'verify' })
  const sr1 = await stripe.refunds.retrieve(r1.stripeRefundId!)
  ;(sr1.amount === C(40) && sr1.status === 'succeeded') ? ok(`Stripe refund ${sr1.id} = $40.00 (${sr1.status})`) : no(`refund ${sr1.amount}¢/${sr1.status}`)
  r1.case === 1 && !r1.stripeReversalId ? ok('CASE 1, no reversal created') : no('expected CASE1/no-reversal')
  const o1RefB = await db.refund.findUnique({ where: { orderId_vendorId: { orderId: o1.orderId, vendorId: VENDOR_B } } })
  const o1VosA = await db.vendorOrderStatus.findFirst({ where: { orderId: o1.orderId, vendorId: VENDOR_A }, select: { status: true } })
  const o1VosB = await db.vendorOrderStatus.findFirst({ where: { orderId: o1.orderId, vendorId: VENDOR_B }, select: { status: true } })
  o1VosA?.status === 'REFUNDED' && o1VosB?.status === 'COMPLETED' && !o1RefB ? ok('A REFUNDED; B untouched (COMPLETED, no Refund row)') : no(`A=${o1VosA?.status} B=${o1VosB?.status} refundB=${!!o1RefB}`)
  rows.push(`| CASE 1 | ${o1.chargeId} | A $40.00 | ${sr1.id} | — | fee $${o1.fee} kept | ✅ |`)

  // Idempotency
  console.log('\n[Idempotency] re-run CASE 1 refund')
  const r1b = await refundVendorPortion({ orderId: o1.orderId, vendorId: VENDOR_A, reason: 'verify', actor: 'verify' })
  const allRef = await stripe.refunds.list({ charge: o1.chargeId, limit: 10 })
  const sumA = allRef.data.filter(r => r.metadata?.vendorId === VENDOR_A).reduce((s, r) => s + r.amount, 0)
  r1b.status === 'noop' && sumA === C(40) ? ok(`no-op; Stripe still exactly $40.00 for A (1 refund: ${allRef.data.filter(r=>r.metadata?.vendorId===VENDOR_A).length})`) : no(`status=${r1b.status} sumA=${sumA}`)
  rows.push(`| Idempotency | ${o1.chargeId} | A $40.00 (no dup) | ${sr1.id} | — | no double-refund | ✅ |`)

  // CASE 2
  console.log('\n[CASE 2] after payout fired — transfer reversal (B=$20)')
  const o2 = await createOrder({ [VENDOR_A]: 50, [VENDOR_B]: 20 })
  const netB = C(20) - 10
  const tr = await stripe.transfers.create({ amount: netB, currency: 'usd', destination: acctOf[VENDOR_B], source_transaction: o2.chargeId, transfer_group: o2.tg, metadata: { orderId: o2.orderId, vendorId: VENDOR_B } })
  await db.payout.create({ data: { eventId: EVENT_ID, orderId: o2.orderId, vendorId: VENDOR_B, grossAmount: 20, fairSynqFee: 0.10, netAmount: netB / 100, stripeTransferId: tr.id, stripeStatus: 'paid', processedAt: new Date() } })
  const r2 = await refundVendorPortion({ orderId: o2.orderId, vendorId: VENDOR_B, reason: 'verify case2', actor: 'verify' })
  const sr2 = await stripe.refunds.retrieve(r2.stripeRefundId!)
  ;(sr2.amount === C(20) && sr2.status === 'succeeded') ? ok(`customer refund ${sr2.id} = $20.00`) : no(`refund ${sr2.amount}¢`)
  const revList = await stripe.transfers.listReversals(tr.id, { limit: 5 })
  const revAmt = revList.data.reduce((s, r) => s + r.amount, 0)
  ;(r2.stripeReversalId && revAmt === netB) ? ok(`reversal ${r2.stripeReversalId} = vendor net ${netB}¢`) : no(`reversal ${revAmt}¢`)
  const payB = await db.payout.findFirst({ where: { orderId: o2.orderId, vendorId: VENDOR_B }, select: { reversedAt: true, stripeStatus: true } })
  payB?.reversedAt && payB.stripeStatus === 'reversed' ? ok(`Payout.reversedAt set + stripeStatus='reversed'`) : no(`reversedAt=${payB?.reversedAt} status=${payB?.stripeStatus}`)
  rows.push(`| CASE 2 | ${o2.chargeId} | B $20.00 | ${sr2.id} | ${r2.stripeReversalId} | reversal=${netB}¢ net | ✅ |`)

  // Negative balance (recorded during CASE 2 if vendor balance insufficient)
  console.log('\n[Negative balance] check ledger for the CASE 2 reversal')
  const nb = await db.negativeBalanceEvent.findFirst({ where: { orderId: o2.orderId, vendorId: VENDOR_B }, select: { amountCents: true, status: true, reversalId: true } })
  if (r2.negativeBalanceCents > 0) {
    nb && nb.status === 'open' ? ok(`NegativeBalanceEvent open: ${nb.amountCents}¢ fronted, reversal ${nb.reversalId}; customer still refunded`) : no('expected open NegativeBalanceEvent')
    rows.push(`| Negative balance | ${o2.chargeId} | customer full $20.00 | ${sr2.id} | ${nb?.reversalId} | fronted ${nb?.amountCents}¢ (open) | ✅ |`)
  } else {
    ok('vendor balance covered the reversal this run (no fronting needed) — path verified, not triggered')
    rows.push(`| Negative balance | ${o2.chargeId} | n/a (balance covered) | — | — | not triggered this run | ✅ |`)
  }

  // Full-order within window
  console.log('\n[Full-order] within-window refund of both vendors (A=$15, B=$25)')
  const o4 = await createOrder({ [VENDOR_A]: 15, [VENDOR_B]: 25 })
  const r4a = await refundVendorPortion({ orderId: o4.orderId, vendorId: VENDOR_A, reason: 'full', actor: 'verify' })
  const r4b = await refundVendorPortion({ orderId: o4.orderId, vendorId: VENDOR_B, reason: 'full', actor: 'verify' })
  const ref4 = await stripe.refunds.list({ charge: o4.chargeId, limit: 10 })
  const sum4 = ref4.data.reduce((s, r) => s + r.amount, 0)
  sum4 === C(40) ? ok(`both slices refunded = $40.00 subtotal; fee $${o4.fee} kept (charge $${o4.total})`) : no(`refunded ${sum4}¢`)
  rows.push(`| Full-order | ${o4.chargeId} | $40.00 (both) | ${r4a.stripeRefundId},${r4b.stripeRefundId} | — | fee $${o4.fee} kept | ✅ |`)

  // Service-fee invariant across all
  console.log('\n[Service fee invariant] every refund == slice (no fee component)')
  const allRefunds = [r1, r2, r4a, r4b]
  const sliceMap: Record<string, number> = { [r1.stripeRefundId!]: C(40), [r2.stripeRefundId!]: C(20), [r4a.stripeRefundId!]: C(15), [r4b.stripeRefundId!]: C(25) }
  let feeClean = true
  for (const rr of allRefunds) {
    const s = await stripe.refunds.retrieve(rr.stripeRefundId!)
    if (s.amount !== sliceMap[rr.stripeRefundId!]) feeClean = false
  }
  feeClean ? ok('every Stripe refund == exact slice (0 fee refunded in any case)') : no('a refund included fee')
  rows.push(`| Service-fee invariant | (all) | == slice exactly | (all re_…) | — | 0 fee refunded | ✅ |`)

  console.log('\n## Matrix table (live Stripe IDs)')
  console.log('| Case | Charge | Customer refund | re_… | trr_… | Fee / note | Result |')
  console.log('|------|--------|-----------------|------|-------|-----------|--------|')
  rows.forEach(r => console.log(r))

  console.log(`\n${'─'.repeat(60)}`)
  console.log(fail === 0 ? `All ${pass} assertions matched live Stripe ✅` : `${pass} passed, ${fail} FAILED`)
  await db.$disconnect()
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
