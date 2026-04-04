'use client'

import Link from 'next/link'
import { useFair } from '../../../_contexts/FairContext'

export default function FairOrdersPage() {
  const { fair } = useFair()
  const accentColor = fair.branding?.accentColor ?? '#FF0077'

  return (
    <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-6 sm:py-10 text-white">
      <h1 className="font-bebas text-3xl sm:text-4xl tracking-wide mb-6 sm:mb-8">My Orders — {fair.name}</h1>

      {/* Empty state — auth + live API required */}
      <div className="bg-bg-card border border-white/10 rounded-2xl p-12 text-center">
        <p className="text-text-gray mb-2">Sign in to see your orders at this fair.</p>
        <p className="text-text-gray text-sm mb-8">
          Already placed an order? Check your confirmation for the tracking link.
        </p>
        <Link
          href={`/fair/${fair.slug}/vendors`}
          className="inline-flex items-center px-6 py-3 rounded-xl font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ background: accentColor }}
        >
          Start Ordering
        </Link>
      </div>
    </div>
  )
}
