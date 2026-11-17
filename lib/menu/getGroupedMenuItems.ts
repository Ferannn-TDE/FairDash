// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { unstable_cache } = require('next/cache') as { unstable_cache: typeof import('next/cache').unstable_cache }
import { db } from '@/lib/db'
import { readinessWhereIfEnforced } from '@/lib/vendor-readiness'
import { demoHiddenWhere } from '@/lib/demo-vendor'
import { ON_MENU } from './on-menu'
import { customerReachableScope } from '@/lib/event-listing'
import { onlineUnitPrice } from '@/lib/checkout-total'

// ONLINE PRICE (audit H5, step 2h): `price` is the ONLINE price customers see and pay, worked out
// from the stored in-person price and the event's markup by lib/checkout-total.ts (the same function
// checkout charges with). `inPersonPrice` is carried for the cart's calculator and the vendor's own
// edit form; customer screens never display it.
export interface MenuVariant {
  id: string
  label: string      // e.g. "Small", "Medium", "Regular"
  /** The online price (what the customer pays). */
  price: number
  /** The stored in-person (booth) price. For the calculator and the vendor's edit form only. */
  inPersonPrice: number
  available: boolean
}

export interface GroupedMenuItem {
  groupKey: string   // stable React key: vendorId::variantGroup or item.id
  baseName: string   // display name, e.g. "Bagna Cauda"
  category: string
  vendorId: string
  vendorName: string
  description: string | null
  imageUrl: string | null
  prepTime: number | null
  available: boolean // true when at least one variant is available
  variants: MenuVariant[]
}

async function _getGroupedMenuItemsByVendor(vendorId: string): Promise<GroupedMenuItem[]> {
  const items = await db.menuItem.findMany({
    where: { vendorId, ...ON_MENU },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      category: true,
      imageUrl: true,
      prepTime: true,
      isAvailable: true,
      variantGroup: true,
      variantLabel: true,
      vendor: { select: { name: true, event: { select: { onlineMarkupBps: true } } } },
    },
    orderBy: [{ category: 'asc' }, { variantGroup: 'asc' }, { price: 'asc' }],
  })

  const groups = new Map<string, GroupedMenuItem>()

  for (const item of items) {
    const markupBps = item.vendor.event.onlineMarkupBps
    const groupKey = item.variantGroup
      ? `${vendorId}::${item.variantGroup}`
      : item.id

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        baseName: item.variantGroup ?? item.name,
        category: item.category,
        vendorId,
        vendorName: item.vendor.name,
        description: item.description,
        imageUrl: item.imageUrl,
        prepTime: item.prepTime,
        available: false,
        variants: [],
      })
    }

    const group = groups.get(groupKey)!
    if (!group.imageUrl && item.imageUrl) group.imageUrl = item.imageUrl
    if (item.isAvailable) group.available = true

    group.variants.push({
      id: item.id,
      label: item.variantLabel ?? 'Regular',
      price: onlineUnitPrice(item.price, markupBps),
      inPersonPrice: item.price,
      available: item.isAvailable,
    })
  }

  return Array.from(groups.values())
}

export function getGroupedMenuItemsByVendor(
  vendorId: string,
  _opts?: { showUnavailable?: boolean },
): Promise<GroupedMenuItem[]> {
  return unstable_cache(
    () => _getGroupedMenuItemsByVendor(vendorId),
    [`vendor-menu-${vendorId}`],
    { revalidate: 120, tags: ['vendor-menu', `vendor-menu-${vendorId}`] },
  )()
}

async function _getGroupedMenuItemsByEvent(eventSlug: string): Promise<GroupedMenuItem[]> {
  const event = await db.event.findFirst({
    // Can't browse a soft-deleted fair's menu.
    where: { urlSlug: eventSlug, archivedAt: null, ...customerReachableScope() },
    select: {
      onlineMarkupBps: true,
      vendors: {
        // Same readiness gate every other customer surface applies — when
        // enforcement is on, only ready vendors' items (and therefore vendor
        // tabs, which are derived from these items) appear on browse/menu.
        // …and demo booths are left out with live Stripe keys (lib/demo-vendor.ts).
        where: { status: 'ACTIVE', isOffline: false, ...readinessWhereIfEnforced(), ...demoHiddenWhere() },
        select: { id: true },
      },
    },
  })
  if (!event) return []

  const vendorIds = event.vendors.map((v) => v.id)

  const items = await db.menuItem.findMany({
    where: { vendorId: { in: vendorIds }, ...ON_MENU },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      category: true,
      imageUrl: true,
      prepTime: true,
      isAvailable: true,
      variantGroup: true,
      variantLabel: true,
      vendorId: true,
      vendor: { select: { name: true } },
    },
    orderBy: [{ category: 'asc' }, { variantGroup: 'asc' }, { price: 'asc' }],
  })

  const groups = new Map<string, GroupedMenuItem>()

  for (const item of items) {
    const groupKey = item.variantGroup
      ? `${item.vendorId}::${item.variantGroup}`
      : item.id

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        baseName: item.variantGroup ?? item.name,
        category: item.category,
        vendorId: item.vendorId,
        vendorName: item.vendor.name,
        description: item.description,
        imageUrl: item.imageUrl,
        prepTime: item.prepTime,
        available: false,
        variants: [],
      })
    }

    const group = groups.get(groupKey)!
    if (!group.imageUrl && item.imageUrl) group.imageUrl = item.imageUrl
    if (item.isAvailable) group.available = true

    group.variants.push({
      id: item.id,
      label: item.variantLabel ?? 'Regular',
      price: onlineUnitPrice(item.price, event.onlineMarkupBps),
      inPersonPrice: item.price,
      available: item.isAvailable,
    })
  }

  return Array.from(groups.values())
}

export function getGroupedMenuItemsByEvent(
  eventSlug: string,
  _opts?: { showUnavailable?: boolean },
): Promise<GroupedMenuItem[]> {
  return unstable_cache(
    () => _getGroupedMenuItemsByEvent(eventSlug),
    [`event-menu-${eventSlug}`],
    { revalidate: 120, tags: ['vendor-menu', `event-menu-${eventSlug}`] },
  )()
}
