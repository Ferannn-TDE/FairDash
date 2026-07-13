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
  /** Vendor.status (PENDING / ACTIVE / PAUSED / SUSPENDED / REJECTED). Drives the online
   *  toggle's approval + organizer-pause lock: only an ACTIVE vendor may go online. A
   *  PAUSED/SUSPENDED vendor was taken offline by the organizer and — since a vendor can't
   *  change their own status — cannot bring themselves back. That is "admin-set sticky
   *  offline" for free, via the status axis; the toggle just reflects it. */
  status: string
}

export const VendorContext = createContext<VendorMeta | null>(null)

export function useVendorMeta(): VendorMeta {
  const ctx = useContext(VendorContext)
  if (!ctx) throw new Error('useVendorMeta must be used within VendorProvider')
  return ctx
}
