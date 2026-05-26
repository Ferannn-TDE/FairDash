import { NextResponse } from 'next/server'
import { getOrderQueue } from '@/lib/queues'

// GET /api/health/queues
// Returns job counts for all active queues. Used by uptime monitors and
// the admin dashboard to surface backlog / stalled jobs without hitting Redis directly.
export async function GET() {
  try {
    const queue = getOrderQueue()

    if (!queue) {
      return NextResponse.json(
        { status: 'degraded', reason: 'Redis unavailable — queue not initialized' },
        { status: 503 }
      )
    }

    const counts = await queue.getJobCounts()

    return NextResponse.json({
      status: 'ok',
      queues: {
        orders: counts,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { status: 'error', error: String(err) },
      { status: 503 }
    )
  }
}
