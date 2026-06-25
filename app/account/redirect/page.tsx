'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useUser } from '@clerk/clerk-react'
import { safeRedirect } from '@/lib/safe-redirect'

// Post-auth redirect page. Reads the unified ?redirect= convention (validated)
// and sends the user there; defaults to /account. (Previously used a separate
// sessionStorage['post-login-redirect'] mechanism — migrated to ?redirect=.)
function AccountRedirectInner() {
  const { isSignedIn, isLoaded } = useUser()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      router.replace('/sign-in/customer')
      return
    }
    router.replace(safeRedirect(searchParams.get('redirect'), '/account'))
  }, [isLoaded, isSignedIn, router, searchParams])

  return (
    <div className="min-h-screen bg-bg-dark flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-white/20 border-t-neon-pink rounded-full animate-spin" />
    </div>
  )
}

export default function AccountRedirectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-dark" />}>
      <AccountRedirectInner />
    </Suspense>
  )
}
