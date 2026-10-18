import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/ratelimit'
import { validateDeliveryAddress } from '@/lib/delivery-address'
import { decideDeliveryRadius, googleGeocoder } from '@/lib/delivery-radius'

// POST /api/orders/delivery-check — early feedback at checkout: is this address inside the
// fair's delivery area?
//
// ADVISORY ONLY. POST /api/orders re-runs the same decision before any PaymentIntent exists and
// is the authority; nothing here is trusted later.
//
// SIGNED-IN + RATE-LIMITED + FAIL-CLOSED LIMITER, because every call spends a paid geocode: an
// anonymous or unthrottled endpoint that spends money is an easy target. Checkout already
// requires sign-in, so no legitimate caller is turned away.
//
// Body: { eventId, street, unit?, city, state?, zip }

export async function POST(req: NextRequest) {
  try {
    const clerkId = await requireAuth()

    const { allowed, headers } = await enforceRateLimit(clerkId, 'deliveryCheck', { failClosed: true })
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: { message: 'Too many address checks. Please wait a moment.', code: 'RATE_LIMITED' } },
        { status: 429, headers },
      )
    }

    const body = await req.json().catch(() => null) as
      | { eventId?: string; street?: string; unit?: string; city?: string; state?: string; zip?: string }
      | null
    if (!body?.eventId) throw new ApiError('eventId is required', 400, 'VALIDATION_ERROR')

    const addressErrors = validateDeliveryAddress({
      street: body.street, unit: body.unit, city: body.city, state: body.state, zip: body.zip,
    })
    if (addressErrors.length > 0) {
      throw new ApiError(addressErrors.map(e => e.message).join('; '), 400, 'VALIDATION_ERROR', { fields: addressErrors })
    }

    const event = await db.event.findFirst({
      where: { id: body.eventId, archivedAt: null },
      select: { eventLat: true, eventLng: true, fulfillmentConfig: { select: { homeDeliveryEnabled: true, homeDeliveryRadiusKm: true } } },
    })
    if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')
    if (!event.fulfillmentConfig?.homeDeliveryEnabled) {
      throw new ApiError('Home delivery isn’t available for this fair. Please choose pickup.', 409, 'FULFILLMENT_DISABLED')
    }

    const radius = await decideDeliveryRadius(
      { eventLat: event.eventLat, eventLng: event.eventLng, homeDeliveryRadiusKm: event.fulfillmentConfig.homeDeliveryRadiusKm },
      { street: body.street!.trim(), city: body.city!.trim(), state: body.state?.trim() || null, zip: body.zip!.trim() },
      googleGeocoder,
    )
    if (!radius.ok) throw new ApiError(radius.message, radius.status, radius.code)

    // Coordinates are deliberately NOT returned: the client has no use for them, and the order
    // route geocodes again rather than accept a point from the browser.
    return success({ deliverable: true, distanceKm: Math.round(radius.distanceKm * 10) / 10, radiusKm: radius.radiusKm, approximate: radius.approximate })
  } catch (err) {
    return handleApiError(err)
  }
}
