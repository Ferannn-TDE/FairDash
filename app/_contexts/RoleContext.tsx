'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { ADMIN_ROLES } from '@/lib/roles'
import { shouldShowPortalDoor, type PortalStates } from '@/lib/portal-state'

// ─── THE DOORS — rendered from the GATE'S OWN ANSWER, never from metadata ────────────────────
//
// WHAT THIS USED TO DO, AND WHY IT WAS WRONG. isVendor/isOrganizer/isRunner were computed from
// `publicMetadata.roles[]`. The GATES, meanwhile, read DB membership rows. So the navbar could
// render "Vendor Dashboard" for an account the vendor gate would refuse — measured live on
// 2026-08-01, where the link led straight to a resume screen. And metadata can never be made
// trustworthy enough to fix that: lib/role-sync.ts:91 unions `existing` unconditionally, so an
// ungrounded role — once written — is re-affirmed forever.
//
// The doors now read /api/auth/access, which returns lib/portal-state.ts's answer: the SAME
// predicate the gates themselves call. Door and gate cannot disagree, because there is nothing
// left to disagree about.
//
// ── COST, MEASURED AND STATED PRECISELY ──────────────────────────────────────────────────────
// ONE request per PAGE LOAD — not per session, and not per page view. This provider is mounted
// in the root layout, so it survives client-side navigation (the fetch does not re-run as you
// move around the app) but re-runs on a hard load or refresh. Server-side resolution was
// measured and rejected: it costs 4 SQL round trips minimum (Prisma wraps every operation in
// BEGIN/DEALLOCATE/COMMIT under connection_limit=1 through pgBouncer) and would de-static 10
// prerendered pages, including the public landing and /checkout.
//
// ── UNKNOWN RENDERS NO DOOR. THIS IS THE FLICKER RULE, NOT AN OVERSIGHT ──────────────────────
// `states === null` means "not answered yet", and every door is false in that window. We never
// render a plausible-looking link and correct it a moment later — that is the flicker class this
// repo has fought repeatedly (RunnerContext.tsx:9, vendor-online-state.ts `lockReason:
// 'loading'`, scripts/flicker-class-guard.ts). Absence is SAFE here by construction: the
// criterion is "no link while the account is being served an onboarding/resume/gate screen", so
// a missing link for ~200ms satisfies it, while a link into a gate screen violates it. The
// asymmetry is the whole reason the default is off.

type Role = 'customer' | 'vendor' | 'driver' | 'runner' | 'organizer' | 'admin'

interface RoleContextValue {
  /** Has the portal-state answer arrived? False during the initial fetch. */
  known: boolean
  isVendor: boolean
  isOrganizer: boolean
  isRunner: boolean
  isDriver: boolean // alias for isRunner — kept for backward compat
  isAdmin: boolean
  /** Raw states, for a surface that needs more than the door boolean. Null until known. */
  portals: PortalStates | null
}

const RoleContext = createContext<RoleContextValue>({
  known: false,
  isVendor: false,
  isOrganizer: false,
  isRunner: false,
  isDriver: false,
  isAdmin: false,
  portals: null,
})

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser()
  // null = NOT YET KNOWN. Every door is closed while it is null; see the flicker rule above.
  const [portals, setPortals] = useState<PortalStates | null>(null)

  useEffect(() => {
    if (!isLoaded) return
    if (!user) { setPortals(null); return }

    let cancelled = false
    fetch('/api/auth/access') // no ?role= → door mode, all three states in one call
      .then(r => r.json())
      .then(j => { if (!cancelled && j?.success && j.data?.states) setPortals(j.data.states as PortalStates) })
      .catch(() => { /* leave null — unknown renders no door, which is the safe default */ })
    return () => { cancelled = true }
  }, [isLoaded, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const known = portals !== null

  // The door policy lives in lib/portal-state.ts (shouldShowPortalDoor) so it can be changed in
  // ONE place rather than in three JSX conditionals — notably the organizer-pending arm, which
  // is a deliberate product call and the most likely thing to be revisited.
  const isVendor    = known && shouldShowPortalDoor('vendor',    portals!.vendor)
  const isOrganizer = known && shouldShowPortalDoor('organizer', portals!.organizer)
  const isRunner    = known && shouldShowPortalDoor('runner',    portals!.runner)

  // ADMIN IS THE DOCUMENTED EXCEPTION and deliberately still reads metadata: the admin family
  // has NO DB membership model — it is granted by invite directly in Clerk (lib/role-sync.ts
  // :31-36, lib/auth.ts:148). There is no row for a portal-state predicate to read, so this is
  // the authority rather than a shortcut past one.
  const meta = (user?.publicMetadata ?? {}) as Record<string, unknown>
  const adminRoles: string[] = Array.isArray(meta.roles) ? (meta.roles as string[]) : []
  const isAdmin = adminRoles.some(r => (ADMIN_ROLES as readonly string[]).includes(r))

  const value: RoleContextValue = {
    known,
    isVendor,
    isOrganizer,
    isRunner,
    isDriver: isRunner, // alias
    isAdmin,
    portals,
  }

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRole() {
  return useContext(RoleContext)
}

export type { Role }
