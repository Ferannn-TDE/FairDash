/**
 * Step 1 companion — quantify the dry-run's zeros and enumerate the ungated
 * patterns' blast radius with payee + amount. READ-ONLY.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

// Read-only, but it names a PROTECTED event id — so it goes through guardedPrisma like every
// other script that touches Italian Fest. Reads pass freely; a stray write would throw.
import { guardedPrisma } from '../lib/prod-write-guard'

const db = guardedPrisma()
const WINDOW_H = 24
const now = Date.now()
const windowStart = new Date(now - WINDOW_H * 3600_000)

async function main() {
  console.log(`window: ${windowStart.toISOString()} → now (${WINDOW_H}h)\n`)

  // ── What the 24h lookback excludes (bears on windowed patterns C and S) ────
  const completeIn = await db.order.count({
    where: { voidedAt: null, status: { in: ['COMPLETED', 'DELIVERED'] }, completedAt: { gte: windowStart } },
  })
  const completeAll = await db.order.count({
    where: { voidedAt: null, status: { in: ['COMPLETED', 'DELIVERED'] } },
  })
  console.log(`COMPLETED/DELIVERED non-voided orders:`)
  console.log(`  inside 24h window : ${completeIn}`)
  console.log(`  total (all time)  : ${completeAll}`)
  console.log(`  EXCLUDED by window: ${completeAll - completeIn}`)

  const newestComplete = await db.order.findFirst({
    where: { voidedAt: null, status: { in: ['COMPLETED', 'DELIVERED'] } },
    orderBy: { completedAt: 'desc' },
    select: { id: true, completedAt: true },
  })
  console.log(`  newest completedAt: ${newestComplete?.completedAt?.toISOString() ?? 'null'}`)

  // ── Pattern Q candidate: organizer batch payout ────────────────────────────
  const QEVENT = 'cmni6x63n000011znjwlln5k2'
  const ev = await db.event.findUnique({
    where: { id: QEVENT },
    select: { id: true, name: true, urlSlug: true, status: true, organizerId: true },
  })
  console.log(`\n── Pattern Q candidate event ──`)
  console.log(`  ${ev?.id}  "${ev?.name}"  slug=${ev?.urlSlug}  status=${ev?.status}`)
  console.log(`  organizerId=${ev?.organizerId}`)

  if (ev?.organizerId) {
    const org = await db.user.findUnique({ where: { id: ev.organizerId }, select: { email: true, name: true } })
    console.log(`  organizer: ${org?.name ?? '(no name)'} <${org?.email}>`)
  }

  const earnings = await db.organizerEarning.groupBy({
    by: ['status'],
    where: { eventId: QEVENT },
    _sum: { amountCents: true },
    _count: { _all: true },
  })
  console.log(`  OrganizerEarning rows for this event, by status:`)
  for (const e of earnings) {
    console.log(`    ${e.status.padEnd(12)} n=${e._count._all}  $${((e._sum.amountCents ?? 0) / 100).toFixed(2)}`)
  }

  const payouts = await db.organizerPayout.findMany({
    where: { eventId: QEVENT },
    select: { id: true, status: true, totalCents: true, paidAt: true, stripeTransferId: true },
  })
  console.log(`  OrganizerPayout anchor rows: ${payouts.length}`)
  for (const p of payouts) {
    console.log(`    ${p.id} ${p.status} $${(p.totalCents / 100).toFixed(2)} transfer=${p.stripeTransferId ?? "none"} paidAt=${p.paidAt?.toISOString() ?? "null"}`)
  }

  // ── The other ungated patterns' universes (all UNWINDOWED) ────────────────
  console.log(`\n── Ungated-pattern universes (D/P/Q/R are unwindowed; C/S are 24h-windowed) ──`)

  const heldVE = await db.vendorEarning.count({ where: { status: 'held' } })
  console.log(`  D  held VendorEarning rows (all time)        : ${heldVE}`)

  const trackedRE = await db.runnerEarning.count({ where: { status: 'tracked' } })
  console.log(`  P  tracked RunnerEarning rows (all time)     : ${trackedRE}`)

  const accruedOE = await db.organizerEarning.count({ where: { status: 'accrued' } })
  console.log(`  Q  accrued OrganizerEarning rows (all time)  : ${accruedOE}`)

  const tipOwed = await db.order.count({
    where: { voidedAt: null, status: 'CANCELLED', tip: { gt: 0 }, tipRefundedAt: null },
  })
  console.log(`  R  CANCELLED orders w/ tip, unrefunded       : ${tipOwed}`)

  await db.$disconnect()
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
