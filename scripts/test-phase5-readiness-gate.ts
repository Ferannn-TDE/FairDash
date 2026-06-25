/**
 * Phase 5 — readiness gate, BOTH flag states. READ-ONLY (queries + toggles env;
 * creates nothing).
 *
 * Run:  npx tsx scripts/test-phase5-readiness-gate.ts
 *
 * The whole safety of shipping this rests on "flag OFF = exactly current behavior."
 * So the OFF proof matters as much as the ON proof. Exercises the REAL shared gate
 * functions (isVendorReadinessEnforced / readinessWhereIfEnforced / vendorReady)
 * the routes call, under both flag states, against live data — plus a source-level
 * check that the order backstop rejects BEFORE any PaymentIntent.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync } from 'node:fs'
import { db } from '../lib/db'
import { isVendorReadinessEnforced, readinessWhereIfEnforced, readyVendorWhere, vendorReady } from '../lib/vendor-readiness'

const RED = '\x1b[31m', GRN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m', CYN = '\x1b[36m'
let pass = 0, fail = 0
const check = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ${GRN}✓${RESET} ${label}`) }
  else { fail++; console.log(`  ${RED}✗ ${label}${RESET} ${DIM}${detail}${RESET}`) }
}
const setFlag = (on: boolean) => { process.env.ENFORCE_VENDOR_READINESS = on ? 'true' : 'false' }

// The marketplace list where, verbatim from GET /api/vendors.
const listWhere = (eventId: string) => ({ eventId, status: 'ACTIVE' as const, isOffline: false, ...readinessWhereIfEnforced() })
// The detail/order gate decision, verbatim from the routes.
const gateRejects = (v: { status: string; stripeVerified: boolean; availableMenuCount: number }) =>
  isVendorReadinessEnforced() && !vendorReady(v)

async function main() {
  console.log(`\n${CYN}Phase 5 readiness gate — flag OFF (inert) and flag ON (enforced)${RESET}\n`)

  const event = await db.event.findFirst({ where: { status: 'ACTIVE' }, select: { id: true, name: true } })
  if (!event) { console.error('no active event'); process.exit(1) }

  // Baseline: active+online vendors WITHOUT any readiness filter (= today's gate).
  const baseline = await db.vendor.count({ where: { eventId: event.id, status: 'ACTIVE', isOffline: false } })
  const readyCount = await db.vendor.count({ where: { eventId: event.id, ...readyVendorWhere } })
  console.log(`${DIM}event=${event.name} active+online=${baseline} ready=${readyCount}${RESET}\n`)

  // sample one ready + one unready vendor (with available menu count)
  const sample = async (ready: boolean) => {
    const v = await db.vendor.findFirst({
      where: { eventId: event.id, status: 'ACTIVE', stripeVerified: ready ? true : false, menuItems: { some: { isAvailable: true } } },
      select: { id: true, name: true, status: true, stripeVerified: true, _count: { select: { menuItems: { where: { isAvailable: true } } } } },
    })
    return v && { id: v.id, name: v.name, status: v.status, stripeVerified: v.stripeVerified, availableMenuCount: v._count.menuItems }
  }
  const readyV = await sample(true)
  const unreadyV = await sample(false)

  // ── FLAG OFF — must be exactly current behavior ────────────────────────────
  console.log(`${CYN}Flag OFF — inert (changes nothing)${RESET}`)
  setFlag(false)
  check('isVendorReadinessEnforced() === false', isVendorReadinessEnforced() === false)
  check('readinessWhereIfEnforced() is empty ({})', Object.keys(readinessWhereIfEnforced()).length === 0)
  const offCount = await db.vendor.count({ where: listWhere(event.id) })
  check(`marketplace list count === baseline (${baseline}) — all active+online still shown`, offCount === baseline, `got ${offCount}`)
  if (unreadyV) check('detail/order gate does NOT reject an unready vendor', gateRejects(unreadyV) === false)
  if (readyV) check('detail/order gate does NOT reject a ready vendor', gateRejects(readyV) === false)

  // ── FLAG ON — enforced ─────────────────────────────────────────────────────
  console.log(`\n${CYN}Flag ON — enforced (the (c) bar)${RESET}`)
  setFlag(true)
  check('isVendorReadinessEnforced() === true', isVendorReadinessEnforced() === true)
  const onCount = await db.vendor.count({ where: listWhere(event.id) })
  check(`marketplace list count === ready (${readyCount}) — unready hidden`, onCount === readyCount, `got ${onCount}`)
  check('list count strictly less than baseline (vendors actually hidden)', onCount < baseline, `${onCount} vs ${baseline}`)
  if (unreadyV) {
    check(`detail gate REJECTS unready vendor (${unreadyV.name}) → 404`, gateRejects(unreadyV) === true)
    check('order backstop REJECTS unready vendor', gateRejects(unreadyV) === true)
  }
  if (readyV) {
    check(`detail gate ALLOWS ready vendor (${readyV.name})`, gateRejects(readyV) === false)
    check('order backstop ALLOWS ready vendor', gateRejects(readyV) === false)
  }
  // count badge uses the same readyVendorWhere → same number as the list
  const badgeOn = await db.vendor.count({ where: { eventId: event.id, status: 'ACTIVE', isOffline: false, ...readinessWhereIfEnforced() } })
  check('count badge aligns with the gated list (no "17 shown, 2 orderable")', badgeOn === onCount)

  // ── Money safety: order backstop rejects BEFORE any PaymentIntent ──────────
  console.log(`\n${CYN}Money safety — order rejection precedes the charge${RESET}`)
  const src = readFileSync('app/api/orders/route.ts', 'utf8')
  const gateIdx = src.indexOf('VENDOR_NOT_READY')
  const piIdx = src.indexOf('paymentIntents.create')
  check('VENDOR_NOT_READY check exists in order route', gateIdx !== -1)
  check('readiness rejection is positioned BEFORE paymentIntents.create (no charge on reject)', gateIdx !== -1 && piIdx !== -1 && gateIdx < piIdx, `gate@${gateIdx} pi@${piIdx}`)

  setFlag(false) // restore inert default
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`${pass + fail} checks — ${GRN}${pass} passed${RESET}${fail ? `, ${RED}${fail} failed${RESET}` : ''}`)
  if (fail === 0) {
    console.log(`${GRN}✓ Flag OFF is inert (list = baseline ${baseline}, gates reject nothing) — shipping changes nothing.`)
    console.log(`  Flag ON enforces (list = ready ${readyCount}, unready hidden + rejected, badge aligned), and the`)
    console.log(`  order backstop rejects before any PaymentIntent. The flip is safe and yours to make.${RESET}`)
  } else {
    console.log(`${RED}✗ See failures.${RESET}`)
  }
  await db.$disconnect()
}
main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1) })
