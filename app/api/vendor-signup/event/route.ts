import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { findSignupEvent } from '@/lib/event-listing'

// GET /api/vendor-signup/event — which event the vendor sign-up wizard applies to (item 5b).
//   exactly one live SIGNUP_ONLY event → { event: { name, slug } }
//   none                               → { event: null } (the wizard falls back to its fair picker)
//   two or more                        → 409, never a guess about which one a vendor joins
// Public on purpose: it exposes only the holding event's name and slug, which every applicant
// sees in the wizard anyway.
export async function GET() {
  try {
    const found = await findSignupEvent()
    if (found.kind === 'many') {
      throw new ApiError(`There are ${found.count} sign-up events; there must be exactly one`, 409, 'SIGNUP_EVENT_AMBIGUOUS')
    }
    return success({ event: found.kind === 'one' ? found.event : null })
  } catch (err) {
    return handleApiError(err)
  }
}
