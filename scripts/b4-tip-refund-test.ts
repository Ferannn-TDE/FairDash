/**
 * Owed-back refund (tip + delivery fee) — EXECUTOR integration test. Test database; Stripe is
 * SPIED end to end: charges.retrieve, refunds.list (paged, newest first, honours `limit`) and
 * refunds.create (idempotency simulated, and Stripe's own "can't refund more than the charge"
 * rule enforced). The runner-earned distractor is seeded through the REAL accrual path.
 *
 * Gates: a runner-earned tip/fee is NEVER refunded; nothing is ever refunded twice — checked
 * against the charge's refund list, so an old `tip_refund_` refund with a lost marker is seen;
 * every "don't know" halts with a durable, admin-visible row; resolving a halt never refunds.
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/b4-tip-refund-test.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

const prisma = testPrisma()

const SLUG = 'b2seed-'
const MAIL = '@b2seed.local'
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

// ─── Fake Stripe ──────────────────────────────────────────────────────────────

interface FakeRefund { id: string; amount: number; status: string; metadata: Record<string, string>; created: number; key?: string }
interface FakeCharge { id: string; amount: number; disputed: boolean; refunds: FakeRefund[] }
const charges = new Map<string, FakeCharge>()
/** Refunds made through refunds.create — "real" money moves by the code under test. */
const created: FakeRefund[] = []
const byKey = new Map<string, FakeRefund>()
const throwForOrders = new Set<string>()
const listThrowForCharges = new Set<string>()
/** Refund ids refunds.list pretends not to see (a lagging read) — exercises the key layer. */
const listHides = new Set<string>()
const listCalls = new Map<string, number>()
let clock = 1_700_000_000

const stripeError = (message: string, code: string) => Object.assign(new Error(message), {
  type: 'StripeInvalidRequestError', rawType: 'invalid_request_error', code, statusCode: 400,
})

function addRefund(chargeId: string, amount: number, metadata: Record<string, string> = {}, status = 'succeeded') {
  const ch = charges.get(chargeId)!
  const r: FakeRefund = { id: `re_${rand()}`, amount, status, metadata, created: ++clock }
  ch.refunds.push(r)
  return r
}

async function installStripeSpy() {
  const { stripe } = await import('../lib/stripe')
  void stripe.refunds
  void stripe.charges
  const refunds = stripe.refunds as unknown as Record<string, unknown>
  const chargesApi = stripe.charges as unknown as Record<string, unknown>

  refunds.create = async (params: any, opts: any) => {
    if (params?.metadata?.orderId && throwForOrders.has(params.metadata.orderId)) {
      throw stripeError('No such charge: ch_dead', 'resource_missing')
    }
    const key = opts?.idempotencyKey as string | undefined
    if (key && byKey.has(key)) {
      const prev = byKey.get(key)!
      // Real Stripe: same key + different parameters is an error, never the original object.
      if (prev.amount !== params.amount) throw stripeError('Keys for idempotent requests can only be used with the same parameters they were first used with.', 'idempotency_key_in_use')
      return prev
    }
    const ch = charges.get(params.charge)
    if (!ch) throw stripeError(`No such charge: ${params.charge}`, 'resource_missing')
    const refunded = ch.refunds.filter(r => r.status !== 'failed' && r.status !== 'canceled').reduce((s, r) => s + r.amount, 0)
    if (params.amount > ch.amount - refunded) throw stripeError('Refund amount is greater than unrefunded amount on charge', 'amount_too_large')
    const r: FakeRefund = { id: `re_${rand()}`, amount: params.amount, status: 'succeeded', metadata: params.metadata ?? {}, created: ++clock, key }
    ch.refunds.push(r)
    if (key) byKey.set(key, r)
    created.push(r)
    return r
  }

  refunds.list = async (params: any) => {
    listCalls.set(params.charge, (listCalls.get(params.charge) ?? 0) + 1)
    if (listThrowForCharges.has(params.charge)) throw Object.assign(new Error('Request timed out'), { type: 'StripeConnectionError' })
    const ch = charges.get(params.charge)
    if (!ch) throw stripeError(`No such charge: ${params.charge}`, 'resource_missing')
    const all = ch.refunds.filter(r => !listHides.has(r.id)).sort((a, b) => b.created - a.created) // newest first, like Stripe
    const start = params.starting_after ? all.findIndex(r => r.id === params.starting_after) + 1 : 0
    const limit = params.limit ?? 10
    const data = all.slice(start, start + limit)
    return { object: 'list', data, has_more: start + limit < all.length }
  }

  chargesApi.retrieve = async (id: string) => {
    const ch = charges.get(id)
    if (!ch) throw stripeError(`No such charge: ${id}`, 'resource_missing')
    return { id, amount: ch.amount, disputed: ch.disputed }
  }
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    await prisma.adminMoneyAction.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.owedBackHalt.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function mkUser(role: string) { return prisma.user.create({ data: { clerkId: `${SLUG}clerk-${rand()}`, email: `${SLUG}${role}-${rand()}${MAIL}`, name: `B4 ${role}`, role } }) }
async function mkEvent() {
  const ev = await prisma.event.create({ data: { name: `B4 ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE' } })
  await prisma.fulfillmentConfig.create({ data: { eventId: ev.id, homeDeliveryEnabled: true, homeDeliveryFee: 10, runnerFeePercent: 50 } })
  return ev
}
async function mkVendor(eventId: string) { return prisma.vendor.create({ data: { eventId, name: `V ${rand()}`, slug: `${SLUG}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } }) }
async function mkRunner(eventId: string) { const u = await mkUser('runner'); return prisma.runner.create({ data: { userId: u.id, eventId, status: 'ACTIVE' } }) }

interface SeedOpts {
  tipCents: number
  feeCents?: number
  foodCents?: number
  serviceFeeCents?: number
  serviceChargeCents?: number
  fulfillment?: 'HOME_DELIVERY' | 'CURBSIDE' | 'BOOTH_PICKUP'
  status?: 'CANCELLED' | 'ACCEPTED'
  noCharge?: boolean
  voided?: boolean
  legacyMarker?: boolean
}
/** A cancelled order nobody delivered, with a matching fake Stripe charge (amount = total). */
async function seedCancelled(eventId: string, vendorId: string, o: SeedOpts) {
  const customer = await mkUser('customer')
  const fee = o.feeCents ?? 1000, food = o.foodCents ?? 1500, svc = o.serviceFeeCents ?? 150, sc = o.serviceChargeCents ?? 0
  const totalCents = food + svc + fee + sc + o.tipCents
  const chargeId = `ch_${SLUG}${rand()}`
  const order = await prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId, status: o.status ?? 'CANCELLED', fulfillmentType: o.fulfillment ?? 'HOME_DELIVERY',
      subtotal: food / 100, fairSynqFee: svc / 100, deliveryFee: fee / 100, serviceCharge: sc ? sc / 100 : null, tip: o.tipCents / 100,
      total: totalCents / 100, vendorPayout: food / 100,
      customerName: 'B4', customerPhone: '+10000000000', cancelledAt: new Date(), cancelledBy: 'customer',
      ...(o.noCharge ? {} : { stripeChargeId: chargeId }),
      ...(o.voided ? { voidedAt: new Date(), voidReason: 'test' } : {}),
      ...(o.legacyMarker ? { tipRefundId: `re_legacy_${rand()}`, tipRefundedAt: new Date() } : {}),
    },
  })
  if (!o.noCharge) charges.set(chargeId, { id: chargeId, amount: totalCents, disputed: false, refunds: [] })
  return { order, chargeId, totalCents }
}

async function seedDeliveredTipped(eventId: string, vendorId: string, runnerId: string, tipCents: number) {
  const customer = await mkUser('customer')
  const chargeId = `ch_${SLUG}${rand()}`
  const order = await prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId, status: 'READY', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: 10, tip: tipCents / 100, total: 15 + 1.5 + 10 + tipCents / 100, vendorPayout: 15,
      customerName: 'B4', customerPhone: '+10000000000', runnerId, deliveryProofPath: 'https://b2seed.local/p.jpg', stripeChargeId: chargeId,
    },
  })
  charges.set(chargeId, { id: chargeId, amount: 2650 + tipCents, disputed: false, refunds: [] })
  await prisma.vendorOrderStatus.create({ data: { orderId: order.id, vendorId, status: 'READY' } })
  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  const res = await reconcileMasterStatus(order.id)
  if (!res.wrote || res.to !== 'DELIVERED') throw new Error(`seed delivered: expected DELIVERED, got ${res.to ?? res.reason}`)
  return order
}

/** Engine-style food refund (metadata as lib/process-refund.ts writes it). */
const foodRefund = (chargeId: string, orderId: string, vendorId: string, amount: number) =>
  addRefund(chargeId, amount, { orderId, vendorId, reason: 'vendor_portion_refund', waiveFee: 'false' })
/** A tip-only owed-back refund as the PRE-1.2 code wrote it. */
const oldTipRefund = (chargeId: string, orderId: string, amount: number) => {
  const r = addRefund(chargeId, amount, { orderId, kind: 'tip_owed_back' })
  r.key = `tip_refund_${orderId}`
  byKey.set(r.key, r)
  return r
}

const madeFor = (orderId: string) => created.filter(r => r.metadata.orderId === orderId)
const row = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, select: { tipRefundId: true, tipRefundedAt: true, deliveryFeeRefundCents: true } })
const haltOf = (orderId: string) => prisma.owedBackHalt.findUnique({ where: { orderId } })
const audits = (orderId: string, action: string) => prisma.adminMoneyAction.count({ where: { orderId, action } })

async function main() {
  await cleanup()
  await installStripeSpy()
  try {
    const T = await import('../lib/tip-refund')
    const { processTipRefund, reconcileTipRefunds, decideOwedBack, resolveOwedBackHalt, owedBackCandidateWhere } = T
    const ev = await mkEvent(); const ven = await mkVendor(ev.id); const ven2 = await mkVendor(ev.id); const run = await mkRunner(ev.id)
    const inScan = async (id: string) => (await prisma.order.count({ where: { AND: [{ id }, owedBackCandidateWhere()] } })) === 1

    // ── [0] positive control + the pure ceiling ─────────────────────────────────
    console.log('\n[0] POSITIVE CONTROL — cancelled, no runner, $3 tip + $12.99 fee → one refund of 1599¢')
    const p0 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1299 })
    const r0 = await processTipRefund(p0.order.id)
    assert(r0.outcome === 'refunded', `outcome = refunded (got ${r0.outcome})`)
    assert(madeFor(p0.order.id).length === 1 && madeFor(p0.order.id)[0].amount === 1599, `exactly one refund of 1599¢ (got ${madeFor(p0.order.id).map(r => r.amount).join(',') || 'none'})`)
    assert(listCalls.get(p0.chargeId) === 1, 'the refund list WAS read before refunding (the probe is live)')

    console.log('\n[0b] decideOwedBack — the pure ceiling')
    const L = (refunds: { amount: number; md?: Record<string, string>; status?: string }[], owed = 1599, charge = 5449, kept = 350) =>
      decideOwedBack({ orderId: 'o1', owedCents: owed, chargeAmountCents: charge, keptCents: kept,
        refunds: refunds.map((r, i) => ({ id: `re_${i}`, amount: r.amount, status: r.status ?? 'succeeded', metadata: r.md ?? null, created: i })) })
    const d1 = L([{ amount: 3500 }])
    assert(d1.kind === 'refund' && d1.amountCents === 1599, 'food refunded, nothing else → refund 1599')
    const d2 = L([{ amount: 300, md: { orderId: 'o1', kind: 'tip_owed_back' } }])
    assert(d2.kind === 'refund' && d2.amountCents === 1299, 'old tip refund, food NOT yet refunded → 1299 (never the tip twice)')
    const d3 = L([{ amount: 300, md: { orderId: 'other', kind: 'tip_owed_back' } }, { amount: 3500 }], 1599, 5749)
    assert(d3.kind === 'refund' && d3.amountCents === 1599, "another order's owed-back refund is not credited to this one")
    const d4 = L([{ amount: 1599, md: { orderId: 'o1', kind: 'owed_back' }, status: 'failed' }, { amount: 3500 }])
    assert(d4.kind === 'refund' && d4.amountCents === 1599, 'a FAILED earlier refund does not count as paid back')
    const d5 = L([{ amount: 3500 }, { amount: 1000 }])
    assert(d5.kind === 'halt', 'unrecorded 1000¢ refund leaves room 599 < 1599 → halt (no partial refund)')
    const d6 = L([{ amount: 1599, md: { orderId: 'o1', kind: 'owed_back' }, status: 'pending' }])
    assert(d6.kind === 'covered' && d6.adoptRefundId === 're_0', 'a PENDING owed-back refund counts → covered, adopts its id')

    // ── [1] CURRENT_STATE #18 to the cent ───────────────────────────────────────
    console.log('\n[1] food 3500 + delivery 1299 + tip 300 + service fee 350 → engine 3500 + owed-back 1599; only the fee kept')
    const o1 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1299, foodCents: 3500, serviceFeeCents: 350 })
    foodRefund(o1.chargeId, o1.order.id, ven.id, 3500)
    const r1 = await processTipRefund(o1.order.id)
    const ch1 = charges.get(o1.chargeId)!
    const back1 = ch1.refunds.reduce((s, r) => s + r.amount, 0)
    assert(r1.outcome === 'refunded' && r1.amountCents === 1599, `owed-back refund = 1599¢ (got ${r1.amountCents})`)
    assert(o1.totalCents - back1 === 350, `customer charged ${o1.totalCents}, got back ${back1} → FairSynq keeps exactly 350¢`)

    // ── [2] fee, no tip ─────────────────────────────────────────────────────────
    console.log('\n[2] delivery fee, no tip → refunded (newly scanned)')
    const o2 = await seedCancelled(ev.id, ven.id, { tipCents: 0, feeCents: 1299 })
    assert(await inScan(o2.order.id), 'a fee-only order is in the owed-back scan')
    const r2 = await processTipRefund(o2.order.id)
    assert(r2.outcome === 'refunded' && r2.amountCents === 1299, `refund 1299¢ (got ${r2.amountCents})`)

    // ── [3] tip, no fee (pickup) ────────────────────────────────────────────────
    console.log('\n[3] tip, no delivery fee → tip only')
    const o3 = await seedCancelled(ev.id, ven.id, { tipCents: 250, feeCents: 0, fulfillment: 'BOOTH_PICKUP' })
    const r3 = await processTipRefund(o3.order.id)
    assert(r3.outcome === 'refunded' && r3.amountCents === 250, `refund 250¢ (got ${r3.amountCents})`)
    assert((await row(o3.order.id)).deliveryFeeRefundCents === 0, 'deliveryFeeRefundCents = 0')

    // ── [4] GATE — runner earned it ─────────────────────────────────────────────
    console.log('\n[4] GATE: DELIVERED + real RunnerEarning → nothing refunded, neither tip nor fee')
    const earned = await seedDeliveredTipped(ev.id, ven.id, run.id, 500)
    const re = await prisma.runnerEarning.findUnique({ where: { orderId: earned.id }, select: { amountCents: true } })
    const r4 = await processTipRefund(earned.id)
    assert(re != null, `distractor genuinely accrued a RunnerEarning (${fmt(re?.amountCents ?? 0)})`)
    assert(r4.outcome === 'excluded_runner_earned' && madeFor(earned.id).length === 0, 'excluded_runner_earned, no refund')
    // Same order forced to CANCELLED: still the runner's.
    await prisma.order.update({ where: { id: earned.id }, data: { status: 'CANCELLED' } })
    assert(!(await inScan(earned.id)), 'a runner-earned order is not in the scan even when CANCELLED')
    const r4b = await processTipRefund(earned.id)
    assert(r4b.outcome === 'excluded_runner_earned' && madeFor(earned.id).length === 0, 'direct call still refuses')

    // ── [5] organizer share without runner ──────────────────────────────────────
    console.log('\n[5] OrganizerEarning with no RunnerEarning → halt, no refund')
    const o5 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1000 })
    await prisma.organizerEarning.create({ data: { eventId: ev.id, orderId: o5.order.id, amountCents: 500, source: 'delivery_fee_share' } })
    const r5 = await processTipRefund(o5.order.id)
    const h5 = await haltOf(o5.order.id)
    assert(r5.outcome === 'halted' && r5.haltReason === 'ORGANIZER_SHARE_WITHOUT_RUNNER', `halted ORGANIZER_SHARE_WITHOUT_RUNNER (got ${r5.outcome}/${r5.haltReason})`)
    assert(madeFor(o5.order.id).length === 0 && h5?.resolvedAt === null, 'no refund; open halt row')

    // ── [6] partial multi-vendor cancel ─────────────────────────────────────────
    console.log('\n[6] one of two vendors cancels (order not CANCELLED) → nothing')
    const o6 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1000, status: 'ACCEPTED' })
    foodRefund(o6.chargeId, o6.order.id, ven2.id, 700)
    const r6 = await processTipRefund(o6.order.id)
    assert(r6.outcome === 'not_terminal' && madeFor(o6.order.id).length === 0, 'not_terminal, no refund')

    // ── [7] multi-vendor, all cancel ────────────────────────────────────────────
    console.log('\n[7] two vendors, both cancel → one owed-back refund, fee once')
    const o7 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1000, foodCents: 2200 })
    foodRefund(o7.chargeId, o7.order.id, ven.id, 1500)
    foodRefund(o7.chargeId, o7.order.id, ven2.id, 700)
    await processTipRefund(o7.order.id); await processTipRefund(o7.order.id)
    assert(madeFor(o7.order.id).length === 1 && madeFor(o7.order.id)[0].amount === 1300, `one refund of 1300¢ (got ${madeFor(o7.order.id).map(r => r.amount).join(',')})`)

    // ── [8] curbside ────────────────────────────────────────────────────────────
    console.log('\n[8] curbside fee, cancelled before pickup → refunded')
    const o8 = await seedCancelled(ev.id, ven.id, { tipCents: 0, feeCents: 500, fulfillment: 'CURBSIDE' })
    const r8 = await processTipRefund(o8.order.id)
    assert(r8.outcome === 'refunded' && r8.amountCents === 500, `refund 500¢ (got ${r8.amountCents})`)

    // ── [9] repeats + crash recovery ────────────────────────────────────────────
    console.log('\n[9] run ×3 → one refund; marker lost → covered by the Stripe list; list lag → the key holds')
    const o9 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1000 })
    await processTipRefund(o9.order.id); await processTipRefund(o9.order.id); await processTipRefund(o9.order.id)
    const first9 = madeFor(o9.order.id)
    assert(first9.length === 1, `three runs → one refund (got ${first9.length})`)
    assert(first9[0].key === `owed_back_${o9.order.id}`, `refund used key owed_back_<orderId> (got ${first9[0].key})`)
    await prisma.order.update({ where: { id: o9.order.id }, data: { tipRefundId: null, tipRefundedAt: null } })
    const r9b = await processTipRefund(o9.order.id)
    assert(r9b.outcome === 'covered' && r9b.refundId === first9[0].id && madeFor(o9.order.id).length === 1, '(a) marker lost → covered, adopts the SAME refund id, no new refund')
    await prisma.order.update({ where: { id: o9.order.id }, data: { tipRefundId: null, tipRefundedAt: null } })
    listHides.add(first9[0].id)
    const r9c = await processTipRefund(o9.order.id)
    listHides.delete(first9[0].id)
    assert(madeFor(o9.order.id).length === 1 && r9c.refundId === first9[0].id, '(b) list misses it → same params + same key returns the original, no 2nd refund')

    // ── [10] runner earns between plan and execute ──────────────────────────────
    console.log('\n[10] RunnerEarning appears between plan and execute → no refund')
    const o10 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1000 })
    const { db } = await import('../lib/db')
    const orderDelegate = db.order as unknown as Record<string, any>
    const realFind = orderDelegate.findUniqueOrThrow
    let hookFired = 0
    orderDelegate.findUniqueOrThrow = async (args: any) => {
      if (args?.where?.id === o10.order.id && hookFired === 0) {
        hookFired++
        await prisma.runnerEarning.create({ data: { eventId: ev.id, orderId: o10.order.id, runnerId: run.id, amountCents: 800 } })
      }
      return realFind.call(db.order, args)
    }
    let r10
    try { r10 = await processTipRefund(o10.order.id) } finally { orderDelegate.findUniqueOrThrow = realFind }
    assert(hookFired === 1, 'the race was really injected (hook fired after the plan)')
    assert(r10?.outcome === 'excluded_runner_earned' && madeFor(o10.order.id).length === 0, 'execute re-check refuses, no refund')

    // ── [11] unrecorded refunds leave too little room ───────────────────────────
    console.log('\n[11] food refunded + an unrecorded 1000¢ refund → room 599 < 1599 → HALT, no refund, no marker')
    const o11 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1299, foodCents: 3500, serviceFeeCents: 350 })
    foodRefund(o11.chargeId, o11.order.id, ven.id, 3500)
    addRefund(o11.chargeId, 1000)
    const r11 = await processTipRefund(o11.order.id)
    const h11 = await haltOf(o11.order.id)
    assert(r11.outcome === 'halted' && r11.haltReason === 'REFUND_ROOM_SHORT', `halted REFUND_ROOM_SHORT (got ${r11.outcome})`)
    assert(madeFor(o11.order.id).length === 0 && (await row(o11.order.id)).tipRefundId === null, 'no refund, no marker')
    assert(h11?.owedCents === 1599 && h11?.roomCents === 599, `halt row carries owed 1599 / room 599 (got ${h11?.owedCents}/${h11?.roomCents})`)
    const sweep11 = await reconcileTipRefunds()
    assert(sweep11.alerts.some(a => a.includes(o11.order.id) && a.includes('HALTED')), 'every sweep re-alerts an open halt')
    assert(await audits(o11.order.id, 'OWED_BACK_HALTED') === 1, 'OWED_BACK_HALTED audit written ONCE, not every sweep')
    const h11b = await haltOf(o11.order.id)
    assert(!!h11b && h11b.lastHaltedAt >= h11!.lastHaltedAt && h11b.firstHaltedAt.getTime() === h11!.firstHaltedAt.getTime(), 'lastHaltedAt moves, firstHaltedAt stays')

    // ── [11b] the ordering trap ─────────────────────────────────────────────────
    console.log('\n[11b] food NOT yet refunded + old tip_refund at Stripe, no marker → fee only')
    const o11b = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1299, foodCents: 3500, serviceFeeCents: 350 })
    oldTipRefund(o11b.chargeId, o11b.order.id, 300)
    const r11b = await processTipRefund(o11b.order.id)
    assert(r11b.outcome === 'refunded' && r11b.amountCents === 1299, `refund 1299¢, never the tip again (got ${r11b.amountCents})`)

    // ── [12] legacy marker ──────────────────────────────────────────────────────
    console.log('\n[12] legacy order with the old tip-only marker set → skipped')
    const o12 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1000, legacyMarker: true })
    assert(!(await inScan(o12.order.id)), 'not in the scan')
    const r12 = await processTipRefund(o12.order.id)
    assert(r12.outcome === 'already_refunded' && madeFor(o12.order.id).length === 0, 'already_refunded, no refund')

    // ── [13] itemization ────────────────────────────────────────────────────────
    console.log('\n[13] itemization recorded')
    const row1 = await row(o1.order.id)
    const md1 = madeFor(o1.order.id)[0].metadata
    assert(row1.deliveryFeeRefundCents === 1299 && !!row1.tipRefundId && !!row1.tipRefundedAt, 'deliveryFeeRefundCents = 1299, marker + time set')
    assert(md1.kind === 'owed_back' && md1.tipCents === '300' && md1.deliveryFeeCents === '1299', 'Stripe metadata carries kind owed_back + tip and fee cents')

    // ── [14] Stripe refuses ─────────────────────────────────────────────────────
    console.log('\n[14] Stripe refuses the refund → failure marker, retried next sweep with the same key, one refund in the end')
    const o14 = await seedCancelled(ev.id, ven.id, { tipCents: 400, feeCents: 1000 })
    throwForOrders.add(o14.order.id)
    const fail14 = await reconcileTipRefunds()
    throwForOrders.delete(o14.order.id)
    const m14 = await prisma.adminMoneyAction.findFirst({ where: { orderId: o14.order.id, action: 'TIP_REFUND_FAILED' } })
    assert(fail14.alerts.some(a => a.includes(o14.order.id)), 'alert string kept')
    assert(m14?.payeeType === 'customer' && m14?.amountCents === 1400 && m14?.actorType === 'reconciler', `durable failure row, customer, 1400¢ (got ${m14?.amountCents})`)
    assert(/resource_missing|No such charge/.test(m14?.reason ?? ''), 'reason carries the Stripe failure')
    assert((await row(o14.order.id)).tipRefundId === null && (await haltOf(o14.order.id)) === null, 'no marker, and a failure is NOT a halt')
    await reconcileTipRefunds()
    assert(madeFor(o14.order.id).length === 1 && madeFor(o14.order.id)[0].amount === 1400, 'next sweep refunds it once')
    assert(await audits(o1.order.id, 'TIP_REFUND_FAILED') === 0, 'a successful refund writes no failure row')

    // ── [15] voided ─────────────────────────────────────────────────────────────
    console.log('\n[15] voided order → excluded')
    const o15 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1000, voided: true })
    await reconcileTipRefunds()
    assert(madeFor(o15.order.id).length === 0 && !(await inScan(o15.order.id)), 'not scanned, not refunded')

    // ── [16] (a) old tip refund, marker lost, food refunded ─────────────────────
    console.log('\n[16](a) old tip_refund at Stripe, tipRefundId never saved, food refunded → fee only')
    const o16 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1299, foodCents: 3500, serviceFeeCents: 350 })
    foodRefund(o16.chargeId, o16.order.id, ven.id, 3500)
    oldTipRefund(o16.chargeId, o16.order.id, 300)
    const r16 = await processTipRefund(o16.order.id)
    assert(r16.outcome === 'refunded' && r16.amountCents === 1299, `refund 1299¢ (got ${r16.amountCents})`)
    assert(o16.totalCents - charges.get(o16.chargeId)!.refunds.reduce((s, r) => s + r.amount, 0) === 350, 'net: only the service fee kept')

    // ── [17] (b) already covered ────────────────────────────────────────────────
    console.log('\n[17](b) earlier owed-back refunds cover tip + fee → no refund, marker = existing id, audit')
    const o17 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1000 })
    oldTipRefund(o17.chargeId, o17.order.id, 300)
    const prior17 = addRefund(o17.chargeId, 1000, { orderId: o17.order.id, kind: 'owed_back' })
    const r17 = await processTipRefund(o17.order.id)
    assert(r17.outcome === 'covered' && madeFor(o17.order.id).length === 0, 'covered, no new refund')
    assert((await row(o17.order.id)).tipRefundId === prior17.id, 'marker = the existing re_ id (the latest owed-back refund)')
    assert(await audits(o17.order.id, 'OWED_BACK_COVERED') === 1, 'OWED_BACK_COVERED audit written')
    await processTipRefund(o17.order.id)
    assert(await audits(o17.order.id, 'OWED_BACK_COVERED') === 1, 'not re-audited on a later run')

    console.log('\n[17b] a manual full refund with no owed-back label → halt, no marker')
    const o17b = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1000 })
    addRefund(o17b.chargeId, o17b.totalCents - 150)
    const r17b = await processTipRefund(o17b.order.id)
    assert(r17b.outcome === 'halted' && r17b.haltReason === 'REFUND_ROOM_SHORT', 'halted REFUND_ROOM_SHORT')
    assert(madeFor(o17b.order.id).length === 0 && (await row(o17b.order.id)).tipRefundId === null, 'no refund, no marker')

    // ── [18] list read fails ────────────────────────────────────────────────────
    console.log('\n[18] refund-list read times out → no refund, no marker, no halt, retried')
    const o18 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1000 })
    listThrowForCharges.add(o18.chargeId)
    const s18 = await reconcileTipRefunds()
    listThrowForCharges.delete(o18.chargeId)
    assert(madeFor(o18.order.id).length === 0 && (await row(o18.order.id)).tipRefundId === null, 'no refund, no marker')
    assert(s18.alerts.some(a => a.includes(o18.order.id)) && await audits(o18.order.id, 'TIP_REFUND_FAILED') === 1, 'failure alert + durable row')
    assert((await haltOf(o18.order.id)) === null && await inScan(o18.order.id), 'not a halt; still in the scan')
    await reconcileTipRefunds()
    assert(madeFor(o18.order.id).length === 1, 'retried next sweep → one refund')

    // ── [19] disputed ───────────────────────────────────────────────────────────
    console.log('\n[19] disputed charge → halt; dispute closes → the next run refunds and closes the halt itself')
    const o19 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1000 })
    charges.get(o19.chargeId)!.disputed = true
    const r19 = await processTipRefund(o19.order.id)
    assert(r19.outcome === 'halted' && r19.haltReason === 'CHARGE_DISPUTED' && madeFor(o19.order.id).length === 0, 'halted CHARGE_DISPUTED, no refund')
    charges.get(o19.chargeId)!.disputed = false
    const r19b = await processTipRefund(o19.order.id)
    const h19 = await haltOf(o19.order.id)
    assert(r19b.outcome === 'refunded' && madeFor(o19.order.id).length === 1, 'refunded once the dispute is gone')
    assert(!!h19?.resolvedAt && h19.resolvedBy === 'reconciler', 'halt closed by the reconciler, not left open')

    // ── [20] pagination ─────────────────────────────────────────────────────────
    console.log('\n[20] 12 refunds on one charge, old tip refund the oldest → fee only')
    const o20 = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1299, foodCents: 5000, serviceFeeCents: 500 })
    oldTipRefund(o20.chargeId, o20.order.id, 300)
    for (let i = 0; i < 11; i++) foodRefund(o20.chargeId, o20.order.id, ven.id, 10)
    const r20 = await processTipRefund(o20.order.id)
    assert(r20.outcome === 'refunded' && r20.amountCents === 1299, `refund 1299¢ (got ${r20.amountCents})`)

    console.log('\n[20b] 230 refunds (3 pages of 100), old tip refund on the LAST page → fee only, every page read')
    const o20b = await seedCancelled(ev.id, ven.id, { tipCents: 300, feeCents: 1299, foodCents: 5000, serviceFeeCents: 500 })
    oldTipRefund(o20b.chargeId, o20b.order.id, 300)
    for (let i = 0; i < 229; i++) foodRefund(o20b.chargeId, o20b.order.id, ven.id, 10)
    const r20b = await processTipRefund(o20b.order.id)
    assert((listCalls.get(o20b.chargeId) ?? 0) >= 3, `read ${listCalls.get(o20b.chargeId)} pages (≥ 3)`)
    assert(r20b.outcome === 'refunded' && r20b.amountCents === 1299, `refund 1299¢ (got ${r20b.amountCents}) — a first-page-only read would refund 1599`)

    // ── [21] resolve a halt ─────────────────────────────────────────────────────
    console.log('\n[21] admin resolves the [11] halt → note + audit, no refund, never re-alerted or refunded')
    const ctx = { adminClerkId: 'admin_test', eventId: ev.id }
    let noteRequired = false
    try { await resolveOwedBackHalt(ctx, o11.order.id, '  ') } catch { noteRequired = true }
    assert(noteRequired, 'a blank note is refused')
    const other = await mkEvent()
    const cross = await resolveOwedBackHalt({ adminClerkId: 'admin_test', eventId: other.id }, o11.order.id, 'wrong fair')
    assert(!cross.ok && cross.code === 'NOT_FOUND', 'another fair cannot resolve it (NOT_FOUND)')
    assert(await inScan(o11.order.id), 'control: the OPEN halt is still in the scan')
    const before21 = created.length
    const res21 = await resolveOwedBackHalt(ctx, o11.order.id, 'refunded 1599 by hand in Stripe')
    const h21 = await haltOf(o11.order.id)
    assert(res21.ok && !!h21?.resolvedAt && h21.resolvedBy === 'admin_test' && h21.resolutionNote === 'refunded 1599 by hand in Stripe', 'resolved with who + note')
    assert(await audits(o11.order.id, 'OWED_BACK_HALT_RESOLVED') === 1, 'OWED_BACK_HALT_RESOLVED audit written')
    assert(created.length === before21, 'resolving issued no refund')
    const again = await resolveOwedBackHalt(ctx, o11.order.id, 'twice')
    assert(!again.ok && again.code === 'ALREADY_RESOLVED' && await audits(o11.order.id, 'OWED_BACK_HALT_RESOLVED') === 1, 'a second resolve is refused and writes no audit')
    // Even if Stripe would now allow it, a resolved order is left alone.
    charges.get(o11.chargeId)!.refunds = charges.get(o11.chargeId)!.refunds.filter(r => r.amount !== 1000)
    assert(!(await inScan(o11.order.id)), 'out of the scan')
    const s21 = await reconcileTipRefunds()
    assert(!s21.alerts.some(a => a.includes(o11.order.id)), 'no alert on the next sweep')
    const r21 = await processTipRefund(o11.order.id)
    assert(r21.outcome === 'halt_resolved' && madeFor(o11.order.id).length === 0, 'direct call → halt_resolved, still no refund')
    assert((await haltOf(o5.order.id))?.resolvedAt === null && await inScan(o5.order.id), "resolving one halt left the other open halt ([5]) alone")
  } finally {
    await cleanup()
  }

  console.log('\n══════════════════════════════════════════════════════════════════')
  console.log(`  OWED-BACK REFUND TEST — ${pass} passed, ${fail} failed   (refunds made: ${created.length})`)
  console.log(`  GATES: runner-earned never refunded + no double refund (checked against Stripe) + halts durable — ${fail === 0 ? 'HELD ✅' : 'CHECK ❌'}`)
  console.log('  (cohort deleted — DB back to baseline)')
  console.log('══════════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('[b4-tip-refund-test] FAILED:', err)
  try { await cleanup() } catch { /* best effort */ }
  await prisma.$disconnect()
  process.exit(2)
})
