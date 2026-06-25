/**
 * Phase 1 — write-decision verification (PURE, no DB).
 *
 * Run:  npx tsx scripts/phase1-verify.ts
 *
 * promoteReadyIfDerived's decision is exactly:
 *     derive(order) === 'READY'  AND  canAdvance(stored, 'READY')
 * then a monotonic status-conditional flip. This harness exercises that decision
 * across the key shapes and asserts:
 *   • Phase 1 promotes ONLY to READY (never COMPLETED/CANCELLED — that's Phase 2).
 *   • It never advances a RUNNER_COLLECTED / DELIVERED / terminal order (monotonic).
 *   • A promoted HOME_DELIVERY/CURBSIDE order satisfies the runner-feed predicate
 *     (status READY, fulfillment ∈ {HOME_DELIVERY,CURBSIDE}, runnerId null) — i.e.
 *     the handoff bug is fixed: the order becomes claimable.
 */
import {
  deriveMasterStatus, canAdvance,
  type MasterStatus, type FulfillmentType,
} from '../lib/reconcile-order-status'

const vs = (...s: string[]) => s.map(status => ({ status }))

interface Case {
  label: string
  type: FulfillmentType
  vendors: { status: string }[]
  runnerId?: string | null
  photo?: string | null
  stored: MasterStatus
  expectPromote: boolean // does Phase 1 write READY?
}

// Mirror of the function's decision (derive → READY? → canAdvance? → write).
function decide(c: Case) {
  const { derived } = deriveMasterStatus({
    fulfillmentType: c.type, vendorStatuses: c.vendors, runnerId: c.runnerId, curbsidePhotoUrl: c.photo,
  })
  const willPromote = derived === 'READY' && canAdvance(c.stored, 'READY')
  return { derived, willPromote }
}

// The runner feed query: READY + fulfillment ∈ {HOME_DELIVERY,CURBSIDE} + unclaimed.
function claimableByRunner(type: FulfillmentType, status: MasterStatus, runnerId: string | null | undefined) {
  return status === 'READY' && (type === 'HOME_DELIVERY' || type === 'CURBSIDE') && !runnerId
}

const cases: Case[] = [
  // Promotes — the handoff fix
  { label: 'delivery: all vendors READY, no runner',     type: 'HOME_DELIVERY', vendors: vs('READY'),            stored: 'PLACED', expectPromote: true },
  { label: 'delivery multi: ALL ready',                  type: 'HOME_DELIVERY', vendors: vs('READY','READY'),    stored: 'PLACED', expectPromote: true },
  { label: 'delivery: one declined, rest READY',         type: 'HOME_DELIVERY', vendors: vs('DECLINED','READY'), stored: 'PLACED', expectPromote: true },
  { label: 'curbside: all READY (delivery arm)',         type: 'CURBSIDE',      vendors: vs('READY'),            stored: 'PLACED', expectPromote: true },
  { label: 'booth: all READY (booth-honesty win)',       type: 'BOOTH_PICKUP',  vendors: vs('READY'),            stored: 'PLACED', expectPromote: true },
  { label: 'delivery: partial ready (advance from ACCEPTED)', type: 'HOME_DELIVERY', vendors: vs('READY'),       stored: 'ACCEPTED', expectPromote: true },

  // Abstains — NOT Phase 1 scope
  { label: 'delivery: partial — one preparing',          type: 'HOME_DELIVERY', vendors: vs('READY','PREPARING'),stored: 'PLACED', expectPromote: false },
  { label: 'booth partial-refund: derives COMPLETED (Phase 2)', type: 'BOOTH_PICKUP', vendors: vs('COMPLETED','REFUNDED'), stored: 'PLACED', expectPromote: false },
  { label: 'booth: all COMPLETED — derives COMPLETED (Phase 2)', type: 'BOOTH_PICKUP', vendors: vs('COMPLETED'), stored: 'PLACED', expectPromote: false },
  { label: 'all refunded — abstain',                     type: 'BOOTH_PICKUP',  vendors: vs('REFUNDED','REFUNDED'),stored: 'PLACED', expectPromote: false },

  // Monotonicity — must NEVER promote (would regress)
  { label: 'delivery: already RUNNER_COLLECTED',         type: 'HOME_DELIVERY', vendors: vs('READY'), runnerId: 'r', stored: 'RUNNER_COLLECTED', expectPromote: false },
  { label: 'delivery: already DELIVERED',                type: 'HOME_DELIVERY', vendors: vs('READY'), runnerId: 'r', photo: 'p', stored: 'DELIVERED', expectPromote: false },
  { label: 'delivery: already READY (idempotent no-op)', type: 'HOME_DELIVERY', vendors: vs('READY'),            stored: 'READY', expectPromote: false },
  { label: 'cancelled order',                            type: 'HOME_DELIVERY', vendors: vs('DECLINED'),          stored: 'CANCELLED', expectPromote: false },
]

const RED = '\x1b[31m', GRN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m', CYN = '\x1b[36m'
let failures = 0
let claimableProven = 0

console.log(`\n${CYN}Phase 1 write-decision verification${RESET} (pure)\n`)
for (const c of cases) {
  const { derived, willPromote } = decide(c)
  const ok = willPromote === c.expectPromote
  if (!ok) failures++

  // For the cases Phase 1 promotes, prove the resulting state is runner-claimable
  // (delivery/curbside) — the handoff bug is fixed.
  let claim = ''
  if (willPromote) {
    const nowClaimable = claimableByRunner(c.type, 'READY', c.runnerId)
    if (c.type !== 'BOOTH_PICKUP') {
      if (nowClaimable) { claimableProven++; claim = `${GRN}→ runner-claimable ✓${RESET}` }
      else { failures++; claim = `${RED}→ promoted but NOT claimable ✗${RESET}` }
    } else {
      claim = `${DIM}(booth — not a runner job, correct)${RESET}`
    }
  }

  const verdict = ok ? `${GRN}OK${RESET}` : `${RED}FAIL${RESET}`
  const promo = willPromote ? `${GRN}PROMOTE→READY${RESET}` : 'abstain'
  console.log(`  ${verdict} ${c.label.padEnd(50)} stored=${c.stored.padEnd(16)} derived=${String(derived).padEnd(14)} ${promo.padEnd(24)} ${claim}`)
}

console.log('')
if (failures === 0) {
  console.log(`${GRN}✓ All decisions correct.${RESET} Phase 1 promotes only to READY, never regresses a collected/delivered/terminal order,`)
  console.log(`  and every promoted delivery/curbside order is runner-claimable (${claimableProven} proven). Handoff bug fixed.`)
} else {
  console.log(`${RED}✗ ${failures} decision failure(s) — STOP.${RESET}`)
  process.exit(1)
}
