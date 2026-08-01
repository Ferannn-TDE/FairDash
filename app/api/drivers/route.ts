import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { ApiError } from '@/lib/api-error'
import { getOptionalUserId } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { validateApplication } from '@/lib/runner-application-validation'
import { syncUserRoleMetadata } from '@/lib/role-sync'

// GET  /api/drivers  — list driver applications (admin only, stub)
// POST /api/drivers  — submit driver application (public + auth optional)

export async function GET() {
  return apiError('Not implemented — admin only', 501, 'NOT_IMPLEMENTED')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { personal, vehicle, agreed, bgConsent, termsVersion, fairSlug } = body ?? {}

    // REAL enforcement. The wizard runs these same rules for per-field feedback, but a
    // client gate is UX only — this is the gate that counts. Same module, so the two
    // cannot disagree. Returns every bad field at once rather than one-at-a-time.
    const fieldErrors = validateApplication({ personal, vehicle, agreed, bgConsent })
    if (Object.keys(fieldErrors).length > 0) {
      throw new ApiError(
        Object.values(fieldErrors)[0],
        400,
        'VALIDATION_ERROR',
        { fieldErrors }
      )
    }

    const dateOfBirth = new Date(personal.dob)

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

    // Self-serve runner mint: when an AUTHENTICATED applicant came through the runner
    // door for a specific fair, promote the application into a PENDING Runner scoped to
    // that event. The consent-bearing RunnerApplication above is the required legal
    // trail behind every minted Runner (linked implicitly via the shared userId).
    //   Signed-out OR no fairSlug → application-only (classic path), untouched.
    //   CREATE-IF-ABSENT keyed by userId (@unique): if the user already has a Runner we
    //   do NOTHING — never overwrite, never reset approvalStatus, never downgrade an
    //   APPROVED runner to PENDING. A guarded check-then-create (NOT an upsert).
    let runnerMinted = false
    if (applicant?.id && typeof fairSlug === 'string' && fairSlug.trim()) {
      const event = await db.event.findUnique({
        where: { urlSlug: fairSlug.trim() },
        select: { id: true },
      })
      // Unresolvable fair → application still succeeds; skip the mint, never 500.
      if (event) {
        const existing = await db.runner.findUnique({
          where: { userId: applicant.id },
          select: { id: true },
        })
        if (!existing) {
          try {
            await db.runner.create({
              data: {
                userId: applicant.id,
                eventId: event.id,
                approvalStatus: 'PENDING',
                status: 'OFFLINE',
                // CARRY-THROUGH: the contact + vehicle details the applicant just typed
                // are copied onto the Runner, which is the record the Settings page reads
                // and writes (/api/runners/me). Without this the data lived ONLY on
                // RunnerApplication and Settings rendered blank on first open — the user
                // re-typed everything they had just entered. RunnerApplication remains the
                // immutable consent/audit trail; Runner is the mutable working profile.
                phone: String(personal.phone).trim() || null,
                vehicleMake: String(vehicle.make).trim() || null,
                vehicleModel: String(vehicle.model).trim() || null,
                vehicleColor: vehicle.color?.trim() || null,
                vehiclePlate: vehicle.plate?.trim() || null,
              },
            })
            runnerMinted = true

            // Membership-create path → derive roles[] from the DB authority (house rule,
            // lib/role-sync.ts). This site was the ONLY one of the three that never called it:
            // vendors (app/api/vendors/route.ts) and organizers (lib/organizer-bootstrap.ts)
            // both did. So a runner had genuine portal access with no 'runner' in roles[], and
            // the navbar's Runner Dashboard link never appeared — the mirror image of the
            // vendor bug, a ROW WITH NO METADATA rather than metadata with no row. Confirmed
            // live: odedairoferan@gmail.com holds a Runner row and roles[] ["organizer"].
            // Best-effort, matching the other two: the DB is the authority, so a transient
            // Clerk failure self-heals on the next sync and must never fail the application.
            try {
              await syncUserRoleMetadata(applicant.id)
            } catch (syncErr) {
              logger.error('[Drivers] roles[] sync failed (DB is authority; will self-heal)', {
                userId: applicant.id,
                err: syncErr instanceof Error ? syncErr.message : String(syncErr),
              })
            }
          } catch (mintErr) {
            // Lost a race to a concurrent submit (userId @unique violation) — the row
            // already exists, so leave it as-is. Any other error is unexpected: log,
            // but never fail the application (the consent record is already saved).
            logger.warn('[Drivers] Runner mint skipped (already exists or race)', {
              userId: applicant.id,
              eventId: event.id,
              err: mintErr instanceof Error ? mintErr.message : String(mintErr),
            })
          }
        }
      }
    }

    logger.info('[Drivers] Runner mint outcome', {
      applicationId: application.id,
      userId: applicant?.id ?? undefined,
      fairSlug: typeof fairSlug === 'string' ? fairSlug : null,
      runnerMinted,
    })

    return success(
      { id: application.id, runnerMinted, message: 'Application received — we will be in touch within 2–3 business days.' },
      201
    )
  } catch (err) {
    return handleApiError(err)
  }
}
