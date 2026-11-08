/**
 * PAYOUT SAFETY — the delivered-order backstop, the transfer_exists guard, the Pattern Y alert,
 * the stranded-earnings proof, and the chargeback-orphan cancel script.
 *
 * Stripe is a SPY, not test mode (the C1 suite's harness): transfers.create records every call
 * it receives and replays the same transfer for a repeated idempotency key; charges.retrieve
 * returns a settled fee. "Paid once" therefore means the spy saw exactly one transfer call to
 * that vendor, and "never paid" means it saw none, which a test-mode account cannot prove.
 * The database is the real test database. REDIS_URL is emptied, so a DELAYED payout enqueue
 * is skipped exactly as when Redis is down (left for Pattern C) and Pattern C's own enqueue
 * runs the payout inline.
 *
 *   [0] baseline: the classifier still pays a normal slice (probe is live)
 *   [1] transfer_exists: classifier + executor (pending / paid / reversed record) block before
 *       Stripe, earning and holds untouched; positive control pays the same shape without one
 *   [2] delivered after the fix: completedAt stamped; nothing paid inside the refund window;
 *       Pattern C pays it ONCE in its window; a second sweep sends nothing
 *   [3] legacy and stranded shapes are in no backstop's selection and never paid
 *   [4] Pattern Y alerts on an owed earning whose transfer exists; silent on clean shapes
 *   [5] cancel-chargeback-orphan: dry run, real run, audit, idempotent re-run, refusals
 *   [6] static wiring: the executor checks transfer_exists before transfers.create, and the
 *       patterns use the shared selection functions
 *
 * Isolated + self-cleaning (psafe- prefix). Run:
 *   ./scripts/with-test-db.sh npx tsx scripts/payout-safety-test.ts
 */

import { config } from 'dotenv'
import { readFileSync } from 'node:fs'
import { testPrisma } from '../lib/test-db'
import { stripComments } from './_strip-comments'
config({ path: '.env.local' })
process.env.REDIS_URL = '' // delayed enqueues are skipped (left for Pattern C); immediate ones run inline

const prisma = testPrisma()
const SLUG = 'psafe-'
const MAIL = '@psafe.local'
const rand = () => Math.random().toString(36).slice(2, 10)
const HOUR = 3_600_000
const DAY = 24 * HOUR

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

// ── Stripe spy ────────────────────────────────────────────────────────────────
interface FakeTransfer { id: string; amount: number; destination: string; key?: string }
const created: FakeTransfer[] = []
const byKey = new Map<string, FakeTransfer>()
const STRIPE_FEE_CENTS = 50
const transfersTo = (acct: string) => created.filter(t => t.destination === acct)
// No path in this suite may refund a customer. The spy records any attempt and throws, so a
// fixture that accidentally invites a refund (e.g. a REFUNDED portion with no refund record,
// which Pattern H repairs) fails the run instead of reaching Stripe.
const refundAttempts: unknown[] = []

async function installStripeSpy() {
  const { stripe } = await import('../lib/stripe')
  ;(stripe.transfers as unknown as Record<string, unknown>).create = async (params: any, opts: any) => {
    const key = opts?.idempotencyKey as string | undefined
    if (key && byKey.has(key)) return byKey.get(key)!
    const t: FakeTransfer = { id: `tr_${SLUG}${rand()}`, amount: params.amount, destination: params.destination, key }
    if (key) byKey.set(key, t)
    created.push(t)
    return t
  }
  ;(stripe.refunds as unknown as Record<string, unknown>).create = async (params: unknown) => {
    refundAttempts.push(params)
    throw new Error('psafe spy: refunds.create must never be called in this suite')
  }
  ;(stripe.charges as unknown as Record<string, unknown>).retrieve = async (id: string) => ({
    id, transfer_group: `order_grp_${id}`, balance_transaction: { fee: STRIPE_FEE_CENTS }, amount: 100_000, amount_refunded: 0,
  })
}

// ── Seeds ─────────────────────────────────────────────────────────────────────
const menuOf = new Map<string, string>()
const mkUser = (role: string) =>
  prisma.user.create({ data: { clerkId: `${SLUG}clerk-${rand()}`, email: `${SLUG}${role}-${rand()}${MAIL}`, name: `PS ${role}`, role } })

async function mkEvent() {
  const ev = await prisma.event.create({
    data: { name: `PS ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + DAY), status: 'ACTIVE' },
  })
  await prisma.fulfillmentConfig.create({ data: { eventId: ev.id, homeDeliveryEnabled: true, homeDeliveryFee: 10, runnerFeePercent: 50 } })
  return ev
}

async function mkVendor(eventId: string) {
  const v = await prisma.vendor.create({
    data: {
      eventId, name: `V ${rand()}`, slug: `${SLUG}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE',
      stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date(),
    },
  })
  const mi = await prisma.menuItem.create({ data: { vendorId: v.id, name: `Item ${rand()}`, price: 10, category: 'Test' } })
  menuOf.set(v.id, mi.id)
  return v
}

async function mkRunner(eventId: string) {
  const u = await mkUser('runner')
  return prisma.runner.create({
    data: { userId: u.id, eventId, status: 'ACTIVE', stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date() },
  })
}

/** A COMPLETED order (one $10 line per vendor) with accrued earnings via the real path. */
async function seedCompleted(eventId: string, vendorIds: string[], completedAt: Date) {
  const customer = await mkUser('customer')
  const subtotal = 10 * vendorIds.length
  const fee = +(subtotal * 0.1).toFixed(2)
  const order = await prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId: vendorIds[0], status: 'COMPLETED', fulfillmentType: 'BOOTH_PICKUP',
      subtotal, fairSynqFee: fee, total: subtotal + fee, vendorPayout: subtotal, customerName: 'PS', customerPhone: '+10000000000',
      stripeChargeId: `ch_${SLUG}${rand()}`, placedAt: new Date(completedAt.getTime() - HOUR), completedAt,
      orderItems: { create: vendorIds.map(vid => ({ vendorId: vid, menuItemId: menuOf.get(vid)!, itemName: 'Item', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 })) },
      vendorOrderStatuses: { create: vendorIds.map(vid => ({ vendorId: vid, status: 'COMPLETED' as const })) },
    },
  })
  const { accrueVendorEarnings } = await import('../lib/process-payout')
  await accrueVendorEarnings(order.id)
  return order.id
}

/** A payout record as an earlier transfer would have left it (no Stripe call). */
async function mkPayout(eventId: string, orderId: string, vendorId: string, status: 'pending' | 'paid' | 'reversed') {
  return prisma.payout.create({
    data: {
      eventId, orderId, vendorId, grossAmount: 10, fairSynqFee: 0.3, netAmount: 9.7,
      stripeTransferId: `tr_${SLUG}old-${rand()}`, stripeStatus: status, processedAt: new Date(Date.now() - 100 * DAY),
      ...(status === 'reversed' ? { reversedAt: new Date(Date.now() - 100 * DAY), stripeReversalId: `trr_${SLUG}${rand()}` } : {}),
    },
  })
}

async function mkDisputeDebt(eventId: string, orderId: string, vendorId: string, amountCents: number, reversalId: string | null) {
  return prisma.negativeBalanceEvent.create({
    data: { eventId, orderId, vendorId, amountCents, reversalId, kind: 'dispute_clawback', status: 'open', note: 'psafe seeded dispute debt' },
  })
}

const earningOf = (orderId: string, vendorId: string) =>
  prisma.vendorEarning.findUnique({ where: { orderId_vendorId: { orderId, vendorId } }, select: { status: true, stripeTransferId: true } })

async function sweep() {
  const { runReconciliationSweep } = await import('../lib/reconciler')
  return runReconciliationSweep({ maxPerPattern: 100, stripeWindowHours: 0, maxStripePages: 0 })
}

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.adminMoneyAction.deleteMany(w)
    await prisma.payout.deleteMany(w)
    await prisma.payoutHold.deleteMany(w)
    await prisma.vendorEarning.deleteMany(w)
    await prisma.runnerEarning.deleteMany(w)
    await prisma.organizerEarning.deleteMany(w)
    await prisma.negativeBalanceEvent.deleteMany(w)
    await prisma.refund.deleteMany(w)
    await prisma.order.deleteMany(w)
    await prisma.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany(w)
    await prisma.runner.deleteMany(w)
    await prisma.fulfillmentConfig.deleteMany(w)
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function main() {
  await cleanup()
  await installStripeSpy()
  const { classifyVendorSlice, processOrderPayout } = await import('../lib/process-payout')
  const rc = await import('../lib/reconciler')
  const base = { declined: false, earningStatus: 'accrued' as string | null | undefined, connected: true, payoutsFrozen: false, transferCents: 970, transferExists: false }

  console.log('[0] baseline: a normal accrued, connected slice with no transfer pays (probe is live)')
  assert(classifyVendorSlice({ ...base }).outcome === 'pay', "accrued + connected + no transfer → 'pay'")

  console.log('\n[1] transfer_exists: an owed slice whose transfer already exists is blocked before Stripe')
  const te = classifyVendorSlice({ ...base, transferExists: true })
  assert(te.outcome === 'blocked' && te.blockedReason === 'transfer_exists', "accrued + transfer exists → blocked/transfer_exists")
  assert(classifyVendorSlice({ ...base, transferExists: true, earningStatus: 'paid' }).outcome === 'already_paid', 'paid still classifies already_paid (unchanged)')
  assert(classifyVendorSlice({ ...base, transferExists: true, declined: true }).outcome === 'skip', 'declined still wins first (unchanged)')

  const ev = await mkEvent()
  const vA = await mkVendor(ev.id), vB = await mkVendor(ev.id), vC = await mkVendor(ev.id), vD = await mkVendor(ev.id)
  const old = new Date(Date.now() - 100 * DAY)
  for (const [status, v] of [['pending', vA], ['paid', vB], ['reversed', vC]] as const) {
    const orderId = await seedCompleted(ev.id, [v.id], old)
    await mkPayout(ev.id, orderId, v.id, status)
    const before = created.length
    const res = await processOrderPayout(orderId)
    assert(created.length === before, `executor: ${status} transfer record → no transfers.create call`)
    assert(res.blocked.some(b => b.vendorId === v.id && b.reason === 'transfer_exists'), `executor: ${status} → result.blocked reason transfer_exists`)
    assert((await earningOf(orderId, v.id))?.status === 'accrued', `executor: ${status} → earning left accrued`)
    assert((await prisma.payoutHold.count({ where: { orderId } })) === 0, `executor: ${status} → no hold written`)
  }
  {
    const orderId = await seedCompleted(ev.id, [vD.id], old)
    await processOrderPayout(orderId)
    const t = transfersTo(vD.stripeAccountId!)
    assert(t.length === 1 && t[0].amount === 1000 - STRIPE_FEE_CENTS, 'positive control: the same shape with NO transfer record pays once (950¢)')
    assert((await earningOf(orderId, vD.id))?.status === 'paid', 'positive control: earning marked paid')
  }

  console.log('\n[2] delivered after the fix: completedAt stamped, Pattern C pays it once in its window')
  const vDel = await mkVendor(ev.id)
  const runner = await mkRunner(ev.id)
  const customer = await mkUser('customer')
  const del = await prisma.order.create({
    data: {
      eventId: ev.id, customerId: customer.id, vendorId: vDel.id, status: 'READY', fulfillmentType: 'CURBSIDE',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: 10, tip: 3, total: 29.5, vendorPayout: 15, customerName: 'PS', customerPhone: '+10000000000',
      runnerId: runner.id, stripeChargeId: `ch_${SLUG}${rand()}`, deliveryProofPath: 'https://psafe.local/p.jpg',
      orderItems: { create: [{ vendorId: vDel.id, menuItemId: menuOf.get(vDel.id)!, itemName: 'Item', quantity: 1, unitPrice: 15, totalPrice: 15, subtotal: 15 }] },
      vendorOrderStatuses: { create: [{ vendorId: vDel.id, status: 'READY' }] },
    },
  })
  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  const t0 = Date.now()
  const rec = await reconcileMasterStatus(del.id)
  assert(rec.to === 'DELIVERED', `order reached DELIVERED (got ${rec.to ?? rec.reason})`)
  const afterDel = await prisma.order.findUnique({ where: { id: del.id }, select: { completedAt: true } })
  assert(afterDel?.completedAt != null && afterDel.completedAt.getTime() >= t0 - 1000, 'completedAt stamped at delivery')
  assert((await earningOf(del.id, vDel.id))?.status === 'accrued', 'vendor earning accrued at delivery')
  assert(transfersTo(vDel.stripeAccountId!).length === 0, 'delayed payout skipped (Redis down): nothing paid at delivery')

  const inWindow = await rc.selectPatternCCandidates({ windowStart: new Date(Date.now() - DAY), now: new Date(), maxPerPattern: 100 })
  assert(!inWindow.some(c => c.orderId === del.id), 'control: Pattern C does NOT select it inside the 4h refund window')
  await sweep()
  assert(transfersTo(vDel.stripeAccountId!).length === 0, 'control: a sweep inside the refund window pays nothing')

  // Time passes: the refund window closes (completedAt 5h ago, still inside C's 24h window).
  await prisma.order.update({ where: { id: del.id }, data: { completedAt: new Date(Date.now() - 5 * HOUR) } })
  const due = await rc.selectPatternCCandidates({ windowStart: new Date(Date.now() - DAY), now: new Date(), maxPerPattern: 100 })
  assert(due.some(c => c.orderId === del.id), 'Pattern C selects the delivered order once its window has closed')
  await sweep()
  const paidOnce = transfersTo(vDel.stripeAccountId!)
  assert(paidOnce.length === 1 && paidOnce[0].amount === 1500 - STRIPE_FEE_CENTS, 'first sweep: vendor paid exactly once (1450¢)')
  assert((await earningOf(del.id, vDel.id))?.status === 'paid', 'earning marked paid')
  await sweep()
  assert(transfersTo(vDel.stripeAccountId!).length === 1, 'second sweep: no second transfer (no double pay)')

  console.log('\n[3] legacy and stranded shapes: in no backstop selection, never paid')
  const vLegacy = await mkVendor(ev.id), vStr = await mkVendor(ev.id)
  // Legacy DELIVERED: delivered before the fix, so completedAt is null; accrued, no payout, no hold.
  const legacy = await prisma.order.create({
    data: {
      eventId: ev.id, customerId: customer.id, vendorId: vLegacy.id, status: 'DELIVERED', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: 10, tip: 3, total: 29.5, vendorPayout: 15, customerName: 'PS', customerPhone: '+10000000000',
      runnerId: runner.id, stripeChargeId: `ch_${SLUG}${rand()}`, deliveryProofPath: 'https://psafe.local/p.jpg',
      placedAt: new Date(Date.now() - 90 * DAY), completedAt: null,
      orderItems: { create: [{ vendorId: vLegacy.id, menuItemId: menuOf.get(vLegacy.id)!, itemName: 'Item', quantity: 1, unitPrice: 15, totalPrice: 15, subtotal: 15 }] },
      vendorOrderStatuses: { create: [{ vendorId: vLegacy.id, status: 'COMPLETED' }] },
    },
  })
  await prisma.vendorEarning.create({ data: { eventId: ev.id, orderId: legacy.id, vendorId: vLegacy.id, subtotalCents: 1500, status: 'accrued' } })
  // Stranded COMPLETED (the Jul 17 shape): completed long ago, accrued, no payout, no hold.
  const stranded = await seedCompleted(ev.id, [vStr.id], new Date(Date.now() - 113 * DAY))

  const win = { windowStart: new Date(Date.now() - DAY), now: new Date(), maxPerPattern: 100 }
  const cSel = await rc.selectPatternCCandidates(win)
  const sSel = await rc.selectPatternSCandidates(win)
  const dSel = await rc.selectPatternDCandidates({ maxPerPattern: 100 })
  for (const [name, id] of [['legacy delivered', legacy.id], ['stranded completed', stranded]] as const) {
    assert(!cSel.some(c => c.orderId === id), `${name}: not in Pattern C selection`)
    assert(!sSel.some(c => c.orderId === id), `${name}: not in Pattern S selection`)
    assert(!dSel.some(c => c.orderId === id), `${name}: not in Pattern D selection`)
  }
  // Even at "deploy + 24h": the windows key on completedAt, which never changes for these rows.
  const later = { windowStart: new Date(Date.now() + 0), now: new Date(Date.now() + DAY), maxPerPattern: 100 }
  assert(!(await rc.selectPatternCCandidates(later)).some(c => c.orderId === legacy.id || c.orderId === stranded), 'neither enters Pattern C with the clock moved forward 24h')
  await sweep(); await sweep()
  assert(transfersTo(vLegacy.stripeAccountId!).length === 0, 'legacy delivered: two full sweeps send nothing')
  assert(transfersTo(vStr.stripeAccountId!).length === 0, 'stranded completed: two full sweeps send nothing')
  assert((await earningOf(legacy.id, vLegacy.id))?.status === 'accrued' && (await earningOf(stranded, vStr.id))?.status === 'accrued',
    'both earnings left accrued (untouched)')
  // Probe control for [3]: section [2] proved the same sweep DOES pay an in-window order.

  console.log('\n[4] Pattern Y: an owed earning whose transfer already exists is alerted')
  const vO1 = await mkVendor(ev.id), vO2 = await mkVendor(ev.id), vClean = await mkVendor(ev.id), vRef = await mkVendor(ev.id)
  const orphan = await seedCompleted(ev.id, [vO1.id, vO2.id], new Date(Date.now() - 119 * DAY))
  const p1 = await mkPayout(ev.id, orphan, vO1.id, 'reversed')
  const p2 = await mkPayout(ev.id, orphan, vO2.id, 'reversed')
  await mkDisputeDebt(ev.id, orphan, vO1.id, 216, p1.stripeReversalId)
  await mkDisputeDebt(ev.id, orphan, vO2.id, 3990, p2.stripeReversalId)
  // Clean: paid earning + paid transfer.
  const clean = await seedCompleted(ev.id, [vClean.id], old)
  await mkPayout(ev.id, clean, vClean.id, 'paid')
  await prisma.vendorEarning.update({ where: { orderId_vendorId: { orderId: clean, vendorId: vClean.id } }, data: { status: 'paid' } })
  // Refunded after payout: transfer reversed, portion REFUNDED, earning cancelled.
  const refunded = await seedCompleted(ev.id, [vRef.id], old)
  await mkPayout(ev.id, refunded, vRef.id, 'reversed')
  await prisma.vendorOrderStatus.updateMany({ where: { orderId: refunded }, data: { status: 'REFUNDED' } })
  await prisma.vendorEarning.update({ where: { orderId_vendorId: { orderId: refunded, vendorId: vRef.id } }, data: { status: 'cancelled' } })
  // …with its completed refund record, as the refund engine leaves it (CASE 2).
  await prisma.refund.create({ data: { eventId: ev.id, orderId: refunded, vendorId: vRef.id, amountCents: 1000, status: 'COMPLETED', stripeRefundId: `re_${SLUG}${rand()}`, stripeReversalId: `trr_${SLUG}${rand()}`, createdBy: 'psafe' } })

  const ySel = await rc.selectTransferExistsEarnings({ maxPerPattern: 100 })
  assert(ySel.filter(r => r.orderId === orphan).length === 2, 'selection: both orphan earnings found')
  assert(!ySel.some(r => r.orderId === clean) && !ySel.some(r => r.orderId === refunded), 'selection: clean and refunded shapes not found')
  const s4 = await sweep()
  const yAlert = s4.alerted.find(a => a.startsWith('Pattern Y') && a.includes(orphan))
  assert(!!yAlert, 'sweep alert names Pattern Y and the orphan order')
  assert(!s4.alerted.some(a => a.startsWith('Pattern Y') && (a.includes(clean) || a.includes(refunded))), 'sweep alert silent on the clean and refunded orders')
  assert(transfersTo(vO1.stripeAccountId!).length === 0 && transfersTo(vO2.stripeAccountId!).length === 0, 'orphan vendors: no transfer from the sweep')

  console.log('\n[5] cancel-chargeback-orphan')
  const { cancelChargebackOrphan } = await import('./cancel-chargeback-orphan')
  const spec = { orderId: orphan, vendors: [{ vendorId: vO1.id, subtotalCents: 1000 }, { vendorId: vO2.id, subtotalCents: 1000 }] }
  const dry = await cancelChargebackOrphan(prisma, spec, { confirm: false })
  assert(!dry.refused && dry.planned === 2 && dry.cancelled === 0, 'dry run: plans 2, writes nothing')
  assert((await earningOf(orphan, vO1.id))?.status === 'accrued', 'dry run: earnings still accrued')
  const real = await cancelChargebackOrphan(prisma, spec, { confirm: true })
  assert(!real.refused && real.cancelled === 2 && real.ok, 'real run: cancels exactly 2 and the final-state re-read agrees')
  assert((await earningOf(orphan, vO1.id))?.status === 'cancelled' && (await earningOf(orphan, vO2.id))?.status === 'cancelled', 'both earnings cancelled')
  const audits = await prisma.adminMoneyAction.findMany({ where: { orderId: orphan } })
  assert(audits.length === 2 && audits.every(a => a.action === 'CANCEL' && a.actorType === 'admin' && a.actorId === 'script:cancel-chargeback-orphan' && a.payeeType === 'vendor'),
    'two CANCEL audits, actor admin / script:cancel-chargeback-orphan')
  assert(audits.every(a => a.reason.includes('approved by Feran') && a.amountCents === 1000 && a.earningId != null), 'audit reason says "approved by Feran", with amount and earning id')
  assert(audits.every(a => /trr_/.test(a.reason)), 'audit reason names the reversal')
  assert((await prisma.negativeBalanceEvent.count({ where: { orderId: orphan, status: 'open' } })) === 2, 'the two dispute debts stay open (untouched)')
  const again = await cancelChargebackOrphan(prisma, spec, { confirm: true })
  assert(!again.refused && again.cancelled === 0 && again.ok && (await prisma.adminMoneyAction.count({ where: { orderId: orphan } })) === 2, 're-run: nothing changes, no extra audit')
  const s5 = await sweep()
  assert(!s5.alerted.some(a => a.startsWith('Pattern Y') && a.includes(orphan)), 'Pattern Y silent on the orphan after the cancel')

  // Refusals — each must write nothing.
  const vR1 = await mkVendor(ev.id), vR2 = await mkVendor(ev.id), vR3 = await mkVendor(ev.id)
  const notOwed = await seedCompleted(ev.id, [vR1.id], old)
  const pNo = await mkPayout(ev.id, notOwed, vR1.id, 'reversed'); await mkDisputeDebt(ev.id, notOwed, vR1.id, 100, pNo.stripeReversalId)
  await prisma.vendorEarning.update({ where: { orderId_vendorId: { orderId: notOwed, vendorId: vR1.id } }, data: { status: 'paid' } })
  const notReversed = await seedCompleted(ev.id, [vR2.id], old)
  await mkPayout(ev.id, notReversed, vR2.id, 'pending'); await mkDisputeDebt(ev.id, notReversed, vR2.id, 100, null)
  const noDebt = await seedCompleted(ev.id, [vR3.id], old)
  await mkPayout(ev.id, noDebt, vR3.id, 'reversed')
  for (const [name, orderId, vendorId] of [['earning not owed', notOwed, vR1.id], ['transfer not reversed', notReversed, vR2.id], ['no open dispute debt', noDebt, vR3.id]] as const) {
    const r = await cancelChargebackOrphan(prisma, { orderId, vendors: [{ vendorId, subtotalCents: 1000 }] }, { confirm: true })
    const st = (await earningOf(orderId, vendorId))?.status
    assert(!!r.refused && r.cancelled === 0 && (await prisma.adminMoneyAction.count({ where: { orderId } })) === 0 && st !== 'cancelled',
      `refuses (${name}) and writes nothing`)
  }

  assert(refundAttempts.length === 0, 'no customer refund was attempted anywhere in this suite')

  console.log('\n[6] static wiring')
  const pp = stripComments(readFileSync('lib/process-payout.ts', 'utf8'))
  assert(/transferExists:\s*existingTransfer/.test(pp) || /transferExists:/.test(pp.slice(pp.indexOf('classifyVendorSlice({', pp.indexOf('const plan')))),
    'the executor passes transferExists into classifyVendorSlice')
  const planAt = pp.indexOf('const plan'), xferAt = pp.indexOf('stripe.transfers.create')
  assert(planAt !== -1 && xferAt > planAt, 'the classification (incl. transfer_exists) is decided before transfers.create')
  const rsrc = stripComments(readFileSync('lib/reconciler.ts', 'utf8'))
  const body = (name: string) => { const i = rsrc.indexOf(`async function ${name}(`); return rsrc.slice(i, rsrc.indexOf('\nasync function', i + 10) === -1 ? undefined : rsrc.indexOf('\nasync function', i + 10)) }
  assert(body('patternC').includes('selectPatternCCandidates('), 'Pattern C uses the shared selectPatternCCandidates')
  assert(body('patternS').includes('selectPatternSCandidates('), 'Pattern S uses the shared selectPatternSCandidates')
  assert(body('patternD').includes('selectPatternDCandidates('), 'Pattern D uses the shared selectPatternDCandidates')
  assert(/await patternY\(/.test(rsrc), 'the sweep runs Pattern Y')
}

main()
  .catch(e => { console.error(e); fail++ })
  .finally(async () => {
    await cleanup().catch(e => console.error('cleanup failed', e))
    console.log(`\n${'─'.repeat(60)}\n${fail === 0 ? '✅' : '❌'} payout-safety: ${pass} passed, ${fail} failed`)
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
