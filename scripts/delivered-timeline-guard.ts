/**
 * DELIVERED-TIMELINE GUARD — the customer timeline shows the delivered milestone, keyed on the
 * same signal as the progress bar (status), NOT on a field the money engine treats as
 * load-bearing.
 *
 * The bug: the timeline's delivered row keyed on `order.completedAt`, which is ALWAYS null on
 * DELIVERED orders (reconcile sets completedAt only for COMPLETED — `reconcile-order-status.ts`).
 * So the bar completed (it derives from status) while the timeline stopped at "Picked up".
 *
 * completedAt on DELIVERED — THE RULE CHANGED ON PURPOSE (payout-safety fix, 2026-11).
 * Until then reconcile set completedAt only for COMPLETED, and the null on DELIVERED kept every
 * delivered order out of Pattern C (payout backstop) and Pattern S (earning restore), which scan
 * `status IN COMPLETE_STATES AND completedAt >= windowStart`. That null also hid real misses:
 * four delivered orders whose delayed payout job never ran were invisible to every backstop.
 * Now reconcile stamps completedAt when an order reaches DELIVERED, so orders delivered AFTER the
 * fix ships are covered like COMPLETED ones. There is NO backfill: the older DELIVERED orders
 * have no honest delivery time, and a backfilled date would either sit outside the backstop
 * windows (no benefit) or pull an old order into one (an unwanted payout). Their completedAt
 * stays null for good. The timeline still reads RunnerEarning.createdAt, because legacy rows
 * have no completedAt to show.
 *
 *   [1] TIMELINE keys on status === 'DELIVERED' and reads runnerEarning.createdAt (NOT completedAt).
 *   [2] The order route exposes runnerEarning.createdAt.
 *   [3] RULE — completedAt is set for COMPLETED, and for DELIVERED going forward; nothing
 *       backfills it onto existing DELIVERED orders.
 *
 * Run:  npx tsx scripts/delivered-timeline-guard.ts
 */

import { readFileSync, readdirSync } from 'node:fs'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

console.log('[1] timeline: delivered row keys on status, reads the earning timestamp')
const tl = readFileSync(new URL('../components/order/OrderComponents.tsx', import.meta.url), 'utf8')
// 1200, not 700: the timeline block grew a comment when the read moved to the derived view.
// A slice that a comment can overflow reports a regression that isn't one.
const seg = tl.slice(tl.indexOf('Picked up from booth'), tl.indexOf('Picked up from booth') + 1200)
// The milestone still keys on STATUS (not completedAt) — it now reads it off the ONE derived
// view rather than order.status directly, so the timeline and the progress bar are guaranteed
// to agree about whether the food arrived instead of merely happening to.
assert(/view\.timeline\.delivered/.test(seg), 'delivered row keys on the derived DELIVERED milestone (like the bar)')
assert(/order\.runnerEarning\?\.createdAt/.test(seg), 'delivered row reads runnerEarning.createdAt for the time')
assert(!/status === 'DELIVERED' && order\.completedAt/.test(seg), 'delivered row no longer gated on completedAt (which is always null on DELIVERED)')

// …and the derived milestone is still STATUS-derived, so the indirection did not smuggle in a
// completedAt dependency one file over.
const view = readFileSync(new URL('../lib/order-view.ts', import.meta.url), 'utf8')
assert(/timeline:\s*\{\s*delivered:\s*displayStatus === 'DELIVERED'\s*\}/.test(view),
  "order-view derives timeline.delivered from displayStatus === 'DELIVERED' (never from completedAt)")

console.log('\n[2] order route exposes the delivery timestamp')
const route = readFileSync(new URL('../app/api/orders/[id]/route.ts', import.meta.url), 'utf8')
assert(/runnerEarning:\s*\{\s*select:\s*\{\s*createdAt:\s*true/.test(route), 'route selects runnerEarning.createdAt')

console.log('\n[3] RULE: completedAt set for COMPLETED and, going forward, DELIVERED; no backfill')
const reconcile = readFileSync(new URL('../lib/reconcile-order-status.ts', import.meta.url), 'utf8')
assert(/target === 'COMPLETED'\s*\?\s*\{ completedAt: new Date\(\) \}/.test(reconcile), 'reconcile sets completedAt for COMPLETED')
assert(/target === 'DELIVERED'\s*\?\s*\{ completedAt: new Date\(\) \}/.test(reconcile), 'reconcile sets completedAt for DELIVERED (orders delivered after the fix)')
// No backfill, anywhere: no migration writes completedAt onto existing orders. A data migration is
// the only way old DELIVERED rows could acquire one, and the rule above is forward-only by design.
const migDir = new URL('../prisma/migrations/', import.meta.url)
const backfills = readdirSync(migDir).filter((d) => {
  try { return /UPDATE\s+"Order"[\s\S]*?"completedAt"/i.test(readFileSync(new URL(`${d}/migration.sql`, migDir), 'utf8')) } catch { return false }
})
assert(backfills.length === 0, `no migration backfills Order.completedAt (found: ${backfills.join(', ') || 'none'})`)
// Positive control on that probe: the regex does match a backfill-shaped statement.
assert(/UPDATE\s+"Order"[\s\S]*?"completedAt"/i.test('UPDATE "Order" SET "completedAt" = "updatedAt" WHERE status = \'DELIVERED\''),
  'probe control: the backfill regex matches a backfill statement')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} delivered-timeline-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
