/**
 * HOMEPAGE STATS GUARD — the stats card (B1.7) shows exactly the agreed copy.
 *
 * Copy decided by Feran on 2026-11-13 to match the vendor pitch video, pending the client's
 * confirmation (docs/BATCH-1.md B1.7): 213 orders, 23 vendors, $45 average order, FREE for
 * vendors, caption "Last season". It replaces the signed line "288 orders and nearly $16k in
 * sales over our first two seasons", which must not come back by accident.
 *
 *   [0] the tile parser reads a planted tile list correctly (positive control) and finds
 *       nothing in a file without one (baseline)
 *   [1] the four tiles, in order, exact values and labels
 *   [2] the caption
 *   [3] the old figures and caption are gone from the rendered copy
 *
 * Run:  npx tsx scripts/homepage-stats-guard.ts
 */

import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const assert = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

function tiles(src: string): { value: string; label: string }[] {
  const block = src.match(/const STAT_TILES = \[([\s\S]*?)\n\]/)
  if (!block) return []
  return [...block[1].matchAll(/\{\s*value:\s*'([^']*)',\s*label:\s*'([^']*)'\s*\}/g)].map(m => ({ value: m[1], label: m[2] }))
}

console.log('[0] parser controls')
const planted = `const STAT_TILES = [\n  { value: '1',  label: 'a' },\n  { value: '$2', label: 'b c' },\n]`
assert(JSON.stringify(tiles(planted)) === JSON.stringify([{ value: '1', label: 'a' }, { value: '$2', label: 'b c' }]),
  '[0] positive control: reads a planted tile list')
assert(tiles('const OTHER = [1, 2]').length === 0, '[0] baseline: finds no tiles where there is no tile list')

const src = readFileSync('app/MarketplaceLanding.tsx', 'utf8')
// Comments may quote the old line for the record; only code is checked in [3].
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

console.log('[1] tiles')
const got = tiles(src)
const want = [
  { value: '213', label: 'orders' },
  { value: '23', label: 'vendors' },
  { value: '$45', label: 'average order' },
  { value: 'FREE', label: 'for vendors' },
]
assert(JSON.stringify(got) === JSON.stringify(want), `four tiles, exact: ${got.map(t => `${t.value} ${t.label}`).join(' | ')}`)

console.log('[2] caption')
assert(/>\s*Last season\s*</.test(code), 'caption reads "Last season"')

console.log('[3] old copy gone')
assert(!/'288'|\$16K|nearly|first two seasons/i.test(code), 'no 288, $16K, "nearly" or "first two seasons" in the code')

console.log(`\n${fail === 0 ? '✅' : '❌'} homepage stats guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
