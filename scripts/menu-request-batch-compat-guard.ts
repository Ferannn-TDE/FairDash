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

import { readFileSync } from 'node:fs'
// THE SHIPPED DEFINITION, imported — not a copy. This guard previously declared its own
// `groupKey` because the helper did not exist yet; asserting a rule against a private
// re-statement of that rule proves only that the copy agrees with itself.
import { batchGroupKey, groupIntoBatches } from '../lib/menu-requests/group-by-batch'

const prisma = testPrisma()

const PFX = 'mrbc-'
const MAIL = '@mrbc.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** Group count, via the SHIPPED helper. */
function groupCount(rows: { id: string; batchId: string | null }[]): number {
  return groupIntoBatches(rows).length
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

  // ── [5] THE SHIPPED HELPER'S OWN CONTRACT ──────────────────────────────────────────────
  // [4] uses the helper through groupCount, which only sees the COUNT. These assert the shape
  // the organizer page will actually render from.
  console.log('\n[5] the helper reports the shape the page renders')
  const mixed = [
    { id: 'r1', batchId: null },
    { id: 'r2', batchId: sharedId },
    { id: 'r3', batchId: sharedId },
    { id: 'r4', batchId: null },
  ]
  const groups = groupIntoBatches(mixed)
  assert(groups.length === 3, 'mixed list → 3 groups')
  assert(groups[0].isBatch === false && groups[0].batchId === null && groups[0].rows.length === 1,
    'a standalone row is a 1-row group, isBatch false, batchId null (renders with no wrapper)')
  assert(groups[1].isBatch === true && groups[1].batchId === sharedId && groups[1].rows.length === 2,
    'the batch is one group of 2 with its id (renders one wrapper)')
  assert(groups.map(g => g.rows[0].id).join(',') === 'r1,r2,r4',
    'groups appear in first-appearance order — FIFO reading order survives grouping')
  assert(groups[1].rows.map(r => r.id).join(',') === 'r2,r3',
    'rows keep their relative order inside a group')

  // A batch split across a pagination boundary still lands in ONE group.
  const straddled = groupIntoBatches([
    { id: 's1', batchId: sharedId },
    { id: 's2', batchId: null },
    { id: 's3', batchId: sharedId },
  ])
  assert(straddled.length === 2 && straddled[0].rows.length === 2,
    'non-adjacent rows of one batch still group together (a batch may straddle a page)')

  // The side door `?? ` alone would leave open.
  const blankIds = groupIntoBatches([
    { id: 'b1', batchId: '' },
    { id: 'b2', batchId: '   ' },
  ])
  assert(blankIds.length === 2 && blankIds.every(g => g.batchId === null),
    'empty / whitespace batchId is treated as STANDALONE, not grouped together')
  assert(batchGroupKey({ id: 'z', batchId: null }) === 'solo:z',
    'batchGroupKey exposes the same rule for single-row keying')

  // ── [6] ISOMORPHIC — the helper is safe for the client bundle ───────────────────────────
  // The organizer page (a client component) imports this module, so any import reachable from
  // it lands in the browser bundle. A server-only import would break that consumer at page
  // load without failing one assertion above — the client-bundler gate hole, exactly.
  console.log('\n[6] the helper imports nothing (safe in a client bundle)')
  const helperSrc = readFileSync('lib/menu-requests/group-by-batch.ts', 'utf8')
  const IMPORT = /^\s*import\s/m
  assert(IMPORT.test("import { db } from '@/lib/db'"),
    '[0] positive control: the scanner DOES detect an import statement')
  assert(!IMPORT.test('export function batchGroupKey(row: BatchGroupable): string {'),
    '[0] baseline: the scanner does NOT fire on an ordinary export')
  assert(!IMPORT.test(helperSrc),
    'group-by-batch.ts has ZERO imports — nothing server-only can ride into the client bundle')

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
