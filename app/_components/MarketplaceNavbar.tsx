'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { EASE, TIMING } from '@/components/animations/motion'

const NAV_LINKS = [
  { label: 'Discover',   href: '/fairs' },
  { label: 'Organizers', href: '/organizer' },
]

export default function MarketplaceNavbar() {
  const pathname = usePathname()

  return (
    <motion.nav
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: TIMING.normal, ease: EASE.decelerate, delay: 0.1 }}
      className="fixed top-0 left-0 right-0 z-50 h-16 bg-bg-dark/80 backdrop-blur-md border-b border-white/10"
    >
      <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 h-full flex items-center justify-between">

        {/* Logo — Fix 1: FAIR/SYNQ color swap on hover via group */}
        <Link href="/" className="group flex items-center">
          <span className="font-bebas text-2xl tracking-widest text-white transition-colors duration-200 group-hover:text-neon-pink leading-none">
            FAIR
          </span>
          <span className="font-bebas text-2xl tracking-widest text-neon-pink transition-colors duration-200 group-hover:text-white leading-none">
            SYNQ
          </span>
        </Link>

        {/* Nav links — Fix 2: leading-none for precise baseline alignment */}
        <div className="hidden sm:flex items-center gap-6">
          {NAV_LINKS.map(({ label, href }) => (
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

        {/* Right actions */}
        <div className="flex items-center gap-3">
          <Link
            href="/account"
            className="text-sm font-medium leading-none text-text-gray hover:text-white transition-colors"
          >
            Account
          </Link>
          <motion.div
            whileHover={{ scale: 1.04, transition: { duration: 0.15, ease: EASE.smooth } }}
            whileTap={{ scale: 0.97 }}
            className="hidden sm:block"
          >
            <Link
              href="/become-vendor"
              className="inline-flex items-center px-4 py-2 rounded-xl bg-neon-pink text-white text-sm font-semibold leading-none hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors"
            >
              Become a Vendor
            </Link>
          </motion.div>
        </div>
      </div>
    </motion.nav>
  )
}
