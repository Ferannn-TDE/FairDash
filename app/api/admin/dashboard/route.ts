import { NextResponse } from 'next/server'

// GET /api/admin/dashboard — legacy stub, use /api/admin/events/[id]/dashboard instead
export async function GET() {
  return NextResponse.json(
    { success: false, error: { message: 'Use /api/admin/events/[id]/dashboard for event-specific stats', code: 'NOT_FOUND' } },
    { status: 301 }
  )
}
