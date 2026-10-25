/**
 * STATEMENT DESCRIPTOR — LIVE (readiness 1.6, test 6). Stripe TEST mode + the test database.
 *
 *   [0] CONTROL on Stripe itself: a raw suffix with `*` is rejected at paymentIntents.create, and
 *       the same name cleaned is accepted. Without this, [1] could pass because Stripe accepts
 *       anything, and the cleaner would be proven to do nothing.
 *   [1] ONE REAL CHARGE through the real POST /api/orders handler (Clerk identity mocked, every
 *       other line real), confirmed with Stripe's test card, then read back from Stripe:
 *       PaymentIntent.statement_descriptor_suffix and charge.calculated_statement_descriptor
 *       must read "FAIRSYNQ* ITALIAN FEST".
 *
 * Not in the gate: it needs the network and Stripe. The charge is refunded and every row it
 * made is deleted on the way out.
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/statement-descriptor-live.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
process.env.UPSTASH_REDIS_REST_URL = process.env.TEST_UPSTASH_URL ?? 'http://localhost:58080'
process.env.UPSTASH_REDIS_REST_TOKEN = 'fairsynq-test-token'

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { NextRequest } from 'next/server'
import { STATEMENT_PREFIX, cleanStatementName } from '../lib/statement-descriptor'

const prisma = testPrisma()
const PFX = 'sdl-'
const rand = () => Math.random().toString(36).slice(2, 10)
const KEY = process.env.STRIPE_SECRET_KEY ?? ''
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }
const stripe = async (path: string, body?: Record<string, string>) =>
  (await fetch(`https://api.stripe.com/v1/${path}`, { method: body ? 'POST' : 'GET', headers: H, body: body ? new URLSearchParams(body) : undefined })).json()

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vs.map(v => v.id) } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { clerkId: { startsWith: PFX } } })
}

async function main() {
  if (!KEY.startsWith('sk_test_')) throw new Error('refusing: STRIPE_SECRET_KEY is not a test-mode key')
  await cleanup()

  console.log('[0] control: Stripe rejects the raw name, accepts the cleaned one')
  const raw = await stripe('payment_intents', { amount: '500', currency: 'usd', 'payment_method_types[]': 'card', statement_descriptor_suffix: 'BAD*NAME' })
  assert(!raw.id && /cannot include \*/.test(raw.error?.message ?? ''), `raw "BAD*NAME" rejected at create (${raw.error?.message ?? 'ACCEPTED'})`)
  const cleaned = cleanStatementName('BAD*NAME')!
  const ok = await stripe('payment_intents', { amount: '500', currency: 'usd', 'payment_method_types[]': 'card', statement_descriptor_suffix: cleaned })
  assert(!!ok.id, `cleaned "${cleaned}" accepted`)
  if (ok.id) await stripe(`payment_intents/${ok.id}/cancel`, {})

  console.log('\n[1] one real charge through POST /api/orders')
  const event = await prisma.event.create({
    data: { name: 'Italian Fest 2026', urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', startDate: new Date(Date.now() - 864e5), endDate: new Date(Date.now() + 864e5) },
  })
  const vendor = await prisma.vendor.create({
    data: { eventId: event.id, name: `${PFX}booth`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE', stripeVerified: true },
  })
  const item = await prisma.menuItem.create({ data: { vendorId: vendor.id, name: `${PFX}item`, price: 5, category: 'Mains' } })
  const clerkId = `${PFX}c-${rand()}`
  await prisma.user.create({ data: { clerkId, email: `${clerkId}@sdl.local`, name: 'Statement Test', role: 'customer' } })
  ;(globalThis as Record<string, unknown>).__MOCK_CLERK = { userId: clerkId }

  const { POST } = await import('../app/api/orders/route')
  const res = await POST(new NextRequest('http://localhost/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: event.id, fulfillmentType: 'BOOTH_PICKUP', customerName: 'Statement Test', customerPhone: '5550000000',
      items: [{ menuItemId: item.id, vendorId: vendor.id, quantity: 1 }],
    }),
  }))
  const json = await res.json() as { success: boolean; data?: { orderId: string; clientSecret: string }; error?: { message: string } }
  assert(res.status === 201 || res.status === 200, `order created (HTTP ${res.status}${json.error ? `: ${json.error.message}` : ''})`)
  if (!json.data) return

  const piId = json.data.clientSecret.split('_secret_')[0]
  const pi = await stripe(`payment_intents/${piId}/confirm`, { payment_method: 'pm_card_visa', return_url: 'https://www.fairsynq.com' })
  assert(pi.status === 'succeeded', `confirmed with the test card (${pi.status ?? pi.error?.message})`)
  assert(pi.statement_descriptor_suffix === 'ITALIAN FEST', `PaymentIntent.statement_descriptor_suffix = "ITALIAN FEST" (got ${JSON.stringify(pi.statement_descriptor_suffix)})`)
  const charge = await stripe(`charges/${pi.latest_charge}`)
  const want = `${STATEMENT_PREFIX}* ITALIAN FEST`
  assert(charge.calculated_statement_descriptor === want, `charge.calculated_statement_descriptor = "${want}" (got ${JSON.stringify(charge.calculated_statement_descriptor)})`)
  console.log(`     charge ${charge.id}`)
  if (charge.id) await stripe('refunds', { charge: charge.id })
}

main()
  .catch(err => { console.error(err); fail++ })
  .finally(async () => {
    await cleanup().catch(e => console.error('cleanup failed', e))
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} statement-descriptor-live: ${pass} passed, ${fail} failed`)
    process.exit(fail === 0 ? 0 : 1)
  })
