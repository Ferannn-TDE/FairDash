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

/**
 * THE WORKER'S OWN FINGERPRINT — a SECOND key, deliberately NOT folded into the one above.
 *
 * `commit` in /api/health is baked at Vercel BUILD time, so it is the WEB APP's SHA. The worker
 * is a separate Railway deployment and the `worker` block proved only liveness (lastSweepAt),
 * never version. One fingerprint for two deployments, belonging to the one that was not in
 * question — which is exactly why "did the worker pick up this push?" was unanswerable outside
 * Railway's UI. **fingerprint-over-git-ref has to cover both deployments, or it covers neither.**
 *
 * WHY A SEPARATE KEY rather than making the heartbeat a JSON object: the heartbeat value is
 * currently a BARE ISO STRING, and web (reader) and worker (writer) deploy independently, in
 * either order. Changing the value's shape breaks the pair in one of those orders — a new
 * worker writing JSON to an old reader yields `new Date('{"…"}')` → Invalid → ageSec null →
 * `worker: unknown`. That silently blinds the liveness signal, which is the single check
 * standing between us and "a dead worker looks like a calm day", days before a live fair.
 * Adding a key is purely additive: OLD readers are untouched in BOTH directions, and a new
 * reader that finds no commit key reports `null` — honestly unknown, never wrong. The
 * fingerprint is worth having; it is not worth risking the liveness signal to get.
 */
const WORKER_COMMIT_KEY = 'fairsynq:heartbeat:reconcile-sweep:commit'

/**
 * Railway injects RAILWAY_GIT_COMMIT_SHA. Same variable `next.config.mjs:11` already falls back
 * to for the web build, so the name is corroborated by existing code rather than assumed here.
 * 'unknown' is the honest answer, never a fabricated or stale value — and it is MEANINGFUL: it
 * says the worker is running a build with no git provenance (a local run, a detached deploy, or
 * an injection that did not happen), which is itself worth seeing in /api/health.
 */
export const WORKER_COMMIT: string = (process.env.RAILWAY_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'unknown'

export type ServiceCheck = 'ok' | 'error' | 'unreachable' | 'not_configured'
export interface HealthReport {
  status: 'ok' | 'degraded'
  database: ServiceCheck
  redis: ServiceCheck
  worker: {
    status: 'ok' | 'stale' | 'unknown'
    lastSweepAt: string | null
    ageSec: number | null
    /** The WORKER's SHA — separate deployment, separate fingerprint. null ⇒ not reported yet. */
    commit: string | null
  }
}

/** PURE — the verdict, from raw check results. Testable with no live infra. */
export function computeHealth(input: {
  database: ServiceCheck
  redis: ServiceCheck
  lastSweepAt: string | null
  /** Absent/undefined ⇒ pre-fingerprint worker or unreadable Redis; reported as null. */
  workerCommit?: string | null
  nowMs?: number
}): HealthReport {
  const now = input.nowMs ?? Date.now()
  const parsed = input.lastSweepAt ? new Date(input.lastSweepAt).getTime() : NaN
  const ageSec = Number.isFinite(parsed) ? Math.round((now - parsed) / 1000) : null
  const worker = {
    status: (ageSec == null ? 'unknown' : ageSec <= WORKER_STALE_SEC ? 'ok' : 'stale') as 'ok' | 'stale' | 'unknown',
    lastSweepAt: ageSec == null ? null : input.lastSweepAt,
    ageSec,
    // NOT gated on liveness: a STALE worker's last-known SHA is precisely what you want when
    // diagnosing why it went stale (did the deploy that killed it ever land?).
    commit: input.workerCommit ?? null,
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
  try {
    await r.connect()
    // Liveness FIRST and in its ORIGINAL bare-ISO shape — unchanged, so every existing reader
    // keeps working. The fingerprint is a separate, second write: if it fails, /api/health
    // reports commit=null while liveness stays correct. Never the other way round.
    await r.set(HEARTBEAT_KEY, new Date().toISOString())
    await r.set(WORKER_COMMIT_KEY, WORKER_COMMIT)
  }
  catch { /* best-effort — the sweep's own logging surfaces real Redis trouble */ }
  finally { r.disconnect() }
}

/** IO — gather the raw check results (DB + one Redis client for PING and the heartbeat read). */
export async function runHealthChecks(): Promise<HealthReport> {
  const database: ServiceCheck = await db.$queryRaw`SELECT 1`.then(() => 'ok' as const).catch(() => 'error' as const)

  let redis: ServiceCheck = 'not_configured'
  let lastSweepAt: string | null = null
  let workerCommit: string | null = null
  const r = redisClient()
  if (r) {
    try {
      await r.connect()
      await r.ping()
      redis = 'ok'
      // One round trip. A worker that predates the fingerprint returns null for the second key,
      // which is the honest reading — not an error, and not a guess at the web app's SHA.
      const [sweep, commit] = await r.mget(HEARTBEAT_KEY, WORKER_COMMIT_KEY)
      lastSweepAt = sweep
      workerCommit = commit
    } catch {
      redis = 'unreachable'
    } finally {
      r.disconnect()
    }
  }

  return computeHealth({ database, redis, lastSweepAt, workerCommit })
}
