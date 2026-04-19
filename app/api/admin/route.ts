import { NextResponse } from 'next/server'

// GET /api/admin — redirects to /api/admin/events for convenience
export async function GET() {
  return NextResponse.json({ message: 'Admin API — use /api/admin/events/[id]/dashboard for event stats' })
}
