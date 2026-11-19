/**
 * ITEM 10 / B1.13 STAGE 4 — PAYOUTS (BATCH-1 §19 S4-Q1..Q4, test plan approved 2026-11-19). Test DB,
 * Stripe stubbed in-process (scripts/payout-golden-test.ts harness).
 *
 *   [1] old (feeModel null) orders: the payout is identical to the golden recorded BEFORE stage 4 code
 *   [2] $50 booth, feeModel 2: transfer 4825¢; split 197 = 175 + 22; FairSynq net 728; no partner row;
 *       balance: vendor + FairSynq net + partner + fee = charge
 *   [3] $50 curbside, feeModel 2: 175 / 22 / 11; PartnerEarning 388¢ held; NO runner/organizer earning
 *       (a legacy curbside order still accrues them: the probe's positive control)
 *   [4] re-runs pay from the STORED split: a second run (feeModel 2 AND legacy) sends nothing and doesn't
 *       throw (the behavioural double-pay check), a different fee changes no row; a held (unconnected) vendor released later is paid its stored share, not a new one
 *   [5] owed-back: a DELIVERED feeModel 2 order with a held PartnerEarning is never refunded; a CANCELLED
 *       feeModel 2 order (no partner earning) still is
 *   [6] the missing-PartnerEarning check: quiet on healthy orders, catches a planted one; legacy Pattern L
 *       skips feeModel 2; Slack at most once per order per 24 h (Redis key), sent anyway when Redis is down
 *   [7] vendor estimate: feeModel 2 before payout ≤ settled after; PLATFORM exact; legacy byte-identical
 *   [8] copy and settings: the two approved estimate lines, the card-fee note gone
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/fees-stage4-test.ts
 */
import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'
import {
  runPayoutScenarios, comparePayoutGolden, loadPayoutGolden,
  buildOrder, stubStripe, setStripeFee, transfers, cleanup,
} from './payout-golden-test'
import { testPrisma } from '../lib/test-db'
import { splitStripeFee } from '../lib/payout-split'
import { computeVendorOrderEarnings, estimateStripeFeeCents, type OrderForEarnings } from '../lib/vendor-earnings'

const prisma = testPrisma()
let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const SNAP = (cardFeesPaidBy: 'VENDOR' | 'PLATFORM' = 'VENDOR') => ({ serviceFeeBps: 1500, serviceFeeFlatCents: 0, cardFeesPaidBy })
const fm2 = (cardFeesPaidBy: 'VENDOR' | 'PLATFORM' = 'VENDOR') => ({ feeModel: 2, snapshot: SNAP(cardFeesPaidBy), serviceCents: 750 })

async function splitRows(orderId: string) {
  const split = await prisma.orderFeeSplit.findUnique({ where: { orderId }, include: { vendors: { orderBy: { vendorId: 'asc' } } } })
  const partner = await prisma.partnerEarning.findUnique({ where: { orderId } })
  return { split, partner }
}
const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'createdAt' || k === 'updatedAt' ? undefined : v)))

const EARN_SELECT = {
  total: true, status: true, feeModel: true, cardFeesPaidBy: true,
  orderItems: { select: { vendorId: true, subtotal: true } },
  payouts: { select: { vendorId: true, netAmount: true, reversedAt: true, stripeTransferId: true } },
  refunds: { select: { vendorId: true, status: true, amountCents: true } },
  vendorOrderStatuses: { select: { vendorId: true, status: true } },
} as const

async function main() {
  // ── [1] legacy golden ──────────────────────────────────────────────────────────────────
  console.log('[1] Old (feeModel null) orders pay exactly what they paid before stage 4')
  const golden = loadPayoutGolden()
  const run = await runPayoutScenarios()
  const diffs = comparePayoutGolden(run, golden)
  for (const d of diffs) console.log(`     ↳ ${d}`)
  assert(Object.keys(golden).length === 6, 'the golden holds the 6 recorded scenarios')
  assert(diffs.length === 0, 'all 6 old-order scenarios identical to the golden (transfers, keys, Payout/VendorEarning/PayoutHold, runner + organizer)')
  const tampered = JSON.parse(JSON.stringify(golden))
  tampered['booth one vendor $50'].transfers[0].params.amount += 1
  assert(comparePayoutGolden(run, tampered).length === 1, '[0] positive control: a 1¢ change in the golden is caught')

  await cleanup()
  await stubStripe()
  const { processOrderPayout } = await import('../lib/process-payout')
  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  try {
    // ── [2] $50 booth ────────────────────────────────────────────────────────────────────
    console.log('\n[2] $50 booth, feeModel 2 (Exhibit A example)')
    const booth = await buildOrder({ name: 'fm2 booth', fee: 197, vendors: [{ price: 50 }] }, fm2())
    setStripeFee(197)
    let from = transfers.length
    const r2 = await processOrderPayout(booth.orderId)
    const t2 = transfers.slice(from)
    assert(t2.length === 1 && t2[0].params.amount === 4825 && t2[0].params.destination === booth.accounts[0], 'one transfer of 4825¢ ($48.25) to the vendor')
    const s2 = await splitRows(booth.orderId)
    assert(!!s2.split && s2.split.realStripeFeeCents === 197 && s2.split.fairsynqShareCents === 22 && s2.split.fairsynqNetCents === 728 && s2.split.partnerShareCents === 0 && s2.split.partnerNetCents === 0,
      'OrderFeeSplit: fee 197¢, FairSynq share 22¢ and net 728¢, no partner')
    const v2 = s2.split!.vendors[0]
    assert(v2.foodCents === 5000 && v2.taxCents === 0 && v2.feeShareCents === 175 && v2.payCents === 4825, 'vendor row: food 5000, tax 0, share 175, pay 4825')
    assert(s2.partner === null, 'no PartnerEarning on a booth order')
    const p2 = await prisma.payout.findMany({ where: { orderId: booth.orderId } })
    assert(p2.length === 1 && Math.round(p2[0].netAmount * 100) === 4825 && Math.round(p2[0].fairSynqFee * 100) === 175, 'Payout row: net $48.25, fee share $1.75')
    assert(v2.payCents + s2.split!.fairsynqNetCents + s2.split!.partnerNetCents + s2.split!.realStripeFeeCents === 5750,
      'balance: vendor 4825 + FairSynq 728 + partner 0 + fee 197 = charge 5750')
    assert(v2.feeShareCents + s2.split!.fairsynqShareCents + s2.split!.partnerShareCents === s2.split!.realStripeFeeCents, 'the parts sum to the real fee')
    assert((r2 as any).stripeFeeCents === 197, 'the payout reports the real fee it split')

    // ── [3] curbside ────────────────────────────────────────────────────────────────────
    console.log('\n[3] $50 curbside, feeModel 2: partner held, no runner/organizer earning')
    const curb = await buildOrder({ name: 'fm2 curb', fee: 208, vendors: [{ price: 50 }], curbside: { fee: 3.99, tip: 0, runnerPct: 50 } }, fm2())
    await reconcileMasterStatus(curb.orderId) // RUNNER_COLLECTED → DELIVERED
    const curbStatus = await prisma.order.findUnique({ where: { id: curb.orderId }, select: { status: true } })
    assert(curbStatus?.status === 'DELIVERED', 'the curbside order reached DELIVERED (the accrual point)')
    assert(await prisma.runnerEarning.count({ where: { orderId: curb.orderId } }) === 0 && await prisma.organizerEarning.count({ where: { orderId: curb.orderId } }) === 0,
      'NO RunnerEarning / OrganizerEarning for a feeModel 2 order')
    const legacyCurb = await buildOrder({ name: 'legacy curb', fee: 210, vendors: [{ price: 50 }], curbside: { fee: 3.99, tip: 2, runnerPct: 50 } })
    await reconcileMasterStatus(legacyCurb.orderId)
    assert(await prisma.runnerEarning.count({ where: { orderId: legacyCurb.orderId } }) === 1,
      '[0] positive control: a legacy curbside order reaching DELIVERED the same way DOES accrue a RunnerEarning')
    setStripeFee(208)
    from = transfers.length
    await processOrderPayout(curb.orderId)
    const t3 = transfers.slice(from)
    const s3 = await splitRows(curb.orderId)
    assert(t3.length === 1 && t3[0].params.amount === 4825, 'vendor transfer 4825¢')
    assert(s3.split!.vendors[0].feeShareCents === 175 && s3.split!.fairsynqShareCents === 22 && s3.split!.partnerShareCents === 11, 'fee 208¢ split 175 / 22 / 11')
    assert(!!s3.partner && s3.partner.amountCents === 388 && s3.partner.status === 'held' && s3.partner.partnerId === null && s3.partner.eventId === curb.eventId,
      'PartnerEarning 388¢ ($3.88), held, no partner yet, on the order\'s event')
    assert(s3.split!.partnerNetCents === s3.partner!.amountCents, 'split partner net = PartnerEarning amount')
    assert(4825 + s3.split!.fairsynqNetCents + s3.partner!.amountCents + 208 === 6149, 'balance: 4825 + 728 + 388 + 208 = charge 6149')
    assert(await prisma.runnerEarning.count({ where: { orderId: curb.orderId } }) === 0, 'still no RunnerEarning after the payout')

    // ── [4] re-runs use the stored split ─────────────────────────────────────────────────
    console.log('\n[4] Re-runs and held-then-released vendors pay from the STORED split')
    const before = strip(await splitRows(curb.orderId))
    setStripeFee(260) // a different fee: must change nothing
    // BEHAVIOURAL double-pay check (2026-11-19): a planted loop that sends an already-paid slice
    // again can keep the static guard's text intact (scripts/test-double-pay-guard.ts [3]); only a real
    // re-run sees it. Asserted explicitly, including the case where the run throws AFTER the transfer.
    const rerun = async (orderId: string) => {
      const at = transfers.length
      let threw: string | null = null
      try { await processOrderPayout(orderId) } catch (e) { threw = String(e).slice(0, 160) }
      return { sent: transfers.length - at, threw }
    }
    const r4 = await rerun(curb.orderId)
    assert(r4.sent === 0 && r4.threw === null, `feeModel 2 re-run: no transfer sent, no error (sent ${r4.sent}${r4.threw ? `, threw ${r4.threw}` : ''})`)
    const legacyBooth = await buildOrder({ name: 'legacy rerun', fee: 197, vendors: [{ price: 50 }] })
    setStripeFee(197)
    await processOrderPayout(legacyBooth.orderId)
    const r4l = await rerun(legacyBooth.orderId)
    assert(r4l.sent === 0 && r4l.threw === null, `legacy re-run: no transfer sent, no error (sent ${r4l.sent}${r4l.threw ? `, threw ${r4l.threw}` : ''})`)
    setStripeFee(260)
    assert(JSON.stringify(strip(await splitRows(curb.orderId))) === JSON.stringify(before), 'and the split + PartnerEarning rows are unchanged (fee stays 208)')
    assert(await prisma.partnerEarning.count({ where: { orderId: curb.orderId } }) === 1, 'still exactly one PartnerEarning')

    const held = await buildOrder({ name: 'fm2 held', fee: 167, vendors: [{ price: 30 }, { price: 20, connected: false }] }, { ...fm2(), serviceCents: 750 })
    setStripeFee(197)
    from = transfers.length
    await processOrderPayout(held.orderId)
    const firstHeld = transfers.slice(from)
    const sh = await splitRows(held.orderId)
    const rowB = sh.split!.vendors.find(v => v.vendorId === held.vendorIds[1])!
    const rowA = sh.split!.vendors.find(v => v.vendorId === held.vendorIds[0])!
    assert(firstHeld.length === 1 && firstHeld[0].params.amount === rowA.payCents, `first run: the connected vendor is paid its split ${rowA.payCents}¢`)
    const hold = await prisma.payoutHold.findFirst({ where: { orderId: held.orderId, vendorId: held.vendorIds[1] } })
    assert(!!hold && hold.amountCents === rowB.payCents, `the unconnected vendor is held at its split pay ${rowB.payCents}¢`)
    await prisma.vendor.update({ where: { id: held.vendorIds[1] }, data: { stripeAccountId: `acct_pgold-late_${Date.now()}`, stripeVerified: true } })
    setStripeFee(400) // the release run sees another fee: the stored share must win
    from = transfers.length
    await processOrderPayout(held.orderId)
    const release = transfers.slice(from)
    assert(release.length === 1 && release[0].params.amount === rowB.payCents, `released later: paid exactly the stored ${rowB.payCents}¢, not a recalculation at 400¢`)
    assert(rowA.feeShareCents + rowB.feeShareCents + sh.split!.fairsynqShareCents === 197 && rowA.payCents + rowB.payCents + sh.split!.fairsynqNetCents + 197 === 5750,
      'held order: shares sum to 197 and vendors + FairSynq + fee = 5750')

    // ── [5] owed-back ───────────────────────────────────────────────────────────────────
    console.log('\n[5] Owed-back: a held partner earning is never refunded; a cancelled order still is')
    const { owedBackCandidateWhere, planTipRefund } = await import('../lib/tip-refund')
    const inScan = async (id: string) => (await prisma.order.count({ where: { AND: [owedBackCandidateWhere(), { id }] } })) === 1
    const plan5 = await planTipRefund(curb.orderId)
    assert(plan5.outcome !== 'refund' && plan5.owedBackCents === 0 && !(await inScan(curb.orderId)),
      `DELIVERED feeModel 2 curbside order (PartnerEarning held): never refunded (plan: ${plan5.outcome}) and never in the owed-back scan`)
    const cx = await buildOrder({ name: 'fm2 cancelled', fee: 0, vendors: [{ price: 50 }], curbside: { fee: 3.99, tip: 1, runnerPct: 50 } }, fm2())
    await prisma.order.update({ where: { id: cx.orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), runnerId: null } })
    const plan5b = await planTipRefund(cx.orderId)
    assert(plan5b.outcome === 'refund' && plan5b.owedBackCents === 499 && await inScan(cx.orderId), 'CANCELLED feeModel 2 order, no partner earning → owed back 499¢ (fee 399 + tip 100), in the scan')
    await prisma.partnerEarning.create({ data: { eventId: cx.eventId, orderId: cx.orderId, amountCents: 1, status: 'held' } })
    assert(!(await inScan(cx.orderId)) && (await planTipRefund(cx.orderId)).outcome === 'excluded_runner_earned',
      'the same cancelled order WITH a PartnerEarning drops out of the scan and the plan excludes it')
    const src = readFileSync('lib/tip-refund.ts', 'utf8')
    assert(/partnerEarning\.findUnique\(\{ where: \{ orderId \}/.test(src), 'the execute-time policy gate re-checks PartnerEarning too')

    // ── [6] missing-partner check ───────────────────────────────────────────────────────
    console.log('\n[6] The missing-PartnerEarning reconciler check (read-only, Slack)')
    const { selectPartnerEarningMissing } = await import('../lib/reconciler')
    const ours = new Set([booth.orderId, curb.orderId, held.orderId, cx.orderId, legacyCurb.orderId])
    const scan = async () => (await selectPartnerEarningMissing({ maxPerPattern: 1000 })).filter(o => ours.has(o.id)).map(o => o.id)
    assert((await scan()).length === 0, 'baseline: none of this run\'s orders is flagged (booth has no fee, curbside has its PartnerEarning)')
    await prisma.partnerEarning.delete({ where: { orderId: curb.orderId } })
    const planted = await scan()
    assert(planted.length === 1 && planted[0] === curb.orderId, 'planted: the curbside order with its PartnerEarning removed is flagged')
    await prisma.partnerEarning.create({ data: { eventId: curb.eventId, orderId: curb.orderId, amountCents: 388, status: 'held' } })
    assert((await scan()).length === 0, 'restored: quiet again')
    const rec = readFileSync('lib/reconciler.ts', 'utf8')
    assert(/selectPartnerEarningMissing\(o\)/.test(rec) && /alertPartnerEarningMissing\(/.test(rec) && /sum\.alerted\.push\(`Pattern L: feeModel 2 order/.test(rec),
      'Pattern L runs the check, logs every flagged order each sweep, and sends the rate-limited Slack notice')

    // The Slack limit: once per order per 24 h via a Redis key (the worker's REDIS_URL); sent anyway if Redis is down.
    // Real Redis = the LOCAL dev stack's (localhost, from .env.local), never a shared one; keys removed after.
    const alertMod = await import('../lib/partner-earning-alert')
    const localRedis = parse(readFileSync('.env.local', 'utf8')).REDIS_URL ?? ''
    assert(/^redis:\/\/(localhost|127\.0\.0\.1)[:/]/.test(localRedis), '[0] the real-Redis check runs against the LOCAL dev Redis only')
    const IORedis = (await import('ioredis')).default
    const rds = new IORedis(localRedis, { maxRetriesPerRequest: 1 })
    const ids = [`fs4-a-${Date.now()}`, `fs4-b-${Date.now()}`]
    const keys = ids.map(i => alertMod.PARTNER_ALERT_KEY_PREFIX + i)
    await rds.del(...keys)
    const notified: string[][] = []
    const notify = async (o: string[]) => { notified.push(o) }
    const savedRedis = process.env.REDIS_URL
    try {
      process.env.REDIS_URL = localRedis
      const a1 = await alertMod.alertPartnerEarningMissing(ids, { notify })
      assert(a1.sent.join() === ids.join() && !a1.redisUnavailable && notified.length === 1 && notified[0].join() === ids.join(),
        'first sweep: one Slack notice naming both orders')
      const ttl = await rds.ttl(keys[0])
      assert(ttl > 86_390 && ttl <= 86_400, `the limit is a Redis key per order with a 24-hour expiry (ttl ${ttl}s)`)
      const a2 = await alertMod.alertPartnerEarningMissing(ids, { notify })
      assert(a2.sent.length === 0 && a2.suppressed.length === 2 && notified.length === 1, 'the next sweep within 24 h: suppressed, no Slack')
      await rds.del(keys[1])
      const a3 = await alertMod.alertPartnerEarningMissing(ids, { notify })
      assert(a3.sent.join() === ids[1] && a3.suppressed.join() === ids[0] && notified.length === 2 && notified[1].join() === ids[1],
        'per ORDER: an order whose key has expired (or a newly flagged one) is alerted; the other stays suppressed')
      const a4 = await alertMod.alertPartnerEarningMissing(ids, { setNxMany: async () => { throw new Error('redis down') }, notify })
      process.env.REDIS_URL = 'redis://127.0.0.1:1'
      const a5 = await alertMod.alertPartnerEarningMissing(ids, { notify })
      assert(a4.redisUnavailable && a4.sent.length === 2 && a5.redisUnavailable && a5.sent.length === 2 && notified.length === 4,
        'Redis down (throwing, or unreachable) → the alert is sent anyway, for every order')
      const a6 = await alertMod.alertPartnerEarningMissing(ids, { setNxMany: async (k) => k.map(() => false), notify })
      assert(a6.sent.length === 0 && notified.length === 4, '[0] control: when every key already exists nothing is sent')
      const a7 = await alertMod.alertPartnerEarningMissing([], { setNxMany: async () => { throw new Error('must not be called') }, notify })
      assert(a7.sent.length === 0 && notified.length === 4, 'nothing flagged → no Redis call, no Slack')
    } finally {
      process.env.REDIS_URL = savedRedis
      await rds.del(...keys)
      rds.disconnect()
    }
    assert(/feeModel: null, \/\/ legacy only/.test(rec), 'Pattern L\'s legacy runner-earnings audit skips feeModel 2 orders')
    const notifySrc = readFileSync('lib/notify.ts', 'utf8')
    assert(/export async function notifyPartnerEarningMissing[\s\S]*?postToSlack\(/.test(notifySrc), 'the notice goes to Slack (postToSlack)')

    // ── [7] vendor estimate ─────────────────────────────────────────────────────────────
    console.log('\n[7] Vendor take-home estimate')
    const fresh = await buildOrder({ name: 'fm2 estimate', fee: 197, vendors: [{ price: 50 }] }, fm2())
    const pre = await prisma.order.findUnique({ where: { id: fresh.orderId }, select: EARN_SELECT })
    const est = computeVendorOrderEarnings(pre as OrderForEarnings, fresh.vendorIds[0])
    setStripeFee(197)
    await processOrderPayout(fresh.orderId)
    const post = await prisma.order.findUnique({ where: { id: fresh.orderId }, select: EARN_SELECT })
    const settled = computeVendorOrderEarnings(post as OrderForEarnings, fresh.vendorIds[0])
    assert(est.status === 'estimated' && est.cents === 4824, `before payout: estimated 4824¢ (prediction 197¢, share rounded up to 176)`)
    assert(settled.status === 'settled' && settled.cents === 4825 && est.cents <= settled.cents, 'after payout: settled 4825¢ ≥ the estimate')
    const platO = await buildOrder({ name: 'fm2 platform', fee: 197, vendors: [{ price: 50 }] }, fm2('PLATFORM'))
    const platRow = await prisma.order.findUnique({ where: { id: platO.orderId }, select: EARN_SELECT })
    assert(computeVendorOrderEarnings(platRow as OrderForEarnings, platO.vendorIds[0]).cents === 5000, 'PLATFORM: the estimate is the full 5000¢ (exact)')
    // Legacy: byte-identical to the pre-stage-4 formula across many orders.
    let same = 0, n = 0
    for (let total = 100; total <= 40000; total += 137) {
      for (const subs of [{ a: 1 }, { a: 3, b: 2 }, { a: 1, b: 1, c: 5 }]) {
        const food: Record<string, number> = {}
        const wsum = Object.values(subs).reduce((x, y) => x + y, 0)
        for (const [k, w] of Object.entries(subs)) food[k] = Math.max(1, Math.floor((total / 1.1) * w / wsum))
        const o: OrderForEarnings = {
          total: total / 100, status: 'COMPLETED', feeModel: null, cardFeesPaidBy: null,
          orderItems: Object.entries(food).map(([vendorId, c]) => ({ vendorId, subtotal: c / 100 })),
          payouts: [], refunds: [], vendorOrderStatuses: Object.keys(food).map(vendorId => ({ vendorId, status: 'COMPLETED' })),
        }
        const old = splitStripeFee(Object.fromEntries(Object.entries(food).map(([k, c]) => [k, Math.round((c / 100) * 100)])), estimateStripeFeeCents(total))
        for (const l of old) { n++; if (computeVendorOrderEarnings(o, l.vendorId).cents === Math.max(0, l.subtotalCents - l.feeShareCents)) same++ }
      }
    }
    assert(n > 500 && same === n, `legacy (feeModel null) estimate byte-identical to the old formula (${same}/${n} slices)`)
  } finally {
    await cleanup()
  }

  // ── [8] copy and settings ─────────────────────────────────────────────────────────────
  console.log('\n[8] Copy and settings')
  const copy = await import('../lib/vendor-estimate-copy')
  assert(copy.PENDING_ESTIMATE_NOTE === 'not yet transferred · an estimate: some cards, such as international ones, cost more to process',
    'analytics "Pending (est.)" note: the approved text')
  assert(copy.TAKE_HOME_ESTIMATE_NOTE === 'Estimate until paid out. Some cards, such as international ones, cost more to process.',
    'order detail "Your Take-Home" note: the approved text')
  const analytics = readFileSync('app/vendor/[fairSlug]/analytics/page.tsx', 'utf8')
  const orders = readFileSync('app/vendor/[fairSlug]/orders/page.tsx', 'utf8')
  assert(/note: PENDING_ESTIMATE_NOTE/.test(analytics) && !/note: 'not yet transferred'/.test(analytics), 'the analytics page uses it (the old note is gone)')
  assert(/earningsStatus === 'estimated' && \([\s\S]{0,200}TAKE_HOME_ESTIMATE_NOTE/.test(orders), 'the order detail shows it only while the take-home is an estimate')
  const settingsLib = await import('../lib/settings')
  assert(!('notInEffect' in settingsLib.SETTINGS['fees.cardFeesPaidBy']), 'the card-fee "not in effect yet" note is gone (the payout splits by it now)')
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
