import { db } from '@/lib/db'

export interface MenuVariant {
  id: string
  label: string      // e.g. "Small", "Medium", "Regular"
  price: number
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

export async function getGroupedMenuItemsByVendor(
  vendorId: string,
  { showUnavailable = false }: { showUnavailable?: boolean } = {},
): Promise<GroupedMenuItem[]> {
  const items = await db.menuItem.findMany({
    where: {
      vendorId,
      ...(showUnavailable ? {} : { isAvailable: true }),
    },
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
      vendor: { select: { name: true } },
    },
    orderBy: [{ category: 'asc' }, { variantGroup: 'asc' }, { price: 'asc' }],
  })

  const groups = new Map<string, GroupedMenuItem>()

  for (const item of items) {
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
      price: item.price,
      available: item.isAvailable,
    })
  }

  return Array.from(groups.values())
}

export async function getGroupedMenuItemsByEvent(
  eventSlug: string,
  { showUnavailable = false }: { showUnavailable?: boolean } = {},
): Promise<GroupedMenuItem[]> {
  const event = await db.event.findUnique({
    where: { urlSlug: eventSlug },
    select: {
      vendors: {
        where: { status: 'ACTIVE', isOffline: false },
        select: { id: true },
      },
    },
  })
  if (!event) return []

  const vendorIds = event.vendors.map((v) => v.id)

  const items = await db.menuItem.findMany({
    where: {
      vendorId: { in: vendorIds },
      ...(showUnavailable ? {} : { isAvailable: true }),
    },
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
      price: item.price,
      available: item.isAvailable,
    })
  }

  return Array.from(groups.values())
}
