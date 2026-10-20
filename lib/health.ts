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
/**
 * Worker-stale threshold. DEFAULT 180s = 3× the default 60s sweep — a missed sweep or two is
 * noise; sustained silence is not. The heartbeat is written once per sweep, so when the worker's
 * WORKER_SWEEP_INTERVAL_MS is raised this MUST follow (HEALTH_WORKER_STALE_SEC on Vercel, ~3× the
 * interval) or a healthy-but-slower worker reads as dead. Read at call time, so it is testable.
 * An invalid value falls back to the default — never to "never stale", which would re-open
 * "a dead worker looks like a calm day".
 */
export const DEFAULT_WORKER_STALE_SEC = 180
export function resolveWorkerStaleSec(env: Record<string, string | undefined> = process.env): number {
  const raw = env.HEALTH_WORKER_STALE_SEC
  if (raw === undefined || raw.trim() === '') return DEFAULT_WORKER_STALE_SEC
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_WORKER_STALE_SEC
}

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

// Role reconcile status (readiness 1.9): written by the worker at boot (on/off) and after each
// run. Counts only. `clerkUsers` doubles as an instance check — the production Clerk instance
// and a developer's local app have very different user counts, so a worker holding the wrong
// CLERK_SECRET_KEY is visible here without exposing the key.
const ROLE_RECONCILE_KEY = 'fairsynq:heartbeat:role-reconcile'
export interface RoleReconcileStatus {
  state: 'on' | 'off'
  reason?: string
  at: string
  lastRun?: { at: string; clerkUsers: number; usersToUpdate: number; missing: Record<string, number>; updated: number; errors: number }
}

/** Best-effort, like the heartbeat: never breaks the caller. */
export async function recordRoleReconcileStatus(status: RoleReconcileStatus): Promise<void> {
  const r = redisClient()
  if (!r) return
  try {
    await r.connect()
    await r.set(ROLE_RECONCILE_KEY, JSON.stringify(status))
  }
  catch { /* best-effort */ }
  finally { r.disconnect() }
}

function parseRoleReconcile(raw: string | null | undefined): RoleReconcileStatus | null {
  if (!raw) return null
  try { return JSON.parse(raw) as RoleReconcileStatus } catch { return null }
}

/**
 * Railway injects RAILWAY_GIT_COMMIT_SHA. Same variable `next.config.mjs:11` already falls back
 * to for the web build, so the name is corroborated by existing code rather than assumed here.
 * 'unknown' is the honest answer, never a fabricated or stale value — and it is MEANINGFUL: it
 * says the worker is running a build with no git provenance (a local run, a detached deploy, or
 * an injection that did not happen), which is itself worth seeing in /api/health.
 *
 * FORMAT — FULL 40-char SHA, matching `.commit`, deliberately NOT the 7-char short form it
 * shipped as. The two fields are meant to be compared, and the obvious comparison is
 * `.commit === .checks.worker.commit` — which a full-vs-short pair fails while the deployments
 * actually agree. A drift check that cries wolf gets muted, and this one exists to be trusted at
 * 8pm on a fair day. Changed the NEWER field: `.commit` predates this and may be read by an
 * external monitor; `worker.commit` is hours old and consumed by nothing.
 */
export const WORKER_COMMIT: string = process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown'

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
    /** Role reconcile on/off + last run counts. null ⇒ not reported yet (pre-1.9 worker). */
    roleReconcile: RoleReconcileStatus | null
  }
}

/** PURE — the verdict, from raw check results. Testable with no live infra. */
export function computeHealth(input: {
  database: ServiceCheck
  redis: ServiceCheck
  lastSweepAt: string | null
  /** Absent/undefined ⇒ pre-fingerprint worker or unreadable Redis; reported as null. */
  workerCommit?: string | null
  roleReconcile?: string | null
  nowMs?: number
  /** Defaults to resolveWorkerStaleSec(process.env). */
  staleSec?: number
}): HealthReport {
  const now = input.nowMs ?? Date.now()
  const staleSec = input.staleSec ?? resolveWorkerStaleSec()
  const parsed = input.lastSweepAt ? new Date(input.lastSweepAt).getTime() : NaN
  const ageSec = Number.isFinite(parsed) ? Math.round((now - parsed) / 1000) : null
  const worker = {
    status: (ageSec == null ? 'unknown' : ageSec <= staleSec ? 'ok' : 'stale') as 'ok' | 'stale' | 'unknown',
    lastSweepAt: ageSec == null ? null : input.lastSweepAt,
    ageSec,
    // NOT gated on liveness: a STALE worker's last-known SHA is precisely what you want when
    // diagnosing why it went stale (did the deploy that killed it ever land?).
    commit: input.workerCommit ?? null,
    roleReconcile: parseRoleReconcile(input.roleReconcile),
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
  // enableReadyCheck:false + disableClientInfo:true — Upstash bills per command, and on connect
  // ioredis otherwise sends INFO + two CLIENT SETINFO this one-shot client never needs. Measured:
  // 6 commands → 3 per heartbeat / health check (AUTH + the real work). The first real command
  // still proves the connection, so a dead Redis is still 'unreachable'.
  return new IORedis(url, {
    maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 3000, enableOfflineQueue: false,
    enableReadyCheck: false, disableClientInfo: true,
  })
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
  let roleReconcile: string | null = null
  const r = redisClient()
  if (r) {
    try {
      await r.connect()
      await r.ping()
      redis = 'ok'
      // One round trip. A worker that predates the fingerprint returns null for the second key,
      // which is the honest reading — not an error, and not a guess at the web app's SHA.
      const [sweep, commit, roles] = await r.mget(HEARTBEAT_KEY, WORKER_COMMIT_KEY, ROLE_RECONCILE_KEY)
      lastSweepAt = sweep
      workerCommit = commit
      roleReconcile = roles
    } catch {
      redis = 'unreachable'
    } finally {
      r.disconnect()
    }
  }

  return computeHealth({ database, redis, lastSweepAt, workerCommit, roleReconcile })
}
