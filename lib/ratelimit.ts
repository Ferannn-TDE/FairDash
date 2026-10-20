import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// ─── Centralized policies ─────────────────────────────────────────────────────

// Each policy gets its OWN limiter built from this table (readiness 1.7). Until 2026-10-20 one
// 30/min limiter served every policy and these numbers were never read. Each limit is at least
// 2× the heaviest legitimate rate computed from the code, assuming 3 open devices per user
// (scripts/rate-limit-test.ts pins the numbers; docs/PRODUCTION_READINESS.md 1.7 has the table).
// Sign-in has no policy here: it goes through Clerk, whose attack protection covers it.
export const RATE_LIMITS = {
  vendorStatus:       { requests: 120, window: '1 m' }, // booth taps (accept/ready…); staff often share one login across devices
  orderCreate:        { requests: 10,  window: '1 m' }, // per USER (was per IP: a fair crowd shares one)
  deliveryCheck:      { requests: 20,  window: '1 m' }, // each call spends a paid geocode
  connectStatusFresh: { requests: 75,  window: '1 m' }, // ?fresh=1 payout-status reads go straight to Stripe; over it → cached read
  refund:             { requests: 10,  window: '1 m' }, // cancel, per USER (was per IP)
  publicRoutes:       { requests: 60,  window: '1 m' }, // public reads, signed in, per user
  publicAnonymous:    { requests: 600, window: '1 m' }, // public reads, signed out, per IP — a fair crowd can share one IP
} as const

export type RateLimitPolicy = keyof typeof RATE_LIMITS
type Duration = Parameters<typeof Ratelimit.slidingWindow>[1]

// ─── State machine ────────────────────────────────────────────────────────────

type RateLimitState =
  | { type: 'disabled' }
  | { type: 'failed'; error: string }
  | { type: 'ready'; limiters: Record<RateLimitPolicy, Ratelimit> }

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
    return { type: 'ready', limiters: buildLimiters(redis) }
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

// One limiter per policy, each from its own RATE_LIMITS entry and its own key prefix.
// RATE_LIMIT_TEST=true keeps the legacy tight 3/3 s window for scripts/test-c2.ts.
let windowOverride: Duration | null = null
function buildLimiters(redis: Redis): Record<RateLimitPolicy, Ratelimit> {
  const isTest = process.env.RATE_LIMIT_TEST === 'true'
  const out = {} as Record<RateLimitPolicy, Ratelimit>
  for (const policy of Object.keys(RATE_LIMITS) as RateLimitPolicy[]) {
    const cfg = RATE_LIMITS[policy]
    const window = (windowOverride ?? cfg.window) as Duration
    out[policy] = new Ratelimit({
      redis,
      limiter: isTest ? Ratelimit.slidingWindow(3, '3 s') : Ratelimit.slidingWindow(cfg.requests, window),
      prefix: isTest ? `@test/${policy}` : `v2:rl:${process.env.NODE_ENV}:${policy}`,
      analytics: !isTest,
    })
  }
  return out
}

// ─── Test helpers (non-production only) ──────────────────────────────────────

/** Rebuild every limiter with the same request counts over a shorter window (null restores). */
export function __setWindowOverrideForTest(w: Duration | null): void {
  windowOverride = w
  __resetForTest()
}

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
  policy: RateLimitPolicy,
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
    const { success, limit, remaining, reset } = await s.limiters[policy].limit(key)
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
