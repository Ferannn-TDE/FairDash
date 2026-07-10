/**
 * PHASE 1 — money-safety carve-out proof for fair soft-delete (archivedAt).
 *
 * Proves the load-bearing invariant BEFORE the Phase-2 sweep: soft-deleting a fair
 * must NOT strand its money. Stripe test mode, stripe.transfers.create SPIED (no
 * live transfer). Self-cleaning; seeds through the REAL accrual path (same helper
 * shape as scripts/b3-organizer-payout-test.ts).
 *
 *   (a) settling-payout-survives-delete — archive an event that has an accrued,
 *       window-closed OrganizerEarning, then plan+process → still resolves & pays.
 *   (b) resolveOwnedFair carve-out — includeArchived resolves an archived fair;
 *       the DEFAULT 404s it (proves the carve-out is the ONLY thing keeping the
 *       refund/chargeback routes reachable post-delete).
 *   (c) slug integrity — an archived fair still owns its @unique urlSlug; the
 *       create slug-uniqueness read sees it, so a colliding new name → `-2`.
 *
 * Run:  npx tsx scripts/p1-archived-money-safety-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

const SLUG = 'p1arch-'
const MAIL = '@p1arch.local'
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

interface FakeTransfer { id: string; amount: number; key?: string }
const created: FakeTransfer[] = []
const byKey = new Map<string, FakeTransfer>()
async function installStripeSpy() {
  const { stripe } = await import('../lib/stripe')
  void stripe.transfers
  ;(stripe.transfers as unknown as Record<string, unknown>).create = async (params: any, opts: any) => {
    const key = opts?.idempotencyKey as string | undefined
    if (key && byKey.has(key)) return byKey.get(key)!
    const t: FakeTransfer = { id: `tr_${rand()}`, amount: params.amount, key }
    if (key) byKey.set(key, t)
    created.push(t)
    return t
  }
}

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } }) // cascades OrganizerPayout
  }
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function mkUser(role: string) {
  return prisma.user.create({ data: { clerkId: `${SLUG}clerk-${rand()}`, email: `${SLUG}${role}-${rand()}${MAIL}`, name: `P1 ${role}`, role } })
}
async function mkOrganizer() {
  return prisma.fairOrganizer.create({ data: { name: `${SLUG}org-${rand()}`, contactEmail: `${SLUG}org-${rand()}${MAIL}`, stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date() } })
}
async function mkEvent(organizerId: string, urlSlug = `${SLUG}${rand()}`) {
  const ev = await prisma.event.create({ data: { name: `P1 ${rand()}`, urlSlug, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE', organizerId } })
  await prisma.fulfillmentConfig.create({ data: { eventId: ev.id, homeDeliveryEnabled: true, homeDeliveryFee: 10, runnerFeePercent: 50 } })
  return ev
}
async function mkVendor(eventId: string) { return prisma.vendor.create({ data: { eventId, name: `V ${rand()}`, slug: `${SLUG}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } }) }
async function mkRunner(eventId: string) { const u = await mkUser('runner'); return prisma.runner.create({ data: { userId: u.id, eventId, status: 'ACTIVE' } }) }

// Seed a delivered order through the REAL reconciler so OrganizerEarning accrues
// exactly as production would. orgShareCents via 50% split (runnerFeePercent=50).
async function seedDelivered(eventId: string, vendorId: string, runnerId: string, orgShareCents: number, accruedHoursAgo: number) {
  const feeCents = orgShareCents * 2
  const customer = await mkUser('customer')
  const order = await prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId, status: 'READY', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: feeCents / 100, tip: 0, total: 15 + 1.5 + feeCents / 100, vendorPayout: 15,
      customerName: 'P1', customerPhone: '+10000000000', runnerId, curbsidePhotoUrl: 'https://p1arch.local/p.jpg', stripeChargeId: `ch_${SLUG}${rand()}`,
    },
  })
  await prisma.vendorOrderStatus.create({ data: { orderId: order.id, vendorId, status: 'READY' } })
  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  const res = await reconcileMasterStatus(order.id)
  if (!res.wrote || res.to !== 'DELIVERED') throw new Error(`seed: expected DELIVERED, got ${res.to ?? res.reason}`)
  if (accruedHoursAgo > 0) await prisma.organizerEarning.updateMany({ where: { orderId: order.id }, data: { createdAt: new Date(Date.now() - accruedHoursAgo * 3_600_000) } })
  const oe = await prisma.organizerEarning.findUnique({ where: { orderId: order.id }, select: { id: true, amountCents: true } })
  return oe!
}

// Reproduces the create slug-uniqueness loop VERBATIM from
// app/api/organizer/fairs/route.ts:9-19 (its helper is module-private). The
// load-bearing DB read (findUnique by urlSlug) is exercised against the real DB;
// this proves the archived row is still seen so the loop increments off it.
function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}
async function uniqueEventSlug(base: string): Promise<string> {
  const root = slugify(base) || 'fair'
  let slug = root
  for (let i = 2; await prisma.event.findUnique({ where: { urlSlug: slug }, select: { id: true } }); i++) {
    slug = `${root}-${i}`
  }
  return slug
}

async function main() {
  await cleanup()
  await installStripeSpy()
  try {
    const { planOrganizerPayout, processEventOrganizerPayout } = await import('../lib/organizer-payout')
    const { resolveOwnedFair } = await import('../lib/organizer-fair-context')
    const { ApiError } = await import('../lib/api-error')

    // ════ (a) settling payout survives soft-delete ════
    console.log('\n(a) settling-payout-survives-delete: archive an event with an accrued payout → still plans + pays')
    const org = await mkOrganizer()
    const ev = await mkEvent(org.id)
    const ven = await mkVendor(ev.id)
    const run = await mkRunner(ev.id)
    const earning = await seedDelivered(ev.id, ven.id, run.id, 500, 5) // $5.00 org share, window closed

    // SOFT-DELETE the fair (exactly what the DELETE route will do).
    await prisma.event.update({ where: { id: ev.id }, data: { archivedAt: new Date() } })
    const archived = await prisma.event.findUniqueOrThrow({ where: { id: ev.id }, select: { archivedAt: true } })
    assert(archived.archivedAt !== null, 'event is soft-deleted (archivedAt set)')

    const plan = await planOrganizerPayout(ev.id)
    assert(plan.outcome === 'pay', `plan resolved the ARCHIVED event and marked it payable (outcome=${plan.outcome})`)
    assert(plan.includedEarningIds.includes(earning.id) && plan.batchTotalCents === 500, `plan includes the accrued earning, total ${fmt(plan.batchTotalCents)} (archivedAt did NOT exclude it)`)

    const before = created.length
    const result = await processEventOrganizerPayout(ev.id)
    assert(result.outcome === 'paid', `executor PAID the archived fair's earning (outcome=${result.outcome})`)
    assert(created.length === before + 1 && created[created.length - 1].amount === 500, `exactly one $5.00 transfer fired for the deleted fair`)
    const earningAfter = await prisma.organizerEarning.findUniqueOrThrow({ where: { id: earning.id }, select: { status: true } })
    assert(earningAfter.status === 'paid', 'the earning is now marked paid — money was NOT stranded by the soft-delete')

    // ════ (b) resolveOwnedFair carve-out ════
    console.log('\n(b) resolveOwnedFair carve-out: includeArchived resolves the deleted fair; default 404s it')
    const viaCarveOut = await resolveOwnedFair(ev.urlSlug, org.id, { includeArchived: true })
    assert(viaCarveOut.id === ev.id, 'includeArchived:true → refund/chargeback routes still resolve the soft-deleted fair')

    let default404 = false
    try {
      await resolveOwnedFair(ev.urlSlug, org.id)
    } catch (err) {
      default404 = err instanceof ApiError && err.statusCode === 404
    }
    assert(default404, 'DEFAULT resolver (no opts) → 404 for the archived fair (proves the carve-out is the only reachability path)')

    // ════ (c) slug integrity — archived fair keeps its @unique slug ════
    console.log('\n(c) slug integrity: an archived fair still owns its urlSlug → colliding new name resolves to `-2`')
    const org2 = await mkOrganizer()
    const takenSlug = `${SLUG}collide-${rand()}`
    const evTaken = await mkEvent(org2.id, takenSlug)
    await prisma.event.update({ where: { id: evTaken.id }, data: { archivedAt: new Date() } })

    const stillSeen = await prisma.event.findUnique({ where: { urlSlug: takenSlug }, select: { id: true } })
    assert(!!stillSeen, 'the create slug-uniqueness read (findUnique by urlSlug) STILL sees the archived fair')

    const nextSlug = await uniqueEventSlug(takenSlug)
    assert(nextSlug === `${takenSlug}-2`, `colliding name yields "${nextSlug}" (not a reuse of the archived slug → no unique-constraint 500)`)

    // And prove the actual create would succeed with that slug (no DB unique violation).
    const evNew = await mkEvent(org2.id, nextSlug)
    assert(evNew.urlSlug === `${takenSlug}-2`, 'a new fair actually creates on the de-collided slug')
  } finally {
    await cleanup()
  }

  console.log('\n══════════════════════════════════════════════════════════════════')
  console.log(`  P1 ARCHIVED MONEY-SAFETY TEST — ${pass} passed, ${fail} failed   (spied transfers: ${created.length})`)
  console.log(`  CARVE-OUT: soft-delete does NOT strand money — ${fail === 0 ? 'HELD ✅' : 'CHECK ❌'}`)
  console.log('  (cohort deleted — DB back to baseline)')
  console.log('══════════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('[p1-archived-money-safety-test] FAILED:', err)
  try { await cleanup() } catch { /* best effort */ }
  await prisma.$disconnect()
  process.exit(2)
})
