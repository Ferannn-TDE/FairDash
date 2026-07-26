/**
 * PATTERN X2 — the false referral, and the acknowledged cohort.
 *
 * TWO defects, both proven here against a REAL patternX run (not a mock of it):
 *
 *   1. THE REFERRAL WAS FALSE. X2 said "Pattern S restores the row; not healed here." It is
 *      false for the ENTIRE observable population, by construction: patternS runs EARLIER in
 *      the same sweep, windowed on completedAt >= windowStart (24h) with voidedAt: null. An
 *      in-window order has already been re-accrued by the time X runs, so it cannot still be
 *      an orphan here. Every row X2 reports is one S already declined. The alert told a human
 *      at 2am to wait for a healer that had already walked past — prose drift inside an
 *      operational alert, which is the worst place this codebase has found one.
 *
 *   2. FIVE PERMANENT ALERTS. The cohort is unhealable-by-design and cannot grow (it predates
 *      the VendorEarning model), so it emitted 5 identical lines every 60s forever — a
 *      permanent noise floor on the money channel Job 0 had just made prod-visible.
 *
 * NON-VACUITY is the point of this file. Suppression that suppresses everything would pass a
 * naive "no alerts" test perfectly, so every negative here is paired with a positive:
 *   [0] the probe itself sees an alert when one is due (baseline — else all negatives are free)
 *   [1] the declared cohort is SUPPRESSED, not alerted, and not dropped
 *   [2] POSITIVE CONTROL: same order+vendor, WRONG amount ⇒ ALERTS. Exact-match is load-bearing.
 *   [3] POSITIVE CONTROL: an undeclared orphan ⇒ ALERTS. The set is not a blanket.
 *   [4] the message names a REAL reason and the false referral is gone
 *   [5] static: Pattern S was NOT widened (the recorded decision), and the set is marked TEMPORARY
 *
 * Run:  npx tsx scripts/x2-referral-ack-guard.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import { OrderStatus } from '@prisma/client'
import { patternX, type SweepSummary } from '../lib/reconciler'
import { readFileSync } from 'node:fs'

const prisma = testPrisma()
const SLUG = 'x2ack-', MAIL = '@x2ack.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

// The FIRST declared entry, verbatim from ACKNOWLEDGED_X2. Seeded with these exact ids so the
// test exercises the REAL set rather than a stand-in — if someone edits the const, this breaks.
const ACK = { orderId: 'cmpyb72m800217rj2mw1zro00', vendorId: 'cmni6x68q000211znxtpw0076', cents: 3856 }

function mkSum(): SweepSummary {
  const zero = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, Q: 0, R: 0, S: 0, T: 0, X: 0 }
  return {
    startedAt: '', finishedAt: '', durationMs: 0, dryRun: true, patternEEnabled: false, backstopEnabled: false,
    scanned: { stripePIs: 0, completedOrders: 0, activeOrders: 0, pendingOrders: 0, unresolvedHolds: 0 },
    repaired: { ...zero }, details: { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [], I: [], J: [], K: [], L: [], M: [], N: [], O: [], P: [], Q: [], R: [], S: [], T: [], X: [] },
    alerted: [], suppressed: [], ambiguousSkipped: 0, backstopWarnings: [],
  }
}

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    await prisma.payout.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.vendorEarning.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.vendorOrderStatus.deleteMany({ where: { order: { eventId: { in: ids } } } })
    await prisma.orderItem.deleteMany({ where: { order: { eventId: { in: ids } } } })
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

/** An orphan: a settled, non-reversed Payout with NO VendorEarning row behind it. */
async function seedOrphan(o: {
  eventId: string; vendorId: string; orderId: string; cents: number
  completedAt: Date; voidedAt?: Date; status?: OrderStatus; customerId: string
}) {
  await prisma.order.create({ data: {
    id: o.orderId, eventId: o.eventId, customerId: o.customerId, vendorId: o.vendorId,
    status: o.status ?? OrderStatus.COMPLETED, fulfillmentType: 'BOOTH_PICKUP',
    subtotal: o.cents / 100, fairSynqFee: 0, total: o.cents / 100, vendorPayout: o.cents / 100,
    customerName: 'C', customerPhone: '+10000000000',
    placedAt: o.completedAt, completedAt: o.completedAt, voidedAt: o.voidedAt ?? null,
  } })
  await prisma.payout.create({ data: {
    eventId: o.eventId, orderId: o.orderId, vendorId: o.vendorId,
    grossAmount: o.cents / 100, fairSynqFee: 0, netAmount: o.cents / 100,
    stripeTransferId: `tr_${SLUG}${rand()}`, stripeStatus: 'paid', reversedAt: null,
  } })
}

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: {
      name: `X2ACK ${rand()}`, urlSlug: `${SLUG}${rand()}`,
      startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE',
    } })
    const cust = async () => (await prisma.user.create({ data: {
      clerkId: `${SLUG}${rand()}`, email: `${SLUG}c-${rand()}${MAIL}`, name: 'C', role: 'customer',
    } })).id

    // The acknowledged vendor, created with its REAL id so the declared key matches.
    const vAck = await prisma.vendor.create({ data: {
      id: ACK.vendorId, eventId: ev.id, name: 'ALL PRO TEES (test double)',
      slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE',
    } })
    const vOther = await prisma.vendor.create({ data: {
      eventId: ev.id, name: `Other ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE',
    } })

    const OLD = new Date(Date.now() - 53 * 864e5)   // ~53d — outside S's 24h window, like the real cohort
    const windowStart = new Date(Date.now() - 24 * 3600_000)

    // (a) the declared row, exact on order+vendor+amount
    await seedOrphan({ eventId: ev.id, vendorId: vAck.id, orderId: ACK.orderId, cents: ACK.cents, completedAt: OLD, customerId: await cust() })
    // (b) SAME order+vendor, WRONG amount — must NOT inherit the suppression
    const wrongAmtOrder = `${SLUG}wrong${rand()}`
    await seedOrphan({ eventId: ev.id, vendorId: vAck.id, orderId: wrongAmtOrder, cents: 9999, completedAt: OLD, customerId: await cust() })
    // (c) an undeclared orphan on a different vendor
    const undeclaredOrder = `${SLUG}new${rand()}`
    await seedOrphan({ eventId: ev.id, vendorId: vOther.id, orderId: undeclaredOrder, cents: 4242, completedAt: OLD, customerId: await cust() })
    // (d) a VOIDED undeclared orphan — proves the reason text distinguishes the void case
    const voidedOrder = `${SLUG}void${rand()}`
    await seedOrphan({ eventId: ev.id, vendorId: vOther.id, orderId: voidedOrder, cents: 1990, completedAt: OLD, voidedAt: new Date(Date.now() - 30 * 864e5), status: OrderStatus.PLACED, customerId: await cust() })

    const sum = mkSum()
    await patternX(sum, { scanCeiling: 1000, maxPerPattern: 100, dryRun: true, windowStart })

    const alerts = sum.alerted.filter(a => a.includes('Pattern X2'))
    const supp = sum.suppressed

    console.log('\n[0] baseline — the probe can see an X2 alert at all (else every negative below is free)')
    assert(alerts.length > 0, `patternX produced ${alerts.length} X2 alert line(s) — the probe is live`)

    console.log('\n[1] the declared cohort is SUPPRESSED — and not dropped')
    // SCOPED TO OUR OWN SEEDED ROWS, never a global count. patternX scans EVERY payout in the
    // database, and several other suites (refund/chargeback/reports) leave settled Payout rows
    // with no earning behind them — legitimate orphans that land in this same output. A bare
    // `supp.length === 1` would then pass or fail on which suites ran first, which is a flake
    // wearing an assertion's clothing.
    const mine = supp.filter(s => s.includes(ACK.orderId))
    assert(mine.length === 1, `exactly 1 suppressed line for OUR acknowledged row (got ${mine.length})`)
    assert(!supp.some(s => s.includes(wrongAmtOrder) || s.includes(undeclaredOrder) || s.includes(voidedOrder)),
      'none of our undeclared rows leaked into suppressed[]')
    assert(!alerts.some(a => a.includes(ACK.orderId)), 'the acknowledged order does NOT appear in alerted[]')
    // `?? ''` deliberately: when this suite is used as its own positive control (delete an entry
    // from ACKNOWLEDGED_X2 and re-run) supp is EMPTY, and an index crash would abort the run
    // before [2]–[5] report. A control that takes the suite down proves less than one that fails.
    assert((mine[0] ?? '').includes('$38.56'), 'the suppressed line still carries its amount (suppressed ≠ invisible)')

    console.log('\n[2] POSITIVE CONTROL — same order+vendor, wrong amount, still ALERTS')
    assert(alerts.some(a => a.includes(wrongAmtOrder)),
      'a $99.99 row on the acknowledged vendor ALERTS — exact amount matching is load-bearing')
    assert(!supp.some(s => s.includes(wrongAmtOrder)), 'and it was NOT suppressed')

    console.log('\n[3] POSITIVE CONTROL — an undeclared orphan ALERTS (the set is not a blanket)')
    assert(alerts.some(a => a.includes(undeclaredOrder)), 'a sixth, undeclared orphan is LOUD')
    assert(alerts.some(a => a.includes(voidedOrder)), 'an undeclared VOIDED orphan is LOUD')

    console.log('\n[4] the message states a REAL reason — the false referral is gone')
    const declaredLine = mine[0] ?? ''
    assert(!/Pattern S restores the row/.test([...alerts, ...supp].join(' ')),
      '⛔ no line claims "Pattern S restores the row" (it never could — S runs EARLIER and declined)')
    assert(/outside Pattern S's 24h window/.test(declaredLine),
      `the aged row names the window as the reason (got: ${declaredLine.slice(-90)})`)
    assert(/\b53d ago\b/.test(declaredLine), 'and states the actual age, so the reader can judge it')
    const voidLine = alerts.find(a => a.includes(voidedOrder)) ?? ''
    assert(/VOIDED/.test(voidLine) && /voidedAt:null CORRECTLY/.test(voidLine),
      'the voided row says S filters voidedAt CORRECTLY — a reader must not "fix" that')
    assert(/no window width heals this/.test(voidLine),
      'and states that widening the window would NOT help (pre-empts the wrong fix)')

    console.log('\n[5] static — Pattern S was NOT widened, and the set is declared TEMPORARY')
    const rec = readFileSync('lib/reconciler.ts', 'utf8')
    const sBody = rec.slice(rec.indexOf('async function patternS'), rec.indexOf('PATTERN T —'))
    assert(/completedAt:\s*\{\s*gte:\s*o\.windowStart\s*\}/.test(sBody),
      "patternS STILL windows on completedAt >= windowStart — the recorded decision not to widen it holds")
    assert(/voidedAt:\s*null/.test(sBody), 'patternS STILL excludes voided orders (correct — never re-accrue a struck order)')
    assert(/TEMPORARY/.test(rec) && /OperationalAlert/.test(rec),
      'ACKNOWLEDGED_X2 is marked TEMPORARY and names OperationalAlert as its real home')
    assert(/ACKNOWLEDGED_X2/.test(rec) && (rec.match(/orderId: '/g) ?? []).length >= 5,
      'the set declares all five rows explicitly (named set, not a count)')
    assert(/suppressed=\$\{sum\.suppressed\.length\}/.test(rec),
      'the summary line carries suppressed=N — one count line, not five alert lines')

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `✅ x2-referral-ack-guard: ${pass} passed, 0 failed` : `❌ x2-referral-ack-guard: ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1) })
