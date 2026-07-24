import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireStrictAdminAuth } from '@/lib/auth'
import { isPreviewBypassEnabled, computePreviewAccess } from '@/lib/preview-access'

// GET /api/preview-access
//
// The ONE place the preview bypass is decided. Both conditions run HERE, server-side:
// the ALLOW_PREVIEW_BYPASS env flag (never NEXT_PUBLIC_, so it can't be flipped in a bundle)
// AND a live strict-admin session, re-checked per request via currentUser() inside
// requireStrictAdminAuth — so a signed-out visitor, or a demoted admin, is refused even if the
// flag is on. The client only ever receives the resulting boolean; it cannot assemble one.
//
// Always 200 with { allowed: false } for a non-admin rather than 401/403: this is a capability
// probe every storefront visitor's page runs, and a failed probe is the normal case, not an
// error. Nothing about the fair is disclosed either way.
export async function GET() {
  try {
    const flagEnabled = isPreviewBypassEnabled()

    let isAdmin = false
    try {
      await requireStrictAdminAuth()
      isAdmin = true
    } catch {
      isAdmin = false // signed out, or not an admin — the ordinary path
    }

    return success({
      allowed: computePreviewAccess({ flagEnabled, isAdmin }),
      // Surfaced so a previewing admin's banner can explain WHY they are inside a closed fair.
      // Never enough on its own: `allowed` is the only field that grants anything.
      flagEnabled,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
