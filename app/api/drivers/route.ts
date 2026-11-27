import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fairAcceptsJoins } from '@/lib/fair-join-gate'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { ApiError } from '@/lib/api-error'
import { getOptionalUserId } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { validateApplication } from '@/lib/runner-application-validation'
import { createRunnerRecord } from '@/lib/payee-membership'
import { normalizeUsPhone } from '@/lib/phone'
import { enqueueApplicationReceived } from '@/lib/notifications'
import { enforceRateLimit } from '@/lib/ratelimit'
import { readJsonBody } from '@/lib/read-json-body'
import { APPLY_RATE_LIMITED, APPLY_RATE_LIMITED_MESSAGE } from '@/lib/application-limits'

// GET  /api/drivers  — list driver applications (admin only, stub)
// POST /api/drivers  — submit driver application (public + auth optional)

export async function GET() {
  return apiError('Not implemented — admin only', 501, 'NOT_IMPLEMENTED')
}

export async function POST(req: NextRequest) {
  try {
    // Application limits (sign-up-fixes commit 4, review finding 1): this route works signed out and
    // emails a confirmation to the typed address, so it is limited — 5 per hour per user when signed
    // in, else per connection — and the body is capped at 10 KB.
    const limitUserId = await getOptionalUserId()
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
    const { allowed, headers: rlHeaders } = await enforceRateLimit(`runner-apply:${limitUserId ?? `ip:${ip}`}`, 'runnerApply')
    if (!allowed) {
      const res = apiError(APPLY_RATE_LIMITED_MESSAGE, 429, APPLY_RATE_LIMITED)
      for (const [k, v] of Object.entries(rlHeaders)) res.headers.set(k, v)
      return res
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- validated by validateApplication below
    const body = await readJsonBody(req) as Record<string, any>
    const { personal, agreed, bgConsent, termsVersion, fairSlug } = body

    // REAL enforcement. The wizard runs these same rules for per-field feedback, but a
    // client gate is UX only — this is the gate that counts. Same module, so the two
    // cannot disagree. Returns every bad field at once rather than one-at-a-time.
    const fieldErrors = validateApplication({ personal, agreed, bgConsent })
    if (Object.keys(fieldErrors).length > 0) {
      throw new ApiError(
        Object.values(fieldErrors)[0],
        400,
        'VALIDATION_ERROR',
        { fieldErrors }
      )
    }

    const dateOfBirth = new Date(personal.dob)
    // +1XXXXXXXXXX (lib/phone). validateApplication has already passed the phone, so the
    // fallback to the trimmed text is never reached.
    const phone = normalizeUsPhone(String(personal.phone).trim()) ?? String(personal.phone).trim()

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
    // The application and the applicant's confirmation email commit together (sign-up-fixes
    // commit 2): the email can't exist without the application, and is sent once per application.
    const application = await db.$transaction(async tx => {
      const created = await tx.runnerApplication.create({
        data: {
          userId: applicant?.id ?? null,
          firstName: String(personal.firstName).trim(),
          lastName: String(personal.lastName).trim(),
          email: String(personal.email).trim(),
          phone,
          dateOfBirth,
          city: personal.city?.trim() || null,
          // Vehicle columns are left null: sign-up no longer asks for a vehicle (Driver Terms
          // 2026-11-04). Applications from before then keep theirs.
          termsAgreed: true,
          backgroundCheckConsent: true,
          termsVersion: termsVersion ?? null,
          termsAcceptedAt: new Date(),
          termsAcceptedIp: acceptedIp,
        },
        select: { id: true },
      })
      // No typed name in the email (confirmation-email-safety): the payload is the kind only.
      await enqueueApplicationReceived(tx, created.id, String(personal.email).trim(), { kind: 'runner' })
      return created
    })

    logger.info('[Drivers] Application received', {
      applicationId: application.id,
      email: personal.email,
      city: personal.city ?? null,
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
        select: { id: true, status: true },
      })
      // Unresolvable fair → application still succeeds; skip the mint, never 500.
      //
      // ACQUISITION GATE: a DRAFT fair is treated exactly like an unresolvable one — the
      // application is accepted, but NO Runner is minted against it. Runner CASCADEs on Event
      // delete and discarding a draft is a hard delete, so a runner attached to a draft would be
      // silently destroyed. Skipping (rather than throwing) preserves this route's contract that
      // an applicant is never rejected because of the fair's state. See lib/fair-join-gate.ts.
      if (event && fairAcceptsJoins(event.status)) {
        const existing = await db.runner.findUnique({
          where: { userId: applicant.id },
          select: { id: true },
        })
        if (!existing) {
          try {
            await createRunnerRecord({
              userId: applicant.id,
              eventId: event.id,
              approvalStatus: 'PENDING',
              status: 'OFFLINE',
              // CARRY-THROUGH: the contact details the applicant just typed
              // are copied onto the Runner, which is the record the Settings page reads
              // and writes (/api/runners/me). Without this the data lived ONLY on
              // RunnerApplication and Settings rendered blank on first open — the user
              // re-typed everything they had just entered. RunnerApplication remains the
              // immutable consent/audit trail; Runner is the mutable working profile.
              phone,
            })
            runnerMinted = true
            // The role is added inside createRunnerRecord (lib/payee-membership): this site was
            // once the only create path that never synced, which left a production runner with
            // no runner role. Best-effort there; the worker's role reconcile heals any miss.
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
