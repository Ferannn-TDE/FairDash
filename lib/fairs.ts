import 'server-only' // hard-fail the build if a client component ever imports this (it pulls lib/db)
import { unstable_cache } from 'next/cache'
import { EventStatus, VendorStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { readinessWhereIfEnforced } from '@/lib/vendor-readiness'
import { demoHiddenWhere } from '@/lib/demo-vendor'
import type { FairData, VendorData } from '@/app/_contexts/FairContext'
import type { FairListItem } from '@/lib/fair-view'
import type { FairSeo, SitemapFair } from '@/lib/seo'
import { customerReachableScope, publicFairScope, isIndexableListing } from '@/lib/event-listing'
import { deliveryAvailable, effectiveFulfillment, isDeliveryEnabled, NO_CONFIG_FULFILLMENT } from '@/lib/delivery'

// Re-export the browser-safe view types for server-side callers' convenience.
// (Client components must import these from '@/lib/fair-view' directly — importing
// them from here would drag lib/db into the browser bundle.)
export type { FairListItem, PublicFairCard, PublicFairStatus } from '@/lib/fair-view'

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
      // Public detail page: only a live, non-archived fair resolves. Returning null
      // for UPCOMING/INACTIVE/archived makes the fair genuinely unreachable by direct
      // URL (the layout fires notFound() on null) — hidden means 404, not just unlinked.
      where: { urlSlug: fairSlug, status: EventStatus.ACTIVE, archivedAt: null, ...customerReachableScope() },
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
        onlineMarkupBps: true,
        featuredVendorIds: true,
        featuredLabel: true,
        featuredEnabled: true,
        admissionFree: true,
        openTime: true,
        closeTime: true,
        salesTaxRateMilli: true, // B1.19: the checkout estimate's tax (the order route re-reads them fresh)
        localTaxRateMilli: true,
        fulfillmentConfig: {
          select: {
            boothPickupEnabled: true,
            curbsideEnabled: true,
            homeDeliveryEnabled: true,
            homeDeliveryFee: true,
            curbsideFee: true,
            curbsideZoneDescription: true,
          },
        },
      },
    })

    if (!raw) return null

    const color = raw.primaryColor ?? '#FF0077'
    const fc = raw.fulfillmentConfig
    // Delivery as customers can actually choose it (lib/delivery.ts). A fair with no config offers
    // booth pickup only, so checkout never sees null and guesses "everything on".
    const platformDelivery = await isDeliveryEnabled()

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
            homeDeliveryEnabled: deliveryAvailable(platformDelivery, fc),
            homeDeliveryFee: fc.homeDeliveryFee ?? null,
            curbsideFee: fc.curbsideFee ?? 0,
            curbsideZoneDescription: fc.curbsideZoneDescription ?? null,
          }
        : { ...NO_CONFIG_FULFILLMENT, homeDeliveryFee: null, curbsideFee: 0, curbsideZoneDescription: null },
      serviceChargeEnabled: raw.serviceChargeEnabled ?? false,
      serviceChargeAmount: raw.serviceChargeAmount ?? null,
      // Online price markup (audit H5, 2h): the cart and checkout feed it to lib/checkout-total.ts.
      onlineMarkupBps: raw.onlineMarkupBps,
      // Never cached: the fair layout and /api/events/:slug merge the live terms in (item 10 stage 3).
      feeTerms: null,
      taxRates: { salesTaxRateMilli: raw.salesTaxRateMilli, localTaxRateMilli: raw.localTaxRateMilli },
      featuredVendorIds: raw.featuredVendorIds ?? [],
      featuredLabel: raw.featuredLabel ?? null,
      featuredEnabled: raw.featuredEnabled ?? true,
      // Same values the client's /api/events refresh normalizes to (FairContext normalizeEvent),
      // so the first paint and the hydrated page agree. Location stays empty on both until the
      // context reads the venue* columns.
      location: { address: '', city: '', state: '' },
      operatingHours: { open: raw.openTime ?? '', close: raw.closeTime ?? '' },
      admissionFree: raw.admissionFree,
    }
  },
  ['fair-by-slug'],
  { revalidate: 300, tags: ['fair'] },
)

export const getVendorsBySlugCached = unstable_cache(
  async (fairSlug: string): Promise<VendorData[]> => {
    const vendors = await db.vendor.findMany({
      where: {
        // Only surface vendors for a live, non-archived fair (mirrors the detail-page gate).
        event: { urlSlug: fairSlug, status: EventStatus.ACTIVE, archivedAt: null, ...customerReachableScope() },
        status: VendorStatus.ACTIVE,
        // Same readiness gate the /api/vendors endpoint applies, so the SSR vendor
        // list matches the hydrated one (no 17→2 flash when enforcement is on).
        ...readinessWhereIfEnforced(),
        // Demo booths hidden with live Stripe keys (lib/demo-vendor.ts).
        ...demoHiddenWhere(),
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
// FairListItem + the pure view helpers (toPublicFairCard/toPublicFairStatus) now
// live in the browser-safe '@/lib/fair-view'. This module keeps only DB fetchers.

export const getAllFairsCached = unstable_cache(
  async (): Promise<FairListItem[]> => {
    const events = await db.event.findMany({
      // Public discovery list: ACTIVE-only (UPCOMING is not public) and never archived.
      where: { status: EventStatus.ACTIVE, archivedAt: null, ...publicFairScope() },
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
        // Gated count — matches /api/fairs so the discovery card never shows "17
        // vendors" while only the ready ones are browsable.
        _count: { select: { vendors: { where: { status: VendorStatus.ACTIVE, ...readinessWhereIfEnforced(), ...demoHiddenWhere() } } } },
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

// ─── SEO (lib/seo.ts) ─────────────────────────────────────────────────────────

/** What fair-page metadata, JSON-LD and the share image need. Same gate as the page; `indexable`
 *  is false for UNLISTED, which reaches its page by direct URL but must never be indexed. */
export const getFairSeoBySlugCached = unstable_cache(
  async (fairSlug: string): Promise<FairSeo | null> => {
    const e = await db.event.findFirst({
      where: { urlSlug: fairSlug, status: EventStatus.ACTIVE, archivedAt: null, ...customerReachableScope() },
      select: {
        name: true, urlSlug: true, description: true, startDate: true, endDate: true, timezone: true,
        openTime: true, closeTime: true, venueAddress: true, venueCity: true, venueState: true, venueZip: true,
        admissionFree: true, listing: true,
        organizer: { select: { name: true } },
        fulfillmentConfig: { select: { boothPickupEnabled: true, curbsideEnabled: true, homeDeliveryEnabled: true } },
        _count: { select: { vendors: { where: { status: VendorStatus.ACTIVE, ...readinessWhereIfEnforced(), ...demoHiddenWhere() } } } },
      },
    })
    if (!e) return null
    const platformDelivery = await isDeliveryEnabled()
    return {
      name: e.name, slug: e.urlSlug, description: e.description,
      startDate: e.startDate.toISOString(), endDate: e.endDate.toISOString(), timezone: e.timezone,
      openTime: e.openTime, closeTime: e.closeTime,
      venueAddress: e.venueAddress, venueCity: e.venueCity, venueState: e.venueState, venueZip: e.venueZip,
      admissionFree: e.admissionFree,
      organizerName: e.organizer?.name ?? null,
      vendorCount: e._count.vendors,
      fulfillment: effectiveFulfillment(platformDelivery, e.fulfillmentConfig),
      // UNLISTED (the test fair) has a working page but no index, JSON-LD or canonical claim.
      indexable: isIndexableListing(e.listing),
    }
  },
  ['fair-seo-by-slug'],
  { revalidate: 300, tags: ['fair', 'vendors'] },
)

/** Public fairs and their browsable vendors, for the sitemap (only read when SEO_INDEX_FAIRS=1). */
export const getSitemapFairsCached = unstable_cache(
  async (): Promise<SitemapFair[]> => {
    const events = await db.event.findMany({
      where: { status: EventStatus.ACTIVE, archivedAt: null, ...publicFairScope() },
      orderBy: { startDate: 'asc' },
      select: {
        urlSlug: true, startDate: true, endDate: true, updatedAt: true,
        vendors: { where: { status: VendorStatus.ACTIVE, ...readinessWhereIfEnforced(), ...demoHiddenWhere() }, select: { id: true }, orderBy: { name: 'asc' } },
      },
    })
    return events.map(e => ({
      slug: e.urlSlug,
      startDate: e.startDate.toISOString(), endDate: e.endDate.toISOString(), updatedAt: e.updatedAt.toISOString(),
      vendorIds: e.vendors.map(v => v.id),
    }))
  },
  ['sitemap-fairs'],
  { revalidate: 3600, tags: ['fair', 'vendors'] },
)
