import IORedis from 'ioredis'
import { db } from './db'

/**
 * Health checks (rider 3) — turn the /api/health stubs into real measurements, and close the
 * worst silent failure: "a dead worker looks like a calm day". Three cheap checks:
 *   - database: a SELECT 1 (is the DB reachable at all).
 *   - redis:    a PING (BullMQ's queue + the sweep depend on it).
 *   - worker:   the sweep writes a heartbeat every run; here we read its age. A stale heartbeat
 *               is a dead/stuck worker — the money engine silently stopped.
 *
 * The heartbeat lives in REDIS (no migration), which also DISAMBIGUATES the two failure modes
 * the tooling detour was about: Redis down → redis='unreachable' + worker='unknown' (can't read);
 * Redis up but the worker process dead → redis='ok' + worker='stale' (timestamp goes old). The
 * pair tells a human WHICH thing died.
 */

const HEARTBEAT_KEY = 'fairsynq:heartbeat:reconcile-sweep'
const WORKER_STALE_SEC = 180 // 3× the 60s sweep — a missed sweep or two is noise; sustained silence is not

export type ServiceCheck = 'ok' | 'error' | 'unreachable' | 'not_configured'
export interface HealthReport {
  status: 'ok' | 'degraded'
  database: ServiceCheck
  redis: ServiceCheck
  worker: { status: 'ok' | 'stale' | 'unknown'; lastSweepAt: string | null; ageSec: number | null }
}

/** PURE — the verdict, from raw check results. Testable with no live infra. */
export function computeHealth(input: {
  database: ServiceCheck
  redis: ServiceCheck
  lastSweepAt: string | null
  nowMs?: number
}): HealthReport {
  const now = input.nowMs ?? Date.now()
  const parsed = input.lastSweepAt ? new Date(input.lastSweepAt).getTime() : NaN
  const ageSec = Number.isFinite(parsed) ? Math.round((now - parsed) / 1000) : null
  const worker = {
    status: (ageSec == null ? 'unknown' : ageSec <= WORKER_STALE_SEC ? 'ok' : 'stale') as 'ok' | 'stale' | 'unknown',
    lastSweepAt: ageSec == null ? null : input.lastSweepAt,
    ageSec,
  }
  // Degraded if the DB is unreachable, Redis is down, or the worker is stale (money engine silent).
  const degraded =
    input.database !== 'ok' ||
    input.redis === 'unreachable' || input.redis === 'error' ||
    worker.status === 'stale'
  return { status: degraded ? 'degraded' : 'ok', database: input.database, redis: input.redis, worker }
}

function redisClient(): IORedis | null {
  const url = process.env.REDIS_URL
  if (!url) return null
  // ioredis parses rediss:// (TLS) from the scheme — proven against Upstash. Fail fast: no
  // retry storms, no offline queue, short connect timeout, so a health check can never hang.
  return new IORedis(url, { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 3000, enableOfflineQueue: false })
}

/** Best-effort: the sweep stamps its heartbeat. A heartbeat write must NEVER break the sweep. */
export async function recordSweepHeartbeat(): Promise<void> {
  const r = redisClient()
  if (!r) return
  try { await r.connect(); await r.set(HEARTBEAT_KEY, new Date().toISOString()) }
  catch { /* best-effort — the sweep's own logging surfaces real Redis trouble */ }
  finally { r.disconnect() }
}

/** IO — gather the raw check results (DB + one Redis client for PING and the heartbeat read). */
export async function runHealthChecks(): Promise<HealthReport> {
  const database: ServiceCheck = await db.$queryRaw`SELECT 1`.then(() => 'ok' as const).catch(() => 'error' as const)

  let redis: ServiceCheck = 'not_configured'
  let lastSweepAt: string | null = null
  const r = redisClient()
  if (r) {
    try {
      await r.connect()
      await r.ping()
      redis = 'ok'
      lastSweepAt = await r.get(HEARTBEAT_KEY)
    } catch {
      redis = 'unreachable'
    } finally {
      r.disconnect()
    }
  }

  return computeHealth({ database, redis, lastSweepAt })
}
