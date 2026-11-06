import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { enforceRateLimit } from '@/lib/ratelimit'
import { logger } from '@/lib/logger'
import { enqueueSignupAlert } from '@/lib/notifications'
import { normalizePartnerApplication, validatePartnerApplication, PARTNER_APPLY_SUCCESS, PARTNER_APPLY_DUPLICATE, HONEYPOT_FIELD } from '@/lib/partner-application'

// POST /api/partners/apply — the public partner organization application (Batch 1 item 7, B1.11).
// No login. Writes one PartnerOrganization row, PENDING until the client reviews it (item 9).
//
// A new application and a honeypot hit get the same success response, so a bot can't tell it was
// caught. A second application from an email that already has one pending gets a clear "already
// being reviewed" message instead (your call, 2026-11-05); nothing is written either way.
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
    const { allowed, headers } = await enforceRateLimit(`partner-apply:${ip ?? 'unknown'}`, 'partnerApply')
    if (!allowed) {
      const res = apiError('Too many applications from this connection. Please try again later.', 429, 'RATE_LIMITED')
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
      return res
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw new ApiError('Invalid request', 400, 'VALIDATION_ERROR')

    // Honeypot: a hidden field people never see. Filled in → a bot. Pretend it worked, store nothing.
    if (typeof body[HONEYPOT_FIELD] === 'string' && body[HONEYPOT_FIELD].trim()) {
      logger.warn('[Partners] Honeypot tripped; nothing stored', { ip })
      return success({ message: PARTNER_APPLY_SUCCESS })
    }

    const fieldErrors = validatePartnerApplication(body)
    if (Object.keys(fieldErrors).length) {
      throw new ApiError('Please fix the highlighted fields', 400, 'VALIDATION_ERROR', { fieldErrors })
    }
    const app = normalizePartnerApplication(body)

    // A pending application from this email already exists → say so, write nothing.
    const pending = await db.partnerOrganization.findFirst({
      where: { contactEmail: app.contactEmail, approvalStatus: 'PENDING' },
      select: { id: true },
    })
    if (pending) return success({ message: PARTNER_APPLY_DUPLICATE, duplicate: true })

    // The application and the client's sign-up alert commit together (item 9).
    const row = await db.$transaction(async tx => {
      const created = await tx.partnerOrganization.create({ data: { ...app, requestIp: ip }, select: { id: true } })
      await enqueueSignupAlert(tx, created.id, { kind: 'partner', name: app.name, contactName: app.contactName, email: app.contactEmail, phone: app.contactPhone })
      return created
    })
    logger.info('[Partners] Application received', { partnerId: row.id, name: app.name, state: app.state })
    return success({ message: PARTNER_APPLY_SUCCESS }, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
