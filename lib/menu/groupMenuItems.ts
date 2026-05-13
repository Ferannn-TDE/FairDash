// Client-side grouping for the fair-wide menu page (supports search/filter).
// Groups items by name suffix when variantGroup is not set in the DB.
// Output type matches GroupedMenuItem from getGroupedMenuItems so GroupedFoodCard works for both.

import type { GroupedMenuItem, MenuVariant } from '@/lib/menu/getGroupedMenuItems'

export type { GroupedMenuItem, MenuVariant }

export interface FlatMenuItem {
  id: string
  name: string
  description: string | null
  price: number
  category: string
  imageUrl: string | null
  prepTime: number | null
  available: boolean
  vendorId: string
  vendorName: string
}

// Ordered from smallest to largest for sort purposes
const SIZE_LABELS = [
  'mini', 'personal', 'half', 'small', 'regular', 'medium',
  'large', 'xl', 'extra large', 'jumbo', 'family', 'full',
] as const

const SIZE_ORDER = new Map<string, number>(SIZE_LABELS.map((s, i) => [s, i]))
const SIZE_KEYWORDS = SIZE_LABELS.join('|')
const SIZE_SUFFIX_RE = new RegExp(
  `\\s*(?:\\(?\\s*(${SIZE_KEYWORDS})\\s*\\)?|\\s*[-–]\\s*(${SIZE_KEYWORDS}))\\s*$`,
  'i'
)

export function getBaseName(name: string): string {
  return name.replace(SIZE_SUFFIX_RE, '').trim()
}

function extractSizeLabel(name: string): string | null {
  const match = name.match(SIZE_SUFFIX_RE)
  if (!match) return null
  const raw = (match[1] ?? match[2]).toLowerCase()
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function sizeRank(label: string): number {
  return SIZE_ORDER.get(label.toLowerCase()) ?? 99
}

export function groupMenuItems(items: FlatMenuItem[]): GroupedMenuItem[] {
  const buckets = new Map<string, FlatMenuItem[]>()

  for (const item of items) {
    const base = getBaseName(item.name)
    const key = `${item.vendorId}::${base}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }

  const result: GroupedMenuItem[] = []

  for (const [key, bucket] of buckets) {
    const base = key.split('::').slice(1).join('::')
    const imageUrl = bucket.find(i => i.imageUrl)?.imageUrl ?? null
    const anchor = bucket[0]

    const variants: MenuVariant[] = bucket
      .map((item): MenuVariant => ({
        id: item.id,
        label: extractSizeLabel(item.name) ?? 'Regular',
        price: item.price,
        available: item.available,
      }))
      .sort((a, b) => sizeRank(a.label) - sizeRank(b.label))

    result.push({
      groupKey: bucket.length === 1 ? bucket[0].id : `${anchor.vendorId}::${base}`,
      baseName: base,
      category: anchor.category,
      vendorId: anchor.vendorId,
      vendorName: anchor.vendorName,
      description: anchor.description,
      imageUrl,
      prepTime: anchor.prepTime,
      available: bucket.some(i => i.available),
      variants,
    })
  }

  return result
}
