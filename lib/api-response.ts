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
export function apiError(message: string, status = 400, code?: string) {
  return NextResponse.json(
    { success: false, error: { message, ...(code && { code }) } },
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
