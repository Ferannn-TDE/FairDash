import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { ALLOWED_IMAGE_MIME, assertAllowedMime } from '@/lib/upload-limits'
import {
  StorageNotConfiguredError,
  StorageOpError,
  createMenuImageUpload,
} from '@/lib/menu-image-storage'

// POST /api/storage/menu-image
// Returns a Supabase Storage presigned UPLOAD url for one vendor menu-item photo.
//
// A SIBLING of app/api/storage/upload/route.ts, not a parameterisation of it. The two differ
// in the three things that matter: the bucket, the authorisation, and — most importantly —
// what the caller stores. The delivery-proof route hands back an object PATH because its
// bucket is private and reads mint a fresh signed url; this one hands back the PUBLIC URL,
// because menu photos render as plain <img src> on an unauthenticated storefront and are
// never signed. Folding those into one route would mean a caller-chosen bucket deciding a
// privacy model, which is the kind of switch that eventually gets flipped the wrong way.
//
// AUTHORISATION IS STRICTER HERE than on the delivery-proof route, and deliberately so. That
// route writes to a flat `proofs/` prefix, so requireAuth alone is enough. This path is
// VENDOR-SCOPED (`{vendorId}/…`), so a bare requireAuth would let any signed-in user drop
// objects into any vendor's folder. Membership is proved against the SESSION, so a tampered
// vendorId in the body fails the gate.
//
// ── THIS ROUTE CANNOT ENFORCE A SIZE LIMIT. ──────────────────────────────────────────────
// Same as the delivery-proof route and for the same reason: it hands back a presigned url and
// the bytes go from the CLIENT STRAIGHT TO SUPABASE, never through this server. The size
// boundary is the BUCKET's own `file_size_limit` on `menu-images` (4 MB, set in Supabase and
// asserted by scripts/upload-cap-guard.ts Part C). The client downscales before uploading
// (lib/downscale-image.ts) so a real phone photo lands under that limit rather than bouncing.
export async function POST(req: NextRequest) {
  try {
    const clerkId = await requireAuth()
    const { vendorId, filename, contentType } = await req.json()

    if (!vendorId || !filename || !contentType) {
      return apiError('vendorId, filename and contentType are required', 400, 'VALIDATION_ERROR')
    }

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await getVendorAuth(dbUser.id, vendorId, req)
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    // A menu photo is a photograph. Throws UploadRejection → INVALID_MIME via handleApiError.
    assertAllowedMime(contentType, ALLOWED_IMAGE_MIME)

    // Asserts the bucket exists AND is public before signing — see lib/menu-image-storage.ts.
    const { uploadUrl, publicUrl, path } = await createMenuImageUpload(vendorId, filename)

    return Response.json({
      success: true,
      data: {
        uploadUrl,
        // The stored value: a permanent public url, persisted verbatim as MenuRequest.imageUrl
        // and copied onto MenuItem.imageUrl at approval. NOT a path — the bucket is public and
        // nothing downstream signs anything.
        publicUrl,
        path,
      },
    })
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return apiError(err.message, 503, 'STORAGE_NOT_CONFIGURED')
    if (err instanceof StorageOpError)            return apiError(err.message, 502, 'STORAGE_UPLOAD_FAILED')
    return handleApiError(err)
  }
}
