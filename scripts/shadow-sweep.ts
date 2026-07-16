/**
 * Phase 0 — LIVE shadow sweep (READ-ONLY against the real DB).
 *
 * Run:  npx tsx scripts/shadow-sweep.ts
 *
 * Maps shadowReconcile's pure derivation over real orders and reports the same
 * divergence buckets the matrix produced — this time against reality, which has
 * shapes the matrix never constructed (voided test orders, partial refunds,
 * pre-migration orders with no per-vendor rows, multi-vendor mixed states).
 *
 * WRITES NOTHING. No update, no enqueue, no Firebase. Pure read + classify.
 *
 * Gate buckets (REGRESSION_RISK / UNEXPECTED) are kept honest by pre-sorting the
 * known-benign historical shapes into their own buckets FIRST, then classifying
 * the rest. Every flagged row is also cross-checked against canAdvance() — the
 * Phase-1 write guard — so we can see whether the guard would protect it even if
 * the classifier flags it.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { db } from '../lib/db'
import {
  deriveMasterStatus, classifyDivergence, canAdvance,
  MASTER_RANK, type MasterStatus, type FulfillmentType, type Divergence,
} from '../lib/reconcile-order-status'

const TERMINAL = new Set<MasterStatus>(['COMPLETED', 'DELIVERED', 'CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE'])

type Bucket = Divergence | 'SKIP_VOIDED' | 'ABSTAIN'

interface Row {
  id: string
  status: MasterStatus
  fulfillmentType: FulfillmentType
  runnerId: string | null
  deliveryProofPath: string | null
  voidedAt: Date | null
  placedAt: Date | null
  vendorOrderStatuses: { status: string }[]
}

async function main() {
  console.log('\n[shadow-sweep] READ-ONLY — writes nothing. Reading orders…\n')

  const orders = (await db.order.findMany({
    select: {
      id: true, status: true, fulfillmentType: true,
      runnerId: true, deliveryProofPath: true, voidedAt: true, placedAt: true,
      vendorOrderStatuses: { select: { status: true } },
    },
    orderBy: { placedAt: 'desc' },
  })) as unknown as Row[]

  const tally: Record<Bucket, number> = {
    MATCH: 0, UNDER_ADVANCED: 0, BENIGN_OVERRIDE: 0, REGRESSION_RISK: 0,
    UNEXPECTED: 0, SKIP_VOIDED: 0, ABSTAIN: 0,
  }

  const examples: Record<string, Row[]> = {}
  const keep = (k: string, r: Row, max = 6) => { (examples[k] ??= []).length < max && examples[k].push(r) }

  // Specific shapes the prompt asked to watch for
  let strandedHandoff = 0           // delivery/curbside, stored PLACED, derived READY (the live bug)
  let boothMidFlight = 0            // booth, stored PLACED, derived ACCEPTED/PREPARING/READY
  let partialRefund = 0             // some portions REFUNDED, others still active
  let multiVendorMixed = 0          // >1 vendor, portions in different states
  let guardWouldRegress = 0         // ANY row where canAdvance=yes toward a lower-or-terminal — must be 0
  let phase1WouldPromote = 0        // derived READY + canAdvance — what Phase 1 WRITE touches today
  let phase2DerivesCompleted = 0    // derived COMPLETED + canAdvance — Phase 1 must NOT touch (Phase 2)

  for (const o of orders) {
    const rows = o.vendorOrderStatuses
    const isVoided = o.voidedAt != null

    // ── Pre-sort known-benign historical shapes ──────────────────────────────
    if (isVoided) {
      // Voided test orders MUST derive SKIP and never be touched.
      const d = deriveMasterStatus({
        fulfillmentType: o.fulfillmentType, vendorStatuses: rows,
        runnerId: o.runnerId, deliveryProofPath: o.deliveryProofPath, voided: true,
      })
      if (d.derived !== 'SKIP') { keep('VOIDED_NOT_SKIPPED', o); tally.UNEXPECTED++; continue }
      tally.SKIP_VOIDED++
      continue
    }

    // ── Normal derivation + classification ───────────────────────────────────
    const d = deriveMasterStatus({
      fulfillmentType: o.fulfillmentType, vendorStatuses: rows,
      runnerId: o.runnerId, deliveryProofPath: o.deliveryProofPath, voided: false,
    })

    // The derivation now ABSTAINS (SKIP) where it has no jurisdiction: no
    // per-vendor rows (pre-migration / pre-placement) or all-portions-terminal
    // with a REFUNDED among them (lossy money state). Abstain asserts nothing,
    // so it is never a divergence — bucket it separately for visibility.
    if (d.derived === 'SKIP') {
      keep(rows.length === 0 ? 'ABSTAIN_NO_ROWS' : 'ABSTAIN_ALL_REFUNDED', o)
      tally.ABSTAIN++
      continue
    }

    const div = classifyDivergence(o.status, d.derived)
    tally[div]++

    // d.derived is narrowed to MasterStatus here — SKIP was handled above.
    const derived = d.derived as MasterStatus
    const advance = canAdvance(o.status, derived)

    // Phase 1 write scope: promotes ONLY when derived READY and the guard allows.
    if (derived === 'READY' && advance) { phase1WouldPromote++; keep('PHASE1_WOULD_PROMOTE', o) }
    // Phase 2 scope (must stay untouched by Phase 1): derived COMPLETED forward.
    if (derived === 'COMPLETED' && advance) { phase2DerivesCompleted++; keep('PHASE2_DERIVES_COMPLETED', o) }

    // Shape detectors
    const statuses = rows.map(r => r.status)
    const hasRefunded = statuses.includes('REFUNDED')
    const hasActive = statuses.some(s => !['DECLINED', 'REFUNDED', 'CANCELLED'].includes(s))
    const isDelivery = o.fulfillmentType === 'HOME_DELIVERY' || o.fulfillmentType === 'CURBSIDE'
    if (hasRefunded && hasActive) { partialRefund++; keep('PARTIAL_REFUND', o) }
    if (rows.length > 1 && new Set(statuses).size > 1) { multiVendorMixed++; keep('MULTI_VENDOR_MIXED', o) }

    if (div === 'UNDER_ADVANCED') {
      if (isDelivery && o.status === 'PLACED' && derived === 'READY') { strandedHandoff++; keep('STRANDED_HANDOFF', o) }
      else if (!isDelivery && o.status === 'PLACED') { boothMidFlight++; keep('BOOTH_MIDFLIGHT', o) }
      else keep('UNDER_ADVANCED_OTHER', o)
      // Sanity: an under-advanced repair must be a monotonic-safe forward move.
      if (!advance) { keep('UNDER_ADVANCED_BUT_GUARD_BLOCKS', o) }
    }

    // The one thing that must NEVER happen: the guard would advance an order to a
    // LOWER rank or off a terminal. (canAdvance already forbids this, but verify.)
    if (advance) {
      const rs = MASTER_RANK[o.status]; const rd = MASTER_RANK[derived]
      if (TERMINAL.has(o.status) || rd < rs) { guardWouldRegress++; keep('GUARD_WOULD_REGRESS', o) }
    }

    if (div === 'REGRESSION_RISK' || div === 'UNEXPECTED') keep(div, o)
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const fmt = (o: Row) =>
    `    ${o.id}  type=${o.fulfillmentType.padEnd(13)} stored=${o.status.padEnd(15)} ` +
    `derived=${deriveMasterStatus({ fulfillmentType: o.fulfillmentType, vendorStatuses: o.vendorOrderStatuses, runnerId: o.runnerId, deliveryProofPath: o.deliveryProofPath, voided: o.voidedAt != null }).derived.padEnd(15)} ` +
    `runner=${o.runnerId ? 'Y' : '-'} photo=${o.deliveryProofPath ? 'Y' : '-'} ` +
    `vendors=[${o.vendorOrderStatuses.map(v => v.status).join(',')}]`

  console.log(`Total orders swept: ${orders.length}\n`)
  console.log('Divergence buckets (live):')
  for (const k of Object.keys(tally) as Bucket[]) {
    if (tally[k] > 0) console.log(`  ${k.padEnd(18)} ${tally[k]}`)
  }

  console.log('\nShape detectors:')
  console.log(`  stranded handoff bug (delivery/curbside, PLACED→READY): ${strandedHandoff}   ← live blast radius Phase 1 fixes`)
  console.log(`  booth mid-flight (PLACED→ACCEPTED/PREPARING/READY):     ${boothMidFlight}   (latent, harmless today)`)
  console.log(`  partial-refund orders (some REFUNDED, some active):     ${partialRefund}`)
  console.log(`  multi-vendor mixed per-vendor states:                   ${multiVendorMixed}`)
  console.log(`  abstain — no rows / all-refunded (no jurisdiction):     ${tally.ABSTAIN}`)
  console.log(`  voided → SKIP:                                          ${tally.SKIP_VOIDED}`)
  console.log('')
  console.log(`  PHASE 1 would promote (derived READY + canAdvance):     ${phase1WouldPromote}   ← live writes Phase 1 makes now`)
  console.log(`  PHASE 2 scope (derived COMPLETED + canAdvance):         ${phase2DerivesCompleted}   ← Phase 1 must NOT touch these`)

  const showcats = [
    'STRANDED_HANDOFF', 'BOOTH_MIDFLIGHT', 'PARTIAL_REFUND', 'MULTI_VENDOR_MIXED',
    'ABSTAIN_NO_ROWS', 'ABSTAIN_ALL_REFUNDED', 'UNDER_ADVANCED_OTHER', 'REGRESSION_RISK',
    'UNEXPECTED', 'VOIDED_NOT_SKIPPED', 'UNDER_ADVANCED_BUT_GUARD_BLOCKS', 'GUARD_WOULD_REGRESS',
  ]
  for (const cat of showcats) {
    if (examples[cat]?.length) {
      console.log(`\n  ── ${cat} (showing ${examples[cat].length}) ──`)
      examples[cat].forEach(o => console.log(fmt(o)))
    }
  }

  // ── Gate ──────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(80))
  const hardFail =
    tally.UNEXPECTED > 0 ||
    guardWouldRegress > 0 ||
    (examples['UNDER_ADVANCED_BUT_GUARD_BLOCKS']?.length ?? 0) > 0 ||
    (examples['VOIDED_NOT_SKIPPED']?.length ?? 0) > 0

  // REGRESSION_RISK from the classifier is only a TRUE danger if the guard would
  // actually advance it. Report whether the guard protects every such row.
  const regrGuarded = (examples['REGRESSION_RISK'] ?? []).every(o => {
    const d = deriveMasterStatus({ fulfillmentType: o.fulfillmentType, vendorStatuses: o.vendorOrderStatuses, runnerId: o.runnerId, deliveryProofPath: o.deliveryProofPath, voided: o.voidedAt != null })
    return d.derived === 'SKIP' || !canAdvance(o.status, d.derived as MasterStatus)
  })

  if (tally.REGRESSION_RISK > 0) {
    console.log(`REGRESSION_RISK classifier count: ${tally.REGRESSION_RISK} — guard-protected (adv=no) for all: ${regrGuarded ? 'YES ✓' : 'NO ✗'}`)
  }

  if (hardFail || (tally.REGRESSION_RISK > 0 && !regrGuarded)) {
    console.log('✗ GATE FAILED — surprising shape that the write guard would NOT protect. Inspect above before Phase 1.')
    process.exitCode = 1
  } else {
    console.log('✓ GATE PASSED — UNEXPECTED 0, guard regresses nothing, voided all SKIP.')
    console.log('  Every UNDER_ADVANCED row is a monotonic-safe forward repair (the live handoff bug + benign booth mid-flight).')
  }
  console.log('─'.repeat(80) + '\n')

  await db.$disconnect()
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
