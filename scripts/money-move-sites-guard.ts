/**
 * THE SIX MONEY-MOVE SITES — a named set, so a seventh cannot appear silently.
 *
 * PROJECT_INVARIANTS.md claimed "the six money-move sites are exactly those six" and carried
 * `<!-- guard: none -->` against it, because nothing enumerated them. The claim was true and
 * unenforced, which in this repo is the state just before it quietly stops being true. It became
 * guardable when `logger.money` landed: every site that moves money now has a mandatory, greppable
 * outcome line, so the set has a second definition to be checked against.
 *
 * ── TWO INDEPENDENT ENUMERATIONS, AND WHY BOTH ───────────────────────────────────────────────
 * Neither alone is sufficient, and they are NOT the same set. Asserting them equal would be
 * wrong, so the relationship is spelled out here and asserted as stated:
 *
 *   A. TRANSFER sites — files calling `stripe.transfers.create`. Exactly THREE: the payout legs.
 *      Catches a new *payout* that nobody declared. Blind to refunds, which move money the other
 *      direction and never call transfers.create.
 *
 *   B. logger.money sites — files emitting a money outcome. Catches a new site of ANY shape,
 *      including refunds. Blind to a site that moves money and logs nothing — but that is the
 *      Job 0 hole reopening, and [3] fails it from the other side.
 *
 *   THE RELATIONSHIP, precisely (asserted in [4], not assumed):
 *     TRANSFER ⊂ MONEY_MOVE          — every transfer site is a money-move site
 *     TRANSFER ≠ MONEY_MOVE          — refund/tip-refund/chargeback move money with no
 *                                      transfers.create (refunds.create, or a reversal)
 *     logger.money ⊆ MONEY_MOVE      — a money line outside the declared set is an undeclared site
 *     |logger.money| ≥ |MONEY_MOVE|  — NOT equality: a site may legitimately log more than once,
 *                                      because a REFUSAL to move money is also a money outcome
 *                                      (runner-payout's `already_paid` short-circuit logs before
 *                                      Stripe is ever called). Do not collapse these to equality;
 *                                      doing so would force deleting a refusal log to stay green.
 *
 * ── REVERSALS ARE A PARALLEL SET, DELIBERATELY NOT MEMBERS ───────────────────────────────────
 * `lib/clawback.ts` calls `stripe.transfers.createReversal`, which unambiguously moves money.
 * It is NOT a seventh money-move site, and that is a decision, not an oversight:
 * MONEY_MOVE_SITES enumerates ENTRY POINTS — the engines a caller invokes — while clawback is a
 * shared helper invoked BY two of them (chargeback, and refund CASE 2). Counting it would
 * double-count one movement of money and would break "exactly six" for a reason that is not a new
 * site. It gets its own named set below so it is still enumerated and still cannot grow silently.
 *
 *   [0] positive controls on the probe itself
 *   [1] every declared site exists and carries logger.money
 *   [2] enumeration A — exactly three transfer sites, and they are the declared payout legs
 *   [3] enumeration B — no logger.money outside the declared set
 *   [4] the two enumerations relate as documented (subset, not equality)
 *   [5] reversals — the parallel set, exactly one entry
 *   [6] anti-vacuity floors — an empty scan FAILS rather than passing
 *
 * Pure file-reader. Run:  npx tsx scripts/money-move-sites-guard.ts
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './_strip-comments'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

/** THE NAMED SET. Not a count — a count says something changed; this says WHAT. */
const MONEY_MOVE_SITES: { file: string; moves: string; mechanism: string }[] = [
  { file: 'lib/process-payout.ts',
    moves: "a vendor's subtotal slice, out to their Connect account",
    mechanism: 'stripe.transfers.create' },
  { file: 'lib/runner-payout.ts',
    moves: "a runner's delivery fee, out to their Connect account",
    mechanism: 'stripe.transfers.create' },
  { file: 'lib/organizer-payout.ts',
    moves: "an organizer's per-event batched cut, out to their Connect account",
    mechanism: 'stripe.transfers.create' },
  { file: 'lib/process-refund.ts',
    moves: "a vendor's subtotal slice, back to the customer (fee never refunded)",
    mechanism: 'stripe.refunds.create (+ a CASE 2 reversal via lib/clawback.ts)' },
  { file: 'lib/tip-refund.ts',
    moves: 'an owed-back tip, back to the customer (no runner earned it)',
    mechanism: 'stripe.refunds.create' },
  { file: 'lib/process-chargeback.ts',
    moves: "an already-paid vendor's net, clawed back when a dispute is LOST",
    mechanism: 'reverseVendorPayout in lib/clawback.ts' },
]

/** The three payout legs — the subset that moves money OUT via a transfer. */
const TRANSFER_LEGS = ['lib/process-payout.ts', 'lib/runner-payout.ts', 'lib/organizer-payout.ts']

/**
 * PARALLEL SET #2 — files that legitimately emit a money OUTCOME without being an entry point.
 *
 * logger.money's contract is "a money move happened, or was deliberately refused" — which is
 * WIDER than "is one of the six engines". This guard's original `logger.money ⊆ MONEY_MOVE_SITES`
 * assertion conflated the two, and it only held because the six were the only users at the time.
 *
 * Recording that a payout has permanently FAILED, and returning a failed row to the candidate
 * set, are both money outcomes a human must see in the money log — and neither moves money.
 * Declaring them keeps "exactly six" true for the ENGINES while letting the log stay honest.
 */
const MONEY_OUTCOME_SITES: { file: string; why: string }[] = [
  { file: 'lib/payout-failure-marker.ts',
    why: 'records a payout that will NOT happen — a refusal, which is squarely a money outcome; moves nothing' },
  { file: 'app/api/admin/events/[id]/money/retry-payout/route.ts',
    why: 'returns a failed row to the reconciler candidate set; the SWEEP moves the money, never this route' },
]

/** PARALLEL SET — see the header. Reverses an existing transfer; never an entry point. */
const REVERSAL_SITES: { file: string; why: string }[] = [
  { file: 'lib/clawback.ts',
    why: 'shared reverseVendorPayout, called BY chargeback and refund CASE 2 — a mechanism, not a site' },
]

// ── SCAN SURFACE ──────────────────────────────────────────────────────────────────────────────
// NOT scripts/: this guard and its positive controls contain planted `stripe.transfers.create`
// and `logger.money` strings, and a scanner that reads its own source would report itself.
const ROOTS = ['lib', 'app', 'workers']
const SKIP_DIRS = new Set([
  'node_modules',            // dependencies
  '.next',                   // build output — compiled copies, otherwise scanned twice
  'mock',                    // lib/mock/* — fixtures, no money
  '__tests__', '__mocks__',  // fixtures
])

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

// COMMENT-STRIPPED, always. Not optional: `stripe.transfers.create` appears in SEVEN places in
// lib/, and only THREE are live calls — the rest are prose explaining the money path. A scanner
// that counted prose would report 7 transfer sites and pressure the next person to delete the
// explanations to get back to 3 (guards-scan-code-not-prose, PROJECT_INVARIANTS.md).
const files = ROOTS.flatMap(r => walk(r))
const src = new Map(files.map(f => [f, stripComments(readFileSync(f, 'utf8'))]))
const has = (f: string, re: RegExp) => re.test(src.get(f) ?? '')

const TRANSFER_RE = /stripe\.transfers\.create\s*\(/
const REVERSAL_RE = /stripe\.transfers\.createReversal\s*\(/
const MONEY_LOG_RE = /logger\.money\s*\(/

console.log('[0] positive controls on the probe itself')
const PLANTED_LIVE = 'const t = await stripe.transfers.create({ amount })'
const PLANTED_PROSE = '// we call stripe.transfers.create here one day\nconst x = 1'
assert(TRANSFER_RE.test(stripComments(PLANTED_LIVE)), 'a LIVE transfers.create is seen')
assert(!TRANSFER_RE.test(stripComments(PLANTED_PROSE)), 'a COMMENTED transfers.create is NOT seen (stripping works)')
assert(MONEY_LOG_RE.test(stripComments("logger.money('[X] paid', {})")), 'a live logger.money is seen')
assert(!MONEY_LOG_RE.test(stripComments("// logger.money('[X] paid', {})")), 'a commented logger.money is NOT seen')
assert(!TRANSFER_RE.test(stripComments('stripe.transfers.createReversal({})')),
  'createReversal does NOT match the transfer probe (the two sets stay distinct)')

console.log('\n[1] every declared money-move site exists and logs its outcome')
for (const { file, moves } of MONEY_MOVE_SITES) {
  assert(existsSync(file), `${file} exists — moves ${moves}`)
  assert(has(file, MONEY_LOG_RE), `${file} carries logger.money (its outcome reaches prod)`)
}
assert(MONEY_MOVE_SITES.length === 6, `the set declares exactly 6 sites (got ${MONEY_MOVE_SITES.length}) — a 7th is a decision, not drift`)

console.log('\n[2] enumeration A — transfer sites are exactly the three declared payout legs')
const foundTransfers = files.filter(f => has(f, TRANSFER_RE)).sort()
foundTransfers.filter(f => !TRANSFER_LEGS.includes(f)).forEach(f => console.log(`     ✗ UNDECLARED transfer site: ${f}`))
assert(foundTransfers.length === 3, `exactly 3 files call stripe.transfers.create (found ${foundTransfers.length}: ${foundTransfers.join(', ') || 'none'})`)
assert(TRANSFER_LEGS.every(f => foundTransfers.includes(f)),
  'and they are precisely the declared payout legs (vendor, runner, organizer)')
assert(foundTransfers.every(f => MONEY_MOVE_SITES.some(s => s.file === f)),
  'every transfer site is a declared money-move site')

console.log('\n[3] enumeration B — no logger.money outside the declared set')
const foundMoneyLogs = files.filter(f => has(f, MONEY_LOG_RE)).sort()
const declared = new Set(MONEY_MOVE_SITES.map(s => s.file))
const outcomeOnly = new Set(MONEY_OUTCOME_SITES.map(s => s.file))
const undeclared = foundMoneyLogs.filter(f => !declared.has(f) && !outcomeOnly.has(f))
undeclared.forEach(f => console.log(`     ✗ UNDECLARED money-logging site: ${f}`))
assert(undeclared.length === 0,
  `no file logs a money outcome without being declared (${foundMoneyLogs.length} logging file(s) scanned)`)
// The other direction is [1]: every declared site logs. Together they pin the set both ways.
assert(foundMoneyLogs.length === MONEY_MOVE_SITES.length + MONEY_OUTCOME_SITES.length,
  `all ${MONEY_MOVE_SITES.length} engines + ${MONEY_OUTCOME_SITES.length} declared outcome-loggers log, and nothing else does (found ${foundMoneyLogs.length})`)
// The outcome-loggers are NOT money-move sites, and that separation is the whole point.
assert(MONEY_OUTCOME_SITES.every(o => !declared.has(o.file)),
  'an outcome-logger is never counted among the six engines')
assert(MONEY_OUTCOME_SITES.every(o => existsSync(o.file) && has(o.file, MONEY_LOG_RE)),
  'each declared outcome-logger exists and actually logs (no dead entry)')
assert(MONEY_OUTCOME_SITES.every(o => !has(o.file, TRANSFER_RE)),
  'and none of them calls transfers.create — if one ever does, it IS an engine and belongs in the six')

console.log('\n[4] the two enumerations relate as documented — subset, NOT equality')
assert(TRANSFER_LEGS.every(f => declared.has(f)), 'TRANSFER ⊂ MONEY_MOVE')
const nonTransferMovers = MONEY_MOVE_SITES.filter(s => !TRANSFER_LEGS.includes(s.file)).map(s => s.file)
assert(nonTransferMovers.length === 3,
  `TRANSFER ≠ MONEY_MOVE — ${nonTransferMovers.length} sites move money with no transfers.create (${nonTransferMovers.map(f => f.replace('lib/', '')).join(', ')})`)
assert(nonTransferMovers.every(f => !has(f, TRANSFER_RE)),
  'and none of those three actually calls transfers.create (the distinction is real, not bookkeeping)')
// |logger.money| ≥ |MONEY_MOVE|, never equality — a REFUSAL to move money is a money outcome too.
const totalMoneyLines = files.reduce((n, f) => n + ((src.get(f) ?? '').match(/logger\.money\s*\(/g) ?? []).length, 0)
assert(totalMoneyLines >= MONEY_MOVE_SITES.length,
  `${totalMoneyLines} logger.money lines across ${MONEY_MOVE_SITES.length} sites — a site may log a REFUSAL as well as a move`)
assert(((src.get('lib/runner-payout.ts') ?? '').match(/logger\.money\s*\(/g) ?? []).length >= 2,
  'runner-payout logs BOTH its already_paid refusal and its paid outcome — why this is ≥, not ==')

console.log('\n[5] reversals — the parallel set, deliberately not money-move sites')
const foundReversals = files.filter(f => has(f, REVERSAL_RE)).sort()
foundReversals.filter(f => !REVERSAL_SITES.some(r => r.file === f)).forEach(f => console.log(`     ✗ UNDECLARED reversal site: ${f}`))
assert(foundReversals.length === REVERSAL_SITES.length,
  `exactly ${REVERSAL_SITES.length} reversal site(s) (found ${foundReversals.length}: ${foundReversals.join(', ') || 'none'})`)
assert(REVERSAL_SITES.every(r => foundReversals.includes(r.file)), 'and it is the declared one, lib/clawback.ts')
assert(REVERSAL_SITES.every(r => !declared.has(r.file)),
  'a reversal site is NOT counted among the six — it is a mechanism two of them share, not a 7th entry point')

console.log('\n[6] anti-vacuity — an empty scan FAILS rather than passing')
// This repo has had a guard go green by finding nothing. Every count above is an equality
// against a declared set, so a scan that read zero files would fail them — but assert the floors
// explicitly so the reason is legible rather than incidental.
assert(files.length >= 100, `the walk actually walked (${files.length} .ts/.tsx files across ${ROOTS.join(', ')})`)
assert(src.size === files.length, 'every scanned file was readable (no silent read failures)')
assert(foundTransfers.length > 0 && foundMoneyLogs.length > 0 && foundReversals.length > 0,
  'each enumeration found something — none of the three passed by finding nothing')

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `✅ money-move-sites-guard: ${pass} passed, 0 failed` : `❌ money-move-sites-guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
