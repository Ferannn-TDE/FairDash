'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useClerk, SignedIn } from '@clerk/clerk-react'
import { ShoppingBagIcon, ArrowRightStartOnRectangleIcon } from '@heroicons/react/24/outline'
import { useFair } from '../_contexts/FairContext'
import { useFairCart } from '../_contexts/FairCartContext'
import SignOutModal from './SignOutModal'

export default function FairNavbar() {
  const { fair } = useFair()
  const { itemCount } = useFairCart()
  const pathname = usePathname()
  const { signOut } = useClerk()
  const [showSignOut, setShowSignOut] = useState(false)

  const base = `/fair/${fair.slug}`
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const navLinks = [
    { label: 'Home',    href: base },
    { label: 'Vendors', href: `${base}/vendors` },
    { label: 'Info',    href: `${base}/info` },
  ]

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 h-14 sm:h-16 bg-bg-dark/80 backdrop-blur-md border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 h-full flex items-center justify-between gap-4">

          {/* Left: logo */}
          <Link href="/" className="group flex items-center shrink-0">
            <span className="font-bebas text-lg text-white transition-colors duration-200 group-hover:text-[#FF0077] leading-none">FAIR</span>
            <span className="font-bebas text-lg text-[#FF0077] transition-colors duration-200 group-hover:text-white leading-none">SYNQ</span>
          </Link>

          {/* Center: nav links (desktop) */}
          <div className="hidden md:flex items-center gap-5">
            {navLinks.map(({ label, href }) => {
              const active = pathname === href
              return (
                <Link
                  key={href}
                  href={href}
                  className={`text-sm font-medium leading-none transition-colors ${
                    active ? 'text-white' : 'text-text-gray hover:text-white'
                  }`}
                >
                  {label}
                </Link>
              )
            })}
          </div>

          {/* Right: cart + sign out */}
          <div className="flex items-center gap-2">
            <Link
              href={`${base}/cart`}
              className="relative hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-semibold leading-none hover:bg-white/10 transition-colors shrink-0"
            >
              <ShoppingBagIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Cart</span>
              {itemCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[0.6rem] font-bold flex items-center justify-center text-white"
                  style={{ backgroundColor: accentColor }}
                >
                  {itemCount > 9 ? '9+' : itemCount}
                </span>
              )}
            </Link>

            <SignedIn>
              <button
                onClick={() => setShowSignOut(true)}
                className="hidden md:flex items-center gap-1 p-1.5 rounded-xl text-text-gray hover:text-white hover:bg-white/5 transition-colors cursor-pointer bg-transparent border-0"
                title="Sign out"
              >
                <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
              </button>
            </SignedIn>
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
