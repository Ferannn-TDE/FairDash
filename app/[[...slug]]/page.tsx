'use client'

import dynamic from 'next/dynamic'
import { ClerkProvider } from '@clerk/clerk-react'
import { clerkAppearance } from '../../lib/clerk-appearance'

// ---------------------------------------------------------------------------
// ClerkProvider comes from @clerk/clerk-react here (NOT @clerk/nextjs).
//
// Why: @clerk/clerk-react@5.60.1 and @clerk/nextjs@5.7.5 ship different
// major versions of @clerk/shared (v3 vs v2), so they create different React
// context objects. useUser/useAuth in the SPA look for the v3 context, so the
// provider wrapping them must also come from @clerk/clerk-react (v3).
//
// @clerk/nextjs is still used on the server (middleware.ts, lib/auth.ts).
// ---------------------------------------------------------------------------

// Disable SSR — the SPA uses BrowserRouter which needs window.location.
// The app's own LoadingAnimation handles the initial loading state.
const App = dynamic(() => import('../../src/App'), { ssr: false })

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ''

export default function Page() {
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} appearance={clerkAppearance}>
      <App />
    </ClerkProvider>
  )
}
