'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useClerk, useUser } from '@clerk/clerk-react'
import { motion, AnimatePresence } from 'framer-motion'
import { EASE, TIMING } from '@/components/animations/motion'
import {
  ChevronDownIcon,
  UserIcon,
  ClipboardDocumentListIcon,
  HeartIcon,
  ArrowRightOnRectangleIcon,
  BuildingStorefrontIcon,
  CalendarDaysIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import SignOutModal from './SignOutModal'
import { useRole } from '@/app/_contexts/RoleContext'

export default function MarketplaceNavbar() {
  const pathname = usePathname()
  const { signOut } = useClerk()
  const { isSignedIn, user } = useUser()
  const { isVendor, isOrganizer, isRunner } = useRole()
  const [showSignOut, setShowSignOut] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const displayName = user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] ?? 'Account'
  const initial = (user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0] ?? 'U').toUpperCase()

  const FAIR_SLUG = 'springfield-state-fair-2026'

  const signedInLinks = [
    { label: 'Discover', href: '/fairs' },
    ...(isVendor    ? [{ label: 'Vendor Dashboard', href: '/vendor' }]                          : []),
    ...(isOrganizer ? [{ label: 'Organizer Portal', href: '/organizer' }]                       : []),
    ...(isRunner    ? [{ label: 'Runner Dashboard', href: `/runner/${FAIR_SLUG}/dashboard` }]   : []),
  ]

  const dropdownItems = [
    { href: '/account',           label: 'My Account',  icon: UserIcon },
    { href: '/account/orders',    label: 'My Orders',   icon: ClipboardDocumentListIcon },
    { href: '/account/favorites', label: 'Favorites',   icon: HeartIcon },
    ...(isVendor    ? [{ href: '/vendor',                         label: 'Vendor Dashboard', icon: BuildingStorefrontIcon }] : []),
    ...(isOrganizer ? [{ href: '/organizer',                      label: 'Organizer Portal', icon: CalendarDaysIcon }]       : []),
    ...(isRunner    ? [{ href: `/runner/${FAIR_SLUG}/dashboard`,  label: 'Runner Dashboard', icon: TruckIcon }]              : []),
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
      <motion.nav
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: TIMING.normal, ease: EASE.decelerate, delay: 0.1 }}
        className="fixed top-0 left-0 right-0 z-50 h-16 bg-bg-dark/80 backdrop-blur-md border-b border-white/10"
      >
        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 h-full flex items-center justify-between">

          {/* Logo */}
          <Link href="/" className="group flex items-center">
            <span className="font-bebas text-2xl tracking-widest text-white transition-colors duration-200 group-hover:text-neon-pink leading-none">FAIR</span>
            <span className="font-bebas text-2xl tracking-widest text-neon-pink transition-colors duration-200 group-hover:text-white leading-none">SYNQ</span>
          </Link>

          {/* Center nav links — signed in only */}
          {isSignedIn && (
            <div className="hidden sm:flex items-center gap-6">
              {signedInLinks.map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className={`text-sm font-medium leading-none transition-colors ${
                    pathname === href ? 'text-white' : 'text-text-gray hover:text-white'
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}

          {/* Right actions */}
          <div className="flex items-center gap-3">
            {isSignedIn ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(o => !o)}
                  className="flex items-center gap-2 pl-1 pr-2.5 py-1.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer bg-transparent border-0"
                >
                  <div className="w-8 h-8 rounded-full bg-neon-pink/20 border border-neon-pink/30 flex items-center justify-center shrink-0 overflow-hidden">
                    {user?.imageUrl ? (
                      <img src={user.imageUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-neon-pink text-xs font-bold">{initial}</span>
                    )}
                  </div>
                  <span className="text-sm font-medium text-white max-w-[96px] truncate hidden sm:block">
                    {displayName}
                  </span>
                  <ChevronDownIcon
                    className={`w-3.5 h-3.5 text-text-gray transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                <AnimatePresence>
                  {dropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.96 }}
                      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute right-0 top-full mt-2 w-52 bg-bg-card border border-white/10 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.5)] overflow-hidden z-50"
                    >
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <motion.div
                whileHover={{ scale: 1.04, transition: { duration: 0.15, ease: EASE.smooth } }}
                whileTap={{ scale: 0.97 }}
              >
                <Link
                  href="/login"
                  className="inline-flex items-center px-5 py-2 rounded-xl bg-neon-pink text-white text-sm font-semibold leading-none hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors"
                >
                  Get Started
                </Link>
              </motion.div>
            )}
          </div>
        </div>
      </motion.nav>

      <SignOutModal
        isOpen={showSignOut}
        onClose={() => setShowSignOut(false)}
        onConfirm={() => signOut({ redirectUrl: '/' })}
      />
    </>
  )
}
