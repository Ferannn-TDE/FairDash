import { NextRequest } from 'next/server'
import { RunnerStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { diffProfileChanges } from '@/lib/runner-profile-log'

// GET  /api/runners/me  — return the authenticated user's Runner record + event
// PATCH /api/runners/me — update runner status (ACTIVE | OFFLINE)

export async function GET() {
  try {
    const clerkId = await requireAuth()
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const runner = await db.runner.findUnique({
      where: { userId: dbUser.id },
      include: {
        event: {
          select: { id: true, name: true, urlSlug: true, status: true },
        },
      },
    })

    if (!runner) return apiError('No runner record found for this user', 404, 'RUNNER_NOT_FOUND')

    return success({ runner })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const clerkId = await requireAuth()
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const runner = await db.runner.findUnique({ where: { userId: dbUser.id } })
    if (!runner) return apiError('No runner record found', 404, 'RUNNER_NOT_FOUND')

    const body = await req.json() as Record<string, unknown>

    // The endpoint serves two write shapes: the online/offline STATUS flip, and the
    // runner's SETTINGS (vehicle / notifications / availability / contact phone). A
    // request may carry either or both. Every field is whitelisted — no mass-assign.
    const data: Record<string, unknown> = {}

    // ── Status (optional) ──────────────────────────────────────────────────────
    if ('status' in body) {
      const status = body.status as RunnerStatus
      if (!status || !Object.values(RunnerStatus).includes(status)) {
        throw new ApiError(`status must be one of: ${Object.values(RunnerStatus).join(', ')}`, 400, 'VALIDATION_ERROR')
      }
      // Runners on active delivery cannot go OFFLINE
      if (runner.status === RunnerStatus.ON_DELIVERY && status === RunnerStatus.OFFLINE) {
        throw new ApiError('Cannot go offline while on an active delivery', 409, 'RUNNER_ON_DELIVERY')
      }
      // Approval gate: only an APPROVED runner may leave OFFLINE. Going OFFLINE is
      // always allowed (a PENDING/REJECTED runner can still be off-shift).
      if (status !== RunnerStatus.OFFLINE && runner.approvalStatus !== 'APPROVED') {
        throw new ApiError('Your runner account is awaiting admin approval', 403, 'RUNNER_NOT_APPROVED')
      }
      data.status = status
    }

    // ── Settings (all optional) ────────────────────────────────────────────────
    // Nullable free-text: trim, cap length, empty → null. Only assign if the key
    // was actually present, so a partial PATCH never clobbers unrelated fields.
    const STRING_FIELDS = ['phone', 'vehicleMake', 'vehicleModel', 'vehicleColor', 'vehiclePlate'] as const
    for (const key of STRING_FIELDS) {
      if (!(key in body)) continue
      const raw = body[key]
      if (raw !== null && typeof raw !== 'string') {
        throw new ApiError(`${key} must be a string or null`, 400, 'VALIDATION_ERROR')
      }
      const trimmed = typeof raw === 'string' ? raw.trim().slice(0, 120) : ''
      data[key] = trimmed.length ? trimmed : null
    }

    const BOOL_FIELDS = ['notifyNewDelivery', 'notifyOrderUpdates', 'notifyEarnings'] as const
    for (const key of BOOL_FIELDS) {
      if (!(key in body)) continue
      if (typeof body[key] !== 'boolean') {
        throw new ApiError(`${key} must be a boolean`, 400, 'VALIDATION_ERROR')
      }
      data[key] = body[key]
    }

    // Availability — array of weekday short-names, whitelisted + deduped, order fixed.
    if ('availableDays' in body) {
      const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      const raw = body.availableDays
      if (!Array.isArray(raw) || raw.some(d => typeof d !== 'string')) {
        throw new ApiError('availableDays must be an array of weekday strings', 400, 'VALIDATION_ERROR')
      }
      const set = new Set(raw as string[])
      const invalid = [...set].filter(d => !WEEKDAYS.includes(d))
      if (invalid.length) {
        throw new ApiError(`availableDays contains invalid day(s): ${invalid.join(', ')}`, 400, 'VALIDATION_ERROR')
      }
      data.availableDays = WEEKDAYS.filter(d => set.has(d)) // canonical order
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError('No updatable fields provided', 400, 'VALIDATION_ERROR')
    }

    // Append-only audit of profile-identity edits (phone + vehicle), old → new. Computed from
    // the pre-update runner row vs. the incoming patch, and written in the SAME transaction as
    // the update so the log can never disagree with the row. PII-bearing → Pattern W purges it
    // 180d after the event ends (lib/runner-profile-log). notify*/availableDays are settings,
    // not identity, so they are not logged.
    const changes = diffProfileChanges(runner.id, runner as Record<string, unknown>, data)

    const updated = await db.$transaction(async tx => {
      const u = await tx.runner.update({
        where: { id: runner.id },
        data,
        include: { event: { select: { id: true, name: true, urlSlug: true } } },
      })
      if (changes.length) await tx.runnerProfileChange.createMany({ data: changes })
      return u
    })

    return success({ runner: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
