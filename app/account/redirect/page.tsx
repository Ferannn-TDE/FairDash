'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/clerk-react'

export default function AccountRedirectPage() {
  const { isSignedIn, isLoaded } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      router.replace('/sign-in')
      return
    }
    const dest = sessionStorage.getItem('post-login-redirect')
    if (dest) {
      sessionStorage.removeItem('post-login-redirect')
      router.replace(dest)
    } else {
      router.replace('/account')
    }
  }, [isLoaded, isSignedIn, router])

  return (
    <div className="min-h-screen bg-bg-dark flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-white/20 border-t-neon-pink rounded-full animate-spin" />
    </div>
  )
}
