/**
 * STRIPE ERROR CLASSIFICATION — one source, tested against REAL SDK error objects.
 *
 * Taxonomy items 1 and 4 both need "is this Stripe failure terminal or transient", and nothing
 * in this repo decided it. This guard proves the classifier is correct, exhaustive over the
 * shapes our money paths can actually throw, and — the part that matters six months from now —
 * that it stays the ONLY place that decision is made.
 *
 * TEST-THE-ARTIFACT-NOT-A-RECONSTRUCTION: every error below is built with the SDK's OWN error
 * classes (`Stripe.errors.*`) from raw payloads in Stripe's documented shape, never a hand-made
 * `{ code: 'resource_missing' }` that happens to satisfy the classifier. A hand-made object
 * proves the classifier matches my idea of a Stripe error; a real one proves it matches Stripe's.
 * This caught a real property: Stripe's errors leave `name === 'Error'`, so the name-matching
 * fallback used for BullMQ's UnrecoverableError is NOT available here.
 *
 *   [0] positive controls on the probe itself
 *   [1] REAL SDK shapes — terminal
 *   [2] REAL SDK shapes — transient
 *   [3] the UNDECIDED bucket returns `unknown`, never a guess — and ORDER protects it
 *   [4] non-Stripe and malformed inputs are `unknown`, never terminal
 *   [5] single source — nothing else in lib/ decides terminal-vs-transient
 *   [6] anti-vacuity
 *
 * Run:  npx tsx scripts/stripe-error-class-guard.ts
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import Stripe from 'stripe'
import { classifyStripeError, isTerminalStripeError } from '../lib/stripe-error-class'
import { stripComments } from './_strip-comments'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const E = (Stripe as unknown as { errors: Record<string, new (raw: Record<string, unknown>) => Error> }).errors

/** Build a REAL SDK error from a raw payload in Stripe's own shape. */
const mk = (cls: string, raw: Record<string, unknown>) => new E[cls](raw)

console.log('[0] positive controls on the probe itself')
const sample = mk('StripeInvalidRequestError', { message: 'No such destination: acct_x', type: 'invalid_request_error', code: 'resource_missing', statusCode: 400, param: 'destination' })
assert(sample instanceof Error, 'the fixtures are real Error instances from the SDK')
assert((sample as unknown as { type?: string }).type === 'StripeInvalidRequestError', 'the SDK sets `type` from an explicit literal (survives minification)')
assert((sample as unknown as { rawType?: string }).rawType === 'invalid_request_error', "and `rawType` carries the API's own word")
assert(sample.name === 'Error',
  "⚠️ Stripe errors leave name='Error' — the name-matching fallback used for BullMQ is NOT available, so `type` is the discriminator")
assert(classifyStripeError(sample).class !== 'transient', 'the probe distinguishes classes at all (not a constant function)')

console.log('\n[1] REAL SDK shapes — TERMINAL (will never succeed as issued)')
const deadDestination = mk('StripeInvalidRequestError', { message: 'No such destination: acct_1Dead', type: 'invalid_request_error', code: 'resource_missing', statusCode: 400, param: 'destination' })
const dd = classifyStripeError(deadDestination)
assert(dd.class === 'terminal', `a deleted destination account is TERMINAL (${dd.reason.slice(0, 60)}…)`)
assert(dd.code === 'resource_missing' && dd.param === 'destination', 'and the verdict carries code + param, so item 4 can tell WHICH resource is missing')
assert(classifyStripeError(mk('StripePermissionError', { message: 'not permitted', type: 'invalid_request_error', statusCode: 403 })).class === 'terminal',
  'a revoked/deauthorized connection is TERMINAL')
assert(classifyStripeError(mk('StripeAuthenticationError', { message: 'bad key', type: 'authentication_error', statusCode: 401 })).class === 'terminal',
  'bad credentials are TERMINAL — retries fail identically until config changes')
assert(isTerminalStripeError(deadDestination), 'the isTerminal helper agrees with the classifier (one derivation)')

console.log('\n[2] REAL SDK shapes — TRANSIENT (retry is the right move)')
assert(classifyStripeError(mk('StripeConnectionError', { message: 'socket hang up' })).class === 'transient', 'a network failure is TRANSIENT')
assert(classifyStripeError(mk('StripeRateLimitError', { message: 'too many requests', type: 'rate_limit_error', statusCode: 429 })).class === 'transient', 'rate limiting is TRANSIENT')
assert(classifyStripeError(mk('StripeAPIError', { message: 'server error', type: 'api_error', statusCode: 500 })).class === 'transient', 'a Stripe 5xx is TRANSIENT')

console.log('\n[3] the UNDECIDED bucket — `unknown`, never a guess (and ORDER protects it)')
// THE ORDERING TEST. balance_insufficient arrives as invalid_request_error/400 — the broad 4xx
// rule would otherwise absorb it, and calling it terminal is the expensive direction: platform
// funds may simply not have settled yet.
const lowBalance = mk('StripeInvalidRequestError', { message: 'Insufficient funds', type: 'invalid_request_error', code: 'balance_insufficient', statusCode: 400 })
const lb = classifyStripeError(lowBalance)
assert(lb.class === 'unknown', 'balance_insufficient is UNDECIDED — not swept into terminal by the 4xx rule')
assert(/UNDECIDED/.test(lb.reason) && /settle/.test(lb.reason), 'and the verdict SAYS it is undecided, with the reason a human needs')
assert(classifyStripeError(mk('StripeIdempotencyError', { message: 'key reused', type: 'idempotency_error', statusCode: 400 })).class === 'unknown',
  'an idempotency error is UNDECIDED — terminal-shaped, but may mean an earlier attempt partly landed')
assert(classifyStripeError(mk('StripeCardError', { message: 'declined', type: 'card_error', code: 'card_declined', statusCode: 402 })).class === 'unknown',
  'a card error is UNDECIDED — reachability on our money paths is unproven')
assert(classifyStripeError(mk('StripeInvalidRequestError', { message: 'lock timeout', type: 'invalid_request_error', code: 'lock_timeout', statusCode: 400 })).class === 'unknown',
  'lock_timeout is UNDECIDED — on a money object a retry could double-apply')
// An UNRECOGNISED 4xx is where a NEW Stripe error lands. It must not be swept into terminal.
const novel = mk('StripeInvalidRequestError', { message: 'brand new failure', type: 'invalid_request_error', code: 'some_future_code', statusCode: 400 })
assert(classifyStripeError(novel).class === 'unknown',
  'an unrecognised 4xx code is UNKNOWN, not terminal — a future Stripe error keeps its retries')

console.log('\n[4] non-Stripe and malformed input is UNKNOWN — never terminal')
for (const [label, input] of [
  ['a plain Error', new Error('boom')],
  ['a Prisma-shaped error', Object.assign(new Error('db'), { code: 'P2002' })],
  ['null', null], ['undefined', undefined], ['a string', 'nope'], ['a number', 42],
] as [string, unknown][]) {
  const r = classifyStripeError(input)
  assert(r.class === 'unknown', `${label} → unknown (${r.reason.slice(0, 44)}…)`)
  assert(!isTerminalStripeError(input), `${label} is NOT terminal — an unrelated bug must never stop a payout retrying`)
}
// A Prisma P2002 has a `code`, which is exactly the trap: a code-keyed classifier that did not
// require Stripe-shaped fields would read it as a Stripe code.
assert(classifyStripeError(Object.assign(new Error('db'), { code: 'resource_missing' })).class === 'unknown',
  'a NON-Stripe error carrying code=resource_missing is still unknown (Stripe fields are required, not just a code)')

console.log('\n[5] single source — nothing else in lib/ decides terminal-vs-transient')
const SKIP = new Set(['node_modules', '.next', 'mock', '__tests__', '__mocks__'])
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}
// COMMENT-STRIPPED: these tokens appear in prose all over the money modules (every file that
// explains the retry story mentions 'resource_missing'), and a scanner counting prose would
// force those explanations to be deleted to stay green.
const libFiles = walk('lib').filter(f => f !== 'lib/stripe-error-class.ts')
const DECIDERS = /\b(resource_missing|account_invalid|StripeConnectionError|StripeRateLimitError|StripeAuthenticationError|StripePermissionError|StripeIdempotencyError)\b/
const offenders = libFiles.filter(f => DECIDERS.test(stripComments(readFileSync(f, 'utf8'))))
offenders.forEach(f => console.log(`     ✗ second decision site: ${f}`))
assert(offenders.length === 0,
  `no lib/ file outside the classifier keys on a Stripe error identity (${libFiles.length} files scanned)`)

console.log('\n[6] anti-vacuity')
assert(libFiles.length >= 40, `the walk actually walked (${libFiles.length} lib/*.ts files, classifier excluded)`)
const classes = new Set([deadDestination, lowBalance, mk('StripeConnectionError', { message: 'x' })].map(e => classifyStripeError(e).class))
assert(classes.size === 3, `the classifier returns all three classes over the fixtures (got ${[...classes].sort().join(', ')}) — not a constant function`)
assert(Object.keys(E).includes('StripeInvalidRequestError'), 'the SDK error classes really were loaded (fixtures are not silently undefined)')

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `✅ stripe-error-class-guard: ${pass} passed, 0 failed` : `❌ stripe-error-class-guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
