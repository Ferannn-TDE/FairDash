import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server'

// ---------------------------------------------------------------------------
// Clerk middleware — runs on all matched requests.
// Route-level protection is handled per-endpoint in lib/auth.ts.
// The frontend SPA manages its own auth gates via ProtectedRoute / VendorRoute
// in App.jsx, so no routes are protected here — Clerk context is just
// initialised so auth() is available in API route handlers.
//
// If CLERK_SECRET_KEY is absent (initial local setup), fall through so the
// dev server responds to /api/health and other endpoints without crashing.
// ---------------------------------------------------------------------------

const clerkHandler = clerkMiddleware()

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.CLERK_SECRET_KEY) {
    return NextResponse.next()
  }
  return clerkHandler(request, event)
}

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
