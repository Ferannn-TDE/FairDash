import { db } from '@/lib/db'

const CUID_RE = /^c[a-z0-9]{24}$/

export function isCuid(value: string): boolean {
  return CUID_RE.test(value)
}

export function generateVendorSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Returns a slug guaranteed unique within the given eventId.
// Append -2, -3, ... on collision. Slug is set once on creation and
// MUST NOT be regenerated on rename — that would break existing URLs.
export async function uniqueVendorSlug(name: string, eventId: string): Promise<string> {
  const base = generateVendorSlug(name) || 'vendor'
  let slug = base
  let n = 1
  while (await db.vendor.findFirst({ where: { eventId, slug }, select: { id: true } })) {
    n++
    slug = `${base}-${n}`
  }
  return slug
}
