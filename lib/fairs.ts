import { unstable_cache } from 'next/cache'
import { EventStatus, VendorStatus } from '@prisma/client'
import { db } from '@/lib/db'
import type { FairData, VendorData } from '@/app/_contexts/FairContext'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeStatus(s: string): FairData['status'] {
  const map: Record<string, FairData['status']> = {
    ACTIVE: 'active', active: 'active',
    UPCOMING: 'upcoming', upcoming: 'upcoming',
    INACTIVE: 'completed', COMPLETED: 'completed', completed: 'completed',
    PAUSED: 'paused',
  }
  return map[s] ?? 'upcoming'
}

// ─── Cached fetchers ──────────────────────────────────────────────────────────

export const getFairBySlugCached = unstable_cache(
  async (fairSlug: string): Promise<FairData | null> => {
    const raw = await db.event.findFirst({
      where: { urlSlug: fairSlug },
      select: {
        id: true,
        name: true,
        urlSlug: true,
        description: true,
        status: true,
        primaryColor: true,
        startDate: true,
        endDate: true,
        serviceChargeEnabled: true,
        serviceChargeAmount: true,
        featuredVendorIds: true,
        featuredLabel: true,
        featuredEnabled: true,
        fulfillmentConfig: {
          select: {
            boothPickupEnabled: true,
            curbsideEnabled: true,
            homeDeliveryEnabled: true,
            homeDeliveryFee: true,
            curbsideZoneDescription: true,
          },
        },
      },
    })

    if (!raw) return null

    const color = raw.primaryColor ?? '#FF0077'
    const fc = raw.fulfillmentConfig

    return {
      id: raw.id,
      name: raw.name,
      slug: raw.urlSlug,
      description: raw.description ?? null,
      primaryColor: color,
      branding: {
        accentColor: color,
        gradientFrom: color,
        gradientTo: '#7C3AED',
      },
      status: normalizeStatus(raw.status),
      dates: {
        startDate: raw.startDate.toISOString(),
        endDate: raw.endDate.toISOString(),
      },
      fulfillmentConfig: fc
        ? {
            boothPickupEnabled: fc.boothPickupEnabled,
            curbsideEnabled: fc.curbsideEnabled,
            homeDeliveryEnabled: fc.homeDeliveryEnabled,
            homeDeliveryFee: fc.homeDeliveryFee ?? null,
            curbsideZoneDescription: fc.curbsideZoneDescription ?? null,
          }
        : null,
      serviceChargeEnabled: raw.serviceChargeEnabled ?? false,
      serviceChargeAmount: raw.serviceChargeAmount ?? null,
      featuredVendorIds: raw.featuredVendorIds ?? [],
      featuredLabel: raw.featuredLabel ?? null,
      featuredEnabled: raw.featuredEnabled ?? true,
      // These fields aren't in the DB — pages guard with optional chaining
      location: { address: '', city: '', state: '' },
      operatingHours: { open: '', close: '' },
      admissionFree: false,
    }
  },
  ['fair-by-slug'],
  { revalidate: 300, tags: ['fair'] },
)

export const getVendorsBySlugCached = unstable_cache(
  async (fairSlug: string): Promise<VendorData[]> => {
    const vendors = await db.vendor.findMany({
      where: {
        event: { urlSlug: fairSlug },
        status: VendorStatus.ACTIVE,
      },
      select: {
        id: true,
        name: true,
        cuisineType: true,
        description: true,
        boothNumber: true,
        isBusy: true,
        isOffline: true,
      },
      orderBy: { name: 'asc' },
    })

    return vendors.map(v => ({
      id: v.id,
      name: v.name,
      slug: v.id,
      cuisineType: v.cuisineType,
      description: v.description ?? null,
      boothNumber: v.boothNumber ?? null,
      logoUrl: null,
      isBusy: v.isBusy,
      isOffline: v.isOffline,
      _count: { menuItems: 0 },
    }))
  },
  ['vendors-by-fair-slug'],
  { revalidate: 120, tags: ['vendors'] },
)

// ─── Fair list (public) ───────────────────────────────────────────────────────

export interface FairListItem {
  id: string
  name: string
  slug: string
  description: string | null
  primaryColor: string
  status: string
  startDate: string
  endDate: string
  vendorCount: number
}

export const getAllFairsCached = unstable_cache(
  async (): Promise<FairListItem[]> => {
    const events = await db.event.findMany({
      where: { status: { in: [EventStatus.ACTIVE, EventStatus.UPCOMING] } },
      orderBy: { startDate: 'asc' },
      select: {
        id: true,
        name: true,
        urlSlug: true,
        description: true,
        status: true,
        primaryColor: true,
        startDate: true,
        endDate: true,
        _count: { select: { vendors: { where: { status: VendorStatus.ACTIVE } } } },
      },
    })

    return events.map(e => ({
      id: e.id,
      name: e.name,
      slug: e.urlSlug,
      description: e.description ?? null,
      primaryColor: e.primaryColor ?? '#FF0077',
      status: e.status,
      startDate: e.startDate.toISOString(),
      endDate: e.endDate.toISOString(),
      vendorCount: e._count.vendors,
    }))
  },
  ['all-fairs'],
  { revalidate: 300, tags: ['fair'] },
)
