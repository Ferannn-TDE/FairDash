/**
 * ACCEPT-TIMER ARMING GUARD — the money-moving timer is never armed on a closed fair.
 *
 * ── THE INCIDENT ─────────────────────────────────────────────────────────────────────────────
 * lib/place-order.ts enqueued JOB_UNACCEPTED on EVERY placement, unconditionally. That job
 * (workers/order-worker.ts:113 handleMarkUnaccepted) cancels the order and refunds the customer
 * through the per-vendor engine, actor 'system:accept-timeout'. On 2026-08-01, order
 * cmsawszw70008edtcv6giekll was placed through the admin preview bypass against a fair that
 * opens 2026-08-05 and was auto-refunded 128.7s later. Nobody was at the booth — the fair does
 * not exist yet. It was the fifth such refund.
 *
 * The timer's premise is a STAFFED BOOTH. Where that premise is false, arming it is a scheduled
 * unattended money movement.
 *
 * ── WHAT THIS ASSERTS, AND WHY IT IS SHAPE-KEYED ─────────────────────────────────────────────
 * [1] the enqueue site CONSULTS the shared predicate — deriveEventLiveState, imported from
 *     lib/event-date. Keyed on the import + call + a guarded enqueue, NOT on a filename or on
 *     the exact spelling of the branch, so a refactor that renames the variable still passes and
 *     a refactor that DROPS the check fails.
 * [2] it does NOT hand-roll a second date comparison. "Is this fair open" has ONE derivation
 *     (lib/event-date.ts:82, guarded by scripts/fair-open-gate-guard.ts); a `new Date()` compare
 *     next to the enqueue would be a fifth copy, which is this codebase's central bug class.
 * [3] the skip is LOGGED. `if (ordersQueue)` has no else, so a missing queue already skips the
 *     enqueue silently on the money-in path (CURRENT_STATE.md §7). A second silent skip would be
 *     indistinguishable from that failure while meaning the opposite, so the deliberate skip must
 *     name the order and the reason.
 * [4] the OPEN path is unchanged — an open fair still arms the timer with the shared constant
 *     and the dedupe jobId. A guard that only proved "sometimes we skip" would be satisfied by
 *     never arming at all.
 *
 * ── COMMENT-STRIPPED, BOTH WAYS ──────────────────────────────────────────────────────────────
 * Via scripts/_strip-comments.ts (the ONE stripper — six copies of this idiom is what that file
 * exists to end). Both halves read stripped source: the prose above the enqueue explains the old
 * unconditional shape at length and must not satisfy the guard, and a comment must never excuse
 * missing code.
 *
 *   [0]  anti-vacuity — the file is read, non-trivial, and really contains the enqueue
 *   [P1] positive control — REMOVING the condition fails the scan, naming path AND line
 *   [P2] positive control — a hand-rolled date compare is caught (so [2] is not blind)
 *   [P3] positive control — a comment mentioning the predicate does NOT satisfy [1]
 *   [5]  the suite still reports after its planted defects
 *
 * Pure file-reader — no database, no queue. Run:  npx tsx scripts/accept-timer-arming-guard.ts
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { stripComments } from './_strip-comments'

const REPO = new URL('..', import.meta.url).pathname
const TARGET = 'lib/place-order.ts'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => {
  if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

interface Finding { line: number; snippet: string }

/** Locate a pattern in stripped source, reporting the 1-indexed line. */
function findLine(src: string, re: RegExp): Finding | null {
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return { line: i + 1, snippet: lines[i].trim().slice(0, 100) }
  }
  return null
}

export interface ArmingReport {
  importsPredicate: boolean
  callsPredicate: Finding | null
  enqueuesTimer: Finding | null
  /** The enqueue is reached only through a liveState decision. */
  enqueueIsGuarded: boolean
  /** A hand-rolled date comparison near the enqueue — the fifth-derivation shape. */
  handRolledDateCompare: Finding | null
  /** The deliberate skip logs order + reason. */
  logsSkip: boolean
  chars: number
}

/** THE SCAN — takes source so the controls can drive the REAL function over mutated text. */
export function scanArming(src: string): ArmingReport {
  const s = stripComments(src)
  return {
    importsPredicate: /import\s*\{[^}]*deriveEventLiveState[^}]*\}\s*from\s*['"]\.\/event-date['"]/.test(s),
    callsPredicate: findLine(s, /deriveEventLiveState\s*\(/),
    enqueuesTimer: findLine(s, /name:\s*JOB_UNACCEPTED/),
    // The enqueue must sit behind a liveState decision — any branch shape, so a rename or an
    // inversion still passes, but deleting the decision does not.
    enqueueIsGuarded: /liveState[\s\S]{0,400}?name:\s*JOB_UNACCEPTED/.test(s),
    // A second date comparison next to the arming decision. `new Date()` / Date.now() compared
    // against a start/end field is the fifth-derivation shape the one-source rule forbids.
    handRolledDateCompare: findLine(
      s,
      /(startDate|endDate)\s*[<>]=?\s*(new\s+Date|Date\.now)|(new\s+Date\(\)|Date\.now\(\))\s*[<>]=?\s*[\w.]*(startDate|endDate)/,
    ),
    logsSkip: /logger\.(warn|error|info)\([\s\S]{0,300}?reason:\s*['"]fair_not_open['"]/.test(s),
    chars: s.length,
  }
}

function main() {
  const path = REPO + TARGET
  const original = readFileSync(path, 'utf8')
  const real = scanArming(original)

  // ── [0] anti-vacuity ───────────────────────────────────────────────────────────────────────
  console.log('\n[0] anti-vacuity — the target is real and still contains the timer')
  assert(real.chars > 3000, `${TARGET} read and non-trivial (${real.chars} stripped chars)`)
  assert(real.enqueuesTimer !== null, `the accept-timeout enqueue is present (line ${real.enqueuesTimer?.line})`)

  // ── [1] consults the shared predicate ──────────────────────────────────────────────────────
  console.log('\n[1] the arming decision consults the SHARED fair-open predicate')
  assert(real.importsPredicate, 'imports deriveEventLiveState from lib/event-date')
  assert(real.callsPredicate !== null, `calls deriveEventLiveState (line ${real.callsPredicate?.line})`)
  assert(real.enqueueIsGuarded, 'the JOB_UNACCEPTED enqueue is reached only through a liveState decision')

  // ── [2] no second derivation ───────────────────────────────────────────────────────────────
  console.log('\n[2] no hand-rolled date comparison (one derivation, not five)')
  if (real.handRolledDateCompare) {
    console.log(`     → ${TARGET}:${real.handRolledDateCompare.line}  ${real.handRolledDateCompare.snippet}`)
  }
  assert(real.handRolledDateCompare === null, 'no local start/end date compare beside the arming decision')

  // ── [3] the skip is audible ────────────────────────────────────────────────────────────────
  console.log('\n[3] the deliberate skip is logged, not silent')
  assert(real.logsSkip, "the closed-fair skip logs order + reason:'fair_not_open' (≠ a dropped enqueue)")

  // ── [4] the open path still arms ───────────────────────────────────────────────────────────
  console.log('\n[4] an OPEN fair still arms the timer, unchanged')
  const s = stripComments(original)
  assert(/delay:\s*VENDOR_ACCEPT_TIMEOUT_MS/.test(s), 'still armed with the shared constant (no inlined number)')
  assert(/jobId:\s*`unaccepted-\$\{order\.id\}`/.test(s), 'still uses the dedupe jobId')
  assert(/result === 'dropped'/.test(s), 'still reports a DROPPED enqueue as CRITICAL')

  // ── [P1] CONTROL — removing the condition must FAIL ────────────────────────────────────────
  // Mutates the REAL file and runs the REAL scan, then restores in `finally` so a thrown
  // assertion cannot leave the tree dirty. A control that only exercised a regex on a synthetic
  // string would prove the regex, not the guard.
  console.log('\n[P1] PROBE CONTROL — removing the fair-open condition fails the scan')
  let mutated: ArmingReport
  try {
    // Collapse the guarded branch back to the pre-fix unconditional shape.
    const broken = original
      .replace(/const liveState = order\.event[\s\S]*?: null\n/, '')
      .replace(/if \(liveState !== 'live'\) \{[\s\S]*?\} else if \(ordersQueue\) \{/, 'if (ordersQueue) {')
    writeFileSync(path, broken)
    mutated = scanArming(readFileSync(path, 'utf8'))
  } finally {
    writeFileSync(path, original)
  }
  assert(!mutated.enqueueIsGuarded, 'unconditional enqueue is CAUGHT (enqueueIsGuarded false)')
  assert(!mutated.logsSkip, 'and the skip-log assertion also fails on the broken shape')
  assert(
    mutated.enqueuesTimer !== null,
    `the control names the enqueue line it would have guarded (line ${mutated.enqueuesTimer?.line})`,
  )
  assert(scanArming(readFileSync(path, 'utf8')).enqueueIsGuarded, 'the real file was restored cleanly')

  // ── [P2] CONTROL — a hand-rolled date compare is detectable ────────────────────────────────
  console.log('\n[P2] PROBE CONTROL — a hand-rolled date comparison is caught')
  const withCompare = original.replace(
    'const ordersQueue = getOrderQueue()',
    'const openNow = order.event!.startDate <= new Date()\n  void openNow\n  const ordersQueue = getOrderQueue()',
  )
  const cmp = scanArming(withCompare)
  assert(cmp.handRolledDateCompare !== null, `planted date compare CAUGHT (line ${cmp.handRolledDateCompare?.line})`)
  assert(scanArming(original).handRolledDateCompare === null, 'and the real file has none (it discriminates)')

  // ── [P3] CONTROL — a comment cannot satisfy the guard ──────────────────────────────────────
  console.log('\n[P3] PROBE CONTROL — a comment mentioning the predicate does not satisfy [1]')
  const commentOnly = `
    // we should call deriveEventLiveState(order.event.startDate, order.event.endDate) here
    /* import { deriveEventLiveState } from './event-date' */
    const ordersQueue = getOrderQueue()
    if (ordersQueue) { await enqueueJobSafely({ name: JOB_UNACCEPTED }) }
  `
  const co = scanArming(commentOnly)
  assert(!co.importsPredicate, 'a commented import does NOT count as importing the predicate')
  assert(co.callsPredicate === null, 'a commented call does NOT count as calling it')
  assert(!co.enqueueIsGuarded, 'and the enqueue still reads as unguarded')

  // ── [5] the suite survived its own planted defects ─────────────────────────────────────────
  console.log('\n[5] the guard still reports after the planted defects')
  assert(pass + fail >= 17, `all assertions executed and reported (${pass + fail} so far)`)

  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} accept-timer-arming-guard: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
