import { NextResponse } from 'next/server'
import { requireStrictAdminAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { queueHealth } from '@/lib/health'

// GET /api/admin/health/queues — job counts for the order queue, for platform admins only.
// (Was the public /api/health/queues until 2026-10-20: it showed strangers order-volume counts.)
export async function GET() {
  try {
    await requireStrictAdminAuth()
    const { httpStatus, body } = await queueHealth()
    return NextResponse.json(body, { status: httpStatus })
  } catch (err) {
    return handleApiError(err)
  }
}
