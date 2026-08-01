import { apiError } from './api-response'

/**
 * Structured error class for API route handlers.
 * Throw this anywhere in an API route and catch with handleApiError().
 *
 * @example throw new ApiError('Vendor not found', 404, 'VENDOR_NOT_FOUND')
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR',
    // Optional structured context surfaced to the caller (e.g. per-field validation
    // errors). Additive — existing throw sites are unaffected.
    public details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Top-level error handler for API route handlers.
 * Returns a NextResponse with the appropriate status code.
 *
 * @example
 * export async function GET() {
 *   try {
 *     // ...
 *   } catch (err) {
 *     return handleApiError(err)
 *   }
 * }
 */
export function handleApiError(err: unknown) {
  if (err instanceof ApiError) {
    return apiError(err.message, err.statusCode, err.code, err.details)
  }

  // DB connection-pool exhaustion (Prisma P2024) is a LOAD condition, not a bug in the
  // handler — it must be named and retryable, never an anonymous 500. With connection_limit=1
  // per serverless instance this is the shape overload takes, and a generic INTERNAL_ERROR
  // would send someone hunting a logic bug that isn't there. 503 + Retry-After is the honest
  // answer: the request was never served, and retrying is the correct client behaviour.
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2024') {
    console.error('[API Error] DB pool timeout (P2024) — connection pool exhausted under load')
    return apiError(
      'Server is busy — please retry in a moment',
      503,
      'DB_POOL_TIMEOUT',
    )
  }

  // Unique-constraint violation (Prisma P2002). Named, with the colliding column, because the
  // anonymous version cost a live debugging session: /onboarding died on a P2002 for `email`
  // and surfaced as an opaque 500 + digest, with the one fact that identified the bug — WHICH
  // column collided — visible only in the platform logs. 409 is the honest status: the request
  // was well-formed and conflicted with existing state.
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
    const target = (err as { meta?: { target?: unknown } }).meta?.target
    const fields = Array.isArray(target) ? (target as string[]).join(', ') : String(target ?? 'unknown')
    console.error('[API Error] Unique constraint violation (P2002) on:', fields)
    return apiError(`Already exists — conflicting field(s): ${fields}`, 409, 'UNIQUE_CONSTRAINT')
  }

  if (err instanceof Error) {
    console.error('[API Error]', err.message, err.stack)
  } else {
    console.error('[API Error] Unknown:', err)
  }

  return apiError('Internal server error', 500, 'INTERNAL_ERROR')
}
