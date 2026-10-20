/**
 * HEALTH GUARD (rider 3) — the /api/health verdict logic. computeHealth is PURE (raw check
 * results → report), so the classification is proven with no live infra (the IO wrappers around
 * it are thin). The point of interest is the worker heartbeat: a STALE sweep must read as
 * degraded — that's "a dead worker looks like a calm day", closed.
 *
 * Run:  npx tsx scripts/test-health-guard.ts
 */

import { readFileSync, existsSync } from 'node:fs'
import { computeHealth, resolveWorkerStaleSec, DEFAULT_WORKER_STALE_SEC, publicHealthBody } from '../lib/health'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const NOW = new Date('2026-07-21T12:00:00Z').getTime()
const agoSec = (s: number) => new Date(NOW - s * 1000).toISOString()

function main() {
  // The default-threshold sections below must not inherit an ambient override.
  delete process.env.HEALTH_WORKER_STALE_SEC

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

  console.log('\n[9] effective feature flags are surfaced to ADMINS (local/prod drift is visible, strangers see nothing)')
  const adminRoute = readFileSync('app/api/admin/health/route.ts', 'utf8')
  assert(/requireStrictAdminAuth\(\)/.test(adminRoute) && adminRoute.indexOf('requireStrictAdminAuth()') < adminRoute.indexOf('runHealthChecks()'),
    'admin health requires a strict admin BEFORE running any check')
  assert(/flags:\s*\{/.test(adminRoute) && /enforceVendorReadiness:\s*isVendorReadinessEnforced\(\)/.test(adminRoute),
    'admin health exposes the effective enforceVendorReadiness — compare it per environment')
  assert(/worker:\s*health\.worker/.test(adminRoute), 'admin health carries the full worker block (sweep age, role reconcile)')

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
  assert(/mget\(HEARTBEAT_KEY, WORKER_COMMIT_KEY, ROLE_RECONCILE_KEY\)/.test(healthSrc), 'all three keys are read in one round trip')

  assert(/publicHealthBody\(health,/.test(route) && /commit: h\.worker\.commit \?\? 'unknown'/.test(healthSrc),
    'the public route still carries the worker\'s own SHA (checks.worker.commit) — the one worker detail strangers keep')

  const workerSrc = readFileSync(new URL('../workers/order-worker.ts', import.meta.url), 'utf8')
  assert(/console\.warn\('\[Worker\] boot'/.test(workerSrc),
    'the worker logs a boot line at console.WARN — console.log is stripped under NODE_ENV=production on Railway')
  assert(/\[Worker\] boot'[\s\S]{0,60}commit: WORKER_COMMIT/.test(workerSrc),
    'and the boot line carries the SHA — the seam a redeploy leaves in the logs')

  // ── [11] the stale threshold — 180s DEFAULT pinned, HEALTH_WORKER_STALE_SEC honoured ─────
  // The heartbeat is written once per sweep; when WORKER_SWEEP_INTERVAL_MS rises (Upstash
  // throttle) the threshold must follow or a healthy-but-slower worker reads as dead.
  console.log('\n[11] stale threshold: 180s default, overridable by HEALTH_WORKER_STALE_SEC')
  assert(DEFAULT_WORKER_STALE_SEC === 180, 'the default is still 180s (3× the default 60s sweep)')
  assert(resolveWorkerStaleSec({}) === 180, 'unset → 180')
  assert(resolveWorkerStaleSec({ HEALTH_WORKER_STALE_SEC: '' }) === 180, 'empty → 180')
  // POSITIVE CONTROL first: with the default, a 300s-old heartbeat IS stale — so the override
  // below is shown to CHANGE the verdict, not to agree with one that was already 'ok'.
  assert(computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(300), nowMs: NOW }).worker.status === 'stale',
    'control: 300s with the default threshold → stale')
  process.env.HEALTH_WORKER_STALE_SEC = '360'
  try {
    assert(resolveWorkerStaleSec() === 360, 'HEALTH_WORKER_STALE_SEC=360 is read from process.env')
    assert(computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(300), nowMs: NOW }).worker.status === 'ok',
      'with 360: 300s → ok (the env var changed the verdict)')
    assert(computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(360), nowMs: NOW }).worker.status === 'ok', 'with 360: 360s boundary → ok')
    const s361 = computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(361), nowMs: NOW })
    assert(s361.worker.status === 'stale' && s361.status === 'degraded', 'with 360: 361s → stale + degraded')
  } finally {
    delete process.env.HEALTH_WORKER_STALE_SEC
  }
  for (const bad of ['abc', '0', '-5', '12.5', 'Infinity']) {
    assert(resolveWorkerStaleSec({ HEALTH_WORKER_STALE_SEC: bad }) === 180, `invalid "${bad}" → 180 (never "never stale")`)
  }
  assert(computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(181), nowMs: NOW }).worker.status === 'stale',
    'after the override is cleared, 181s is stale again (no leaked state)')

  // ── [11] PUBLIC BODY IS MINIMAL (2026-10-20) ──────────────────────────────────────────────
  // /api/health is public. It showed feature flags, sweep timing and — once 1.9 shipped — how
  // many users the Clerk instance has. Strangers get the verdict, each component's ok/fail and
  // the two deploy SHAs; everything else is /api/admin/health.
  console.log('\n[11] the PUBLIC health body: verdict, per-component ok/fail, SHAs — nothing else')
  const rich = computeHealth({
    database: 'ok', redis: 'ok', lastSweepAt: agoSec(5), workerCommit: 'abc1234', nowMs: NOW,
    roleReconcile: JSON.stringify({ state: 'on', at: agoSec(5), lastRun: { at: agoSec(5), clerkUsers: 22, usersToUpdate: 2, missing: { runner: 2 }, updated: 2, errors: 0 } }),
  })
  const pub = publicHealthBody(rich, 'def5678')
  const ALLOWED_KEYS = new Set(['status', 'commit', 'checks', 'database', 'redis', 'worker'])
  const ALLOWED_VALUES = new Set(['ok', 'degraded', 'fail', 'off', 'unknown', 'abc1234', 'def5678'])
  const leaks: string[] = []
  const walk = (v: unknown, path: string) => {
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) { if (!ALLOWED_KEYS.has(k)) leaks.push(`${path}.${k}`); walk(x, `${path}.${k}`) }
    } else if (typeof v === 'number') leaks.push(`${path}=${v} (a number)`)
    else if (!ALLOWED_VALUES.has(String(v))) leaks.push(`${path}=${String(v)}`)
  }
  walk(pub, 'body')
  assert(leaks.length === 0, `public body has only allowed keys and values, no numbers${leaks.length ? ` — leaks: ${leaks.join(', ')}` : ''}`)
  assert(JSON.stringify(pub) === JSON.stringify({ status: 'ok', commit: 'def5678', checks: { database: 'ok', redis: 'ok', worker: { status: 'ok', commit: 'abc1234' } } }),
    `public body is exactly the minimal shape (got ${JSON.stringify(pub)})`)
  // Positive control on the leak walker: the full report must trip it.
  const before = leaks.length
  walk(rich, 'rich')
  assert(leaks.length > before, 'positive control: the full internal report DOES trip the leak check (counts, timings)')
  const failing = publicHealthBody(computeHealth({ database: 'error', redis: 'unreachable', lastSweepAt: agoSec(9999), nowMs: NOW }), 'def5678')
  assert(failing.status === 'degraded' && failing.checks.database === 'fail' && failing.checks.redis === 'fail' && failing.checks.worker.status === 'fail',
    'failures read as "fail" (stale worker included) and the verdict stays degraded')
  assert(publicHealthBody(computeHealth({ database: 'ok', redis: 'not_configured', lastSweepAt: null, nowMs: NOW }), 'x').checks.redis === 'off',
    'Redis not configured reads "off", not "fail"')
  assert(/publicHealthBody\(/.test(route) && !/isVendorReadinessEnforced|isPreviewBypassEnabled|health\.worker\b|timestamp|version/.test(route.replace(/\/\/.*$/gm, '')),
    'the public route sends only publicHealthBody — no flags, no worker internals, no timestamp/version')

  assert(!existsSync('app/api/health/queues/route.ts'), 'no public queue-counts route (/api/health/queues is gone)')
  const queuesAdmin = readFileSync('app/api/admin/health/queues/route.ts', 'utf8')
  assert(queuesAdmin.indexOf('requireStrictAdminAuth()') >= 0 && queuesAdmin.indexOf('requireStrictAdminAuth()') < queuesAdmin.indexOf('queueHealth()'),
    'queue counts are behind a strict admin check, run before the counts are read')

  // Role reconcile status (readiness 1.9): parsed through, garbage → null, absent → null.
  const rr = { state: 'on', at: agoSec(5), lastRun: { at: agoSec(5), clerkUsers: 22, usersToUpdate: 2, missing: { runner: 2 }, updated: 2, errors: 0 } }
  const hr = computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(5), roleReconcile: JSON.stringify(rr), nowMs: NOW })
  assert(hr.worker.roleReconcile?.state === 'on' && hr.worker.roleReconcile?.lastRun?.clerkUsers === 22, 'role reconcile status is reported (state + Clerk user count)')
  assert(computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(5), roleReconcile: '{not json', nowMs: NOW }).worker.roleReconcile === null, 'unparseable role status → null, never a crash')
  assert(computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: agoSec(5), nowMs: NOW }).worker.roleReconcile === null, 'no role status yet → null')

  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} health-guard: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
