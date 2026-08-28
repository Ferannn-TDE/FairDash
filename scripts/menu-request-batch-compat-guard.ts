/**
 * MENU-REQUEST BATCH COMPAT GUARD — a legacy (batchId = NULL) request must keep working
 * exactly as it did before the column existed.
 *
 * WHAT THIS PROTECTS. Adding `batchId` cannot change anything for the ~all rows that already
 * exist, and the failure mode is not in the data — it is in whatever reads it. A naive
 * `groupBy(batchId)` collapses EVERY legacy request in a fair into one giant "null batch",
 * which is the single most visible regression this feature can produce. So the rule is stated
 * once, here and in the grouping helper: NULL means STANDALONE, never a group.
 *
 * This guard runs at the MIGRATION step, before any grouping code exists, and asserts the
 * properties that step must not have broken:
 *   [1] the column exists, is nullable, has no default, and is indexed
 *   [2] every pre-existing row reads back with batchId = null
 *   [3] a null-batch row still approves through the ordinary per-row path
 *   [4] null rows do NOT collapse when grouped by the rule the helper will use
 *
 * [4] carries the positive control the repo's test-probe rule demands: it first proves that
 * two rows sharing a batchId DO group, so "these two didn't group" means the rule discriminates
 * rather than that the grouper is inert.
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/menu-request-batch-compat-guard.ts
 * Self-cleaning, prefix mrbc-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })

const prisma = testPrisma()

const PFX = 'mrbc-'
const MAIL = '@mrbc.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/**
 * The grouping RULE, written here exactly as lib/menu-requests/group-by-batch.ts will define
 * it. Duplicated deliberately and only until that helper exists (next step), at which point
 * this guard imports it instead — a rule asserted against a private copy of itself proves
 * nothing. Tracked as the one intentional duplication in this arc.
 */
const groupKey = (r: { id: string; batchId: string | null }) => r.batchId ?? `solo:${r.id}`

function groupCount(rows: { id: string; batchId: string | null }[]): number {
  return new Set(rows.map(groupKey)).size
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vs.map(v => v.id) } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vs.map(v => v.id) } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vs.map(v => v.id) } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()

  const event = await prisma.event.create({
    data: {
      name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE',
      startDate: new Date(), endDate: new Date(Date.now() + 864e5),
    },
  })
  const vendor = await prisma.vendor.create({
    data: { eventId: event.id, name: `${PFX}booth`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' },
  })
  const user = await prisma.user.create({
    data: { clerkId: `${PFX}u-${rand()}`, email: `${PFX}u-${rand()}${MAIL}`, name: 'Booth Owner', role: 'vendor' },
  })

  // ── [1] COLUMN SHAPE ───────────────────────────────────────────────────────────────────
  // Read from the catalog, not from the schema file: the question is what the DATABASE got.
  console.log('\n[1] the column landed nullable, defaultless, and indexed')
  const cols = await prisma.$queryRawUnsafe<{ column_name: string; is_nullable: string; column_default: string | null }[]>(
    `SELECT column_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = 'MenuRequest' AND column_name = 'batchId'`,
  )
  assert(cols.length === 1, 'MenuRequest.batchId exists')
  assert(cols[0]?.is_nullable === 'YES', 'batchId is NULLABLE (null = standalone must be representable)')
  assert(cols[0]?.column_default === null,
    'batchId has NO DEFAULT — nothing silently joins a batch (contrast the VendorMember grandfather)')

  const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'MenuRequest' AND indexdef LIKE '%batchId%'`,
  )
  assert(idx.length >= 1, `batchId is indexed (${idx.map(i => i.indexname).join(', ') || 'NONE'})`)

  // ── [2] LEGACY ROWS READ BACK NULL ─────────────────────────────────────────────────────
  // A row written WITHOUT mentioning batchId — i.e. exactly what every deployed caller does
  // today, and what every pre-existing row is.
  console.log('\n[2] a request written the old way is null-batched')
  const legacy = await prisma.menuRequest.create({
    data: {
      vendorId: vendor.id, requestedBy: user.id, type: 'ADD', status: 'PENDING',
      name: `${PFX}legacy item`, price: 9.5, category: 'Mains',
    },
  })
  assert(legacy.batchId === null, 'a request created without batchId reads back null')

  // ── [3] A LEGACY ROW STILL APPROVES ────────────────────────────────────────────────────
  // The per-row approval path, verbatim: mint the MenuItem, flip the request. If adding the
  // column had disturbed this, batching would be built on a broken floor.
  console.log('\n[3] a null-batch request still approves through the per-row path')
  const minted = await prisma.menuItem.create({
    data: {
      vendorId: vendor.id,
      name: legacy.name!, price: legacy.price!, category: legacy.category!,
      prepTime: legacy.prepTime ?? 15, isAvailable: true,
    },
  })
  const approved = await prisma.menuRequest.update({
    where: { id: legacy.id },
    data: { status: 'APPROVED', reviewedBy: user.id, reviewedAt: new Date() },
  })
  assert(approved.status === 'APPROVED', 'the legacy request flips to APPROVED')
  assert(approved.batchId === null, 'approving does not invent a batch')
  assert(minted.name === legacy.name, 'the MenuItem is minted from the request unchanged')

  // ── [4] NULL ROWS DO NOT COLLAPSE ──────────────────────────────────────────────────────
  console.log('\n[4] grouping: null = standalone, never one big null-batch')

  // [0] POSITIVE CONTROL FIRST. If the rule cannot group rows that SHOULD group, then "the
  // null rows did not group" is meaningless — an inert grouper passes that test for free.
  const sharedId = `batch_${rand()}`
  const batched = [
    { id: 'a', batchId: sharedId },
    { id: 'b', batchId: sharedId },
    { id: 'c', batchId: sharedId },
  ]
  assert(groupCount(batched) === 1,
    '[0] positive control: 3 rows sharing a batchId collapse to ONE group (the rule DOES group)')

  const nulls = [
    { id: 'x', batchId: null },
    { id: 'y', batchId: null },
    { id: 'z', batchId: null },
  ]
  assert(groupCount(nulls) === 3,
    '3 null rows stay THREE standalone groups (a raw groupBy would give 1 — the regression)')

  assert(groupCount([...batched, ...nulls]) === 4,
    'mixed: one batch + three standalones = 4 groups')

  // And against real rows, not just literals — several legacy rows in one fair.
  for (let i = 0; i < 3; i++) {
    await prisma.menuRequest.create({
      data: {
        vendorId: vendor.id, requestedBy: user.id, type: 'ADD', status: 'PENDING',
        name: `${PFX}solo-${i}`, price: 1, category: 'Test',
      },
    })
  }
  const realRows = await prisma.menuRequest.findMany({
    where: { vendor: { eventId: event.id } },
    select: { id: true, batchId: true },
  })
  assert(realRows.every(r => r.batchId === null), 'every row in the fixture fair is null-batched')
  assert(groupCount(realRows) === realRows.length,
    `${realRows.length} legacy rows produce ${realRows.length} groups, not 1`)

  console.log(`\n${'─'.repeat(66)}`)
  if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
  else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
  console.log(`${'─'.repeat(66)}\n`)

  await cleanup()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async err => {
  console.error(err)
  await cleanup().catch(() => {})
  process.exit(1)
})
