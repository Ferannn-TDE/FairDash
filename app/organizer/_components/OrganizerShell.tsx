'use client'

import { useState } from 'react'
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
  Bars3Icon,
  XMarkIcon,
  BellIcon,
} from '@heroicons/react/24/outline'
import { mockOrganizerFairs } from '@/lib/mock/organizer'

interface Props {
  children: React.ReactNode
  userName: string
  userInitials: string
  userEmail: string
}

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

function SidebarContent({ currentFairId, onClose }: { currentFairId: string | null; onClose?: () => void }) {
  const currentFair = currentFairId ? mockOrganizerFairs.find(f => f.id === currentFairId) : null

  return (
    <>
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-white/5 shrink-0">
        <Link href="/" className="group flex items-center">
          <span className="font-bebas text-lg text-white group-hover:text-[#FF0077] transition-colors leading-none">FAIR</span>
          <span className="font-bebas text-lg text-[#FF0077] group-hover:text-white transition-colors leading-none">SYNQ</span>
          <span className="ml-2 px-1.5 py-0.5 bg-[#FF0077]/10 text-[#FF0077] text-[9px] font-semibold rounded uppercase tracking-wider">
            Organizer
          </span>
        </Link>
        {onClose && (
          <button onClick={onClose} className="lg:hidden text-[#888] hover:text-white transition-colors">
            <XMarkIcon className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        <SidebarLink href="/organizer" icon={HomeIcon} label="Dashboard" exact />
        <SidebarLink href="/organizer/fairs" icon={CalendarDaysIcon} label="My Fairs" />
        <SidebarLink href="/organizer/settings" icon={Cog6ToothIcon} label="Settings" />

        {currentFair && (
          <div className="mt-5 pt-4 border-t border-white/5">
            <p className="px-3 mb-2 text-[10px] font-semibold text-[#555] uppercase tracking-widest truncate">
              {currentFair.name}
            </p>
            <SidebarLink href={`/organizer/fair/${currentFair.id}`} icon={HomeIcon} label="Overview" indent exact />
            <SidebarLink href={`/organizer/fair/${currentFair.id}/vendors`} icon={BuildingStorefrontIcon} label="Vendors" indent />
            <SidebarLink href={`/organizer/fair/${currentFair.id}/orders`} icon={ClipboardDocumentListIcon} label="Orders" indent />
            <SidebarLink href={`/organizer/fair/${currentFair.id}/analytics`} icon={ChartBarIcon} label="Analytics" indent />
            <SidebarLink href={`/organizer/fair/${currentFair.id}/settings`} icon={Cog6ToothIcon} label="Settings" indent />
            <SidebarLink href={`/organizer/fair/${currentFair.id}/disputes`} icon={ExclamationTriangleIcon} label="Disputes" indent />
          </div>
        )}
      </nav>
    </>
  )
}

export default function OrganizerShell({ children, userName, userInitials, userEmail }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  const fairIdMatch = pathname.match(/\/organizer\/fair\/([^/]+)/)
  const currentFairId = fairIdMatch?.[1] ?? null

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex">

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#111111] border-r border-white/5 flex flex-col
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
        <SidebarContent currentFairId={currentFairId} onClose={() => setSidebarOpen(false)} />

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
      </aside>

      {/* Main content */}
      <div className="lg:pl-64 flex-1 flex flex-col min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-40 h-16 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-5 sm:px-8 shrink-0">
          <button
            className="lg:hidden p-1.5 rounded-lg hover:bg-white/5 transition-colors text-[#888] hover:text-white"
            onClick={() => setSidebarOpen(true)}
          >
            <Bars3Icon className="w-5 h-5" />
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
            <button className="relative p-2 rounded-lg hover:bg-white/5 transition-colors">
              <BellIcon className="w-5 h-5 text-[#888]" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#FF0077]" />
            </button>
            <div className="w-8 h-8 rounded-full bg-[#FF0077]/20 flex items-center justify-center lg:hidden">
              <span className="text-xs font-semibold text-[#FF0077]">{userInitials}</span>
            </div>
          </div>
        </header>

        <main className="flex-1 p-5 sm:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
