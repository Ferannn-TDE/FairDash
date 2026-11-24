/**
 * ITEM 10 STAGE 5 — REFUNDS (BATCH-1 §19; plan approved 2026-11-21, rule corrected 2026-11-21). Test DB, Stripe stubbed.
 *
 *   S5-1 who qualifies: feeModel 2 full cancel (CANCELLED + every portion DECLINED/REFUNDED + no acceptedAt) → service
 *        fee + curbside fee + tip; an accepted portion / a paid CANCELLED lane → no service fee; UNDELIVERABLE → curbside
 *        + tip; UNCOLLECTED → nothing; legacy byte-identical to the golden recorded before stage 5 code; the same
 *        all-declined order with feeModel null gets no service fee (positive control on the fee-model line)
 *   S5-2 execution: one refund, one key, both markers; re-run sends nothing; room short → halt; a pre-stage-5 owed-back
 *        is topped up with just the service fee under its own key
 *   S5-3 inline triggers through the real routes: customer cancel, vendor decline (and the timeout's sequence) each end
 *        qualifying (all three conditions) and the refund fires; a planted inline failure leaves the cancel 200 and the
 *        sweep then refunds; an accepted portion later operator-cancelled does NOT qualify
 *   S5-4 sweep: dry run lists orders + amounts; executes each once; legacy candidates unchanged (golden inScan)
 *   S5-5 UNDELIVERABLE: curbside fee + tip only, food + service fee kept, no PartnerEarning
 *   S5-6 interactions: tax never in owed-back (it comes back with the food); partly accepted keeps the service fee
 *   S5-7 copy: five approved strings word for word, read by their surfaces; promise text only in lib/refund-copy.ts
 *        (planted promise elsewhere caught); "10 minutes" = VENDOR_ACCEPT_TIMEOUT_MS
 *        (two exact exemptions in the client's Vendor Agreement §7: a known false-today promise pending the client, and a
 *        refusal the scanner misreads; apostrophes inside words no longer hide a promise)
 *   S5-8 receipt: "Service fee refunded" line from the marker; nothing shown as kept
 *   GUARD every accept path stamps VendorOrderStatus.acceptedAt; declining / operator-cancelling never clears it
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/refunds-stage5-test.ts
 */
import './fee-baseline' // test env (test Upstash, stub Stripe key, no queue) + route loader (Clerk / next/cache mocks)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { NextRequest } from 'next/server'
import { testPrisma } from '../lib/test-db'
import { compareOwedBackGolden, loadOwedBackGolden, runOwedBackCases } from './owed-back-golden-test'

const prisma = testPrisma()
const PFX = 's5-', MAIL = '@s5.local', rand = () => Math.random().toString(36).slice(2, 8)
let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }
const login = (clerkId: string | null, roles: string[] = []) => { (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles } } : undefined }
const jsonReq = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

// ── Stripe stub: charges know their amount and refunds; refunds.create appends to the charge ──
const charges = new Map<string, { amount: number; refunds: any[] }>()
const created: any[] = []
async function stubStripe() {
  const { stripe } = await import('../lib/stripe')
  const s = stripe as any
  s.charges.retrieve = async (id: string) => ({ id, amount: charges.get(id)?.amount ?? 0, disputed: false, balance_transaction: { id: `txn_${id}`, fee: 200 } })
  s.refunds.list = async ({ charge }: { charge: string }) => ({ data: charges.get(charge)?.refunds ?? [], has_more: false })
  s.refunds.create = async (p: any, o: any) => {
    const id = `re_s5_${created.length + 1}`
    created.push({ p, o, id })
    charges.get(p.charge)?.refunds.push({ id, amount: p.amount, status: 'succeeded', created: 1_800_000_000 + created.length, metadata: p.metadata ?? {} })
    return { id }
  }
  s.paymentIntents.retrieve = async () => ({ latest_charge: null })
  s.transfers.createReversal = async () => ({ id: 'trr_s5' })
}

async function cleanup() {
  const evs = (await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })).map(e => e.id)
  const oids = (await prisma.order.findMany({ where: { eventId: { in: evs } }, select: { id: true } })).map(o => o.id)
  for (const m of ['refund', 'refundRequest', 'owedBackHalt', 'adminMoneyAction', 'orderEvent', 'cancellation', 'vendorOrderStatus', 'orderItem', 'orderVendorTax', 'partnerEarning', 'vendorEarning'] as const) {
    await (prisma as any)[m].deleteMany({ where: { orderId: { in: oids } } }).catch(() => {})
  }
  await prisma.order.deleteMany({ where: { id: { in: oids } } })
  const vids = (await prisma.vendor.findMany({ where: { eventId: { in: evs } }, select: { id: true } })).map(v => v.id)
  await prisma.vendorAuditLog.deleteMany({ where: { vendorId: { in: vids } } }).catch(() => {})
  await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
  await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
  await prisma.vendor.deleteMany({ where: { id: { in: vids } } })
  await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: evs } } })
  await prisma.event.deleteMany({ where: { id: { in: evs } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

type Lane = { status: string; accepted?: boolean }
/** A paid curbside order: $50 food per lane, $7.50 fee, $3.99 curbside, $2 tip (+ tax if given). */
async function mkOrder(o: { feeModel: 2 | null; status: string; lanes: Lane[]; taxCents?: number; tipRefundId?: string; priorOwedBack?: number; extraRefund?: number }) {
  const ev = await prisma.event.create({ data: { name: `${PFX}ev`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', startDate: new Date(Date.now() - 864e5), endDate: new Date(Date.now() + 3 * 864e5),
    fulfillmentConfig: { create: { boothPickupEnabled: true, curbsideEnabled: true, homeDeliveryEnabled: false } } } })
  const cust = await prisma.user.create({ data: { clerkId: `${PFX}c-${rand()}`, email: `c-${rand()}${MAIL}`, name: 'C' } })
  const vendors = [] as { id: string }[]
  for (let i = 0; i < o.lanes.length; i++) vendors.push(await prisma.vendor.create({ data: { eventId: ev.id, name: `${PFX}v${i}`, slug: `${PFX}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } }))
  const food = 5000 * o.lanes.length, tax = o.taxCents ?? 0
  const total = food + 750 + 399 + 200 + tax
  const chargeId = `ch_${PFX}${rand()}`
  const order = await prisma.order.create({ data: {
    eventId: ev.id, customerId: cust.id, vendorId: vendors[0].id, status: o.status as any, fulfillmentType: 'CURBSIDE',
    subtotal: food / 100, fairSynqFee: 7.5, deliveryFee: 3.99, tip: 2, total: total / 100, taxCents: tax, vendorPayout: 0,
    customerName: 'C', customerPhone: '6185550100', vehicleMake: 'Honda', vehicleColor: 'Blue', stripeChargeId: chargeId, stripePaymentIntentId: `pi_${PFX}${rand()}`,
    feeModel: o.feeModel, ...(o.feeModel ? { serviceFeeBps: 1500, serviceFeeFlatCents: 0, cardFeesPaidBy: 'VENDOR' } : {}),
    cancelledAt: o.status === 'CANCELLED' ? new Date() : null,
    ...(o.tipRefundId ? { tipRefundId: o.tipRefundId, tipRefundedAt: new Date(), deliveryFeeRefundCents: 399 } : {}),
  } as any })
  for (const [i, l] of o.lanes.entries()) {
    const mi = await prisma.menuItem.create({ data: { vendorId: vendors[i].id, name: 'Item', price: 50, category: 'T' } })
    await prisma.orderItem.create({ data: { orderId: order.id, vendorId: vendors[i].id, menuItemId: mi.id, itemName: 'Item', quantity: 1, unitPrice: 50, totalPrice: 50, subtotal: 50 } as any })
    await prisma.vendorOrderStatus.create({ data: { orderId: order.id, vendorId: vendors[i].id, status: l.status, acceptedAt: l.accepted ? new Date() : null } })
  }
  const refunds: any[] = []
  if (o.priorOwedBack) refunds.push({ id: o.tipRefundId ?? `re_prior_${rand()}`, amount: o.priorOwedBack, status: 'succeeded', created: 1_700_000_000, metadata: { orderId: order.id, kind: 'owed_back' } })
  if (o.extraRefund) refunds.push({ id: `re_x_${rand()}`, amount: o.extraRefund, status: 'succeeded', created: 1_700_000_001, metadata: { orderId: order.id, kind: 'mystery' } })
  charges.set(chargeId, { amount: total, refunds })
  return { orderId: order.id, eventId: ev.id, slug: ev.urlSlug, chargeId, vendorIds: vendors.map(v => v.id), customerClerk: cust.clerkId, total }
}
const owedBackCreates = (orderId: string) => created.filter(c => c.p.metadata?.orderId === orderId && c.p.metadata?.kind === 'owed_back')

async function main() {
  await cleanup()
  // ── S5-1 + S5-4 legacy: byte-identical to the golden recorded before stage 5 code (runs its own fixtures) ──
  console.log('[S5-1] Who qualifies')
  const golden = loadOwedBackGolden()
  const gDiffs = compareOwedBackGolden(await runOwedBackCases(), golden)
  for (const d of gDiffs) console.log(`     ↳ ${d}`)
  assert(Object.keys(golden).length === 9 && gDiffs.length === 0, 'legacy (feeModel null): all 9 owed-back cases identical to the golden recorded before stage 5 (plan, dry run, scan membership, live refund)')
  await stubStripe() // the golden harness installed its own stub; install ours after it
  const tr = await import('../lib/tip-refund')
  const full = await mkOrder({ feeModel: 2, status: 'CANCELLED', lanes: [{ status: 'DECLINED' }, { status: 'REFUNDED' }] })
  const pFull = await tr.planTipRefund(full.orderId)
  assert(pFull.outcome === 'refund' && pFull.serviceFeeCents === 750 && pFull.owedBackCents === 1349, 'feeModel 2 full cancel before acceptance → service fee 750 + curbside 399 + tip 200 = 1349 owed')
  const legacyTwin = await mkOrder({ feeModel: null, status: 'CANCELLED', lanes: [{ status: 'DECLINED' }, { status: 'REFUNDED' }] })
  const pTwin = await tr.planTipRefund(legacyTwin.orderId)
  assert(pTwin.serviceFeeCents === 0 && pTwin.owedBackCents === 599, '[0] control: the SAME order with feeModel null owes no service fee (599) — the fee model is the line')
  const accepted = await mkOrder({ feeModel: 2, status: 'CANCELLED', lanes: [{ status: 'DECLINED', accepted: true }, { status: 'REFUNDED' }] })
  assert((await tr.planTipRefund(accepted.orderId)).serviceFeeCents === 0, 'a portion ever stamped accepted (later declined) → no service fee')
  const paidLane = await mkOrder({ feeModel: 2, status: 'CANCELLED', lanes: [{ status: 'CANCELLED' }] })
  const pPaid = await tr.planTipRefund(paidLane.orderId)
  assert(pPaid.serviceFeeCents === 0 && pPaid.owedBackCents === 599, 'a CANCELLED (paid, work done) lane → no service fee; curbside + tip still owed back (599)')
  const und = await mkOrder({ feeModel: 2, status: 'UNDELIVERABLE', lanes: [{ status: 'CANCELLED', accepted: true }] })
  const pUnd = await tr.planTipRefund(und.orderId)
  assert(pUnd.outcome === 'refund' && pUnd.serviceFeeCents === 0 && pUnd.owedBackCents === 599, 'UNDELIVERABLE → curbside 399 + tip 200 only')
  const unc = await mkOrder({ feeModel: 2, status: 'UNCOLLECTED', lanes: [{ status: 'CANCELLED', accepted: true }] })
  assert((await tr.planTipRefund(unc.orderId)).outcome === 'not_terminal', 'UNCOLLECTED → nothing owed back (not terminal for owed-back)')
  const legacyUnd = await mkOrder({ feeModel: null, status: 'UNDELIVERABLE', lanes: [{ status: 'CANCELLED', accepted: true }] })
  assert((await tr.planTipRefund(legacyUnd.orderId)).outcome === 'not_terminal', 'legacy UNDELIVERABLE keeps today\'s rule (not owed back)')

  // ── S5-2 execution ───────────────────────────────────────────────────────────────────
  console.log('\n[S5-2] Execution')
  let at = created.length
  const r1 = await tr.processTipRefund(full.orderId)
  const m1 = await prisma.order.findUnique({ where: { id: full.orderId }, select: { tipRefundId: true, deliveryFeeRefundCents: true, serviceFeeRefundCents: true, serviceFeeRefundId: true } })
  assert(r1.outcome === 'refunded' && created.length === at + 1 && created[at].p.amount === 1349 && created[at].o.idempotencyKey === `owed_back_${full.orderId}`,
    'ONE Stripe refund of 1349 under the one key owed_back_<order>')
  assert(created[at].p.metadata.serviceFeeCents === '750' && m1?.tipRefundId === created[at].id && m1?.deliveryFeeRefundCents === 399 && m1?.serviceFeeRefundCents === 750 && m1?.serviceFeeRefundId === created[at].id,
    'metadata carries serviceFeeCents 750; markers: tipRefundId + deliveryFeeRefundCents 399 + serviceFeeRefundCents 750 + serviceFeeRefundId (same refund)')
  at = created.length
  const r1b = await tr.processTipRefund(full.orderId)
  assert(r1b.outcome === 'already_refunded' && created.length === at, 're-run: already_refunded, no second refund')
  const short = await mkOrder({ feeModel: 2, status: 'CANCELLED', lanes: [{ status: 'DECLINED' }], extraRefund: 50_000 })
  at = created.length
  const rShort = await tr.processTipRefund(short.orderId, { dryRun: true })
  assert(rShort.outcome === 'halted' && rShort.haltReason === 'REFUND_ROOM_SHORT' && created.length === at, 'unaccounted refunds on the charge → halt (REFUND_ROOM_SHORT), no refund')
  const topUp = await mkOrder({ feeModel: 2, status: 'CANCELLED', lanes: [{ status: 'DECLINED' }], tipRefundId: `re_pre5_${rand()}`, priorOwedBack: 599 })
  const pTop = await tr.planTipRefund(topUp.orderId)
  assert(pTop.outcome === 'refund' && pTop.owedBackCents === 1349 && !pTop.alreadyRefunded, 'pre-stage-5 owed-back (tip + fee already back): still owes the service fee (not "already refunded")')
  at = created.length
  const rTop = await tr.processTipRefund(topUp.orderId)
  const mTop = await prisma.order.findUnique({ where: { id: topUp.orderId }, select: { tipRefundId: true, serviceFeeRefundCents: true, serviceFeeRefundId: true } })
  assert(rTop.outcome === 'refunded' && created[at]?.p.amount === 750 && created[at]?.o.idempotencyKey === `owed_back_${topUp.orderId}_svc`,
    'top-up: exactly the service fee (750) under its own key owed_back_<order>_svc (the earlier 599 subtracted by label)')
  assert(!!mTop?.tipRefundId?.startsWith('re_pre5_') && mTop?.serviceFeeRefundCents === 750 && mTop?.serviceFeeRefundId === created[at]?.id, 'the earlier tip marker is kept; the service-fee marker points at the top-up')
  at = created.length
  assert((await tr.processTipRefund(topUp.orderId)).outcome === 'already_refunded' && created.length === at, 'top-up re-run sends nothing')

  // ── S5-3 inline triggers through the real routes ──────────────────────────────────────
  console.log('\n[S5-3] Inline triggers')
  const cancelPOST = (await import('../app/api/orders/[id]/cancel/route')).PATCH ?? (await import('../app/api/orders/[id]/cancel/route') as any).POST
  const vsPATCH = (await import('../app/api/orders/[id]/vendor-status/route')).PATCH
  // The vendor-status route's Firebase pushes run through runAfterResponse; the test hook collects them, so the real
  // response is checked (200) as well as the database.
  ;(globalThis as any).__AFTER_RESPONSE_FOR_TEST = (_t: () => Promise<void>) => {}
  const routeOk = async (res: Response) => res.status === 200
  const qualifies = async (id: string) => {
    const o = await prisma.order.findUnique({ where: { id }, select: { status: true, vendorOrderStatuses: { select: { status: true, acceptedAt: true } } } })
    return { cancelled: o?.status === 'CANCELLED', allEnded: !!o && o.vendorOrderStatuses.every(v => v.status === 'DECLINED' || v.status === 'REFUNDED'), noneAccepted: !!o && o.vendorOrderStatuses.every(v => v.acceptedAt === null) }
  }
  // Customer cancel before acceptance (two vendors, both still PLACED).
  const cc = await mkOrder({ feeModel: 2, status: 'PLACED', lanes: [{ status: 'PLACED' }, { status: 'PLACED' }] })
  login(cc.customerClerk)
  at = created.length
  const ccRes = await cancelPOST(jsonReq(`/api/orders/${cc.orderId}/cancel`, 'PATCH', { reason: 'test' }) as any, { params: Promise.resolve({ id: cc.orderId }) })
  const qcc = await qualifies(cc.orderId)
  const ccOwed = owedBackCreates(cc.orderId)
  assert(ccRes.status === 200 && qcc.cancelled && qcc.allEnded && qcc.noneAccepted, 'customer cancel before acceptance ends qualifying: CANCELLED, every portion REFUNDED/DECLINED, none accepted')
  assert(ccOwed.length === 1 && ccOwed[0].p.amount === 1349, 'and the owed-back refund fires inline: service fee + curbside fee + tip = 1349 (food refunded separately per vendor)')
  // Vendor decline (one vendor, PLACED) through the real vendor-status route.
  const vd = await mkOrder({ feeModel: 2, status: 'PLACED', lanes: [{ status: 'PLACED' }] })
  const vu = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'V' } })
  await prisma.vendorMember.create({ data: { vendorId: vd.vendorIds[0], userId: vu.id, role: 'owner', approvalStatus: 'APPROVED' } as any })
  login(vu.clerkId)
  const vdRes = await vsPATCH(jsonReq(`/api/orders/${vd.orderId}/vendor-status`, 'PATCH', { vendorId: vd.vendorIds[0], status: 'DECLINED' }) as any, { params: Promise.resolve({ id: vd.orderId }) })
  const qvd = await qualifies(vd.orderId)
  assert(await routeOk(vdRes) && qvd.cancelled && qvd.allEnded && qvd.noneAccepted, 'vendor decline (the only vendor) ends qualifying: CANCELLED, DECLINED, never accepted')
  assert(owedBackCreates(vd.orderId).length === 1 && owedBackCreates(vd.orderId)[0].p.amount === 1349, 'and the owed-back refund fires inline (1349)')
  // Accept timeout: the job's exact sequence (refund each PLACED portion, timeout-cancel via the aggregator, inline owed-back).
  const to = await mkOrder({ feeModel: 2, status: 'PLACED', lanes: [{ status: 'PLACED' }] })
  const { refundVendorPortion } = await import('../lib/process-refund')
  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  await refundVendorPortion({ orderId: to.orderId, vendorId: to.vendorIds[0], reason: 'vendor_did_not_accept', actor: 'system:accept-timeout' })
  await reconcileMasterStatus(to.orderId, { timeout: { status: 'CANCELLED', by: 'system', reason: 'Vendor did not accept within 10 minutes' } })
  await tr.owedBackAfterTerminal(to.orderId, 'accept_timeout')
  const qto = await qualifies(to.orderId)
  assert(qto.cancelled && qto.allEnded && qto.noneAccepted && owedBackCreates(to.orderId).length === 1 && owedBackCreates(to.orderId)[0].p.amount === 1349,
    'accept timeout ends qualifying and the refund fires (1349)')
  const worker = readFileSync('workers/order-worker.ts', 'utf8')
  assert(/timeout: \{ status: 'CANCELLED', by: 'system', reason: VENDOR_DID_NOT_ACCEPT_REASON \},\s*\}\)\s*\/\/[^\n]*\n\s*await owedBackAfterTerminal\(orderId, 'accept_timeout'\)/.test(worker)
    && /timeout: \{ status: 'UNDELIVERABLE' \} \}\)\s*\/\/[^\n]*\n\s*await owedBackAfterTerminal\(orderId, 'undeliverable'\)/.test(worker),
    'the worker calls owed-back right after the timeout cancel and right after marking UNDELIVERABLE')
  // Planted inline failure: the cancel still succeeds; the sweep refunds.
  const pf = await mkOrder({ feeModel: 2, status: 'PLACED', lanes: [{ status: 'PLACED' }] })
  login(pf.customerClerk)
  ;(globalThis as any).__OWED_BACK_INLINE_FAIL = true
  const pfRes = await cancelPOST(jsonReq(`/api/orders/${pf.orderId}/cancel`, 'PATCH', { reason: 'test' }) as any, { params: Promise.resolve({ id: pf.orderId }) })
  ;(globalThis as any).__OWED_BACK_INLINE_FAIL = false
  assert(pfRes.status === 200 && owedBackCreates(pf.orderId).length === 0, 'planted inline failure: the cancel still returns 200 and no owed-back refund went out')
  const sweepDry = await tr.reconcileTipRefunds({ dryRun: true, maxPerRun: 1000 })
  const pfDry = sweepDry.results?.find(r => r.orderId === pf.orderId)
  assert(pfDry?.outcome === 'refunded' && pfDry.amountCents === 1349 && pfDry.dryRun === true, 'the sweep\'s dry run lists it with its amount (1349)')
  await tr.reconcileTipRefunds({ maxPerRun: 1000 })
  assert(owedBackCreates(pf.orderId).length === 1 && owedBackCreates(pf.orderId)[0].p.amount === 1349, 'the live sweep then refunds it once')
  await tr.reconcileTipRefunds({ maxPerRun: 1000 })
  assert(owedBackCreates(pf.orderId).length === 1, 'a second sweep sends nothing')
  // An accepted portion later operator-cancelled does NOT qualify.
  const oc = await mkOrder({ feeModel: 2, status: 'PLACED', lanes: [{ status: 'PLACED' }] })
  const ou = await prisma.user.create({ data: { clerkId: `${PFX}ou-${rand()}`, email: `ou-${rand()}${MAIL}`, name: 'V' } })
  await prisma.vendorMember.create({ data: { vendorId: oc.vendorIds[0], userId: ou.id, role: 'owner', approvalStatus: 'APPROVED' } as any })
  login(ou.clerkId)
  const accRes = await vsPATCH(jsonReq(`/api/orders/${oc.orderId}/vendor-status`, 'PATCH', { vendorId: oc.vendorIds[0], status: 'ACCEPTED' }) as any, { params: Promise.resolve({ id: oc.orderId }) })
  const afterAccept = await prisma.vendorOrderStatus.findFirst({ where: { orderId: oc.orderId } })
  assert(await routeOk(accRes) && afterAccept?.status === 'ACCEPTED' && afterAccept.acceptedAt instanceof Date, `GUARD: the vendor-status route stamps acceptedAt when a vendor accepts (status ${accRes.status}, lane ${afterAccept?.status}, acceptedAt ${afterAccept?.acceptedAt?.toISOString() ?? 'null'})`)
  // An operator / bulk cancel is the asserted CANCELLED override (the path the admin tools and the timeout job use).
  await reconcileMasterStatus(oc.orderId, { timeout: { status: 'CANCELLED', by: 'admin', reason: 'operator cancel test' } })
  const afterCancel = await prisma.vendorOrderStatus.findFirst({ where: { orderId: oc.orderId } })
  const ocOrder = await prisma.order.findUnique({ where: { id: oc.orderId }, select: { status: true } })
  const pOc = await tr.planTipRefund(oc.orderId)
  assert(ocOrder?.status === 'CANCELLED' && afterCancel?.status === 'DECLINED' && afterCancel.acceptedAt?.getTime() === afterAccept?.acceptedAt?.getTime(),
    `GUARD: an operator cancel moves the accepted portion to DECLINED and keeps its acceptedAt (order ${ocOrder?.status}, lane ${afterCancel?.status}, acceptedAt ${afterCancel?.acceptedAt?.toISOString() ?? 'null'})`)
  assert(pOc.serviceFeeCents === 0, 'an accepted portion later operator-cancelled does NOT qualify (no service fee)')

  // ── S5-5 UNDELIVERABLE execute ────────────────────────────────────────────────────────
  console.log('\n[S5-5] UNDELIVERABLE')
  // A fresh order: the S5-3 sweeps already (correctly) refunded the earlier UNDELIVERABLE fixture.
  const und2 = await mkOrder({ feeModel: 2, status: 'UNDELIVERABLE', lanes: [{ status: 'CANCELLED', accepted: true }] })
  at = created.length
  const rUnd = await tr.processTipRefund(und2.orderId)
  const mUnd = await prisma.order.findUnique({ where: { id: und2.orderId }, select: { tipRefundId: true, serviceFeeRefundCents: true } })
  assert(rUnd.outcome === 'refunded' && created[at]?.p.amount === 599 && created[at]?.p.metadata.serviceFeeCents === undefined, `refunds curbside fee + tip (599); no service fee (got ${JSON.stringify(rUnd)})`)
  assert(mUnd?.tipRefundId === created[at]?.id && mUnd?.serviceFeeRefundCents === null && (await prisma.partnerEarning.count({ where: { orderId: und2.orderId } })) === 0, 'tip marker set, no service-fee marker, no PartnerEarning')

  // ── S5-6 interactions ─────────────────────────────────────────────────────────────────
  console.log('\n[S5-6] Interactions')
  const taxed = await mkOrder({ feeModel: 2, status: 'CANCELLED', lanes: [{ status: 'DECLINED' }], taxCents: 450 })
  const pTax = await tr.planTipRefund(taxed.orderId)
  at = created.length
  const rTax = await tr.processTipRefund(taxed.orderId)
  assert(pTax.owedBackCents === 1349 && rTax.outcome === 'refunded' && created[at]?.p.amount === 1349, 'a taxed order: owed-back is fee + curbside + tip only (1349); tax comes back with the food through the refund engine')
  const partly = await mkOrder({ feeModel: 2, status: 'CANCELLED', lanes: [{ status: 'REFUNDED' }, { status: 'CANCELLED', accepted: true }] })
  assert((await tr.planTipRefund(partly.orderId)).serviceFeeCents === 0, 'partly accepted (one vendor did the work) keeps the service fee')

  // ── S5-7 copy ─────────────────────────────────────────────────────────────────────────
  console.log('\n[S5-7] Copy')
  const copy = await import('../lib/refund-copy')
  assert(copy.CANCEL_ANSWER === "Before any vendor accepts, you can cancel and get everything back: food, service fee, curbside fee and tip. Once a vendor accepts, that part of your order can't be cancelled; if something goes wrong, request a refund and our team will review it. If you cancel the rest of a partly accepted order, you get that food back and the service fee stays.", 'row 1 word for word')
  assert(copy.VENDOR_TIMEOUT_ANSWER === 'If no vendor accepts within 10 minutes, your order is cancelled automatically and you get everything back.', 'row 2 word for word')
  assert(copy.CUSTOMER_CANCEL_DIALOG === 'Your order will be cancelled. If no vendor has accepted yet, you get everything back, including the service fee. Refunds usually appear within 5–10 business days.', 'row 3 word for word')
  assert(copy.VENDOR_DECLINE_DIALOG === 'The customer will be notified and refunded automatically. If no other vendor on the order accepts, the customer also gets the service fee back. It never comes out of your earnings.', 'row 4 word for word')
  assert(/everything back: the food, the service fee, and any curbside fee and tip/.test(copy.CANCELLED_ORDERS_POLICY) && /never handed to you, the curbside fee and tip come back/.test(copy.CANCELLED_ORDERS_POLICY) && /service fee is kept/.test(copy.CANCELLED_ORDERS_POLICY),
    'row 5 states the C-2 rules (everything back before acceptance; curbside + tip if never handed over; fee kept once accepted)')
  const uses: [string, RegExp][] = [
    ['app/_components/faq-content.ts', /a: CANCEL_ANSWER \}/], ['app/_components/faq-content.ts', /a: VENDOR_TIMEOUT_ANSWER \}/],
    ['components/order/OrderComponents.tsx', /\{CUSTOMER_CANCEL_DIALOG\}/], ['app/vendor/[fairSlug]/dashboard/page.tsx', /\{VENDOR_DECLINE_DIALOG\}/],
    ['app/refund-policy/page.tsx', /body: CANCELLED_ORDERS_POLICY,/],
  ]
  assert(uses.every(([f, re]) => re.test(readFileSync(f, 'utf8'))), 'each surface reads its approved constant')
  const { VENDOR_ACCEPT_TIMEOUT_MS } = await import('../lib/constants')
  const mins = Number(/within (\d+) minutes/.exec(copy.VENDOR_TIMEOUT_ANSWER)?.[1])
  assert(mins === VENDOR_ACCEPT_TIMEOUT_MS / 60_000 && Number(/within (\d+) minutes/.exec(copy.VENDOR_TIMEOUT_ANSWER.replace('10', '15'))?.[1]) !== VENDOR_ACCEPT_TIMEOUT_MS / 60_000,
    `row 2's "${mins} minutes" equals VENDOR_ACCEPT_TIMEOUT_MS (a planted mismatch would be caught)`)
  // Tightened 2026-11-24: an apostrophe BETWEEN two letters (straight or curly: "FairSynq's", "we'll", "FairSynq’s")
  // no longer ends the scan, so a possessive can't hide a promise. A quote that ends a code string still does.
  const GAP = String.raw`(?:[^.'"\`’]|(?<=\w)['’](?=\w))`
  const PROMISE = new RegExp(String.raw`(everything back|get back|refund(s|ed)?)\b${GAP}{0,60}\bservice fee\b(?!${GAP}{0,20}\b(isn|is not|NOT|not|is kept|stays)\b)|\bservice fee back\b`, 'i')
  const OLD_PROMISE = /(everything back|get back|refund(s|ed)?)\b[^.'"`]{0,60}\bservice fee\b(?![^.'"`]{0,20}\b(isn|is not|NOT|not|is kept|stays)\b)|\bservice fee back\b/i
  const walk = (d: string, out: string[] = []): string[] => { for (const n of readdirSync(d)) { const q = join(d, n); statSync(q).isDirectory() ? (n !== 'node_modules' && walk(q, out)) : /\.(tsx?)$/.test(n) && out.push(q) } return out }
  const strip = (s: string) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  // The client's Vendor Agreement v2026-11-23 §7 (final client text, SHA-locked by legal-pages-test). Exactly two
  // sentences are exempted, in that one file only (BATCH-1, 2026-11-24):
  //   (1) a KNOWN FALSE-TODAY promise, pending the client (legal fix list §7): the service fee is refunded only when no
  //       vendor accepted the order, not whenever a vendor fails a whole order;
  //   (2) a refusal the scanner misreads as a promise ("FairSynq keeps its service fee").
  // If §7 is rewritten, a sentence stops matching, its exemption does nothing, and the checks below fail again.
  const CLIENT_S7_FILE = 'lib/legal/vendor-agreement.ts'
  const CLIENT_S7 = [
    "If a whole order fails because of you, the customer gets a full refund, including FairSynq's service fee.",
    "If only some items are affected, the customer is refunded for those items and their tax, and FairSynq keeps its service fee.",
  ]
  const exempt = (src: string) => CLIENT_S7.reduce((t, sentence) => t.split(sentence).join(''), src)
  const scanned = (f: string) => { const src = strip(readFileSync(f, 'utf8')); return f === CLIENT_S7_FILE ? exempt(src) : src }
  const promisers = ['app', 'components', 'lib'].flatMap(d => walk(join(process.cwd(), d))).map(f => relative(process.cwd(), f).split(sep).join('/')).filter(f => PROMISE.test(scanned(f)))
  const s7 = strip(readFileSync(CLIENT_S7_FILE, 'utf8'))
  for (const [i, sentence] of CLIENT_S7.entries()) {
    assert(s7.split(sentence).length === 2, `§7 exemption (${i + 1}) matches the client's sentence exactly once in ${CLIENT_S7_FILE} (if §7 changed, remove it)`)
    assert(PROMISE.test(sentence), `[0] control: the scanner flags exempted sentence (${i + 1}), so the exemption is needed`)
  }
  assert(!OLD_PROMISE.test(CLIENT_S7[0]) && PROMISE.test("You'll get a full refund, including FairSynq’s service fee.") && PROMISE.test("We refund FairSynq's service fee."),
    '[0] control: the old scanner missed the possessive in sentence (1); the tightened one catches straight and curly apostrophes')
  assert(!PROMISE.test(exempt(s7)) && PROMISE.test(exempt(s7) + " We'll refund FairSynq's service fee too."),
    '[0] control: with only the two sentences removed the agreement has no promise, and a planted promise in the same file is still caught')
  assert(!PROMISE.test("The service fee isn't refunded.") && !PROMISE.test("FairSynq's service fee isn't refunded."), '[0] control: refusals still pass, with or without a possessive')
  assert(PROMISE.test("Cancel now and we'll refund the service fee too.") && !PROMISE.test("The service fee isn't refunded."), '[0] control: the scanner catches a planted promise and passes a refusal')
  assert(promisers.length === 1 && promisers[0] === 'lib/refund-copy.ts', `service-fee promises exist only in lib/refund-copy.ts (found: ${promisers.join(', ')})`)

  // ── S5-8 receipt ──────────────────────────────────────────────────────────────────────
  console.log('\n[S5-8] Receipt')
  const { itemizeOrder } = await import('../lib/order-itemization')
  const rowFull = await prisma.order.findUnique({ where: { id: full.orderId }, include: { orderItems: true, refunds: true } })
  const it = itemizeOrder({ ...rowFull!, refunds: rowFull!.refunds } as any)
  const feeLine = it.refunds.find(r => r.key === 'service_fee')
  assert(!!feeLine && feeLine.cents === 750 && feeLine.status === 'REFUNDED' && /Service fee refunded \$7\.50/.test(it.refundSummary), 'the receipt shows "Service fee refunded $7.50" from the marker')
  assert(it.serviceFeeKept === null, 'and nothing is shown as a kept service fee')

  // ── GUARD (static) ────────────────────────────────────────────────────────────────────
  console.log('\n[GUARD] acceptedAt')
  const vs = readFileSync('app/api/orders/[id]/vendor-status/route.ts', 'utf8')
  assert(/ACCEPTED:\s*'acceptedAt'/.test(vs) && /\.\.\.\(tsField \? \{ \[tsField\]: new Date\(\) \} : \{\}\)/.test(vs), 'the vendor-status route maps ACCEPTED → acceptedAt and writes it on the transition')
  const acceptWriters = ['app', 'lib', 'workers'].flatMap(d => walk(join(process.cwd(), d))).map(f => relative(process.cwd(), f).split(sep).join('/'))
    .filter(f => !f.startsWith('lib/mock/') && f !== 'app/api/orders/[id]/vendor-status/route.ts')
    .filter(f => /vendorOrderStatus\.(update|updateMany|upsert|create|createMany)\([\s\S]{0,300}status:\s*['"]ACCEPTED['"]/.test(strip(readFileSync(f, 'utf8'))))
  assert(acceptWriters.length === 0, `no other code moves a portion to ACCEPTED (found: ${acceptWriters.join(', ') || 'none'})`)
  const clearers = ['app', 'lib', 'workers'].flatMap(d => walk(join(process.cwd(), d))).map(f => relative(process.cwd(), f).split(sep).join('/'))
    .filter(f => /data:\s*\{[^}]{0,200}acceptedAt:\s*null/.test(strip(readFileSync(f, 'utf8'))))
  assert(clearers.length === 0, `no code clears acceptedAt in a write (found: ${clearers.join(', ') || 'none'})`)
}

main()
  .catch(e => { console.error(e); fail++ })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    console.log(`\n${'─'.repeat(64)}`)
    console.log(fail === 0 ? `  ${pass} passed, 0 failed` : `  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(64)}\n`)
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
