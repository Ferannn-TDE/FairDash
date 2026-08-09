import { apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { ALLOWED_IMAGE_MIME, assertAllowedMime } from '@/lib/upload-limits'

// POST /api/storage/upload
// Returns a Supabase Storage presigned UPLOAD url for a runner's proof-of-delivery photo.
//
// The bucket is PRIVATE (`delivery-proofs`) and dedicated: proof photos are chargeback
// evidence with their own retention lifetime (must outlive the runner record), so they do
// NOT share a bucket with runner-documents. The caller receives an upload url + the object
// PATH; it stores the PATH (never a URL — a private object has no public URL, and a stored
// signed url would lie once it expires). Reads resolve a fresh signed url at read time.
//
// NOTE: vendor menu images do NOT use this route — that flow currently keeps a local
// blob: URL and never uploads (separate, tracked bug). This route's only caller is the
// runner delivery page.
//
// ── THIS ROUTE CANNOT ENFORCE A SIZE LIMIT. ──────────────────────────────────────────────
// It hands back a presigned URL; the file then goes from the CLIENT STRAIGHT TO SUPABASE and
// never passes through this server. There is nothing here to measure, and a Supabase upload
// token carries no size constraint — so an app-level check at this point would be theatre.
// The size boundary for this path is the BUCKET's own `file_size_limit` on `delivery-proofs`
// (4 MB, set in Supabase; asserted by scripts/upload-cap-guard.ts Part C, which fails if it
// is ever unset — same reasoning as assertPrivateBucket()). The client downscales the photo
// before uploading (lib/downscale-image.ts) so a real camera photo lands under that limit
// rather than being rejected at the door.
//
// What this route CAN enforce is the declared content type, which it does below — previously
// unchecked, so any authenticated caller could mint a token for arbitrary content.
const DELIVERY_PROOFS_BUCKET = 'delivery-proofs'

export async function POST(req: Request) {
  try {
    await requireAuth()

    const supabaseUrl = process.env.SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) {
      return apiError(
        'Photo upload is not configured — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing',
        503,
        'STORAGE_NOT_CONFIGURED'
      )
    }

    const { filename, contentType } = await req.json()
    if (!filename || !contentType) {
      return apiError('filename and contentType are required', 400, 'VALIDATION_ERROR')
    }
    // Proof-of-delivery evidence is a photograph. Throws UploadRejection → INVALID_MIME.
    assertAllowedMime(contentType, ALLOWED_IMAGE_MIME)

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `proofs/${Date.now()}_${safeName}`

    // Create a signed UPLOAD url. NOTE the endpoint: /object/UPLOAD/sign — the plain
    // /object/sign endpoint signs a DOWNLOAD of an EXISTING object and 404s for an upload.
    // The response field is `url` (not `signedURL`), a path like
    //   /object/upload/sign/<bucket>/<path>?token=<jwt>
    // to which the client PUTs the file (token in the url = auth; no Authorization header).
    const res = await fetch(
      `${supabaseUrl}/storage/v1/object/upload/sign/${DELIVERY_PROOFS_BUCKET}/${path}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          apikey: serviceKey,
        },
        body: JSON.stringify({}),
      }
    )

    if (!res.ok) {
      const body = await res.text()
      logger.error('[Storage] Supabase upload-sign error', { body })
      return apiError('Could not generate upload URL', 500, 'STORAGE_ERROR')
    }

    const data = await res.json() as { url?: string }
    if (!data.url) {
      logger.error('[Storage] upload-sign returned no url', { data })
      return apiError('Could not generate upload URL', 500, 'STORAGE_ERROR')
    }

    return Response.json({
      success: true,
      data: {
        uploadUrl: `${supabaseUrl}/storage/v1${data.url}`,
        // The stored value: an object PATH, resolved to a signed read url at read time.
        // Never a public/signed URL — the bucket is private and a stored url would expire.
        path,
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
