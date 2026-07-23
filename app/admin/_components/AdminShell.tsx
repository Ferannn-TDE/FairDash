'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useClerk } from '@clerk/clerk-react'
import {
  HomeIcon,
  BuildingStorefrontIcon,
  TruckIcon,
  Cog6ToothIcon,
  Bars3Icon,
  XMarkIcon,
  BellIcon,
  BoltIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  ChartBarIcon,
  BanknotesIcon,
  ArrowRightOnRectangleIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'
interface Props {
  children: React.ReactNode
  userName: string
  userInitials: string
  userEmail: string
}

// The shell's fair switcher is backed by the strict-gated /api/admin/fairs (all
// fairs, all organizers) — the same list the picker uses — NOT mock data.
interface ShellFair {
  id: string
  name: string
  urlSlug: string
  status: 'ACTIVE' | 'UPCOMING' | 'INACTIVE'
}

function SidebarLink({
  href,
  icon: Icon,
  label,
  indent = false,
  exact = false,
  onClick,
}: {
  href: string
  icon: React.ElementType
  label: string
  indent?: boolean
  exact?: boolean
  onClick?: () => void
}) {
  const pathname = usePathname()
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(href + '/')
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-inter transition-colors
        ${indent ? 'ml-3' : ''}
        ${active ? 'bg-[#FF0077]/10 text-[#FF0077]' : 'text-[#888] hover:text-white hover:bg-white/5'}`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </Link>
  )
}

function EventNav({ slug, fairs, loaded, onClose }: { slug: string; fairs: ShellFair[]; loaded: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(true)
  const fair = fairs.find(e => e.urlSlug === slug)
  // FLICKER CLASS: this header once fell back to the SLUG before the fairs list
  // resolved, so every admin load flashed "SPRINGFIELD-STATE-FAIR-2026" (the slug,
  // uppercased by this button's own CSS) for ~a second before settling to the real
  // name, "Italian Fest 2026" — a slug is a plausible-looking name and a wrong one.
  // A fair's display name comes from event.name or it is not rendered: skeleton
  // while loading, and an explicit unknown-fair label once loaded (which is a
  // genuinely different state, not a slower version of the same one).
  const name = fair?.name ?? null
  return (
    <div className="mt-4 pt-3 border-t border-white/5">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold text-[#555] uppercase tracking-widest hover:text-[#888] transition-colors"
      >
        {name
          ? <span className="truncate">{name}</span>
          : loaded
            ? <span className="truncate text-[#444]">Unknown fair</span>
            : <span className="h-2.5 w-28 rounded bg-white/10 animate-pulse" aria-hidden />}
        {open ? <ChevronDownIcon className="w-3 h-3 shrink-0" /> : <ChevronRightIcon className="w-3 h-3 shrink-0" />}
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          <SidebarLink href={`/admin/${slug}/dashboard`} icon={HomeIcon} label="Dashboard" indent onClick={onClose} />
          <SidebarLink href={`/admin/${slug}/vendors`} icon={BuildingStorefrontIcon} label="Vendors" indent onClick={onClose} />
          <SidebarLink href={`/admin/${slug}/fulfillment`} icon={BoltIcon} label="Fulfillment" indent onClick={onClose} />
          <SidebarLink href={`/admin/${slug}/runners`} icon={TruckIcon} label="Runners" indent onClick={onClose} />
          <SidebarLink href={`/admin/${slug}/orders`} icon={ClipboardDocumentListIcon} label="Orders" indent onClick={onClose} />
          <SidebarLink href={`/admin/${slug}/money`} icon={BanknotesIcon} label="Money" indent onClick={onClose} />
          <SidebarLink href={`/admin/${slug}/reports`} icon={ChartBarIcon} label="Reports" indent onClick={onClose} />
          <SidebarLink href={`/admin/${slug}/settings`} icon={Cog6ToothIcon} label="Settings" indent onClick={onClose} />
        </div>
      )}
    </div>
  )
}

function SidebarContent({ currentSlug, fairs, loaded, onClose }: { currentSlug: string | null; fairs: ShellFair[]; loaded: boolean; onClose?: () => void }) {
  return (
    <>
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-white/5 shrink-0">
        <Link href="/" className="group flex items-center">
          <span className="font-bebas text-lg text-white group-hover:text-[#FF0077] transition-colors leading-none">FAIR</span>
          <span className="font-bebas text-lg text-[#FF0077] group-hover:text-white transition-colors leading-none">SYNQ</span>
          <span className="ml-2 px-1.5 py-0.5 bg-[#FF0077]/10 text-[#FF0077] text-[9px] font-semibold rounded uppercase tracking-wider">
            Admin
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
        <SidebarLink href="/admin" icon={HomeIcon} label="All Events" exact onClick={onClose} />
        {/* PLATFORM-level, not per-fair: an organizer owns many fairs, so approving or
            suspending one is not a fair-scoped decision. Sits alongside "All Events",
            never inside the per-event nav. */}
        <SidebarLink href="/admin/organizers" icon={UserGroupIcon} label="Organizers" exact onClick={onClose} />

        {/* Per-event nav */}
        {currentSlug && <EventNav slug={currentSlug} fairs={fairs} loaded={loaded} onClose={onClose} />}

        {/* If no event selected, show all fairs */}
        {!currentSlug && (
          <div className="mt-4 pt-3 border-t border-white/5 space-y-0.5">
            <p className="px-3 mb-2 text-[10px] font-semibold text-[#555] uppercase tracking-widest">Fairs</p>
            {fairs.map(ev => (
              <Link
                key={ev.id}
                href={`/admin/${ev.urlSlug}/dashboard`}
                onClick={onClose}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-inter text-[#888] hover:text-white hover:bg-white/5 transition-colors"
              >
                <span className="truncate">{ev.name}</span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase
                  ${ev.status === 'ACTIVE' ? 'bg-green-500/15 text-green-400' : 'bg-sky-500/15 text-sky-400'}`}>
                  {ev.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </nav>
    </>
  )
}

export default function AdminShell({ children, userName, userInitials, userEmail }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [fairs, setFairs] = useState<ShellFair[]>([])
  // Distinguishes "still loading" from "loaded, no such fair" — without it the header
  // can only guess, and guessing is what produced the slug flash.
  const [fairsLoaded, setFairsLoaded] = useState(false)
  const pathname = usePathname()
  const { signOut } = useClerk()

  // Fair switcher list — strict-gated /api/admin/fairs, shared with the picker.
  useEffect(() => {
    let active = true
    fetch('/api/admin/fairs')
      .then(r => r.json())
      .then(json => { if (active && json.success) setFairs((json.data.fairs ?? []) as ShellFair[]) })
      .catch(() => { /* leave the list empty; the header shows the loaded-but-unknown state */ })
      .finally(() => { if (active) setFairsLoaded(true) })
    return () => { active = false }
  }, [])

  // Extract slug from /admin/[eventSlug]/...
  const slugMatch = pathname.match(/^\/admin\/([^/]+)/)
  const currentSlug = slugMatch?.[1] ?? null

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex overflow-x-hidden">

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
        <SidebarContent currentSlug={currentSlug} fairs={fairs} loaded={fairsLoaded} onClose={() => setSidebarOpen(false)} />

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
          {/* Sign out — matches the app's signOut pattern; lands on "/" (Step 4 convention) */}
          <button
            onClick={() => signOut({ redirectUrl: '/' })}
            className="mt-3 w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-inter text-[#888] hover:text-white hover:bg-white/5 transition-colors"
          >
            <ArrowRightOnRectangleIcon className="w-4 h-4 shrink-0" />
            Sign Out
          </button>
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
