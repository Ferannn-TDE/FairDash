// Browser-SAFE fair view types + pure display helpers. Deliberately has NO import
// of lib/db (or anything server-only) so client components can import it without
// dragging the database client into the browser bundle. The DB-touching fetchers
// live in lib/fairs.ts (marked server-only). Keep this file dependency-free
// (lib/event-date is itself import-free, so it is the one allowed import).

import { deriveEventLiveState } from './event-date'

/** The public fair list shape returned by /api/fairs and getAllFairsCached. */
export interface FairListItem {
  id: string
  name: string
  slug: string
  description: string | null
  primaryColor: string
  status: string
  startDate: string
  endDate: string
  vendorCount: number
}

export type PublicFairStatus = 'active' | 'upcoming' | 'completed'

/** Map a DB EventStatus to the customer vocabulary. Only ACTIVE/UPCOMING are ever
 *  listed publicly (the endpoints filter to those); INACTIVE → 'completed'. */
export function toPublicFairStatus(s: string): PublicFairStatus {
  const m: Record<string, PublicFairStatus> = {
    ACTIVE: 'active', UPCOMING: 'upcoming', INACTIVE: 'completed', COMPLETED: 'completed',
  }
  return m[s] ?? 'upcoming'
}

/** The lean shape a FairCard needs. Location is optional — the Event schema has no
 *  structured city/state, so the card hides it rather than showing placeholder text. */
export interface PublicFairCard {
  id: string
  name: string
  slug: string
  status: PublicFairStatus
  startDate: string
  endDate: string
  vendorCount: number
  primaryColor: string
  tagline?: string | null
  city?: string | null
  state?: string | null
}

/** FairListItem (from /api/fairs or getAllFairsCached) → FairCard view model. */
export function toPublicFairCard(e: FairListItem): PublicFairCard {
  return {
    id: e.id,
    name: e.name,
    slug: e.slug,
    status: toPublicFairStatus(e.status),
    startDate: e.startDate,
    endDate: e.endDate,
    vendorCount: e.vendorCount,
    primaryColor: e.primaryColor,
    tagline: e.description ?? null,
  }
}

/** Where a fair card stands TODAY: live, upcoming or ended. Derived from the dates, not
 *  the admin status: an ACTIVE fair whose end date has passed is ended, and must never
 *  sit under "Happening now" with an "Order now" button. A not-yet-enabled fair is at
 *  most upcoming, whatever the dates say. */
export type FairCardState = 'live' | 'upcoming' | 'ended'

export function fairCardState(
  f: Pick<PublicFairCard, 'status' | 'startDate' | 'endDate'>,
  nowMs = Date.now(),
): FairCardState {
  if (f.status === 'completed') return 'ended'
  const byDate = deriveEventLiveState(f.startDate, f.endDate, nowMs) ?? 'upcoming'
  if (f.status === 'upcoming' && byDate === 'live') return 'upcoming'
  return byDate
}

/** Split fairs for the discovery surfaces. `current` = live (soonest-started first) then
 *  upcoming (soonest first); `past` = ended, most recently ended first. */
export function partitionFairCards<T extends PublicFairCard>(fairs: T[], nowMs = Date.now()) {
  const byStart = (a: T, b: T) => a.startDate.localeCompare(b.startDate)
  const live = fairs.filter(f => fairCardState(f, nowMs) === 'live').sort(byStart)
  const upcoming = fairs.filter(f => fairCardState(f, nowMs) === 'upcoming').sort(byStart)
  const past = fairs.filter(f => fairCardState(f, nowMs) === 'ended').sort((a, b) => b.endDate.localeCompare(a.endDate))
  return { live, upcoming, current: [...live, ...upcoming], past }
}

/** "1 vendor", "17 vendors", "0 vendors". */
export function vendorCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'vendor' : 'vendors'}`
}

/** Fair-card status badge. Opaque near-black pill so the text contrast never depends on
 *  the fair's gradient behind it. Every fg/bg pair is ≥ 4.5:1 (WCAG AA, normal text);
 *  scripts/fair-card-guard.ts computes the ratios from these exact values. */
export const FAIR_CARD_BADGE: Record<FairCardState, { label: string; fg: string; bg: string }> = {
  live:     { label: 'Live now',      fg: '#6EE7B7', bg: '#0F0F0F' },
  upcoming: { label: 'Starting soon', fg: '#7DD3FC', bg: '#0F0F0F' },
  ended:    { label: 'Ended',         fg: '#D4D4D8', bg: '#0F0F0F' },
}
