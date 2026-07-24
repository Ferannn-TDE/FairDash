import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { isPreviewBypassEnabled, hasPreviewAccess } from '@/lib/preview-access'

// GET /api/preview-access
//
// The storefront's capability probe. The decision itself lives in lib/preview-access
// (hasPreviewAccess), shared with the ORDER WRITE PATH. Both conditions run server-side:
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
    // The SAME decision the order write path calls — one function, so the storefront probe and
    // the server-side order gate can never disagree about who may preview a closed fair.
    const allowed = await hasPreviewAccess()
    const flagEnabled = isPreviewBypassEnabled()

    return success({
      allowed,
      // Surfaced so a previewing admin's banner can explain WHY they are inside a closed fair.
      // Never enough on its own: `allowed` is the only field that grants anything.
      flagEnabled,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
