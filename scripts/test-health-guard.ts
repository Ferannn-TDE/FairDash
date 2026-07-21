/**
 * HEALTH GUARD (rider 3) — the /api/health verdict logic. computeHealth is PURE (raw check
 * results → report), so the classification is proven with no live infra (the IO wrappers around
 * it are thin). The point of interest is the worker heartbeat: a STALE sweep must read as
 * degraded — that's "a dead worker looks like a calm day", closed.
 *
 * Run:  npx tsx scripts/test-health-guard.ts
 */

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

  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} health-guard: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
