/**
 * WORKER THROTTLE CONFIG — every Redis-polling knob the worker has, read from env.
 *
 * WHY THIS EXISTS. Upstash bills per command, and the free tier is 500K/month. Measured against
 * BullMQ 5.76.8 (10-minute instrumented probes, every command counted client-side):
 *
 *   today's settings (sweep 60s via BullMQ repeat, drainDelay 5, stalled 30s)  → 1.13M/month idle
 *   sweep 5 min + drainDelay 60 + stalled 5 min, sweep STILL a BullMQ repeat   →  635K/month idle
 *   drainDelay 60 + stalled 5 min, NO delayed job pending                      →   95K/month idle
 *
 * The middle row is the trap. drainDelay only governs the idle block while NO delayed job exists:
 * with one pending, BullMQ caps every BZPOPMIN at a HARD-CODED 10s (`maximumBlockTimeout`,
 * worker.js:20, not configurable) and pays a moveToActive script on each wake. A repeatable sweep
 * IS a permanently-pending delayed job, so it pins the worker to the 10s floor forever. Hence
 * `timer` mode: the sweep runs off an in-process timer and the queue holds no delayed job at idle.
 *
 * Delayed jobs still fire on time under a large drainDelay (measured: 140ms late on 45s/90s
 * delays; an immediate enqueue picked up in 157ms while blocked) — BullMQ's marker key wakes the
 * blocked worker, and a pending delayed job brings back the 10s cap for exactly as long as it exists.
 *
 * EVERY DEFAULT IS THE PRE-THROTTLE VALUE. Unset env ⇒ identical behaviour to before this file
 * existed, and WORKER_SWEEP_SCHEDULER=bullmq is the rollback path.
 *
 * PURE — env in, config out. An invalid value falls back to the default AND says so, because a
 * typo'd interval that silently became the default is a config change nobody can see.
 */

export type SweepScheduler = 'bullmq' | 'timer'

export interface WorkerConfig {
  scheduler: SweepScheduler
  sweepIntervalMs: number
  /** BullMQ `drainDelay` — SECONDS, BullMQ's own unit. */
  drainDelaySec: number
  stalledIntervalMs: number
  lockDurationMs: number
}

export const WORKER_CONFIG_DEFAULTS: WorkerConfig = {
  scheduler: 'bullmq',
  sweepIntervalMs: 60_000,
  drainDelaySec: 5,
  stalledIntervalMs: 30_000,
  lockDurationMs: 30_000,
}

/** Floors: below these a value is almost certainly a unit mistake (seconds typed as ms). */
const FLOORS = {
  sweepIntervalMs: 10_000,
  drainDelaySec: 1,
  stalledIntervalMs: 5_000,
  lockDurationMs: 5_000,
} as const

function readInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  floor: number,
  warnings: string[],
): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < floor) {
    warnings.push(`${name}="${raw}" is invalid (integer ≥ ${floor} required) — using default ${fallback}`)
    return fallback
  }
  return n
}

export function readWorkerConfig(env: Record<string, string | undefined>): { config: WorkerConfig; warnings: string[] } {
  const warnings: string[] = []
  const d = WORKER_CONFIG_DEFAULTS

  let scheduler: SweepScheduler = d.scheduler
  const rawScheduler = env.WORKER_SWEEP_SCHEDULER?.trim().toLowerCase()
  if (rawScheduler === 'bullmq' || rawScheduler === 'timer') scheduler = rawScheduler
  else if (rawScheduler) warnings.push(`WORKER_SWEEP_SCHEDULER="${env.WORKER_SWEEP_SCHEDULER}" is invalid (bullmq|timer) — using default ${d.scheduler}`)

  return {
    config: {
      scheduler,
      sweepIntervalMs:   readInt(env, 'WORKER_SWEEP_INTERVAL_MS',   d.sweepIntervalMs,   FLOORS.sweepIntervalMs,   warnings),
      drainDelaySec:     readInt(env, 'WORKER_DRAIN_DELAY_SEC',     d.drainDelaySec,     FLOORS.drainDelaySec,     warnings),
      stalledIntervalMs: readInt(env, 'WORKER_STALLED_INTERVAL_MS', d.stalledIntervalMs, FLOORS.stalledIntervalMs, warnings),
      lockDurationMs:    readInt(env, 'WORKER_LOCK_DURATION_MS',    d.lockDurationMs,    FLOORS.lockDurationMs,    warnings),
    },
    warnings,
  }
}

/** One flat, greppable line for the boot log — Railway's logs are how the env vars are confirmed. */
export function formatWorkerConfig(c: WorkerConfig): string {
  return (
    `[Worker] config scheduler=${c.scheduler} sweepIntervalMs=${c.sweepIntervalMs} ` +
    `drainDelaySec=${c.drainDelaySec} stalledIntervalMs=${c.stalledIntervalMs} lockDurationMs=${c.lockDurationMs}`
  )
}
