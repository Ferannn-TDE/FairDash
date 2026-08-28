/**
 * MENU-REQUEST BATCH WRITE GUARD — the batch form is atomic, validates identically to the
 * single form, and does not silently skip the per-row side effect.
 *
 * Three properties, each with the half that is easy to fake removed:
 *
 *  [1] ATOMIC — the load-bearing half is NOT that a good batch writes cleanly, it is that a
 *      bad one leaves NOTHING. A batch of 5 whose 4th item is invalid must land 0 rows, not 3.
 *      Paired with a positive control on the same fixture (fix that item, watch 5 land), so
 *      "zero rows" cannot be the route simply refusing everything.
 *
 *  [2] VALIDATION PARITY — the reason validation was extracted is that both forms reject an
 *      identical bad item identically. Each bad input is sent through BOTH doors and the
 *      status + code must match. A table of one row proves little, so it runs the whole rule
 *      set: missing name, bad price, missing menuItemId, data: URL, bad type.
 *
 *  [3] AUDIT FAN-OUT — logVendorAction is the one per-row side effect the single form runs,
 *      and there is no Prisma middleware to do it for us (the repo's only $extends is the
 *      scripts-only prod-write-guard). A batch of 3 must write 3 audit rows with 3 distinct
 *      requestIds. This is the "two write paths, one silently missing a hook" class: nothing
 *      would ever have reported it.
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/menu-request-batch-write-guard.ts
 * Self-cleaning, prefix mrbw-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { register } from 'node:module'
register('./_clerk-loader.mjs', import.meta.url)

import { NextRequest } from 'next/server'
import { MAX_BATCH_ITEMS } from '../lib/menu-requests/validate-item'

const prisma = testPrisma()

const PFX = 'mrbw-'
const MAIL = '@mrbw.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

// Loaded after the clerk loader is registered, so the route's requireAuth resolves to the mock.
let POST: (req: NextRequest) => Promise<Response>

async function loadRoute() {
  POST = (await import('../app/api/menu-requests/route')).POST as never
}

/** Identity is controlled through the mock's global, as the other route proofs do. */
function login(clerkId: string) {
  ;(globalThis as unknown as { __MOCK_CLERK?: { userId: string } }).__MOCK_CLERK = { userId: clerkId }
}

function post(bodyObj: unknown): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/menu-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
  }))
}

async function bodyOf(res: Response) {
  try { return await res.json() } catch { return null }
}
async function codeOf(res: Response): Promise<string | undefined> {
  const j = await bodyOf(res)
  return j?.error?.code
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const vids = vs.map(v => v.id)
    await prisma.vendorAuditLog.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

/** Audit writes are fire-and-forget; give them a moment to land before counting. */
const settle = () => new Promise(r => setTimeout(r, 400))

async function main() {
  await loadRoute()
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
  await prisma.vendorMember.create({
    data: { vendorId: vendor.id, userId: user.id, role: 'owner', approvalStatus: 'APPROVED' },
  })
  login(user.clerkId)

  const countRows = () => prisma.menuRequest.count({ where: { vendorId: vendor.id } })
  const wipeRows = () => prisma.menuRequest.deleteMany({ where: { vendorId: vendor.id } })
  const item = (n: string, over: Record<string, unknown> = {}) =>
    ({ type: 'ADD', name: `${PFX}${n}`, price: 5, category: 'Test', ...over })

  // ── [1] ATOMICITY ──────────────────────────────────────────────────────────────────────
  console.log('\n[1] a batch is all-or-nothing')

  await wipeRows()
  const badBatch = await post({
    vendorId: vendor.id,
    items: [item('a'), item('b'), item('c'), item('d', { price: -1 }), item('e')],
  })
  const afterBad = await countRows()
  assert(badBatch.status === 400, `a batch with an invalid 4th item is refused (got ${badBatch.status})`)
  assert(afterBad === 0,
    `ZERO rows landed from the failed batch — not a partial 3 (got ${afterBad})`)
  const badBody = await bodyOf(badBatch)
  assert(String(badBody?.error?.message ?? '').startsWith('Item 4:'),
    `the response names WHICH item failed (got "${badBody?.error?.message}")`)

  // [0] POSITIVE CONTROL on the same fixture: with that item fixed, all five land. Without
  // this, "0 rows" is equally consistent with a route that refuses every batch.
  await wipeRows()
  const goodBatch = await post({
    vendorId: vendor.id,
    items: [item('a'), item('b'), item('c'), item('d'), item('e')],
  })
  const afterGood = await countRows()
  assert(goodBatch.status === 201, `[0] positive control: the same batch, item 4 fixed → 201 (got ${goodBatch.status})`)
  assert(afterGood === 5, `[0] positive control: all 5 rows landed (got ${afterGood}) — so "0" above meant rollback, not refusal`)

  const goodBody = await bodyOf(goodBatch)
  const batchId: string | undefined = goodBody?.data?.batchId
  assert(typeof batchId === 'string' && batchId.length > 0, 'the response carries a batchId')
  const written = await prisma.menuRequest.findMany({ where: { vendorId: vendor.id }, select: { batchId: true, status: true } })
  assert(written.every(r => r.batchId === batchId), 'every row of the submission shares that one batchId')
  assert(written.every(r => r.status === 'PENDING'), 'every row starts PENDING — grouping does not pre-approve anything')

  // A mid-batch DB failure, not just a validation failure: an EDIT naming a menuItemId that
  // does not exist violates the FK, so the transaction itself must unwind.
  await wipeRows()
  const fkBatch = await post({
    vendorId: vendor.id,
    items: [item('x'), item('y'), { type: 'EDIT', menuItemId: 'menuitem_does_not_exist', name: `${PFX}z` }],
  })
  const afterFk = await countRows()
  assert(fkBatch.status >= 400, `a batch that fails at the DB is refused (got ${fkBatch.status})`)
  assert(afterFk === 0, `ZERO rows survive a mid-transaction DB failure (got ${afterFk}) — the transaction, not just the pre-check`)

  // ── [2] VALIDATION PARITY ──────────────────────────────────────────────────────────────
  console.log('\n[2] both forms reject an identical bad item identically')

  const badItems: { label: string; over: Record<string, unknown> }[] = [
    { label: 'missing name',        over: { name: undefined } },
    { label: 'price zero',          over: { price: 0 } },
    { label: 'price over cap',      over: { price: 10_001 } },
    { label: 'price not a number',  over: { price: 'free' } },
    { label: 'missing category',    over: { category: undefined } },
    { label: 'invalid type',        over: { type: 'RENAME' } },
    { label: 'data: imageUrl',      over: { imageUrl: `data:image/png;base64,${'A'.repeat(1000)}` } },
    { label: 'blob: imageUrl',      over: { imageUrl: 'blob:http://localhost/abc' } },
    { label: 'EDIT w/o menuItemId', over: { type: 'EDIT' } },
  ]

  for (const { label, over } of badItems) {
    await wipeRows()
    const single = await post({ vendorId: vendor.id, ...item('p', over) })
    await wipeRows()
    const batch = await post({ vendorId: vendor.id, items: [item('p', over)] })

    const sCode = await codeOf(single)
    const bCode = await codeOf(batch)
    assert(single.status === batch.status && sCode === bCode,
      `${label}: single ${single.status}/${sCode} === batch ${batch.status}/${bCode}`)
    assert(single.status >= 400, `${label}: actually rejected (not a vacuous match on two 201s)`)
  }

  // [0] The parity table is only meaningful if a GOOD item passes both doors — otherwise
  // "both refused" is trivially true for every input.
  await wipeRows()
  const okSingle = await post({ vendorId: vendor.id, ...item('good') })
  await wipeRows()
  const okBatch = await post({ vendorId: vendor.id, items: [item('good')] })
  assert(okSingle.status === 201 && okBatch.status === 201,
    `[0] positive control: a VALID item passes both doors (single ${okSingle.status}, batch ${okBatch.status})`)

  // ── [3] AUDIT FAN-OUT ──────────────────────────────────────────────────────────────────
  console.log('\n[3] one audit row per request, never one per submission')

  // SETTLE BEFORE WIPING. logVendorAction is fire-and-forget, so audit writes from the
  // sections above can still be in flight; deleting first and counting later would count a
  // straggler as one of ours. Let them land, THEN clear.
  await settle()
  await prisma.vendorAuditLog.deleteMany({ where: { vendorId: vendor.id } })
  await wipeRows()
  await post({ vendorId: vendor.id, items: [item('m1'), item('m2'), item('m3')] })
  await settle()
  const batchLogs = await prisma.vendorAuditLog.findMany({
    where: { vendorId: vendor.id, action: 'MENU_CHANGE_REQUESTED' },
    select: { metadata: true },
  })
  assert(batchLogs.length === 3,
    `a batch of 3 wrote 3 audit rows (got ${batchLogs.length}) — not 1 for the submission`)
  const reqIds = new Set(batchLogs.map(l => (l.metadata as { requestId?: string } | null)?.requestId))
  assert(reqIds.size === 3, `each audit row names a DISTINCT requestId (got ${reqIds.size})`)
  const auditBatchIds = new Set(batchLogs.map(l => (l.metadata as { batchId?: string } | null)?.batchId))
  assert(auditBatchIds.size === 1 && Boolean([...auditBatchIds][0]),
    'every audit row carries the shared batchId, so the submission is reassemblable')

  // [0] The single form still writes exactly one — proving the counter reads reality.
  // SETTLE BEFORE WIPING. logVendorAction is fire-and-forget, so audit writes from the
  // sections above can still be in flight; deleting first and counting later would count a
  // straggler as one of ours. Let them land, THEN clear.
  await settle()
  await prisma.vendorAuditLog.deleteMany({ where: { vendorId: vendor.id } })
  await wipeRows()
  await post({ vendorId: vendor.id, ...item('solo') })
  await settle()
  const soloLogs = await prisma.vendorAuditLog.count({
    where: { vendorId: vendor.id, action: 'MENU_CHANGE_REQUESTED' },
  })
  assert(soloLogs === 1, `[0] positive control: the single form writes exactly 1 audit row (got ${soloLogs})`)

  // ── [4] BACK-COMPAT — the single form is untouched ─────────────────────────────────────
  console.log('\n[4] the single form keeps its original contract')
  await wipeRows()
  const soloRes = await post({ vendorId: vendor.id, ...item('legacy') })
  const soloBody = await bodyOf(soloRes)
  assert(soloRes.status === 201, 'single form still answers 201')
  assert(typeof soloBody?.data?.id === 'string' && soloBody?.data?.requests === undefined,
    'single form still returns the BARE request (no { batchId, requests } wrapper)')
  assert(soloBody?.data?.batchId === null, 'a standalone request is written with batchId null')

  // ── [5] THE BOUNDARIES ─────────────────────────────────────────────────────────────────
  // A cap that no test ever trips might be off by one, or might not fire at all. Both edges
  // are exercised, and the empty list is asserted rather than assumed: validation over zero
  // items passes VACUOUSLY, so without an explicit check the route would happily mint a
  // batchId pointing at nothing and answer 201 with an empty submission.
  console.log('\n[5] the batch-size boundaries')

  await wipeRows()
  const emptyRes = await post({ vendorId: vendor.id, items: [] })
  const afterEmpty = await countRows()
  assert(emptyRes.status === 400, `an EMPTY items array is refused (got ${emptyRes.status})`)
  assert(await codeOf(emptyRes) === 'VALIDATION_ERROR', 'empty batch → VALIDATION_ERROR')
  assert(afterEmpty === 0, `no rows, and no stray batchId over zero rows (got ${afterEmpty})`)

  const many = (n: number) => Array.from({ length: n }, (_, i) => item(`cap${i}`))

  await wipeRows()
  const atCap = await post({ vendorId: vendor.id, items: many(MAX_BATCH_ITEMS) })
  const atCapRows = await countRows()
  assert(atCap.status === 201, `exactly ${MAX_BATCH_ITEMS} items is ACCEPTED (got ${atCap.status}) — the cap is not off by one`)
  assert(atCapRows === MAX_BATCH_ITEMS, `all ${MAX_BATCH_ITEMS} rows landed (got ${atCapRows})`)

  await wipeRows()
  const overCap = await post({ vendorId: vendor.id, items: many(MAX_BATCH_ITEMS + 1) })
  const overCapRows = await countRows()
  assert(overCap.status === 400, `${MAX_BATCH_ITEMS + 1} items is REFUSED (got ${overCap.status}) — the cap actually fires`)
  assert(overCapRows === 0, `nothing partially landed from the over-cap batch (got ${overCapRows})`)
  const overBody = await bodyOf(overCap)
  assert(String(overBody?.error?.message ?? '').includes('split'),
    `the over-limit error tells the vendor what to do (got "${overBody?.error?.message}")`)

  console.log(`\n${'─'.repeat(70)}`)
  if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
  else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
  console.log(`${'─'.repeat(70)}\n`)

  await cleanup()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async err => {
  console.error(err)
  await cleanup().catch(() => {})
  process.exit(1)
})
