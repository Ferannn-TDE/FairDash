/**
 * ORDER-VIEW GUARD — the customer tracking surfaces ask ONE derivation what an order looks
 * like, and that derivation agrees with the server's writer by construction.
 *
 * The fragmentation it closes: order state had four representations (master Order.status,
 * per-vendor vendorOrderStatuses[].status, a client `liveStatus`, and the RTDB push feeding
 * it). The two tracking views each picked a different one — five spellings of "this vendor's
 * status" with three different fallbacks — and three defects fell out of that:
 *
 *   B1 (was LIVE)  — `liveStatus` was a PER-VENDOR value wearing a master name. On a
 *                    two-vendor order, vendor A declining rendered the customer's WHOLE order
 *                    as cancelled while vendor B was still cooking.
 *   B2 (was armed) — the client didn't apply the server's delivery-arm clamp, so a vendor
 *                    COMPLETED could read "Order complete!" while the runner had the food.
 *   B3            — `vendorOrderStatuses?.[0]`, positional and unfiltered.
 *
 *   [1] BEHAVIOR      — the B1 and B2 payloads, each with a positive control proving the
 *                       probe can return the other answer.
 *   [2] SHARED CLAMP  — deriveOrderView routes through the SAME deriveMasterStatus the writer
 *                       uses, so B2 is unexpressible rather than merely absent.
 *   [3] SOURCE SHAPE  — no banned representation can reappear in the tracking tree.
 *   [4] SCANNER CONTROL — the [3] scanner is shown to catch a planted violation, so it can
 *                       never pass vacuously (the standing positive-control rule).
 *
 * Run:  npx tsx scripts/order-view-guard.ts
 */

import { readFileSync } from 'node:fs'
import { deriveOrderView } from '../lib/order-view'
import { deriveMasterStatus } from '../lib/order-derive'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const V = (vendorId: string, status: string) => ({ vendorId, status })

// ─────────────────────────────────────────────────────────────────────────────
console.log('[1] behavior: the two bugs, each against a positive control')

// ── B1: multi-vendor, one lane declined ──────────────────────────────────────
const b1 = deriveOrderView({
  masterStatus: 'PLACED',
  vendorStatuses: [V('v1', 'PLACED'), V('v2', 'DECLINED')],
  fulfillmentType: 'BOOTH_PICKUP',
})
assert(b1.isCancelled === false,
  'B1: [PLACED, DECLINED] → isCancelled FALSE (one vendor declining no longer cancels the order)')
assert(b1.displayStatus === 'PLACED',
  'B1: the surviving lane sets the headline, not the dead one')
assert(b1.canCancel === true,
  'B1: still cancellable — a declined lane must not veto the live one')

// POSITIVE CONTROL for B1: the probe CAN say cancelled.
const allDeclined = deriveOrderView({
  masterStatus: 'PLACED',
  vendorStatuses: [V('v1', 'DECLINED'), V('v2', 'DECLINED')],
  fulfillmentType: 'BOOTH_PICKUP',
})
assert(allDeclined.isCancelled === true,
  'B1 control: [DECLINED, DECLINED] → isCancelled TRUE (the probe is not stuck on false)')
assert(allDeclined.canCancel === false, 'B1 control: a dead order is not cancellable')

// ── B2: vendor COMPLETED on the delivery arm ─────────────────────────────────
const b2 = deriveOrderView({
  masterStatus: 'PREPARING',
  vendorStatuses: [V('v1', 'COMPLETED')],
  fulfillmentType: 'HOME_DELIVERY',
  runnerId: null,
})
assert(b2.displayStatus === 'READY',
  'B2: vendor COMPLETED on HOME_DELIVERY → displayStatus READY (clamped: "handed to runner")')
assert(b2.isCompleted === false,
  'B2: NOT completed — the runner still has the food')
assert(b2.delivery !== null && b2.delivery.state === 'active' && b2.delivery.activeIndex === 3,
  'B2: the delivery BAR agrees — segment 3/active, not 6/complete (the raw lane would say complete)')

// POSITIVE CONTROL for B2: the probe CAN say complete, on the same arm.
const delivered = deriveOrderView({
  masterStatus: 'DELIVERED',
  vendorStatuses: [V('v1', 'COMPLETED')],
  fulfillmentType: 'HOME_DELIVERY',
  runnerId: 'r1',
  collectedAt: '2026-08-10T12:00:00Z',
})
assert(delivered.isCompleted === true && delivered.displayStatus === 'DELIVERED',
  'B2 control: DELIVERED → isCompleted TRUE (the probe is not stuck on false)')
assert(delivered.delivery !== null && delivered.delivery.activeIndex === 6,
  'B2 control: the bar reaches segment 6 when the food actually arrived')

// Booth pickup is NOT clamped — the arm split is real, not a blanket suppression.
const boothDone = deriveOrderView({
  masterStatus: 'PREPARING',
  vendorStatuses: [V('v1', 'COMPLETED')],
  fulfillmentType: 'BOOTH_PICKUP',
})
assert(boothDone.displayStatus === 'COMPLETED' && boothDone.isCompleted === true,
  'arm control: the SAME lane on BOOTH_PICKUP → COMPLETED (the clamp is delivery-only)')
assert(boothDone.delivery === null, 'booth orders carry no delivery progress')

// ── The lossy-money case the writer abstains on ──────────────────────────────
const completedThenRefunded = deriveOrderView({
  masterStatus: 'COMPLETED',
  vendorStatuses: [V('v1', 'COMPLETED'), V('v2', 'REFUNDED')],
  fulfillmentType: 'BOOTH_PICKUP',
})
assert(completedThenRefunded.isCancelled === false && completedThenRefunded.isCompleted === true,
  '[COMPLETED, REFUNDED] → completed, NOT cancelled (a refund is a money event, not a cancellation)')

// ── The single-vendor pre-accept cancel (the 985fa47 path, now through the view) ──
const optimisticCancel = deriveOrderView({
  masterStatus: 'CANCELLED',
  vendorStatuses: [V('v1', 'REFUNDED')],
  fulfillmentType: 'BOOTH_PICKUP',
})
assert(optimisticCancel.isCancelled === true,
  'optimistic cancel: master CANCELLED + lane REFUNDED → isCancelled TRUE (the view flips without a reload)')
assert(optimisticCancel.canCancel === false, 'optimistic cancel: the cancel button is gone afterwards')

// ── canCancel across the ladder ──────────────────────────────────────────────
const cancelCases: [string, string[], boolean][] = [
  ['single PLACED',            ['PLACED'],              true],
  ['single ACCEPTED',          ['ACCEPTED'],            false],
  ['single READY',             ['READY'],               false],
  ['multi both PLACED',        ['PLACED', 'PLACED'],    true],
  ['multi one ACCEPTED',       ['PLACED', 'ACCEPTED'],  false],
  ['multi one DECLINED',       ['PLACED', 'DECLINED'],  true],
]
for (const [label, lanes, want] of cancelCases) {
  const v = deriveOrderView({
    masterStatus: 'PLACED',
    vendorStatuses: lanes.map((s, i) => V(`v${i}`, s)),
    fulfillmentType: 'BOOTH_PICKUP',
  })
  assert(v.canCancel === want, `canCancel — ${label} → ${want}`)
}

// ── Lanes are keyed by vendorId, never positional (B3) ───────────────────────
const lanes = deriveOrderView({
  masterStatus: 'PLACED',
  vendorStatuses: [V('vA', 'READY'), V('vB', 'PLACED')],
  fulfillmentType: 'BOOTH_PICKUP',
})
assert(lanes.perVendor.get('vA')?.status === 'READY' && lanes.perVendor.get('vB')?.status === 'PLACED',
  'B3: each lane is retrievable BY vendorId (no positional [0] read possible)')
assert(lanes.perVendor.get('vA')?.step === 3 && lanes.perVendor.get('vB')?.failed === false,
  'B3: lanes carry their own step + failed flag')
assert(lanes.displayStatus === 'PLACED',
  'B3: the headline is the MIN across lanes — the fastest vendor does not speak for the order')

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] shared clamp: the view routes through the WRITER\'s derivation')

// Not "the two happen to agree today" — the view must produce what deriveMasterStatus
// produces, across the whole ladder, or it has started doing its own arithmetic again.
const clampCases: [string, string[], string][] = [
  ['HOME_DELIVERY', ['PLACED'],              'PLACED'],
  ['HOME_DELIVERY', ['ACCEPTED'],            'ACCEPTED'],
  ['HOME_DELIVERY', ['PREPARING'],           'PREPARING'],
  ['HOME_DELIVERY', ['READY'],               'READY'],
  ['HOME_DELIVERY', ['COMPLETED'],           'READY'],
  ['CURBSIDE',      ['COMPLETED'],           'READY'],
  ['BOOTH_PICKUP',  ['COMPLETED'],           'COMPLETED'],
  ['BOOTH_PICKUP',  ['READY', 'PREPARING'],  'PREPARING'],
]
for (const [arm, laneStatuses, want] of clampCases) {
  const vendorStatuses = laneStatuses.map((s, i) => V(`v${i}`, s))
  const writer = deriveMasterStatus({ fulfillmentType: arm as 'BOOTH_PICKUP', vendorStatuses })
  const reader = deriveOrderView({ masterStatus: 'PLACED', vendorStatuses, fulfillmentType: arm })
  assert(writer.derived === want && reader.displayStatus === want,
    `${arm} [${laneStatuses.join(', ')}] → ${want} — writer and reader return the SAME value`)
}

const viewSrc = readFileSync(new URL('../lib/order-view.ts', import.meta.url), 'utf8')
assert(/import\s*\{[^}]*deriveMasterStatus[^}]*\}\s*from\s*'\.\/order-derive'/.test(viewSrc),
  'order-view imports deriveMasterStatus from the shared core (does not re-implement the arm logic)')
assert(/canAdvance\s*\(/.test(viewSrc),
  'order-view applies the writer\'s canAdvance monotonic guard')
assert(!/HOME_DELIVERY'\s*\|\|/.test(viewSrc) && !viewSrc.includes("=== 'CURBSIDE'"),
  'order-view has NO hand-rolled arm test (that is isDeliveryArm\'s job)')

// The client must not be able to reach the server-only module graph.
const derive = readFileSync(new URL('../lib/order-derive.ts', import.meta.url), 'utf8')
for (const banned of ['./db', '@prisma/client', './queues', './firebase-sync', 'next/cache']) {
  assert(!derive.includes(`'${banned}'`),
    `order-derive does not reach ${banned} (it is imported by client code)`)
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] source shape: no banned representation in the tracking tree')

/**
 * SCOPED DELIBERATELY. `liveStatus` also exists on app/admin/[eventSlug]/dashboard/page.tsx,
 * where it means a VENDOR'S ONLINE/BUSY state — same name, unrelated concept — and the
 * operator order logs read master Order.status, which is CORRECT for them. Widening this list
 * without widening the exclusions would false-positive on both.
 */
const SCANNED = [
  'components/order/SingleOrderTracking.tsx',
  'components/order/MultiOrderTracking.tsx',
  'components/order/OrderComponents.tsx',
  'components/order/helpers.ts',
  'components/order/types.ts',
  'app/fair/[fairSlug]/order/[orderId]/page.tsx',
]

interface Violation { rule: string; file: string }
const RULES: { rule: string; re: RegExp }[] = [
  { rule: 'liveStatus identifier',            re: /\bliveStatus\b/ },
  { rule: 'positional vendorOrderStatuses[0]', re: /vendorOrderStatuses\s*(\?\.)?\s*\[\s*0\s*\]/ },
  { rule: 'TERMINAL_STATUSES.includes(',      re: /TERMINAL_STATUSES\s*\.\s*includes\s*\(/ },
  { rule: "inline === 'COMPLETED' || === 'DELIVERED'", re: /===\s*'COMPLETED'\s*\|\|[^\n]*===\s*'DELIVERED'/ },
]

/** The scanner, as a function, so [4] can run it against a planted violation. */
function scan(files: { path: string; body: string }[]): Violation[] {
  const found: Violation[] = []
  for (const { path, body } of files) {
    // Comments are prose ABOUT the old representation — the whole point is that the file
    // explains what it used to do. Strip them before matching, or the fix trips its own guard.
    const code = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    for (const { rule, re } of RULES) if (re.test(code)) found.push({ rule, file: path })
  }
  return found
}

const scannedFiles = SCANNED.map(path => ({
  path,
  body: readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'),
}))
const violations = scan(scannedFiles)
for (const { rule, re } of RULES) {
  const hits = violations.filter(v => v.rule === rule)
  assert(hits.length === 0, `no "${rule}" in the tracking tree${hits.length ? ` — found in ${hits.map(h => h.file).join(', ')}` : ''}`)
  void re
}
assert(scannedFiles.every(f => f.body.length > 0), 'every scanned file was actually read (paths are not stale)')
assert(scannedFiles.some(f => f.body.includes('deriveOrderView') || f.body.includes('OrderView')),
  'the tracking tree does reference the derived view (it did not just delete the reads)')

// The exclusion is real, not theoretical: prove the colliding name still exists elsewhere.
const adminDash = readFileSync(new URL('../app/admin/[eventSlug]/dashboard/page.tsx', import.meta.url), 'utf8')
assert(/\bliveStatus\b/.test(adminDash),
  'admin dashboard still uses `liveStatus` for vendor online/busy — proving the scope, not the rule, is what excludes it')
assert(!SCANNED.includes('app/admin/[eventSlug]/dashboard/page.tsx'),
  'admin dashboard is OUT of the scanned set (different concept, same identifier)')

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] positive control ON THE SCANNER — it can fail')

const planted = [
  { path: 'planted/a.tsx', body: 'const x = liveStatus' },
  { path: 'planted/b.tsx', body: 'const s = order.vendorOrderStatuses?.[0]?.status' },
  { path: 'planted/c.tsx', body: 'if (TERMINAL_STATUSES.includes(s)) return null' },
  { path: 'planted/d.tsx', body: "const done = s === 'COMPLETED' || s === 'DELIVERED'" },
]
const plantedHits = scan(planted)
for (const { rule } of RULES) {
  assert(plantedHits.some(v => v.rule === rule), `scanner CATCHES a planted "${rule}"`)
}
assert(scan([{ path: 'clean.tsx', body: 'const { displayStatus } = view' }]).length === 0,
  'scanner stays quiet on clean code (it is not matching everything)')
assert(scan([{ path: 'commented.tsx', body: '// this used to read liveStatus\nconst { view } = props' }]).length === 0,
  'scanner ignores COMMENTS (the fix documents the old representation by name)')

console.log(`\n${'─'.repeat(60)}\n${fail === 0 ? '✅' : '❌'} order-view-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
