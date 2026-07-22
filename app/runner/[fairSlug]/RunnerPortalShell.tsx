'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, DollarSign, Settings, Truck } from 'lucide-react'
import { RunnerProvider, useRunner } from './_context/RunnerContext'

// Client chrome for the runner portal. The server authority guard (DB Runner row)
// lives in layout.tsx; this is pure presentation + the online/offline context.

const NAV_ITEMS = (base: string) => [
  { href: `${base}/dashboard`, icon: Home,       label: 'Home' },
  { href: `${base}/earnings`,  icon: DollarSign, label: 'Earnings' },
  { href: `${base}/settings`,  icon: Settings,   label: 'Settings' },
]

function DesktopSidebar({ fairSlug }: { fairSlug: string }) {
  const pathname = usePathname()
  const { isOnline } = useRunner()
  const items = NAV_ITEMS(`/runner/${fairSlug}`)

  return (
    <aside className="hidden lg:flex flex-col fixed top-0 left-0 bottom-0 w-56 z-50 bg-[#0a0a0a] border-r border-white/10">
      {/* Branding */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2 mb-3">
          <Truck className="w-4 h-4 text-neon-pink shrink-0" />
          <span className="font-bebas text-base tracking-widest text-white leading-none">FAIRSYNQ RUNNER</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* null = not loaded yet → neutral pulse, never a false "Offline" (flicker class) */}
          <span className={`w-2 h-2 rounded-full transition-colors duration-300 ${
            isOnline === null ? 'bg-white/20 animate-pulse' : isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'
          }`} />
          <span className={`text-xs font-semibold transition-colors duration-300 ${
            isOnline === null ? 'text-gray-600' : isOnline ? 'text-emerald-400' : 'text-gray-500'
          }`}>
            {isOnline === null ? '\u2026' : isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 p-3 space-y-1">
        {items.map(({ href, icon: Icon, label }) => {
          const active = pathname?.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                active
                  ? 'bg-neon-pink/10 text-neon-pink'
                  : 'text-text-gray hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}

function MobileHeader() {
  const { isOnline } = useRunner()
  return (
    <header className="lg:hidden fixed top-0 left-0 right-0 z-50 h-12 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-white/10 flex items-center px-4">
      <div className="flex items-center gap-2">
        <Truck className="w-4 h-4 text-neon-pink" />
        <span className="font-bebas text-base tracking-widest text-white leading-none">FAIRSYNQ RUNNER</span>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full transition-colors duration-300 ${
          isOnline === null ? 'bg-white/20 animate-pulse' : isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'
        }`} />
        <span className={`text-xs font-semibold transition-colors duration-300 ${
          isOnline === null ? 'text-gray-600' : isOnline ? 'text-emerald-400' : 'text-gray-500'
        }`}>
          {isOnline === null ? '\u2026' : isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
    </header>
  )
}

function BottomNav({ fairSlug }: { fairSlug: string }) {
  const pathname = usePathname()
  const items = NAV_ITEMS(`/runner/${fairSlug}`)
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 h-16 bg-[#0a0a0a]/95 backdrop-blur-md border-t border-white/10 flex items-center">
      {items.map(({ href, icon: Icon, label }) => {
        const active = pathname?.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors ${
              active ? 'text-neon-pink' : 'text-text-gray hover:text-white'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[0.625rem] font-semibold tracking-wide">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function RunnerShell({ children, fairSlug }: { children: React.ReactNode; fairSlug: string }) {
  return (
    <div className="min-h-screen bg-bg-dark text-white">
      <DesktopSidebar fairSlug={fairSlug} />
      <MobileHeader />

      {/* Content: offset for desktop sidebar, padded for mobile header + bottom nav */}
      <div className="lg:ml-56 pt-12 lg:pt-0 pb-20 lg:pb-0 min-h-screen">
        {children}
      </div>

      <BottomNav fairSlug={fairSlug} />
    </div>
  )
}

export default function RunnerPortalShell({ children, fairSlug }: { children: React.ReactNode; fairSlug: string }) {
  return (
    <RunnerProvider>
      <RunnerShell fairSlug={fairSlug}>{children}</RunnerShell>
    </RunnerProvider>
  )
}
