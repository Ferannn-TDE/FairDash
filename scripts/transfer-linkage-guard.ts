/**
 * TRANSFER LINKAGE — a transfer may not carry its own transfer_group when it has a
 * source_transaction that already has one.
 *
 * ── THE PRODUCTION FAILURE ──────────────────────────────────────────────────────────────────
 * Every runner payout was rejected by Stripe, on every sweep, forever:
 *   "You cannot use `transfer_group` if the `source_transaction` already has one set."
 *
 * The charge ALWAYS has a group — the PaymentIntent is created with
 * `transfer_group: order_grp_<uuid>` (app/api/orders/route.ts:436) and the charge inherits it.
 * One value, derived three different ways:
 *
 *   vendor    READS charge.transfer_group (process-payout.ts:290) → MATCHES  → accepted
 *   runner    hardcoded `order_${orderId}`                        → DIFFERS  → REJECTED
 *   organizer hardcoded `event_${eventId}`, NO source_transaction → no conflict
 *
 * Proven on ONE charge: order cmrv5vvly… → vendor transfer tr_3Tvl9NHk… succeeded 2026-07-22,
 * while the runner transfer against that same charge throws. Same charge, both legs, only the
 * transfer_group differs. The two legs that had never executed in production were the wrong
 * ones — the through-line class surfacing as a Stripe 400.
 *
 *   [0] positive controls on the probe
 *   [1] the RULE — sourced ⇒ no group; unsourced ⇒ group required
 *   [2] THE BUG, modelled: the OLD param shape is rejected, the NEW one is not
 *   [3] the call sites are wired to the rule (comment-stripped)
 *   [4] the vendor leg is deliberately NOT routed through it — asserted, so it stays a
 *       recorded decision rather than an oversight
 *
 * Pure logic/file reader. Run:  npx tsx scripts/transfer-linkage-guard.ts
 */

import { readFileSync } from 'node:fs'
import { transferLinkage } from '../lib/process-payout'
import { runnerPayoutIdempotencyKey } from '../lib/runner-payout'
import { stripComments } from './_strip-comments'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

/**
 * A MODEL of Stripe's rule, stated so the control is honest about what it proves. This is not
 * a call to Stripe — it encodes the documented constraint AND the behaviour observed in
 * production: a transfer whose source_transaction already carries a group may not also send a
 * transfer_group of its own. (Stripe accepted the vendor leg's MATCHING value, so the real
 * server is at least this permissive; modelling the stricter rule is the safe direction.)
 */
function stripeWouldReject(
  params: { source_transaction?: string; transfer_group?: string },
  chargeHasGroup: boolean,
): boolean {
  return !!params.source_transaction && chargeHasGroup && params.transfer_group !== undefined
}

console.log('[0] positive controls on the probe')
assert(stripeWouldReject({ source_transaction: 'ch_1', transfer_group: 'g' }, true),
  'the model REJECTS the conflicting shape (probe is live)')
assert(!stripeWouldReject({ source_transaction: 'ch_1' }, true),
  'and ACCEPTS a sourced transfer with no group of its own')
assert(!stripeWouldReject({ transfer_group: 'g' }, false),
  'and accepts an unsourced transfer that carries its own group')

console.log('\n[1] the RULE, one definition')
const sourced = transferLinkage({ sourceTransaction: 'ch_3Tvl9NHk' })
assert(sourced.source_transaction === 'ch_3Tvl9NHk', 'a sourced transfer keeps its source_transaction')
assert(!('transfer_group' in sourced),
  '⛔ and carries NO transfer_group — the charge\'s own group is inherited, which is the only way to be sure it matches')
const unsourced = transferLinkage({ groupWhenUnsourced: 'event_abc' })
assert(unsourced.transfer_group === 'event_abc', 'an UNSOURCED transfer carries its own group (nothing to inherit)')
assert(!('source_transaction' in unsourced), 'and no source_transaction')
// A sourced transfer must never fall back to the group, even if one is offered.
const both = transferLinkage({ sourceTransaction: 'ch_1', groupWhenUnsourced: 'order_x' })
assert(!('transfer_group' in both),
  'source_transaction WINS — offering a group alongside it cannot reintroduce the conflict')
assert(Object.keys(transferLinkage({})).length === 0, 'neither supplied → empty (no invented linkage)')

console.log('\n[2] THE BUG, modelled — old shape rejected, new shape accepted')
const OLD_RUNNER = { source_transaction: 'ch_3Tvl9NHk', transfer_group: 'order_cmrv5vvly0014cf2l762f3h0y' }
const NEW_RUNNER = { ...transferLinkage({ sourceTransaction: 'ch_3Tvl9NHk' }) }
console.log(`     OLD runner params: ${JSON.stringify(OLD_RUNNER)}`)
console.log(`     NEW runner params: ${JSON.stringify(NEW_RUNNER)}`)
assert(stripeWouldReject(OLD_RUNNER, true),
  'OLD: source_transaction + a hand-built transfer_group ⇒ REJECTED (the live production failure)')
assert(!stripeWouldReject(NEW_RUNNER, true),
  'NEW: the same transfer, group omitted ⇒ ACCEPTED')
// The organizer leg was never affected, and that must stay true rather than being folklore.
const ORGANIZER = { ...transferLinkage({ groupWhenUnsourced: 'event_abc' }) }
assert(!stripeWouldReject(ORGANIZER, false),
  'organizer: unsourced batch transfer is unaffected — which is why that leg paid successfully in production')

console.log('\n[3] the call sites are wired to the rule')
const runner = stripComments(readFileSync('lib/runner-payout.ts', 'utf8'))
assert(/transferLinkage\(\{\s*sourceTransaction:\s*chargeId\s*\}\)/.test(runner),
  'runner-payout builds its linkage through transferLinkage')
assert(!/transfer_group:\s*`order_\$\{orderId\}`/.test(runner),
  '⛔ the hardcoded `order_${orderId}` group is GONE from the runner leg (the defect itself)')
const organizer = stripComments(readFileSync('lib/organizer-payout.ts', 'utf8'))
assert(/transferLinkage\(\{\s*groupWhenUnsourced:/.test(organizer),
  'organizer-payout builds its linkage through the same rule')
assert(!/source_transaction/.test(organizer.slice(organizer.indexOf('transferOrTerminal'))),
  'and still passes NO source_transaction (a batch spans several charges)')

console.log('\n[4] the vendor leg is a RECORDED exception, not an oversight')
const vendor = stripComments(readFileSync('lib/process-payout.ts', 'utf8'))
assert(/const transferGroup = charge\.transfer_group/.test(vendor),
  'vendor still READS charge.transfer_group — a matching value, accepted in production')
assert(/transfer_group: transferGroup/.test(vendor),
  'and still passes it (unchanged: the only money path proven end-to-end in prod)')
const doc = readFileSync('lib/process-payout.ts', 'utf8')
assert(/WHY THE VENDOR LEG IS NOT ROUTED THROUGH THIS/.test(doc),
  'the exception is documented WITH its reason at the rule itself, where the next reader will look')

console.log('\n[5] the idempotency key was VERSIONED with the param change')
// THE SECOND HALF OF THE SAME BUG. Stripe binds a key to the exact body it first saw, so the
// transfer_group fix made the old key unusable: every retry presented `runner_payout_<id>`
// with new parameters and Stripe refused — "Keys for idempotent requests can only be used with
// the same parameters they were first used with." Changing the params REQUIRES changing the key.
const k1 = runnerPayoutIdempotencyKey('order_abc')
assert(k1.startsWith('runner_payout_order_abc'), 'the key is still derived from the orderId')
assert(/_v\d+$/.test(k1), '⛔ and carries a VERSION suffix — a param change must not reuse a burned key')
assert(runnerPayoutIdempotencyKey('a') !== runnerPayoutIdempotencyKey('b'), 'distinct orders still get distinct keys')
assert(runnerPayoutIdempotencyKey('a') === runnerPayoutIdempotencyKey('a'),
  'and it is STABLE for one order — still exactly-once, not a new key per attempt')
assert(!/`runner_payout_\$\{orderId\}`/.test(runner),
  'the unversioned literal is gone from the call site (one derivation, not two)')
const keyDoc = readFileSync('lib/runner-payout.ts', 'utf8')
assert(/transfers\.list/.test(keyDoc) && /0 transfers/.test(keyDoc),
  'the safety of bumping is recorded as EVIDENCE (transfers.list returned 0), not as an assumption')
assert(/prove the old key created nothing/.test(keyDoc),
  'and the rule for the next param change is stated where the version lives')

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `✅ transfer-linkage-guard: ${pass} passed, 0 failed` : `❌ transfer-linkage-guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
