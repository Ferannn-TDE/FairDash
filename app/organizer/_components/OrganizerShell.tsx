'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  HomeIcon,
  CalendarDaysIcon,
  BuildingStorefrontIcon,
  ClipboardDocumentListIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  QueueListIcon,
  BellIcon,
} from '@heroicons/react/24/outline'
import {
  HomeIcon as HomeIconSolid,
  CalendarDaysIcon as CalendarSolid,
  BuildingStorefrontIcon as StorefrontSolid,
  ClipboardDocumentListIcon as ClipboardSolid,
  Cog6ToothIcon as CogSolid,
} from '@heroicons/react/24/solid'

interface Fair {
  id: string
  name: string
  slug: string
  status: string
}

interface Props {
  children: React.ReactNode
  userName: string
  userInitials: string
  userEmail: string
}

// ─── Bottom nav items (5 tabs, mobile only) ───────────────────────────────────

const BOTTOM_NAV = [
  { href: '/organizer',          label: 'Home',     icon: HomeIcon,                activeIcon: HomeIconSolid,  exact: true },
  { href: '/organizer/fairs',    label: 'Fairs',    icon: CalendarDaysIcon,        activeIcon: CalendarSolid,  exact: false },
  { href: '/organizer/orders',   label: 'Orders',   icon: ClipboardDocumentListIcon, activeIcon: ClipboardSolid, exact: false },
  { href: '/organizer/vendors',  label: 'Vendors',  icon: BuildingStorefrontIcon,  activeIcon: StorefrontSolid, exact: false },
  { href: '/organizer/settings', label: 'Settings', icon: Cog6ToothIcon,           activeIcon: CogSolid,       exact: false },
]

// ─── Sidebar link ─────────────────────────────────────────────────────────────

function SidebarLink({
  href,
  icon: Icon,
  label,
  indent = false,
  exact = false,
}: {
  href: string
  icon: React.ElementType
  label: string
  indent?: boolean
  exact?: boolean
}) {
  const pathname = usePathname()
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(href + '/')
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-inter transition-colors
        ${indent ? 'ml-3' : ''}
        ${active ? 'bg-[#FF0077]/10 text-[#FF0077]' : 'text-[#888] hover:text-white hover:bg-white/5'}`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </Link>
  )
}

// ─── Sidebar content (shared between desktop sidebar) ─────────────────────────

function SidebarContent({
  currentFairId,
  fairs,
  userInitials,
  userName,
  userEmail,
}: {
  currentFairId: string | null
  fairs: Fair[]
  userInitials: string
  userName: string
  userEmail: string
}) {
  const currentFair = currentFairId ? fairs.find(f => f.slug === currentFairId) : null

  return (
    <>
      {/* Logo */}
      <div className="h-16 flex items-center px-5 border-b border-white/5 shrink-0">
        <Link href="/" className="group flex items-center">
          <span className="font-bebas text-lg text-white group-hover:text-[#FF0077] transition-colors leading-none">FAIR</span>
          <span className="font-bebas text-lg text-[#FF0077] group-hover:text-white transition-colors leading-none">SYNQ</span>
          <span className="ml-2 px-1.5 py-0.5 bg-[#FF0077]/10 text-[#FF0077] text-[9px] font-semibold rounded uppercase tracking-wider">
            Organizer
          </span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        <SidebarLink href="/organizer"          icon={HomeIcon}                  label="Dashboard"   exact />
        <SidebarLink href="/organizer/fairs"    icon={CalendarDaysIcon}          label="My Fairs" />
        <SidebarLink href="/organizer/orders"   icon={ClipboardDocumentListIcon} label="Orders" />
        <SidebarLink href="/organizer/vendors"  icon={BuildingStorefrontIcon}    label="Vendors" />
        <SidebarLink href="/organizer/settings" icon={Cog6ToothIcon}             label="Settings" />

        {currentFair && (
          <div className="mt-5 pt-4 border-t border-white/5">
            <p className="px-3 mb-2 text-[10px] font-semibold text-[#555] uppercase tracking-widest truncate">
              {currentFair.name}
            </p>
            <SidebarLink href={`/organizer/fairs/${currentFair.slug}`}               icon={HomeIcon}                  label="Overview"      indent exact />
            <SidebarLink href={`/organizer/fairs/${currentFair.slug}/vendors`}        icon={BuildingStorefrontIcon}    label="Vendors"       indent />
            <SidebarLink href={`/organizer/fairs/${currentFair.slug}/orders`}         icon={ClipboardDocumentListIcon} label="Orders"        indent />
            <SidebarLink href={`/organizer/fairs/${currentFair.slug}/analytics`}      icon={ChartBarIcon}              label="Analytics"     indent />
            <SidebarLink href={`/organizer/fairs/${currentFair.slug}/settings`}       icon={Cog6ToothIcon}             label="Settings"      indent />
            <SidebarLink href={`/organizer/fairs/${currentFair.slug}/disputes`}       icon={ExclamationTriangleIcon}   label="Disputes"      indent />
            <SidebarLink href={`/organizer/fairs/${currentFair.slug}/menu-requests`}  icon={QueueListIcon}             label="Menu Requests" indent />
          </div>
        )}
      </nav>

      {/* Profile */}
      <div className="p-4 border-t border-white/5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#FF0077]/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-[#FF0077]">{userInitials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-inter truncate leading-none">{userName}</p>
            <p className="text-xs text-[#555] font-inter mt-0.5 truncate">{userEmail}</p>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export default function OrganizerShell({ children, userInitials, userName, userEmail }: Props) {
  const [fairs, setFairs] = useState<Fair[]>([])
  const pathname = usePathname()

  useEffect(() => {
    fetch('/api/organizer/fairs')
      .then(r => r.json())
      .then(d => { if (d.data?.fairs) setFairs(d.data.fairs) })
      .catch(() => {})
  }, [])

  const fairIdMatch = pathname.match(/\/organizer\/fairs\/([^/]+)/)
  const currentFairId = fairIdMatch?.[1] ?? null

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex overflow-x-hidden">

      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-50 w-64 bg-[#111111] border-r border-white/5 flex-col">
        <SidebarContent
          currentFairId={currentFairId}
          fairs={fairs}
          userInitials={userInitials}
          userName={userName}
          userEmail={userEmail}
        />
      </aside>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div className="lg:pl-64 flex-1 flex flex-col min-h-screen">

        {/* Mobile top header — logo + bell, no hamburger */}
        <header className="lg:hidden sticky top-0 z-40 h-14 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-4 shrink-0">
          <Link href="/" className="group flex items-center">
            <span className="font-bebas text-lg text-white group-hover:text-[#FF0077] transition-colors leading-none">FAIR</span>
            <span className="font-bebas text-lg text-[#FF0077] group-hover:text-white transition-colors leading-none">SYNQ</span>
            <span className="ml-2 px-1.5 py-0.5 bg-[#FF0077]/10 text-[#FF0077] text-[9px] font-semibold rounded uppercase tracking-wider">
              Organizer
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <button className="relative p-2 rounded-lg hover:bg-white/5 transition-colors">
              <BellIcon className="w-5 h-5 text-[#888]" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#FF0077]" />
            </button>
            <div className="w-8 h-8 rounded-full bg-[#FF0077]/20 flex items-center justify-center">
              <span className="text-xs font-semibold text-[#FF0077]">{userInitials}</span>
            </div>
          </div>
        </header>

        {/* Desktop top bar — bell only */}
        <header className="hidden lg:flex sticky top-0 z-40 h-16 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-white/5 items-center justify-end px-8 shrink-0">
          <button className="relative p-2 rounded-lg hover:bg-white/5 transition-colors">
            <BellIcon className="w-5 h-5 text-[#888]" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#FF0077]" />
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 p-5 sm:p-8 pb-24 lg:pb-8">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ───────────────────────────────────────────── */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#111111] border-t border-white/5 flex items-stretch"
        style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
      >
        {BOTTOM_NAV.map(item => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + '/')
          const Icon = isActive ? item.activeIcon : item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2 transition-colors"
            >
              <Icon className={`w-5 h-5 transition-colors ${isActive ? 'text-[#FF0077]' : 'text-white/30'}`} />
              <span className={`text-[10px] font-medium transition-colors ${isActive ? 'text-[#FF0077]' : 'text-white/30'}`}>
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
