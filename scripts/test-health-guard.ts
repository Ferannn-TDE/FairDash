/**
 * HEALTH GUARD (rider 3) — the /api/health verdict logic. computeHealth is PURE (raw check
 * results → report), so the classification is proven with no live infra (the IO wrappers around
 * it are thin). The point of interest is the worker heartbeat: a STALE sweep must read as
 * degraded — that's "a dead worker looks like a calm day", closed.
 *
 * Run:  npx tsx scripts/test-health-guard.ts
 */

import { readFileSync } from 'node:fs'
import { computeHealth } from '../lib/health'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const NOW = new Date('2026-07-21T12:00:00Z').getTime()
const agoSec = (s: number) => new Date(NOW - s * 1000).toISOString()

function main() {
  // ── [1] all healthy + a fresh sweep ─────────────────────────────────────────
  console.log('[1] everything up + a fresh heartbeat → ok')
  const h1 = computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(30), nowMs: NOW })
  assert(h1.status === 'ok', 'status ok')
  assert(h1.worker.status === 'ok', 'worker ok')
  assert(h1.worker.ageSec === 30, 'worker age computed (30s)')

  // ── [2] DB down → degraded ──────────────────────────────────────────────────
  console.log('\n[2] database error → degraded')
  const h2 = computeHealth({ database: 'error', redis: 'ok', lastSweepAt: agoSec(10), nowMs: NOW })
  assert(h2.status === 'degraded', 'degraded on DB error')

  // ── [3] Redis unreachable → degraded ────────────────────────────────────────
  console.log('\n[3] redis unreachable → degraded')
  const h3 = computeHealth({ database: 'ok', redis: 'unreachable', lastSweepAt: null, nowMs: NOW })
  assert(h3.status === 'degraded', 'degraded on redis unreachable')

  // ── [4] THE ONE THAT MATTERS — a stale worker → degraded ────────────────────
  console.log('\n[4] a stale sweep heartbeat → degraded (dead worker no longer looks calm)')
  const stale = computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(600), nowMs: NOW }) // 10m > 180s
  assert(stale.worker.status === 'stale', 'worker reads stale at 10m')
  assert(stale.status === 'degraded', 'a live DB + Redis but a dead worker is DEGRADED, not ok')

  // ── [5] cold start (no heartbeat yet) → unknown, but not a false alarm ──────
  console.log('\n[5] no heartbeat yet (cold start) → worker unknown, status still ok')
  const cold = computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: null, nowMs: NOW })
  assert(cold.worker.status === 'unknown', 'worker unknown when no heartbeat exists')
  assert(cold.worker.ageSec === null && cold.worker.lastSweepAt === null, 'no age/timestamp when unknown')
  assert(cold.status === 'ok', 'unknown does NOT cry wolf on a cold start (only stale degrades)')

  // ── [6] staleness boundary — exactly at the threshold is still ok ───────────
  console.log('\n[6] the 180s staleness boundary')
  assert(computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(180), nowMs: NOW }).worker.status === 'ok', 'at 180s → still ok')
  assert(computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(181), nowMs: NOW }).worker.status === 'stale', 'at 181s → stale')

  // ── [7] a garbage timestamp is treated as unknown, never a crash ────────────
  console.log('\n[7] an unparseable heartbeat is unknown, not a throw')
  const bad = computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: 'not-a-date', nowMs: NOW })
  assert(bad.worker.status === 'unknown' && bad.worker.ageSec === null, 'garbage timestamp → unknown')

  // ── [8] fingerprint honesty — the commit field can never silently be null ───
  // Source-shape invariant (same style as the admin grep invariant): the SHA is baked at BUILD
  // time in next.config.mjs, and the route reads the baked value with an 'unknown' fallback. A
  // runtime read of the Vercel var went null on a non-git deploy — the regression this pins shut.
  console.log('\n[8] deploy fingerprint is build-time-baked and never null')
  const route = readFileSync(new URL('../app/api/health/route.ts', import.meta.url), 'utf8')
  const config = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8')
  assert(/COMMIT_SHA:\s*commitSha/.test(config) && config.includes("'unknown'"), 'next.config bakes COMMIT_SHA with an unknown-terminated fallback chain')
  assert(route.includes("process.env.COMMIT_SHA ?? 'unknown'"), "route reads the baked COMMIT_SHA, falling back to 'unknown'")
  assert(!route.includes('VERCEL_GIT_COMMIT_SHA') && !route.includes('?? null'), 'route has NO runtime Vercel-var read and NO null fallback (the regression path)')

  console.log('\n[9] effective feature flags are surfaced (local/prod drift is visible)')
  assert(/flags:\s*\{/.test(route) && /enforceVendorReadiness:\s*isVendorReadinessEnforced\(\)/.test(route),
    'health exposes the effective enforceVendorReadiness — a curl on each env shows whether they agree')

  // ── [10] THE WORKER'S OWN FINGERPRINT — two deployments, two SHAs ──────────────────────
  // `commit` above is baked at Vercel BUILD time: it is the WEB APP's SHA. The worker is a
  // separate Railway deployment, and its block reported liveness only — so "did the worker pick
  // up that push?" was unanswerable outside Railway's UI, and a green health check with a fresh
  // commit was true in a narrow sense and misleading in a wider one.
  console.log('\n[10] the worker reports its OWN commit — a matching web SHA says nothing about it')
  const withCommit = computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(5), workerCommit: 'abc1234', nowMs: NOW })
  assert(withCommit.worker.commit === 'abc1234', 'worker.commit surfaces the value the worker itself wrote')
  assert(withCommit.status === 'ok', 'and reporting a commit does not disturb the verdict')

  // The honest-unknown case: a worker deployed BEFORE this feature writes no commit key.
  const preFingerprint = computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(5), nowMs: NOW })
  assert(preFingerprint.worker.commit === null,
    'a worker that predates the fingerprint reports null — honestly unknown, never guessed')
  assert(preFingerprint.worker.status === 'ok',
    'and is still reported ALIVE — the fingerprint is additive, it cannot break liveness')

  // A stale worker's last-known SHA is exactly what you want when diagnosing why it went stale.
  const staleWithCommit = computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(9999), workerCommit: 'dead999', nowMs: NOW })
  assert(staleWithCommit.worker.status === 'stale' && staleWithCommit.worker.commit === 'dead999',
    'a STALE worker still reports its commit (did the deploy that killed it ever land?)')

  const healthSrc = readFileSync(new URL('../lib/health.ts', import.meta.url), 'utf8')
  assert(/RAILWAY_GIT_COMMIT_SHA/.test(healthSrc) && /\|\| 'unknown'/.test(healthSrc),
    "WORKER_COMMIT reads RAILWAY_GIT_COMMIT_SHA with an 'unknown' fallback (never a fabricated SHA)")
  // FORMAT PARITY — the two fingerprints exist to be compared, and the comparison someone will
  // actually write is `.commit === .checks.worker.commit`. A full-vs-short pair fails that while
  // the deployments agree; a drift check that cries wolf gets muted.
  assert(!/RAILWAY_GIT_COMMIT_SHA[^\n]*slice\(/.test(healthSrc),
    'worker.commit is NOT truncated — same 40-char form as .commit, so a naive equality check is correct')
  assert(/WORKER_COMMIT_KEY\s*=\s*'fairsynq:heartbeat:reconcile-sweep:commit'/.test(healthSrc),
    'the fingerprint lives on its OWN key, not folded into the heartbeat value')
  // THE TRANSITION-SAFETY PROPERTY, and the reason this is a second key. Web and worker deploy
  // independently, in either order. If the heartbeat VALUE became JSON, an old reader would do
  // new Date('{"…"}') → Invalid → ageSec null → worker 'unknown', silently blinding the one
  // check that stands between us and "a dead worker looks like a calm day".
  assert(/r\.set\(HEARTBEAT_KEY, new Date\(\)\.toISOString\(\)\)/.test(healthSrc),
    '⛔ the heartbeat value is STILL a bare ISO string — changing its shape would blind old readers mid-deploy')
  assert(healthSrc.indexOf('r.set(HEARTBEAT_KEY') < healthSrc.indexOf('r.set(WORKER_COMMIT_KEY'),
    'liveness is written FIRST — if the fingerprint write fails, liveness still lands')
  assert(/mget\(HEARTBEAT_KEY, WORKER_COMMIT_KEY\)/.test(healthSrc), 'both keys are read in one round trip')

  assert(/worker:\s*health\.worker/.test(route), 'the route passes the whole worker block through, so commit reaches the JSON')

  const workerSrc = readFileSync(new URL('../workers/order-worker.ts', import.meta.url), 'utf8')
  assert(/console\.warn\('\[Worker\] boot'/.test(workerSrc),
    'the worker logs a boot line at console.WARN — console.log is stripped under NODE_ENV=production on Railway')
  assert(/\[Worker\] boot'[\s\S]{0,60}commit: WORKER_COMMIT/.test(workerSrc),
    'and the boot line carries the SHA — the seam a redeploy leaves in the logs')

  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} health-guard: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
