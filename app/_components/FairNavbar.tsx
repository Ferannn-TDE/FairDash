'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useClerk, useUser, SignedIn, SignedOut } from '@clerk/clerk-react'
import {
  ShoppingBagIcon,
  ChevronDownIcon,
  UserIcon,
  ClipboardDocumentListIcon,
  HeartIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline'
import { useFair } from '../_contexts/FairContext'
import { useFairCart } from '../_contexts/FairCartContext'
import SignOutModal from './SignOutModal'

export default function FairNavbar() {
  const { fair } = useFair()
  const { itemCount } = useFairCart()
  const pathname = usePathname()
  const { signOut } = useClerk()
  const { user } = useUser()
  const [showSignOut, setShowSignOut] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const base = `/fair/${fair.slug}`
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const displayName = user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] ?? 'Account'
  const initial = (user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0] ?? 'U').toUpperCase()

  const navLinks = [
    { label: 'Home',    href: base },
    { label: 'Menu',    href: `${base}/browse` },
    { label: 'Vendors', href: `${base}/vendors` },
  ]

  const dropdownItems = [
    { href: '/account',                        label: 'My Account', icon: UserIcon },
    { href: `${base}/orders`,                  label: 'My Orders',  icon: ClipboardDocumentListIcon },
    { href: '/account/favorites',              label: 'Favorites',  icon: HeartIcon },
  ]

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-30 h-14 sm:h-16 bg-black/30 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 h-full flex items-center justify-between gap-4">

          {/* Left: logo */}
          <Link href="/" className="group flex items-center shrink-0">
            <span className="font-bebas text-lg text-white leading-none">FAIR</span>
            <span className="font-bebas text-lg text-neon-pink leading-none">SYNQ</span>
          </Link>

          {/* Center: nav links (desktop) */}
          <div className="hidden md:flex items-center gap-6">
            {navLinks.map(({ label, href }) => {
              const active = pathname === href
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex flex-col items-center text-sm font-medium transition-colors ${
                    active ? 'text-white' : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  {label}
                  {active && (
                    <span className="block w-1 h-1 bg-neon-pink rounded-full mt-1" />
                  )}
                </Link>
              )
            })}
          </div>

          {/* Right: cart + divider + user */}
          <div className="flex items-center">
            {/* Cart — icon + badge, hidden on mobile (in bottom nav) */}
            <Link
              href={`${base}/cart`}
              className="relative hidden md:flex p-2 rounded-xl text-white hover:bg-white/[0.06] transition-colors shrink-0"
            >
              <ShoppingBagIcon className="w-5 h-5" />
              {itemCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[0.55rem] font-bold flex items-center justify-center text-white leading-none"
                  style={{ backgroundColor: accentColor }}
                >
                  {itemCount > 9 ? '9+' : itemCount}
                </span>
              )}
            </Link>

            {/* Divider — desktop only */}
            <div className="hidden md:block w-px h-5 bg-white/10 mx-2" />

            {/* User dropdown (signed in) — visible on all sizes */}
            <SignedIn>
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(o => !o)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-white/[0.06] transition-colors cursor-pointer bg-transparent border-0"
                >
                  <div className="w-6 h-6 rounded-full bg-neon-pink/20 border border-neon-pink/30 flex items-center justify-center shrink-0 overflow-hidden">
                    {user?.imageUrl ? (
                      <img src={user.imageUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-neon-pink text-[0.55rem] font-bold">{initial}</span>
                    )}
                  </div>
                  <span className="hidden sm:block text-sm font-medium text-white max-w-[80px] truncate">{displayName}</span>
                  <ChevronDownIcon
                    className={`w-3 h-3 text-white/40 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-52 bg-bg-card border border-white/10 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.5)] overflow-hidden z-50">
                    <div className="px-4 py-3 border-b border-white/5">
                      <p className="text-white text-sm font-semibold truncate">{displayName}</p>
                      <p className="text-text-gray text-xs truncate mt-0.5">{user?.emailAddresses?.[0]?.emailAddress}</p>
                    </div>
                    <div className="py-1.5">
                      {dropdownItems.map(({ href, label, icon: Icon }) => (
                        <Link
                          key={href}
                          href={href}
                          onClick={() => setDropdownOpen(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-text-gray hover:text-neon-pink hover:bg-neon-pink/10 transition-colors no-underline"
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          {label}
                        </Link>
                      ))}
                    </div>
                    <div className="py-1.5 border-t border-white/5">
                      <button
                        onClick={() => { setDropdownOpen(false); setShowSignOut(true) }}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-text-gray hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer bg-transparent border-0 w-full text-left"
                      >
                        <ArrowRightOnRectangleIcon className="w-4 h-4 shrink-0" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </SignedIn>

            {/* Sign in link (signed out) */}
            <SignedOut>
              <Link
                href={`/login?redirect=/fair/${fair.slug}`}
                className="hidden md:inline-flex items-center px-4 py-1.5 rounded-full bg-neon-pink text-white text-sm font-semibold hover:bg-[#e0006b] transition-colors"
              >
                Sign In
              </Link>
            </SignedOut>
          </div>
        </div>
      </nav>

      <SignOutModal
        isOpen={showSignOut}
        onClose={() => setShowSignOut(false)}
        onConfirm={() => signOut({ redirectUrl: '/' })}
      />
    </>
  )
}
