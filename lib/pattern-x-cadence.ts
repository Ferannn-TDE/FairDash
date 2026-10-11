/**
 * PATTERN X CADENCE — run the unwindowed settled-transfer check on its own, slower interval.
 *
 * WHY. Pattern X is ~97% of a sweep's database egress (measured 2026-10-11: ~68 KB of ~70 KB),
 * because it re-reads every unreversed Payout ever written plus their earnings, refunds and
 * orders, on every sweep — and that grows with every payout. It is a crash-window / refund-race
 * BACKSTOP, not a latency path, so running it hourly instead of every 2 minutes loses little.
 * The SQL-side fix that keeps it cheap at any scale is specced in docs/SPEC-pattern-x-sql-check.md.
 *
 * RULES:
 *   - intervalMs = 0 (the default) ⇒ due on EVERY sweep — exactly the pre-change behaviour.
 *   - Due on the FIRST sweep after boot, always (a restart never delays X by a full interval).
 *   - The clock only advances when X actually COMPLETED (markRan). A sweep that aborts before
 *     X finishes leaves it due, so the next sweep retries it instead of waiting an hour.
 *
 * In-memory state: correct for the single worker process this runs in. A restart re-arms it
 * (boot run), which is the safe direction.
 *
 * PURE — the clock is passed in, so the whole contract is provable without time passing.
 */
export interface IntervalGate {
  /** Should this sweep run Pattern X? */
  due(nowMs: number): boolean
  /** Record that Pattern X completed in a sweep that decided at `decidedAtMs`. */
  markRan(decidedAtMs: number): void
  lastRanAt(): number | null
}

export function createIntervalGate(intervalMs: number): IntervalGate {
  let last: number | null = null
  return {
    due(nowMs) {
      if (intervalMs <= 0 || last === null) return true
      return nowMs - last >= intervalMs
    },
    markRan(decidedAtMs) { last = decidedAtMs },
    lastRanAt: () => last,
  }
}
