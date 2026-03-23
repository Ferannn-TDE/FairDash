import { NextResponse } from 'next/server'

// PATCH /api/drivers/:id/location
// Driver GPS heartbeat — updates driver's real-time position.
// Written to Firebase Realtime DB (not Postgres) for <1s propagation.
// Called every 5 seconds by the driver app when active.
// Implementation: Part 4
export async function PATCH() {
  return NextResponse.json(
    { error: 'Not implemented — coming in Part 4 (Driver system)' },
    { status: 501 }
  )
}
