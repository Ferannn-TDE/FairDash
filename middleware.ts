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

function getRouteRole(pathname: string): string {
  if (pathname.startsWith('/vendor') || pathname.startsWith('/become-vendor')) return 'vendor'
  if (pathname.startsWith('/organizer')) return 'organizer'
  if (pathname.startsWith('/runner') || pathname.startsWith('/become-driver')) return 'runner'
  if (pathname.startsWith('/admin')) return 'admin'
  return 'customer'
}

const clerkHandler = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    const role = getRouteRole(req.nextUrl.pathname)
    const loginUrl = new URL('/login', req.nextUrl.origin)
    loginUrl.searchParams.set('role', role)
    loginUrl.searchParams.set('redirect', req.nextUrl.pathname)
    await auth.protect({ unauthenticatedUrl: loginUrl.toString() })
  }
})

export default function middleware(request: NextRequest, event: NextFetchEvent) {
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
