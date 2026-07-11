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

  if (err instanceof Error) {
    console.error('[API Error]', err.message, err.stack)
  } else {
    console.error('[API Error] Unknown:', err)
  }

  return apiError('Internal server error', 500, 'INTERNAL_ERROR')
}
