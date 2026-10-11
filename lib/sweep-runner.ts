/**
 * SWEEP RUNNER — the ONE place a reconcile sweep is started, in either scheduler mode.
 *
 * NO PARALLEL SWEEPS, UNDER ANY CIRCUMSTANCES. Two reconcilers on the same rows has never been
 * exercised, and the monotonic fixed-point guarantees were never designed under it. Both entry
 * points — the in-process timer (WORKER_SWEEP_SCHEDULER=timer) and the BullMQ repeat job
 * (=bullmq, the rollback path) — call runOnce() on the SAME runner instance, so the guard covers
 * the mixed case too: a leftover BullMQ repeat firing while a timer sweep runs is skipped, not
 * stacked.
 *
 * WHY THE GUARD IS NEEDED EVEN IN BULLMQ MODE: the worker runs at concurrency 5 and BullMQ 5.76.8
 * schedules the next repeat when the current one is PICKED UP, not when it finishes — so a sweep
 * that outruns its interval meets its own successor with free slots. Skip rather than queue: a
 * delayed duplicate sweep has no value, the next tick will see the same state.
 *
 * SCOPE — in-process, honest about its limit: it makes overlap impossible within ONE worker
 * process, which is the deployment (a single Railway service). It would NOT hold across replicas;
 * scaling the worker horizontally requires promoting this to a Redis lock (SET NX PX) first.
 *
 * SHUTDOWN: stop() clears the timer, refuses any new sweep, and resolves only once an in-flight
 * sweep has FINISHED. A sweep is never cut off mid-pattern by our own shutdown path.
 *
 * Timers are injected so the whole contract is provable without Redis, a DB, or real time.
 */

export type SweepSource = 'boot' | 'timer' | 'bullmq'
export type SweepOutcome = 'ran' | 'skipped' | 'stopped' | 'failed'

export interface SweepRunnerDeps {
  run: () => Promise<unknown>
  intervalMs: number
  warn?: (msg: string) => void
  error?: (msg: string, err?: unknown) => void
  now?: () => number
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

export interface SweepRunner {
  runOnce(source: SweepSource): Promise<SweepOutcome>
  /** Timer mode: one sweep IMMEDIATELY, then every intervalMs. Idempotent. */
  start(): void
  /** Clear the timer, refuse new sweeps, wait for an in-flight one to finish. */
  stop(): Promise<void>
  isRunning(): boolean
}

export function createSweepRunner(deps: SweepRunnerDeps): SweepRunner {
  const warn = deps.warn ?? ((m: string) => console.warn(m))
  const error = deps.error ?? ((m: string, e?: unknown) => console.error(m, e))
  const now = deps.now ?? Date.now
  const setIntervalFn = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms))
  const clearIntervalFn = deps.clearInterval ?? ((h: unknown) => clearInterval(h as NodeJS.Timeout))

  let inFlight: Promise<void> | null = null
  let timer: unknown = null
  let stopped = false

  async function runOnce(source: SweepSource): Promise<SweepOutcome> {
    if (stopped) {
      warn(`[Worker] sweep not started (source=${source}): worker is shutting down`)
      return 'stopped'
    }
    if (inFlight) {
      warn(`[Worker] sweep skipped: previous still running (source=${source})`)
      return 'skipped'
    }
    const startedAt = now()
    let outcome: SweepOutcome = 'ran'
    // The slot is claimed SYNCHRONOUSLY (no await between the check above and this assignment),
    // so two callers in the same tick cannot both pass the guard.
    inFlight = (async () => {
      try {
        await deps.run()
      } catch (err) {
        outcome = 'failed'
        error(`[Worker] sweep failed (source=${source})`, err)
      } finally {
        const ms = now() - startedAt
        if (ms > deps.intervalMs) {
          error(`[Worker] reconcile-sweep took ${ms}ms — LONGER THAN ITS ${deps.intervalMs}ms INTERVAL. Overlap is being prevented by the guard, meaning ticks are now being skipped.`)
        }
      }
    })()
    try { await inFlight } finally { inFlight = null }
    return outcome
  }

  function start() {
    if (stopped || timer !== null) return
    // Boot sweep first — don't wait a whole interval for the first heartbeat.
    void runOnce('boot')
    timer = setIntervalFn(() => { void runOnce('timer') }, deps.intervalMs)
  }

  async function stop() {
    stopped = true
    if (timer !== null) { clearIntervalFn(timer); timer = null }
    if (inFlight) {
      warn('[Worker] shutdown: waiting for the in-flight sweep to finish')
      await inFlight.catch(() => {})
    }
  }

  return { runOnce, start, stop, isRunning: () => inFlight !== null }
}
