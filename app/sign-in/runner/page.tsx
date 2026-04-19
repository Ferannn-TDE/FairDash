'use client'

import Link from 'next/link'
import { useClerk, useUser } from '@clerk/clerk-react'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  BoltIcon,
  MapPinIcon,
  BanknotesIcon,
  DevicePhoneMobileIcon,
} from '@heroicons/react/24/outline'

// Runner accent: utility blue
const A = '#3B82F6'
const AG = 'rgba(59,130,246,'

const FEATURES = [
  { icon: BoltIcon,               label: 'Instant dispatch alerts',   desc: 'Get notified the moment an order is ready for pickup.' },
  { icon: MapPinIcon,             label: 'Turn-by-turn navigation',   desc: 'Integrated maps guide you from vendor booth to customer.' },
  { icon: BanknotesIcon,          label: 'Earnings tracker',          desc: 'See completed deliveries and total earnings in real time.' },
  { icon: DevicePhoneMobileIcon,  label: 'Mobile-first interface',    desc: 'Built for phones — works flawlessly while you\'re on the move.' },
]

export default function RunnerSignInPage() {
  const { openSignIn, openSignUp } = useClerk()
  const { isSignedIn } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (isSignedIn) router.replace('/runner')
  }, [isSignedIn, router])

  return (
    <div className="min-h-screen bg-bg-dark flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <Link href="/" className="group flex items-center">
          <span className="font-bebas text-2xl tracking-widest text-white group-hover:opacity-70 transition-opacity leading-none">FAIR</span>
          <span className="font-bebas text-2xl tracking-widest leading-none" style={{ color: A }}>SYNQ</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/sign-in" className="text-text-gray hover:text-white transition-colors">Customer Sign In</Link>
          <Link href="/sign-in/vendor" className="text-text-gray hover:text-white transition-colors">Vendor Sign In</Link>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-[400px]">

          {/* Badge */}
          <div className="flex justify-center mb-6">
            <span className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border"
              style={{ background: `${AG}0.12)`, borderColor: `${AG}0.25)`, color: A }}>
              Runner Portal
            </span>
          </div>

          <h1 className="font-bebas text-[clamp(2.5rem,6vw,3.5rem)] tracking-wide text-white text-center leading-tight mb-2">
            Deliver.<br /><span style={{ color: A }}>Earn. Repeat.</span>
          </h1>
          <p className="text-text-gray text-sm text-center mb-8">
            Sign in to receive dispatch assignments, navigate to customers, and track your earnings.
          </p>

          {/* CTAs */}
          <div className="space-y-3 mb-8">
            <button
              onClick={() => openSignIn({ redirectUrl: '/runner' })}
              className="w-full py-3.5 text-white font-semibold rounded-xl text-sm transition-all cursor-pointer border-0"
              style={{ background: A, boxShadow: `0 4px 16px ${AG}0.3)` }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              Runner Sign In
            </button>
            <Link
              href="/become-driver"
              className="w-full flex items-center justify-center py-3.5 bg-white/5 border border-white/10 text-white font-semibold rounded-xl text-sm hover:bg-white/10 transition-colors no-underline"
            >
              Apply to Become a Runner
            </Link>
          </div>

          {/* Features */}
          <div className="space-y-3">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3 p-3.5 bg-white/[0.03] border border-white/5 rounded-xl">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: `${AG}0.12)` }}>
                  <Icon className="w-4 h-4" style={{ color: A }} />
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">{label}</p>
                  <p className="text-text-gray text-xs mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-text-gray mt-8">
            Not a runner yet?{' '}
            <Link href="/become-driver" className="hover:underline font-semibold" style={{ color: A }}>
              Apply now — it's free
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
