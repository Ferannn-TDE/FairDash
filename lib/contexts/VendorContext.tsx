'use client'

import { createContext, useContext } from 'react'

export interface VendorMeta {
  vendorId: string
  vendorName: string
  eventId: string
  fairSlug: string
  logoUrl: string | null
  cuisineType: string
  /** The vendor's REAL saved online/offline state, from the server. The dashboard toggle
   *  initialises from this instead of a default, so it never flashes the wrong state on
   *  load. Present because the layout gates rendering until vendorMeta loads, so it is
   *  always available at the dashboard's first paint. */
  isOffline: boolean
}

export const VendorContext = createContext<VendorMeta | null>(null)

export function useVendorMeta(): VendorMeta {
  const ctx = useContext(VendorContext)
  if (!ctx) throw new Error('useVendorMeta must be used within VendorProvider')
  return ctx
}
