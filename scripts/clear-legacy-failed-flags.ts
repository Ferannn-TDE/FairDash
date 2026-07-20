/** Clear 5 stale payoutStatus=FAILED flags on LEGACY orders — remediation receipt.
 *
 *  All 5 were created 2026-05-19..06-03, WEEKS before the VendorEarning model began
 *  (earliest earning 2026-07-11) → 0 VendorEarning rows each. They are NOT current-model
 *  payout obligations, so the modern executor never acts on them — yet Pattern U (which
 *  reads Order.payoutStatus='FAILED') would read them as "stuck money" on every sweep,
 *  forever. Reclassify FAILED → null = "no current-model payout status" (honest: it's true).
 *
 *  FLAG-ONLY: touches ONLY Order.payoutStatus on these 5 ids. No money fields, no deletes,
 *  no change to any Payout / VendorEarning / VendorOrderStatus row — those stay as the
 *  durable audit trail. `null` (not COMPLETED) is deliberate: cmpyb72m8's 2 legacy Payout
 *  transfers are stripeStatus='pending' (created, never confirmed) — claiming COMPLETED would
 *  assert more than the evidence supports.
 *
 *  BOOKS STAY OPEN — this does NOT resolve anything, it only stops a false "stuck" alert:
 *   • 4 May orders (cmpd35he/cmpej30l/cmpk4m75/cmpn3z75): never paid, no ledger entry in
 *     either model. $135.78 total — owed, or paid out-of-band? UNRESOLVED (tracked in memory).
 *   • cmpyb72m8 (Jun-3): 2 legacy Payout rows (transfers created, pending, not reversed) —
 *     preserved untouched.
 *
 *  Idempotent: re-run reclassifies 0 rows. Deliberate, reviewed prod op (Italian Fest is a
 *  PROTECTED event; this update is BY ID and carries no eventId, so it is a receipt, not a
 *  test write). Precedent: scripts/pattern-t-finish.ts.
 */
import { config } from 'dotenv'; config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

const IDS = [
  'cmpd35hed0004l616ot3xa42v',
  'cmpej30lf00025pmkfkwpkeyt',
  'cmpk4m75a000e1hkxoafg4fpa',
  'cmpn3z7500002p6p5pm9twm6b',
  'cmpyb72m800217rj2mw1zro00',
]

async function snapshot() {
  return p.order.findMany({
    where: { id: { in: IDS } },
    select: { id: true, payoutStatus: true, vendorPayout: true, eventId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
}

async function main() {
  const before = await snapshot()
  console.log('── BEFORE ──')
  before.forEach(o =>
    console.log(`  ${o.id}  ${o.createdAt.toISOString().slice(0, 10)}  payoutStatus=${o.payoutStatus}  vendorPayout=${o.vendorPayout}  event=${o.eventId}`),
  )

  const wereFailed = before.filter(o => o.payoutStatus === 'FAILED').length
  console.log(`\n${wereFailed} of ${IDS.length} currently FAILED (baseline; expected 5).`)

  const res = await p.order.updateMany({
    where: { id: { in: IDS }, payoutStatus: 'FAILED' },
    data: { payoutStatus: null },
  })
  console.log(`Reclassified ${res.count} FAILED → null (flag-only, no money fields).`)

  const after = await snapshot()
  console.log('\n── AFTER ──')
  after.forEach(o => console.log(`  ${o.id}  payoutStatus=${o.payoutStatus}`))

  const stillFailed = after.filter(o => o.payoutStatus === 'FAILED').length
  const ok = wereFailed === 5 && stillFailed === 0
  console.log(`\n── POSITIVE CONTROL ──`)
  console.log(`  FAILED before          = ${wereFailed}  (expected 5)  ${wereFailed === 5 ? '✅' : '❌'}`)
  console.log(`  reclassified this run  = ${res.count}`)
  console.log(`  FAILED after           = ${stillFailed}  (expected 0)  ${stillFailed === 0 ? '✅' : '❌'}`)
  console.log(`\n  OPEN (unresolved by this change): $135.78 across the 4 never-paid legacy orders — owed, or paid out-of-band?`)
  console.log(ok
    ? '\n✅ Pattern U will now read 0 stuck vendor payouts. Rows, Payouts, and the obligation are all untouched.'
    : '\n❌ investigate — did not reach the expected end state.')
}
main().catch(e => { console.error('💥', e); process.exit(1) }).finally(() => p.$disconnect())
