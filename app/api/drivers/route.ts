import { NextResponse } from 'next/server'

// GET  /api/drivers           — list available drivers (admin/dispatch only)
// POST /api/drivers           — register a new driver (from BecomeDriver form)
// Implementation: Part 4 (Driver system)
export async function GET() {
  return NextResponse.json(
    { error: 'Not implemented — coming in Part 4 (Driver system)' },
    { status: 501 }
  )
}

export async function POST() {
  return NextResponse.json(
    { error: 'Not implemented — coming in Part 4 (Driver system)' },
    { status: 501 }
  )
}
