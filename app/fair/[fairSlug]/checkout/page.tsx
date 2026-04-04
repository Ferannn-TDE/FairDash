'use client'

import { useEffect } from 'react'
import { useFairCart } from '../../../_contexts/FairCartContext'

/**
 * Redirect shim — syncs the fair cart to the legacy SPA cart key then hands
 * off to the existing SPA checkout page. This keeps the new App Router pages
 * decoupled from the SPA checkout implementation.
 */
export default function FairCheckoutRedirect() {
  const { syncToSpaCart } = useFairCart()

  useEffect(() => {
    syncToSpaCart()
    window.location.replace('/checkout')
  }, [syncToSpaCart])

  return (
    <div className="min-h-screen bg-bg-dark flex items-center justify-center text-white">
      <p className="text-text-gray">Redirecting to checkout…</p>
    </div>
  )
}
