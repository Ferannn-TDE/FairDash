import { NextResponse } from 'next/server'
import { runHealthChecks } from '@/lib/health'
import { isVendorReadinessEnforced } from '@/lib/vendor-readiness'

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
      // COMMIT_SHA is baked at build time by next.config.mjs (fallback chain ending in
      // 'unknown') — never read the Vercel var at runtime here; it is null on non-git deploys.
      commit: process.env.COMMIT_SHA ?? 'unknown',
      checks: {
        database: health.database,
        redis: health.redis,
        worker: health.worker,
      },
      // EFFECTIVE feature flags — the runtime value, per environment. Surfaced because a
      // customer-facing filter (vendor readiness) was set true locally and unset in prod, so the
      // public site listed vendors who can't take payment while local hid them, and nothing made
      // the drift visible. A boolean env value is not a secret; a `curl /api/health` on each
      // environment now shows whether they agree.
      flags: {
        enforceVendorReadiness: isVendorReadinessEnforced(),
      },
    },
    { status: health.status === 'ok' ? 200 : 503 },
  )
}
