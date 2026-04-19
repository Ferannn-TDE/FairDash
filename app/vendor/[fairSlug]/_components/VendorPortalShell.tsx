'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  HomeModernIcon,
  ClipboardDocumentListIcon,
  Squares2X2Icon,
  ChartBarIcon,
  Cog6ToothIcon,
  Bars3Icon,
  XMarkIcon,
  BellIcon,
  ArrowRightOnRectangleIcon,
  ChevronRightIcon,
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
  { key: 'dashboard', label: 'Dashboard',    icon: HomeModernIcon },
  { key: 'orders',    label: 'Orders',        icon: ClipboardDocumentListIcon },
  { key: 'menu',      label: 'Menu Manager',  icon: Squares2X2Icon },
  { key: 'analytics', label: 'Analytics',     icon: ChartBarIcon },
  { key: 'settings',  label: 'Settings',      icon: Cog6ToothIcon },
]

function SidebarContent({
  fairSlug,
  vendorName,
  userName,
  userEmail,
  onClose,
}: {
  fairSlug: string
  vendorName: string
  userName: string
  userEmail: string
  onClose?: () => void
}) {
  const pathname = usePathname()

  return (
    <div className="flex flex-col h-full p-5">
      {/* Brand */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <img src="/images/logo/newIcon.png" alt="FairSynq" className="w-8 h-8 object-contain flex-shrink-0" />
          <span className="font-bebas text-[1.375rem] tracking-[0.125rem] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.3)]">
            FAIR<span className="text-neon-pink">SYNQ</span>
          </span>
          <span className="ml-1 px-1.5 py-0.5 bg-neon-pink/10 text-neon-pink text-[9px] font-semibold rounded uppercase tracking-wider">
            Vendor
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0"
          >
            <XMarkIcon className="w-5 h-5 text-text-gray" />
          </button>
        )}
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
              onClick={onClose}
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

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-white/5 space-y-0.5">
        <Link
          href="/fairs"
          onClick={onClose}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm text-text-gray hover:bg-white/5 hover:text-white no-underline transition-all duration-200"
        >
          <ChevronRightIcon className="w-[1.125rem] h-[1.125rem] rotate-180 shrink-0" />
          Back to FairSynq
        </Link>
        <form action="/api/auth/sign-out" method="POST">
          <button
            type="submit"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm text-text-gray hover:bg-white/5 hover:text-red-400 transition-all duration-200 cursor-pointer bg-transparent border-0 w-full text-left"
          >
            <ArrowRightOnRectangleIcon className="w-[1.125rem] h-[1.125rem] shrink-0" />
            Sign Out
          </button>
        </form>
      </div>

      {/* User profile chip */}
      <div className="mt-3 p-3 bg-white/5 border border-white/10 rounded-xl flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-neon-pink/20 flex items-center justify-center shrink-0">
          <span className="text-xs font-semibold text-neon-pink">
            {userName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs font-semibold truncate">{userName}</p>
          <p className="text-text-gray text-[0.625rem] truncate">{userEmail}</p>
        </div>
      </div>
    </div>
  )
}

export default function VendorPortalShell({
  children,
  fairSlug,
  vendorName,
  userName,
  userEmail,
  pendingCount = 0,
}: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen bg-bg-dark desktop:h-screen desktop:overflow-hidden flex desktop:grid desktop:grid-cols-[16rem_1fr]">

      {/* Desktop sidebar */}
      <aside className="hidden desktop:flex bg-bg-card border-r border-white/10 flex-col h-full overflow-y-auto z-50">
        <SidebarContent
          fairSlug={fairSlug}
          vendorName={vendorName}
          userName={userName}
          userEmail={userEmail}
        />
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="desktop:hidden fixed inset-0 bg-black/70 z-[90] animate-fadeIn"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <div
        className={`desktop:hidden fixed top-0 left-0 h-screen w-[17rem] bg-bg-card border-r border-white/10 z-[95] transform transition-transform duration-300 ease-out overflow-y-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarContent
          fairSlug={fairSlug}
          vendorName={vendorName}
          userName={userName}
          userEmail={userEmail}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      {/* Mobile top bar */}
      <div className="desktop:hidden fixed top-0 left-0 right-0 z-50 bg-bg-dark/90 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center justify-between px-4 py-3.5">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0"
          >
            <Bars3Icon className="w-5 h-5 text-neon-pink" />
          </button>
          <span className="font-bebas text-[1.125rem] tracking-[0.125rem] text-white">
            VENDOR <span className="text-neon-pink">PORTAL</span>
          </span>
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

      {/* Main content */}
      <div className="overflow-y-auto desktop:h-full w-full min-w-0">
        <div className="h-14 desktop:hidden" />
        {children}
      </div>
    </div>
  )
}
