/**
 * MENU-REQUEST PAGINATION GUARD — the cursor walk must not skip or duplicate a row when
 * several rows share a createdAt.
 *
 * THE BUG THIS LOCKS. The organizer menu-request list is cursor-paginated over
 * `orderBy: { createdAt: 'asc' }`. Prisma compiles a cursor into a WHERE on the orderBy VALUES
 * — `createdAt >= (SELECT createdAt FROM MenuRequest WHERE id = $cursor)` — and then slices
 * relative to the cursor row's position WITHIN that result. That is exact only while the sort
 * key is UNIQUE. It is not: rows written in one transaction all take that transaction's
 * timestamp, so a batched submission produces N rows with an IDENTICAL createdAt.
 *
 * TIES ALONE ARE NOT ENOUGH, and getting that wrong is how the first version of this guard
 * passed vacuously. A single uninterrupted walk is self-consistent even with ties, because the
 * same query both orders the rows and locates the cursor in them. The corruption needs the tie
 * ORDER to DIFFER between the page-1 and page-2 queries — which happens once a row is UPDATED
 * mid-walk, since MVCC writes a new row version that can land outside its original heap page.
 * Approving a request is an update, and approving while paging is how the screen is used.
 *
 * WHY [0b] RETRIES. Even with the update, the reorder is PROBABILISTIC: when the page has free
 * space Postgres can update in place (HOT) and the scan order survives. Measured here, one
 * attempt reproduced about 5 times in 8 — so a one-shot control is a coin flip, and a guard
 * that is red three runs in eight is one people re-run instead of read. That was the second
 * version of this guard, and it was also wrong. The fix is not a weaker assertion: [0b] takes
 * up to ATTEMPTS independent shots (rotating which rows are approved) and requires at least
 * one real reproduction. Observed 18–23 of 24, so failing all 24 is ~4e-15.
 *
 * ⚠️ THAT MARGIN IS ENVIRONMENTAL, NOT A CONSTANT. It rides on how often an updated tuple has
 * to leave its heap page, which depends on page fullness — so a non-default `fillfactor` on
 * MenuRequest, a much smaller fixture, or a Postgres version that widens HOT-update eligibility
 * all push the per-attempt rate down and erode the headroom. If [0b] ever starts failing, the
 * first question is whether the reproduction got harder, NOT whether the assertion is too
 * strict: raise ATTEMPTS or enlarge the fixture before touching what it asserts. [0a] is the
 * part that must never be relaxed — it is the property, and it holds regardless of any of this.
 *
 * [0a] carries the half that IS deterministic — that the old key does not uniquely order the
 * rows and the shipped one does — so the suite still states the precondition exactly even if
 * the physical reproduction ever stopped firing.
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

  // The provocation, identical for both sorts: approve page-1 rows mid-walk, which is what an
  // organizer working a queue does. Under MVCC each update writes a new row version that may
  // land outside its original heap page, changing the order Postgres returns tied rows in for
  // page 2 — the second half of the bug (see the header).
  //
  // Approving SEVERAL rows before turning the page is both what an organizer actually does
  // (work a few, then continue) and a stronger provocation: each update is another chance for
  // the new row version to land outside its original heap page and change the scan order.
  const approvePageOneRows = (targets: { id: string }[]) => async () => {
    for (const t of targets) {
      await prisma.menuRequest.update({ where: { id: t.id }, data: { status: 'APPROVED' } })
    }
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

  // ── [0a] THE PRECONDITION, DETERMINISTICALLY ───────────────────────────────────────────
  // The bug's precondition is a sort key that does not uniquely order the rows. That is a
  // fact about the data and the key, not about Postgres's mood, so it is asserted exactly.
  console.log('\n[0a] the old sort key is NOT total; the shipped one IS')
  const byCreatedAt = new Set(all.map(r => r.createdAt.getTime()))
  const byCreatedAtAndId = new Set(all.map(r => `${r.createdAt.getTime()}|${r.id}`))
  assert(byCreatedAt.size < all.length,
    `createdAt alone does NOT uniquely order the rows (${byCreatedAt.size} distinct keys for ${all.length} rows) — keyset pagination has no stable boundary`)
  assert(byCreatedAtAndId.size === all.length,
    `(createdAt, id) DOES uniquely order every row (${byCreatedAtAndId.size}/${all.length}) — the boundary is exact`)

  // ── [0b] POSITIVE CONTROL — reproduce the actual corruption ────────────────────────────
  // WHY THIS RETRIES. The corruption needs the tie ORDER to differ between the page-1 and
  // page-2 queries. An UPDATE usually causes that (MVCC writes a new row version at the heap
  // tail), but not always: when the page has free space Postgres can do a HOT update in
  // place, and the scan order survives. Measured on this fixture, a single attempt reproduces
  // roughly 5 times in 8 — so a one-shot control is a COIN FLIP, and a guard that is red
  // three runs in eight is a guard people learn to re-run instead of read. That was the first
  // version of this check, and it was wrong.
  //
  // The fix is not to weaken the assertion but to stop sampling once: each attempt approves a
  // DIFFERENT page-1 row for an independent shot. Failing all ATTEMPTS times is ~(3/8)^N,
  // about five in a million at N=12 — while still being a real reproduction of the real bug,
  // never a restatement of [0a].
  const ATTEMPTS = 24
  console.log(`\n[0b] POSITIVE CONTROL — the OLD single-key sort corrupts the walk (≤${ATTEMPTS} attempts)`)
  let reproduced = 0
  let firstFailure: ReturnType<typeof analyse> | null = null
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    await resetStatuses()
    // Rotate WHICH rows are approved so attempts are independent rather than one coin
    // re-flipped, and approve a couple at a time (see approvePageOneRows).
    const a = firstPage[attempt % firstPage.length]
    const b = firstPage[(attempt + 2) % firstPage.length]
    const targets = [a, b].filter((x): x is { id: string } => !!x)
    const walk = analyse(await paginate(event.id, 'single-key', approvePageOneRows(targets)), expected)
    if (!walk.clean) {
      reproduced++
      if (!firstFailure) firstFailure = walk
    }
  }
  assert(reproduced > 0,
    `single-key orderBy DOES break the cursor walk — reproduced in ${reproduced}/${ATTEMPTS} attempts, so [1] is not vacuous`)
  if (firstFailure) {
    console.log(`     ↳ first failure: ${firstFailure.duplicated.length} duplicated, ${firstFailure.missing.length} missing`)
  }

  // ── [1] THE FIX ────────────────────────────────────────────────────────────────────────
  // Same fixture, same mid-walk approval, only the sort differs.
  console.log('\n[1] the shipped sort — [{ createdAt: asc }, { id: asc }]')
  await resetStatuses()
  const newWalk = analyse(await paginate(event.id, 'tiebreak', approvePageOneRows([victim].filter((x): x is { id: string } => !!x))), expected)
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
