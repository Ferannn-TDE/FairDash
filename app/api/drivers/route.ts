import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { ApiError } from '@/lib/api-error'
import { getOptionalUserId } from '@/lib/auth'
import { logger } from '@/lib/logger'

// GET  /api/drivers  — list driver applications (admin only, stub)
// POST /api/drivers  — submit driver application (public + auth optional)

export async function GET() {
  return apiError('Not implemented — admin only', 501, 'NOT_IMPLEMENTED')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { personal, vehicle, agreed, bgConsent, termsVersion } = body ?? {}

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
    const dateOfBirth = new Date(personal.dob)
    if (Number.isNaN(dateOfBirth.getTime())) {
      throw new ApiError('date of birth is invalid', 400, 'VALIDATION_ERROR')
    }
    if (!vehicle?.type?.trim() || !vehicle?.make?.trim() || !vehicle?.model?.trim() || !vehicle?.year?.trim()) {
      throw new ApiError('vehicle type, make, model, and year are required', 400, 'VALIDATION_ERROR')
    }
    if (!agreed || !bgConsent) {
      throw new ApiError(
        'You must agree to the driver terms and background check consent',
        400,
        'VALIDATION_ERROR'
      )
    }

    // Optional applicant link — the form works signed-out, but if they're signed
    // in we attach the DB user so admin review can see the linked account.
    const clerkId = await getOptionalUserId()
    const applicant = clerkId
      ? await db.user.findUnique({ where: { clerkId }, select: { id: true } })
      : null

    // Auditable consent: the affirmations + which terms version (client-sent, what
    // they saw) with timestamp + IP set SERVER-side (authoritative, not client-supplied).
    const acceptedIp = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null

    // Persist the application (status PENDING). This is NOT a Runner row — Runner is
    // event-scoped and created by an admin when assigning the driver to a fair.
    const application = await db.runnerApplication.create({
      data: {
        userId: applicant?.id ?? null,
        firstName: String(personal.firstName).trim(),
        lastName: String(personal.lastName).trim(),
        email: String(personal.email).trim(),
        phone: String(personal.phone).trim(),
        dateOfBirth,
        city: personal.city?.trim() || null,
        vehicleType: String(vehicle.type).trim(),
        vehicleMake: String(vehicle.make).trim(),
        vehicleModel: String(vehicle.model).trim(),
        vehicleYear: String(vehicle.year).trim(),
        vehicleColor: vehicle.color?.trim() || null,
        vehiclePlate: vehicle.plate?.trim() || null,
        termsAgreed: true,
        backgroundCheckConsent: true,
        termsVersion: termsVersion ?? null,
        termsAcceptedAt: new Date(),
        termsAcceptedIp: acceptedIp,
      },
      select: { id: true },
    })

    logger.info('[Drivers] Application received', {
      applicationId: application.id,
      email: personal.email,
      city: personal.city ?? null,
      vehicleType: vehicle.type ?? null,
      linkedUser: applicant?.id ?? null,
    })

    return success(
      { id: application.id, message: 'Application received — we will be in touch within 2–3 business days.' },
      201
    )
  } catch (err) {
    return handleApiError(err)
  }
}
