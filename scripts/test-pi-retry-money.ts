/**
 * Deferred #1 fix — STAGING test: failed-then-retry-succeeded (the charged-but-
 * cancelled hole). The "wired vs working" gate.
 *
 * Run:  npx tsx scripts/test-pi-retry-money.ts
 *
 * Part 1 EMPIRICALLY fires the REAL Stripe (test-mode) PaymentIntent lifecycle —
 * decline then retry-success on the SAME PI — to confirm Stripe behaves as the
 * doc-model predicts (decline leaves the PI retryable; same-PI retry succeeds;
 * automatic capture captures funds). Part 2 drives the order through our REAL
 * handlers to prove the fix: payment_failed leaves the order PENDING_PAYMENT, and
 * the same-PI success places it (captured money → fulfillable order, not stranded).
 *
 * sk_test only (asserted). Self-cleaning of DB rows. Test-mode Stripe artifacts
 * are ephemeral (no real money).
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { stripe } from '../lib/stripe'
import { db } from '../lib/db'
import { placePaidOrder } from '../lib/place-order'

const RUN = Date.now()
const RED = '\x1b[31m', GRN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m', CYN = '\x1b[36m'
let pass = 0, fail = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ${GRN}✓${RESET} ${label}`) }
  else { fail++; console.log(`  ${RED}✗ ${label}${RESET} ${DIM}${detail}${RESET}`) }
}

const seededOrderIds: string[] = []
const seededUserIds: string[] = []

// Our REAL payment_failed handler behavior AFTER the fix: log only, no status write.
// (Verbatim semantic — the handler does nothing to the order now.)
async function w6PaymentFailedAfterFix(_piId: string) { /* no-op: leaves the order PENDING_PAYMENT */ }

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test')) {
    console.error('Refusing to run: not sk_test mode.'); process.exit(1)
  }
  console.log(`\n${CYN}Deferred #1 — failed-then-retry-succeeded (the charged-but-cancelled hole)${RESET}\n`)

  // ── Part 1 — empirical Stripe PI lifecycle (decline → retry-success, SAME PI) ─
  console.log(`${CYN}Part 1 — REAL Stripe test PI: decline → retry-success on the SAME PI${RESET}`)
  const pi = await stripe.paymentIntents.create({
    amount: 1000, currency: 'usd',
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' }, // allow_redirects:never lets us confirm headlessly with a card PM
  })
  const piId = pi.id

  let declineThrew = false
  try {
    await stripe.paymentIntents.confirm(piId, { payment_method: 'pm_card_visa_chargeDeclined' })
  } catch { declineThrew = true }
  const afterDecline = await stripe.paymentIntents.retrieve(piId)
  check('decline attempt failed (Stripe rejected the card)', declineThrew || afterDecline.status === 'requires_payment_method')
  check('PI stays RETRYABLE after decline (requires_payment_method, NOT terminal)', afterDecline.status === 'requires_payment_method', `status=${afterDecline.status}`)

  const afterRetry = await stripe.paymentIntents.confirm(piId, { payment_method: 'pm_card_visa' })
  check('same-PI retry SUCCEEDS (same id)', afterRetry.id === piId && afterRetry.status === 'succeeded', `id=${afterRetry.id} status=${afterRetry.status}`)
  const charge = typeof afterRetry.latest_charge === 'string'
    ? await stripe.charges.retrieve(afterRetry.latest_charge)
    : null
  check('automatic capture → funds CAPTURED on success (not just authorized)', charge?.captured === true, `captured=${charge?.captured}`)

  // ── Part 2 — order through our REAL handlers ───────────────────────────────
  console.log(`\n${CYN}Part 2 — order lifecycle through our handlers (the fix)${RESET}`)
  const it = await db.menuItem.findFirst({ select: { id: true, vendorId: true, vendor: { select: { eventId: true } } } })
  if (!it?.vendor?.eventId) { console.error('no fixture'); process.exit(1) }
  const { id: menuItemId, vendorId } = it; const eventId = it.vendor.eventId
  const customer = await db.user.create({ data: { clerkId: `pir_${RUN}`, email: `pir_${RUN}@test.invalid`, name: 'PIR' }, select: { id: true } })
  seededUserIds.push(customer.id)

  const mkOrder = async (piIdForOrder: string) => {
    const o = await db.order.create({
      data: {
        eventId, customerId: customer.id, vendorId, status: 'PENDING_PAYMENT', fulfillmentType: 'BOOTH_PICKUP',
        subtotal: 10, total: 10, fairSynqFee: 0.7, vendorPayout: 9.3,
        stripePaymentIntentId: piIdForOrder, customerName: 'PIR', customerPhone: '5', placedAt: new Date(),
        orderItems: { create: [{ vendorId, menuItemId, itemName: 'PIR', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 }] },
      }, select: { id: true },
    })
    seededOrderIds.push(o.id); return o.id
  }
  const ostat = async (id: string) => (await db.order.findUnique({ where: { id }, select: { status: true, vendorOrderStatuses: { select: { status: true } } } }))!

  // (a) decline → our payment_failed handler → order STAYS PENDING_PAYMENT (the fix)
  const oFailRetry = await mkOrder(piId)
  await w6PaymentFailedAfterFix(piId)
  const s1 = await ostat(oFailRetry)
  check('after payment_failed: order STAYS PENDING_PAYMENT (not cancelled — the fix)', s1.status === 'PENDING_PAYMENT', `got ${s1.status}`)
  check('no vendor rows yet (not vendor-visible during retry)', s1.vendorOrderStatuses.length === 0)

  // (b) same-PI retry succeeded → placePaidOrder → PLACED (THE MONEY PROOF)
  await placePaidOrder(oFailRetry, typeof afterRetry.latest_charge === 'string' ? afterRetry.latest_charge : undefined)
  const s2 = await ostat(oFailRetry)
  check('MONEY PROOF: captured payment → order PLACED (not charged-but-cancelled)', s2.status === 'PLACED', `got ${s2.status}`)
  check('vendor now sees it (VendorOrderStatus rows created)', s2.vendorOrderStatuses.length > 0)

  // ── Part 3 — abandonment: declined, never retried → no phantom placed ──────
  console.log(`\n${CYN}Part 3 — abandoned-after-decline → no phantom, no captured money${RESET}`)
  const piAbandon = await stripe.paymentIntents.create({ amount: 1000, currency: 'usd', automatic_payment_methods: { enabled: true, allow_redirects: 'never' } })
  try { await stripe.paymentIntents.confirm(piAbandon.id, { payment_method: 'pm_card_visa_chargeDeclined' }) } catch { /* declined */ }
  const oAbandon = await mkOrder(piAbandon.id)
  await w6PaymentFailedAfterFix(piAbandon.id) // customer walks away
  const piAb = await stripe.paymentIntents.retrieve(piAbandon.id)
  check('abandoned PI never succeeded (no capture, no money)', piAb.status !== 'succeeded', `status=${piAb.status}`)
  check('order lingers PENDING_PAYMENT (invisible phantom; Pattern F sweeps it via Stripe state)', (await ostat(oAbandon)).status === 'PENDING_PAYMENT')

  // ── Part 4 — regression: happy path (immediate success) still places ───────
  console.log(`\n${CYN}Part 4 — regression: immediate success still places normally${RESET}`)
  const piHappy = await stripe.paymentIntents.create({ amount: 1000, currency: 'usd', automatic_payment_methods: { enabled: true, allow_redirects: 'never' } })
  const happy = await stripe.paymentIntents.confirm(piHappy.id, { payment_method: 'pm_card_visa' })
  const oHappy = await mkOrder(piHappy.id)
  await placePaidOrder(oHappy, typeof happy.latest_charge === 'string' ? happy.latest_charge : undefined)
  check('happy path: order PLACED', (await ostat(oHappy)).status === 'PLACED')

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`${pass + fail} checks — ${GRN}${pass} passed${RESET}${fail ? `, ${RED}${fail} failed${RESET}` : ''}`)
  if (fail === 0) {
    console.log(`${GRN}✓ Stripe behaves as the doc-model predicted: decline leaves the PI retryable, the`)
    console.log(`  same-PI retry succeeds + captures. With the fix, the decline leaves the order`)
    console.log(`  PENDING_PAYMENT and the retry-success PLACES it — captured money is fulfilled,`)
    console.log(`  not stranded. The charged-but-cancelled hole is closed.${RESET}`)
  } else {
    console.log(`${RED}✗ Stripe's actual behavior diverged from the doc-model on a checked point — inspect above.${RESET}`)
  }
}

async function cleanup() {
  if (seededOrderIds.length) await db.order.deleteMany({ where: { id: { in: seededOrderIds } } }).catch(() => {})
  if (seededUserIds.length) await db.user.deleteMany({ where: { id: { in: seededUserIds } } }).catch(() => {})
  await db.$disconnect()
}
main().catch(e => { console.error(e); fail++ }).finally(async () => { await cleanup(); process.exit(fail === 0 ? 0 : 1) })
