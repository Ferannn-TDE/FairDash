'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser } from '@clerk/clerk-react'
import {
  HomeModernIcon,
  ClipboardDocumentListIcon,
  Squares2X2Icon,
  ChartBarIcon,
  Cog6ToothIcon,
  BellIcon,
  BuildingStorefrontIcon,
} from '@heroicons/react/24/outline'

interface Props {
  children: React.ReactNode
  fairSlug: string
  vendorName: string
  userName: string
  userEmail: string
  pendingCount?: number
}

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard',   icon: HomeModernIcon },
  { key: 'orders',    label: 'Orders',       icon: ClipboardDocumentListIcon },
  { key: 'menu',      label: 'Menu Manager', icon: Squares2X2Icon },
  { key: 'analytics', label: 'Analytics',    icon: ChartBarIcon },
  { key: 'settings',  label: 'Settings',     icon: Cog6ToothIcon },
]


// ─── Sidebar contents ─────────────────────────────────────────────────────────

function SidebarContent({
  fairSlug,
  vendorName,
}: {
  fairSlug: string
  vendorName: string
}) {
  const pathname = usePathname()

  return (
    <div className="flex flex-col h-full p-5">
      {/* Brand */}
      <div className="flex items-center gap-2.5 mb-6">
        <div className="flex items-center leading-none">
          <span className="font-bebas text-[1.375rem] tracking-[0.125rem] text-white">FAIR</span>
          <span className="font-bebas text-[1.375rem] tracking-[0.125rem] text-neon-pink">SYNQ</span>
        </div>
        <span className="ml-1 px-1.5 py-0.5 bg-neon-pink/10 text-neon-pink text-[9px] font-semibold rounded uppercase tracking-wider">
          Vendor
        </span>
      </div>

      {/* Vendor profile chip */}
      <div className="mb-5 p-3.5 bg-white/5 border border-white/10 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-neon-pink to-[#cc0060] rounded-xl flex items-center justify-center shrink-0 shadow-[0_2px_8px_rgba(255,0,119,0.3)]">
            <BuildingStorefrontIcon className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{vendorName}</p>
            <p className="text-text-gray text-[0.625rem]">Vendor Portal</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto space-y-0.5">
        <p className="text-[0.5625rem] uppercase tracking-[0.0625rem] text-text-gray font-bold mb-2 px-1">
          Views
        </p>
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const href = `/vendor/${fairSlug}/${key}`
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={key}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm no-underline transition-all duration-200 ${
                active ? 'bg-neon-pink/10 text-neon-pink' : 'text-text-gray hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon className="w-[1.125rem] h-[1.125rem] shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

    </div>
  )
}

// ─── Static user avatar ───────────────────────────────────────────────────────

export function UserAvatar() {
  const { user } = useUser()
  return (
    <div className="w-8 h-8 rounded-full overflow-hidden bg-neon-pink/10 border border-white/[0.06] shrink-0">
      {user?.imageUrl ? (
        <img src={user.imageUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-xs font-semibold text-neon-pink">
            {user?.firstName?.[0] ?? 'V'}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export default function VendorPortalShell({
  children,
  fairSlug,
  vendorName,
  userName,
  userEmail,
  pendingCount = 0,
}: Props) {
  return (
    <div className="min-h-screen bg-bg-dark">

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-64 xl:w-72 bg-bg-card border-r border-white/[0.06] z-50">
        <SidebarContent fairSlug={fairSlug} vendorName={vendorName} />
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-bg-dark/90 backdrop-blur-md border-b border-white/[0.06]">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center leading-none">
            <span className="font-bebas text-[1.125rem] tracking-[0.125rem] text-white">FAIR</span>
            <span className="font-bebas text-[1.125rem] tracking-[0.125rem] text-neon-pink">SYNQ</span>
          </div>
          <div className="relative p-2">
            <BellIcon className="w-5 h-5 text-white" />
            {pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-neon-pink text-white text-[0.5rem] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-bg-dark/95 backdrop-blur-md border-t border-white/[0.06]">
        <MobileBottomNav fairSlug={fairSlug} />
      </div>

      {/* Main content */}
      <div className="lg:pl-64 xl:lg:pl-72 min-h-screen">
        <div className="h-14 lg:hidden" />
        {children}
        <div className="h-16 lg:hidden" />
      </div>

    </div>
  )
}

// ─── Mobile bottom nav ────────────────────────────────────────────────────────

function MobileBottomNav({ fairSlug }: { fairSlug: string }) {
  const pathname = usePathname()

  return (
    <div className="flex items-center justify-around h-14 px-2">
      {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
        const href = `/vendor/${fairSlug}/${key}`
        const active = pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={key}
            href={href}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl no-underline transition-colors ${
              active ? 'text-neon-pink' : 'text-text-gray hover:text-white'
            }`}
          >
            <Icon className="w-5 h-5 shrink-0" />
            <span className="text-[0.5625rem] font-semibold">{label}</span>
          </Link>
        )
      })}
    </div>
  )
}
