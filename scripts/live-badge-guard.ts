/**
 * LIVE-BADGE GUARD — a fair's live/upcoming/ended state derives from DATES in one place, and no
 * surface maps the admin `status === 'ACTIVE'` straight to "Live Now".
 *
 * The bug: StatusBadge mapped status 'active'/'ACTIVE' → "Live Now", and the fair hero hardcoded
 * "Live Now" unconditionally. status is an ENABLEMENT flag, so an ACTIVE fair starting Aug 5 was
 * announced "Live Now" on the public landing page on Jul 23.
 *
 *   [0] POSITIVE CONTROLS (first) — the scanner flags a planted `status === 'ACTIVE' → Live Now`
 *       mapping and a planted hardcoded "Live Now"; deriveEventLiveState actually returns the
 *       three states.
 *   [1] ONE DERIVATION — deriveEventLiveState is the single date-based decision: before start →
 *       upcoming, within → live, after → ended (start/end inclusive), and it is calendar-date /
 *       zone-fixed (no instant-vs-timezone shift, the item-2 fix). Enablement gates: a
 *       non-enabled fair is never live regardless of dates.
 *   [2] NO status→live SHORTCUT — StatusBadge renders the derived 'live' token, not raw 'ACTIVE';
 *       the fair card and fair-info pass the dates; the fair hero is gated on the derived state.
 *
 * Pure file-reader + pure-function. Run:  npx tsx scripts/live-badge-guard.ts
 */

import { readFileSync } from 'node:fs'
import { deriveEventLiveState, fairBadgeState } from '../lib/event-date'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const S = '2026-08-05T00:00:00.000Z', E = '2026-08-12T00:00:00.000Z'
const at = (iso: string) => new Date(iso).getTime()

// status === 'ACTIVE' sitting next to live copy, and a hardcoded live label.
const STATUS_TO_LIVE = /status\s*===\s*'ACTIVE'[\s\S]{0,60}Live Now|'ACTIVE':\s*\{\s*label:\s*'Live Now'/
// Scan CODE, not the comments that document the bug being prevented — a guard that can't tell
// code from its own history forces the explanation to be deleted to stay green (same stance as
// delivery-address-guard). Block comments are stripped; `//` lines dropped.
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
const badge = stripComments(readFileSync('app/_components/StatusBadge.tsx', 'utf8'))

console.log('[0] positive controls')
assert(STATUS_TO_LIVE.test("'ACTIVE': { label: 'Live Now', className: '' }"),
  'scanner flags a planted status==="ACTIVE" → Live Now mapping')
assert(/>\s*Live Now\s*</.test('<span>\n  Live Now\n</span>'), 'scanner can see a hardcoded "Live Now" label')
let states = new Set([
  deriveEventLiveState(S, E, at('2026-07-23T12:00:00Z')),
  deriveEventLiveState(S, E, at('2026-08-08T12:00:00Z')),
  deriveEventLiveState(S, E, at('2026-08-13T12:00:00Z')),
])
assert(states.has('upcoming') && states.has('live') && states.has('ended'), 'deriveEventLiveState returns all three states (not a constant)')

console.log('\n[1] one derivation, calendar-date, enablement-gated')
assert(deriveEventLiveState(S, E, at('2026-07-23T12:00:00Z')) === 'upcoming', 'Jul 23 (before Aug 5) → upcoming, NOT live')
assert(deriveEventLiveState(S, E, at('2026-08-05T06:00:00Z')) === 'live', 'the start day is live (inclusive)')
assert(deriveEventLiveState(S, E, at('2026-08-12T20:00:00Z')) === 'live', 'the end day is live (inclusive)')
assert(deriveEventLiveState(S, E, at('2026-08-13T00:30:00Z')) === 'ended', 'the day after the end → ended')
// The item-2 shift, guarded here too: an America/Chicago viewer must not see the boundary move.
const prevTZ = process.env.TZ
process.env.TZ = 'America/Chicago'
assert(deriveEventLiveState(S, E, at('2026-08-05T02:00:00Z')) === 'live', 'no instant-vs-timezone shift at the start boundary (Chicago)')
process.env.TZ = prevTZ
assert(fairBadgeState('paused', S, E) === 'paused', 'a PAUSED fair is never live, whatever the dates say')
assert(fairBadgeState('ACTIVE', S, E, ) === deriveEventLiveState(S, E), 'an enabled fair delegates entirely to the date derivation')

console.log('\n[2] no status→live shortcut on any surface')
assert(!STATUS_TO_LIVE.test(badge), 'StatusBadge does NOT map raw ACTIVE → Live Now')
assert(/fairBadgeState\(/.test(badge) && /state === 'live'/.test(badge), 'StatusBadge renders the DERIVED live token')
const card = readFileSync('app/_components/FairCard.tsx', 'utf8')
assert(/startDate=\{fair\.startDate\}/.test(card) && /endDate=\{fair\.endDate\}/.test(card), 'the fair card passes dates to the badge')
const info = readFileSync('app/fair/[fairSlug]/info/page.tsx', 'utf8')
assert(/startDate=\{fair\.dates\.startDate\}/.test(info), 'fair-info passes dates to the badge')
const heroPage = readFileSync('app/fair/[fairSlug]/page.tsx', 'utf8')
assert(/deriveEventLiveState\(/.test(heroPage) && /liveState === 'upcoming'/.test(heroPage) && /liveState === 'ended'/.test(heroPage),
  'the fair hero is gated on the derived live-state — the hardcoded "Live Now" is only reached when live')
const vendorPortal = readFileSync('app/vendor/page.tsx', 'utf8')
assert(/deriveEventLiveState\(/.test(vendorPortal) && !/normalizeFairStatus/.test(vendorPortal),
  'the vendor portal partitions Live/Upcoming by the derived state, not the raw status (normalizeFairStatus retired)')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} live-badge-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
