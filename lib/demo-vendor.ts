// DEMO BOOTHS (Jordan, Nov 16; sub-step D; closes organizer gap check S3).
//
// Vendor.isDemo is set only by a strict admin (PATCH /api/admin/vendors/[id]/demo) and by the
// local dev-fair seed. A demo booth:
//   - skips the Stripe payouts check for approval (lib/vendor-payouts-check.ts) and the stored
//     payouts item of the go-live checklist (lib/vendor-go-live.ts); documents, a sellable menu
//     and a booth number are still required;
//   - with LIVE Stripe keys (lib/stripe-mode.ts): is hidden from every customer reader and refused
//     at checkout (409 VENDOR_DEMO), before any Stripe call;
//   - in TEST mode (local, preview): shows and takes test orders normally.
//
// Every customer reader spreads demoHiddenWhere() into its vendor `where` (lists and counts) or
// asks demoVendorHidden() (single-vendor routes). scripts/demo-vendor-test.ts pins each reader.

import type { Prisma } from '@prisma/client'
import { stripeLiveMode } from './stripe-mode'

/** The vendor `where` fragment for customer readers: demo booths left out when live. */
export function demoHiddenWhere(): Prisma.VendorWhereInput {
  return stripeLiveMode() ? { isDemo: false } : {}
}

/** For a single loaded vendor: is it hidden from customers right now? */
export function demoVendorHidden(vendor: { isDemo: boolean }): boolean {
  return vendor.isDemo && stripeLiveMode()
}

export const VENDOR_DEMO_CODE = 'VENDOR_DEMO'
export const demoRefusalMessage = (name: string) => `${name} is a demo booth and can't take real orders.`
