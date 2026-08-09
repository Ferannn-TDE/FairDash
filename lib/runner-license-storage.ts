// Driver's-licence storage — PRIVATE bucket + signed reads.
//
// WHY THIS IS NOT lib/…/documents: the vendor-document route uploads to a bucket and
// then persists `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}` — a public
// URL. Anyone who obtains that link can view the file, forever, with no auth. That is a
// known, accepted risk for a food-handler permit. It is NOT acceptable for a driver's
// licence, which carries a photo, DOB, licence number, and home address.
//
// So this module:
//   • uploads to a SEPARATE bucket (`runner-documents`) that MUST be created PRIVATE,
//   • persists only the object PATH — never a URL,
//   • mints short-lived signed URLs on demand, for callers the route has authorised.
//
// If the bucket is created public by mistake, the signed-URL flow still works but the
// privacy guarantee is void — see assertPrivateBucket() below, which fails loudly.

import { logger } from './logger'

export const LICENSE_BUCKET = process.env.SUPABASE_RUNNER_BUCKET ?? 'runner-documents'

// Size cap and MIME allowlist live in lib/upload-limits.ts, not here — one rule, read by
// every server receiver and every client picker. See ALLOWED_DOC_MIME / UPLOAD_MAX_BYTES.

/** Signed read URLs are deliberately short-lived — long enough to render, not to share. */
export const SIGNED_URL_TTL_SECONDS = 60

export class StorageNotConfiguredError extends Error {}
export class StorageOpError extends Error {}

function env() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new StorageNotConfiguredError(
      'Licence storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, ' +
        `and create a PRIVATE bucket named "${LICENSE_BUCKET}".`
    )
  }
  return { url, key }
}

/**
 * Verifies the licence bucket is actually private. Supabase reports this on the bucket
 * record; if `public` is true, every object in it is world-readable by URL and storing a
 * licence there would be a privacy breach — so we refuse the upload rather than proceed.
 */
export async function assertPrivateBucket(): Promise<void> {
  const { url, key } = env()
  const res = await fetch(`${url}/storage/v1/bucket/${LICENSE_BUCKET}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  })
  if (res.status === 404) {
    throw new StorageNotConfiguredError(
      `Storage bucket "${LICENSE_BUCKET}" does not exist. Create it in Supabase with ` +
        'public access DISABLED, then retry.'
    )
  }
  if (!res.ok) {
    throw new StorageOpError(`Could not inspect bucket "${LICENSE_BUCKET}" (${res.status})`)
  }
  const bucket = await res.json()
  if (bucket?.public === true) {
    // Loud, not silent. A public bucket here means anyone with the object URL can read
    // someone's ID — exactly the failure mode this module exists to prevent.
    logger.error('[License] REFUSING upload — licence bucket is PUBLIC', { bucket: LICENSE_BUCKET })
    throw new StorageOpError(
      `Storage bucket "${LICENSE_BUCKET}" is PUBLIC. A driver's licence must not be stored ` +
        'in a public bucket. Disable public access on the bucket and retry.'
    )
  }
}

/** Deterministic, non-enumerable-ish object path. Scoped per runner. */
export function licenseObjectPath(runnerId: string, filename: string, now: number): string {
  const safe = (filename || 'license').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
  return `runners/${runnerId}/license/${now}_${safe}`
}

/** Uploads bytes to the private bucket. Returns the stored object path. */
export async function uploadLicense(
  runnerId: string,
  file: Blob,
  filename: string,
  now: number = Date.now()
): Promise<string> {
  const { url, key } = env()
  await assertPrivateBucket()

  const path = licenseObjectPath(runnerId, filename, now)
  const res = await fetch(`${url}/storage/v1/object/${LICENSE_BUCKET}/${path}`, {
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
    logger.error('[License] Supabase upload failed', {
      runnerId,
      status: res.status,
      body: body.slice(0, 200),
    })
    throw new StorageOpError('Upload failed — please try again')
  }
  return path
}

/**
 * Mints a short-lived signed URL for an object path. The CALLER is responsible for
 * having authorised the requester (runner-self or admin) — this function does no
 * authorisation of its own.
 */
export async function signLicenseUrl(path: string): Promise<string> {
  const { url, key } = env()
  const res = await fetch(`${url}/storage/v1/object/sign/${LICENSE_BUCKET}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
  })
  if (!res.ok) {
    const body = await res.text()
    logger.error('[License] Supabase sign failed', { status: res.status, body: body.slice(0, 200) })
    throw new StorageOpError('Could not generate a view link')
  }
  const data = await res.json()
  // signedURL is a relative path (/object/sign/...) — prefix with the storage origin.
  return `${url}/storage/v1${String(data.signedURL).replace(/^\/storage\/v1/, '')}`
}

/** Best-effort delete of a superseded licence object. Never throws — the DB is the record. */
export async function deleteLicenseObject(path: string): Promise<void> {
  try {
    const { url, key } = env()
    await fetch(`${url}/storage/v1/object/${LICENSE_BUCKET}/${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${key}`, apikey: key },
    })
  } catch (err) {
    logger.warn('[License] Could not delete superseded object', {
      path,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
