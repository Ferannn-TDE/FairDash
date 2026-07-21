import { NextResponse } from 'next/server'
import { runHealthChecks } from '@/lib/health'

// GET /api/health — real measurements, not stubs. Returns 200 when healthy, 503 when degraded,
// so an external dead-man's-switch monitor can watch it directly. The `commit` field remains the
// deploy fingerprint. `worker` is the reconcile-sweep heartbeat: a stale one is a dead/stuck
// worker — the failure that used to look like a calm day.
export async function GET() {
  const health = await runHealthChecks()
  return NextResponse.json(
    {
      status: health.status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      checks: {
        database: health.database,
        redis: health.redis,
        worker: health.worker,
      },
    },
    { status: health.status === 'ok' ? 200 : 503 },
  )
}
