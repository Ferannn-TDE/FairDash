/**
 * TYPECHECK GATE — `tsc --noEmit` over the whole project, as a verify-all suite.
 *
 * Why it earns its ~3s: tsx (the runner behind every other suite) STRIPS types without checking
 * them, and the app only compiles at `next build` (deploy time). So a broken compile-time
 * contract — like the /active response type in lib/vendor-active-order, where dropping a select
 * field is DESIGNED to be a build error instead of "undefined" on a card — would otherwise pass
 * the entire gate and die at deploy. This suite makes the compiler part of the batch verdict.
 *
 * Positive-controlled on 2026-07-21: a planted `const x: number = 'a'` and a deleted select
 * field both fail with exit 2; the clean tree passes.
 *
 * Run:  npx tsx scripts/typecheck-gate.ts
 */

import { spawnSync } from 'node:child_process'

const res = spawnSync('npx', ['tsc', '--noEmit'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const out = (res.stdout ?? '') + (res.stderr ?? '')

if (res.status === 0) {
  console.log('  ✅ typecheck: tsc --noEmit clean — ALL PASS')
  process.exit(0)
}
const lines = out.split('\n').filter(l => l.trim()).slice(0, 15)
console.log(`  ❌ typecheck: tsc --noEmit failed (exit ${res.status})`)
for (const l of lines) console.log(`     ${l}`)
process.exit(1)
