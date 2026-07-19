/**
 * Live chargeback verification (Stripe test mode).
 *   npx tsx scripts/verify-chargeback.ts
 *
 * Multi-vendor order, already paid out, then a bank dispute (test dispute card):
 *  - Chargeback row created
 *  - proportional clawback per vendor (real reversals), late→insufficient→gaps
 *  - NegativeBalanceEvent kind=dispute_clawback per fronted gap
 *  - $15 fee recorded on the Chargeback (recoverable)
 *  - customer NOT re-refunded (no Refund rows)
 *  - idempotent: replaying the dispute event = no double clawback
 *  - dispute.closed WON surfaces for admin (no auto re-pay); LOST finalizes
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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  const { guardedPrisma } = await import('../lib/prod-write-guard.js'); const db = guardedPrisma()
  const { stripe } = await import('../lib/stripe.js')
  const { handleChargebackCreated, handleChargebackClosed } = await import('../lib/process-chargeback.js')

  const customer = await db.user.findUnique({ where: { email: CUSTOMER_EMAIL }, select: { id: true } })
  const vendors = await db.vendor.findMany({ where: { id: { in: [VENDOR_A, VENDOR_B] } }, select: { id: true, stripeAccountId: true } })
  const acctOf: Record<string, string> = {}; vendors.forEach(v => acctOf[v.id] = v.stripeAccountId!)
  const menu: Record<string, string> = {}
  for (const vid of [VENDOR_A, VENDOR_B]) menu[vid] = (await db.menuItem.findFirst({ where: { vendorId: vid }, select: { id: true } }))!.id

  // A=$60, B=$40 → subtotal $100, fee $10, total $110
  const slices = { [VENDOR_A]: 60, [VENDOR_B]: 40 }
  const subtotal = 100, fee = 10, total = 110
  const tg = `cb_${Date.now()}`

  console.log('\n=== Live chargeback on a paid-out multi-vendor order ===')
  console.log('\nCreating disputed charge (test dispute card)…')
  const pi = await stripe.paymentIntents.create({
    amount: total * 100, currency: 'usd',
    payment_method: 'pm_card_createDispute', confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    transfer_group: tg, metadata: { eventId: EVENT_ID, customerId: customer!.id },
  })
  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge as any).id

  const order = await db.order.create({ data: {
    eventId: EVENT_ID, customerId: customer!.id, vendorId: VENDOR_A, status: 'COMPLETED', completedAt: new Date(),
    fulfillmentType: 'BOOTH_PICKUP', subtotal, fairSynqFee: fee, total, vendorPayout: subtotal,
    customerName: 'CB', customerPhone: '+10000000000', stripePaymentIntentId: pi.id, stripeChargeId: chargeId,
    orderItems: { create: Object.entries(slices).map(([vid, amt]) => ({ menuItemId: menu[vid], itemName: 'I', vendorId: vid, quantity: 1, unitPrice: amt, totalPrice: amt, subtotal: amt })) },
    vendorOrderStatuses: { create: Object.keys(slices).map(vid => ({ vendorId: vid, status: 'COMPLETED' })) },
  }, select: { id: true } })

  // Pay both vendors (real transfers) — the "already paid out" precondition.
  for (const [vid, amt] of Object.entries(slices)) {
    const net = amt * 100 - 10
    const tr = await stripe.transfers.create({ amount: net, currency: 'usd', destination: acctOf[vid], source_transaction: chargeId, transfer_group: tg, metadata: { orderId: order.id, vendorId: vid } })
    await db.payout.create({ data: { eventId: EVENT_ID, orderId: order.id, vendorId: vid, grossAmount: amt, fairSynqFee: 0.1, netAmount: net / 100, stripeTransferId: tr.id, stripeStatus: 'paid', processedAt: new Date() } })
  }
  console.log(`  order ${order.id} paid out to both vendors.`)

  // Poll for the auto-created dispute.
  console.log('\nWaiting for Stripe to raise the dispute…')
  let dispute: any = null
  for (let i = 0; i < 24 && !dispute; i++) {
    await sleep(2500)
    const list = await stripe.disputes.list({ charge: chargeId, limit: 1 })
    if (list.data.length) dispute = list.data[0]
    else process.stdout.write('.')
  }
  console.log('')
  if (!dispute) { no('dispute never appeared (test-mode lag) — aborting'); await db.$disconnect(); process.exit(1) }
  ok(`real dispute ${dispute.id} raised (status=${dispute.status}, amount=${dispute.amount}¢)`)

  // ── Drive the webhook handler ─────────────────────────────────────────────
  console.log('\nProcessing charge.dispute.created…')
  const res = await handleChargebackCreated(dispute)
  res.status === 'recorded' ? ok('Chargeback recorded') : no(`status ${res.status}`)
  const cb = await db.chargeback.findUnique({ where: { stripeDisputeId: dispute.id } })
  cb ? ok(`Chargeback row: amount=${cb.amountCents}¢ fee=${cb.feeCents}¢ clawback=${cb.clawbackStatus}`) : no('no Chargeback row')
  cb && cb.feeCents > 0 ? ok(`$${(cb.feeCents/100).toFixed(2)} dispute fee recorded (recoverable)`) : no('fee not recorded')
  res.clawedVendors.length === 2 ? ok('proportional clawback attempted for BOTH paid vendors') : no(`clawed ${res.clawedVendors.length}`)
  for (const c of res.clawedVendors) {
    const pay = await db.payout.findFirst({ where: { orderId: order.id, vendorId: c.vendorId }, select: { reversedAt: true, stripeStatus: true } })
    pay?.reversedAt ? ok(`vendor ${c.vendorId.slice(-6)} payout reversed (${c.reversalId})`) : no(`vendor ${c.vendorId.slice(-6)} not reversed`)
  }
  const gaps = await db.negativeBalanceEvent.findMany({ where: { orderId: order.id, kind: 'dispute_clawback', status: 'open' } })
  gaps.length > 0 ? ok(`${gaps.length} dispute_clawback gap(s) recorded (FairSynq fronted ${gaps.reduce((s,g)=>s+g.amountCents,0)}¢ — late dispute, vendors already withdrawn)`) : console.log('  ℹ︎ no gaps (vendor balances covered the reversal this run)')
  const refunds = await db.refund.findMany({ where: { orderId: order.id } })
  refunds.length === 0 ? ok('customer NOT re-refunded (no Refund rows — the bank already paid them)') : no(`${refunds.length} Refund rows created (should be 0)`)

  // ── Idempotency: replay the dispute event ─────────────────────────────────
  console.log('\nReplaying charge.dispute.created (redelivery)…')
  const res2 = await handleChargebackCreated(dispute)
  res2.status === 'noop' ? ok('redelivery is a no-op (no double clawback)') : no(`replay status ${res2.status}`)
  const reversalsA = await stripe.transfers.listReversals((await db.payout.findFirst({ where: { orderId: order.id, vendorId: VENDOR_A } }))!.stripeTransferId, { limit: 5 })
  reversalsA.data.length === 1 ? ok('exactly ONE reversal on vendor A transfer (no double)') : no(`${reversalsA.data.length} reversals on A`)

  // ── dispute.closed handling (status reconcile + surfacing, no auto-move) ──
  console.log('\nClosed handling:')
  await handleChargebackClosed({ ...dispute, status: 'lost' })
  let row = await db.chargeback.findUnique({ where: { stripeDisputeId: dispute.id }, select: { status: true, fundsReinstated: true } })
  row?.status === 'lost' && !row.fundsReinstated ? ok('LOST → status updated, clawback stands') : no(`lost handling: ${JSON.stringify(row)}`)
  await handleChargebackClosed({ ...dispute, status: 'won' })
  row = await db.chargeback.findUnique({ where: { stripeDisputeId: dispute.id }, select: { status: true, fundsReinstated: true } })
  row?.status === 'won' && row.fundsReinstated ? ok('WON → fundsReinstated flagged for ADMIN reconciliation (vendors NOT auto re-paid)') : no(`won handling: ${JSON.stringify(row)}`)
  const stillReversed = await db.payout.findFirst({ where: { orderId: order.id, vendorId: VENDOR_A }, select: { reversedAt: true } })
  stillReversed?.reversedAt ? ok('on WON, vendor payout still shows reversed — no automatic re-payment') : no('payout auto-changed on WON')

  console.log(`\n${'─'.repeat(60)}`)
  console.log(fail === 0 ? `All ${pass} assertions passed ✅` : `${pass} passed, ${fail} FAILED`)
  await db.$disconnect()
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
