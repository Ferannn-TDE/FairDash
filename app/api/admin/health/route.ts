import { NextResponse } from 'next/server'
import { requireStrictAdminAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { runHealthChecks } from '@/lib/health'
import { isVendorReadinessEnforced } from '@/lib/vendor-readiness'
import { isPreviewBypassEnabled } from '@/lib/preview-access'

// GET /api/admin/health — the full report, for platform admins only. The public /api/health
// carries just the verdict, per-component ok/fail and the deploy SHAs.
export async function GET() {
  try {
    await requireStrictAdminAuth()
    const health = await runHealthChecks()
    return NextResponse.json({
      status: health.status,
      timestamp: new Date().toISOString(),
      commit: process.env.COMMIT_SHA ?? 'unknown',
      checks: {
        database: health.database,
        redis: health.redis,
        // Sweep heartbeat (lastSweepAt, ageSec), the worker's own SHA, and the role-reconcile
        // status: on/off, plus the last run's Clerk user count, which shows the worker holds the
        // right Clerk instance's key without exposing it.
        worker: health.worker,
        // Migrations this build expects that the database hasn't applied: names and count here,
        // ok/fail only on the public endpoint.
        migrations: { status: health.migrations.status, pendingCount: health.migrations.pending.length, pending: health.migrations.pending, readError: health.migrations.readError ?? null },
      },
      // EFFECTIVE feature flags, per environment. Surfaced because a customer-facing filter
      // (vendor readiness) was set true locally and unset in prod and nothing made the drift
      // visible. previewBypass is temporary preview scaffolding; access also needs an admin
      // session, which this endpoint does not report.
      flags: {
        enforceVendorReadiness: isVendorReadinessEnforced(),
        previewBypass: isPreviewBypassEnabled(),
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
