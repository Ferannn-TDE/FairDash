/**
 * BACKSTOP WARNINGS — must fire on a leak and must NOT fire on the designed path.
 *
 * THE BUG: `reconciler.ts` asserted "any repair means a primary path leaked" of EVERY pattern
 * unconditionally, so a successful pay-when-connected produced
 *   "Pattern P repaired 2 — a real-time path is leaking; investigate."
 * It fired on the organizer batch (2026-07-28 00:08) and on the runner payouts — the two most
 * important successful sweeps this project has had — and went unnoticed both times.
 *
 * It matters out of proportion to its size: this is the block where a genuine Pattern C/D leak
 * would surface DURING the fair. A warning that cries wolf on the designed path trains the
 * reader to skip it. Alert fatigue, in the worst place available.
 *
 * ⚠️ THE LOAD-BEARING HALF IS [2]. A fix that silences everything passes a naive "P no longer
 * warns" test perfectly, so the genuine-leak assertions are what make this suite mean anything.
 *
 *   [0] positive controls on the probe
 *   [1] the DESIGNED path no longer warns (the reported bug)
 *   [2] ⛔ a GENUINE backstop repair STILL warns — the assertion that stops this being a mute button
 *   [3] MIXED patterns stay loud, with honest either/or wording
 *   [4] the classification is complete and honestly biased
 *
 * Pure logic/file reader — no DB, no sweep. Run:  npx tsx scripts/backstop-warning-guard.ts
 */

import { readFileSync } from 'node:fs'
import { stripComments } from './_strip-comments'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const src = stripComments(readFileSync('lib/reconciler.ts', 'utf8'))

/** Re-derive the map from source, so this suite reads what SHIPS rather than a copy of it. */
function parseKinds(): Record<string, string> {
  const block = src.slice(src.indexOf('const PATTERN_KIND'), src.indexOf('// ─── Tunables'))
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/^\s*([A-Z]):\s*\{\s*kind:\s*'(backstop|designed|mixed)'/gm)) out[m[1]] = m[2]
  return out
}
const KINDS = parseKinds()

/**
 * THE SHIPPED DECISION, re-implemented from the source's own branches so a change to the rule
 * shows up here. Returns the warning text a repair would produce, or null for silence.
 */
function warnFor(pattern: string, n: number): string | null {
  const kind = KINDS[pattern]
  if (!kind) return `Pattern ${pattern} repaired ${n} — UNCLASSIFIED`
  if (kind === 'designed') return null
  if (kind === 'mixed') return `Pattern ${pattern} repaired ${n} — EITHER a dropped enqueue (leak) OR a pay-on-connect (designed).`
  return `Pattern ${pattern} repaired ${n} — a real-time path is leaking`
}

console.log('[0] positive controls on the probe')
assert(Object.keys(KINDS).length >= 15, `the map parsed out of the shipped source (${Object.keys(KINDS).length} patterns)`)
assert(warnFor('C', 1) !== null && warnFor('R', 1) === null,
  'the probe distinguishes a warning from silence (not a constant function)')
assert(warnFor('ZZ', 1)?.includes('UNCLASSIFIED') === true,
  'an UNKNOWN pattern still warns — declared passes, silent fails; a new pattern cannot hide')

console.log('\n[1] the DESIGNED path no longer warns — the reported bug')
assert(KINDS.R === 'designed', 'R (tip-refund execution) is designed: there is no per-order enqueue, the sweep IS the primary path')
assert(warnFor('R', 3) === null, 'a tip-refund execution produces NO leak warning')
assert(KINDS.D === 'designed', 'D (pay-when-a-held-vendor-connects) is designed: the hold exists BECAUSE the vendor was unconnected')
assert(warnFor('D', 2) === null, 'draining a hold on vendor verification produces NO leak warning')

console.log('\n[2] ⛔ a GENUINE backstop repair STILL warns (the load-bearing half)')
// Without these, "silence everything" would pass [1] and [3] perfectly.
const MUST_WARN = ['A', 'B', 'C', 'E', 'F', 'G', 'H', 'I', 'N', 'S', 'T', 'X'] as const
for (const p of MUST_WARN) {
  assert(KINDS[p] === 'backstop', `${p} is classified backstop`)
  assert(warnFor(p, 1)?.includes('a real-time path is leaking') === true,
    `${p} repairing STILL says a real-time path is leaking`)
}
assert(warnFor('C', 5)?.includes('leaking') === true,
  '⛔ Pattern C — a COMPLETED order with no payout — is the one that must NEVER go quiet during the fair')

console.log('\n[3] MIXED stays loud, with honest wording')
assert(KINDS.P === 'mixed' && KINDS.Q === 'mixed', 'P and Q are mixed — their own docs say BOTH backstop and pay-on-connect')
for (const p of ['P', 'Q']) {
  const w = warnFor(p, 2)
  assert(w !== null, `${p} still warns — silencing it could hide a dropped enqueue`)
  assert(w?.includes('EITHER') === true && w?.includes('pay-on-connect') === true,
    `${p} no longer CLAIMS a leak — it states both possibilities`)
  assert(w?.includes('a real-time path is leaking; investigate') !== true,
    `${p} does not assert the false version that fired on both proving runs`)
}
assert(/stripeConnectedAt/.test(src),
  'and the message names the cheap discriminator (payee connected AFTER the window closed ⇒ designed)')

console.log('\n[4] the classification is complete and honestly biased')
const repairable = [...new Set([...src.matchAll(/sum\.repaired\.([A-Z])\b/g)].map(m => m[1]))].sort()
const unclassified = repairable.filter(p => !KINDS[p])
unclassified.forEach(p => console.log(`     ✗ Pattern ${p} can repair but declares no kind`))
assert(unclassified.length === 0,
  `every pattern that can increment repaired declares a kind (${repairable.length} checked: ${repairable.join('')})`)
// Bias check: mislabelling a backstop as designed silences a real leak; the reverse is noise.
// So `designed` must stay a SMALL, named set — not the convenient default.
const designed = Object.entries(KINDS).filter(([, k]) => k === 'designed').map(([p]) => p)
assert(designed.length <= 3,
  `'designed' is a small named set (${designed.join(', ') || 'none'}) — it silences a warning, so it is the expensive direction to get wrong`)
assert(Object.values(KINDS).filter(k => k === 'backstop').length >= 10,
  'the overwhelming majority remain backstop — this widened precision, it did not become a mute button')

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `✅ backstop-warning-guard: ${pass} passed, 0 failed` : `❌ backstop-warning-guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
