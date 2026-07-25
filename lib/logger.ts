export interface LogPayload {
  orderId?:    string
  vendorId?:   string
  userId?:     string
  durationMs?: number
  [key: string]: unknown
}

const isDev = process.env.NODE_ENV !== 'production'

const throttleMap = new Map<string, number>()

function shouldThrottle(key: string, ms = 5000): boolean {
  const last = throttleMap.get(key) ?? 0
  const now  = Date.now()
  if (now - last < ms) return true
  throttleMap.set(key, now)
  return false
}

export const logger = {
  debug: (msg: string, payload?: LogPayload) => {
    if (!isDev) return
    console.debug('[DEBUG]', msg, payload ?? '')
  },

  info: (msg: string, payload?: LogPayload) => {
    if (!isDev) return
    console.info('[INFO]', msg, payload ?? '')
  },

  warn: (msg: string, payload?: LogPayload) => {
    console.warn('[WARN]', msg, payload ?? '')
  },

  error: (msg: string, payload?: LogPayload) => {
    console.error('[ERROR]', msg, payload ?? '')
  },

  /**
   * MONEY — a money move happened, or was deliberately refused. ALWAYS reaches production, on
   * BOTH deployments (Vercel app + the worker). Use this for every site that transfers,
   * refunds, reverses, or declines to transfer. Never `info` for money.
   *
   * ⛔ MUST route through console.warn or console.error. This is not style — TWO independent
   * sinks silence console.info, and NEITHER is visible from this file:
   *
   *   1. `if (!isDev) return` (see debug/info above) — dead wherever NODE_ENV=production.
   *   2. next.config.mjs:26-30 — `removeConsole: { exclude: ['error', 'warn'] }`. The Next
   *      compiler DELETES console.info/debug/log call sites outright in the Vercel production
   *      build. The guard above is not even reached; there is no call left to guard.
   *
   * So a money line placed on console.info is dead on Vercel no matter what this module does.
   * That is exactly how seven money-move outcomes went unlogged in production: the successes
   * were on `info` while every refusal was on `warn`, so prod showed every payout we did NOT
   * make and none that we did. Enforced by scripts/sweep-summary-guard.ts [5].
   *
   * LEVEL vs CATEGORY — read before wiring alerts. This emits at console.warn, so successes
   * and refusals now share a LEVEL and are separable only by the `[MONEY]` prefix and the
   * message. Alerting keyed on log level alone will fire on both. Key on the prefix.
   */
  money: (msg: string, payload?: LogPayload) => {
    console.warn('[MONEY]', msg, payload ?? '')
  },

  // Only logs once per `ms` for a given key — safe for hot Firebase listeners.
  throttled: (key: string, msg: string, payload?: LogPayload, ms = 5000) => {
    if (shouldThrottle(key, ms)) return
    console.debug('[THROTTLED]', msg, payload ?? '')
  },

  // Returns a done() callback that logs elapsed time. No-op in production.
  time: (label: string): (() => void) => {
    if (!isDev) return () => {}
    const start = performance.now()
    return () => console.debug('[TIMER]', label, {
      durationMs: Math.round(performance.now() - start),
    })
  },
}
