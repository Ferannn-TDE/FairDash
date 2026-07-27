/**
 * FAST-FAIL ON TERMINAL STRIPE FAILURES — the classifier's first consumer.
 *
 * THE GAP: all three payout legs called `stripe.transfers.create` BARE. Nothing inspected the
 * error, so BullMQ's blanket `attempts: 3` decided blind — a deleted destination account and a
 * network blip were indistinguishable, and a destination that will NEVER resolve cost 3 attempts
 * plus exponential backoff before being marked.
 *
 * This is a SPEED fix, not a correctness fix: since the finality gate landed (bb98bc8) a dead
 * account already reached the right durable end state, just slowly. That is exactly why the bar
 * here is high — the change must buy time and nothing else.
 *
 *   [0] positive controls on the probe
 *   [1] THE ONLY BEHAVIOUR CHANGE IS `terminal` — transient and unknown propagate UNCHANGED
 *   [2] pre-change behaviour, executably: the old bare call could not distinguish them
 *   [3] identity preservation — upstream instanceof checks still work
 *   [4] the success path is untouched
 *   [5] all three legs wrapped, and all three worker handlers map to the SAME seam
 *   [6] the terminal end state equals the exhausted-retry end state
 *
 * Pure logic/file reader — no DB, no Redis, no Stripe, no worker boot.
 * Run:  npx tsx scripts/payout-fast-fail-guard.ts
 */

import { readFileSync } from 'node:fs'
import Stripe from 'stripe'
import {
  transferOrTerminal,
  PayoutTerminalError,
  PayoutNotSettledError,
  PayoutReconciliationError,
} from '../lib/process-payout'
import { stripComments } from './_strip-comments'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const E = (Stripe as unknown as { errors: Record<string, new (raw: Record<string, unknown>) => Error> }).errors
const mk = (cls: string, raw: Record<string, unknown>) => new E[cls](raw)

// REAL SDK shapes — a made-up object proves the wrapper matches my idea of a Stripe error.
const TERMINAL = mk('StripeInvalidRequestError', {
  message: 'No such destination: acct_1Dead', type: 'invalid_request_error',
  code: 'resource_missing', statusCode: 400, param: 'destination',
})
const TRANSIENT = mk('StripeConnectionError', { message: 'socket hang up' })
const UNKNOWN_ERR = mk('StripeIdempotencyError', { message: 'key reused', type: 'idempotency_error', statusCode: 400 })

/** Run the wrapper over a thrower and report what came back out. */
async function through(err: unknown): Promise<{ caught: unknown; isTerminal: boolean; same: boolean }> {
  try {
    await transferOrTerminal('test ctx', async () => { throw err })
    return { caught: null, isTerminal: false, same: false }
  } catch (e) {
    return { caught: e, isTerminal: e instanceof PayoutTerminalError, same: e === err }
  }
}

/** THE PRE-CHANGE BEHAVIOUR, executable: a bare call, no classification. Kept so the fix is
 *  DEMONSTRATED rather than asserted — a test that only passes after a change proves nothing. */
async function legacyBareTransfer(err: unknown): Promise<{ caught: unknown; isTerminal: boolean }> {
  try {
    await (async () => { throw err })()
    return { caught: null, isTerminal: false }
  } catch (e) {
    return { caught: e, isTerminal: e instanceof PayoutTerminalError }
  }
}

async function main() {
  console.log('[0] positive controls on the probe')
  const ok = await transferOrTerminal('ctx', async () => 'paid')
  assert(ok === 'paid', 'the wrapper returns the callback value when nothing throws')
  assert(TERMINAL instanceof Error && TRANSIENT instanceof Error, 'the fixtures are real SDK error objects')
  const t = await through(TERMINAL)
  const n = await through(TRANSIENT)
  assert(t.isTerminal !== n.isTerminal, 'the probe distinguishes outcomes at all (not a constant)')

  console.log('\n[1] THE ONLY BEHAVIOUR CHANGE IS `terminal`')
  assert(t.isTerminal, 'a deleted destination → PayoutTerminalError (fast-fail, no more retries)')
  assert(!n.isTerminal, 'a network failure → NOT terminal (retries continue exactly as today)')
  const u = await through(UNKNOWN_ERR)
  assert(!u.isTerminal,
    '⛔ an UNKNOWN error → NOT terminal. Misclassifying toward terminal abandons money that would have moved')

  console.log('\n[2] pre-change behaviour, executably — the old bare call could not tell them apart')
  const legacyT = await legacyBareTransfer(TERMINAL)
  const legacyN = await legacyBareTransfer(TRANSIENT)
  console.log(`     OLD (bare):     terminal→isTerminal=${legacyT.isTerminal}   transient→isTerminal=${legacyN.isTerminal}   ← indistinguishable, both retried 3×`)
  console.log(`     NEW (wrapped):  terminal→isTerminal=${t.isTerminal}    transient→isTerminal=${n.isTerminal}   ← only the hopeless one halts`)
  assert(legacyT.isTerminal === false && legacyN.isTerminal === false,
    'OLD: a terminal error was NOT distinguished — it propagated raw and burned all 3 attempts (the defect)')
  assert(legacyT.caught === TERMINAL, 'OLD: the raw error propagated unchanged (which is why BullMQ retried blind)')
  assert(t.isTerminal === true && n.isTerminal === false, 'NEW: only the terminal one halts — same inputs, different outcome')

  console.log('\n[3] identity preservation — non-terminal errors propagate as the SAME object')
  assert(n.same, 'a transient error is rethrown as the ORIGINAL instance, not a copy')
  assert(u.same, 'an unknown error is rethrown as the ORIGINAL instance')
  // Upstream code branches on these classes; a wrapper that reboxed them would silently break
  // PayoutNotSettledError handling and the worker's PayoutReconciliationError → Unrecoverable map.
  const notSettled = new PayoutNotSettledError('balance txn not settled')
  const recon = new PayoutReconciliationError('ledger drift')
  const ns = await through(notSettled)
  const rc = await through(recon)
  assert(ns.caught instanceof PayoutNotSettledError, 'PayoutNotSettledError survives the wrapper with its identity')
  assert(rc.caught instanceof PayoutReconciliationError, 'PayoutReconciliationError survives — the worker still maps it to UnrecoverableError')
  assert(!ns.isTerminal && !rc.isTerminal, 'and neither is reclassified as terminal (our own errors are not Stripe errors)')

  console.log('\n[4] the success path is untouched')
  let calls = 0
  const val = await transferOrTerminal('ctx', async () => { calls++; return { id: 'tr_123' } })
  assert(calls === 1, 'the callback runs exactly once on success (no retry, no double-send)')
  assert((val as { id: string }).id === 'tr_123', 'and its value passes through verbatim')

  console.log('\n[5] all three legs wrapped, and all three map to the SAME seam')
  const legs = [
    ['lib/process-payout.ts', 'vendor'],
    ['lib/runner-payout.ts', 'runner'],
    ['lib/organizer-payout.ts', 'organizer'],
  ] as const
  for (const [file, leg] of legs) {
    const src = stripComments(readFileSync(file, 'utf8'))
    assert(/transferOrTerminal\(/.test(src), `${leg}: transfers.create is wrapped in transferOrTerminal`)
    // No BARE transfers.create may remain — an unwrapped one is a leg that still retries blind.
    const bare = /(?<!\)\s*=>\s*\n?\s*)stripe\.transfers\.create\s*\(/g
    const wrapped = (src.match(/transferOrTerminal\([\s\S]{0,200}?stripe\.transfers\.create/g) ?? []).length
    const total = (src.match(/stripe\.transfers\.create\s*\(/g) ?? []).length
    void bare
    assert(total === wrapped && total > 0, `${leg}: all ${total} transfers.create call(s) are inside the wrapper (none bare)`)
  }
  const worker = stripComments(readFileSync('workers/order-worker.ts', 'utf8'))
  assert((worker.match(/err instanceof PayoutTerminalError/g) ?? []).length === 3,
    'all THREE worker handlers map PayoutTerminalError (one hardened leg and two not is the divergence class)')
  assert((worker.match(/err instanceof PayoutReconciliationError/g) ?? []).length === 3,
    'and the existing reconciliation mapping is still present in all three (additive, not replaced)')

  console.log('\n[6] terminal reaches the SAME durable end state as an exhausted retry')
  // Not a second path to the marker: PayoutTerminalError → UnrecoverableError → the finality
  // gate (order-worker.ts) → payoutStatus='FAILED' + recordPayoutFailure's PAYOUT_FAILED audit.
  const idx = worker.indexOf('err instanceof PayoutTerminalError')
  const block = worker.slice(idx, idx + 260)
  assert(/throw new UnrecoverableError\(err\.message\)/.test(block),
    'terminal throws UnrecoverableError — the SAME signal the finality gate already catches')
  // The gate itself lives in lib/payout-failure-finality.ts, so assert the WIRING here and the
  // semantics there (payout-failure-gate-guard [1] proves unrecoverable ⇒ final).
  const failedHandler = worker.slice(worker.indexOf("worker.on('failed'"))
  assert(/payoutFailureFinality\(/.test(failedHandler) && /if \(!final \|\| !isPayout\) return/.test(failedHandler),
    'the failed handler gates on FINALITY, which payout-failure-gate-guard proves an UnrecoverableError satisfies')
  assert(/recordPayoutFailure\(job, finality\)/.test(failedHandler),
    'and recordPayoutFailure runs behind that gate — so a terminal halt gets the marker + PAYOUT_FAILED audit')
  assert(!/recordPayoutFailure/.test(block), 'the terminal branch does NOT write its own marker — no second path')

  console.log(`\n${'─'.repeat(52)}`)
  console.log(fail === 0 ? `✅ payout-fast-fail-guard: ${pass} passed, 0 failed` : `❌ payout-fast-fail-guard: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
