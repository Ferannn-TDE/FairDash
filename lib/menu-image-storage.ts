// Menu-item image storage — PUBLIC bucket, and NO signing, ever.
//
// WHY PUBLIC, when lib/vendor-document-storage.ts and lib/runner-license-storage.ts are
// emphatically private. A menu photo is marketing material whose entire job is to render on
// an unauthenticated public browse page. There is no confidentiality to protect — which is
// exactly what separates it from an insurance certificate or a chargeback-evidence photo.
//
// Two consumers make a private bucket not merely expensive but wrong-shaped:
//   • the customer storefront reads menu images out of an unstable_cache payload
//     (lib/menu/getGroupedMenuItems.ts:171, revalidate 120) that is shared by every viewer.
//     A signed url minted inside that cache is one url handed to everybody for two minutes,
//     issued before you know who is asking — a public url with an expiry date, not access
//     control.
//   • the cart COPIES imageUrl into localStorage (app/_contexts/FairCartContext.tsx:179)
//     and checkout renders that stored string days later. A signed url written there simply
//     expires, and the cart's CART_VERSION busts on schema change, not on signature expiry.
//
// So this module hands back the full PUBLIC OBJECT URL and every render site keeps its plain
// <img src>. That is the deliberate inverse of the vendor-document module, which persists a
// PATH precisely because its bucket must stay private. Do not "fix" either one to look like
// the other; the divergence is the design.
//
// assertPublicBucket() is assertPrivateBucket() with the inequality flipped, and it earns its
// round-trip: a `menu-images` bucket that is PRIVATE still signs uploads happily, so the
// breakage would appear later and everywhere at once — every stored url rendering broken,
// forever, with nothing in the write path having complained. Fail at upload time, loudly,
// naming the bucket.

import { logger } from './logger'

export const MENU_IMAGE_BUCKET = process.env.SUPABASE_MENU_IMAGE_BUCKET ?? 'menu-images'

// Size cap and MIME allowlist deliberately do NOT live here — they live in lib/upload-limits.ts,
// which every upload point reads. Same reasoning as the vendor-document module.

export class StorageNotConfiguredError extends Error {}
export class StorageOpError extends Error {}

function env(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new StorageNotConfiguredError(
      'Menu image storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, ' +
        `and create a PUBLIC bucket named "${MENU_IMAGE_BUCKET}".`,
    )
  }
  return { url, key }
}

/**
 * Verifies the menu-image bucket exists and is actually PUBLIC. A private bucket here would
 * produce stored urls that render broken everywhere a menu appears, with no error at write
 * time — so refuse the upload instead.
 */
export async function assertPublicBucket(): Promise<void> {
  const { url, key } = env()
  const res = await fetch(`${url}/storage/v1/bucket/${MENU_IMAGE_BUCKET}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  })

  // READ THE BODY, NOT THE STATUS, to recognise a missing bucket. Supabase answers an unknown
  // bucket with HTTP **400** whose body says `{"statusCode":"404","code":"NoSuchBucket"}` —
  // verified against the live project. Keying off `res.status === 404` (as the vendor-document
  // and runner-license modules do) makes the helpful "create it in Supabase" message
  // unreachable: the caller gets a generic "could not inspect (400)" instead of being told
  // what to do. Confirmed by a negative test before this was written.
  const raw = await res.text()
  let body: { public?: boolean; code?: string; error?: string } | null = null
  try { body = JSON.parse(raw) } catch { /* non-JSON — handled by the !res.ok branch below */ }

  if (res.status === 404 || body?.code === 'NoSuchBucket' || body?.error === 'Bucket not found') {
    throw new StorageNotConfiguredError(
      `Storage bucket "${MENU_IMAGE_BUCKET}" does not exist. Create it in Supabase with ` +
        'public access ENABLED and a 4 MB file size limit, then retry.',
    )
  }
  if (!res.ok) {
    throw new StorageOpError(`Could not inspect bucket "${MENU_IMAGE_BUCKET}" (${res.status})`)
  }
  const bucket = body
  if (bucket?.public !== true) {
    logger.error('[MenuImages] REFUSING upload — menu image bucket is PRIVATE', { bucket: MENU_IMAGE_BUCKET })
    throw new StorageOpError(
      `Storage bucket "${MENU_IMAGE_BUCKET}" is PRIVATE. Menu photos render as plain <img src> ` +
        'on the public storefront and are never signed, so a private bucket would store links ' +
        'that are broken everywhere. Enable public access on the bucket and retry.',
    )
  }
}

/**
 * Deterministic, VENDOR-scoped object path. Vendor-scoped and not item-scoped because no item
 * id exists at upload time: an ADD request's MenuItem is not minted until the organizer
 * approves it (app/api/organizer/fairs/[fairSlug]/menu-requests/[id]/route.ts).
 */
export function menuImageObjectPath(
  vendorId: string,
  filename: string,
  now: number = Date.now(),
): string {
  const safe = (filename || 'image').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
  return `${vendorId}/${now}_${safe}`
}

/** The stored value: a permanent, unauthenticated object url. This is what goes in the DB. */
export function publicMenuImageUrl(path: string): string {
  const { url } = env()
  return `${url}/storage/v1/object/public/${MENU_IMAGE_BUCKET}/${path}`
}

/**
 * Mints a presigned UPLOAD url for one menu image and returns it alongside the PUBLIC url the
 * caller should persist once the PUT succeeds.
 *
 * NOTE the endpoint: /object/UPLOAD/sign — the plain /object/sign endpoint signs a DOWNLOAD of
 * an EXISTING object and 404s for an upload. The response field is `url` (not `signedURL`).
 */
export async function createMenuImageUpload(
  vendorId: string,
  filename: string,
  now: number = Date.now(),
): Promise<{ uploadUrl: string; publicUrl: string; path: string }> {
  const { url, key } = env()
  await assertPublicBucket()

  const path = menuImageObjectPath(vendorId, filename, now)
  const res = await fetch(`${url}/storage/v1/object/upload/sign/${MENU_IMAGE_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      apikey: key,
    },
    body: JSON.stringify({}),
  })

  if (!res.ok) {
    const body = await res.text()
    logger.error('[MenuImages] Supabase upload-sign error', { body, path })
    throw new StorageOpError('Could not start the image upload — please try again')
  }

  const data = (await res.json()) as { url?: string }
  if (!data.url) {
    logger.error('[MenuImages] upload-sign returned no url', { path })
    throw new StorageOpError('Could not start the image upload — please try again')
  }

  return {
    uploadUrl: `${url}/storage/v1${data.url}`,
    publicUrl: publicMenuImageUrl(path),
    path,
  }
}
