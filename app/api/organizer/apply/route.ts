import { NextRequest } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/ratelimit'
import { readJsonBody } from '@/lib/read-json-body'
import { APPLY_RATE_LIMITED, APPLY_RATE_LIMITED_MESSAGE } from '@/lib/application-limits'
import { ensureOrganizerBootstrap } from '@/lib/organizer-bootstrap'
import { normalizeOrganizerApplication, validateOrganizerApplication } from '@/lib/organizer-application'

// POST /api/organizer/apply — the organizer sign-up form (sign-up-fixes commit 4).
//
// The ONLY place a self-signup organizer is created (app/onboarding no longer creates one on page
// load). One transaction (lib/organizer-bootstrap): the FairOrganizer row, its first event as a
// hidden DRAFT (lib/create-fair, the wizard's own code), the Terms + Privacy acceptance
// (ApprovalAction TERMS_ACCEPTED), the admin alert with the event, and the applicant's
// confirmation email; then the owner membership. A second submit creates nothing new.
//
// Protections: sign-in, 5 applications per hour per user, a 10 KB body cap, every field checked
// here with the same rules the form uses.
export async function POST(req: NextRequest) {
  try {
    const clerkId = await requireAuth()
    const { allowed, headers } = await enforceRateLimit(`organizer-apply:${clerkId}`, 'organizerApply')
    if (!allowed) {
      const res = apiError(APPLY_RATE_LIMITED_MESSAGE, 429, APPLY_RATE_LIMITED)
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
      return res
    }

    const body = await readJsonBody(req)
    const fieldErrors = validateOrganizerApplication(body)
    if (Object.keys(fieldErrors).length) {
      throw new ApiError(Object.values(fieldErrors)[0], 400, fieldErrors.agreedToTerms ? 'CONSENT_REQUIRED' : 'VALIDATION_ERROR', { fieldErrors })
    }
    const app = normalizeOrganizerApplication(body)

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true, name: true } })
    if (!dbUser) return apiError('User not found — please sign in again', 404, 'NOT_FOUND')

    // The sign-in name, for the admin alert's Contact line and the Terms record.
    let signInName = dbUser.name
    try {
      const u = await currentUser()
      const fromClerk = [u?.firstName, u?.lastName].filter(Boolean).join(' ')
      if (fromClerk) signInName = fromClerk
    } catch {
      // Clerk unavailable (tests, local): the stored name is enough.
    }

    const { organizerId, created } = await ensureOrganizerBootstrap(
      dbUser.id,
      { name: app.organizationName, email: app.contactEmail, phone: app.contactPhone, contactName: signInName },
      {
        website: app.website,
        event: { ...app.event },
        acceptedBy: { clerkId, name: signInName },
      },
    )
    return success({ organizerId, created }, created ? 201 : 200)
  } catch (err) {
    return handleApiError(err)
  }
}
