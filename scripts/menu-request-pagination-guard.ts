/**
 * MENU-REQUEST PAGINATION GUARD — the cursor walk must not skip or duplicate a row when
 * several rows share a createdAt.
 *
 * THE BUG THIS LOCKS. The organizer menu-request list is cursor-paginated over
 * `orderBy: { createdAt: 'asc' }`. Prisma implements a cursor as a WHERE on the orderBy VALUES
 * ("createdAt >= the cursor row's createdAt") plus `skip: 1` — which is exact only while those
 * values are UNIQUE. They are not: rows written in one transaction all take that transaction's
 * timestamp, so a batched menu submission produces N rows with an IDENTICAL createdAt. Every
 * tied row then satisfies the cursor predicate regardless of its position, so page 2 hands back
 * rows page 1 already returned and the tail drops off the end.
 *
 * Latent today (single inserts rarely tie) and routine the moment batching lands, which is why
 * the tiebreak ships FIRST and alone.
 *
 * WHY THE [0] CONTROL IS THE POINT. This suite is a NEGATIVE assertion ("no duplicates, no
 * missing"), and a negative passes for free if the scenario never reproduces the fault. So the
 * control runs the SAME walk against the OLD single-key sort and requires it to FAIL. If the
 * control ever goes green, the fixture stopped tying createdAt and every result below is
 * vacuous — the suite says so and exits non-zero. (scripts/test-probe-positive-control rule.)
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/menu-request-pagination-guard.ts
 * Self-cleaning, prefix mrpg-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })

const prisma = testPrisma()

const PFX = 'mrpg-'
const MAIL = '@mrpg.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** How many rows share one createdAt — i.e. the size of a batched submission. */
const TIED_ROWS = 8
/** Page size chosen to land the boundary INSIDE the tied block (5 of 8), where the fault lives. */
const PAGE = 5

type SortShape = 'single-key' | 'tiebreak'

/**
 * Walk the list with the cursor exactly as the route does, under one of the two sort shapes.
 * Returns the ids in the order the walk produced them, pages concatenated.
 *
 * `afterFirstPage` runs between page 1 and page 2 — this is where the fault is actually
 * provoked. Prisma compiles a cursor into `createdAt >= (the cursor row's createdAt)` and then
 * slices relative to the cursor's position WITHIN that result (verified against the emitted
 * SQL), so a single uninterrupted walk is self-consistent even with ties. The order of tied
 * rows is unspecified, though, and Postgres will hand them back differently once the heap
 * changes — which an UPDATE does, because MVCC writes a new row version at the tail. Approving
 * a request IS an update, and approving while paging through a queue is the normal way an
 * organizer uses this screen. That is the real bug, and the hook is how the guard reproduces it.
 */
async function paginate(
  eventId: string,
  shape: SortShape,
  afterFirstPage?: () => Promise<void>,
): Promise<string[]> {
  const orderBy = shape === 'tiebreak'
    ? [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
    : [{ createdAt: 'asc' as const }]

  const seen: string[] = []
  let cursor: string | undefined
  // Bounded: enough passes to cover the fixture several times over, so a walk that fails to
  // terminate is reported as a bug rather than hanging the suite.
  for (let page = 0; page < 10; page++) {
    const rows = await prisma.menuRequest.findMany({
      where: { vendor: { eventId } },
      orderBy,
      take: PAGE,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      select: { id: true },
    })
    if (rows.length === 0) break
    seen.push(...rows.map(r => r.id))
    if (page === 0 && afterFirstPage) await afterFirstPage()
    if (rows.length < PAGE) break
    cursor = rows[rows.length - 1].id
  }
  return seen
}

function analyse(walked: string[], expected: string[]) {
  const counts = new Map<string, number>()
  for (const id of walked) counts.set(id, (counts.get(id) ?? 0) + 1)
  const duplicated = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id)
  const missing = expected.filter(id => !counts.has(id))
  return { duplicated, missing, clean: duplicated.length === 0 && missing.length === 0 }
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vs.map(v => v.id) } } })
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

  // ── FIXTURE ────────────────────────────────────────────────────────────────────────────
  // One EARLIER row with its own distinct timestamp (so the walk starts outside the tied
  // block, as a real list would), then TIED_ROWS sharing one instant — the exact shape a
  // batched submission writes.
  console.log('\n[fixture] one earlier row + a tied block')
  const tiedAt = new Date()
  const earlierAt = new Date(tiedAt.getTime() - 60_000)

  await prisma.menuRequest.create({
    data: {
      vendorId: vendor.id, requestedBy: user.id, type: 'ADD', status: 'PENDING',
      name: `${PFX}earlier`, price: 1, category: 'Test', createdAt: earlierAt,
    },
  })
  for (let i = 0; i < TIED_ROWS; i++) {
    await prisma.menuRequest.create({
      data: {
        vendorId: vendor.id, requestedBy: user.id, type: 'ADD', status: 'PENDING',
        name: `${PFX}tied-${i}`, price: 1, category: 'Test', createdAt: tiedAt,
      },
    })
  }

  const all = await prisma.menuRequest.findMany({
    where: { vendor: { eventId: event.id } },
    select: { id: true, createdAt: true },
  })
  const expected = all.map(r => r.id)
  const distinctInstants = new Set(all.map(r => r.createdAt.getTime())).size

  assert(all.length === TIED_ROWS + 1, `fixture has ${TIED_ROWS + 1} rows (got ${all.length})`)
  assert(distinctInstants === 2,
    `fixture really TIES createdAt — ${TIED_ROWS} rows share one instant (got ${distinctInstants} distinct instants across ${all.length} rows)`)

  // The provocation, identical for both sorts: approve one row from page 1, mid-walk. This is
  // what an organizer working a queue does, and under MVCC it rewrites that row to the heap
  // tail, changing the order Postgres returns tied rows in for page 2.
  const approveOnePageOneRow = (target: { id: string } | null) => async () => {
    if (!target) return
    await prisma.menuRequest.update({ where: { id: target.id }, data: { status: 'APPROVED' } })
  }
  /** Reset statuses so the second walk starts from the same state as the first. */
  const resetStatuses = () =>
    prisma.menuRequest.updateMany({ where: { vendorId: vendor.id }, data: { status: 'PENDING' } })

  // Pick a stable page-1 row to approve in BOTH walks, so the two runs differ only in sort.
  const firstPage = await prisma.menuRequest.findMany({
    where: { vendor: { eventId: event.id } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: PAGE, select: { id: true },
  })
  const victim = firstPage[1] ?? null

  // ── [0] POSITIVE CONTROL ON THE PROBE ──────────────────────────────────────────────────
  // The old single-key sort MUST fail this walk. If it passes, the fixture no longer
  // reproduces the fault and the [1] result below would be meaningless.
  console.log('\n[0] POSITIVE CONTROL — the OLD single-key sort must corrupt the walk')
  await resetStatuses()
  const oldWalk = analyse(await paginate(event.id, 'single-key', approveOnePageOneRow(victim)), expected)
  assert(!oldWalk.clean,
    `single-key orderBy DOES break the cursor walk (${oldWalk.duplicated.length} duplicated, ${oldWalk.missing.length} missing) — the probe can fail, so [1] is not vacuous`)
  if (!oldWalk.clean) {
    console.log(`     ↳ duplicated: ${oldWalk.duplicated.length}, missing: ${oldWalk.missing.length}`)
  }

  // ── [1] THE FIX ────────────────────────────────────────────────────────────────────────
  // Same fixture, same mid-walk approval, only the sort differs.
  console.log('\n[1] the shipped sort — [{ createdAt: asc }, { id: asc }]')
  await resetStatuses()
  const newWalk = analyse(await paginate(event.id, 'tiebreak', approveOnePageOneRow(victim)), expected)
  assert(newWalk.duplicated.length === 0, `no row is returned twice (dupes: ${newWalk.duplicated.length})`)
  assert(newWalk.missing.length === 0, `no row is skipped (missing: ${newWalk.missing.length})`)
  assert(newWalk.clean, 'the cursor walk visits every row exactly once across the page boundary')

  // ── [2] STRUCTURAL — the ROUTE uses the total sort ──────────────────────────────────────
  // [1] proves the property at the query layer; this proves the route actually asks for it.
  console.log('\n[2] the read route asks for the total sort')
  const { readFileSync } = await import('node:fs')
  const src = readFileSync('app/api/organizer/fairs/[fairSlug]/menu-requests/route.ts', 'utf8')
  const TOTAL_SORT = /orderBy:\s*\[\s*\{\s*createdAt:\s*'asc'\s*\}\s*,\s*\{\s*id:\s*'asc'\s*\}\s*\]/
  assert(TOTAL_SORT.test("orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],"),
    "[0] positive control: the scanner DOES match the fixed sort line")
  assert(!TOTAL_SORT.test("orderBy: { createdAt: 'asc' },"),
    '[0] baseline: the scanner does NOT match the old single-key sort')
  assert(TOTAL_SORT.test(src), 'menu-requests read route orders by createdAt AND id')

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
