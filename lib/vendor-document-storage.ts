// Vendor compliance-document storage — PRIVATE bucket + signed reads.
//
// WHAT WENT WRONG (the reason this module exists). The vendor-document route used to
// upload to a PUBLIC bucket and persist `${SUPABASE_URL}/storage/v1/object/public/…` —
// a URL anyone could open, forever, with no auth. Worse, the public customer endpoint
// (GET /api/vendors/[id]) selected those columns and returned them verbatim, so the API
// actively HANDED OUT links to vendors' liability insurance certificates and business
// licences. Verified live: 4 documents returned HTTP 200 to an unauthenticated fetch.
//
// The original tradeoff was defensible for what it was written for — a food-handler
// permit is low-sensitivity, and the code said so. It stopped being defensible when
// insurance certificates and business licences (business address, policy numbers, EIN,
// owner details) were put in the same bucket and nobody re-evaluated it. A reasonable
// decision for one data type, silently inherited by a more sensitive one.
//
// So this module mirrors lib/runner-license-storage.ts, which was built to avoid exactly
// this pattern:
//   • uploads to `vendor-documents`, which MUST be PRIVATE,
//   • persists only the object PATH — never a URL (the Vendor.*Path columns),
//   • mints short-lived signed URLs on demand, for callers the ROUTE has authorised.
//
// assertPrivateBucket() below refuses the upload outright if the bucket is ever public,
// so a misconfiguration fails LOUDLY instead of silently breaching.

import { logger } from './logger'

export const VENDOR_DOC_BUCKET = process.env.SUPABASE_VENDOR_BUCKET ?? 'vendor-documents'

export const VENDOR_DOC_ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

export const VENDOR_DOC_MAX_BYTES = 10 * 1024 * 1024 // 10 MB

/** Signed read URLs are deliberately short-lived — long enough to render, not to share. */
export const SIGNED_URL_TTL_SECONDS = 60

/** The three document slots, and the Vendor column each one's PATH lives in. */
export const DOC_TYPES = ['foodHandler', 'insurance', 'businessLicense'] as const
export type VendorDocType = (typeof DOC_TYPES)[number]

export const DOC_PATH_FIELD: Record<VendorDocType, 'foodHandlerPermitPath' | 'insurancePath' | 'businessLicensePath'> = {
  foodHandler:     'foodHandlerPermitPath',
  insurance:       'insurancePath',
  businessLicense: 'businessLicensePath',
}

export class StorageNotConfiguredError extends Error {}
export class StorageOpError extends Error {}

function env() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new StorageNotConfiguredError(
      'Document storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, ' +
        `and create a PRIVATE bucket named "${VENDOR_DOC_BUCKET}".`,
    )
  }
  return { url, key }
}

/**
 * Verifies the document bucket is actually private. Supabase reports this on the bucket
 * record; if `public` is true, every object in it is world-readable by URL and storing an
 * insurance certificate there is a privacy breach — so we refuse the upload rather than
 * proceed. This is the guard whose ABSENCE allowed the original exposure.
 */
export async function assertPrivateBucket(): Promise<void> {
  const { url, key } = env()
  const res = await fetch(`${url}/storage/v1/bucket/${VENDOR_DOC_BUCKET}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  })
  if (res.status === 404) {
    throw new StorageNotConfiguredError(
      `Storage bucket "${VENDOR_DOC_BUCKET}" does not exist. Create it in Supabase with ` +
        'public access DISABLED, then retry.',
    )
  }
  if (!res.ok) {
    throw new StorageOpError(`Could not inspect bucket "${VENDOR_DOC_BUCKET}" (${res.status})`)
  }
  const bucket = await res.json()
  if (bucket?.public === true) {
    logger.error('[VendorDocs] REFUSING upload — document bucket is PUBLIC', { bucket: VENDOR_DOC_BUCKET })
    throw new StorageOpError(
      `Storage bucket "${VENDOR_DOC_BUCKET}" is PUBLIC. A vendor's insurance certificate and ` +
        'business licence must not be stored in a public bucket. Disable public access and retry.',
    )
  }
}

/** Deterministic, vendor-scoped object path. */
export function vendorDocObjectPath(
  vendorId: string,
  docType: VendorDocType,
  filename: string,
  now: number = Date.now(),
): string {
  const safe = (filename || docType).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
  return `${vendorId}/${docType}/${now}_${safe}`
}

/** Uploads bytes to the private bucket. Returns the stored object PATH (never a URL). */
export async function uploadVendorDocument(
  vendorId: string,
  docType: VendorDocType,
  file: Blob,
  filename: string,
  now: number = Date.now(),
): Promise<string> {
  const { url, key } = env()
  await assertPrivateBucket()

  const path = vendorDocObjectPath(vendorId, docType, filename, now)
  const res = await fetch(`${url}/storage/v1/object/${VENDOR_DOC_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': file.type,
      'x-upsert': 'true',
    },
    body: Buffer.from(await file.arrayBuffer()),
  })
  if (!res.ok) {
    const body = await res.text()
    logger.error('[VendorDocs] Supabase upload failed', { vendorId, docType, status: res.status, body: body.slice(0, 200) })
    throw new StorageOpError('Upload failed — please try again')
  }
  return path
}

/**
 * Mints a short-lived signed URL for an object path. The CALLER is responsible for having
 * authorised the requester (vendor-self / owning organizer / platform admin) — this
 * function does no authorisation of its own.
 */
export async function signVendorDocumentUrl(path: string): Promise<string> {
  const { url, key } = env()
  const res = await fetch(`${url}/storage/v1/object/sign/${VENDOR_DOC_BUCKET}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
  })
  if (!res.ok) {
    const body = await res.text()
    logger.error('[VendorDocs] Supabase sign failed', { status: res.status, body: body.slice(0, 200) })
    throw new StorageOpError('Could not generate a view link')
  }
  const data = await res.json()
  return `${url}/storage/v1${String(data.signedURL).replace(/^\/storage\/v1/, '')}`
}

/**
 * Extracts the object path out of a legacy public URL — used by the one-off backfill.
 * `…/storage/v1/object/public/vendor-documents/<path>` → `<path>`.
 * Returns null if the value doesn't look like one of ours.
 */
export function pathFromLegacyPublicUrl(value: string | null): string | null {
  if (!value) return null
  const marker = `/object/public/${VENDOR_DOC_BUCKET}/`
  const i = value.indexOf(marker)
  if (i === -1) return null
  return decodeURIComponent(value.slice(i + marker.length))
}
