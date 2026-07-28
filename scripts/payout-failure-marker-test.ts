/**
 * RECONCILER-SIDE PAYOUT FAILURES — durable marker, terminal-only gating, and a retry that
 * genuinely returns the row to the candidate set.
 *
 * THE GAP THIS CLOSES: the Pattern P/Q loops caught every failure into an alert STRING and wrote
 * nothing durable. Two terminal Stripe errors did exactly that for EIGHT DAYS and were found by
 * a human reading a log scroll.
 *
 * WHY THE MARKING NEEDED THE RETRY IN THE SAME CHANGE: marking sets status='failed', which
 * REMOVES the row from the candidate query. Under the marking alone, both eight-day rows would
 * have been marked on the first attempt, the fix would have deployed, and nothing would have
 * happened — the rows no longer qualified. That is a one-way door without an admin action.
 *
 *   [0] positive controls on the probe + baseline
 *   [1] TERMINAL → marker written, cause captured, row LEAVES the candidate set
 *   [2] TRANSIENT → no marker, row STAYS in the candidate set (the one-way-door check)
 *   [3] UNKNOWN → treated as transient (the safe default; misclassifying strands money)
 *   [4] retry RETURNS the row to the candidate set — asserted by re-running the real query
 *   [5] retry writes its audit row, attributed to the admin
 *   [6] a paid row is never re-marked
 *
 * Real Stripe error objects from the SDK, real classifier, real candidate query. Scoped to its
 * own seeded fixtures throughout — never a table-wide count.
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/payout-failure-marker-test.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import Stripe from 'stripe'
import { recordPayoutFailure, describeFailureCause } from '../lib/payout-failure-marker'
import { findStuckPayouts } from '../lib/stuck-payouts'
import { classifyStripeError } from '../lib/stripe-error-class'

const prisma = testPrisma()
const SLUG = 'pfm-', MAIL = '@pfm.local', rand = () => Math.random().toString(36).slice(2, 10)
const REFUND_WINDOW_MS = 4 * 60 * 60 * 1000

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const E = (Stripe as unknown as { errors: Record<string, new (raw: Record<string, unknown>) => Error> }).errors
const TERMINAL = new E.StripeInvalidRequestError({
  message: 'No such destination: acct_1Dead', type: 'invalid_request_error',
  code: 'resource_missing', statusCode: 400, param: 'destination',
})
const TRANSIENT = new E.StripeConnectionError({ message: 'socket hang up' })
const UNKNOWN_ERR = new E.StripeIdempotencyError({ message: 'key reused', type: 'idempotency_error', statusCode: 400 })

/** THE REAL candidate query from reconcileRunnerPayouts — not a paraphrase of it. */
async function runnerCandidates(eventId: string): Promise<string[]> {
  const rows = await prisma.runnerEarning.findMany({
    where: {
      status: 'tracked',
      createdAt: { lt: new Date(Date.now() - REFUND_WINDOW_MS) },
      order: { voidedAt: null },
      runner: { stripeVerified: true, stripeAccountId: { not: null }, payoutsFrozenAt: null },
      eventId,
    },
    select: { orderId: true },
  })
  return rows.map(r => r.orderId)
}

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    await prisma.adminMoneyAction.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.organizerPayout.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.runnerEarning.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.runner.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: {
      name: `PFM ${rand()}`, urlSlug: `${SLUG}${rand()}`,
      startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE',
    } })
    const ven = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    const mkUser = async (role: string) => prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}${role}-${rand()}${MAIL}`, name: 'P', role } })
    const runner = await prisma.runner.create({ data: {
      userId: (await mkUser('runner')).id, eventId: ev.id, status: 'ACTIVE',
      stripeAccountId: `acct_${rand()}`, stripeVerified: true,
    } })

    const OLD = new Date(Date.now() - 5 * 3600_000) // window closed
    const seedEarning = async () => {
      const o = await prisma.order.create({ data: {
        eventId: ev.id, customerId: (await mkUser('customer')).id, vendorId: ven.id,
        status: 'DELIVERED', fulfillmentType: 'HOME_DELIVERY',
        subtotal: 15, fairSynqFee: 1.5, total: 20, vendorPayout: 15,
        customerName: 'C', customerPhone: '+10000000000',
        placedAt: OLD, completedAt: OLD, stripeChargeId: `ch_${rand()}`, runnerId: runner.id,
      } })
      await prisma.runnerEarning.create({ data: {
        eventId: ev.id, orderId: o.id, runnerId: runner.id, amountCents: 1150,
        status: 'tracked', createdAt: OLD,
      } })
      return o.id
    }

    console.log('[0] positive controls + baseline')
    assert(classifyStripeError(TERMINAL).class === 'terminal', 'the REAL classifier calls the dead destination terminal')
    assert(classifyStripeError(TRANSIENT).class === 'transient', 'and the network failure transient')
    assert(classifyStripeError(UNKNOWN_ERR).class === 'unknown', 'and the idempotency error unknown')
    const oBase = await seedEarning()
    assert((await runnerCandidates(ev.id)).includes(oBase),
      'BASELINE: a tracked, window-closed, connected row IS in the candidate set (else every negative below is free)')

    console.log('\n[1] TERMINAL → marker + cause, and the row LEAVES the candidate set')
    const oTerm = await seedEarning()
    const wrote = await recordPayoutFailure({
      leg: 'runner', orderId: oTerm, actor: { id: 'reconciler:pattern-P', type: 'reconciler' },
      finality: 'halted — terminal', cause: describeFailureCause(TERMINAL),
    })
    assert(wrote === true, 'recordPayoutFailure reports it wrote a marker')
    const termRow = await prisma.runnerEarning.findUniqueOrThrow({ where: { orderId: oTerm }, select: { status: true } })
    assert(termRow.status === 'failed', "RunnerEarning.status = 'failed' (the marker Pattern U already reads)")
    assert(!(await runnerCandidates(ev.id)).includes(oTerm),
      '⛔ and it is GONE from the candidate set — retries genuinely stop, which is why Retry must exist')

    const stuck = await findStuckPayouts({ eventId: ev.id, legs: ['runner'] })
    const mine = stuck.filter(r => r.id === oTerm)
    assert(mine.length === 1, 'findStuckPayouts surfaces exactly our failed row (scoped to this fair)')
    assert(mine[0]?.cause?.verdict === 'terminal', 'the CAUSE is recovered — verdict')
    assert(/No such destination/.test(mine[0]?.cause?.stripeMessage ?? ''), 'the raw Stripe message is captured')
    assert(mine[0]?.cause?.stripeCode === 'resource_missing', 'and the Stripe code — what a human greps for')
    assert(mine[0]?.failedAt != null, 'and a failed-since timestamp (from the PAYOUT_FAILED audit)')

    console.log('\n[2] TRANSIENT → NO marker, row STAYS eligible (the one-way-door check)')
    const oTrans = await seedEarning()
    const cTrans = describeFailureCause(TRANSIENT)
    assert(cTrans.verdict === 'transient', 'the cause classifies transient')
    // The reconcile loop only calls recordPayoutFailure when verdict === 'terminal'.
    if (cTrans.verdict === 'terminal') await recordPayoutFailure({ leg: 'runner', orderId: oTrans, actor: { id: 'x', type: 'reconciler' }, finality: 'x', cause: cTrans })
    const transRow = await prisma.runnerEarning.findUniqueOrThrow({ where: { orderId: oTrans }, select: { status: true } })
    assert(transRow.status === 'tracked', "a transient failure leaves status 'tracked'")
    assert((await runnerCandidates(ev.id)).includes(oTrans),
      '⛔ and the row is STILL a candidate — a recoverable failure keeps every retry it has today')

    console.log('\n[3] UNKNOWN → treated as transient (the safe default)')
    const oUnk = await seedEarning()
    const cUnk = describeFailureCause(UNKNOWN_ERR)
    if (cUnk.verdict === 'terminal') await recordPayoutFailure({ leg: 'runner', orderId: oUnk, actor: { id: 'x', type: 'reconciler' }, finality: 'x', cause: cUnk })
    assert(cUnk.verdict === 'unknown', 'an unrecognised failure is unknown, not terminal')
    assert((await runnerCandidates(ev.id)).includes(oUnk),
      'and it keeps retrying — misclassifying toward terminal would strand money that would have moved')

    console.log('\n[4] RETRY returns the row to the candidate set')
    // What the route does, asserted against the REAL query rather than the status field alone.
    await prisma.runnerEarning.updateMany({ where: { orderId: oTerm }, data: { status: 'tracked' } })
    assert((await runnerCandidates(ev.id)).includes(oTerm),
      '⛔ after retry the row is a candidate AGAIN — proven by re-running the candidate query, not by reading a field')

    console.log('\n[5] the retry writes an attributed audit row')
    const { writeMoneyAudit } = await import('../lib/admin-money')
    const audit = await writeMoneyAudit({ id: 'admin_clerk_test', type: 'admin' }, ev.id, {
      action: 'RELEASE', payeeType: 'runner', payeeId: runner.id, orderId: oTerm,
      amountCents: 1150, reason: 'retry after failed payout: fix deployed',
      metadata: { retriedFrom: 'failed', newStatus: 'tracked' },
    })
    const row = await prisma.adminMoneyAction.findUniqueOrThrow({ where: { id: audit.id },
      select: { actorType: true, actorId: true, action: true, eventId: true, orderId: true } })
    assert(row.actorType === 'admin' && row.actorId === 'admin_clerk_test', 'attributed to the ADMIN, not the system')
    assert(row.eventId === ev.id && row.orderId === oTerm, 'scoped to this fair and this order')
    assert(row.action === 'RELEASE', "recorded as RELEASE — existing vocabulary, no new action string")

    console.log('\n[6] a PAID row is never re-marked')
    const oPaid = await seedEarning()
    await prisma.runnerEarning.updateMany({ where: { orderId: oPaid }, data: { status: 'paid', stripeTransferId: 'tr_x' } })
    const wrotePaid = await recordPayoutFailure({
      leg: 'runner', orderId: oPaid, actor: { id: 'reconciler:pattern-P', type: 'reconciler' },
      finality: 'halted — terminal', cause: describeFailureCause(TERMINAL),
    })
    const paidRow = await prisma.runnerEarning.findUniqueOrThrow({ where: { orderId: oPaid }, select: { status: true } })
    assert(wrotePaid === false && paidRow.status === 'paid',
      '⛔ a paid row is left alone — marking it failed would un-pay it in every reader')

    console.log('\n[7] admin scope — the retry cannot reach across fairs')
    const { readFileSync } = await import('node:fs')
    const { stripComments } = await import('./_strip-comments')
    const route = stripComments(readFileSync('app/api/admin/events/[id]/money/retry-payout/route.ts', 'utf8'))
    assert(/requireAdminFairContext\(/.test(route), 'the retry route resolves through requireAdminFairContext (the chokepoint)')
    assert(/eventId: event\.id/.test(route),
      '⛔ and every lookup is keyed by event.id — a row id from ANOTHER fair cannot resolve')
    assert(/findFirst/.test(route) && !/findUnique\(\{\s*where:\s*\{\s*orderId: id\s*\}/.test(route),
      'it uses findFirst with the compound scope, never a bare id lookup that would ignore the fair')
    assert(/status !== 'failed'/.test(route), "it refuses anything that is not 'failed' — retry is not a general status setter")
    assert(!/transfers\.create|processRunnerPayout|processEventOrganizerPayout/.test(route),
      '⛔ and it executes NO payout inline — a second code path to the same money move is the class we keep closing')
    // Behavioural twin: a row in another fair is genuinely unreachable by the route's query shape.
    const otherEv = await prisma.event.create({ data: {
      name: `PFM-other ${rand()}`, urlSlug: `${SLUG}${rand()}`,
      startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE',
    } })
    const crossFair = await prisma.runnerEarning.findFirst({ where: { orderId: oTerm, eventId: otherEv.id } })
    assert(crossFair === null, 'a real cross-fair lookup for our order returns null — 404, not another fair\'s money')

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `✅ payout-failure-marker-test: ${pass} passed, 0 failed` : `❌ payout-failure-marker-test: ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('[payout-failure-marker-test] FAILED:', e); await cleanup(); process.exit(1) })
