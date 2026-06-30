import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server'

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

// Login destination role for unauthenticated users (covers the apply flows too).
function getRouteRole(pathname: string): string {
  if (pathname.startsWith('/vendor') || pathname.startsWith('/become-vendor')) return 'vendor'
  if (pathname.startsWith('/organizer')) return 'organizer'
  if (pathname.startsWith('/runner') || pathname.startsWith('/become-driver')) return 'runner'
  if (pathname.startsWith('/admin')) return 'admin'
  return 'customer'
}

const clerkHandler = clerkMiddleware(async (auth, req) => {
  // Expose the pathname to server layouts (so the DB-authority guards can exempt
  // their own login/unauthorized children without a redirect loop).
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', req.nextUrl.pathname)
  const pass = NextResponse.next({ request: { headers: requestHeaders } })

  if (!isProtectedRoute(req) || isAuthPage(req)) return pass

  const { userId } = await auth()

  // AUTH-ONLY gate. Unauthenticated → that role's login with the FULL return target
  // (pathname + query) preserved, so intent survives the bounce for every role.
  //
  // ROLE authorization is deliberately NOT done here. Each portal's server layout
  // reads its DB membership row (organizer→OrgMember, vendor→VendorMember,
  // runner→Runner) or, for admin, Clerk metadata — the single authority, read
  // live per request. Middleware used to pre-filter on roles[] from the session
  // TOKEN, but that JWT is a separately-staleable snapshot: right after signup it
  // lags the just-written role and bounced freshly-provisioned users to
  // /…/unauthorized before the layout's (correct) DB check ran. Removing the
  // JWT gate removes that entire drift class. A signed-in wrong-role user is now
  // redirected by the portal's own server guard, before render — no UI flash, no
  // security loss, no second source of truth to keep in sync.
  if (!userId) {
    const role = getRouteRole(req.nextUrl.pathname)
    const loginUrl = new URL('/login', req.nextUrl.origin)
    loginUrl.searchParams.set('role', role)
    loginUrl.searchParams.set('redirect', req.nextUrl.pathname + req.nextUrl.search)
    return NextResponse.redirect(loginUrl)
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
