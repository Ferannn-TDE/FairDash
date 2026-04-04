export type { Fair, FairStatus } from './fairs'
export type { MockVendor, MenuItem } from './vendors'
export { mockFairs } from './fairs'
export { mockVendors } from './vendors'

import { mockFairs, type Fair } from './fairs'
import { mockVendors, type MockVendor } from './vendors'

// ─── Fair helpers ─────────────────────────────────────────────────────────────

export function getFairBySlug(slug: string): Fair | undefined {
  return mockFairs.find((f) => f.slug === slug)
}

export function getFairById(id: string): Fair | undefined {
  return mockFairs.find((f) => f.id === id)
}

export function getActiveFairs(): Fair[] {
  return mockFairs.filter((f) => f.status === 'active' || f.status === 'upcoming')
}

// ─── Vendor helpers ───────────────────────────────────────────────────────────

export function getVendorsByFairId(fairId: string): MockVendor[] {
  return mockVendors.filter((v) => v.fairId === fairId)
}

export function getVendorsByFairSlug(slug: string): MockVendor[] {
  const fair = getFairBySlug(slug)
  if (!fair) return []
  return getVendorsByFairId(fair.id)
}

export function getVendorBySlug(fairSlug: string, vendorSlug: string): MockVendor | undefined {
  const fair = getFairBySlug(fairSlug)
  if (!fair) return undefined
  return mockVendors.find((v) => v.fairId === fair.id && v.slug === vendorSlug)
}

export function getVendorById(id: string): MockVendor | undefined {
  return mockVendors.find((v) => v.id === id)
}
