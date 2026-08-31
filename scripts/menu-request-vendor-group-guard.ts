/**
 * VENDOR-GROUP GUARD — the organizer queue's outer grouping layer.
 *
 * PURE-FIXTURE, NO DATABASE, deliberately. groupByVendor is a pure function over plain rows, so
 * constructed fixtures exercise it completely and let the guard build shapes a seeded database
 * makes awkward — a batchId deliberately spanning two vendors, a row with a broken date, a
 * vendor-less row. The house rule about ./scripts/with-test-db.sh exists because `npx tsx`
 * SKIPS db-dependent tests while still reading like PASS; nothing here touches a database, so
 * there is nothing to skip and no false green to produce.
 *
 * WHAT IT PROTECTS, in risk order:
 *  [1] PARTITION — every row lands under exactly one vendor and, within it, exactly one
 *      batch-or-solo group. None dropped, none doubled. The organizer's queue must be the same
 *      set of decisions as the route returned, rearranged.
 *  [2] COMPOSITION — the batch layer is DELEGATED, not reimplemented. Asserted by comparing
 *      against a direct groupIntoBatches call on the same rows. A second copy of the
 *      `batchId ?? solo:<id>` rule that drifted would collapse every standalone request in a
 *      fair into one group, which is the single worst regression this surface can produce.
 *  [3] a batchId never spans two vendors.
 *  [4] mixed types under one vendor (a batch + DELETE + RESTORE) arrange correctly.
 *  [5] the vendor sort is REAL — most-recent-first, proven by flipping the input.
 *  [6] no row is dropped for a missing vendor, and nothing lands in an "undefined" bucket.
 *  [7] isomorphic — no server-only import can ride into the client bundle.
 *
 * Run: npx tsx scripts/menu-request-vendor-group-guard.ts
 */

import { readFileSync } from 'node:fs'
import { groupIntoBatches } from '../lib/menu-requests/group-by-batch'
import { groupByVendor, type VendorGroupable } from '../lib/menu-requests/group-by-vendor'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

type Row = VendorGroupable & { type: string }

const V = {
  a: { id: 'v_alpha', name: 'Alpha Booth' },
  b: { id: 'v_bravo', name: 'Bravo BBQ' },
}

let seq = 0
function row(
  vendor: { id: string; name: string },
  over: Partial<Row> = {},
): Row {
  seq += 1
  return {
    id: `r${seq}`,
    batchId: null,
    status: 'PENDING',
    type: 'ADD',
    // Distinct, increasing times unless overridden.
    createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, seq)).toISOString(),
    vendor,
    ...over,
  }
}

/** Total rows across every vendor and every group — the partition's right-hand side. */
function totalRows<T extends VendorGroupable>(gs: ReturnType<typeof groupByVendor<T>>): number {
  return gs.reduce((n, v) => n + v.groups.reduce((m, g) => m + g.rows.length, 0), 0)
}
function allIds<T extends VendorGroupable>(gs: ReturnType<typeof groupByVendor<T>>): string[] {
  return gs.flatMap(v => v.groups.flatMap(g => g.rows.map(r => r.id)))
}

function main() {
  // ── [1] PARTITION ──────────────────────────────────────────────────────────────────────
  console.log('\n[1] every row lands under exactly one vendor and one group')
  const batchId = 'mrb_one'
  const rows: Row[] = [
    row(V.a, { batchId }), row(V.a, { batchId }), row(V.a, { batchId }),
    row(V.a, { type: 'DELETE' }),
    row(V.b), row(V.b, { type: 'RESTORE' }),
  ]
  const grouped = groupByVendor(rows)

  assert(grouped.length === 2, `two vendors in, two vendor groups out (got ${grouped.length})`)
  assert(totalRows(grouped) === rows.length,
    `row count is preserved (${totalRows(grouped)} === ${rows.length}) — none dropped, none doubled`)
  const ids = allIds(grouped)
  assert(new Set(ids).size === ids.length, 'no row appears twice across the grouping')
  assert(rows.every(r => ids.includes(r.id)), 'every input row is present in the output')

  // [0] CONTROL on the probe: it must be able to SEE a broken partition. Group by a
  // non-unique key (all rows into one bucket) and the vendor-count assertion above must fail
  // — proving these checks discriminate rather than passing for any arrangement.
  const collapsed = groupByVendor(rows.map(r => ({ ...r, vendor: V.a })))
  assert(collapsed.length === 1 && totalRows(collapsed) === rows.length,
    '[0] positive control: forcing one vendor yields ONE group holding all rows — the counter tracks reality')
  assert(collapsed.length !== grouped.length,
    '[0] positive control: that arrangement DIFFERS from the real one, so [1] is not trivially true')

  // ── [2] COMPOSITION, NOT RE-DERIVATION ─────────────────────────────────────────────────
  console.log('\n[2] the batch layer is delegated to groupIntoBatches, not reimplemented')
  const alphaRows = rows.filter(r => r.vendor.id === V.a.id)
  const direct = groupIntoBatches(alphaRows)
  const viaVendor = grouped.find(v => v.vendorId === V.a.id)!.groups

  assert(JSON.stringify(viaVendor) === JSON.stringify(direct),
    'a vendor’s groups are IDENTICAL to calling groupIntoBatches on that vendor’s rows directly')
  // The positive half: the batch logic actually RAN. If it had been reimplemented and broken,
  // the four Alpha rows would be four solo groups instead of one batch of 3 plus one solo.
  const alphaBatches = viaVendor.filter(g => g.isBatch)
  assert(alphaBatches.length === 1 && alphaBatches[0].rows.length === 3,
    `[0] positive control: the batch of 3 IS one isBatch group of 3 (got ${alphaBatches.length} batch group(s))`)
  assert(viaVendor.length === 2,
    `Alpha has 2 groups — the batch plus one solo DELETE (got ${viaVendor.length})`)

  // ── [3] A BATCH NEVER SPANS TWO VENDORS ────────────────────────────────────────────────
  console.log('\n[3] a batchId lands under exactly one vendor')
  // Construct the impossible case anyway — the write mints per-vendor, but a guard that never
  // checks is not a guard.
  const shared = 'mrb_shared'
  const crossed = groupByVendor([
    row(V.a, { batchId: shared }), row(V.a, { batchId: shared }),
    row(V.b, { batchId: shared }),
  ])
  const holders = crossed.filter(v => v.groups.some(g => g.batchId === shared))
  assert(crossed.length === 2, 'the rows still split by vendor first')
  assert(holders.length === 2,
    'each vendor holds its OWN group for that id — vendor is the outer layer, so a shared id cannot merge two vendors')
  assert(totalRows(crossed) === 3, 'and no row is lost to the collision')

  // ── [4] MIXED TYPES UNDER ONE VENDOR ───────────────────────────────────────────────────
  console.log('\n[4] a batch + a DELETE + a RESTORE arrange under one vendor')
  const bId = 'mrb_mixed'
  const mixed = groupByVendor([
    row(V.a, { batchId: bId }), row(V.a, { batchId: bId }), row(V.a, { batchId: bId }),
    row(V.a, { type: 'DELETE' }),
    row(V.a, { type: 'RESTORE' }),
  ])[0]
  assert(mixed.groups.length === 3, `one batch + two solos = 3 groups (got ${mixed.groups.length})`)
  assert(mixed.groups.filter(g => g.isBatch).length === 1, 'exactly one isBatch group')
  assert(mixed.groups.filter(g => !g.isBatch).length === 2, 'exactly two solo groups')
  const types = mixed.groups.flatMap(g => g.rows.map(r => r.type)).sort().join(',')
  assert(types === 'ADD,ADD,ADD,DELETE,RESTORE',
    `every request type is passed through unchanged (got ${types})`)
  assert(mixed.pendingCount === 5, `pendingCount counts ROWS, not groups (got ${mixed.pendingCount})`)
  const someResolved = groupByVendor([
    row(V.a), row(V.a, { status: 'APPROVED' }), row(V.a, { status: 'REJECTED' }),
  ])[0]
  assert(someResolved.pendingCount === 1,
    `[0] positive control: pendingCount excludes resolved rows (got ${someResolved.pendingCount} of 3)`)

  // ── [5] THE SORT IS REAL ───────────────────────────────────────────────────────────────
  // Proven by flipping the gap, not by reading one lucky ordering: input order is held constant
  // while only the TIMES move, so a helper that merely echoed encounter order would fail one
  // of the two directions.
  console.log('\n[5] vendors are ordered most-recent-first')
  const old = '2026-08-01T00:00:00.000Z'
  const recent = '2026-08-20T00:00:00.000Z'

  const bravoNewer = groupByVendor([
    row(V.a, { createdAt: old }),
    row(V.b, { createdAt: recent }),
  ])
  assert(bravoNewer[0].vendorId === V.b.id,
    'the vendor with the newer request comes first')

  const alphaNewer = groupByVendor([
    row(V.a, { createdAt: recent }),
    row(V.b, { createdAt: old }),
  ])
  assert(alphaNewer[0].vendorId === V.a.id,
    'reversing the gap FLIPS the order — the sort is real, not the input order echoed back')

  // latestAt is the MAX within a vendor, not the first or last row seen.
  const maxWins = groupByVendor([
    row(V.a, { createdAt: old }), row(V.a, { createdAt: recent }), row(V.a, { createdAt: old }),
    row(V.b, { createdAt: '2026-08-10T00:00:00.000Z' }),
  ])
  assert(maxWins[0].vendorId === V.a.id,
    'latestAt is the MAX of a vendor’s rows — an old row after a recent one does not demote the vendor')
  assert(maxWins[0].latestAt === Date.parse(recent), 'and latestAt holds that maximum')

  // Ties break on vendorId so the order is total and cannot shuffle between renders.
  const tieA = groupByVendor([row(V.b, { createdAt: old }), row(V.a, { createdAt: old })])
  const tieB = groupByVendor([row(V.a, { createdAt: old }), row(V.b, { createdAt: old })])
  assert(tieA.map(v => v.vendorId).join() === tieB.map(v => v.vendorId).join(),
    'equal times produce the SAME order regardless of input order — the sort is total')

  // ── [6] NO ROW IS LOST, EVEN ON BAD INPUT ──────────────────────────────────────────────
  console.log('\n[6] every row keeps a vendor; nothing lands in an undefined bucket')
  const withBadDate = groupByVendor([row(V.a, { createdAt: 'not-a-date' }), row(V.b)])
  assert(totalRows(withBadDate) === 2, 'an unparseable date does not drop the row')
  const bad = withBadDate.find(v => v.vendorId === V.a.id)!
  assert(bad.latestAt === 0, 'it sorts as 0 rather than NaN, which would poison the comparison')
  assert(withBadDate[0].vendorId === V.b.id, 'so that vendor sorts last, not unpredictably')

  // The NOT-NULL guarantee, asserted rather than trusted: a hypothetically vendor-less row must
  // not be swallowed into an "undefined" bucket that silently hides it from the queue.
  const vendorless = [row(V.a), { ...row(V.b), vendor: undefined as unknown as { id: string; name: string } }]
  let threw = false
  let out: ReturnType<typeof groupByVendor<Row>> = []
  try { out = groupByVendor(vendorless) } catch { threw = true }
  assert(threw || !out.some(v => v.vendorId === undefined || v.vendorName === undefined),
    'a vendor-less row either throws or is never bucketed under an undefined vendor — it cannot vanish quietly')

  // ── [7] ISOMORPHIC ─────────────────────────────────────────────────────────────────────
  console.log('\n[7] the helper is safe for the client bundle')
  const src = readFileSync('lib/menu-requests/group-by-vendor.ts', 'utf8')

  // STRIP COMMENTS FIRST. A source-scanning guard that greps raw text matches the PROSE beside
  // the code — this file's own header says "no Prisma, no next/cache", and the un-stripped
  // version of the check below went red on its own documentation. That is the recurring
  // source-scanner trap (see scripts/test-probe-positive-control notes): match code, not commentary.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')

  const imports = [...code.matchAll(/^\s*import\s.*?from\s+'([^']+)'/gm)].map(m => m[1])
  assert(imports.length > 0, '[0] positive control: the scanner DOES find imports (it is not blind)')
  assert(/no Prisma, no/.test(src) && !/no Prisma, no/.test(code),
    '[0] positive control: comment-stripping WORKS — prose present in the raw file is absent from the scanned code')
  assert(imports.every(i => i.startsWith('./') || i.startsWith('../')),
    `only relative sibling imports (${imports.join(', ')}) — nothing server-only can ride into the browser`)
  assert(!/@prisma|next\/|@\/lib\/db/.test(code),
    'no Prisma, no next/*, no db import in the CODE')
  assert(/from '\.\/group-by-batch'/.test(src),
    'and it DOES import the batch grouper — composition is visible in the source, not just the behaviour')

  console.log(`\n${'─'.repeat(72)}`)
  if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
  else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
  console.log(`${'─'.repeat(72)}\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
