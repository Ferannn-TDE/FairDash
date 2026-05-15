'use client'

import { createContext, useContext } from 'react'

export interface VendorMeta {
  vendorId: string
  vendorName: string
  eventId: string
  fairSlug: string
  logoUrl: string | null
  cuisineType: string
}

export const VendorContext = createContext<VendorMeta | null>(null)

export function useVendorMeta(): VendorMeta {
  const ctx = useContext(VendorContext)
  if (!ctx) throw new Error('useVendorMeta must be used within VendorProvider')
  return ctx
}
