'use client'

import Link from 'next/link'
import { useClerk, useUser } from '@clerk/clerk-react'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarDaysIcon,
  UsersIcon,
  ChartBarIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'

// Organizer accent: violet — distinct from customer (pink), vendor (orange), runner (blue)
const A = '#8B5CF6'
const AG = 'rgba(139,92,246,'

const FEATURES = [
  { icon: CalendarDaysIcon, label: 'Event management',       desc: 'Create and configure fairs, set go-live dates, pause ordering instantly.' },
  { icon: UsersIcon,        label: 'Vendor approvals',       desc: 'Review applications, approve or decline with reason, control who goes live.' },
  { icon: ChartBarIcon,     label: 'Live operations view',   desc: 'Monitor orders, revenue, and vendor status across your entire event.' },
  { icon: ShieldCheckIcon,  label: 'Role-based access',      desc: 'Granular permissions — invite team members with the right access level.' },
]

export default function OrganizerLoginPage() {
  const { openSignIn, openSignUp } = useClerk()
  const { isSignedIn } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (isSignedIn) router.replace('/organizer')
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
          <Link href="/sign-in" className="text-text-gray hover:text-white transition-colors">Customer</Link>
          <Link href="/sign-in/vendor" className="text-text-gray hover:text-white transition-colors">Vendor</Link>
          <Link href="/sign-in/runner" className="text-text-gray hover:text-white transition-colors">Runner</Link>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-[400px]">

          {/* Badge */}
          <div className="flex justify-center mb-6">
            <span
              className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border"
              style={{ background: `${AG}0.12)`, borderColor: `${AG}0.25)`, color: A }}
            >
              Organizer Portal
            </span>
          </div>

          <h1 className="font-bebas text-[clamp(2.5rem,6vw,3.5rem)] tracking-wide text-white text-center leading-tight mb-2">
            Run your fair.<br /><span style={{ color: A }}>Own your data.</span>
          </h1>
          <p className="text-text-gray text-sm text-center mb-8">
            Sign in to manage your events, review vendor applications, and monitor live operations.
          </p>

          {/* CTAs */}
          <div className="space-y-3 mb-8">
            <button
              onClick={() => openSignIn({ redirectUrl: '/organizer' })}
              className="w-full py-3.5 text-white font-semibold rounded-xl text-sm transition-all cursor-pointer border-0"
              style={{ background: A, boxShadow: `0 4px 16px ${AG}0.3)` }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              Sign In to Organizer Portal
            </button>
            <button
              onClick={() => openSignUp({ redirectUrl: '/organizer' })}
              className="w-full py-3.5 bg-white/5 border border-white/10 text-white font-semibold rounded-xl text-sm hover:bg-white/10 transition-colors cursor-pointer"
            >
              Create Organizer Account
            </button>
          </div>

          {/* Features */}
          <div className="space-y-3">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3 p-3.5 bg-white/[0.03] border border-white/5 rounded-xl">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: `${AG}0.12)` }}
                >
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
            Looking to sell food at an event?{' '}
            <Link href="/become-vendor" className="hover:underline font-semibold text-neon-pink">
              Become a Vendor instead
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
