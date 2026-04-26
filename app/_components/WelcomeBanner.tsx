'use client'

import { useUser, SignedIn } from '@clerk/clerk-react'

export default function WelcomeBanner() {
  const { user } = useUser()
  if (!user) return null

  const firstName = user.firstName || user.username || 'there'

  return (
    <SignedIn>
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 pt-6 pb-2">
        <h2 className="font-bebas text-xl sm:text-2xl text-white uppercase tracking-wide">
          Welcome back, <span className="text-[#FF0077]">{firstName}</span>
        </h2>
        <p className="mt-0.5 text-sm text-text-gray">
          Ready to order? Browse vendors and skip the line.
        </p>
      </div>
    </SignedIn>
  )
}
