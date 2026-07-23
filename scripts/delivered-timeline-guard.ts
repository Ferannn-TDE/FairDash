/**
 * DELIVERED-TIMELINE GUARD — the customer timeline shows the delivered milestone, keyed on the
 * same signal as the progress bar (status), NOT on a field the money engine treats as
 * load-bearing.
 *
 * The bug: the timeline's delivered row keyed on `order.completedAt`, which is ALWAYS null on
 * DELIVERED orders (reconcile sets completedAt only for COMPLETED — `reconcile-order-status.ts`).
 * So the bar completed (it derives from status) while the timeline stopped at "Picked up".
 *
 * The trap we did NOT fall into: backfilling completedAt on DELIVERED orders. `COMPLETE_STATES`
 * = [COMPLETED, DELIVERED] (`reconciler.ts:137`), and Pattern C (payout backstop) + Pattern S
 * (earning restore) scan `status IN COMPLETE_STATES AND completedAt >= windowStart`. The null
 * completedAt is what keeps the 44 DELIVERED orders OUT of those money windows — backfilling
 * would pull them in. So the timeline reads RunnerEarning.createdAt (the honest delivery-accrual
 * time) instead, and completedAt is left untouched.
 *
 *   [1] TIMELINE keys on status === 'DELIVERED' and reads runnerEarning.createdAt (NOT completedAt).
 *   [2] The order route exposes runnerEarning.createdAt.
 *   [3] SAFETY — completedAt is still set ONLY for COMPLETED in reconcile, never DELIVERED, so
 *       Pattern C/S windows are unchanged.
 *
 * Run:  npx tsx scripts/delivered-timeline-guard.ts
 */

import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

console.log('[1] timeline: delivered row keys on status, reads the earning timestamp')
const tl = readFileSync(new URL('../components/order/OrderComponents.tsx', import.meta.url), 'utf8')
const seg = tl.slice(tl.indexOf('Picked up from booth'), tl.indexOf('Picked up from booth') + 700)
assert(/order\.status === 'DELIVERED'/.test(seg), "delivered row keys on status === 'DELIVERED' (like the bar)")
assert(/order\.runnerEarning\?\.createdAt/.test(seg), 'delivered row reads runnerEarning.createdAt for the time')
assert(!/status === 'DELIVERED' && order\.completedAt/.test(seg), 'delivered row no longer gated on completedAt (which is always null on DELIVERED)')

console.log('\n[2] order route exposes the delivery timestamp')
const route = readFileSync(new URL('../app/api/orders/[id]/route.ts', import.meta.url), 'utf8')
assert(/runnerEarning:\s*\{\s*select:\s*\{\s*createdAt:\s*true/.test(route), 'route selects runnerEarning.createdAt')

console.log('\n[3] SAFETY: completedAt is set only for COMPLETED, never DELIVERED (Pattern C/S windows unchanged)')
const reconcile = readFileSync(new URL('../lib/reconcile-order-status.ts', import.meta.url), 'utf8')
assert(/target === 'COMPLETED'\s*\?\s*\{ completedAt: new Date\(\) \}/.test(reconcile), "reconcile sets completedAt for COMPLETED only")
assert(!/target === 'DELIVERED'[^\n]*completedAt: new Date/.test(reconcile), 'reconcile does NOT set completedAt on DELIVERED (the load-bearing null is preserved)')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} delivered-timeline-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
