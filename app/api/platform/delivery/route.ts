import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { isDeliveryEnabled } from '@/lib/delivery'

// GET /api/platform/delivery → { enabled } — the platform home-delivery switch (item 6), for the
// screens that show or hide a per-event delivery toggle. Public: it's one boolean, and checkout
// already reveals it by whether the option appears.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return success({ enabled: await isDeliveryEnabled() })
  } catch (err) {
    return handleApiError(err)
  }
}
