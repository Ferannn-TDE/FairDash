import type { Prisma } from '@prisma/client'
import { SELLABLE } from '@/lib/menu/on-menu'

/**
 * The columns GET /api/vendors returns to anyone, signed in or not (audit H2).
 *
 * That route has no auth: everything selected here goes out verbatim to a stranger who knows a
 * fair's public slug. It used `include` with no select, so every Vendor column left the server:
 * the contact's name, email and phone, the typed legal-signature name and acceptance IP, the
 * Stripe account id, the payout-freeze fields and the storage paths of permits, insurance and
 * business licences. These are exactly the fields the customer vendor list reads
 * (app/_contexts/FairContext.tsx normalizeVendor). Do not add a column without asking whether a
 * stranger may have it. scripts/public-vendor-select-guard.ts fails on any change to this list.
 */
export const PUBLIC_VENDOR_SELECT = {
  id: true,
  name: true,
  slug: true,
  cuisineType: true,
  description: true,
  boothNumber: true,
  isBusy: true,
  isOffline: true,
  _count: { select: { menuItems: { where: SELLABLE } } },
} as const satisfies Prisma.VendorSelect
