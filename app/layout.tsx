import type { Metadata } from 'next'
import { Toaster } from 'react-hot-toast'
import ClerkClientProvider from './_providers/ClerkClientProvider'
import './globals.css'

// ---------------------------------------------------------------------------
// Root layout — single ClerkProvider for the entire tree.
//
// ClerkClientProvider uses @clerk/clerk-react (Core 3) so that client
// components (MarketplaceNavbar, FairNavbar, etc.) can call useClerk /
// useUser. We use @clerk/clerk-react here rather than @clerk/nextjs because
// the two packages ship different @clerk/shared major versions — mixing them
// causes hook lookup failures.
//
// @clerk/nextjs/server is used for server-side auth only (lib/auth.ts,
// middleware.ts, and server layouts). There is ONE ClerkProvider in the tree.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: 'FairSynq - The Fair Comes To Your Door',
  description:
    'FairSynq - Get your favorite fair foods delivered in 30 minutes. Fresh. Fast. Fair.',
  icons: {
    icon: '/images/logo/icon.png',
    apple: '/images/logo/icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkClientProvider>
          {children}
          <Toaster
            position="bottom-center"
            toastOptions={{
              style: {
                background: '#1a1a1a',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '14px',
              },
              success: {
                iconTheme: { primary: '#FF0077', secondary: '#fff' },
              },
            }}
          />
        </ClerkClientProvider>
      </body>
    </html>
  )
}
