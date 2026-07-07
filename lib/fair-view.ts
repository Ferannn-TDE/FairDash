// Browser-SAFE fair view types + pure display helpers. Deliberately has NO import
// of lib/db (or anything server-only) so client components can import it without
// dragging the database client into the browser bundle. The DB-touching fetchers
// live in lib/fairs.ts (marked server-only). Keep this file dependency-free.

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
