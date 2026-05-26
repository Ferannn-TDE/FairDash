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
