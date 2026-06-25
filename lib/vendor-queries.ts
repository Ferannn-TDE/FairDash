import { Prisma, VendorStatus } from '@prisma/client'
import { db } from '@/lib/db'

// A vendor that is approved and live (visible to customers + counted on organizer
// headline stats). PENDING / PAUSED / SUSPENDED / REJECTED are excluded.
export const ACTIVE_VENDOR_WHERE: Prisma.VendorWhereInput = {
  status: VendorStatus.ACTIVE,
}

export async function countActiveVendors(eventId: string): Promise<number> {
  return db.vendor.count({ where: { eventId, ...ACTIVE_VENDOR_WHERE } })
}

export async function countActiveVendorsByEvent(eventIds: string[]): Promise<Record<string, number>> {
  if (eventIds.length === 0) return {}
  const groups = await db.vendor.groupBy({
    by: ['eventId'],
    where: { eventId: { in: eventIds }, ...ACTIVE_VENDOR_WHERE },
    _count: { id: true },
  })
  return Object.fromEntries(groups.map(g => [g.eventId, g._count.id]))
}
