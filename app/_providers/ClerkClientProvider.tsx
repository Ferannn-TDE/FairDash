'use client'

import { ClerkProvider } from '@clerk/clerk-react'
import { clerkAppearance, clerkLocalization } from '@/lib/clerk-appearance'
import { RoleProvider } from '@/app/_contexts/RoleContext'

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ''

export default function ClerkClientProvider({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} appearance={clerkAppearance} localization={clerkLocalization} signInUrl="/login" signUpUrl="/login">
      <RoleProvider>
        {children}
      </RoleProvider>
    </ClerkProvider>
  )
}
