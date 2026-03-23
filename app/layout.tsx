import type { Metadata } from 'next'
import '../src/index.css'

// ---------------------------------------------------------------------------
// Root layout — HTML shell only.
//
// ClerkProvider is intentionally NOT here. Reason:
//   @clerk/nextjs@5.7.5 depends on @clerk/shared@2.9.2
//   @clerk/clerk-react@5.60.1 depends on @clerk/shared@3.47.0
// These are different major versions with different React context instances.
// Wrapping the SPA with @clerk/nextjs ClerkProvider causes useUser / useAuth
// to fail because they look for the v3 context object, not the v2 one.
//
// The ClerkProvider lives in app/[[...slug]]/page.tsx, imported directly from
// @clerk/clerk-react so provider and hooks share the same context.
// @clerk/nextjs is still used server-side in lib/auth.ts and middleware.ts.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: 'FairSynq - The Fair Comes To Your Door',
  description:
    'FairSynq - Get your favorite fair foods delivered in 30 minutes. Fresh. Fast. Fair.',
  icons: {
    icon: '/images/logo/fairdash-icon.png',
    apple: '/images/logo/fairdash-icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
