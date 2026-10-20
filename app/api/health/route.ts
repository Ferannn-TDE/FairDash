import { NextResponse } from 'next/server'
import { runHealthChecks, publicHealthBody } from '@/lib/health'

// GET /api/health — PUBLIC. Real measurements, not stubs: 200 when healthy, 503 when degraded,
// so an external dead-man's-switch monitor can watch it directly.
//
// Strangers get only the verdict, each component's ok/fail, and the two deploy fingerprints:
// `commit` (the web app, baked at build time by next.config.mjs, 'unknown' as the fallback) and
// `checks.worker.commit` (the Railway worker). Sweep timings, the role-reconcile status (with
// Clerk user counts) and the effective feature flags are /api/admin/health only (2026-10-20).
export async function GET() {
  const health = await runHealthChecks()
  return NextResponse.json(
    publicHealthBody(health, process.env.COMMIT_SHA ?? 'unknown'),
    { status: health.status === 'ok' ? 200 : 503 },
  )
}
