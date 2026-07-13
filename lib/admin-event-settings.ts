import { ApiError } from './api-error'

/**
 * Build the Event update for the admin settings PATCH — the SAFE-FIELD ALLOWLIST.
 *
 * This is the load-bearing safety boundary of the settings route, extracted so it can be
 * proven directly (a malicious body must not be able to write status/isPaused/etc.). It
 * builds the update by explicitly PICKING known-safe fields; the body is never spread, so an
 * extra field in the payload is silently ignored rather than written.
 *
 * ALLOWED (presentation / logistics): name, startDate, endDate, eventLat, eventLng,
 *   serviceChargeEnabled, serviceChargeAmount.
 * FORBIDDEN by construction (never picked): status, isPaused, archivedAt, organizerId,
 *   urlSlug — identity/ownership, or with their own gated routes (pause, status).
 *
 * @param body     the request body (untrusted)
 * @param current  the resolved fair's current start/end (for the cross-field end≥start check)
 * @returns a Prisma-ready `data` object containing ONLY allowed, validated fields
 */
export function buildSafeSettingsUpdate(
  body: Record<string, unknown>,
  current: { startDate: Date; endDate: Date },
): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) throw new ApiError('Event name cannot be empty', 400, 'VALIDATION_ERROR')
    data.name = name
  }
  if (body.startDate !== undefined) {
    const d = new Date(String(body.startDate))
    if (isNaN(d.getTime())) throw new ApiError('startDate is not a valid date', 400, 'VALIDATION_ERROR')
    data.startDate = d
  }
  if (body.endDate !== undefined) {
    const d = new Date(String(body.endDate))
    if (isNaN(d.getTime())) throw new ApiError('endDate is not a valid date', 400, 'VALIDATION_ERROR')
    data.endDate = d
  }

  const lat = optNum(body.eventLat, 'Latitude', { min: -90, max: 90 })
  if (lat !== undefined) data.eventLat = lat
  const lng = optNum(body.eventLng, 'Longitude', { min: -180, max: 180 })
  if (lng !== undefined) data.eventLng = lng

  if (body.serviceChargeEnabled !== undefined) data.serviceChargeEnabled = Boolean(body.serviceChargeEnabled)
  const amt = optNum(body.serviceChargeAmount, 'Service charge', { min: 0, max: 100 })
  if (amt !== undefined) data.serviceChargeAmount = amt

  // Cross-field: end must not precede start, using the resulting values.
  const finalStart = (data.startDate as Date | undefined) ?? current.startDate
  const finalEnd   = (data.endDate as Date | undefined) ?? current.endDate
  if (finalEnd < finalStart) throw new ApiError('End date cannot be before start date', 400, 'VALIDATION_ERROR')

  if (Object.keys(data).length === 0) {
    throw new ApiError('No editable fields were provided', 400, 'VALIDATION_ERROR')
  }
  return data
}

/** '' / null / undefined handling: undefined → skip; '' or null → null; else parse+bound. */
function optNum(v: unknown, label: string, opts: { min?: number; max?: number } = {}): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) throw new ApiError(`${label} must be a number`, 400, 'VALIDATION_ERROR')
  if (opts.min !== undefined && n < opts.min) throw new ApiError(`${label} must be ≥ ${opts.min}`, 400, 'VALIDATION_ERROR')
  if (opts.max !== undefined && n > opts.max) throw new ApiError(`${label} must be ≤ ${opts.max}`, 400, 'VALIDATION_ERROR')
  return n
}
