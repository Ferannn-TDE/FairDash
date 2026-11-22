/**
 * PAYOUT GAP FIX — UNDELIVERABLE / UNCOLLECTED orders pay their vendors (BATCH-1 §19, Q1–Q4; plan approved 2026-11-22).
 * Test DB, Stripe stubbed, a fake order queue records the delayed payout job.
 *
 *   PG-1 the ONE payable rule: all conditions → payable; each missing alone → not; July phantom shape blocked; operator
 *        cancel unchanged; accrual / reverser / Pattern T / executor all use it; Pattern T's selection (selectPatternTPhantoms,
 *        called in isolation) agrees with the rule both ways
 *   PG-2 trigger: UNDELIVERABLE stamps undeliverableAt, UNCOLLECTED uncollectedAt; earnings for worked portions; payout
 *        queued with delay = REFUND_WINDOW_MS; no runner/organizer earnings; protected event → nothing (shared check)
 *   PG-3 payouts on the $50 example: UNDELIVERABLE curbside 4825 / FairSynq 717 / partner share 11, net 0, no
 *        PartnerEarning; UNCOLLECTED curbside partner 388 held / FairSynq 728; UNCOLLECTED booth paid
 *   PG-4 both orders of events (owed-back then payout; payout then owed-back): balance check passes, curbside + tip
 *        refunded once, no PartnerEarning ever
 *   PG-5 catch-up: Patterns C and S find these orders by their own end time once the window has cleared (not before),
 *        skip protected events; X2's explanation accepts the two states
 *   PG-6 legacy: payout golden (6) and owed-back golden (9) unchanged
 *   PG-7 vendor estimate: pending before the payout, settled after
 *   PG-8 forward-only: an UNDELIVERABLE order with no undeliverableAt is never selected (positive control: a newly marked one is)
 *   PG-9 missing-partner check: UNCOLLECTED-without-earning → alert; UNDELIVERABLE → never; earning present → none
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/payout-gap-test.ts
 */
import { readFileSync } from 'node:fs'
import {
  runPayoutScenarios, comparePayoutGolden, loadPayoutGolden,
  buildOrder, stubStripe, setStripeFee, transfers, cleanup,
} from './payout-golden-test'
import { compareOwedBackGolden, loadOwedBackGolden, runOwedBackCases } from './owed-back-golden-test'
import { testPrisma } from '../lib/test-db'

const prisma = testPrisma()
let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const jobs: { name: string; data: any; opts: any }[] = []
const refunds: any[] = []
const FM2 = { feeModel: 2, snapshot: { serviceFeeBps: 1500, serviceFeeFlatCents: 0, cardFeesPaidBy: 'VENDOR' }, serviceCents: 750 }

async function stubRefunds() {
  const { stripe } = await import('../lib/stripe')
  const s = stripe as any
  const byCharge = new Map<string, any[]>()
  s.refunds.list = async ({ charge }: { charge: string }) => ({ data: byCharge.get(charge) ?? [], has_more: false })
  s.refunds.create = async (p: any, o: any) => {
    const id = `re_pg_${refunds.length + 1}`
    refunds.push({ p, o, id })
    byCharge.set(p.charge, [...(byCharge.get(p.charge) ?? []), { id, amount: p.amount, status: 'succeeded', created: 1_800_000_000 + refunds.length, metadata: p.metadata ?? {} }])
    return { id }
  }
  const orig = s.charges.retrieve
  s.charges.retrieve = async (id: string, ...rest: any[]) => {
    const r = await orig(id, ...rest)
    const ord = await prisma.order.findFirst({ where: { stripeChargeId: id }, select: { total: true } })
    return { ...r, amount: Math.round((ord?.total ?? 0) * 100), disputed: false }
  }
}

/** A built order moved to READY with each lane READY + acceptedAt (the vendor accepted and made the food). */
async function readyOrder(name: string, opts: { curbside?: boolean; feeModel2?: boolean; tip?: number } = {}) {
  const ids = await buildOrder(
    { name, fee: 208, vendors: [{ price: 50 }], ...(opts.curbside ? { curbside: { fee: 3.99, tip: opts.tip ?? 0, runnerPct: 50 } } : {}) },
    opts.feeModel2 ? FM2 : {},
  )
  await prisma.order.update({ where: { id: ids.orderId }, data: { status: 'READY', runnerId: null, deliveryProofPath: null } })
  await prisma.vendorOrderStatus.updateMany({ where: { orderId: ids.orderId }, data: { status: 'READY', acceptedAt: new Date(Date.now() - 600_000) } })
  return ids
}

async function main() {
  // ── PG-6 goldens first (each runs its own fixtures and cleanup) ─────────────────────────
  console.log('[PG-6] Legacy goldens')
  const pg = comparePayoutGolden(await runPayoutScenarios(), loadPayoutGolden())
  const og = compareOwedBackGolden(await runOwedBackCases(), loadOwedBackGolden())
  for (const d of [...pg, ...og]) console.log(`     ↳ ${d}`)
  assert(pg.length === 0, 'payout golden: all 6 legacy scenarios identical')
  assert(og.length === 0, 'owed-back golden: all 9 legacy cases identical')

  await cleanup()
  await stubStripe()
  await stubRefunds()
  const queues = await import('../lib/queues')
  queues.__setOrderQueueForTest({ add: async (name: string, data: any, opts: any) => { jobs.push({ name, data, opts }); return { id: opts?.jobId } } } as any)
  const pp = await import('../lib/process-payout')
  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  const { REFUND_WINDOW_MS } = await import('../lib/constants')
  try {
    // ── PG-1 the one payable rule ─────────────────────────────────────────────────────────
    console.log('\n[PG-1] The one payable rule')
    const P = pp.isPortionPayable, at = new Date()
    const worked = { status: 'CANCELLED', acceptedAt: at }
    assert(P(worked, { orderStatus: 'UNDELIVERABLE', vendorRefunded: false }) && P(worked, { orderStatus: 'UNCOLLECTED', vendorRefunded: false }),
      '[0] positive control: a worked CANCELLED portion on an UNDELIVERABLE / UNCOLLECTED order, unrefunded → payable')
    assert(!P(worked, { orderStatus: 'COMPLETED', vendorRefunded: false }) && !P(worked, { orderStatus: 'CANCELLED', vendorRefunded: false }), 'order not UNDELIVERABLE/UNCOLLECTED → not payable')
    assert(!P(worked, { orderStatus: 'UNDELIVERABLE', vendorRefunded: true }), 'that vendor has a completed refund → not payable')
    assert(!P({ status: 'CANCELLED', acceptedAt: null }, { orderStatus: 'UNDELIVERABLE', vendorRefunded: false }), 'acceptedAt null → not payable')
    assert(!P({ status: 'DECLINED', acceptedAt: at }, { orderStatus: 'UNDELIVERABLE', vendorRefunded: false }) && !P({ status: 'REFUNDED', acceptedAt: at }, { orderStatus: 'UNDELIVERABLE', vendorRefunded: false }), 'DECLINED / REFUNDED → never payable')
    assert(!P(worked, { orderStatus: 'CANCELLED', vendorRefunded: true }), 'the July phantom shape (CANCELLED portion on a cancelled, refunded order) stays blocked')
    assert(!P(worked, { orderStatus: 'CANCELLED', vendorRefunded: false }), 'an operator-cancelled worked portion is unchanged (not payable)')
    assert(P({ status: 'COMPLETED', acceptedAt: at }, { orderStatus: 'COMPLETED', vendorRefunded: false }), 'a COMPLETED portion stays payable')
    const src = (f: string) => readFileSync(f, 'utf8')
    assert(/payableVendorIds\(order\.orderItems, order\.vendorOrderStatuses, \{ orderStatus: order\.status, refunds: order\.refunds \}\)/.test(src('lib/process-payout.ts'))
      && /!isPortionPayable\(portion, \{ orderStatus: payCtx\?\.status/.test(src('lib/process-payout.ts'))
      && /isPortionPayable\(portion, \{ orderStatus: earning\.order\.status/.test(src('lib/reverse-accrual.ts'))
      && /payableVendorIds\(ord\.orderItems, ord\.vendorOrderStatuses, \{ orderStatus: ord\.status, refunds: ord\.refunds \}\)/.test(src('lib/reconciler.ts'))
      && /return !!portion && !isPortionPayable\(portion, \{ orderStatus: e\.order\.status/.test(src('lib/reconciler.ts')),
      'accrual gate, executor, reverser, Pattern S and Pattern T all call the one rule')
    // Behaviour: accrual + reverser on real rows.
    const acc = await readyOrder('pg1 accrual')
    await prisma.order.update({ where: { id: acc.orderId }, data: { status: 'UNDELIVERABLE' } })
    await prisma.vendorOrderStatus.updateMany({ where: { orderId: acc.orderId }, data: { status: 'CANCELLED' } })
    await pp.accrueVendorEarnings(acc.orderId)
    assert((await prisma.vendorEarning.count({ where: { orderId: acc.orderId, status: 'accrued' } })) === 1, 'accrual gate records the worked portion')
    const { reverseAccrualForRefundedPortion } = await import('../lib/reverse-accrual')
    const rv = await reverseAccrualForRefundedPortion({ orderId: acc.orderId, vendorId: acc.vendorIds[0], actor: { id: 'test', type: 'reconciler' } as any, reason: 'test', dryRun: true })
    assert(!rv.reversed && (rv as any).skipped === 'portion-still-payable', 'the reverser leaves a payable worked portion alone')
    await prisma.vendorOrderStatus.updateMany({ where: { orderId: acc.orderId }, data: { acceptedAt: null } })
    const rv2 = await reverseAccrualForRefundedPortion({ orderId: acc.orderId, vendorId: acc.vendorIds[0], actor: { id: 'test', type: 'reconciler' } as any, reason: 'test', dryRun: true })
    assert(rv2.reversed === true, 'and reverses it once a condition fails (acceptedAt cleared → not payable)')
    // Pattern T's selection in isolation (no other pattern, no Stripe): agrees with the rule both ways.
    const recT = await import('../lib/reconciler')
    const inT = async (orderId: string) => (await recT.selectPatternTPhantoms({ maxPerPattern: 10_000 })).some(e => e.orderId === orderId)
    assert(await inT(acc.orderId), 'Pattern T selects the accrued portion once it is not payable (acceptedAt cleared)')
    await prisma.vendorOrderStatus.updateMany({ where: { orderId: acc.orderId }, data: { acceptedAt: new Date() } })
    assert(!(await inT(acc.orderId)), 'Pattern T does NOT select a payable worked portion (acceptedAt set, UNDELIVERABLE, unrefunded)')
    const legacyPhantom = await readyOrder('pg1 legacy phantom')
    await prisma.order.update({ where: { id: legacyPhantom.orderId }, data: { status: 'COMPLETED' } })
    await prisma.vendorOrderStatus.updateMany({ where: { orderId: legacyPhantom.orderId }, data: { status: 'REFUNDED' } })
    await prisma.vendorEarning.create({ data: { eventId: legacyPhantom.eventId, orderId: legacyPhantom.orderId, vendorId: legacyPhantom.vendorIds[0], subtotalCents: 5000, status: 'accrued' } })
    assert(await inT(legacyPhantom.orderId), '[0] control: a REFUNDED portion\'s accrual (the July phantom shape) is still selected')

    // ── PG-2 trigger ──────────────────────────────────────────────────────────────────────
    console.log('\n[PG-2] Trigger')
    const t1 = await readyOrder('pg2 undeliverable', { curbside: true, feeModel2: true })
    jobs.length = 0
    await reconcileMasterStatus(t1.orderId, { timeout: { status: 'UNDELIVERABLE' } })
    const r1 = await prisma.order.findUnique({ where: { id: t1.orderId }, select: { status: true, undeliverableAt: true, vendorOrderStatuses: { select: { status: true, acceptedAt: true } } } })
    const payJob = jobs.find(j => j.data?.orderId === t1.orderId && /payout/i.test(j.name))
    assert(r1?.status === 'UNDELIVERABLE' && r1.undeliverableAt instanceof Date, 'UNDELIVERABLE stamps undeliverableAt')
    assert(r1?.vendorOrderStatuses[0].status === 'CANCELLED' && !!r1.vendorOrderStatuses[0].acceptedAt, 'the worked lane closes CANCELLED and keeps acceptedAt')
    assert((await prisma.vendorEarning.count({ where: { orderId: t1.orderId } })) === 1, 'the vendor earning is recorded')
    assert(!!payJob && payJob.opts?.delay === REFUND_WINDOW_MS, `the payout is queued with delay = REFUND_WINDOW_MS (${payJob?.opts?.delay})`)
    assert((await prisma.runnerEarning.count({ where: { orderId: t1.orderId } })) === 0 && (await prisma.organizerEarning.count({ where: { orderId: t1.orderId } })) === 0, 'no runner or organizer earnings')
    const t2 = await readyOrder('pg2 uncollected')
    jobs.length = 0
    await reconcileMasterStatus(t2.orderId, { timeout: { status: 'UNCOLLECTED' } })
    const r2 = await prisma.order.findUnique({ where: { id: t2.orderId }, select: { status: true, uncollectedAt: true } })
    assert(r2?.status === 'UNCOLLECTED' && r2.uncollectedAt instanceof Date && jobs.some(j => j.data?.orderId === t2.orderId && j.opts?.delay === REFUND_WINDOW_MS), 'UNCOLLECTED stamps uncollectedAt and queues the delayed payout')
    const { __protectEventForTest } = await import('../lib/prod-write-guard')
    const t3 = await readyOrder('pg2 protected')
    const undo = __protectEventForTest(t3.eventId)
    jobs.length = 0
    await reconcileMasterStatus(t3.orderId, { timeout: { status: 'UNDELIVERABLE' } })
    undo()
    assert(!jobs.some(j => j.data?.orderId === t3.orderId) && (await prisma.vendorEarning.count({ where: { orderId: t3.orderId } })) === 0, 'a protected event: no payout queued and no earning recorded')
    assert(jobs.length === 0 && !!payJob, '[0] control: the same order at a normal event did queue (above)')
    assert(/isExcludedFromPayoutGapFix\(order\.eventId\)/.test(src('lib/reconcile-order-status.ts')) && (src('lib/reconciler.ts').match(/\.\.\.payoutGapEventScope\(\)/g) ?? []).length === 4,
      'the trigger and both catch-up patterns use the ONE shared exclusion (lib/payout-exclusions.ts)')

    // ── PG-3 payouts on the $50 example ───────────────────────────────────────────────────
    console.log('\n[PG-3] Payouts')
    setStripeFee(208)
    let from = transfers.length
    await pp.processOrderPayout(t1.orderId)
    const s1 = await prisma.orderFeeSplit.findUnique({ where: { orderId: t1.orderId }, include: { vendors: true } })
    assert(transfers.slice(from).map(t => t.params.amount).join() === '4825', 'UNDELIVERABLE curbside: the vendor is paid 4825')
    assert(s1?.fairsynqNetCents === 717 && s1.partnerShareCents === 11 && s1.partnerNetCents === 0, 'FairSynq nets 717 (absorbs the partner\'s 11); partner share 11 recorded, net 0')
    assert((await prisma.partnerEarning.count({ where: { orderId: t1.orderId } })) === 0, 'no PartnerEarning on an UNDELIVERABLE order')
    const u = await readyOrder('pg3 uncollected curbside', { curbside: true, feeModel2: true })
    await reconcileMasterStatus(u.orderId, { timeout: { status: 'UNCOLLECTED' } })
    from = transfers.length
    await pp.processOrderPayout(u.orderId)
    const su = await prisma.orderFeeSplit.findUnique({ where: { orderId: u.orderId } })
    const pu = await prisma.partnerEarning.findUnique({ where: { orderId: u.orderId } })
    assert(transfers.slice(from).map(t => t.params.amount).join() === '4825' && su?.fairsynqNetCents === 728 && pu?.amountCents === 388 && pu.status === 'held', 'UNCOLLECTED curbside: vendor 4825, FairSynq 728, partner 388 held')
    const ub = await readyOrder('pg3 uncollected booth', { feeModel2: true })
    await reconcileMasterStatus(ub.orderId, { timeout: { status: 'UNCOLLECTED' } })
    setStripeFee(197)
    from = transfers.length
    await pp.processOrderPayout(ub.orderId)
    assert(transfers.slice(from).map(t => t.params.amount).join() === '4825' && (await prisma.partnerEarning.count({ where: { orderId: ub.orderId } })) === 0, 'UNCOLLECTED booth: the vendor is paid, no partner')

    // ── PG-4 both orders of events ────────────────────────────────────────────────────────
    console.log('\n[PG-4] Both orders of events')
    const tr = await import('../lib/tip-refund')
    const run4 = async (label: string, refundFirst: boolean) => {
      const o = await readyOrder(`pg4 ${label}`, { curbside: true, feeModel2: true, tip: 1 })
      ;(globalThis as any).__OWED_BACK_INLINE_FAIL = !refundFirst // reversed case: the inline trigger fails
      await reconcileMasterStatus(o.orderId, { timeout: { status: 'UNDELIVERABLE' } })
      if (refundFirst) await tr.owedBackAfterTerminal(o.orderId, 'undeliverable')
      ;(globalThis as any).__OWED_BACK_INLINE_FAIL = false
      setStripeFee(211)
      let threw: string | null = null
      try { await pp.processOrderPayout(o.orderId) } catch (e) { threw = String(e).slice(0, 160) }
      if (!refundFirst) await tr.reconcileTipRefunds({ maxPerRun: 1000 })
      await tr.reconcileTipRefunds({ maxPerRun: 1000 }) // a second sweep must send nothing more
      const mine = refunds.filter(r => r.p.metadata?.orderId === o.orderId && r.p.metadata?.kind === 'owed_back')
      return { threw, mine, partner: await prisma.partnerEarning.count({ where: { orderId: o.orderId } }) }
    }
    const a4 = await run4('refund first', true)
    const b4 = await run4('payout first', false)
    for (const [lab, r] of [['owed-back refund then payout', a4], ['payout then owed-back (inline failed, sweep refunds)', b4]] as const) {
      assert(r.threw === null && r.mine.length === 1 && r.mine[0].p.amount === 499 && r.partner === 0,
        `${lab}: the balance check passes, curbside fee + tip (499) refunded exactly once, no PartnerEarning${r.threw ? ` — threw ${r.threw}` : ''}`)
    }

    // ── PG-5 catch-up ─────────────────────────────────────────────────────────────────────
    console.log('\n[PG-5] Catch-up')
    const rec = await import('../lib/reconciler')
    const c5 = await readyOrder('pg5 gap', { feeModel2: true })
    await reconcileMasterStatus(c5.orderId, { timeout: { status: 'UNDELIVERABLE' } })
    const now = new Date()
    await prisma.order.update({ where: { id: c5.orderId }, data: { undeliverableAt: new Date(now.getTime() - REFUND_WINDOW_MS - 3_600_000) } })
    const winStart = new Date(now.getTime() - 48 * 3_600_000)
    const candC = await rec.selectPatternCCandidates({ windowStart: winStart, now, maxPerPattern: 1000 })
    assert(candC.some(c => c.orderId === c5.orderId && c.gapVendorIds.includes(c5.vendorIds[0])), 'Pattern C finds an UNDELIVERABLE order with no payout once its end time has cleared the window')
    await prisma.order.update({ where: { id: c5.orderId }, data: { undeliverableAt: new Date(now.getTime() - 3_600_000) } })
    assert(!(await rec.selectPatternCCandidates({ windowStart: winStart, now, maxPerPattern: 1000 })).some(c => c.orderId === c5.orderId), 'not before the refund window has cleared')
    await prisma.order.update({ where: { id: c5.orderId }, data: { undeliverableAt: new Date(now.getTime() - REFUND_WINDOW_MS - 3_600_000) } })
    const undo5 = __protectEventForTest(c5.eventId)
    const protectedHidden = !(await rec.selectPatternCCandidates({ windowStart: winStart, now, maxPerPattern: 1000 })).some(c => c.orderId === c5.orderId)
    undo5()
    assert(protectedHidden, 'a protected event\'s order is skipped by the catch-up')
    await prisma.vendorEarning.deleteMany({ where: { orderId: c5.orderId } })
    const candS = await rec.selectPatternSCandidates({ windowStart: winStart, maxPerPattern: 1000 })
    assert(candS.some(c => c.orderId === c5.orderId && c.missingVendorIds.includes(c5.vendorIds[0])), 'Pattern S finds the missing earning on the UNDELIVERABLE order')
    assert(/status \$\{ord\.status\} is not COMPLETED\/DELIVERED\/UNCOLLECTED\/UNDELIVERABLE/.test(src('lib/reconciler.ts')), 'X2\'s explanation accepts the two states')

    // ── PG-7 estimate ─────────────────────────────────────────────────────────────────────
    console.log('\n[PG-7] Vendor estimate')
    const { computeVendorOrderEarnings } = await import('../lib/vendor-earnings')
    const SEL = { total: true, status: true, feeModel: true, cardFeesPaidBy: true, orderItems: { select: { vendorId: true, subtotal: true } }, payouts: { select: { vendorId: true, netAmount: true, reversedAt: true, stripeTransferId: true } }, refunds: { select: { vendorId: true, status: true, amountCents: true } }, vendorOrderStatuses: { select: { vendorId: true, status: true } }, vendorTaxes: { select: { vendorId: true, salesTaxCents: true, localTaxCents: true } } } as const
    const pre = computeVendorOrderEarnings((await prisma.order.findUnique({ where: { id: c5.orderId }, select: SEL })) as any, c5.vendorIds[0])
    setStripeFee(197)
    await pp.processOrderPayout(c5.orderId)
    const post = computeVendorOrderEarnings((await prisma.order.findUnique({ where: { id: c5.orderId }, select: SEL })) as any, c5.vendorIds[0])
    assert(pre.status === 'estimated' && post.status === 'settled' && post.cents === 4825, `pending before the payout (${pre.status} ${pre.cents}¢), settled after (${post.status} ${post.cents}¢)`)

    // ── PG-8 forward-only ─────────────────────────────────────────────────────────────────
    console.log('\n[PG-8] Forward-only')
    const old = await readyOrder('pg8 legacy undeliverable', { feeModel2: true })
    await prisma.order.update({ where: { id: old.orderId }, data: { status: 'UNDELIVERABLE', undeliverableAt: null } })
    await prisma.vendorOrderStatus.updateMany({ where: { orderId: old.orderId }, data: { status: 'CANCELLED' } })
    const fresh = await readyOrder('pg8 newly marked', { feeModel2: true })
    await reconcileMasterStatus(fresh.orderId, { timeout: { status: 'UNDELIVERABLE' } })
    await prisma.order.update({ where: { id: fresh.orderId }, data: { undeliverableAt: new Date(now.getTime() - REFUND_WINDOW_MS - 3_600_000) } })
    await prisma.payout.deleteMany({ where: { orderId: fresh.orderId } })
    const c8 = await rec.selectPatternCCandidates({ windowStart: winStart, now, maxPerPattern: 1000 })
    assert(!c8.some(c => c.orderId === old.orderId), 'an UNDELIVERABLE order with no undeliverableAt (marked before the fix) is never selected')
    assert(c8.some(c => c.orderId === fresh.orderId), '[0] control: a newly marked one is')

    // ── PG-9 missing-partner check ────────────────────────────────────────────────────────
    console.log('\n[PG-9] Missing-partner check')
    const flagged = async () => new Set((await rec.selectPartnerEarningMissing({ maxPerPattern: 10_000 })).map(o => o.id))
    assert(!(await flagged()).has(u.orderId), '[0] control: UNCOLLECTED curbside WITH its PartnerEarning → no alert')
    await prisma.partnerEarning.delete({ where: { orderId: u.orderId } })
    const f2 = await flagged()
    assert(f2.has(u.orderId), 'planted: UNCOLLECTED feeModel 2 curbside with a split but no PartnerEarning → one alert')
    assert(!f2.has(t1.orderId) && (await prisma.orderFeeSplit.count({ where: { orderId: t1.orderId } })) === 1, 'UNDELIVERABLE curbside (split, no PartnerEarning by design) → never flagged')
  } finally {
    queues.__setOrderQueueForTest(null)
    await cleanup()
  }
}

main()
  .catch(e => { console.error(e); fail++ })
  .finally(async () => {
    console.log(`\n${'─'.repeat(64)}`)
    console.log(fail === 0 ? `  ${pass} passed, 0 failed` : `  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(64)}\n`)
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
