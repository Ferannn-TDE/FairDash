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
          {/*
            Toast palette. Colours are hardcoded hex rather than Tailwind classes because
            react-hot-toast applies its own light background as an INLINE style, which beats
            any class. Every value below mirrors a token in tailwind.config.js — keep them in
            step: neon-pink #FF0077, bg-card #1A1A1A, text-gray #A1A1A1, boxShadow.glow.

            Error is the loud one (pink outline + glow); success and loading stay quiet grey,
            so the toast that needs attention is the one that gets it.
          */}
          <Toaster
            position="bottom-center"
            toastOptions={{
              style: {
                background: '#1A1A1A',
                color: '#FFFFFF',
                border: '1px solid #A1A1A1',      // text-gray — quiet default
                borderRadius: '12px',
                padding: '12px 14px',
                fontSize: '14px',
                fontFamily: 'Inter, sans-serif',
                boxShadow: 'none',
                maxWidth: '380px',
              },
              success: {
                iconTheme: { primary: '#A1A1A1', secondary: '#1A1A1A' },
              },
              error: {
                style: {
                  border: '1px solid #FF0077',                  // neon-pink
                  boxShadow: '0 0 20px rgba(255, 0, 119, 0.4)', // boxShadow.glow
                },
                iconTheme: { primary: '#FF0077', secondary: '#1A1A1A' },
              },
            }}
          />
        </ClerkClientProvider>
      </body>
    </html>
  )
}
