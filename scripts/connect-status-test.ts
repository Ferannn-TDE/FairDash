/**
 * CONNECT STATUS TEST (readiness 1.4) — the one writer of the payout gate, against the test DB.
 *
 *   [0] BASELINE + CONTROLS — the fake queue and the transfer spy record what they're given.
 *   [1] TRANSITIONS, per payee kind (vendor, runner, organizer):
 *       false→true once (notice job, stripeConnectedAt set), replay ×3 → nothing;
 *       true→false closes the gate at once and queues ONE ~10 min re-check, replay ×3 → nothing;
 *       re-check still restricted → one needs-attention notice, replay → no second;
 *       re-activation after a warning → "payouts restored"; a restriction that clears inside
 *       the window → no notice at all.
 *   [2] RACE — 5 concurrent activations → exactly one transition, one notice job.
 *   [3] NOTICE JOB REPLAY — same key ×3 → one PayeeNotice row.
 *   [4] STATUS READ — ?fresh=1 only for the owner, only within the per-user limit.
 *   [5] WEBHOOK — 400 bad/missing signature, 200 unknown type (no DB), 500 on DB or Stripe
 *       failure (Stripe retries), replay ×3 → one change + one notice job.
 *   [6] MONEY GATE — a closed gate makes the real runner executor hold (0 transfers); opening
 *       it lets the same order pay (1 transfer).
 *
 * Every expected value is written out here, never computed with the code under test.
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/connect-status-test.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

const prisma = testPrisma()
const SLUG = 'cs14-'
const MAIL = '@cs14.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

// ── Fake BullMQ queue: records adds, dedupes by jobId like the real one ──────────
interface Added { name: string; data: any; jobId?: string; delay?: number }
const added: Added[] = []
const fakeQueue = {
  name: 'fake',
  async add(name: string, data: any, opts: any) {
    if (opts?.jobId && added.some(a => a.jobId === opts.jobId)) return undefined
    added.push({ name, data, jobId: opts?.jobId, delay: opts?.delay })
    return { id: opts?.jobId }
  },
}
const jobs = (name: string, payeeId?: string) => added.filter(a => a.name === name && (!payeeId || a.data.payeeId === payeeId))

// ── Stripe transfer spy ─────────────────────────────────────────────────────────
const transfers: Array<{ amount: number; key?: string }> = []
async function installTransferSpy() {
  const { stripe } = await import('../lib/stripe')
  void stripe.transfers
  ;(stripe.transfers as unknown as Record<string, unknown>).create = async (params: any, opts: any) => {
    const t = { id: `tr_${rand()}`, amount: params.amount, key: opts?.idempotencyKey }
    transfers.push(t)
    return t
  }
}

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.runner.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.payeeNotice.deleteMany({ where: { noticeKey: { contains: SLUG } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

let ev: { id: string }
async function mkPayee(kind: 'vendor' | 'runner' | 'organizer', verified = false) {
  const acct = `acct_${SLUG}${rand()}`
  const common = { stripeAccountId: acct, stripeVerified: verified, stripeConnectedAt: verified ? new Date(Date.now() - 86_400_000) : null }
  if (kind === 'vendor') return prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}v-${rand()}`, cuisineType: 'T', status: 'ACTIVE', ...common } })
  if (kind === 'runner') {
    const u = await prisma.user.create({ data: { clerkId: `${SLUG}c-${rand()}`, email: `${SLUG}r-${rand()}${MAIL}`, name: 'R', role: 'runner' } })
    return prisma.runner.create({ data: { userId: u.id, eventId: ev.id, status: 'ACTIVE', ...common } })
  }
  return prisma.fairOrganizer.create({ data: { name: `O ${rand()}`, contactEmail: `${SLUG}o-${rand()}${MAIL}`, ...common } })
}
const row = (kind: 'vendor' | 'runner' | 'organizer', id: string): Promise<any> =>
  (kind === 'vendor' ? prisma.vendor : kind === 'runner' ? prisma.runner : prisma.fairOrganizer as any)
    .findUnique({ where: { id }, select: { stripeVerified: true, stripeConnectedAt: true } })
const notices = (payeeId: string, kind?: string) => prisma.payeeNotice.findMany({ where: { payeeId, ...(kind ? { kind } : {}) } })

const ID_DOC = { readyToReceivePayments: false, onboardingComplete: false, dueItems: [{ description: 'individual.verification.document', deadline: 'currently_due' }] }
const READY = { readyToReceivePayments: true, onboardingComplete: true, dueItems: [] }

async function main() {
  await cleanup()
  const { __setOrderQueueForTest, JOB_PAYEE_NOTICE, JOB_CONNECT_RECHECK } = await import('../lib/queues')
  __setOrderQueueForTest(fakeQueue as any)
  await installTransferSpy()
  const cs = await import('../lib/connect-status')
  ev = await prisma.event.create({ data: { name: `CS ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE' } })

  try {
    console.log('[0] baseline + controls')
    assert(added.length === 0 && transfers.length === 0, 'step 0: nothing queued, nothing transferred')
    await fakeQueue.add('probe', {}, { jobId: 'probe-1' }); await fakeQueue.add('probe', {}, { jobId: 'probe-1' })
    assert(jobs('probe').length === 1, 'positive control: the fake queue records an add and dedupes a repeated jobId')
    added.length = 0

    for (const kind of ['vendor', 'runner', 'organizer'] as const) {
      console.log(`[1] transitions — ${kind}`)
      const p = await mkPayee(kind)
      const t0 = new Date(Date.now() - 3 * 86_400_000)  // instants in the PAST: notice rows carry real createdAt
      const a1 = await cs.applyConnectStatus(kind, p.id, true, { source: 'webhook', now: t0 })
      let r = await row(kind, p.id)
      assert(a1.transition === 'activated' && a1.transition === 'activated' && (a1 as any).notice === 'PAYOUT_SETUP_COMPLETE', 'false→true: activated, notice = setup complete')
      assert(r.stripeVerified === true && r.stripeConnectedAt?.getTime() === t0.getTime(), 'gate open, stripeConnectedAt = the transition instant')
      assert(jobs(JOB_PAYEE_NOTICE, p.id).length === 1, 'one notice job queued')

      for (let i = 0; i < 3; i++) await cs.applyConnectStatus(kind, p.id, true, { source: 'status', now: new Date(t0.getTime() + 3_600_000) })
      r = await row(kind, p.id)
      assert(r.stripeConnectedAt?.getTime() === t0.getTime(), 'replay ×3: stripeConnectedAt unchanged')
      assert(jobs(JOB_PAYEE_NOTICE, p.id).length === 1, 'replay ×3: still one notice job')

      const n = jobs(JOB_PAYEE_NOTICE, p.id)[0]
      await cs.handlePayeeNotice(n.data)
      assert((await notices(p.id, 'PAYOUT_SETUP_COMPLETE')).length === 1, 'notice job → one PayeeNotice row (pending_email_platform)')

      const t1 = new Date(Date.now() - 2 * 86_400_000)
      const d1 = await cs.applyConnectStatus(kind, p.id, false, { source: 'webhook', now: t1 })
      r = await row(kind, p.id)
      assert(d1.transition === 'deactivated' && r.stripeVerified === false, 'true→false: gate closed immediately')
      assert(r.stripeConnectedAt?.getTime() === t0.getTime(), 'deactivation leaves stripeConnectedAt alone')
      const rc = jobs(JOB_CONNECT_RECHECK, p.id)
      assert(rc.length === 1 && rc[0].delay === 600_000 && rc[0].jobId === `connect-recheck-${kind}-${p.id}-${t1.getTime()}`, 'one re-check job, 10 min delay, fixed job id')
      for (let i = 0; i < 3; i++) await cs.applyConnectStatus(kind, p.id, false, { source: 'webhook' })
      assert(jobs(JOB_CONNECT_RECHECK, p.id).length === 1, 'replay ×3: still one re-check job')
      assert((await notices(p.id, 'PAYOUT_NEEDS_ATTENTION')).length === 0, 'no needs-attention notice before the re-check')

      const restricted = async () => ID_DOC
      assert(await cs.handleConnectRecheck(rc[0].data, { getStatus: restricted }) === 'notice', 're-check, still restricted → notice')
      assert(await cs.handleConnectRecheck(rc[0].data, { getStatus: restricted }) === 'notice', 're-check replay runs')
      const att = await notices(p.id, 'PAYOUT_NEEDS_ATTENTION')
      assert(att.length === 1 && (att[0].detail as any)?.needs === 'Stripe needs: ID document', 'exactly one needs-attention notice, saying "Stripe needs: ID document"')

      const a2 = await cs.applyConnectStatus(kind, p.id, true, { source: 'webhook', now: new Date(Date.now() + 1_000) })
      assert(a2.transition === 'activated' && (a2 as any).notice === 'PAYOUTS_RESTORED', 're-activation after a warning → "payouts restored"')

      const t2 = new Date(Date.now() + 2_000)
      await cs.applyConnectStatus(kind, p.id, false, { source: 'webhook', now: t2 })
      const rc2 = jobs(JOB_CONNECT_RECHECK, p.id).find(j => j.jobId?.endsWith(String(t2.getTime())))!
      const before = jobs(JOB_PAYEE_NOTICE, p.id).length
      assert(await cs.handleConnectRecheck(rc2.data, { getStatus: async () => READY }) === 'recovered', 'restriction that clears inside the window → recovered')
      r = await row(kind, p.id)
      assert(r.stripeVerified === true && jobs(JOB_PAYEE_NOTICE, p.id).length === before, 'gate reopened, NO notice (nobody was warned)')
      assert((await notices(p.id, 'PAYOUT_NEEDS_ATTENTION')).length === 1, 'still only the one needs-attention notice')
    }

    console.log('[1b] gate reopened by an event before the re-check ran')
    const early = await mkPayee('vendor', true)
    await cs.applyConnectStatus('vendor', early.id, false, { source: 'webhook' })
    const erc = jobs(JOB_CONNECT_RECHECK, early.id)[0]
    await cs.applyConnectStatus('vendor', early.id, true, { source: 'webhook' })
    let staleCalls = 0
    const outcome = await cs.handleConnectRecheck(erc.data, { getStatus: async () => { staleCalls++; return ID_DOC } })
    assert(outcome === 'recovered' && staleCalls === 0, 're-check trusts the reopened gate: recovered, no Stripe read')
    assert((await notices(early.id, 'PAYOUT_NEEDS_ATTENTION')).length === 0 && (await row('vendor', early.id)).stripeVerified === true,
      'no needs-attention notice, gate stays open')

    console.log('[1c] dry run decides but writes nothing')
    const dr = await mkPayee('organizer')
    const jobsBefore = added.length
    const dra = await cs.applyConnectStatus('organizer', dr.id, true, { source: 'dry-run', dryRun: true })
    assert(dra.transition === 'activated' && (dra as any).notice === 'PAYOUT_SETUP_COMPLETE', 'dry run: would activate with a setup-complete notice')
    assert((await row('organizer', dr.id)).stripeVerified === false && added.length === jobsBefore, 'dry run: flag unchanged, nothing queued')
    const drv = await mkPayee('runner', true)
    const drd = await cs.applyConnectStatus('runner', drv.id, false, { source: 'dry-run', dryRun: true })
    assert(drd.transition === 'deactivated' && (await row('runner', drv.id)).stripeVerified === true && added.length === jobsBefore,
      'dry run: would deactivate, gate untouched, no re-check queued')
    assert((await cs.applyConnectStatus('runner', drv.id, true, { source: 'dry-run', dryRun: true })).transition === 'none', 'dry run: already verified + ready → none')

    console.log('[2] race')
    const raced = await mkPayee('vendor')
    const results = await Promise.all(Array.from({ length: 5 }, () => cs.applyConnectStatus('vendor', raced.id, true, { source: 'status' })))
    assert(results.filter(x => x.transition === 'activated').length === 1, '5 concurrent activations → exactly 1 transition')
    assert(jobs(JOB_PAYEE_NOTICE, raced.id).length === 1, '→ exactly 1 notice job')

    console.log('[3] notice job replay')
    const nk = { eventId: '__payee__', payeeType: 'vendor' as const, payeeId: raced.id, noticeKind: 'PAYOUT_SETUP_COMPLETE' as const, noticeKey: `PAYOUT_SETUP_COMPLETE:${SLUG}replay` }
    const outs = [await cs.handlePayeeNotice(nk), await cs.handlePayeeNotice(nk), await cs.handlePayeeNotice(nk)]
    assert(outs.join() === 'created,duplicate,duplicate', `same key ×3 → created once (got ${outs})`)

    console.log('[4] status read: ?fresh=1 owner-only and rate-limited per user')
    const sr = await mkPayee('runner', true)
    let liveCalls = 0, cachedCalls = 0
    const used = new Map<string, number>()
    const deps = {
      live: async () => { liveCalls++; return READY },
      cached: async () => { cachedCalls++; return READY },
      rateLimit: async (k: string) => { used.set(k, (used.get(k) ?? 0) + 1); return used.get(k)! <= 2 },
    }
    const read = (o: Partial<{ wantFresh: boolean; isOwner: boolean; userKey: string }>) =>
      cs.readPayeeConnectStatus({ kind: 'runner', id: sr.id, accountId: 'acct_x', wantFresh: true, isOwner: true, userKey: 'u1', ...o }, deps)
    const f1 = await read({})
    assert(f1.fresh === true && liveCalls === 1 && cachedCalls === 0, 'owner + fresh → live Stripe read')
    const f2 = await read({ isOwner: false, userKey: 'u2' })
    assert(f2.fresh === false && liveCalls === 1 && cachedCalls === 1 && !used.has('u2'), 'non-owner + fresh → cached, limiter not even consulted')
    await read({}) // u1's 2nd allowed
    const f4 = await read({})
    assert(f4.fresh === false && liveCalls === 2 && cachedCalls === 2, 'owner over the per-user limit → cached, no Stripe call')
    const f5 = await read({ userKey: 'u3' })
    assert(f5.fresh === true && liveCalls === 3, 'a different user has their own limit')
    const f6 = await read({ wantFresh: false })
    assert(f6.fresh === false && liveCalls === 3, 'no ?fresh → cached')

    console.log('[5] webhook')
    const wp = await mkPayee('organizer')
    const acct = (await prisma.fairOrganizer.findUnique({ where: { id: wp.id }, select: { stripeAccountId: true } }))!.stripeAccountId!
    let retrieves = 0
    const wdeps = (over: Partial<import('../lib/connect-status').WebhookDeps> = {}) => ({
      parse: (_b: string, s: string) => { if (s !== 'good') throw new Error('bad sig'); return { id: 'evt_1', type: 'v2.core.account[requirements].updated' } },
      retrieveAccountId: async () => { retrieves++; return acct },
      live: async () => READY,
      ...over,
    })
    assert((await cs.handleConnectWebhook('{}', null, 'whsec', wdeps())).status === 400, 'missing signature → 400')
    assert((await cs.handleConnectWebhook('{}', 'bad', 'whsec', wdeps())).status === 400, 'bad signature → 400')
    const unk = await cs.handleConnectWebhook('{}', 'good', 'whsec', wdeps({ parse: () => ({ id: 'e', type: 'v2.core.something.else' }) }))
    assert(unk.status === 200 && retrieves === 0, 'unknown event type → 200, nothing read')
    const statuses: number[] = []
    for (let i = 0; i < 3; i++) statuses.push((await cs.handleConnectWebhook('{}', 'good', 'whsec', wdeps())).status)
    assert(statuses.join() === '200,200,200' && (await row('organizer', wp.id)).stripeVerified === true, 'valid event ×3 → 200s, gate open')
    assert(jobs(JOB_PAYEE_NOTICE, wp.id).length === 1, 'replay ×3 → one status change, one notice job')
    const stripeDown = await cs.handleConnectWebhook('{}', 'good', 'whsec', wdeps({ live: async () => { throw new Error('stripe 503') } }))
    assert(stripeDown.status === 500, 'Stripe read failure → 500 (Stripe retries)')
    const { db } = await import('../lib/db')
    const realFind = db.vendor.findFirst
    ;(db.vendor as any).findFirst = async () => { throw new Error('db down') }
    const dbDown = await cs.handleConnectWebhook('{}', 'good', 'whsec', wdeps())
    ;(db.vendor as any).findFirst = realFind
    assert(dbDown.status === 500, 'database failure → 500 (Stripe retries)')

    // [5b] The two event types the payout gate depends on, each by its EXACT type string, so
    // dropping either from HANDLED_CONNECT_EVENTS fails here. The other seven types the live
    // destination (energetic-serenity) delivers must stay 200-and-ignore with no Stripe read.
    console.log('[5b] event types the destination delivers')
    const CAP = 'v2.core.account[configuration.recipient].capability_status_updated'
    const REQ = 'v2.core.account[requirements].updated'
    const typed = (type: string, live: () => Promise<unknown>, acctId: string) => wdeps({
      parse: () => ({ id: `evt_${rand()}`, type }),
      retrieveAccountId: async () => { retrieves++; return acctId },
      live: live as any,
    })
    // capability_status_updated, transfers ON → closed gate opens.
    const capOn = await mkPayee('vendor')
    const capOnRes = await cs.handleConnectWebhook('{}', 'good', 'whsec', typed(CAP, async () => READY, capOn.stripeAccountId!))
    assert(capOnRes.status === 200 && (await row('vendor', capOn.id)).stripeVerified === true && jobs(JOB_PAYEE_NOTICE, capOn.id).length === 1,
      `${CAP} (transfers active) → gate opens, one notice job`)
    // capability_status_updated, transfers OFF → open gate closes, one re-check queued.
    const capOff = await mkPayee('runner', true)
    await cs.handleConnectWebhook('{}', 'good', 'whsec', typed(CAP, async () => ({ readyToReceivePayments: false, onboardingComplete: false, dueItems: [] }), capOff.stripeAccountId!))
    assert((await row('runner', capOff.id)).stripeVerified === false && jobs(JOB_CONNECT_RECHECK, capOff.id).length === 1,
      `${CAP} (transfers inactive) → gate closes, one re-check job`)
    // requirements.updated with a blocking item → gate closes; the re-check then records the
    // plain-English "Stripe needs" line from the same live read the card shows.
    const reqP = await mkPayee('organizer', true)
    const NEEDS_DOC = { readyToReceivePayments: false, onboardingComplete: false, dueItems: [{ description: 'individual.verification.document', deadline: 'currently_due' }] }
    await cs.handleConnectWebhook('{}', 'good', 'whsec', typed(REQ, async () => NEEDS_DOC, reqP.stripeAccountId!))
    const reqJob = jobs(JOB_CONNECT_RECHECK, reqP.id)
    assert((await row('organizer', reqP.id)).stripeVerified === false && reqJob.length === 1, `${REQ} (ID document due) → gate closes, one re-check job`)
    const rc = await cs.handleConnectRecheck(reqJob[0].data, { getStatus: async () => NEEDS_DOC as any })
    const reqNotice = await prisma.payeeNotice.findFirst({ where: { payeeType: 'organizer', payeeId: reqP.id, kind: 'PAYOUT_NEEDS_ATTENTION' } })
    assert(rc === 'notice' && (reqNotice?.detail as any)?.needs === 'Stripe needs: ID document',
      `${REQ} → needs-attention notice reads "Stripe needs: ID document" (got ${JSON.stringify(reqNotice?.detail ?? null)})`)
    // Positive control for the ignore checks below: the read counter moves for a handled type.
    const r0 = retrieves
    await cs.handleConnectWebhook('{}', 'good', 'whsec', typed(REQ, async () => READY, acct))
    assert(retrieves === r0 + 1, 'control: a handled type reads the event (counter moves)')
    const IGNORED = [
      'v2.core.account.created', 'v2.core.account.updated', 'v2.core.account[identity].updated',
      'v2.core.account[defaults].updated', 'v2.core.account_person.created', 'v2.core.account_person.updated',
      'v2.core.event_destination.ping',
    ]
    for (const type of IGNORED) {
      const before = retrieves
      const r = await cs.handleConnectWebhook('{}', 'good', 'whsec', typed(type, async () => { throw new Error('must not read') }, acct))
      assert(r.status === 200 && retrieves === before, `${type} → 200, ignored, nothing read`)
    }
    assert(cs.HANDLED_CONNECT_EVENTS.has(CAP) && cs.HANDLED_CONNECT_EVENTS.has(REQ) && cs.HANDLED_CONNECT_EVENTS.size === 3,
      'handled set = capability_status_updated + requirements.updated + configuration.recipient.updated')

    console.log('[6] money gate — real runner executor')
    const { processRunnerPayout } = await import('../lib/runner-payout')
    await prisma.fulfillmentConfig.create({ data: { eventId: ev.id, homeDeliveryEnabled: true, homeDeliveryFee: 10, runnerFeePercent: 50 } })
    const gr = await mkPayee('runner', true)
    const ven = await mkPayee('vendor')
    const cust = await prisma.user.create({ data: { clerkId: `${SLUG}cu-${rand()}`, email: `${SLUG}cu-${rand()}${MAIL}`, name: 'C', role: 'customer' } })
    const order = await prisma.order.create({ data: {
      eventId: ev.id, customerId: cust.id, vendorId: ven.id, status: 'READY', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: 10, tip: 3, total: 29.5, vendorPayout: 15,
      customerName: 'C', customerPhone: '+10000000000', runnerId: gr.id, deliveryProofPath: 'https://cs14.local/p.jpg', stripeChargeId: `ch_${SLUG}${rand()}`,
    } })
    await prisma.vendorOrderStatus.create({ data: { orderId: order.id, vendorId: ven.id, status: 'READY' } })
    const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
    const rm = await reconcileMasterStatus(order.id)
    await prisma.runnerEarning.update({ where: { orderId: order.id }, data: { createdAt: new Date(Date.now() - 5 * 3_600_000) } })
    assert(rm.to === 'DELIVERED', 'seed: delivered through the real accrual path')
    await cs.applyConnectStatus('runner', gr.id, false, { source: 'webhook' })
    const t0 = transfers.length
    const held = await processRunnerPayout(order.id)
    assert(held.outcome === 'held' && transfers.length === t0, `gate closed → executor holds, 0 transfers (got ${held.outcome})`)
    await cs.applyConnectStatus('runner', gr.id, true, { source: 'webhook' })
    const paid = await processRunnerPayout(order.id)
    assert(paid.outcome === 'paid' && transfers.length === t0 + 1 && transfers[transfers.length - 1].amount === 800,
      `gate reopened → pays exactly once, 800¢ (got ${paid.outcome}, ${transfers.length - t0} transfers)`)
  } finally {
    __setOrderQueueForTest(null)
    await cleanup()
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} connect-status: ${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async err => { console.error('[connect-status-test] FAILED:', err); try { await cleanup() } catch {} ; process.exit(2) })
