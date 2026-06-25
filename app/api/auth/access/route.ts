import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { hasRole } from '@/lib/roles'
import { enforceRateLimit } from '@/lib/ratelimit'

// GET /api/auth/access?role=runner|vendor|organizer|admin|customer
//
// Does the signed-in user have access to this role's portal? Used by the role
// login pages (RoleAuthCard) to decide: send the user in, or show a terminal
// "no access" state — so login and guard can never disagree and loop.
//
// Strategy (post Step-3 unification): METADATA-FIRST, DB-VERIFY.
//   - publicMetadata.roles[] is the fast gate. If it already grants the role, done.
//   - Otherwise fall back to the DB membership row (the authority) — this catches
//     users whose metadata hasn't been backfilled/synced yet. After backfill the
//     two agree, so the DB read is rarely hit.
// admin is metadata-only (no DB membership model).

export async function GET(req: NextRequest) {
  try {
    const role = req.nextUrl.searchParams.get('role') ?? ''
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

    if (!clerkId) return success({ hasAccess: false })

    const user = await currentUser()

    // admin → metadata only (no DB membership model).
    if (role === 'admin') {
      return success({ hasAccess: hasRole(user?.publicMetadata, 'admin') })
    }

    // Fast path: metadata already grants the role.
    if (hasRole(user?.publicMetadata, role)) return success({ hasAccess: true })

    // Authority fallback: the DB membership row.
    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return success({ hasAccess: false })

    switch (role) {
      case 'runner': {
        const runner = await db.runner.findUnique({
          where: { userId: dbUser.id },
          select: { event: { select: { urlSlug: true } } },
        })
        return success({ hasAccess: Boolean(runner?.event?.urlSlug) })
      }
      case 'organizer': {
        const m = await db.orgMember.findFirst({ where: { userId: dbUser.id }, select: { id: true } })
        return success({ hasAccess: Boolean(m) })
      }
      case 'vendor': {
        const m = await db.vendorMember.findFirst({ where: { userId: dbUser.id }, select: { id: true } })
        return success({ hasAccess: Boolean(m) })
      }
      default:
        return success({ hasAccess: false })
    }
  } catch (err) {
    return handleApiError(err)
  }
}
