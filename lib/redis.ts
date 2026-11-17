/**
 * Shared Upstash Redis client singleton.
 *
 * Lazy-initialised — safe to import at module level even when env vars are absent.
 * Returns null when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are unset
 * so callers can gracefully degrade.
 */

import { Redis } from '@upstash/redis'
import { decideRedisAccess } from './prod-db-guard'

const globalForRedis = globalThis as unknown as { __redis: Redis | null | undefined }

function buildRedis(): Redis | null {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  // A local process never uses a REMOTE cache: the same rule as the job queue
  // (lib/prod-db-guard.ts), asked here on first use, never at import. Refused = null, the same
  // as no settings (callers degrade: lib/vendor-auth-cache.ts reads the database instead).
  // Deployed runtimes are exempt, so production is unchanged.
  const access = decideRedisAccess(process.env, url, 'vendor auth cache (UPSTASH_REDIS_REST_URL)')
  if (!access.allowed) {
    console.error(`[Redis] 🛑 REFUSING: ${access.reason}`)
    return null
  }
  try {
    return new Redis({ url, token })
  } catch {
    return null
  }
}

export function getRedis(): Redis | null {
  if (globalForRedis.__redis !== undefined) return globalForRedis.__redis
  const client = buildRedis()
  if (process.env.NODE_ENV !== 'production') {
    globalForRedis.__redis = client
  }
  return client
}

// Convenience export — callers import { redis } and check for null
export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    const client = getRedis()
    if (!client) throw new Error(`[Redis] Client not configured — set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN`)
    return (client as unknown as Record<string | symbol, unknown>)[prop]
  },
})
