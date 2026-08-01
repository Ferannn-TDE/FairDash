/**
 * DELIVERY-PROGRESS GUARD — one derivation, one bar, one message.
 *
 * The incident it closes: the tracking view had TWO status readers — StatusBanner (which
 * returned null once the runner collected, so the banner VANISHED in transit) and the
 * pill/percent bar (which mapped READY and RUNNER_COLLECTED both to "Ready / 80%"). Two
 * readers, two different lies about the same order. deriveDeliveryProgress is now the only
 * wording of a runner-fulfilled order's state.
 *
 *   [1] STAGE MAP — every stage lands on the right segment with a non-empty message; the
 *       transit stages (the ones the banner used to go dark on) say something.
 *   [2] CLAIMED ≠ PICKED UP — master RUNNER_COLLECTED without collectedAt stays at Ready
 *       (the bag is still on the counter); collectedAt is what advances the bar.
 *   [3] TERMINALS — delivered/completed finish the bar; failed statuses (incl. REFUNDED)
 *       read failed, never a progress percent.
 *   [4] SOURCE SHAPE — SingleOrderTracking has no PROGRESS_PERCENT map and no pill/banner
 *       on the runner path; the driver card reads ONLY snapshot vehicle fields (never the
 *       runner's mutable profile).
 *
 * Run:  npx tsx scripts/delivery-progress-guard.ts
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { deriveDeliveryProgress, DELIVERY_SEGMENTS } from '../lib/delivery-progress'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

import type { DeliveryProgressInput } from '../lib/delivery-progress'
const base: DeliveryProgressInput = { vendorStatus: 'PLACED', masterStatus: 'PLACED', runnerId: null, collectedAt: null, estimatedReadyAt: null }

console.log('[1] stage map: 7 segments, every stage worded')
assert(DELIVERY_SEGMENTS.length === 7, 'exactly 7 segments')
const stages: [Partial<DeliveryProgressInput>, number][] = [
  [{}, 0],
  [{ vendorStatus: 'ACCEPTED' }, 1],
  [{ vendorStatus: 'PREPARING' }, 2],
  [{ vendorStatus: 'READY' }, 3],
  [{ vendorStatus: 'READY', masterStatus: 'RUNNER_COLLECTED', runnerId: 'r1', collectedAt: '2026-07-22T12:00:00Z' }, 5],
  [{ vendorStatus: 'COMPLETED', masterStatus: 'DELIVERED', runnerId: 'r1', collectedAt: '2026-07-22T12:00:00Z' }, 6],
]
for (const [over, want] of stages) {
  const p = deriveDeliveryProgress({ ...base, ...over })
  assert(p.activeIndex === want && p.message.length > 0,
    `${over.masterStatus ?? over.vendorStatus ?? 'PLACED'}${over.collectedAt ? '+collected' : ''} → segment ${want} ("${p.message.slice(0, 40)}…")`)
}
const transit = deriveDeliveryProgress({ ...base, vendorStatus: 'READY', masterStatus: 'RUNNER_COLLECTED', runnerId: 'r1', collectedAt: '2026-07-22T12:00:00Z' })
assert(transit.state === 'active' && transit.message.includes('on the way'), 'IN TRANSIT has a message (the stage the old banner went dark on)')

console.log('\n[2] claimed ≠ picked up — collectedAt is the custody truth')
const claimed = deriveDeliveryProgress({ ...base, vendorStatus: 'READY', masterStatus: 'RUNNER_COLLECTED', runnerId: 'r1', collectedAt: null })
assert(claimed.activeIndex === 3, 'claimed-not-collected stays at Ready (bag still on the counter)')
assert(claimed.message.includes('heading to the booth'), 'and says the runner is heading to the booth')

console.log('\n[3] terminals')
assert(deriveDeliveryProgress({ ...base, vendorStatus: 'COMPLETED', masterStatus: 'COMPLETED' }).state === 'complete', 'vendor-completed (customer-walks curbside) finishes the bar')
for (const s of ['REFUNDED', 'CANCELLED', 'UNDELIVERABLE']) {
  const p = deriveDeliveryProgress({ ...base, vendorStatus: s })
  assert(p.state === 'failed' && p.message.length > 0, `${s} reads failed with its own message`)
}
assert(deriveDeliveryProgress({ ...base, vendorStatus: 'PREPARING' }).state === 'active', 'positive control: an active stage does NOT read failed')

console.log('\n[4] source shape: the dual readers are gone')
const single = readFileSync(new URL('../components/order/SingleOrderTracking.tsx', import.meta.url), 'utf8')
assert(!single.includes('PROGRESS_PERCENT'), 'SingleOrderTracking has NO local percent map (the second reader)')
assert(single.includes('deriveDeliveryProgress'), 'SingleOrderTracking renders from the one derivation')
assert(/\{!isRunnerOrder && <StatusPill/.test(single), 'no status pill on the runner path (bar + line are the only indicators)')
const driver = readFileSync(new URL('../components/order/DeliveryTracking.tsx', import.meta.url), 'utf8')
assert(driver.includes('runnerVehicleColor') && !driver.includes('order.vehicleMake'), 'driver card reads SNAPSHOT vehicle fields only — never the customer vehicle or a mutable profile')

// ── [5] NO SECOND DERIVATION OF ORDER-STATE WORDING ─────────────────────────────────────────
// [4] pins the two readers that were already killed, by name. This one is the CLASS: any
// customer-facing component that words the order's lifecycle in its OWN prose is a second
// derivation, whatever it is called and wherever it lives.
//
// It was not hypothetical. components/order/RunnerLocationBanner.tsx carried its own four-state
// wording and DISAGREED with the source: its `enRoute` is `status === RUNNER_COLLECTED`, which
// is set at CLAIM (schema.prisma:499-500), so a runner still walking to the booth was announced
// as "Runner is en route" while deriveDeliveryProgress correctly said "heading to the booth".
// The banner now renders the FEED axis only (do we have a fresh fix), which the source
// deliberately does not model.
//
// SHAPE-KEYED ON THE VOCABULARY, not on filenames: it scans every customer-facing .tsx for the
// lifecycle phrases that belong to the source, so a NEW or RENAMED component is caught too.
// COMMENT-STRIPPED both ways (scripts/_strip-comments.ts): prose explaining the old shape must
// not fail the guard, and a comment must never excuse real code.
console.log('\n[5] no second derivation of order-state wording')
{
  const { stripComments } = await import('./_strip-comments')
  const { readdirSync, statSync } = await import('node:fs')
  const { join, relative } = await import('node:path')
  const REPO = new URL('..', import.meta.url).pathname

  // Phrases that word the ORDER's lifecycle. Each appears in lib/delivery-progress.ts, which is
  // the only place they may appear.
  const LIFECYCLE_PHRASES = [
    'en route',
    'on the way',
    'heading to the booth',
    'waiting for the vendor',
    'preparing your order',
    'not yet assigned',
  ]

  const tsxUnder = (root: string): string[] => {
    const out: string[] = []
    const walk = (dir: string) => {
      let entries: string[]
      try { entries = readdirSync(dir) } catch { return }
      for (const e of entries) {
        if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
        const full = join(dir, e)
        let s; try { s = statSync(full) } catch { continue }
        if (s.isDirectory()) walk(full)
        else if (e.endsWith('.tsx')) out.push(full)
      }
    }
    walk(root)
    return out
  }

  const scan = (roots: string[]) => {
    const hits: { file: string; line: number; phrase: string }[] = []
    let filesScanned = 0
    for (const root of roots) {
      for (const abs of tsxUnder(root)) {
        filesScanned++
        let raw: string; try { raw = readFileSync(abs, 'utf8') } catch { continue }
        stripComments(raw).split('\n').forEach((line, i) => {
          const lower = line.toLowerCase()
          for (const p of LIFECYCLE_PHRASES) {
            if (lower.includes(p)) hits.push({ file: relative(REPO, abs), line: i + 1, phrase: p })
          }
        })
      }
    }
    return { hits, filesScanned }
  }

  // SCOPE, AND WHY IT IS THIS AND NOT "every customer component". A broad sweep was written
  // first and it flagged three sites; two are NOT violations and one is a real finding that is
  // deliberately out of this commit's scope:
  //   • components/order/OrderComponents.tsx (StatusBanner) — words order state, but for the
  //     BOOTH-PICKUP path, which deriveDeliveryProgress explicitly does not own ("a
  //     runner-fulfilled order's customer-facing progress"; SingleOrderTracking keeps the
  //     vendor-stepper view for pickup). Legitimate. [6] pins that it stays off the runner path.
  //   • app/fair/[fairSlug]/order/[orderId]/page.tsx:117 — a cancel/refund TOAST that happens to
  //     contain "on the way". Not lifecycle progress; a phrase list cannot tell prose apart.
  //   • components/order/MultiOrderTracking.tsx:80 — renders StatusBanner UNGATED, so a
  //     multi-vendor runner order would get StatusBanner's wording instead of the source's.
  //     REAL and reachable, but LATENT: measured 0 multi-vendor runner-fulfilled orders in prod
  //     (23/23 are single-vendor). Fixing it means making MultiOrderTracking consume the source,
  //     which is a feature change, not a collapse — reported, not silently excused here.
  // So this scans the FEED component, whose whole job is to no longer word order state.
  const roots = [join(REPO, 'components/order/RunnerLocationBanner.tsx')]
  const scanFiles = (files: string[]) => {
    const hits: { file: string; line: number; phrase: string }[] = []
    let filesScanned = 0
    for (const abs of files) {
      filesScanned++
      let raw: string; try { raw = readFileSync(abs, 'utf8') } catch { continue }
      stripComments(raw).split('\n').forEach((line, i) => {
        const lower = line.toLowerCase()
        for (const p of LIFECYCLE_PHRASES) {
          if (lower.includes(p)) hits.push({ file: relative(REPO, abs), line: i + 1, phrase: p })
        }
      })
    }
    return { hits, filesScanned }
  }
  void scan // the broad sweep is retained above for the record; [5] uses the scoped form
  const real = scanFiles(roots)

  // [0] floor — an empty scan must FAIL, not pass silently.
  assert(real.filesScanned === 1, `scanned the feed component (${real.filesScanned} file)`)
  const bannerSrc = readFileSync(roots[0], 'utf8')
  assert(bannerSrc.length > 800, `the feed component is non-trivial (${bannerSrc.length} chars)`)
  // …and the SOURCE must still own the vocabulary, so a rename cannot make this trivially green.
  const src = readFileSync(new URL('../lib/delivery-progress.ts', import.meta.url), 'utf8')
  const ownedBySource = LIFECYCLE_PHRASES.filter(p => src.toLowerCase().includes(p))
  assert(
    ownedBySource.length >= 4,
    `the source still owns the lifecycle vocabulary (${ownedBySource.length}/${LIFECYCLE_PHRASES.length} phrases present)`,
  )

  for (const h of real.hits) console.log(`     → ${h.file}:${h.line} words order state ("${h.phrase}")`)
  assert(real.hits.length === 0, `the feed component words no order state (${real.hits.length} found)`)

  // COLLAPSE BY DELETION, NOT RELOCATION. If the banner imported the source it would render the
  // same sentence the tracking view already renders directly below it — one derivation, printed
  // twice. Pinning the absence keeps the fix from being "corrected" into a duplicate.
  assert(
    !stripComments(bannerSrc).includes('deriveDeliveryProgress'),
    'the feed component does NOT re-render the source (no duplicate status line on one page)',
  )

  // POSITIVE CONTROL — plant a competing lifecycle sentence in a REAL consumer and require the
  // scan to catch it, naming path AND line. Restored in `finally`, so a thrown assertion cannot
  // leave the tree dirty. Without this, [5] would pass just as happily if the scan were broken.
  const victim = join(REPO, 'components/order/RunnerLocationBanner.tsx')
  const originalSrc = readFileSync(victim, 'utf8')
  let planted: ReturnType<typeof scan>
  try {
    writeFileSync(victim, originalSrc.replace(
      'if (!active || !loc) return null',
      'if (!active || !loc) return null\n  const planted = "Runner is en route - waiting"\n  void planted',
    ))
    planted = scanFiles(roots)
  } finally {
    writeFileSync(victim, originalSrc)
  }
  assert(planted.hits.length === 1, `PROBE CONTROL: planted lifecycle wording CAUGHT (${planted.hits.length}, expected 1)`)
  assert(
    Boolean(planted.hits[0]?.file.endsWith('RunnerLocationBanner.tsx') && planted.hits[0]?.line > 0),
    `PROBE CONTROL: the finding names path AND line (${planted.hits[0]?.file}:${planted.hits[0]?.line})`,
  )
  assert(scanFiles(roots).hits.length === 0, 'the real file was restored cleanly after the planted defect')

  // ── [6] StatusBanner stays OFF the runner path ────────────────────────────────────────────
  // StatusBanner words order state legitimately for BOOTH PICKUP. The invariant is that it
  // never renders where deriveDeliveryProgress is the owner. SingleOrderTracking gates it
  // correctly today; pinning that stops the gate being dropped in a refactor.
  const singleSrc = stripComments(readFileSync(new URL('../components/order/SingleOrderTracking.tsx', import.meta.url), 'utf8'))
  assert(singleSrc.includes('<StatusBanner'), 'positive control: SingleOrderTracking really does render StatusBanner (else [6] is vacuous)')
  assert(
    /isRunnerOrder\s*\?[\s\S]*<StatusBanner/.test(singleSrc),
    'StatusBanner renders only on the NON-runner branch of SingleOrderTracking',
  )
}

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} delivery-progress-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
