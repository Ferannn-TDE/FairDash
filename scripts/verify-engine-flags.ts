/** waiveFee + amountCentsOverride live proof (test mode). */
import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })
const EVENT_ID = 'cmni6x63n000011znjwlln5k2', CUSTOMER_EMAIL = 'feranmidyro@gmail.com'
const VENDOR_A = 'cmni6x68q000211znxtpw0076', VENDOR_B = 'cmni6x6gz000611znpe5c5hhp'
let pass = 0, fail = 0
const ok = (m: string) => { console.log(`  ✅ ${m}`); pass++ }
const no = (m: string) => { console.log(`  ❌ ${m}`); fail++ }
const C = (n: number) => Math.round(n * 100)

async function main() {
  const { db } = await import('../lib/db.js')
  const { stripe } = await import('../lib/stripe.js')
  const { refundVendorPortion } = await import('../lib/process-refund.js')
  const cust = await db.user.findUnique({ where: { email: CUSTOMER_EMAIL }, select: { id: true } })
  const menu: Record<string, string> = {}
  for (const v of [VENDOR_A, VENDOR_B]) menu[v] = (await db.menuItem.findFirst({ where: { vendorId: v }, select: { id: true } }))!.id
  async function order(slices: Record<string, number>) {
    const sub = Object.values(slices).reduce((a, b) => a + b, 0), fee = Math.round(sub * .1 * 100) / 100, total = Math.round((sub + fee) * 100) / 100
    const pi = await stripe.paymentIntents.create({ amount: C(total), currency: 'usd', payment_method: 'pm_card_visa', confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: 'never' }, metadata: { eventId: EVENT_ID, customerId: cust!.id } })
    const ch = typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge as any).id
    const o = await db.order.create({ data: { eventId: EVENT_ID, customerId: cust!.id, vendorId: Object.keys(slices)[0], status: 'COMPLETED', completedAt: new Date(), fulfillmentType: 'BOOTH_PICKUP', subtotal: sub, fairSynqFee: fee, total, vendorPayout: sub, customerName: 'F', customerPhone: '+10000000000', stripePaymentIntentId: pi.id, stripeChargeId: ch, orderItems: { create: Object.entries(slices).map(([v, a]) => ({ menuItemId: menu[v], itemName: 'I', vendorId: v, quantity: 1, unitPrice: a, totalPrice: a, subtotal: a })) }, vendorOrderStatuses: { create: Object.keys(slices).map(v => ({ vendorId: v, status: 'COMPLETED' })) } }, select: { id: true } })
    return { orderId: o.id, ch, fee }
  }

  console.log('\n=== Engine flags: waiveFee + amountCentsOverride ===')

  // waiveFee: A=$50,B=$30 → fee $8; refund A with waiveFee → slice $50 + A's fee share
  console.log('\nwaiveFee (incident/emergency full refund incl. fee):')
  const o1 = await order({ [VENDOR_A]: 50, [VENDOR_B]: 30 })
  const r1 = await refundVendorPortion({ orderId: o1.orderId, vendorId: VENDOR_A, reason: 'waive test', actor: 'test', waiveFee: true })
  // A's fee share of $8 by subtotal split: 50/80*800 = 500¢
  const sr1 = await stripe.refunds.retrieve(r1.stripeRefundId!)
  sr1.amount === C(50) + 500 ? ok(`waiveFee refunded slice + fee share = ${sr1.amount}¢ ($50 + $5.00 fee)`) : no(`got ${sr1.amount}¢, expected ${C(50)+500}`)

  // override partial: refund B $10 of its $30 slice
  console.log('\namountCentsOverride (constrained partial):')
  const r2 = await refundVendorPortion({ orderId: o1.orderId, vendorId: VENDOR_B, reason: 'partial', actor: 'test', amountCentsOverride: 1000 })
  const sr2 = await stripe.refunds.retrieve(r2.stripeRefundId!)
  sr2.amount === 1000 ? ok('override refunded exactly $10.00 (≤ vendor slice)') : no(`got ${sr2.amount}¢`)

  // override too large → rejected
  console.log('\noverride exceeding slice → rejected:')
  const o2 = await order({ [VENDOR_A]: 20, [VENDOR_B]: 20 })
  try {
    await refundVendorPortion({ orderId: o2.orderId, vendorId: VENDOR_A, reason: 'bad', actor: 'test', amountCentsOverride: 5000 })
    no('did NOT reject an over-slice override')
  } catch (e) {
    /RefundReconciliation|out of range/.test(String(e)) ? ok('rejected override > vendor slice (ill-defined, not guessed)') : no(`wrong error: ${e}`)
  }

  console.log(`\n${'─'.repeat(50)}`)
  console.log(fail === 0 ? `All ${pass} assertions passed ✅` : `${pass} passed, ${fail} FAILED`)
  await db.$disconnect()
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
