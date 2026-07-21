/**
 * CANCEL-LABEL GUARD — the customer tracking surface's terminal-status set must be DERIVED from
 * lib/order-status, never a local copy.
 *
 * The incident (2026-07-21): components/order/helpers.ts carried its own TERMINAL_STATUSES
 * missing REFUNDED and DECLINED. When the accept-timeout auto-cancel fired for the first time
 * (VOS → REFUNDED), the tracking page classified the order as neither cancelled nor cancellable
 * and rendered "Cannot cancel — vendor is preparing" on a REFUNDED order. Same class as every
 * other drifted duplicate: two copies, one lies.
 *
 *   [1] BEHAVIOR — the real exported lists classify correctly (positive control on both sides:
 *       failed statuses in, active/completed statuses OUT).
 *   [2] SOURCE SHAPE — helpers.ts derives from FAILED_STATUSES and no literal status array can
 *       reappear under the TERMINAL_STATUSES name.
 *
 * Run:  npx tsx scripts/cancel-label-guard.ts
 */

import { readFileSync } from 'node:fs'
import { FAILED_STATUSES } from '../lib/order-status'
import { TERMINAL_STATUSES, STATUS_LABELS, STATUS_COLORS } from '../components/order/helpers'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

console.log('[1] behavior: the derived list classifies the full failed set — and ONLY it')
for (const s of ['REFUNDED', 'DECLINED', 'CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE']) {
  assert(TERMINAL_STATUSES.includes(s), `${s} is terminal-failed (isCancelled true → no "vendor is preparing" lockout)`)
}
for (const s of ['PLACED', 'PREPARING', 'COMPLETED', 'DELIVERED']) {
  assert(!TERMINAL_STATUSES.includes(s), `${s} is NOT terminal-failed (positive control: the probe can say no)`)
}
assert(TERMINAL_STATUSES === (FAILED_STATUSES as readonly string[]), 'TERMINAL_STATUSES IS FAILED_STATUSES (same reference, not a copy)')
assert(!!STATUS_LABELS.REFUNDED && !!STATUS_COLORS.REFUNDED, 'REFUNDED has a label + pill style (no raw enum on screen)')

console.log('\n[2] source shape: no local literal list can drift back in')
const helpers = readFileSync(new URL('../components/order/helpers.ts', import.meta.url), 'utf8')
assert(!/TERMINAL_STATUSES\s*(?::[^=]*)?=\s*\[/.test(helpers), 'helpers.ts has NO literal TERMINAL_STATUSES array')
assert(helpers.includes("import { FAILED_STATUSES } from '@/lib/order-status'"), 'helpers.ts imports the canonical FAILED_STATUSES')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} cancel-label-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
