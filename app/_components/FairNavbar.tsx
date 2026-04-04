'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeftIcon, ShoppingBagIcon } from '@heroicons/react/24/outline'
import { useFair } from '../_contexts/FairContext'
import { useFairCart } from '../_contexts/FairCartContext'

export default function FairNavbar() {
  const { fair } = useFair()
  const { itemCount } = useFairCart()
  const pathname = usePathname()
  const base = `/fair/${fair.slug}`
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const navLinks = [
    { label: 'Home',    href: base },
    { label: 'Vendors', href: `${base}/vendors` },
    { label: 'Info',    href: `${base}/info` },
  ]

  // Fix 2: contextual back — the chevron always goes ONE level up from wherever you are.
  // This eliminates the need for any secondary back link inside page content.
  const getBackDest = (): { href: string; label: string } => {
    if (pathname.includes('/vendor/')) {
      // Vendor menu → back to vendors list
      return { href: `${base}/vendors`, label: fair.name }
    }
    if (
      pathname.endsWith('/cart') ||
      pathname.includes('/checkout') ||
      pathname.includes('/orders') ||
      /\/order\/[^/]+$/.test(pathname)
    ) {
      // Cart / checkout / order tracking → back to fair home
      return { href: base, label: fair.name }
    }
    // Fair home / vendors list / info → back to all fairs
    return { href: '/fairs', label: fair.name }
  }

  const back = getBackDest()

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-14 sm:h-16 bg-bg-dark/80 backdrop-blur-md border-b border-white/10">
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 h-full flex items-center justify-between gap-4">

        {/* Left: contextual back — single unified affordance */}
        <Link
          href={back.href}
          className="flex items-center gap-1.5 min-w-0 group"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5 shrink-0 text-text-gray group-hover:text-white transition-colors" />
          <span
            className="font-bebas text-base sm:text-lg tracking-wide truncate leading-none group-hover:opacity-80 transition-opacity"
            style={{ color: accentColor }}
          >
            {back.label}
          </span>
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

        {/* Right: cart */}
        <Link
          href={`${base}/cart`}
          className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-semibold leading-none hover:bg-white/10 transition-colors shrink-0"
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
      </div>
    </nav>
  )
}
