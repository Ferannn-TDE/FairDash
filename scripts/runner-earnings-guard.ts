/**
 * RUNNER-EARNINGS GUARD — what a runner is shown must be what the ledger says they earned.
 *
 * The incident (2026-07-22 diagnosis): the LEDGER was right (amountCents = fee share + tip),
 * but the earnings surfaces carried pre-Part-A copy claiming the number was "the delivery fee
 * the customer paid" — describing $11.50 (= 50% × $12.99 + $5.00 tip, order #762F3H0Y) as the
 * customer's $12.99 fee. lib/runner-earnings now decomposes every line so the UI can only
 * describe what the ledger contains.
 *
 *   [1] THE REAL CASE — #762F3H0Y's exact numbers decompose to $6.50 share + $5.00 tip.
 *   [2] STATUS SPLIT — paid/pending/held sum separately; cancelled is listed but sums to ZERO
 *       everywhere (positive control: the same row sums when not cancelled).
 *   [3] DEFENSIVE HONESTY — a legacy row smaller than its tip clamps to fee-share 0, never
 *       negative; zero rows → all-zero summary (honest empty).
 *   [4] SOURCE SHAPE — route + page import the summarizer/its fields; the lying copy
 *       ("delivery fee the customer paid") can never reappear on the earnings surfaces.
 *
 * Run:  npx tsx scripts/runner-earnings-guard.ts
 */

import { readFileSync } from 'node:fs'
import { summarizeRunnerEarnings, type RunnerLedgerRow } from '../lib/runner-earnings'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const NOW = new Date('2026-07-22T18:00:00Z').getTime()
const today = new Date('2026-07-22T15:00:00Z')
const row = (over: Partial<RunnerLedgerRow> & { tip?: number | null }): RunnerLedgerRow => ({
  orderId: over.orderId ?? 'o-' + Math.random().toString(36).slice(2, 8),
  amountCents: over.amountCents ?? 1150,
  status: over.status ?? 'tracked',
  paidAt: over.paidAt ?? null,
  createdAt: over.createdAt ?? today,
  order: { tip: over.tip === undefined ? 5 : over.tip, fulfillmentType: 'HOME_DELIVERY' },
})

console.log('[1] the real case: #762F3H0Y — $11.50 = $6.50 fee share + $5.00 tip')
const s1 = summarizeRunnerEarnings([row({ orderId: 'cmrv5vvly0014cf2l762f3h0y', amountCents: 1150, tip: 5 })], NOW)
assert(s1.lines[0].feeShareCents === 650, `fee share is $6.50 — 50% of the $12.99 fee, NOT the customer's $12.99 (got ${s1.lines[0].feeShareCents})`)
assert(s1.lines[0].tipCents === 500, 'tip is $5.00 — 100% the runner\'s')
assert(s1.lines[0].totalCents === 1150 && s1.earnedTotalCents === 1150, 'total matches the ledger row exactly')
assert(s1.lines[0].status === 'pending' && s1.pendingTotalCents === 1150 && s1.paidTotalCents === 0, 'tracked reads as PENDING, not paid')

console.log('\n[2] status split: paid / pending / held sum separately; cancelled sums to zero')
const s2 = summarizeRunnerEarnings([
  row({ amountCents: 1000, tip: 0, status: 'paid', paidAt: today }),
  row({ amountCents: 700, tip: 2, status: 'tracked' }),
  row({ amountCents: 500, tip: 0, status: 'held' }),
  row({ amountCents: 900, tip: 0, status: 'cancelled' }),
], NOW)
assert(s2.paidTotalCents === 1000 && s2.pendingTotalCents === 700 && s2.heldTotalCents === 500, 'paid/pending/held each sum their own rows')
assert(s2.earnedTotalCents === 2200, 'earned total EXCLUDES the cancelled row (2200, not 3100)')
assert(s2.lines.length === 4 && s2.lines.some(l => l.status === 'cancelled'), 'cancelled row is still LISTED (history stays honest)')
const s2b = summarizeRunnerEarnings([row({ amountCents: 900, tip: 0, status: 'tracked' })], NOW)
assert(s2b.earnedTotalCents === 900, 'positive control: the same 900c row DOES sum when not cancelled')

console.log('\n[3] defensive honesty')
const s3 = summarizeRunnerEarnings([row({ amountCents: 300, tip: 5 })], NOW) // tip 500c > amount 300c
assert(s3.lines[0].feeShareCents === 0 && s3.lines[0].tipCents === 300, 'row smaller than its tip clamps: share 0, never negative')
const s0 = summarizeRunnerEarnings([], NOW)
assert(s0.earnedTotalCents === 0 && s0.lines.length === 0, 'zero rows → all-zero summary (honest empty state)')
const sOld = summarizeRunnerEarnings([row({ amountCents: 400, tip: 0, createdAt: new Date('2026-07-20T12:00:00Z') })], NOW)
assert(sOld.earnedTodayCents === 0 && sOld.earnedTotalCents === 400, "yesterday's earning counts in total but not today")

console.log('\n[3b] the summarizer is MONEY-ONLY — no delivery count is even available here')
// Custody is the spine for COUNTS, the ledger for MONEY (lib/runner-completion.ts). The old
// deliveriesTotal/deliveriesToday fields undercounted: a DELIVERED zero-fee no-tip order has
// no RunnerEarning row, so the ledger showed "2 deliveries" for 3 made. The fields were
// REMOVED, not paralleled — assert no count field survives for a future caller to reach.
const sAny = summarizeRunnerEarnings([row({ amountCents: 1000, tip: 0, status: 'paid', paidAt: today, createdAt: today })], NOW) as unknown as Record<string, unknown>
assert(!('deliveriesTotal' in sAny) && !('deliveriesToday' in sAny), 'summary exposes NO delivery counts (custody owns counts, the ledger owns money)')
const earnSrc = readFileSync(new URL('../lib/runner-earnings.ts', import.meta.url), 'utf8')
assert(!/HOME_DELIVERY/.test(earnSrc), 'the earnings summarizer has NO HOME_DELIVERY literal (money is fulfillment-agnostic)')
const routeSrcCount = readFileSync(new URL('../app/api/runners/me/earnings/route.ts', import.meta.url), 'utf8')
assert(/deliveriesToday:\s*custody\.deliveredToday/.test(routeSrcCount) && /totalDeliveries:\s*custody\.delivered\b/.test(routeSrcCount),
  'route derives BOTH counts from the custody stats, not the ledger summary')
assert(!/totalDeliveries:\s*runner\.totalCompleted/.test(routeSrcCount) && !/s\.deliveriesTotal/.test(routeSrcCount),
  'neither the dead runner.totalCompleted counter nor a ledger-derived count feeds the route')

console.log('\n[4] source shape: the lying copy is dead')
const routeSrc = readFileSync(new URL('../app/api/runners/me/earnings/route.ts', import.meta.url), 'utf8')
assert(routeSrc.includes('summarizeRunnerEarnings'), 'route derives through the shared summarizer')
assert(!routeSrc.includes('no tip data model'), 'stale "no tip data model" claim removed from the route')
const pageSrc = readFileSync(new URL('../app/runner/[fairSlug]/earnings/page.tsx', import.meta.url), 'utf8')
assert(!pageSrc.includes('delivery fee the customer paid'), 'page no longer claims the number is the customer\'s fee')
assert(pageSrc.includes('share of the delivery fee') && pageSrc.includes('100% of the tip'), 'page states what the number actually is (share + tip)')
assert(pageSrc.includes('feeShare'), 'page renders the per-delivery breakdown')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} runner-earnings-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
