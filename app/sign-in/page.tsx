'use client'

import Link from 'next/link'
import { useClerk, useUser } from '@clerk/clerk-react'
import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  MapPinIcon,
  ClockIcon,
  HeartIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline'

const FEATURES = [
  { icon: MapPinIcon,      label: 'Discover fairs near you', desc: 'Browse vendors and menus at every event in your area.' },
  { icon: ShoppingBagIcon, label: 'Order in seconds',        desc: 'Add items, choose pickup or delivery, and pay seamlessly.' },
  { icon: ClockIcon,       label: 'Real-time tracking',      desc: 'Watch your order progress live from prep to handoff.' },
  { icon: HeartIcon,       label: 'Save your favorites',     desc: 'Bookmark vendors and items for your next visit.' },
]

function CustomerSignInContent() {
  const { openSignIn, openSignUp } = useClerk()
  const { isSignedIn } = useUser()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectUrl = searchParams.get('redirect_url') ?? searchParams.get('redirect') ?? '/account'

  useEffect(() => {
    if (isSignedIn) router.replace(redirectUrl)
  }, [isSignedIn, router, redirectUrl])

  return (
    <div className="min-h-screen bg-bg-dark flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <Link href="/" className="group flex items-center">
          <span className="font-bebas text-2xl tracking-widest text-white group-hover:text-neon-pink transition-colors leading-none">FAIR</span>
          <span className="font-bebas text-2xl tracking-widest text-neon-pink group-hover:text-white transition-colors leading-none">SYNQ</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/sign-in/vendor" className="text-text-gray hover:text-white transition-colors">Vendor Sign In</Link>
          <Link href="/sign-in/runner" className="text-text-gray hover:text-white transition-colors">Runner Sign In</Link>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-[400px]">

          {/* Badge */}
          <div className="flex justify-center mb-6">
            <span className="px-3 py-1 rounded-full bg-neon-pink/10 border border-neon-pink/20 text-neon-pink text-xs font-semibold uppercase tracking-wider">
              Customer Portal
            </span>
          </div>

          <h1 className="font-bebas text-[clamp(2.5rem,6vw,3.5rem)] tracking-wide text-white text-center leading-tight mb-2">
            Fair food,<br /><span className="text-neon-pink">your way</span>
          </h1>
          <p className="text-text-gray text-sm text-center mb-8">
            Sign in to discover local fairs, order your favorites, and track your delivery.
          </p>

          {/* CTAs */}
          <div className="space-y-3 mb-8">
            <button
              onClick={() => openSignIn({ redirectUrl })}
              className="w-full py-3.5 bg-neon-pink text-white font-semibold rounded-xl text-sm hover:bg-[#e0006b] shadow-[0_4px_16px_rgba(255,0,119,0.3)] transition-colors cursor-pointer border-0"
            >
              Sign In
            </button>
            <button
              onClick={() => openSignUp({ redirectUrl })}
              className="w-full py-3.5 bg-white/5 border border-white/10 text-white font-semibold rounded-xl text-sm hover:bg-white/10 transition-colors cursor-pointer"
            >
              Create Account
            </button>
          </div>

          {/* Features */}
          <div className="space-y-3">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3 p-3.5 bg-white/[0.03] border border-white/5 rounded-xl">
                <div className="w-8 h-8 bg-neon-pink/10 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-neon-pink" />
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">{label}</p>
                  <p className="text-text-gray text-xs mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Vendor CTA */}
          <p className="text-center text-xs text-text-gray mt-8">
            Want to sell at fairs?{' '}
            <Link href="/become-vendor" className="text-neon-pink hover:underline font-semibold">
              Become a Vendor
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function CustomerSignInPage() {
  return (
    <Suspense>
      <CustomerSignInContent />
    </Suspense>
  )
}
