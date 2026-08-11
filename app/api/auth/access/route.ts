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
// Strategy: DB IS THE SINGLE AUTHORITY (vendor/runner/organizer read their
// membership row; customer is ungated). The login card and the portal layout now
// read the SAME source, so they can never disagree and ping-pong. There is no
// metadata fast-path — publicMetadata.roles[] is the navbar's hint, not an auth
// gate. admin is the documented exception: metadata-only (no DB membership model).

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
        { success: false, error: { message: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' } },
        { status: 429, headers: rlHeaders },
      )
    }

    // Everyone is a customer — no gate.
    if (role === 'customer') return success({ hasAccess: true })

    if (!clerkId) return success({ hasAccess: false })

    // admin → metadata only (no DB membership model — the documented single-source
    // -of-truth exception for the admin family).
    if (role === 'admin') {
      const user = await currentUser()
      return success({ hasAccess: hasRole(user?.publicMetadata, 'admin') })
    }

    // All other roles → the DB membership row is the SINGLE authority. No metadata
    // fast-path: login (this endpoint) and the portal layout now read the identical
    // source, so they can never disagree and loop. (The metadata roles[] still
    // exists for the navbar, but it is no longer an auth gate.)
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
