import { NextResponse } from 'next/server'

// GET /api/admin   — top-level admin info (redirect to /api/admin/dashboard)
// Implementation: Part 5 (Admin portal)
export async function GET() {
  return NextResponse.json(
    { error: 'Not implemented — coming in Part 5 (Admin portal)' },
    { status: 501 }
  )
}
