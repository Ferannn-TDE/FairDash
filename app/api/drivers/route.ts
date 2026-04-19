import { NextRequest } from 'next/server'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { ApiError } from '@/lib/api-error'

// GET  /api/drivers  — list driver applications (admin only, stub)
// POST /api/drivers  — submit driver application (public + auth optional)

export async function GET() {
  return apiError('Not implemented — admin only', 501, 'NOT_IMPLEMENTED')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { personal, agreed, bgConsent } = body ?? {}

    if (!personal?.firstName?.trim() || !personal?.lastName?.trim()) {
      throw new ApiError('firstName and lastName are required', 400, 'VALIDATION_ERROR')
    }
    if (!personal?.email?.trim()) {
      throw new ApiError('email is required', 400, 'VALIDATION_ERROR')
    }
    if (!personal?.phone?.trim()) {
      throw new ApiError('phone is required', 400, 'VALIDATION_ERROR')
    }
    if (!personal?.dob) {
      throw new ApiError('date of birth is required', 400, 'VALIDATION_ERROR')
    }
    if (!agreed || !bgConsent) {
      throw new ApiError(
        'You must agree to the driver terms and background check consent',
        400,
        'VALIDATION_ERROR'
      )
    }

    // Applications are acknowledged here. Runner records are created by admin
    // when assigning a driver to a specific event (Runner.eventId is required).
    console.log('[Drivers] Application received:', {
      name: `${personal.firstName} ${personal.lastName}`,
      email: personal.email,
      city: personal.city ?? null,
      vehicleType: body.vehicle?.type ?? null,
    })

    return success({ message: 'Application received — we will be in touch within 2–3 business days.' }, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
