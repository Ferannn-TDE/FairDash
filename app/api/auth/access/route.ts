import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { hasRole } from '@/lib/roles'
import { enforceRateLimit } from '@/lib/ratelimit'
import {
  allPortalStates, vendorPortalStatus, organizerPortalStatus, runnerPortalStatus,
  NO_PORTALS, type PortalState,
} from '@/lib/portal-state'

// GET /api/auth/access?role=runner|vendor|organizer|admin|customer
//
// Does the signed-in user have access to this role's portal? Used by the role
// login pages (RoleAuthCard) to decide: send the user in, or show a terminal
// "no access" state — so login and guard can never disagree and loop.
//
// Strategy: DB IS THE SINGLE AUTHORITY (vendor/runner/organizer read their
// membership row; customer is ungated). The login card and the portal layout now
// read the SAME source, so they can never disagree and ping-pong. There is no
// metadata fast-path — publicMetadata.roles[] is the navbar's hint, not an auth
// gate. admin is the documented exception: metadata-only (no DB membership model).

export async function GET(req: NextRequest) {
  try {
    const role = req.nextUrl.searchParams.get('role') ?? ''
    // No ?role= → DOOR MODE: return every portal's state in one call. With ?role= the existing
    // LOGIN contract (RoleAuthCard) is unchanged.
    const wantsAllPortals = role === ''
    const { userId: clerkId } = await auth()

    // Rate limit: this endpoint does a Clerk currentUser() round-trip (+ maybe a
    // DB read) per authenticated call, so blunt hammering. Keyed per-user when
    // signed in, else per-IP. fail-open (default) — a read endpoint shouldn't lock
    // real users out if Redis is down. ~30/min (the limiter's effective window).
    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'anonymous'
    const rlKey = clerkId ? `access:user:${clerkId}` : `access:ip:${ip}`
    const { allowed, headers: rlHeaders } = await enforceRateLimit(rlKey, 'publicRoutes')
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: rlHeaders },
      )
    }

    // Everyone is a customer — no gate.
    if (role === 'customer') return success({ hasAccess: true })

    // Signed out → no portals, no access. In door mode this is the honest "render no doors"
    // answer (a signed-out visitor is in no portal), NOT an unknown state.
    if (!clerkId) return success(wantsAllPortals ? { states: NO_PORTALS } : { hasAccess: false })

    // admin → metadata only (no DB membership model — the documented single-source
    // -of-truth exception for the admin family).
    if (role === 'admin') {
      const user = await currentUser()
      return success({ hasAccess: hasRole(user?.publicMetadata, 'admin') })
    }

    // All other roles → lib/portal-state.ts, the SAME predicate the portal layouts (the gates)
    // call. This endpoint used to re-derive the answer itself, which made it a THIRD definition
    // of "may this person enter portal X" alongside the doors and the gates. Now there is one.
    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return success(wantsAllPortals ? { states: NO_PORTALS } : { hasAccess: false })

    // ── DOOR MODE (no ?role=) — all three states, for the navbar/landing quick-nav. ──────────
    // One request answers every door, so the client makes a single call rather than three.
    if (wantsAllPortals) return success({ states: await allPortalStates(dbUser.id) })

    // ── LOGIN MODE (?role=) — for RoleAuthCard. ──────────────────────────────────────────────
    //
    // ⚠️ hasAccess IS NOT THE DOOR POLICY, AND MUST NOT BE COLLAPSED ONTO IT. Two different
    // questions that happen to share a source:
    //   • hasAccess ("should the login card send you to the portal URL?") → state !== 'none'.
    //   • the door  ("should a quick-nav link render?")                   → shouldShowPortalDoor.
    // They differ precisely at `pending` and `blocked`. A PENDING organizer SHOULD be sent to
    // /organizer, because that route renders the honest gate screen carrying the approval status
    // and the rejection reason. Answering `false` here would instead dead-end them on the login
    // card's terminal "No Organizer Access" state, which tells them less than the screen they
    // were entitled to. So hasAccess keeps its EXACT prior semantics — row exists → true — while
    // the door applies the stricter policy. `state` is returned alongside so a caller that wants
    // the finer answer never has to re-derive one.
    let state: PortalState
    switch (role) {
      case 'runner':    state = (await runnerPortalStatus(dbUser.id)).state; break
      case 'organizer': state = (await organizerPortalStatus(dbUser.id)).state; break
      case 'vendor':    state = (await vendorPortalStatus(dbUser.id)).state; break
      default:          return success({ hasAccess: false })
    }
    return success({ hasAccess: state !== 'none', state })
  } catch (err) {
    return handleApiError(err)
  }
}
