import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// ─── Centralized policies ─────────────────────────────────────────────────────

export const RATE_LIMITS = {
  vendorStatus: { requests: 30,  window: '1 m' },
  orderCreate:  { requests: 10,  window: '1 m' },
  login:        { requests: 5,   window: '1 m' },
  refund:       { requests: 5,   window: '1 m' },
  publicRoutes: { requests: 60,  window: '1 m' },
} as const

// ─── State machine ────────────────────────────────────────────────────────────

type RateLimitState =
  | { type: 'disabled' }
  | { type: 'failed'; error: string }
  | { type: 'ready'; rl: Ratelimit }

// Module-level singletons — reset by Next.js hot-reload unless we use globalThis
let state: RateLimitState | null = null
let initPromise: Promise<RateLimitState> | null = null

declare global {
  // eslint-disable-next-line no-var
  var __ratelimitState:   RateLimitState | undefined
  // eslint-disable-next-line no-var
  var __ratelimitPromise: Promise<RateLimitState> | undefined
}

// Reuse state across hot-reloads in dev so we don't re-init Redis on every save
if (process.env.NODE_ENV === 'development') {
  state       = globalThis.__ratelimitState   ?? null
  initPromise = globalThis.__ratelimitPromise ?? null
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function initRatelimit(): Promise<RateLimitState> {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[Ratelimit] Redis required in production — set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN'
      )
    }
    console.warn('[Ratelimit] Redis not configured — rate limiting disabled')
    return { type: 'disabled' }
  }

  try {
    const redis = new Redis({ url, token })

    // RATE_LIMIT_TEST=true: tight 3/3 s window for integration tests (test-c2)
    const isTest = process.env.RATE_LIMIT_TEST === 'true'
    const rl = new Ratelimit({
      redis,
      limiter: isTest
        ? Ratelimit.slidingWindow(3, '3 s')
        : Ratelimit.slidingWindow(30, '1 m'),
      prefix:    isTest ? '@test/vendor-status' : `v1:rl:${process.env.NODE_ENV}`,
      analytics: !isTest,
    })

    return { type: 'ready', rl }
  } catch (err) {
    console.error('[Ratelimit] Failed to initialize', err)
    return { type: 'failed', error: String(err) }
  }
}

async function getRatelimit(): Promise<RateLimitState> {
  if (state) return state

  if (!initPromise) {
    initPromise = initRatelimit()
    if (process.env.NODE_ENV === 'development') {
      globalThis.__ratelimitPromise = initPromise
    }
  }

  state = await initPromise

  if (process.env.NODE_ENV === 'development') {
    globalThis.__ratelimitState = state
  }

  return state
}

// ─── Test helpers (non-production only) ──────────────────────────────────────

export type { RateLimitState }

export function __resetForTest(): void {
  state = null
  initPromise = null
  globalThis.__ratelimitState   = undefined
  globalThis.__ratelimitPromise = undefined
}

export function __setStateForTest(s: RateLimitState): void {
  state       = s
  initPromise = Promise.resolve(s)
}

export function __setInitPromiseForTest(p: Promise<RateLimitState>): void {
  state       = null
  initPromise = p
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function enforceRateLimit(
  key: string,
  policy: keyof typeof RATE_LIMITS,
  opts: { failClosed?: boolean } = {}
): Promise<{ allowed: boolean; headers: Record<string, string> }> {
  const s = await Promise.race([
    getRatelimit(),
    new Promise<RateLimitState>((resolve) =>
      setTimeout(() => resolve({ type: 'failed', error: 'timeout' }), 1000)
    ),
  ])

  if (s.type === 'disabled' || s.type === 'failed') {
    if (opts.failClosed) {
      console.error('[Ratelimit] Fail-closed: blocking request due to Redis failure')
      return { allowed: false, headers: {} }
    }
    return { allowed: true, headers: {} }
  }

  try {
    const { success, limit, remaining, reset } = await s.rl.limit(`v1:${policy}:${key}`)
    return {
      allowed: success,
      headers: {
        'X-RateLimit-Limit':     String(limit),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset':     String(reset),
        ...(success ? {} : { 'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)) }),
      },
    }
  } catch (err) {
    console.error('[Ratelimit] rl.limit() threw', err)
    if (opts.failClosed) {
      console.error('[Ratelimit] Fail-closed: blocking request due to Redis failure')
      return { allowed: false, headers: {} }
    }
    return { allowed: true, headers: {} }
  }
}
