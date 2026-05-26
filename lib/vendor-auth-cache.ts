/**
 * Vendor membership auth cache — Redis-backed, DB-fallback.
 *
 * Replaces direct db.vendorMember.findFirst() calls across routes.
 * Provides:
 *   - Positive cache (5-10 min by role) — avoids DB hit on every request
 *   - Negative cache (1 min) — prevents DB hammering for non-members
 *   - Jitter on TTL — prevents thundering herd on simultaneous expiry
 *   - Request-level WeakMap — zero overhead for duplicate calls within one request
 *   - invalidateVendorAuth() — call after any VendorMember create/update/delete
 *
 * Usage:
 *   const member = await getVendorAuth(dbUserId, vendorId)
 *   if (!member) throw forbidden
 *
 *   // On role change or member removal:
 *   await invalidateVendorAuth(dbUserId, vendorId)
 */

import { db } from '@/lib/db'
import { getRedis } from '@/lib/redis'

// ─── Test helpers ─────────────────────────────────────────────────────────────
// Only used by scripts/test-l3.ts — never call in production code.

let _testKeyPrefix: string | null = null

export function __setKeyPrefixForTest(prefix: string | null): void {
  _testKeyPrefix = prefix
}

// Fires whenever a warn is emitted — used by test-l3.ts to capture warnings without
// relying on console.warn interception (which may be swallowed by tsx/Node internals).
let _onWarnForTest: ((msg: string) => void) | null = null
export function __setOnWarnForTest(fn: ((msg: string) => void) | null): void {
  _onWarnForTest = fn
}

// Injects a mock Redis client for test 9 (Redis failure simulation).
// Upstash Redis constructor returns a Proxy whose get-trap bypasses own-property patches,
// so direct property assignment on the real client cannot intercept method calls.
let _redisOverrideForTest: ReturnType<typeof getRedis> | undefined = undefined
export function __setRedisOverrideForTest(client: ReturnType<typeof getRedis>): void {
  _redisOverrideForTest = client
}
export function __clearRedisOverrideForTest(): void {
  _redisOverrideForTest = undefined
}

// ─── TTL ──────────────────────────────────────────────────────────────────────

const NEG_CACHE_TTL = 60  // 1 min — non-members

function ttlForRole(role: string | undefined): number {
  const r = role?.toLowerCase()
  if (r === 'owner')   return 600  // 10 min
  if (r === 'manager') return 300  // 5 min
  return 60                         // 1 min — staff / unknown
}

function jitter(base: number): number {
  return base + Math.floor(Math.random() * 30)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VendorAuthPayload {
  id:       string
  userId:   string
  vendorId: string
  role:     string
}

// ─── Request-level WeakMap ────────────────────────────────────────────────────
// Eliminates redundant Redis/DB round-trips for multiple auth checks in one request.

const requestCache = new WeakMap<object, Map<string, VendorAuthPayload | null>>()

function getRequestMap(req: object): Map<string, VendorAuthPayload | null> {
  if (!requestCache.has(req)) requestCache.set(req, new Map())
  return requestCache.get(req)!
}

// ─── Cache key ────────────────────────────────────────────────────────────────

function cacheKey(userId: string, vendorId: string): string {
  const prefix = _testKeyPrefix ?? 'v1:vendor-auth'
  return `${prefix}:${userId}:${vendorId}`
}

// ─── In-flight deduplication ──────────────────────────────────────────────────
// Prevents cache stampede: concurrent misses for the same key share one DB query.

const inFlight = new Map<string, Promise<VendorAuthPayload | null>>()

// ─── Core ─────────────────────────────────────────────────────────────────────

export async function getVendorAuth(
  userId:   string,
  vendorId: string,
  req?:     object      // optional — enables request-level memoization
): Promise<VendorAuthPayload | null> {
  const reqKey = `${userId}:${vendorId}`

  // 0. Request-level WeakMap hit (zero I/O)
  if (req) {
    const map = getRequestMap(req)
    if (map.has(reqKey)) return map.get(reqKey)!
  }

  const redis = _redisOverrideForTest !== undefined ? _redisOverrideForTest : getRedis()

  // 1. Redis cache hit
  // Upstash auto-deserializes JSON, so we store objects directly (no JSON.stringify).
  // Negative cache uses a sentinel object { __neg: 1 } to distinguish from null (key-not-found).
  if (redis) {
    try {
      const cached = await redis.get<VendorAuthPayload | { __neg: number }>(cacheKey(userId, vendorId))
      if (cached !== null && cached !== undefined) {
        const result = typeof cached === 'object' && '__neg' in cached
          ? null
          : (cached as VendorAuthPayload)
        if (req) getRequestMap(req).set(reqKey, result)
        return result
      }
    } catch (err) {
      const msg = '[VendorAuth] Redis get failed — falling back to DB'
      console.warn(msg, err)
      if (_onWarnForTest) { _onWarnForTest(msg) }
    }
  }

  // 2. DB lookup — deduplicated: concurrent misses share one in-flight promise
  const key = cacheKey(userId, vendorId)
  if (!inFlight.has(key)) {
    const promise = (async (): Promise<VendorAuthPayload | null> => {
      const member = await db.vendorMember.findFirst({
        where:  { userId, vendorId },
        select: { id: true, userId: true, vendorId: true, role: true },
      })

      // 3. Write cache
      if (redis) {
        try {
          if (member) {
            // Store object directly — Upstash handles serialization without double-encode
            await redis.set(key, member, { ex: jitter(ttlForRole(member.role)) })
          } else {
            // Sentinel object — distinguishes negative cache from key-not-found (null)
            await redis.set(key, { __neg: 1 }, { ex: jitter(NEG_CACHE_TTL) })
          }
        } catch (err) {
          console.warn('[VendorAuth] Redis set failed', err)
        }
      }

      return member
    })()

    inFlight.set(key, promise)
    promise.finally(() => inFlight.delete(key))
  }

  const member = await inFlight.get(key)!
  if (req) getRequestMap(req).set(reqKey, member)
  return member
}

/**
 * Invalidate the cache entry for a specific userId+vendorId pair.
 * Call after any VendorMember create, update, or delete.
 */
export async function invalidateVendorAuth(userId: string, vendorId: string): Promise<void> {
  const redis = _redisOverrideForTest !== undefined ? _redisOverrideForTest : getRedis()
  if (!redis) return
  try {
    await redis.del(cacheKey(userId, vendorId))
  } catch (err) {
    console.warn('[VendorAuth] Failed to invalidate cache', err)
  }
}
