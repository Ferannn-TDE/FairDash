import { NextResponse } from 'next/server'

/**
 * Return a successful JSON response.
 * @example return success({ order }) // 200
 * @example return success({ order }, 201) // 201 Created
 */
export function success<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status })
}

/**
 * Return an error JSON response.
 * @example return error('Order not found', 404, 'ORDER_NOT_FOUND')
 */
// `details` is optional and additive — existing callers are unaffected. It carries
// structured context alongside the human message (e.g. a VALIDATION_ERROR's per-field
// map), so a direct API caller sees every bad field, not just the first.
export function apiError(
  message: string,
  status = 400,
  code?: string,
  details?: unknown
) {
  return NextResponse.json(
    {
      success: false,
      error: { message, ...(code && { code }), ...(details !== undefined && { details }) },
    },
    { status }
  )
}

/**
 * Return a paginated list response.
 */
export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
) {
  return NextResponse.json({
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  })
}
