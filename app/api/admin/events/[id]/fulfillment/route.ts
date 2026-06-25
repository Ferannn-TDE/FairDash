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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminAuth()

    // The [id] segment may be the event id OR its urlSlug (admin pages pass slug).
    const { id } = await params
    const event = await db.event.findFirst({ where: { OR: [{ id }, { urlSlug: id }] }, select: { id: true } })
    if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')

    const config = await db.fulfillmentConfig.findUnique({ where: { eventId: event.id } })
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
  curbsideFee?: number
  runnerFeePercent?: number
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminAuth()

    // The [id] segment may be the event id OR its urlSlug (admin pages pass slug).
    const { id } = await params
    const event = await db.event.findFirst({ where: { OR: [{ id }, { urlSlug: id }] }, select: { id: true } })
    if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')

    const body: FulfillmentBody = await req.json()

    // Validation: fee split + curbside fee (Part A)
    if (body.runnerFeePercent !== undefined) {
      const p = body.runnerFeePercent
      if (!Number.isInteger(p) || p < 0 || p > 100) {
        throw new ApiError('runnerFeePercent must be an integer 0–100', 400, 'VALIDATION_ERROR')
      }
    }
    if (body.curbsideFee !== undefined) {
      if (!Number.isFinite(body.curbsideFee) || body.curbsideFee < 0) {
        throw new ApiError('curbsideFee must be a non-negative number', 400, 'VALIDATION_ERROR')
      }
    }
    if (body.homeDeliveryFee != null && (!Number.isFinite(body.homeDeliveryFee) || body.homeDeliveryFee < 0)) {
      throw new ApiError('homeDeliveryFee must be a non-negative number', 400, 'VALIDATION_ERROR')
    }

    // At least one fulfillment method must remain enabled (when all three are sent).
    if (
      body.boothPickupEnabled !== undefined &&
      body.curbsideEnabled !== undefined &&
      body.homeDeliveryEnabled !== undefined &&
      !body.boothPickupEnabled && !body.curbsideEnabled && !body.homeDeliveryEnabled
    ) {
      throw new ApiError('At least one fulfillment method must be enabled', 400, 'NO_METHOD_ENABLED')
    }

    // Validation: if enabling curbside, coords + description are required
    if (body.curbsideEnabled === true) {
      const existing = await db.fulfillmentConfig.findUnique({ where: { eventId: event.id } })
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
      where: { eventId: event.id },
      create: {
        eventId: event.id,
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
        curbsideFee: body.curbsideFee ?? 0,
        runnerFeePercent: body.runnerFeePercent ?? 0,
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
        ...(body.curbsideFee !== undefined && { curbsideFee: body.curbsideFee }),
        ...(body.runnerFeePercent !== undefined && { runnerFeePercent: body.runnerFeePercent }),
      },
    })

    return success({ config })
  } catch (err) {
    return handleApiError(err)
  }
}
