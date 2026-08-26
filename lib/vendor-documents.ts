// ─────────────────────────────────────────────────────────────────────────────
// Vendor compliance documents — the SINGLE source of truth for "does this vendor
// have all required documents on file".
// ─────────────────────────────────────────────────────────────────────────────
//
// Everything document-related derives from here so they can never disagree:
//   • the approve gates (organizer PATCH + admin approve — same rule, two doors)
//   • the readiness checklist's `documents` step
//   • the three server payloads that emit document presence
//   • the three admin/organizer screens that render it
//
// PRESENCE-ONLY, DELIBERATELY. `Vendor.insuranceExpiryDate` has NO write site
// anywhere in this repo (verified across app/, lib/, workers/, scripts/), so
// `insuranceExpired` is permanently false and "not expired" is unverifiable. A
// gate that folded in an always-false term would be theatre. This checks that a
// path is present, and nothing more. If expiry ever gains a write path, it gets
// added HERE and every reader inherits it.
//
// SHAPE MIRRORS lib/vendor-readiness.ts on purpose: a Prisma where-fragment for
// query sites and a predicate for code paths already holding a loaded vendor,
// both in one file so the two forms cannot drift apart.
//
// ⚠️ CLIENT-SAFE — client components import this file. The only import is
// TYPE-ONLY (erased at compile time); adding a runtime import from
// '@prisma/client' or './db' here would pull the Prisma client into the browser
// bundle, which typechecks and builds clean and then dies on page load.

import type { Prisma } from '@prisma/client'

/**
 * The canonical document keys.
 *
 * These match `DOC_TYPES` in lib/vendor-document-storage.ts and the `signAll`
 * response shape of POST /api/vendors/[id]/documents — so an upload response can
 * be read with this vocabulary directly, with no key mapping. Two server
 * payloads previously used `foodHandlerPermit` for the same thing; they were
 * renamed onto these keys.
 */
export const REQUIRED_VENDOR_DOCS = ['foodHandler', 'insurance', 'businessLicense'] as const
export type RequiredVendorDoc = (typeof REQUIRED_VENDOR_DOCS)[number]

/** One wording per document, so no two screens can label the same file differently. */
export const VENDOR_DOC_LABELS: Record<RequiredVendorDoc, string> = {
  foodHandler:     'Food Handler Permit',
  insurance:       'Certificate of Insurance',
  businessLicense: 'Business License',
}

/**
 * The bar as a Prisma where-fragment — all three required documents present.
 *
 * No consumer today (every current reader holds a loaded vendor and uses the
 * predicate below), but it is what a "vendors blocked on documents" list would
 * filter on, and keeping both forms in one file is what stops the query form and
 * the boolean form from drifting — the same reasoning as `readyVendorWhere`.
 */
export const docsCompleteWhere = {
  foodHandlerPermitPath: { not: null },
  insurancePath:         { not: null },
  businessLicensePath:   { not: null },
} satisfies Prisma.VendorWhereInput

/** The three columns the predicate reads. See schema.prisma:269-271. */
export interface VendorDocPaths {
  foodHandlerPermitPath: string | null
  insurancePath:         string | null
  businessLicensePath:   string | null
}

/**
 * The bar as an imperative predicate — the mirror of `docsCompleteWhere` for code
 * paths that already hold a loaded vendor (both approve gates, the readiness
 * computation). ONE boolean definition of "docs complete".
 */
export function vendorDocsComplete(v: VendorDocPaths): boolean {
  return (
    v.foodHandlerPermitPath !== null &&
    v.insurancePath         !== null &&
    v.businessLicensePath   !== null
  )
}

/**
 * Canonical per-document presence map, built from the path columns. Every server
 * payload that emits document state builds it from here, so the wire shape is one
 * shape. Never emits the paths themselves — they address objects in a PRIVATE
 * bucket and there is no public URL to hand out.
 */
export function vendorDocsPresence(v: VendorDocPaths): Record<RequiredVendorDoc, boolean> {
  return {
    foodHandler:     v.foodHandlerPermitPath !== null,
    insurance:       v.insurancePath         !== null,
    businessLicense: v.businessLicensePath   !== null,
  }
}

/**
 * Complete-from-presence, for readers that only ever receive the presence map
 * (the client screens). Derived from REQUIRED_VENDOR_DOCS, so adding a fourth
 * required document updates every caller at once.
 */
export function docsCompleteFromPresence(p: Record<RequiredVendorDoc, boolean>): boolean {
  return REQUIRED_VENDOR_DOCS.every(k => p[k])
}
