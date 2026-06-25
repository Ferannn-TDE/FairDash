import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server'
import { ADMIN_ROLES } from './lib/roles'

// Routes that require authentication (/api/webhooks is intentionally excluded)
const isProtectedRoute = createRouteMatcher([
  '/become-vendor(.*)',
  '/vendor(.*)',
  '/organizer(.*)',
  '/become-driver(.*)',
  '/runner(.*)',
  '/admin(.*)',
  '/account(.*)',
  '/onboarding(.*)',
])

// Auth pages live INSIDE protected prefixes (/organizer/login, /admin/login), so
// the matcher above would protect the very page you sign in on — and the
// unauthenticated redirect points back at that login → ping-pong. A login page
// must never sit inside its own gate. Keep these public.
const isAuthPage = createRouteMatcher([
  '/login',
  '/sign-in(.*)',
  '/organizer/login',
  '/admin/login',
])

// Terminal "no access" pages live under their portal prefix too — they must not
// be role-gated, or wrong-role users would loop into them.
const isUnauthPage = createRouteMatcher(['/organizer/unauthorized', '/vendor/unauthorized'])

// PORTALS that require a specific role (the fast filter; per-layout DB checks are
// the authority behind it). NOTE: /become-vendor, /become-driver, /account,
// /onboarding are authenticated-but-roleless flows (a customer applies to become
// a vendor) — they are NOT role-gated here.
const portalGates: Array<{ match: ReturnType<typeof createRouteMatcher>; role: string }> = [
  { match: createRouteMatcher(['/organizer(.*)']), role: 'organizer' },
  { match: createRouteMatcher(['/vendor(.*)']), role: 'vendor' },
  { match: createRouteMatcher(['/runner(.*)']), role: 'runner' },
  { match: createRouteMatcher(['/admin(.*)']), role: 'admin' },
]

// Login destination role for unauthenticated users (covers the apply flows too).
function getRouteRole(pathname: string): string {
  if (pathname.startsWith('/vendor') || pathname.startsWith('/become-vendor')) return 'vendor'
  if (pathname.startsWith('/organizer')) return 'organizer'
  if (pathname.startsWith('/runner') || pathname.startsWith('/become-driver')) return 'runner'
  if (pathname.startsWith('/admin')) return 'admin'
  return 'customer'
}

// Wrong-role → TERMINAL page (never a login → no loops). organizer/vendor have
// dedicated pages; runner/admin fall back to home.
function unauthorizedUrl(role: string, origin: string): URL {
  if (role === 'organizer') return new URL('/organizer/unauthorized', origin)
  if (role === 'vendor') return new URL('/vendor/unauthorized', origin)
  return new URL('/', origin)
}

const clerkHandler = clerkMiddleware(async (auth, req) => {
  // Expose the pathname to server layouts (so the DB-authority guards can exempt
  // their own login/unauthorized children without a redirect loop).
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', req.nextUrl.pathname)
  const pass = NextResponse.next({ request: { headers: requestHeaders } })

  if (!isProtectedRoute(req) || isAuthPage(req)) return pass

  const { userId, sessionClaims } = await auth()

  // 1. Unauthenticated → that role's login with ?redirect= back.
  if (!userId) {
    const role = getRouteRole(req.nextUrl.pathname)
    const loginUrl = new URL('/login', req.nextUrl.origin)
    loginUrl.searchParams.set('role', role)
    loginUrl.searchParams.set('redirect', req.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  // 2. Authenticated: fast role-gate on the portal prefixes (terminal, no login).
  //    Reads roles[] from the session token (Clerk session-token customization:
  //    metadata = {{user.public_metadata}}). Stale-token note: a role granted
  //    mid-session is only visible after token refresh — until then the user may
  //    be briefly denied here. The per-layout DB checks are the authority; the
  //    failure mode is "briefly denied then works", never "wrongly admitted".
  if (!isUnauthPage(req)) {
    const gate = portalGates.find((g) => g.match(req))
    if (gate) {
      const meta = sessionClaims?.metadata as { roles?: string[] } | undefined
      const roles = Array.isArray(meta?.roles) ? meta.roles : []
      const ok =
        gate.role === 'admin'
          ? roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r))
          : roles.includes(gate.role)
      if (!ok) return NextResponse.redirect(unauthorizedUrl(gate.role, req.nextUrl.origin))
    }
  }

  return pass
})

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.CLERK_SECRET_KEY) {
    return NextResponse.next()
  }
  return clerkHandler(request, event)
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
