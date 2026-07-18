/**
 * C1 — ADMIN MONEY CONTROL integration test.
 *
 * THE CLAIM UNDER TEST: an admin hold is REAL. Not a UI state, not a cancelled job —
 * a state that no path to money can route around. The load-bearing assertions are the
 * GATES (marked ⛔): each one proves that after an admin acts, stripe.transfers.create
 * is NEVER called, by ANY path — the direct executor, the reconciler backstop, or (for
 * organizers) the "form a fresh batch" path that would otherwise sail straight past a
 * held batch.
 *
 * Stripe is SPIED, not called: transfers.create records what WOULD have been sent, so
 * "no money moved" is an assertion about an empty list, not a hope. charges.retrieve is
 * stubbed to return a settled balance_transaction so the vendor executor can reach its
 * gate without a live charge.
 *
 * Isolated + self-cleaning (c1seed- prefix). Run:
 *   npx tsx scripts/c1-admin-money-control-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.REDIS_URL = '' // side-effect enqueues become inert no-ops

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

const SLUG = 'c1seed-'
const MAIL = '@c1seed.local'
const ADMIN = 'clerk_c1_admin'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

// ── Stripe spy ────────────────────────────────────────────────────────────────
interface FakeTransfer { id: string; amount: number; destination: string; key?: string }
const created: FakeTransfer[] = []
const refunded: { id: string; amount: number; charge: string }[] = []
const byKey = new Map<string, FakeTransfer>()
const STRIPE_FEE_CENTS = 50

async function installStripeSpy() {
  const { stripe } = await import('../lib/stripe')
  void stripe.transfers
  ;(stripe.transfers as unknown as Record<string, unknown>).create = async (params: any, opts: any) => {
    const key = opts?.idempotencyKey as string | undefined
    if (key && byKey.has(key)) return byKey.get(key)!
    const t: FakeTransfer = { id: `tr_${rand()}`, amount: params.amount, destination: params.destination, key }
    if (key) byKey.set(key, t)
    created.push(t)
    return t
  }
  // A settled charge, so processOrderPayout can read a real fee and reach the gate.
  ;(stripe.charges as unknown as Record<string, unknown>).retrieve = async (id: string) => ({
    id,
    transfer_group: `order_grp_${id}`,
    balance_transaction: { fee: STRIPE_FEE_CENTS },
    amount: 100_000,
    amount_refunded: 0,
  })
  ;(stripe.refunds as unknown as Record<string, unknown>).create = async (params: any) => {
    const r = { id: `re_${rand()}`, amount: params.amount, charge: params.charge, status: 'succeeded' }
    refunded.push(r)
    return r
  }
}

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true, organizerId: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    // Money rows FK to Vendor/Runner without cascade — clear them before the payees.
    await prisma.adminMoneyAction.deleteMany(w)
    await prisma.payout.deleteMany(w)
    await prisma.payoutHold.deleteMany(w)
    await prisma.vendorEarning.deleteMany(w)
    await prisma.runnerEarning.deleteMany(w)
    await prisma.organizerEarning.deleteMany(w)
    await prisma.negativeBalanceEvent.deleteMany(w)
    await prisma.refund.deleteMany(w)
    await prisma.chargeback.deleteMany(w)
    await prisma.dispute.deleteMany({ where: { order: { eventId: { in: ids } } } })
    await prisma.organizerPayout.deleteMany(w)
    await prisma.order.deleteMany(w)
    await prisma.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany(w)
    await prisma.runner.deleteMany(w)
    await prisma.fulfillmentConfig.deleteMany(w)
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

// ── Seed helpers ──────────────────────────────────────────────────────────────
const mkUser = (role: string) =>
  prisma.user.create({ data: { clerkId: `${SLUG}clerk-${rand()}`, email: `${SLUG}${role}-${rand()}${MAIL}`, name: `C1 ${role}`, role } })

async function mkOrganizer(connected = true) {
  return prisma.fairOrganizer.create({
    data: {
      name: `C1 Org ${rand()}`, contactEmail: `${SLUG}org-${rand()}${MAIL}`,
      ...(connected ? { stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true } : {}),
    },
  })
}

async function mkEvent(organizerId: string) {
  const ev = await prisma.event.create({
    data: {
      name: `C1 ${rand()}`, urlSlug: `${SLUG}${rand()}`, organizerId,
      startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE',
    },
  })
  await prisma.fulfillmentConfig.create({
    data: { eventId: ev.id, homeDeliveryEnabled: true, homeDeliveryFee: 10, runnerFeePercent: 50 },
  })
  return ev
}

/** A vendor plus one menu item (OrderItem requires a real menuItemId FK). */
const menuOf = new Map<string, string>() // vendorId → menuItemId

async function mkVendor(eventId: string, connected = true) {
  const v = await prisma.vendor.create({
    data: {
      eventId, name: `V ${rand()}`, slug: `${SLUG}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE',
      ...(connected ? { stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true } : {}),
    },
  })
  const mi = await prisma.menuItem.create({
    data: { vendorId: v.id, name: `Item ${rand()}`, price: 10, category: 'Test' },
  })
  menuOf.set(v.id, mi.id)
  return v
}

async function mkRunner(eventId: string) {
  const u = await mkUser('runner')
  return prisma.runner.create({
    data: {
      userId: u.id, eventId, status: 'ACTIVE',
      stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date(),
    },
  })
}

/** A COMPLETED multi-vendor order with accrued VendorEarning rows (via the real path). */
async function seedCompleted(eventId: string, vendorIds: string[], perVendor = 10) {
  const customer = await mkUser('customer')
  const subtotal = perVendor * vendorIds.length
  const fee = +(subtotal * 0.1).toFixed(2)
  const order = await prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId: vendorIds[0],
      status: 'COMPLETED', fulfillmentType: 'BOOTH_PICKUP',
      subtotal, fairSynqFee: fee, total: subtotal + fee, vendorPayout: subtotal,
      customerName: 'C1', customerPhone: '+10000000000',
      stripeChargeId: `ch_${SLUG}${rand()}`,
      completedAt: new Date(Date.now() - 5 * 3_600_000), // window closed
      orderItems: {
        create: vendorIds.map(vid => ({
          vendorId: vid, menuItemId: menuOf.get(vid)!, itemName: 'Item', quantity: 1,
          unitPrice: perVendor, totalPrice: perVendor, subtotal: perVendor,
        })),
      },
      vendorOrderStatuses: { create: vendorIds.map(vid => ({ vendorId: vid, status: 'COMPLETED' as const })) },
    },
  })
  const { accrueVendorEarnings } = await import('../lib/process-payout')
  await accrueVendorEarnings(order.id)
  return order.id
}

/** A DELIVERED order with a real RunnerEarning (accrued through reconcileMasterStatus). */
async function seedDelivered(eventId: string, vendorId: string, runnerId: string) {
  const customer = await mkUser('customer')
  const order = await prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId,
      status: 'READY', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: 10, tip: 3, total: 29.5, vendorPayout: 15,
      customerName: 'C1', customerPhone: '+10000000000',
      runnerId, stripeChargeId: `ch_${SLUG}${rand()}`,
      deliveryProofPath: 'https://c1seed.local/p.jpg', // = runner confirmed delivery → DELIVERED
      orderItems: { create: [{ vendorId, menuItemId: menuOf.get(vendorId)!, itemName: 'Item', quantity: 1, unitPrice: 15, totalPrice: 15, subtotal: 15 }] },
      vendorOrderStatuses: { create: [{ vendorId, status: 'READY' }] },
    },
  })
  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  const res = await reconcileMasterStatus(order.id)
  if (res.to !== 'DELIVERED') throw new Error(`seed: expected DELIVERED, got ${res.to ?? res.reason}`)
  await prisma.runnerEarning.update({
    where: { orderId: order.id },
    data: { createdAt: new Date(Date.now() - 5 * 3_600_000) }, // window closed
  })
  await prisma.organizerEarning.updateMany({
    where: { orderId: order.id },
    data: { createdAt: new Date(Date.now() - 5 * 3_600_000) },
  })
  return order.id
}

async function main() {
  await cleanup()
  await installStripeSpy()

  try {
    const { processOrderPayout, accrueVendorEarnings } = await import("../lib/process-payout")
    const { processRunnerPayout, reconcileRunnerPayouts } = await import('../lib/runner-payout')
    const { processEventOrganizerPayout } = await import('../lib/organizer-payout')
    const { setOrderPayoutState, setOrganizerPayoutState, setPayoutFreeze } = await import('../lib/admin-money')

    const org = await mkOrganizer()
    const ev = await mkEvent(org.id)
    const ctx = { adminClerkId: ADMIN, eventId: ev.id }

    // A whole SECOND fair, to prove admin money actions cannot cross fairs.
    const orgB = await mkOrganizer()
    const evB = await mkEvent(orgB.id)
    const venB = await mkVendor(evB.id)
    const orderB = await seedCompleted(evB.id, [venB.id])

    const v1 = await mkVendor(ev.id)
    const v2 = await mkVendor(ev.id)

    // ── [1] Accrual — the hold anchor exists at completion ─────────────────────
    console.log('\n[1] VendorEarning accrues at completion (the anchor an admin can hold)')
    const o1 = await seedCompleted(ev.id, [v1.id, v2.id])
    const acc = await prisma.vendorEarning.findMany({ where: { orderId: o1 }, orderBy: { subtotalCents: 'asc' } })
    assert(acc.length === 2, `2 VendorEarning rows accrued (got ${acc.length})`)
    assert(acc.every(a => a.status === 'accrued'), 'both start status=accrued (payable)')
    assert(acc.every(a => a.subtotalCents === 1000), 'each holds its 1000¢ claim')
    assert(acc.every(a => a.stripeTransferId === null), 'no transfer id yet — a claim, not a receipt')

    // ── [2] ⛔ GATE: an admin HOLD stops the vendor transfer ───────────────────
    console.log('\n[2] ⛔ GATE: HOLD one vendor → executor pays the OTHER, transfers nothing to the held one')
    const held = await setOrderPayoutState(ctx, { payeeType: 'vendor', orderId: o1, vendorId: v1.id, action: 'HOLD', reason: 'suspected fraud' })
    assert(held.newStatus === 'held', 'VendorEarning → held')
    const before2 = created.length
    const r2 = await processOrderPayout(o1)
    assert(r2.blocked.length === 1 && r2.blocked[0].vendorId === v1.id, 'held vendor reported as blocked')
    assert(r2.blocked[0].reason === 'admin_hold', "block reason = 'admin_hold'")
    assert(r2.transfers.length === 1 && r2.transfers[0].vendorId === v2.id, 'the OTHER vendor still got paid (surgical, not a cart-wide freeze)')
    assert(created.length === before2 + 1, `exactly ONE transfer created, not two (got ${created.length - before2})`)
    const v1Acct = (await prisma.vendor.findUnique({ where: { id: v1.id }, select: { stripeAccountId: true } }))!.stripeAccountId
    assert(!created.some(t => t.destination === v1Acct), 'NO transfer landed on the held vendor\'s account')

    // ── [3] ⛔ GATE: the hold does NOT land in the PayoutHold waiting room ─────
    console.log('\n[3] ⛔ GATE: an admin hold writes NO PayoutHold row (that table is the reconciler DRAIN queue)')
    const ph = await prisma.payoutHold.findFirst({ where: { orderId: o1, vendorId: v1.id } })
    assert(ph === null, 'no PayoutHold row for the admin-held vendor — Pattern D can never drain it into a payout')

    // ── [4] ⛔ GATE: the reconciler cannot pay a held slice ────────────────────
    console.log('\n[4] ⛔ GATE: the reconciler backstop refuses the held slice (the silent-leak scenario)')
    // NB: the sweep is global and will legitimately pay OTHER seeded orders, so the
    // assertion is scoped to the HELD vendor's account — "no money reached them",
    // not "the sweep was inert".
    const { runReconciliationSweep } = await import('../lib/reconciler')
    await runReconciliationSweep({ maxPerPattern: 50, stripeWindowHours: 0, maxStripePages: 0 })
    const stillHeld = await prisma.vendorEarning.findFirst({ where: { orderId: o1, vendorId: v1.id } })
    assert(!created.some(t => t.destination === v1Acct), 'reconciler sent NOTHING to the held vendor')
    assert(stillHeld?.status === 'held', 'still held after a full sweep')
    assert(stillHeld?.stripeTransferId === null, 'still no transfer id — the money never left')
    const noPayoutRow = await prisma.payout.count({ where: { orderId: o1, vendorId: v1.id } })
    assert(noPayoutRow === 0, 'no Payout receipt exists for the held slice')

    // ── [5] RELEASE → payable again, and it pays ──────────────────────────────
    console.log('\n[5] RELEASE → back to payable, executor pays it')
    await setOrderPayoutState(ctx, { payeeType: 'vendor', orderId: o1, vendorId: v1.id, action: 'RELEASE', reason: 'investigation cleared' })
    const rel = await prisma.vendorEarning.findFirst({ where: { orderId: o1, vendorId: v1.id } })
    assert(rel?.status === 'accrued', 'released → accrued (payable)')
    const before5 = created.length
    const r5 = await processOrderPayout(o1)
    assert(created.length === before5 + 1, 'released vendor now paid — exactly one new transfer')
    assert(r5.transfers.some(t => t.vendorId === v1.id), 'the released vendor is in the transfers')
    const paidRow = await prisma.vendorEarning.findFirst({ where: { orderId: o1, vendorId: v1.id } })
    assert(paidRow?.status === 'paid' && !!paidRow.stripeTransferId, 'ledger closed: paid ⟺ transfer id stamped')
    assert(paidRow?.netCents === 1000 - Math.round(STRIPE_FEE_CENTS / 2), `net = subtotal − real fee share (${paidRow?.netCents}¢)`)

    // ── [6] Already paid → honestly refuse to "hold" it ───────────────────────
    console.log('\n[6] HONESTY: holding an ALREADY-PAID payout is refused, not faked')
    let refused = false
    try {
      await setOrderPayoutState(ctx, { payeeType: 'vendor', orderId: o1, vendorId: v1.id, action: 'HOLD', reason: 'too late' })
    } catch (e: any) { refused = e?.code === 'ALREADY_PAID' }
    assert(refused, 'ALREADY_PAID — money that already left cannot be held (reversal is a separate action)')

    // ── [7] ⛔ GATE: CANCEL is terminal ────────────────────────────────────────
    console.log('\n[7] ⛔ GATE: CANCEL → never paid, and never resurrected by a sweep')
    const o7 = await seedCompleted(ev.id, [v1.id])
    await setOrderPayoutState(ctx, { payeeType: 'vendor', orderId: o7, vendorId: v1.id, action: 'CANCEL', reason: 'not owed' })
    const before7 = created.length
    const r7 = await processOrderPayout(o7)
    await runReconciliationSweep({ maxPerPattern: 50, stripeWindowHours: 0, maxStripePages: 0 })
    assert(r7.blocked[0]?.reason === 'admin_cancelled', "blocked with reason 'admin_cancelled'")
    assert(created.length === before7, 'no transfer, before OR after a full reconciler sweep')

    // ── [8] ⛔ GATE: vendor-wide FREEZE ────────────────────────────────────────
    console.log('\n[8] ⛔ GATE: FREEZE a vendor → every payout of theirs is blocked')
    const o8 = await seedCompleted(ev.id, [v2.id])
    await setPayoutFreeze(ctx, { payeeType: 'vendor', payeeId: v2.id, frozen: true, reason: 'chargeback spike' })
    const before8 = created.length
    const r8 = await processOrderPayout(o8)
    assert(r8.blocked[0]?.reason === 'payouts_frozen', "blocked with reason 'payouts_frozen'")
    assert(created.length === before8, 'frozen vendor received nothing')
    await setPayoutFreeze(ctx, { payeeType: 'vendor', payeeId: v2.id, frozen: false, reason: 'resolved' })
    const r8b = await processOrderPayout(o8)
    assert(r8b.transfers.length === 1 && created.length === before8 + 1, 'unfrozen → pays normally')

    // ── [9] ⛔ GATE: runner hold + freeze ──────────────────────────────────────
    console.log('\n[9] ⛔ GATE: runner HOLD and FREEZE both stop the runner transfer')
    const run = await mkRunner(ev.id)
    const o9 = await seedDelivered(ev.id, v1.id, run.id)
    await setOrderPayoutState(ctx, { payeeType: 'runner', orderId: o9, action: 'HOLD', reason: 'delivery disputed' })
    const before9 = created.length
    const r9 = await processRunnerPayout(o9)
    assert(r9.outcome === 'blocked' && r9.reason === 'admin_hold', 'runner payout blocked by admin hold')
    assert(created.length === before9, 'no runner transfer')
    const sweep9 = await reconcileRunnerPayouts()
    assert(created.length === before9, 'reconcileRunnerPayouts moved no money either')
    assert(sweep9.paid === 0, 'runner reconciler paid nothing')

    await setOrderPayoutState(ctx, { payeeType: 'runner', orderId: o9, action: 'RELEASE', reason: 'dispute resolved' })
    await setPayoutFreeze(ctx, { payeeType: 'runner', payeeId: run.id, frozen: true, reason: 'under review' })
    const r9b = await processRunnerPayout(o9)
    assert(r9b.outcome === 'blocked' && r9b.reason === 'payouts_frozen', 'released-but-FROZEN runner still blocked (freeze is independent of the per-order hold)')
    assert(created.length === before9, 'still no runner transfer')

    // ── [10] ⛔ GATE: organizer freeze, and the held-batch bypass trap ─────────
    console.log('\n[10] ⛔ GATE: organizer FREEZE → no batch, no transfer')
    await setPayoutFreeze(ctx, { payeeType: 'organizer', payeeId: org.id, frozen: true, reason: 'audit' })
    const before10 = created.length
    const r10 = await processEventOrganizerPayout(ev.id)
    assert(r10.outcome === 'blocked' && r10.reason === 'payouts_frozen', 'organizer payout blocked')
    assert(created.length === before10, 'no organizer transfer')
    const noBatch = await prisma.organizerPayout.count({ where: { eventId: ev.id } })
    assert(noBatch === 0, 'no batch was even formed for a frozen organizer')
    await setPayoutFreeze(ctx, { payeeType: 'organizer', payeeId: org.id, frozen: false, reason: 'cleared' })

    console.log('\n[10b] ⛔ GATE: a HELD batch is not bypassed by forming a fresh one (THE TRAP)')
    await setOrganizerPayoutState(ctx, { action: 'HOLD', reason: 'reconciling with organizer' })
    const before10b = created.length
    const r10b = await processEventOrganizerPayout(ev.id)
    assert(r10b.outcome === 'blocked', 'organizer payout blocked while held')
    assert(created.length === before10b, 'no transfer — the executor did NOT form a second batch around the hold')
    const batches = await prisma.organizerPayout.count({ where: { eventId: ev.id, status: 'paid' } })
    assert(batches === 0, 'no PAID batch exists — the hold was not routed around')

    // ── [11] AUDIT: every action left a durable, attributable row ──────────────
    console.log('\n[11] AUDIT: every admin money action is recorded (who / what / whose money / why)')
    const audits = await prisma.adminMoneyAction.findMany({ where: { eventId: ev.id }, orderBy: { createdAt: 'asc' } })
    assert(audits.length >= 10, `${audits.length} AdminMoneyAction rows written`)
    assert(audits.every(a => a.actorId === ADMIN && a.actorType === 'admin'), 'every row attributes the acting admin (actorId + actorType=admin)')
    assert(audits.every(a => !!a.reason?.trim()), 'every row carries a stated reason')
    assert(audits.every(a => a.eventId === ev.id), 'every row is fair-scoped')
    assert(audits.some(a => a.action === 'HOLD') && audits.some(a => a.action === 'RELEASE')
        && audits.some(a => a.action === 'CANCEL') && audits.some(a => a.action === 'FREEZE')
        && audits.some(a => a.action === 'UNFREEZE'), 'all five action types recorded')
    const holdAudit = audits.find(a => a.action === 'HOLD' && a.payeeType === 'vendor')
    assert(holdAudit?.amountCents === 1000, 'the amount at stake is captured on the audit row')
    assert((holdAudit?.metadata as any)?.previousStatus === 'accrued', 'before/after status captured')

    // ── [12] A money action with no reason is rejected ─────────────────────────
    console.log('\n[12] a money action WITHOUT a reason is rejected (unauditable = not allowed)')
    let noReason = false
    try {
      await setOrderPayoutState(ctx, { payeeType: 'vendor', orderId: o8, vendorId: v2.id, action: 'HOLD', reason: '   ' })
    } catch (e: any) { noReason = e?.code === 'REASON_REQUIRED' }
    assert(noReason, 'blank reason → REASON_REQUIRED')

    // ── [13] MULTI-FAIR: admin money actions cannot cross fairs ────────────────
    console.log('\n[13] MULTI-FAIR: an admin acting in Fair A cannot touch Fair B\'s money')
    let crossFair = false
    try {
      await setOrderPayoutState(ctx, { payeeType: 'vendor', orderId: orderB, vendorId: venB.id, action: 'HOLD', reason: 'cross-fair attempt' })
    } catch (e: any) { crossFair = e?.code === 'EARNING_NOT_FOUND' }
    assert(crossFair, "Fair B's earning is invisible from Fair A's context (404, not someone else's money)")
    // NB: Fair B's order may legitimately have been PAID by the global reconciler
    // sweep above — that's correct, it was never held. What must be true is that the
    // cross-fair admin action left NO mark on it.
    const bUntouched = await prisma.vendorEarning.findFirst({ where: { orderId: orderB } })
    assert(bUntouched?.status !== 'held' && bUntouched?.status !== 'cancelled', "Fair B's earning was NOT held or cancelled by Fair A's admin")
    const bAudits = await prisma.adminMoneyAction.count({ where: { eventId: evB.id } })
    assert(bAudits === 0, 'no audit row leaked into Fair B')

    // ── [14] ⛔⛔ THE STICKY TEST (vendor) ─────────────────────────────────────
    // The whole point of an admin hold. There are TWO kinds of hold in this system:
    //   PASSIVE ('unconnected')  — self-releasing. Reconciler Pattern D exists to
    //                              DRAIN it the instant the vendor connects.
    //   ADMIN   ('held')         — intentional. Must NEVER self-release.
    // The failure mode: admin freezes a suspicious vendor → the vendor connects their
    // Stripe account → the passive drain fires → the money pays out anyway, and the
    // admin's hold was decorative. This proves it does not.
    console.log('\n[14] ⛔⛔ STICKY (vendor): admin hold BEATS the passive auto-release')
    const vSticky = await mkVendor(ev.id, false) // UNCONNECTED — so a passive hold forms
    const o14 = await seedCompleted(ev.id, [vSticky.id])

    // (a) payout runs while unconnected → a PASSIVE, self-releasing hold is recorded
    await processOrderPayout(o14)
    const passive = await prisma.payoutHold.findFirst({ where: { orderId: o14, vendorId: vSticky.id } })
    assert(passive?.reason === 'unconnected' && passive.resolved === false,
      'passive hold exists (unconnected) — this is the one that normally auto-releases')

    // (b) admin holds it
    await setOrderPayoutState(ctx, { payeeType: 'vendor', orderId: o14, vendorId: vSticky.id, action: 'HOLD', reason: 'suspected fraud — do not pay' })

    // (c) the vendor now RESOLVES the passive condition: they connect Stripe.
    await prisma.vendor.update({
      where: { id: vSticky.id },
      data: { stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date() },
    })
    const vStickyAcct = (await prisma.vendor.findUnique({ where: { id: vSticky.id }, select: { stripeAccountId: true } }))!.stripeAccountId

    // (d) fire EVERY release path that exists: the drain sweep AND the executor directly.
    const before14 = created.length
    await runReconciliationSweep({ maxPerPattern: 50, stripeWindowHours: 0, maxStripePages: 0 })
    const r14 = await processOrderPayout(o14)

    assert(r14.blocked[0]?.reason === 'admin_hold', 'executor STILL blocks — admin hold survived the vendor connecting')
    assert(!created.some(t => t.destination === vStickyAcct), '⛔ NO transfer reached the now-CONNECTED vendor')
    assert(created.length === before14, 'no money moved on any path (drain sweep + direct executor)')
    const e14 = await prisma.vendorEarning.findFirst({ where: { orderId: o14, vendorId: vSticky.id } })
    assert(e14?.status === 'held', 'ledger row is STILL held — the passive drain did not clear it')
    assert(e14?.stripeTransferId === null, 'still no transfer id')
    const p14 = await prisma.payout.count({ where: { orderId: o14, vendorId: vSticky.id } })
    assert(p14 === 0, 'no Payout receipt — the money never left the platform')

    // (e) and only an ADMIN can release it
    await setOrderPayoutState(ctx, { payeeType: 'vendor', orderId: o14, vendorId: vSticky.id, action: 'RELEASE', reason: 'cleared' })
    const r14b = await processOrderPayout(o14)
    assert(r14b.transfers.some(t => t.vendorId === vSticky.id), 'after the ADMIN releases, it pays normally')

    // ── [15] ⛔⛔ THE STICKY TEST (runner) ─────────────────────────────────────
    console.log('\n[15] ⛔⛔ STICKY (runner): admin hold BEATS pay-on-connect')
    const rSticky = await prisma.runner.create({
      data: { userId: (await mkUser('runner')).id, eventId: ev.id, status: 'ACTIVE' }, // UNCONNECTED
    })
    const o15 = await seedDelivered(ev.id, v1.id, rSticky.id)
    const pre15 = await processRunnerPayout(o15)
    assert(pre15.outcome === 'held' && pre15.reason === 'unconnected', 'passively held (unconnected runner)')

    await setOrderPayoutState(ctx, { payeeType: 'runner', orderId: o15, action: 'HOLD', reason: 'under investigation' })

    // Runner resolves the passive condition — connects Stripe.
    await prisma.runner.update({
      where: { id: rSticky.id },
      data: { stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date() },
    })

    const before15 = created.length
    const sweep15 = await reconcileRunnerPayouts() // the pay-when-connected mechanism
    const r15 = await processRunnerPayout(o15)
    assert(r15.outcome === 'blocked' && r15.reason === 'admin_hold', 'runner payout STILL blocked after connecting')
    assert(created.length === before15, '⛔ pay-on-connect moved NO money for the admin-held runner')
    assert(sweep15.paid === 0, 'the runner reconciler paid nothing')
    const e15 = await prisma.runnerEarning.findUnique({ where: { orderId: o15 } })
    assert(e15?.status === 'held' && e15.stripeTransferId === null, 'runner ledger still held, no transfer id')

    // ── [16] NO SELF-RESCUE: a non-admin cannot touch money controls ───────────
    // Same standard as the A6 org kill-switch. The money routes ride
    // requireAdminFairContext → requireStrictAdminAuth → hasStrictAdminRole, so a
    // vendor / runner / organizer identity is rejected BEFORE any fair is resolved.
    console.log('\n[16] NO SELF-RESCUE: vendor / runner / organizer cannot hold, freeze, cancel or refund')
    const { hasStrictAdminRole } = await import('../lib/roles')
    // Clerk publicMetadata shape is { roles: [...] } — the SAME shape A6 proves against.
    // The positive case is not decoration: it proves the negatives below are real
    // rejections and not a gate that simply returns false for every input.
    assert(hasStrictAdminRole({ roles: ['admin'] }) === true,          'a strict admin PASSES the gate (so the negatives below are meaningful)')
    assert(hasStrictAdminRole({ roles: ['vendor'] }) === false,        'a VENDOR fails the strict-admin gate → cannot unfreeze their own payout')
    assert(hasStrictAdminRole({ roles: ['runner'] }) === false,        'a RUNNER fails the strict-admin gate → cannot release their own held earning')
    assert(hasStrictAdminRole({ roles: ['organizer'] }) === false,     'an ORGANIZER fails the strict-admin gate → cannot unfreeze their own batch')
    assert(hasStrictAdminRole({ roles: ['event_operator'] }) === false,'an EVENT_OPERATOR fails it too (D2: operator ≠ platform admin)')

    // Structural: EVERY money route goes through the chokepoint — no route can quietly
    // skip the gate. (A route that forgot it would not appear in this grep.)
    const { readdirSync, readFileSync } = await import('node:fs')
    const moneyDir = 'app/api/admin/events/[id]/money'
    const routeFiles: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory()) walk(`${dir}/${f.name}`)
        else if (f.name === 'route.ts') routeFiles.push(`${dir}/${f.name}`)
      }
    }
    walk(moneyDir)
    const allGated = routeFiles.every(f => readFileSync(f, 'utf8').includes('requireAdminFairContext'))
    assert(routeFiles.length === 4, `4 money routes found (${routeFiles.length})`)
    assert(allGated, 'EVERY money route rides requireAdminFairContext — none skips the chokepoint')

    // ── [17] ADMIN REFUND control point ───────────────────────────────────────
    console.log('\n[17] ADMIN REFUND: the admin can drive the refund engine (the door that did not exist)')
    const vRef = await mkVendor(ev.id)
    const o17 = await seedCompleted(ev.id, [vRef.id])
    const { refundVendorPortion } = await import('../lib/process-refund')
    const beforeRef = refunded.length
    const ref = await refundVendorPortion({ orderId: o17, vendorId: vRef.id, reason: 'admin refund', actor: (await mkUser('admin')).id })
    assert(ref.status === 'refunded', 'refund executed through the SINGLE engine')
    assert(ref.case === 1, 'CASE 1 — refunded BEFORE payout fired, so no clawback was needed')
    assert(refunded.length === beforeRef + 1, 'exactly one Stripe refund created')
    assert(ref.stripeReversalId === null, 'no transfer reversal — the money never left the platform')
    // And the refunded vendor is now never paid, by the pre-existing decline/refund guard.
    const beforeR17 = created.length
    const r17 = await processOrderPayout(o17)
    assert(created.length === beforeR17, 'a refunded vendor is never subsequently paid out')
    assert(r17.skippedDeclined.some(s => s.vendorId === vRef.id), 'refunded slice is skipped by the payout executor')

    // ── [18] The MOVED write: the real lifecycle path accrues vendors ─────────
    // seedDelivered drives the genuine reconcileMasterStatus transition. If the
    // accrual is really wired into the lifecycle path (not just called by hand in
    // this test), a DELIVERED order must come out of it with VendorEarning rows.
    console.log('\n[18] the completion-path write lives in reconcileMasterStatus (all 3 payees accrue in one place)')
    const vLife = await mkVendor(ev.id)
    const rLife = await mkRunner(ev.id)
    const o18 = await seedDelivered(ev.id, vLife.id, rLife.id) // ← real transition, no manual accrual
    const [ve18, re18, oe18] = await Promise.all([
      prisma.vendorEarning.findFirst({ where: { orderId: o18 } }),
      prisma.runnerEarning.findUnique({ where: { orderId: o18 } }),
      prisma.organizerEarning.findFirst({ where: { orderId: o18 } }),
    ])
    assert(!!ve18, 'VendorEarning accrued by the LIFECYCLE path itself (not by the executor)')
    assert(!!re18, 'RunnerEarning accrued by the same path (unchanged)')
    assert(!!oe18, 'OrganizerEarning accrued by the same path (unchanged)')
    assert(ve18?.status === 'accrued' && ve18.stripeTransferId === null, 'vendor row is a holdable claim during the window')

    // ── [19] ⛔ IDEMPOTENCY: completion-write + executor re-accrual ────────────
    // The one new risk hardening introduces: TWO writers of the same earning. If the
    // completion path wrote it and the executor re-accrues defensively, they must not
    // produce two rows or two payouts. Guarded by the (orderId,vendorId) unique key +
    // an upsert whose `update` NEVER touches status.
    console.log('\n[19] ⛔ IDEMPOTENCY: completion-write + executor re-accrual → ONE row, ONE payout')
    const vIdem = await mkVendor(ev.id)
    const o19 = await seedCompleted(ev.id, [vIdem.id])       // completion-path write (1st)
    await accrueVendorEarnings(o19)                           // simulate a duplicate completion write (2nd)
    await accrueVendorEarnings(o19)                           // and a third, for good measure
    const rows19a = await prisma.vendorEarning.count({ where: { orderId: o19, vendorId: vIdem.id } })
    assert(rows19a === 1, `3 accrual calls → exactly ONE VendorEarning row (got ${rows19a})`)

    const before19 = created.length
    await processOrderPayout(o19)   // executor re-accrues internally, THEN pays
    await processOrderPayout(o19)   // and a full double-fire of the executor
    const rows19b = await prisma.vendorEarning.count({ where: { orderId: o19, vendorId: vIdem.id } })
    const payouts19 = await prisma.payout.count({ where: { orderId: o19, vendorId: vIdem.id } })
    assert(rows19b === 1, `still exactly ONE row after the executor re-accrued twice (got ${rows19b})`)
    assert(created.length === before19 + 1, `exactly ONE transfer despite a double payout run (got ${created.length - before19})`)
    assert(payouts19 === 1, `exactly ONE Payout receipt (got ${payouts19})`)
    assert(byKey.has(`payout_${o19}_${vIdem.id}`), 'the Stripe idempotency key is what makes the second run inert')

    // Re-accrual must never resurrect an admin decision.
    const vIdem2 = await mkVendor(ev.id)
    const o19b = await seedCompleted(ev.id, [vIdem2.id])
    await setOrderPayoutState(ctx, { payeeType: 'vendor', orderId: o19b, vendorId: vIdem2.id, action: 'HOLD', reason: 'test' })
    await accrueVendorEarnings(o19b) // a late/duplicate completion write lands on a HELD row
    const held19 = await prisma.vendorEarning.findFirst({ where: { orderId: o19b, vendorId: vIdem2.id } })
    assert(held19?.status === 'held', '⛔ re-accrual does NOT clobber an admin HOLD back to payable')
    await setOrderPayoutState(ctx, { payeeType: 'vendor', orderId: o19b, vendorId: vIdem2.id, action: 'CANCEL', reason: 'test' })
    await accrueVendorEarnings(o19b)
    const canc19 = await prisma.vendorEarning.findFirst({ where: { orderId: o19b, vendorId: vIdem2.id } })
    assert(canc19?.status === 'cancelled', '⛔ re-accrual does NOT resurrect an admin CANCEL')

    // ── [20] FAILURE CASE: a failed completion write is loud + recovered ───────
    // Simulate the completion-path accrual failing: an order completes with NO
    // VendorEarning rows. Money must be safe; the loss must be REPAIRED, not silent.
    console.log('\n[20] FAILURE CASE: completion accrual fails → payout safe, loss REPAIRED by Pattern S (not silent)')
    const vFail = await mkVendor(ev.id)
    const customerF = await mkUser('customer')
    const o20 = (await prisma.order.create({
      data: {
        eventId: ev.id, customerId: customerF.id, vendorId: vFail.id,
        status: 'COMPLETED', fulfillmentType: 'BOOTH_PICKUP',
        subtotal: 10, fairSynqFee: 1, total: 11, vendorPayout: 10,
        customerName: 'C1', customerPhone: '+10000000000',
        stripeChargeId: `ch_${SLUG}${rand()}`,
        // STILL IN THE REFUND WINDOW (1h ago, window is 4h). This is the scenario that
        // matters: the accrual failed at completion, and the sweep runs while the money
        // is still holdable. Pattern C won't pay it yet (window open), so Pattern S has
        // a real chance to restore the hold target while it can still be used.
        completedAt: new Date(Date.now() - 1 * 3_600_000),
        orderItems: { create: [{ vendorId: vFail.id, menuItemId: menuOf.get(vFail.id)!, itemName: 'Item', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 }] },
        vendorOrderStatuses: { create: [{ vendorId: vFail.id, status: 'COMPLETED' }] },
      },
    })).id
    // ↑ deliberately NOT accrued — this IS the failed completion write.
    const gone = await prisma.vendorEarning.count({ where: { orderId: o20 } })
    assert(gone === 0, 'the failed write left NO earning row — admin cannot see or hold this payout')

    const sweep20 = await runReconciliationSweep({ maxPerPattern: 50, stripeWindowHours: 0, maxStripePages: 0 })
    const healed = await prisma.vendorEarning.findFirst({ where: { orderId: o20, vendorId: vFail.id } })
    assert(!!healed, '⛔ Pattern S RE-ACCRUED the missing row — the in-window hold is restored, not silently lost')
    assert(healed?.status === 'accrued' && healed.subtotalCents === 1000, 'restored row carries the correct claim')
    assert(sweep20.repaired.S >= 1, `Pattern S counted the repair (S=${sweep20.repaired.S})`)
    assert(sweep20.alerted.some(a => a.startsWith('Pattern S:') && a.includes(o20)), 'the failure is ALERTED by order id — loud, not swallowed')
    assert(sweep20.backstopWarnings.some(w => w.includes('Pattern S')), 'a repair raises a BACKSTOP WARNING — "a real-time path is leaking, investigate"')

    // And admin can now do what the failed write had cost them.
    const late = await setOrderPayoutState(ctx, { payeeType: 'vendor', orderId: o20, vendorId: vFail.id, action: 'HOLD', reason: 'recovered — now holdable' })
    assert(late.newStatus === 'held', 'admin can hold the recovered payout — the capability is genuinely restored')

    // FAIL-SOFT FOR MONEY: even with NO Pattern S run at all, the executor self-heals
    // and the vendor is still paid. Money never depended on the completion write.
    const vFail2 = await mkVendor(ev.id)
    const customerF2 = await mkUser('customer')
    const o20b = (await prisma.order.create({
      data: {
        eventId: ev.id, customerId: customerF2.id, vendorId: vFail2.id,
        status: 'COMPLETED', fulfillmentType: 'BOOTH_PICKUP',
        subtotal: 10, fairSynqFee: 1, total: 11, vendorPayout: 10,
        customerName: 'C1', customerPhone: '+10000000000',
        stripeChargeId: `ch_${SLUG}${rand()}`,
        completedAt: new Date(Date.now() - 5 * 3_600_000),
        orderItems: { create: [{ vendorId: vFail2.id, menuItemId: menuOf.get(vFail2.id)!, itemName: 'Item', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 }] },
        vendorOrderStatuses: { create: [{ vendorId: vFail2.id, status: 'COMPLETED' }] },
      },
    })).id
    const before20b = created.length
    const r20b = await processOrderPayout(o20b) // no accrual ever ran for this order
    assert(r20b.transfers.length === 1 && created.length === before20b + 1,
      'FAIL-SOFT: the vendor is STILL PAID even though the completion accrual never happened — money never depended on it')

    console.log(`\n${'─'.repeat(64)}`)
    console.log(`  ${pass} passed, ${fail} failed`)
    console.log(`  transfers the spy recorded: ${created.length} (every one an INTENDED payout)`)
    console.log(`  refunds  the spy recorded: ${refunded.length}`)
    console.log(`${'─'.repeat(64)}\n`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }

  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => {
  console.error('\n💥', e)
  await cleanup().catch(() => {})
  await prisma.$disconnect()
  process.exit(1)
})
