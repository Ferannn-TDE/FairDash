/**
 * FAIR-CARD GUARD — the one public fair card (app/_components/FairCard.tsx) stays uniform
 * and honest.
 *
 *   [1] STATE — fairCardState/partitionFairCards on pinned instants (never the real clock):
 *       ended fairs leave "Happening now & soon", and only a live fair says "Order now".
 *   [2] COPY — "1 vendor", "17 vendors".
 *   [3] CONTRAST — every badge fg/bg pair and the CTA meet WCAG AA (4.5:1), computed from
 *       the exact values the card renders.
 *   [4] LAYOUT — the card is a full-height flex column with a fixed-ratio banner, a
 *       two-line reserved description and a bottom-pinned CTA; both pages use it.
 *   [5] SCANNER CONTROL — the [4] "one card" scan catches a planted second card.
 *
 * Run:  npx tsx scripts/fair-card-guard.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fairCardState, partitionFairCards, vendorCountLabel, FAIR_CARD_BADGE, type PublicFairCard } from '../lib/fair-view'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const NOW = Date.parse('2026-10-20T15:00:00Z')
const card = (id: string, start: string, end: string, status: PublicFairCard['status'] = 'active'): PublicFairCard =>
  ({ id, name: id, slug: id, status, startDate: `${start}T00:00:00.000Z`, endDate: `${end}T00:00:00.000Z`, vendorCount: 1, primaryColor: '#FF0077' })

console.log('[1] state from dates')
assert(fairCardState(card('a', '2026-10-19', '2026-10-22'), NOW) === 'live', 'positive control: a fair running today is live')
assert(fairCardState(card('a', '2026-10-20', '2026-10-20'), NOW) === 'live', 'a one-day fair is live on its day')
assert(fairCardState(card('b', '2026-10-30', '2026-11-01'), NOW) === 'upcoming', 'a future fair is upcoming')
assert(fairCardState(card('c', '2026-10-11', '2026-10-14'), NOW) === 'ended', 'an ACTIVE fair past its end date is ended')
assert(fairCardState(card('d', '2026-10-19', '2026-10-22', 'upcoming'), NOW) === 'upcoming', 'a not-yet-enabled fair is never live')
assert(fairCardState(card('e', '2026-10-30', '2026-11-01', 'completed'), NOW) === 'ended', 'a completed fair is ended whatever its dates')
const p = partitionFairCards([
  card('ended-old', '2026-06-01', '2026-06-07'), card('soon-late', '2026-12-01', '2026-12-02'),
  card('ended-new', '2026-10-11', '2026-10-14'), card('live', '2026-10-19', '2026-10-22'), card('soon', '2026-10-30', '2026-11-01'),
], NOW)
assert(p.current.map(f => f.id).join() === 'live,soon,soon-late', `current = live then upcoming by start (got ${p.current.map(f => f.id)})`)
assert(p.past.map(f => f.id).join() === 'ended-new,ended-old', 'past = ended, most recent first')
assert(!p.current.some(f => f.id.startsWith('ended')), 'no ended fair in "Happening now & soon"')

console.log('[2] copy')
assert(vendorCountLabel(1) === '1 vendor' && vendorCountLabel(17) === '17 vendors' && vendorCountLabel(0) === '0 vendors', '1 vendor / 17 vendors / 0 vendors')

console.log('[3] contrast (WCAG AA ≥ 4.5:1)')
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
assert(ratio('#FFFFFF', '#000000') > 20.9 && ratio('#777777', '#FFFFFF') < 4.5, 'positive control: the ratio function gives 21:1 for white/black and fails #777 on white')
for (const [state, b] of Object.entries(FAIR_CARD_BADGE)) {
  const r = ratio(b.fg, b.bg)
  assert(r >= 4.5 && /^#[0-9A-F]{6}$/i.test(b.bg), `badge "${b.label}" (${state}) ${b.fg} on opaque ${b.bg} = ${r.toFixed(2)}:1`)
}
const tw = readFileSync('tailwind.config.js', 'utf8')
assert(/'neon-pink': '#FF0077'/.test(tw) && /'bg-card': '#1A1A1A'/.test(tw), 'theme still defines neon-pink #FF0077 and bg-card #1A1A1A')
const cta = ratio('#FF0077', '#1A1A1A')
assert(cta >= 4.5, `CTA neon-pink on the card = ${cta.toFixed(2)}:1`)

console.log('[4] layout and wiring')
const src = readFileSync('app/_components/FairCard.tsx', 'utf8')
assert(/className="h-full"/.test(src) && /h-full flex flex-col/.test(src), 'card fills its grid cell as a flex column')
assert(/aspect-\[3\/1\]/.test(src) && !/\bh-32\b/.test(src), 'banner has a fixed aspect ratio')
assert(/line-clamp-2/.test(src) && /\bh-10\b/.test(src) && /fair\.tagline \?\? ''/.test(src), 'description is clamped to 2 lines and always reserves its height')
assert(/mt-auto/.test(src), 'CTA pinned to the bottom (mt-auto)')
assert(/state === 'live' \? 'Order now →' : 'View fair →'/.test(src) && /fairCardState\(fair\)/.test(src), 'only a live fair says "Order now"; others say "View fair"')
assert(/vendorCountLabel\(/.test(src) && !/vendorCount\} vendors/.test(src), 'vendor count goes through vendorCountLabel')
const landing = readFileSync('app/MarketplaceLanding.tsx', 'utf8')
assert(/partitionFairCards\(allFairs\)\.current/.test(landing) && /<StaggerItem key=\{fair\.id\} className="h-full">/.test(landing), 'landing shows current fairs only, grid items stretch')
const fairs = readFileSync('app/fairs/page.tsx', 'utf8')
assert(/partitionFairCards\(fairs\)/.test(fairs) && /'Past Events'/.test(fairs) && !/f\.status === status/.test(fairs), '/fairs sections by date, ended fairs under Past Events')

function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) { const q = join(dir, n); statSync(q).isDirectory() ? walk(q, out) : /\.tsx$/.test(n) && out.push(q) }
  return out
}
const ORDER_NOW = /['"`>]\s*Order now\b/
const files = [...walk('app'), ...walk('components')]
const offenders = files.filter(f => !f.endsWith('_components/FairCard.tsx') && ORDER_NOW.test(readFileSync(f, 'utf8')))
assert(files.length > 100, `scanned ${files.length} files`)
assert(offenders.length === 0, `no fair-card "Order now" CTA outside FairCard${offenders.length ? ` — ${offenders.join(', ')}` : ''}`)
const users = files.filter(f => /from '(\.\.?\/)*_components\/FairCard'|from '\.\/_components\/FairCard'/.test(readFileSync(f, 'utf8')))
assert(users.some(f => f.endsWith('MarketplaceLanding.tsx')) && users.some(f => f.endsWith('fairs/page.tsx')), 'landing and /fairs both import the shared FairCard')

console.log('[5] scanner control')
assert(ORDER_NOW.test(`<span>Order now →</span>`) && ORDER_NOW.test(`label: 'Order now'`), 'catches a planted "Order now" CTA')
assert(!ORDER_NOW.test('// Order nowhere'), 'ignores unrelated text')

console.log(`\n${fail === 0 ? '✅' : '❌'} fair-card guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
