/**
 * DOUBLE-PAY GUARD — the vendor payout executor must refuse to re-transfer a slice that
 * already has a confirmed Stripe transfer (earning.status === 'paid').
 *
 * The hole this closes: the plan classified every non-declined/held/blocked slice as `pay`
 * and called transfers.create, relying ONLY on the Stripe idempotency key to prevent a
 * double payment. That key expires at Stripe after 24h — so a payout job parked in the
 * failed set and re-run BY HAND a day or two later (the exact human-recovery path after
 * seeing payoutStatus=FAILED) fires transfers.create again on an expired key → the vendor
 * is paid twice. runner-payout already reads the durable ledger and short-circuits
 * ('already_paid'); the vendor leg did not. This proves it now does.
 *
 * No Stripe, no DB, no prod money — classifyVendorSlice is pure. Positive control on the
 * PROBE itself: a [0] baseline where a normal accrued slice still classifies 'pay', so the
 * 'already_paid' assertion is meaningfully distinguishing and never vacuous.
 *
 * Run:  npx tsx scripts/test-double-pay-guard.ts
 */

import { readFileSync } from 'node:fs'
import { classifyVendorSlice } from '../lib/process-payout'
import { stripComments } from './_strip-comments'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const base = { declined: false, earningStatus: 'accrued' as string | null | undefined, connected: true, payoutsFrozen: false, transferCents: 4000 }

function main() {
  // ── [0] BASELINE (positive control on the probe) — a normal accrued+connected slice PAYS ──
  // If classifyVendorSlice were broken to always return 'already_paid', THIS fails first, so
  // the double-pay assertion below can't pass vacuously.
  console.log('[0] baseline: a normal accrued, connected slice classifies pay (probe is live)')
  assert(classifyVendorSlice({ ...base }).outcome === 'pay', "accrued + connected → 'pay'")

  // ── [1] THE GUARD — an already-paid slice is refused BEFORE Stripe ──────────────────────
  console.log('\n[1] ⛔ a slice already marked paid → already_paid (no re-transfer, expired-key-safe)')
  assert(classifyVendorSlice({ ...base, earningStatus: 'paid' }).outcome === 'already_paid',
    "earningStatus='paid' → 'already_paid' (the durable double-pay guard)")
  // and it holds even when the vendor is connected with a positive slice — i.e. it would
  // OTHERWISE have been a 'pay'. That's the whole point: paid wins over pay.
  assert(classifyVendorSlice({ ...base, earningStatus: 'paid', connected: true, transferCents: 9999 }).outcome === 'already_paid',
    "paid beats pay even for a connected, positive, otherwise-payable slice")

  // ── [2] the decision ORDER is preserved (the guard didn't reorder the gates) ────────────
  console.log('\n[2] classification order preserved — the other gates still win where they should')
  assert(classifyVendorSlice({ ...base, declined: true, earningStatus: 'paid' }).outcome === 'skip',
    'declined wins over paid (a refunded portion is the customer\'s, checked first)')
  assert(classifyVendorSlice({ ...base, earningStatus: 'cancelled' }).blockedReason === 'admin_cancelled',
    "cancelled → blocked/admin_cancelled")
  assert(classifyVendorSlice({ ...base, earningStatus: 'held' }).blockedReason === 'admin_hold',
    "held → blocked/admin_hold")
  assert(classifyVendorSlice({ ...base, payoutsFrozen: true }).blockedReason === 'payouts_frozen',
    "frozen → blocked/payouts_frozen")
  assert(classifyVendorSlice({ ...base, connected: false }).heldReason === 'unconnected',
    "unconnected → hold/unconnected")
  assert(classifyVendorSlice({ ...base, transferCents: 0 }).heldReason === 'non_positive',
    "non-positive slice → hold/non_positive")

  // ── [3] STATIC WIRING — the executor HONORS already_paid BEFORE transfers.create ────────
  // The classifier being right is necessary but not sufficient: the loop must skip on it
  // before the Stripe call, or the decision is cosmetic. Assert the ordering in source.
  console.log('\n[3] static: the transfer loop skips already_paid BEFORE stripe.transfers.create')
  // COMMENT-STRIPPED — guards-scan-code-not-prose. This read RAW source and broke the moment
  // a doc comment ABOVE the loop mentioned stripe.transfers.create (the transferOrTerminal
  // wrapper's own explanation): indexOf found the prose, not the call, and the ordering check
  // silently compared the wrong positions. The pressure that creates is to delete the
  // explanation to get the guard green, which is the guard destroying what it protects.
  const src = stripComments(readFileSync('lib/process-payout.ts', 'utf8'))
  const skipAt = src.indexOf("p.outcome === 'already_paid'")
  const xferAt = src.indexOf('stripe.transfers.create')
  assert(skipAt !== -1, "the loop has an `p.outcome === 'already_paid'` branch")
  assert(xferAt !== -1 && skipAt < xferAt, 'the already_paid skip appears BEFORE transfers.create (short-circuits Stripe)')
  // anchor on the LOOP branch specifically (`p.outcome === …`), not the first textual
  // occurrence of already_paid (which is up in the classifier/type defs).
  assert(/p\.outcome === 'already_paid'[\s\S]{0,400}?logger\.warn/.test(src),
    'the skip logs at WARN (a prevented double-pay is prod-visible, not swallowed)')
  assert(src.includes('alreadyPaidCents') && /payoutSide = sentCents \+ alreadyPaidCents/.test(src),
    'already-paid cents are on the SENT side of the payout-side reconciliation (Σ === charge holds across re-runs)')

  console.log(`\n${'─'.repeat(52)}`)
  console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
