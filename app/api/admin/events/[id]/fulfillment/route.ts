import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'
import { CurbsideMethod } from '@prisma/client'

// GET /api/admin/events/[id]/fulfillment
// Returns the FulfillmentConfig for the event.

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdminAuth()

    const event = await db.event.findUnique({ where: { id: params.id } })
    if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')

    const config = await db.fulfillmentConfig.findUnique({ where: { eventId: params.id } })
    return success({ config })
  } catch (err) {
    return handleApiError(err)
  }
}

// PATCH /api/admin/events/[id]/fulfillment
// Creates or updates the FulfillmentConfig.
// Validation: curbside cannot be enabled without coords + description.

interface FulfillmentBody {
  boothPickupEnabled?: boolean
  curbsideEnabled?: boolean
  homeDeliveryEnabled?: boolean
  curbsideZoneLat?: number | null
  curbsideZoneLng?: number | null
  curbsideZoneDescription?: string | null
  curbsideMethod?: CurbsideMethod | null
  homeDeliveryFee?: number | null
  homeDeliveryRadiusKm?: number | null
  runnerTransportDescription?: string | null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdminAuth()

    const event = await db.event.findUnique({ where: { id: params.id } })
    if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')

    const body: FulfillmentBody = await req.json()

    // Validation: if enabling curbside, coords + description are required
    if (body.curbsideEnabled === true) {
      const existing = await db.fulfillmentConfig.findUnique({ where: { eventId: params.id } })
      const lat = body.curbsideZoneLat ?? existing?.curbsideZoneLat
      const lng = body.curbsideZoneLng ?? existing?.curbsideZoneLng
      const desc = body.curbsideZoneDescription ?? existing?.curbsideZoneDescription

      if (!lat || !lng || !desc?.trim()) {
        throw new ApiError(
          'curbsideZoneLat, curbsideZoneLng, and curbsideZoneDescription are required before enabling curbside',
          400,
          'CURBSIDE_CONFIG_INCOMPLETE'
        )
      }
    }

    const config = await db.fulfillmentConfig.upsert({
      where: { eventId: params.id },
      create: {
        eventId: params.id,
        boothPickupEnabled: body.boothPickupEnabled ?? true,
        curbsideEnabled: body.curbsideEnabled ?? false,
        homeDeliveryEnabled: body.homeDeliveryEnabled ?? false,
        curbsideZoneLat: body.curbsideZoneLat ?? null,
        curbsideZoneLng: body.curbsideZoneLng ?? null,
        curbsideZoneDescription: body.curbsideZoneDescription ?? null,
        curbsideMethod: body.curbsideMethod ?? null,
        homeDeliveryFee: body.homeDeliveryFee ?? null,
        homeDeliveryRadiusKm: body.homeDeliveryRadiusKm ?? null,
        runnerTransportDescription: body.runnerTransportDescription ?? null,
      },
      update: {
        ...(body.boothPickupEnabled !== undefined && { boothPickupEnabled: body.boothPickupEnabled }),
        ...(body.curbsideEnabled !== undefined && { curbsideEnabled: body.curbsideEnabled }),
        ...(body.homeDeliveryEnabled !== undefined && { homeDeliveryEnabled: body.homeDeliveryEnabled }),
        ...(body.curbsideZoneLat !== undefined && { curbsideZoneLat: body.curbsideZoneLat }),
        ...(body.curbsideZoneLng !== undefined && { curbsideZoneLng: body.curbsideZoneLng }),
        ...(body.curbsideZoneDescription !== undefined && { curbsideZoneDescription: body.curbsideZoneDescription }),
        ...(body.curbsideMethod !== undefined && { curbsideMethod: body.curbsideMethod }),
        ...(body.homeDeliveryFee !== undefined && { homeDeliveryFee: body.homeDeliveryFee }),
        ...(body.homeDeliveryRadiusKm !== undefined && { homeDeliveryRadiusKm: body.homeDeliveryRadiusKm }),
        ...(body.runnerTransportDescription !== undefined && { runnerTransportDescription: body.runnerTransportDescription }),
      },
    })

    return success({ config })
  } catch (err) {
    return handleApiError(err)
  }
}
