'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useFair } from '../../../../_contexts/FairContext'

/**
 * Fair-scoped order tracking page.
 * For now this redirects to the SPA /track page with the orderId query param.
 * Once the SPA track page supports fairSlug context this can be replaced with
 * a full implementation.
 */
export default function FairOrderPage() {
  const params = useParams<{ fairSlug: string; orderId: string }>()
  const { fair } = useFair()

  return (
    <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-10 text-white">
      <h1 className="font-bebas text-4xl tracking-wide mb-8">Track Order</h1>

      <div className="bg-bg-card border border-white/10 rounded-2xl p-8 text-center max-w-md mx-auto">
        <p className="text-text-gray mb-6">
          Order tracking for order <span className="text-white font-mono">{params.orderId}</span>
        </p>
        <Link
          href={`/track?orderId=${params.orderId}`}
          className="inline-flex items-center px-6 py-3 rounded-xl font-semibold text-white bg-neon-pink hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
        >
          Open Full Tracker
        </Link>
        <Link
          href={`/fair/${fair.slug}/orders`}
          className="block text-text-gray hover:text-white text-sm mt-4 transition-colors"
        >
          ← Back to my orders
        </Link>
      </div>
    </div>
  )
}
