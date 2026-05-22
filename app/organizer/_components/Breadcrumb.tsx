'use client'

import Link from 'next/link'
import { ChevronRightIcon, HomeIcon } from '@heroicons/react/24/outline'

interface Crumb {
  label: string
  href?: string
}

export function OrganizerBreadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs mb-5 flex-wrap font-inter">
      <Link
        href="/organizer"
        className="text-white/30 hover:text-white/60 transition-colors flex items-center gap-1"
      >
        <HomeIcon className="w-3 h-3" />
        <span>Dashboard</span>
      </Link>
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRightIcon className="w-3 h-3 text-white/20" />
          {crumb.href && i < crumbs.length - 1 ? (
            <Link href={crumb.href} className="text-white/40 hover:text-white/60 transition-colors">
              {crumb.label}
            </Link>
          ) : (
            <span className="text-white/70 font-medium">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
