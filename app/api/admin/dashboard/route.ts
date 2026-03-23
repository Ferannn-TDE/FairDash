import { NextResponse } from 'next/server'

// GET /api/admin/dashboard
// Returns live event stats: active orders, revenue, vendor statuses, driver GPS.
// Requires super-admin or event-operator role.
// Implementation: Part 5 (Admin portal)
export async function GET() {
  return NextResponse.json(
    { error: 'Not implemented — coming in Part 5 (Admin portal)' },
    { status: 501 }
  )
}
