'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { SignIn, SignUp } from '@clerk/clerk-react'
import { ShoppingBag, Store, CalendarDays, Truck, type LucideIcon } from 'lucide-react'

type LoginRole = 'customer' | 'vendor' | 'organizer' | 'runner'

interface RoleConfig {
  id: LoginRole
  Icon: LucideIcon
  title: string
  shortLabel: string
  description: string
  redirectTo: string
  color: string
}

const ROLES: RoleConfig[] = [
  {
    id: 'customer',
    Icon: ShoppingBag,
    title: "I'm a Customer",
    shortLabel: 'Customer',
    description: 'Browse fairs, order food, skip the line.',
    redirectTo: '/fairs',
    color: '#FF0077',
  },
  {
    id: 'vendor',
    Icon: Store,
    title: "I'm a Vendor",
    shortLabel: 'Vendor',
    description: 'Manage your booth, menu, and orders.',
    redirectTo: '/vendor/dashboard',
    color: '#FF6B35',
  },
  {
    id: 'organizer',
    Icon: CalendarDays,
    title: "I'm an Organizer",
    shortLabel: 'Organizer',
    description: 'Run your fair with FairSynq.',
    redirectTo: '/organizer',
    color: '#8B5CF6',
  },
  {
    id: 'runner',
    Icon: Truck,
    title: "I'm a Runner",
    shortLabel: 'Runner',
    description: 'Deliver food and earn at events.',
    redirectTo: '/runner',
    color: '#3B82F6',
  },
]

const VALID_ROLES: LoginRole[] = ['customer', 'vendor', 'organizer', 'runner']

const clerkElements = {
  rootBox: 'w-full',
  card: 'bg-transparent shadow-none p-0 w-full gap-3 border-0',
  headerTitle: 'hidden',
  headerSubtitle: 'hidden',
  header: 'hidden',
  logoBox: 'hidden',
  logoImage: 'hidden',
  socialButtonsBlockButton:
    'relative bg-white/[0.04] border border-white/[0.08] text-white hover:bg-white/[0.08] hover:border-white/[0.12] transition-all duration-200 rounded-xl h-12 font-inter mt-0',
  socialButtonsBlockButtonText: 'font-inter text-sm text-gray-200 font-medium',
  socialButtonsProviderIcon: 'w-5 h-5',
  dividerLine: 'bg-white/[0.06]',
  dividerText: 'text-gray-600 font-inter text-xs uppercase tracking-wider bg-[#111111] px-3',
  formFieldLabel: 'text-xs font-inter text-gray-400 uppercase tracking-wider mb-1.5',
  formFieldInput:
    'w-full h-12 px-4 bg-white/[0.03] border border-white/[0.08] text-white text-sm font-inter rounded-xl placeholder:text-gray-600 focus:border-[#FF0077]/40 focus:ring-1 focus:ring-[#FF0077]/20 focus:bg-white/[0.04] transition-all duration-200 outline-none',
  formFieldInputShowPasswordButton: 'text-gray-500 hover:text-gray-300',
  formButtonPrimary:
    'w-full h-12 bg-[#FF0077] hover:bg-[#FF0077]/90 active:scale-[0.98] text-white font-inter font-semibold text-sm uppercase tracking-wider rounded-xl transition-all duration-200 shadow-[0_4px_20px_rgba(255,0,119,0.25)] hover:shadow-[0_4px_30px_rgba(255,0,119,0.35)]',
  formFieldAction: 'text-[#FF0077] hover:text-[#FF0077]/80 font-inter text-xs transition-colors',
  identityPreviewEditButton: 'text-[#FF0077] hover:text-[#FF0077]/80',
  formResendCodeLink: 'text-[#FF0077] hover:text-[#FF0077]/80',
  backLink: 'text-[#FF0077] hover:text-[#FF0077]/80',
  footer: 'hidden',
  footerAction: 'hidden',
  footerPages: 'hidden',
  alert: 'bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm p-4',
}

export default function LoginContent() {
  const searchParams = useSearchParams()
  const rawRole = searchParams.get('role') as LoginRole | null
  const redirectPath = searchParams.get('redirect') ?? ''
  const initialRole = rawRole && VALID_ROLES.includes(rawRole) ? rawRole : 'customer'

  const [selectedRole, setSelectedRole] = useState<LoginRole>(initialRole)
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')

  useEffect(() => {
    if (rawRole && VALID_ROLES.includes(rawRole)) setSelectedRole(rawRole)
  }, [rawRole])

  const activeRole = ROLES.find(r => r.id === selectedRole)!
  const afterSignIn = redirectPath || activeRole.redirectTo
  const afterSignUp = redirectPath
    ? `/onboarding?role=${selectedRole}&redirect=${encodeURIComponent(redirectPath)}`
    : `/onboarding?role=${selectedRole}`

  return (
    <div className="min-h-screen flex">

      {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[48%] relative overflow-hidden bg-[#0a0a0a]">

        {/* Layered gradient atmosphere */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#FF0077]/8 via-transparent to-transparent" />
          <div className="absolute bottom-0 right-0 w-[70%] h-[70%] bg-gradient-to-tl from-[#FF0077]/5 via-transparent to-transparent" />
        </div>

        {/* Subtle grid texture */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                               linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }}
        />

        {/* Floating glow orb */}
        <div className="absolute top-[20%] right-[10%] w-[300px] h-[300px] rounded-full bg-[#FF0077]/6 blur-[100px] pointer-events-none" />

        {/* Content */}
        <div className="relative z-10 flex flex-col h-full p-10 xl:p-14">

          {/* Logo */}
          <a href="/" className="group flex items-center w-fit">
            <span className="font-bebas text-2xl tracking-widest text-white transition-colors duration-200 group-hover:text-[#FF0077] leading-none">FAIR</span>
            <span className="font-bebas text-2xl tracking-widest text-[#FF0077] transition-colors duration-200 group-hover:text-white leading-none">SYNQ</span>
          </a>

          {/* Role selection — centered content block */}
          <div className="flex-1 flex flex-col justify-center">
            <div className="max-w-md mx-auto w-full">
              <h2 className="font-bebas text-3xl xl:text-4xl text-white uppercase leading-tight tracking-wide">
                How Are You<br />
                <span className="text-[#FF0077]">Using FairSynq?</span>
              </h2>
              <p className="mt-2 text-sm text-gray-500 font-inter leading-relaxed">
                Select your role so we can personalize your experience.
              </p>

              {/* 2×2 role grid */}
              <div className="mt-8 grid grid-cols-2 gap-3">
                {ROLES.map(role => {
                  const active = selectedRole === role.id
                  return (
                    <button
                      key={role.id}
                      onClick={() => setSelectedRole(role.id)}
                      className={`relative group/card p-5 rounded-2xl text-left transition-all duration-300 overflow-hidden cursor-pointer
                        ${active ? 'shadow-[0_0_30px_rgba(255,0,119,0.12)]' : 'hover:bg-white/[0.05]'}`}
                      style={{
                        background: active ? `${role.color}10` : 'rgba(255,255,255,0.03)',
                        border: active
                          ? `1px solid ${role.color}66`
                          : '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      {active && (
                        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none" />
                      )}

                      <div className="relative z-10">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-colors duration-300"
                          style={{
                            backgroundColor: active
                              ? `${role.color}22`
                              : 'rgba(255,255,255,0.05)',
                          }}
                        >
                          <role.Icon
                            className="w-5 h-5 transition-colors duration-300"
                            style={{ color: active ? role.color : '#6b7280' }}
                          />
                        </div>
                        <p
                          className="text-sm font-inter font-semibold transition-colors duration-300"
                          style={{ color: active ? '#ffffff' : '#e5e7eb' }}
                        >
                          {role.title}
                        </p>
                        <p className="text-[11px] text-gray-500 font-inter mt-1 leading-relaxed">
                          {role.description}
                        </p>
                      </div>

                      {active && (
                        <div
                          className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: role.color }}
                        >
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Tagline */}
          <p className="text-xs text-gray-600 font-inter">
            The fair comes to your door. Fresh. Fast. Fair.
          </p>
        </div>
      </div>

      {/* ── RIGHT PANEL ─────────────────────────────────────────────────── */}
      {/* lg:rounded-l-3xl creates the curved overlap on the left edge */}
      <div className="flex-1 flex flex-col min-h-screen bg-[#111111] lg:rounded-l-3xl lg:border-l lg:border-white/[0.06] lg:shadow-[-20px_0_60px_rgba(0,0,0,0.3)] relative z-10">

        {/* Top accent line */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-[#FF0077]/30 to-transparent" />

        {/* Mobile: Logo + role pills */}
        <div className="lg:hidden px-6 pt-8 pb-2">
          <a href="/" className="flex items-center mb-8">
            <span className="font-bebas text-xl tracking-widest text-white leading-none">FAIR</span>
            <span className="font-bebas text-xl tracking-widest text-[#FF0077] leading-none">SYNQ</span>
          </a>
          <p className="text-xs text-gray-500 font-inter uppercase tracking-wider mb-3">I am a...</p>
          <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-none">
            {ROLES.map(role => (
              <button
                key={role.id}
                onClick={() => setSelectedRole(role.id)}
                className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-inter font-medium transition-all duration-200 cursor-pointer"
                style={{
                  background: selectedRole === role.id ? `${role.color}15` : 'rgba(255,255,255,0.03)',
                  border: selectedRole === role.id
                    ? `1px solid ${role.color}4d`
                    : '1px solid rgba(255,255,255,0.06)',
                  color: selectedRole === role.id ? role.color : '#9ca3af',
                }}
              >
                <role.Icon className="w-3.5 h-3.5 shrink-0" />
                {role.shortLabel}
              </button>
            ))}
          </div>
        </div>

        {/* Auth form */}
        <div className="flex-1 flex items-center justify-center px-6 sm:px-12 lg:px-16 py-8">
          <div className="w-full max-w-sm">

            {/* Role context badge */}
            <div className="flex items-center gap-2.5 mb-6">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${activeRole.color}15` }}
              >
                <activeRole.Icon className="w-4 h-4" style={{ color: activeRole.color }} />
              </div>
              <div>
                <p className="text-[10px] text-gray-500 font-inter uppercase tracking-wider">Signing in as</p>
                <p className="text-sm text-white font-inter font-medium">{activeRole.title}</p>
              </div>
            </div>

            {/* Heading */}
            <h1 className="font-bebas text-3xl sm:text-4xl text-white uppercase tracking-wide">
              {mode === 'sign-in' ? 'Welcome Back' : 'Join FairSynq'}
            </h1>
            <p className="mt-2 text-sm text-gray-400 font-inter leading-relaxed">
              {mode === 'sign-in'
                ? `Continue to your ${selectedRole} experience.`
                : `Create your ${selectedRole === 'organizer' ? 'organizer' : selectedRole} account.`
              }
            </p>

            {/* Rule */}
            <div className="mt-8 mb-6 h-px bg-white/[0.06]" />

            {/* Clerk component */}
            {mode === 'sign-in' ? (
              <SignIn
                routing="hash"
                afterSignInUrl={afterSignIn}
                appearance={{ elements: clerkElements }}
              />
            ) : (
              <SignUp
                routing="hash"
                afterSignUpUrl={afterSignUp}
                appearance={{ elements: clerkElements }}
              />
            )}

            {/* Sign-in / Sign-up toggle */}
            <div className="mt-8 pt-6 border-t border-white/[0.06] text-center">
              {mode === 'sign-in' ? (
                <p className="text-sm text-gray-500 font-inter">
                  New to FairSynq?{' '}
                  <button
                    onClick={() => setMode('sign-up')}
                    className="text-[#FF0077] hover:text-white font-medium transition-colors duration-200 cursor-pointer bg-transparent border-0 p-0"
                  >
                    Create an account
                  </button>
                </p>
              ) : (
                <p className="text-sm text-gray-500 font-inter">
                  Already have an account?{' '}
                  <button
                    onClick={() => setMode('sign-in')}
                    className="text-[#FF0077] hover:text-white font-medium transition-colors duration-200 cursor-pointer bg-transparent border-0 p-0"
                  >
                    Sign in
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="px-6 py-5 flex items-center justify-between">
          <p className="text-[10px] text-gray-700 font-inter">
            © {new Date().getFullYear()} FairSynq
          </p>
          <div className="flex items-center gap-4">
            <a href="/refund-policy" className="text-[10px] text-gray-700 hover:text-gray-400 font-inter transition-colors">
              Privacy
            </a>
            <a href="/contact" className="text-[10px] text-gray-700 hover:text-gray-400 font-inter transition-colors">
              Contact
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
