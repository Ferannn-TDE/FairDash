/**
 * Phase 0 — Shadow-reader derivation matrix (PURE, no DB).
 *
 * Run:  npx tsx scripts/shadow-derive-matrix.ts
 *
 * Exercises deriveMasterStatus() across ALL fulfillment configurations
 * (booth-only / curbside-only / delivery-only / MIXED) and every order state,
 * with the STORED master status each writer produces TODAY, and classifies the
 * divergence. The output is the bug map the convergence is built to close.
 *
 * Reads nothing, writes nothing — proves the derivation matches reality (or
 * correctly flags the known handoff bug) before the aggregator gets any write
 * authority.
 */
import {
  deriveMasterStatus, classifyDivergence, canAdvance,
  MASTER_RANK, type MasterStatus, type FulfillmentType, type Divergence,
} from '../lib/reconcile-order-status'

type V = { status: string }
const vs = (...statuses: string[]): V[] => statuses.map(s => ({ status: s }))

interface Case {
  label: string
  type: FulfillmentType
  vendors: V[]
  runnerId?: string | null
  photo?: string | null
  // STORED master status: what the order row actually holds TODAY, given which
  // writer (W1–W7) last touched it for this scenario.
  stored: MasterStatus
  storedBy: string // which writer set `stored` today
}

// ── Helper: what the vendor route (W4) leaves master at today ────────────────
// W4 only flips master on allDeclined→CANCELLED / allTerminal→COMPLETED.
// For everything else master is frozen at PLACED from placement (W2).
const W4 = 'W4 vendor-status'
const W2 = 'W2 placement'
const W3 = 'W3 status route (runner/booth)'
const W7 = 'W7 worker timeout'

const cases: Case[] = [
  // ─────────────── BOOTH-ONLY EVENT ───────────────
  { label: 'booth single — just placed',        type: 'BOOTH_PICKUP', vendors: vs('PLACED'),               stored: 'PLACED',    storedBy: W2 },
  { label: 'booth single — accepted',           type: 'BOOTH_PICKUP', vendors: vs('ACCEPTED'),             stored: 'PLACED',    storedBy: W4 },
  { label: 'booth single — preparing',          type: 'BOOTH_PICKUP', vendors: vs('PREPARING'),            stored: 'PLACED',    storedBy: W4 },
  { label: 'booth single — READY',              type: 'BOOTH_PICKUP', vendors: vs('READY'),                stored: 'PLACED',    storedBy: W4 },
  { label: 'booth single — completed',          type: 'BOOTH_PICKUP', vendors: vs('COMPLETED'),            stored: 'COMPLETED', storedBy: W4 },
  { label: 'booth single — declined',           type: 'BOOTH_PICKUP', vendors: vs('DECLINED'),             stored: 'CANCELLED', storedBy: W4 },
  { label: 'booth multi — all completed',       type: 'BOOTH_PICKUP', vendors: vs('COMPLETED','COMPLETED'),stored: 'COMPLETED', storedBy: W4 },
  { label: 'booth multi — one done one ready',  type: 'BOOTH_PICKUP', vendors: vs('COMPLETED','READY'),    stored: 'PLACED',    storedBy: W4 },
  { label: 'booth multi — one declined one done',type:'BOOTH_PICKUP', vendors: vs('DECLINED','COMPLETED'), stored: 'COMPLETED', storedBy: W4 },
  { label: 'booth single — no-show (timeout)',  type: 'BOOTH_PICKUP', vendors: vs('READY'),                stored: 'UNCOLLECTED',storedBy: W7 },

  // ─────────────── CURBSIDE-ONLY EVENT (DELIVERY ARM) ───────────────
  { label: 'curbside — placed',                 type: 'CURBSIDE', vendors: vs('PLACED'),                   stored: 'PLACED',    storedBy: W2 },
  { label: 'curbside — preparing',              type: 'CURBSIDE', vendors: vs('PREPARING'),                stored: 'PLACED',    storedBy: W4 },
  { label: 'curbside — READY, no runner ⚠BUG',  type: 'CURBSIDE', vendors: vs('READY'),                   stored: 'PLACED',    storedBy: W4 },
  { label: 'curbside — claimed by runner',      type: 'CURBSIDE', vendors: vs('READY'), runnerId: 'run_1', stored: 'RUNNER_COLLECTED', storedBy: W3 },
  { label: 'curbside — delivered',              type: 'CURBSIDE', vendors: vs('COMPLETED'), runnerId: 'run_1', photo: 'p.jpg', stored: 'DELIVERED', storedBy: W3 },
  { label: 'curbside — vendor "COMPLETED" only',type: 'CURBSIDE', vendors: vs('COMPLETED'),                stored: 'PLACED',    storedBy: W4 },

  // ─────────────── DELIVERY-ONLY EVENT ───────────────
  { label: 'delivery single — placed',          type: 'HOME_DELIVERY', vendors: vs('PLACED'),              stored: 'PLACED',    storedBy: W2 },
  { label: 'delivery single — accepted',        type: 'HOME_DELIVERY', vendors: vs('ACCEPTED'),            stored: 'PLACED',    storedBy: W4 },
  { label: 'delivery single — READY, no runner ⚠BUG', type: 'HOME_DELIVERY', vendors: vs('READY'),         stored: 'PLACED',    storedBy: W4 },
  { label: 'delivery single — claimed',         type: 'HOME_DELIVERY', vendors: vs('READY'), runnerId: 'run_2', stored: 'RUNNER_COLLECTED', storedBy: W3 },
  { label: 'delivery single — delivered',       type: 'HOME_DELIVERY', vendors: vs('READY'), runnerId: 'run_2', photo: 'p.jpg', stored: 'DELIVERED', storedBy: W3 },
  { label: 'delivery multi — ALL ready ⚠BUG',   type: 'HOME_DELIVERY', vendors: vs('READY','READY','READY'),stored: 'PLACED',   storedBy: W4 },
  { label: 'delivery multi — partial ready',    type: 'HOME_DELIVERY', vendors: vs('READY','PREPARING'),   stored: 'PLACED',    storedBy: W4 },
  { label: 'delivery multi — one declined rest ready ⚠BUG', type: 'HOME_DELIVERY', vendors: vs('DECLINED','READY'), stored: 'PLACED', storedBy: W4 },
  { label: 'delivery — undeliverable (timeout)',type: 'HOME_DELIVERY', vendors: vs('READY'),               stored: 'UNDELIVERABLE', storedBy: W7 },
  { label: 'delivery — all declined',           type: 'HOME_DELIVERY', vendors: vs('DECLINED','DECLINED'), stored: 'CANCELLED', storedBy: W4 },

  // ─────────────── MIXED EVENT (all 3 enabled, flowing at once) ───────────────
  // The case most likely to expose an arm-selection bug: booth + delivery +
  // curbside orders coexisting, read by the SAME derivation.
  { label: 'mixed: booth — completed',          type: 'BOOTH_PICKUP',  vendors: vs('COMPLETED'),           stored: 'COMPLETED', storedBy: W4 },
  { label: 'mixed: booth — ready (awaiting collect)', type: 'BOOTH_PICKUP', vendors: vs('READY'),          stored: 'PLACED',    storedBy: W4 },
  { label: 'mixed: delivery — READY ⚠BUG',      type: 'HOME_DELIVERY', vendors: vs('READY'),               stored: 'PLACED',    storedBy: W4 },
  { label: 'mixed: curbside — READY ⚠BUG',      type: 'CURBSIDE',      vendors: vs('READY'),               stored: 'PLACED',    storedBy: W4 },
  { label: 'mixed: delivery — delivered',       type: 'HOME_DELIVERY', vendors: vs('READY'), runnerId: 'r', photo: 'p', stored: 'DELIVERED', storedBy: W3 },
  { label: 'mixed: pre-payment (no rows)',      type: 'BOOTH_PICKUP',  vendors: [],                        stored: 'PENDING_PAYMENT', storedBy: 'W1 create' },
  { label: 'mixed: payment-failed cancel',      type: 'CURBSIDE',      vendors: [],                        stored: 'CANCELLED', storedBy: 'W6 webhook' },

  // ─────────────── REFUNDED shapes (forced by the LIVE sweep) ───────────────
  // REFUNDED is a money state, not a fulfillment-failure. The matrix originally
  // missed these; real orders surfaced them.
  { label: 'refund: all portions REFUNDED (post-complete)', type: 'BOOTH_PICKUP', vendors: vs('REFUNDED','REFUNDED'), stored: 'COMPLETED', storedBy: 'refund engine' }, // must ABSTAIN, not CANCELLED
  { label: 'refund: all REFUNDED, stored PLACED',           type: 'BOOTH_PICKUP', vendors: vs('REFUNDED','REFUNDED'), stored: 'PLACED',    storedBy: 'refund engine' }, // must ABSTAIN, not CANCELLED
  { label: 'refund: partial — one done one refunded (booth)',type:'BOOTH_PICKUP', vendors: vs('COMPLETED','REFUNDED'), stored: 'PLACED',   storedBy: W4 },              // W4 omits REFUNDED → stuck PLACED; derive COMPLETED
  { label: 'refund: partial — one ready one refunded (delivery)',type:'HOME_DELIVERY', vendors: vs('READY','REFUNDED'), stored: 'PLACED', storedBy: W4 },              // derive READY (survivor gates)
  { label: 'refund: all DECLINED (never fulfilled)',        type: 'BOOTH_PICKUP', vendors: vs('DECLINED','DECLINED'),  stored: 'CANCELLED', storedBy: W4 },              // CANCELLED stays correct
]

// ── Run ──────────────────────────────────────────────────────────────────────
const RESET = '\x1b[0m', RED = '\x1b[31m', GRN = '\x1b[32m', YEL = '\x1b[33m', CYN = '\x1b[36m', DIM = '\x1b[2m'
const mark: Record<Divergence, string> = {
  MATCH: `${GRN}MATCH${RESET}`,
  UNDER_ADVANCED: `${RED}UNDER_ADVANCED (BUG)${RESET}`,
  BENIGN_OVERRIDE: `${YEL}BENIGN_OVERRIDE${RESET}`,
  REGRESSION_RISK: `${RED}REGRESSION_RISK${RESET}`,
  UNEXPECTED: `${RED}UNEXPECTED${RESET}`,
}

const tally: Record<Divergence, number> = {
  MATCH: 0, UNDER_ADVANCED: 0, BENIGN_OVERRIDE: 0, REGRESSION_RISK: 0, UNEXPECTED: 0,
}

let lastArm = ''
console.log(`\n${CYN}Phase 0 shadow-reader derivation matrix${RESET}  (pure, no DB; stored = what writers W1–W7 produce today)\n`)
console.log(`${DIM}stored → derived | divergence | arm | monotonic-advance? | note${RESET}`)
console.log('─'.repeat(120))

for (const c of cases) {
  const r = deriveMasterStatus({
    fulfillmentType: c.type, vendorStatuses: c.vendors, runnerId: c.runnerId, curbsidePhotoUrl: c.photo,
  })
  const div = classifyDivergence(c.stored, r.derived)
  tally[div]++

  // Would the Phase-1 write actually advance, and is it monotonic-safe?
  const advance = r.derived !== 'SKIP' ? canAdvance(c.stored, r.derived as MasterStatus) : false

  if (r.arm !== lastArm) { console.log(`${DIM}── ${r.arm.toUpperCase()} arm ──${RESET}`); lastArm = r.arm }

  const storedR = c.stored in MASTER_RANK ? MASTER_RANK[c.stored] : '?'
  const derR = r.derived !== 'SKIP' ? MASTER_RANK[r.derived as MasterStatus] : '-'
  console.log(
    `  ${c.label.padEnd(46)} ` +
    `${String(c.stored).padEnd(16)}→ ${String(r.derived).padEnd(16)} | ${mark[div].padEnd(34)} ` +
    `${r.arm.padEnd(9)} adv=${advance ? 'yes' : 'no '} ${DIM}r${storedR}→r${derR}  ${r.reason}${RESET}`
  )
}

console.log('─'.repeat(120))
console.log(`\n${CYN}Summary${RESET}`)
for (const k of Object.keys(tally) as Divergence[]) {
  if (tally[k] > 0) console.log(`  ${mark[k]}: ${tally[k]}`)
}

// ── Invariants the reader must satisfy before it gets write authority ────────
const failures: string[] = []
if (tally.REGRESSION_RISK > 0) failures.push('REGRESSION_RISK present — derivation wants to move master BACKWARD')
if (tally.UNEXPECTED > 0) failures.push('UNEXPECTED divergence present — derivation produced an unclassifiable result')

// Every UNDER_ADVANCED case must be a genuine forward repair the monotonic guard
// would allow — never a no-op or a regression dressed up as a bug.
for (const c of cases) {
  const r = deriveMasterStatus({ fulfillmentType: c.type, vendorStatuses: c.vendors, runnerId: c.runnerId, curbsidePhotoUrl: c.photo })
  const div = classifyDivergence(c.stored, r.derived)
  if (div === 'UNDER_ADVANCED' && r.derived !== 'SKIP' && !canAdvance(c.stored, r.derived as MasterStatus)) {
    failures.push(`"${c.label}": flagged UNDER_ADVANCED but monotonic guard would NOT advance it`)
  }
}

console.log('')
if (failures.length === 0) {
  console.log(`${GRN}✓ Invariants hold: no regressions, no unexpected results, every bug is a monotonic-safe forward repair.${RESET}`)
  console.log(`${DIM}  UNDER_ADVANCED rows are the known handoff bug + cousins — exactly what Phase 1 takes write authority to fix.${RESET}\n`)
} else {
  console.log(`${RED}✗ Invariant failures:${RESET}`)
  failures.forEach(f => console.log(`  ${RED}- ${f}${RESET}`))
  console.log('')
  process.exit(1)
}
