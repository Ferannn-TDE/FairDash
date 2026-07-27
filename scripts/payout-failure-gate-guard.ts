/**
 * THE FAILURE-MARKER GATE — an UnrecoverableError must still write the durable marker.
 *
 * THE DEFECT (confirmed against BullMQ 5.76.8, not inferred): the failed-handler gated the
 * marker on `job.attemptsMade >= (job.opts.attempts ?? 3)`. BullMQ fails an UnrecoverableError
 * job WITHOUT exhausting attempts — job.js:483 `shouldRetryJob` returns [false, 0] on sight of
 * one without touching attemptsMade, and job.js:549 increments it exactly once. So a
 * PayoutReconciliationError on the first try arrived with attemptsMade = 1 against attempts = 3,
 * `1 >= 3` was false, and BOTH the payoutStatus='FAILED' write AND recordPayoutFailure (which
 * carries the PAYOUT_FAILED audit Pattern U reads) were skipped.
 *
 * The marker path was INVERTED: transient blips that burned all three retries got durable
 * markers; a ledger drift — the most serious failure this system raises — got a log line.
 *
 * WHY THIS SUITE CAN PROVE THE BUG EXISTED: lib/payout-failure-finality.ts keeps the OLD gate
 * executable as `legacyExhaustedOnlyGate`. [1] runs BOTH gates over the same facts and shows
 * the old one skipping where the new one fires. A suite that only passes after a fix proves
 * only that the code changed.
 *
 *   [0] positive controls on the probe itself
 *   [1] THE BUG, both gates, same inputs — old SKIPS, new FIRES
 *   [2] the transient path is UNCHANGED (this widened the gate; it must not have moved it)
 *   [3] named set — every UnrecoverableError throw site on the payout path
 *   [4] the PAYOUT_FAILED audit is INSIDE the same gate, for all three legs
 *   [5] the BullMQ premise still holds in the installed version
 *   [6] the audit reason is honest — never claims exhaustion that did not happen
 *
 * Pure file/logic reader — no DB, no Redis, no worker boot. Run:
 *   npx tsx scripts/payout-failure-gate-guard.ts
 */

import { readFileSync } from 'node:fs'
import {
  payoutFailureFinality,
  legacyExhaustedOnlyGate,
  isUnrecoverable,
} from '../lib/payout-failure-finality'
import { stripComments } from './_strip-comments'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

// The exact runtime shape BullMQ hands the failed handler for a first-attempt halt.
const UNRECOVERABLE = Object.assign(new Error('ledger drift: covered sum ≠ batch total'), { name: 'UnrecoverableError' })
const TRANSIENT = Object.assign(new Error('socket hang up'), { name: 'Error' })
const FIRST_ATTEMPT = { attemptsMade: 1, maxAttempts: 3 }
const ALL_BURNED = { attemptsMade: 3, maxAttempts: 3 }

console.log('[0] positive controls on the probe')
assert(isUnrecoverable(UNRECOVERABLE), 'the probe recognises an UnrecoverableError by name')
assert(!isUnrecoverable(TRANSIENT), 'and does NOT mistake a plain Error for one')
assert(!isUnrecoverable(null) && !isUnrecoverable(undefined) && !isUnrecoverable('boom'),
  'null/undefined/string are not unrecoverable (no crash, no false positive)')
// instanceof across duplicated module copies silently returns false; the name check is why
// this survives that. Prove the name path alone is sufficient.
class FakeUnrecoverable extends Error { constructor() { super('x'); this.name = 'UnrecoverableError' } }
assert(isUnrecoverable(new FakeUnrecoverable()),
  'a DIFFERENT class named UnrecoverableError still counts (mirrors BullMQ job.js:486 — survives a duplicated bullmq instance)')

console.log('\n[1] THE BUG — same facts, both gates: the old one SKIPS the marker')
const legacyVerdict = legacyExhaustedOnlyGate(FIRST_ATTEMPT)
const fixedVerdict = payoutFailureFinality(UNRECOVERABLE, FIRST_ATTEMPT)
console.log(`     UnrecoverableError, attemptsMade=1, attempts=3`)
console.log(`       OLD gate (attemptsMade >= attempts) → ${legacyVerdict}   ${legacyVerdict ? '' : '← marker + audit SKIPPED'}`)
console.log(`       NEW gate (final)                    → ${fixedVerdict.final}    ${fixedVerdict.final ? '← marker + audit WRITTEN' : ''}`)
assert(legacyVerdict === false,
  'OLD gate returns FALSE on a first-attempt unrecoverable halt — the defect, demonstrated not asserted')
assert(fixedVerdict.final === true,
  'NEW gate returns TRUE on the same facts — the marker and the PAYOUT_FAILED audit now fire')
assert(fixedVerdict.unrecoverable === true, 'and it is labelled unrecoverable, not "exhausted"')

console.log('\n[2] the transient path is UNCHANGED — this widened the gate, it must not have moved it')
assert(payoutFailureFinality(TRANSIENT, ALL_BURNED).final === true, 'transient + all 3 attempts burned ⇒ still final (unchanged)')
assert(payoutFailureFinality(TRANSIENT, FIRST_ATTEMPT).final === false, 'transient on attempt 1 ⇒ still NOT final — retries must still run')
assert(payoutFailureFinality(TRANSIENT, { attemptsMade: 2, maxAttempts: 3 }).final === false, 'transient on attempt 2 ⇒ still NOT final')
assert(legacyExhaustedOnlyGate(ALL_BURNED) === payoutFailureFinality(TRANSIENT, ALL_BURNED).final,
  'old and new agree on EVERY transient case — the change is additive, not a rewrite')
assert(payoutFailureFinality(UNRECOVERABLE, { attemptsMade: 0, maxAttempts: 3 }).final === true,
  'an unrecoverable halt at attemptsMade=0 is final too (BullMQ increments after, not before)')
assert(payoutFailureFinality(TRANSIENT, { attemptsMade: 5, maxAttempts: undefined }).final === true,
  'a missing opts.attempts falls back to 3 — no crash, no silent never-final job')

console.log('\n[3] named set — every UnrecoverableError throw site on the payout path')
const worker = stripComments(readFileSync('workers/order-worker.ts', 'utf8'))
// All three payout handlers map PayoutReconciliationError → UnrecoverableError. Each is named
// so that adding a fourth payout leg without this mapping is a visible omission, not a silent one.
const THROW_SITES = [
  { leg: 'vendor',    handler: 'handleVendorPayout' },
  { leg: 'runner',    handler: 'handleRunnerPayout' },
  { leg: 'organizer', handler: 'handleOrganizerPayout' },
]
for (const { leg, handler } of THROW_SITES) {
  const idx = worker.indexOf(`async function ${handler}`)
  const body = idx >= 0 ? worker.slice(idx, idx + 1400) : ''
  assert(/PayoutReconciliationError/.test(body) && /throw new UnrecoverableError/.test(body),
    `${leg}: ${handler} maps PayoutReconciliationError → UnrecoverableError (reaches the fixed gate)`)
}
// SIX, in TWO families of three — one per payout leg, per cause. Counted by family rather than
// in total, so "someone added a leg" and "someone added a new halt CAUSE" fail differently:
//   PayoutReconciliationError → our books disagree (ledger drift)
//   PayoutTerminalError       → Stripe has refused permanently (dead destination, revoked conn.)
// Both must halt, and conflating them would put a false cause in the audit reason.
assert((worker.match(/throw new UnrecoverableError/g) ?? []).length === 6,
  'exactly 6 UnrecoverableError throw sites — 3 legs × 2 halt causes; a 7th is a decision, not drift')
assert((worker.match(/err instanceof PayoutReconciliationError/g) ?? []).length === 3,
  'reconciliation halts: one per leg (vendor, runner, organizer)')
assert((worker.match(/err instanceof PayoutTerminalError/g) ?? []).length === 3,
  'terminal-Stripe halts: one per leg — no leg left retrying blind against a dead destination')
// The two OTHER routes into BullMQ's unrecoverable handling, checked as ABSENT rather than
// assumed absent: worker.js:615 getUnrecoverableErrorMessage fires on job.deferredFailure or
// opts.maxStartedAttempts (BullMQ constructs the error itself — our gate catches it by name),
// and the deprecated job.discard() sets discarded=true WITHOUT an UnrecoverableError, which our
// gate would NOT catch. Neither is used here; if that changes, this fails and names the reason.
assert(!/\.discard\(\)/.test(worker),
  'job.discard() is NOT used — it halts retries WITHOUT an UnrecoverableError, so the gate would miss it')
assert(!/maxStartedAttempts/.test(worker),
  'maxStartedAttempts is NOT set — BullMQ would raise its own UnrecoverableError (caught by name), but this is unused')

console.log('\n[4] the PAYOUT_FAILED audit is INSIDE the same gate — Pattern U depends on it')
const handlerIdx = worker.indexOf("worker.on('failed'")
const handlerBody = worker.slice(handlerIdx, handlerIdx + 2000)
assert(handlerIdx > 0, 'the failed handler exists')
assert(/payoutFailureFinality\(/.test(handlerBody), 'the handler uses the shared finality decision, not a local re-derivation')
const returnIdx = handlerBody.indexOf('if (!final || !isPayout) return')
const recordIdx = handlerBody.indexOf('recordPayoutFailure(job')
assert(returnIdx > 0 && recordIdx > returnIdx,
  'recordPayoutFailure is AFTER the gate — so widening the gate widens the audit too (half a fix writes payoutStatus and no audit)')
assert(handlerBody.indexOf("payoutStatus: 'FAILED'") > returnIdx,
  "the vendor payoutStatus='FAILED' write is also behind the same gate")
const rec = worker.slice(worker.indexOf('async function recordPayoutFailure'))
for (const leg of ['runner', 'organizer', 'vendor']) {
  assert(new RegExp(`payeeType: '${leg}'`).test(rec.slice(0, 3000)), `recordPayoutFailure writes a PAYOUT_FAILED audit for the ${leg} leg`)
}
assert((rec.slice(0, 3000).match(/action: 'PAYOUT_FAILED'/g) ?? []).length === 3,
  'all three legs audit — the asymmetry that hid runner/organizer failures is closed')

console.log('\n[5] the BullMQ premise still holds in the INSTALLED version')
const ver = JSON.parse(readFileSync('node_modules/bullmq/package.json', 'utf8')).version as string
const jobSrc = readFileSync('node_modules/bullmq/dist/cjs/classes/job.js', 'utf8')
const shouldRetry = jobSrc.slice(jobSrc.indexOf('async shouldRetryJob('), jobSrc.indexOf('async shouldRetryJob(') + 700)
assert(/UnrecoverableError/.test(shouldRetry) && /return \[false, 0\]/.test(shouldRetry),
  `bullmq ${ver}: shouldRetryJob still short-circuits on UnrecoverableError without exhausting attempts`)
assert(!/attemptsMade\s*=\s*this\.opts\.attempts/.test(shouldRetry),
  `bullmq ${ver}: it still does NOT jump attemptsMade to the max (which is why an attempt-count gate missed it)`)

console.log('\n[6] the audit reason is honest')
assert(/no further attempts will run/.test(fixedVerdict.finality) && !/exhausted/.test(fixedVerdict.finality),
  `an unrecoverable halt does NOT claim exhaustion (got: "${fixedVerdict.finality}")`)
assert(/exhausted after 3 attempt\(s\)/.test(payoutFailureFinality(TRANSIENT, ALL_BURNED).finality),
  'a genuinely exhausted job still says exhausted, with the count')
assert(/reason: `runner payout job \$\{attempts\}`/.test(worker) || /payout job \$\{attempts\}/.test(worker),
  'the audit reason interpolates the finality text rather than hardcoding "exhausted after"')

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `✅ payout-failure-gate-guard: ${pass} passed, 0 failed` : `❌ payout-failure-gate-guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
