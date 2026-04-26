'use client'

import Link from 'next/link'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import { useFair } from '../../../_contexts/FairContext'

interface Crumb {
  label: string
  href?: string
}

export default function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  const { fair } = useFair()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  const all: Crumb[] = [
    { label: fair.name || '…', href: `/fair/${fair.slug}` },
    ...crumbs,
  ]

  return (
    <nav className="flex items-center gap-1.5 text-xs text-text-gray mb-5 sm:mb-6 flex-wrap">
      {all.map((crumb, i) => {
        const isLast = i === all.length - 1
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRightIcon className="w-3 h-3 shrink-0 text-white/20" />}
            {isLast || !crumb.href ? (
              <span className={isLast ? 'text-white font-medium' : 'text-text-gray'}>
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="hover:text-white transition-colors"
                style={i === 0 ? { color: accentColor } : undefined}
              >
                {crumb.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
