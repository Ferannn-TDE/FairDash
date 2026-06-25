/**
 * Phase 5 — STAGING integration: the W6 payment-fail boundary guard, both sides.
 *
 * Run:  npx tsx scripts/test-phase5-payfail-guard.ts
 *
 * A one-line `where` narrowing is trivially-correct OR silently-broken (wrong enum
 * value / casing). Prove BOTH directions:
 *   • the guard BLOCKS the race — a stale/duplicate payment_failed for an order
 *     that advanced to PLACED does NOT cancel it;
 *   • the guard DOESN'T break the real abort — a payment_failed for a genuinely
 *     PENDING_PAYMENT order still cancels it.
 *
 * Drives W6's EXACT updateMany (copied verbatim from webhooks/stripe/route.ts).
 * Isolated/self-cleaning. No Stripe, no queue.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { db } from '../lib/db'

const RUN = Date.now()
const RED = '\x1b[31m', GRN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m', CYN = '\x1b[36m'
let pass = 0, fail = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ${GRN}✓${RESET} ${label}`) }
  else { fail++; console.log(`  ${RED}✗ ${label}${RESET} ${DIM}${detail}${RESET}`) }
}

const seededOrderIds: string[] = []
const seededUserIds: string[] = []

// W6's EXACT write, verbatim from webhooks/stripe/route.ts (payment_intent.payment_failed).
async function w6PaymentFailed(piId: string) {
  return db.order.updateMany({
    where: { stripePaymentIntentId: piId, status: 'PENDING_PAYMENT' as never },
    data: { status: 'CANCELLED' as never, cancelledBy: 'system', cancellationReason: 'Payment failed' },
  })
}

async function seed(eventId: string, vendorId: string, menuItemId: string, customerId: string, status: string, piId: string) {
  const o = await db.order.create({
    data: {
      eventId, customerId, vendorId, status: status as never, fulfillmentType: 'BOOTH_PICKUP',
      subtotal: 10, total: 10, fairSynqFee: 0.7, vendorPayout: 9.3,
      stripePaymentIntentId: piId, customerName: 'P5', customerPhone: '5', placedAt: new Date(),
      orderItems: { create: [{ vendorId, menuItemId, itemName: 'P5', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 }] },
    }, select: { id: true },
  })
  seededOrderIds.push(o.id)
  return o.id
}
const stat = async (id: string) => (await db.order.findUnique({ where: { id }, select: { status: true } }))!.status

async function main() {
  console.log(`\n${CYN}Phase 5 staging — W6 payment-fail boundary guard (both sides)${RESET}\n`)

  const it = await db.menuItem.findFirst({ select: { id: true, vendorId: true, vendor: { select: { eventId: true } } } })
  if (!it?.vendor?.eventId) { console.error('no fixture'); process.exit(1) }
  const eventId = it.vendor.eventId, vendorId = it.vendorId, menuItemId = it.id
  const customer = await db.user.create({ data: { clerkId: `p5_${RUN}`, email: `p5_${RUN}@test.invalid`, name: 'P5' }, select: { id: true } })
  seededUserIds.push(customer.id)

  // ── Side 1: the legitimate abort still works ───────────────────────────────
  console.log(`${CYN}Side 1 — payment_failed on a genuinely PENDING_PAYMENT order → cancels${RESET}`)
  const pi1 = `pi_test_${RUN}_pending`
  const o1 = await seed(eventId, vendorId, menuItemId, customer.id, 'PENDING_PAYMENT', pi1)
  const r1 = await w6PaymentFailed(pi1)
  check('updateMany matched the pending order (count 1)', r1.count === 1, `count=${r1.count}`)
  check('order is CANCELLED (legitimate abort preserved)', (await stat(o1)) === 'CANCELLED')

  // ── Side 2: the race is blocked ────────────────────────────────────────────
  console.log(`\n${CYN}Side 2 — stale/duplicate payment_failed on a PLACED order → REFUSED${RESET}`)
  const pi2 = `pi_test_${RUN}_placed`
  const o2 = await seed(eventId, vendorId, menuItemId, customer.id, 'PLACED', pi2)
  const r2 = await w6PaymentFailed(pi2) // a stale payment_failed lands after placement
  check('updateMany matched ZERO rows (guard blocks the stale fail)', r2.count === 0, `count=${r2.count}`)
  check('order STAYS PLACED (the race is closed — no resurrection-to-CANCELLED)', (await stat(o2)) === 'PLACED', `got ${await stat(o2)}`)

  // ── Side 3: also blocked on a further-advanced order (DELIVERED) ────────────
  console.log(`\n${CYN}Side 3 — payment_failed on an advanced (DELIVERED) order → REFUSED${RESET}`)
  const pi3 = `pi_test_${RUN}_delivered`
  const o3 = await seed(eventId, vendorId, menuItemId, customer.id, 'DELIVERED', pi3)
  const r3 = await w6PaymentFailed(pi3)
  check('updateMany matched ZERO rows', r3.count === 0)
  check('order STAYS DELIVERED', (await stat(o3)) === 'DELIVERED', `got ${await stat(o3)}`)

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`${pass + fail} checks — ${GRN}${pass} passed${RESET}${fail ? `, ${RED}${fail} failed${RESET}` : ''}`)
  if (fail === 0) console.log(`${GRN}✓ Guard blocks the stale-fail-on-advanced race AND preserves the real PENDING abort.${RESET}`)
  else console.log(`${RED}✗ See failures.${RESET}`)
}

async function cleanup() {
  if (seededOrderIds.length) await db.order.deleteMany({ where: { id: { in: seededOrderIds } } }).catch(() => {})
  if (seededUserIds.length) await db.user.deleteMany({ where: { id: { in: seededUserIds } } }).catch(() => {})
  await db.$disconnect()
}
main().catch(e => { console.error(e); fail++ }).finally(async () => { await cleanup(); process.exit(fail === 0 ? 0 : 1) })
