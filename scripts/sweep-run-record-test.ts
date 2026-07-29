/**
 * SWEEP RUN — the durable record of what the reconciler did.
 *
 * ── WHY THIS SUITE EXISTS ───────────────────────────────────────────────────────────────────
 * Before 2026-07-29 there was NO durable record of sweep results. The only proof any pattern
 * had ever repaired anything in production was 148 AdminMoneyAction rows from Pattern T, all
 * inside a 4-minute window on 2026-07-19 — and those came from a supervised one-off, not the
 * routine 60s sweep catching a live leak. Twenty-two patterns were indistinguishable from dead
 * code. A quiet backstop and a broken one look identical from outside.
 *
 * ── THE TWO PROPERTIES, AND WHY BOTH ────────────────────────────────────────────────────────
 *   [1] the row says what actually happened, PER PATTERN. A global repairedTotal=2 does not
 *       tell you which backstop earned its 60 seconds, which is the entire question.
 *   [2] ⛔ recording CANNOT fail the sweep. This table is a record OF the work, never a
 *       participant IN it — asserted by making the insert throw and checking the sweep's own
 *       result still stands. Without [2] the observability improvement is a new failure mode.
 *
 *   [3] the shape actually ANSWERS "which patterns have ever repaired anything, and when?" —
 *       run as a real query, because a schema that stores the data but cannot answer the
 *       question is the wrong shape.
 *
 * Every assertion is scoped to rows this suite created (a unique commit tag). No table-wide
 * counts: the gate runs 84 suites and the other writers are the other suites.
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/sweep-run-record-test.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
// TYPE-ONLY (erased at runtime). The VALUE import is dynamic, inside main(), because
// WORKER_COMMIT is captured at lib/health module load — a static import here would freeze it
// before the tag below is set, and every assertion would silently scope to nothing.
import type { SweepSummary } from '../lib/reconciler'

const prisma = testPrisma()
const TAG = `swrun-${Math.random().toString(36).slice(2, 10)}` // scopes every assertion below

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const ZERO = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, Q: 0, R: 0, S: 0, T: 0, X: 0 }

function mkSummary(over: Partial<SweepSummary> = {}): SweepSummary {
  const started = new Date(Date.now() - 5_000)
  return {
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 5_000,
    dryRun: false,
    patternEEnabled: false,
    backstopEnabled: false,
    scanned: { stripePIs: 0, completedOrders: 0, activeOrders: 0, pendingOrders: 0, unresolvedHolds: 0 },
    repaired: { ...ZERO },
    details: { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [], I: [], J: [], K: [], L: [], M: [], N: [], O: [], P: [], Q: [], R: [], S: [], T: [], X: [] },
    alerted: [], suppressed: [], ambiguousSkipped: 0, backstopWarnings: [],
    ...over,
  }
}

/** Rows written by THIS run only. */
const mine = () => prisma.sweepRun.findMany({ where: { commit: TAG }, orderBy: { createdAt: 'asc' } })

async function cleanup() {
  await prisma.sweepRun.deleteMany({ where: { commit: { startsWith: 'swrun-' } } })
}

async function main() {
  await cleanup()
  // Stamp our tag BEFORE lib/health is first loaded, so every row this suite writes is
  // scoped to us and no assertion can leak onto another suite's rows.
  process.env.RAILWAY_GIT_COMMIT_SHA = TAG
  const { recordSweepRun } = await import('../lib/reconciler')
  const { WORKER_COMMIT } = await import('../lib/health')

  try {
    console.log('[0] baseline — the recorder writes a row for a completed sweep')
    // ⛔ THE SCOPING PRECONDITION. If this fails, `mine()` matches nothing and EVERY count
    // assertion below would pass vacuously at 0. Asserted, never assumed.
    assert(WORKER_COMMIT === TAG,
      `⛔ WORKER_COMMIT is our tag ('${WORKER_COMMIT}') — without it every assertion here scopes to nothing`)
    const before = (await mine()).length
    assert(before === 0, `BASELINE: no rows carry our tag yet (got ${before}) — later counts mean THIS run`)

    console.log('\n[1] the row records what happened, PER PATTERN')
    await recordSweepRun(mkSummary({ repaired: { ...ZERO, X: 2, T: 1 }, alerted: ['a', 'b'], suppressed: ['s'], ambiguousSkipped: 3 }))
    const rows = await mine()
    assert(rows.length === 1, `exactly one row was written for one sweep (got ${rows.length})`)
    const r = rows[0]
    const rep = (r?.repaired ?? {}) as Record<string, number>
    assert(rep.X === 2, `⛔ per-pattern: X=2 is recorded as X, not folded into a total (got ${rep.X})`)
    assert(rep.T === 1, `⛔ and T=1 alongside it (got ${rep.T})`)
    assert(rep.C === 0, 'patterns that did nothing are stored as 0, not omitted — the row records which patterns EXISTED')
    assert(Object.keys(rep).length === Object.keys(ZERO).length,
      `the FULL map is stored (${Object.keys(rep).length} keys), so history shows the denominator too`)
    assert(r?.repairedTotal === 3, `repairedTotal is the sum (got ${r?.repairedTotal})`)
    assert(r?.alertedCount === 2 && r?.suppressedCount === 1, 'alert and suppressed counts ride along')
    assert(r?.ambiguousSkipped === 3, 'and ambiguousSkipped')
    assert(r?.dryRun === false, 'a live run is flagged as live')
    assert(r?.durationMs === 5_000, 'duration is recorded, so trend is answerable')
    assert(!!r && r.finishedAt.getTime() >= r.startedAt.getTime(), 'finishedAt is at or after startedAt')

    console.log('\n[2] dry runs are RECORDED AND FLAGGED, never skipped')
    // A dry run that WOULD have repaired something is exactly the signal worth keeping.
    await recordSweepRun(mkSummary({ dryRun: true, repaired: { ...ZERO, C: 4 } }))
    const dry = (await mine()).filter(x => x.dryRun)
    assert(dry.length === 1, `⛔ the dry run produced a row (got ${dry.length}) — not skipped`)
    assert(((dry[0]?.repaired ?? {}) as Record<string, number>).C === 4,
      'carrying what it WOULD have repaired')
    assert(dry[0]?.dryRun === true, '…and flagged, so it can never be mistaken for real work')

    console.log('\n[3] ⛔ RECORDING CANNOT FAIL THE SWEEP')
    // The observability improvement must not become a new failure mode. Force the INSERT to
    // fail with a trigger and prove recordSweepRun still resolves — the sweep's own result
    // stands, and only the observation is lost.
    let threwToCaller = false
    try {
      await prisma.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION __block_sweeprun() RETURNS trigger AS $$ BEGIN
           RAISE EXCEPTION 'sweeprun insert blocked for test'; END; $$ LANGUAGE plpgsql;`)
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER __block_sweeprun_trg BEFORE INSERT ON "SweepRun"
           FOR EACH ROW EXECUTE FUNCTION __block_sweeprun();`)
      // BASELINE for the probe itself: the trigger really does reject an insert.
      let rawBlocked = false
      try { await prisma.sweepRun.create({ data: {
        startedAt: new Date(), finishedAt: new Date(), durationMs: 1, dryRun: false,
        commit: TAG, repaired: {}, repairedTotal: 0, alertedCount: 0, suppressedCount: 0, ambiguousSkipped: 0,
      } }) } catch { rawBlocked = true }
      assert(rawBlocked, 'BASELINE: the trigger genuinely rejects a direct insert (the probe is live)')

      try { await recordSweepRun(mkSummary({ repaired: { ...ZERO, B: 9 } })) } catch { threwToCaller = true }
      assert(!threwToCaller,
        '⛔ recordSweepRun SWALLOWED the failure — a broken record cannot break the sweep')
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS __block_sweeprun_trg ON "SweepRun";`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS __block_sweeprun();`)
    }
    const afterBlocked = await mine()
    assert(afterBlocked.length === 2,
      `and the blocked sweep left NO row (still ${afterBlocked.length} from [1] and [2]) — a lost observation, not a phantom one`)

    console.log('\n[4] ⛔ the shape ANSWERS "which patterns have ever repaired anything, and when?"')
    // Run the real question as a real query. A schema that stores the data but cannot answer
    // this is the wrong shape, and that is decided here rather than asserted in a comment.
    const ever = await prisma.$queryRawUnsafe<{ pattern: string; total: bigint; last_at: Date }[]>(
      `SELECT key AS pattern, SUM(value::int) AS total, MAX(s."startedAt") AS last_at
         FROM "SweepRun" s, jsonb_each_text(s."repaired")
        WHERE s."commit" = $1 AND s."dryRun" = false AND value::int > 0
        GROUP BY key ORDER BY total DESC`, TAG)
    const found = new Map(ever.map(e => [e.pattern, Number(e.total)]))
    assert(found.get('X') === 2, `⛔ the query names X with 2 repairs (got ${found.get('X')})`)
    assert(found.get('T') === 1, `⛔ and T with 1 (got ${found.get('T')})`)
    assert(!found.has('C'), 'and does NOT list C — which repaired nothing in a live run (the dry C=4 is excluded by dryRun=false)')
    assert(ever.every(e => e.last_at instanceof Date), 'each carries WHEN it last fired, so "ever?" and "recently?" are the same query')

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `✅ sweep-run-record: ${pass} passed, 0 failed` : `❌ sweep-run-record: ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('[sweep-run-record] FAILED:', e); await cleanup(); process.exit(1) })
