import { apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// POST /api/storage/upload
// Returns a Supabase Storage presigned upload URL.
// Used by vendors (menu item photos) and runners (delivery confirmation photos).
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.
//
// TODO: Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local to enable.
//       SUPABASE_URL = https://<project-ref>.supabase.co
//       SUPABASE_SERVICE_ROLE_KEY = from Supabase Dashboard → Settings → API
export async function POST(req: Request) {
  try {
    await requireAuth()

    const supabaseUrl = process.env.SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'menu-images'

    if (!supabaseUrl || !serviceKey) {
      return apiError(
        'Photo upload is not configured — add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable',
        503,
        'STORAGE_NOT_CONFIGURED'
      )
    }

    const { filename, contentType } = await req.json()
    if (!filename || !contentType) {
      return apiError('filename and contentType are required', 400, 'VALIDATION_ERROR')
    }

    // Sanitise filename and scope to vendor uploads path
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `uploads/${Date.now()}_${safeName}`

    // Create a signed upload URL via Supabase Storage REST API
    const res = await fetch(
      `${supabaseUrl}/storage/v1/object/sign/${bucket}/${path}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          apikey: serviceKey,
        },
        body: JSON.stringify({ expiresIn: 300 }), // 5 minutes
      }
    )

    if (!res.ok) {
      const body = await res.text()
      console.error('[Storage] Supabase sign error:', body)
      return apiError('Could not generate upload URL', 500, 'STORAGE_ERROR')
    }

    const data = await res.json()
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`

    return Response.json({
      success: true,
      data: {
        uploadUrl: `${supabaseUrl}${data.signedURL}`,
        publicUrl,
        path,
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
