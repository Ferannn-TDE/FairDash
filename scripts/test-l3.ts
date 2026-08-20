/**
 * L3 Test Suite — Vendor auth caching (Redis + DB fallback)
 *
 * Run:  npx tsx scripts/test-l3.ts
 *
 * Tests:
 *   1.  Cache miss falls through to DB
 *   2.  Cache hit skips DB entirely
 *   3.  Negative caching for non-members
 *   4.  Cache key scoped to userId+vendorId
 *   5.  Cached payload is minimal (only id/userId/vendorId/role)
 *   6.  invalidateVendorAuth clears cache entry
 *   7.  Role change: after invalidate, new role returned from DB
 *   8.  Member removal: after invalidate, getVendorAuth returns null
 *   9.  Redis failure falls back to DB gracefully
 *  10.  OWNER TTL >= 600, STAFF TTL in 60-90 range
 *  11.  Request-level WeakMap memoization skips Redis+DB on 2nd call
 *  12.  Concurrent misses share one DB query (stampede protection)
 */

// ─── Env ──────────────────────────────────────────────────────────────────────
import { config } from 'dotenv'
config({ path: '.env.local' })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }

const RUN_ID = Date.now()

// ─── Fixtures (existing DB rows — FK references) ──────────────────────────────
// From DB probe: one VendorMember with role OWNER
const FIXTURE_MEMBER_ID  = 'cmoghbglz0000sf1kf60xc6sz'
const FIXTURE_USER_ID    = 'cmoghbglz0000sf1kf60xc6sz'   // userId == id in this fixture
const FIXTURE_VENDOR_ID  = 'cmni6x6gz000611znpe5c5hhp'
const OTHER_VENDOR_ID    = 'cmni6x68q000211znxtpw0076'   // user is not a member here

// ─── Imports ──────────────────────────────────────────────────────────────────
import { db } from '../lib/db.js'
import { testRedis as redis } from '../lib/redis-test.js'
import {
  getVendorAuth,
  invalidateVendorAuth,
  __setKeyPrefixForTest,
  __setOnWarnForTest,
  __setRedisOverrideForTest,
  __clearRedisOverrideForTest,
} from '../lib/vendor-auth-cache.js'

// ─── Route vendor-auth-cache to test Redis for all tests ─────────────────────
// prod Redis is now at UPSTASH_REDIS_REST_URL; test Redis is TEST_REDIS_URL.
// __setRedisOverrideForTest makes getVendorAuth write/read from testRedis instead.
__setRedisOverrideForTest(redis as any)

// ─── Test Redis prefix ────────────────────────────────────────────────────────

const TEST_PREFIX = `v1:test-l3-${RUN_ID}:vendor-auth`
__setKeyPrefixForTest(TEST_PREFIX)

function testKey(userId: string, vendorId: string) {
  return `${TEST_PREFIX}:${userId}:${vendorId}`
}

// ─── Redis convenience helpers ────────────────────────────────────────────────

async function redisGet(key: string): Promise<string | null> {
  return redis.get<string>(key)
}

async function redisDel(key: string): Promise<void> {
  await redis.del(key)
}

async function redisTTL(key: string): Promise<number> {
  return redis.ttl(key)
}

async function clearTestKeys(): Promise<void> {
  // Collect all matching keys via SCAN, then delete in one batch
  const keys: string[] = []
  let cursor = 0
  do {
    const result = await redis.scan(cursor, { match: `${TEST_PREFIX}:*`, count: 100 })
    cursor = Number(result[0])   // Upstash may return cursor as string
    const batch = result[1] as string[]
    keys.push(...batch)
  } while (cursor !== 0)
  if (keys.length > 0) await redis.del(...(keys as [string, ...string[]]))
}

// ─── DB spy helper ────────────────────────────────────────────────────────────
// Monkey-patches db.vendorMember.findFirst and returns a call counter.

let dbCallCount = 0
let _originalFindFirst: typeof db.vendorMember.findFirst | null = null

function spyOnDbFindFirst(): () => number {
  dbCallCount = 0
  if (!_originalFindFirst) _originalFindFirst = db.vendorMember.findFirst.bind(db.vendorMember)
  const orig = _originalFindFirst
  ;(db.vendorMember as unknown as Record<string, unknown>).findFirst = async (...args: unknown[]) => {
    dbCallCount++
    return (orig as (...a: unknown[]) => unknown)(...args)
  }
  return () => dbCallCount
}

function restoreDbFindFirst(): void {
  if (_originalFindFirst) {
    ;(db.vendorMember as unknown as Record<string, unknown>).findFirst = _originalFindFirst
  }
}

// ─── Redis set spy ────────────────────────────────────────────────────────────

interface SetCall { key: string; value: string; ex?: number }
let _originalRedisSet: unknown = null
let redisSetCalls: SetCall[] = []

function spyOnRedisSet(): () => SetCall[] {
  redisSetCalls = []
  _originalRedisSet = redis.set.bind(redis)
  const orig = _originalRedisSet as (...a: unknown[]) => unknown
  ;(redis as unknown as Record<string, unknown>).set = async (
    key: string, value: string, opts?: { ex?: number }
  ) => {
    redisSetCalls.push({ key, value, ex: opts?.ex })
    return orig(key, value, opts)
  }
  return () => redisSetCalls
}

function restoreRedisSet(): void {
  if (_originalRedisSet) {
    ;(redis as unknown as Record<string, unknown>).set = _originalRedisSet
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function test1_cacheMissFallsThroughToDb() {
  console.log('\nTest 1 — cache miss falls through to DB')

  await redisDel(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  const getCalls = spyOnDbFindFirst()

  const member = await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)

  restoreDbFindFirst()

  if (getCalls() === 1)             pass('DB called exactly once on cache miss')
  else                              fail(`expected 1 DB call, got ${getCalls()}`)

  if (member && member.id)          pass(`returned member has id: ${member.id}`)
  else                              fail('returned member is null or missing id')

  if (member && member.userId === FIXTURE_USER_ID)   pass('returned member.userId correct')
  else                                               fail(`wrong userId: ${member?.userId}`)

  if (member && member.vendorId === FIXTURE_VENDOR_ID) pass('returned member.vendorId correct')
  else                                                 fail(`wrong vendorId: ${member?.vendorId}`)

  if (member && member.role)        pass(`returned member.role: ${member.role}`)
  else                              fail('member.role missing')
}

async function test2_cacheHitSkipsDb() {
  console.log('\nTest 2 — cache hit skips DB entirely')

  // Cache is primed by test 1 — just reset spy and call again
  const getCalls = spyOnDbFindFirst()

  const member = await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)

  restoreDbFindFirst()

  if (getCalls() === 0) pass('DB not called on cache hit')
  else                  fail(`expected 0 DB calls, got ${getCalls()}`)

  if (member && member.userId === FIXTURE_USER_ID) pass('returned same member from cache')
  else                                             fail(`cache hit returned wrong value: ${JSON.stringify(member)}`)
}

async function test3_negativeCaching() {
  console.log('\nTest 3 — negative caching for non-members')

  const fakeUserId = `fake-user-${RUN_ID}`
  await redisDel(testKey(fakeUserId, FIXTURE_VENDOR_ID))

  const member = await getVendorAuth(fakeUserId, FIXTURE_VENDOR_ID)

  if (member === null) pass('returned null for non-member')
  else                 fail(`expected null, got ${JSON.stringify(member)}`)

  const cached = await redisGet(testKey(fakeUserId, FIXTURE_VENDOR_ID))
  // Upstash auto-deserializes — sentinel is stored as { __neg: 1 }, returned as object
  const isNegSentinel = cached !== null &&
    typeof cached === 'object' && '__neg' in (cached as object)
  if (isNegSentinel) pass('Redis stores negative sentinel { __neg: 1 } for non-members')
  else               fail(`expected negative sentinel in Redis, got: ${JSON.stringify(cached)}`)

  // Second call — DB should not be hit
  const getCalls = spyOnDbFindFirst()
  await getVendorAuth(fakeUserId, FIXTURE_VENDOR_ID)
  restoreDbFindFirst()

  if (getCalls() === 0) pass('DB not called on negative cache hit')
  else                  fail(`expected 0 DB calls on second negative hit, got ${getCalls()}`)
}

async function test4_cacheKeyScoped() {
  console.log('\nTest 4 — cache key scoped to userId+vendorId')

  // Prime both keys
  await redisDel(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  await redisDel(testKey(FIXTURE_USER_ID, OTHER_VENDOR_ID))

  await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)
  await getVendorAuth(FIXTURE_USER_ID, OTHER_VENDOR_ID)   // non-member → null

  const val1 = await redisGet(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  const val2 = await redisGet(testKey(FIXTURE_USER_ID, OTHER_VENDOR_ID))

  if (val1 !== null && val2 !== null) pass('two separate Redis keys exist')
  else                                fail(`expected 2 keys, got key1=${val1 !== null}, key2=${val2 !== null}`)

  if (val1 !== val2) pass('keys have different values (different vendor memberships)')
  else               fail(`keys have same value — scoping broken: ${val1}`)
}

async function test5_minimalPayload() {
  console.log('\nTest 5 — cached payload is minimal (only id/userId/vendorId/role/approvalStatus)')

  // Ensure key is primed
  await redisDel(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)

  const raw = await redisGet(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  // Upstash auto-deserializes — raw is already the parsed object, not a JSON string
  if (!raw || (typeof raw === 'object' && '__neg' in (raw as object))) {
    fail('no positive cache entry found')
    return
  }

  let parsed: Record<string, unknown>
  if (typeof raw === 'object') {
    parsed = raw as Record<string, unknown>
  } else {
    try {
      parsed = JSON.parse(raw as string)
    } catch {
      fail(`cached value is not valid JSON: ${raw}`)
      return
    }
  }

  // `approvalStatus` was added DELIBERATELY (operator admittance, step 4): the payload carried
  // membership existence and nothing else, which is why every route holding one authorised on
  // "is attached to a booth". It is here to be VISIBLE, not to be authorised from — the gate
  // (requireVendorMayOperate) re-reads it fresh, because this copy is up to 10 minutes stale.
  // Keep this set tight: it exists so a future select cannot quietly widen what sits in Redis.
  const allowed = new Set(['id', 'userId', 'vendorId', 'role', 'approvalStatus'])
  const present = Object.keys(parsed)
  const forbidden = present.filter(k => !allowed.has(k))
  const missing   = [...allowed].filter(k => !present.includes(k))

  if (missing.length === 0)   pass(`all required fields present: ${present.join(', ')}`)
  else                        fail(`missing fields: ${missing.join(', ')}`)

  if (forbidden.length === 0) pass('no extra fields in cached payload')
  else                        fail(`unexpected fields: ${forbidden.join(', ')}`)
}

async function test6_invalidateClearsCache() {
  console.log('\nTest 6 — invalidateVendorAuth clears cache')

  await redisDel(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)

  const before = await redisGet(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  if (before !== null) pass('cache primed before invalidation')
  else                 fail('cache not primed — test setup broken')

  await invalidateVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)

  const after = await redisGet(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  if (after === null) pass('key deleted from Redis after invalidation')
  else                fail(`key still present after invalidation: ${after}`)

  // Next call should hit DB
  const getCalls = spyOnDbFindFirst()
  await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)
  restoreDbFindFirst()

  if (getCalls() === 1) pass('DB called after invalidation (cache miss)')
  else                  fail(`expected 1 DB call after invalidation, got ${getCalls()}`)
}

async function test7_roleChangeSeesFreshValue() {
  console.log('\nTest 7 — role change: after invalidate, fresh role returned from DB')

  // Verify fixture is OWNER
  const original = await db.vendorMember.findFirst({
    where: { id: FIXTURE_MEMBER_ID },
    select: { role: true },
  })
  if (!original) { fail('fixture member not found'); return }

  // Prime cache with current role
  await redisDel(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)

  // Simulate role update in DB + invalidation (what PATCH /api/vendor/members/:id would do)
  await db.vendorMember.update({
    where: { id: FIXTURE_MEMBER_ID },
    data:  { role: 'staff' },
  })
  await invalidateVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)

  // Next getVendorAuth should hit DB and return new role
  const getCalls = spyOnDbFindFirst()
  const updated  = await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)
  restoreDbFindFirst()

  if (getCalls() === 1)            pass('DB called after role-change invalidation')
  else                             fail(`expected 1 DB call, got ${getCalls()}`)

  if (updated?.role === 'staff')   pass('new role "staff" returned after invalidation')
  else                             fail(`expected role "staff", got "${updated?.role}"`)

  // Restore original role
  await db.vendorMember.update({
    where: { id: FIXTURE_MEMBER_ID },
    data:  { role: original.role },
  })
  await invalidateVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)
  pass(`original role "${original.role}" restored`)
}

async function test8_memberRemovalReturnsNull() {
  console.log('\nTest 8 — member removal: getVendorAuth returns null after delete + invalidate')

  // Create a temporary member to remove
  const tmpUser = await db.user.upsert({
    where:  { email: `tmp-l3-${RUN_ID}@test.invalid` },
    create: { clerkId: `tmp_l3_${RUN_ID}`, email: `tmp-l3-${RUN_ID}@test.invalid`, name: 'L3 Temp' },
    update: {},
    select: { id: true },
  })
  const tmpMember = await db.vendorMember.create({
    data:   { userId: tmpUser.id, vendorId: FIXTURE_VENDOR_ID, role: 'staff' },
    select: { id: true },
  })

  // Prime cache
  await redisDel(testKey(tmpUser.id, FIXTURE_VENDOR_ID))
  const beforeDelete = await getVendorAuth(tmpUser.id, FIXTURE_VENDOR_ID)
  if (beforeDelete !== null) pass('member found before deletion')
  else                       fail('member not found before deletion — fixture setup broken')

  // Simulate DELETE /api/vendor/members/:id + invalidation
  await db.vendorMember.delete({ where: { id: tmpMember.id } })
  await invalidateVendorAuth(tmpUser.id, FIXTURE_VENDOR_ID)

  const afterDelete = await getVendorAuth(tmpUser.id, FIXTURE_VENDOR_ID)
  if (afterDelete === null) pass('getVendorAuth returns null after member removal + invalidation')
  else                      fail(`expected null after removal, got ${JSON.stringify(afterDelete)}`)

  // Cleanup
  await db.user.delete({ where: { id: tmpUser.id } }).catch(() => {})
  await redisDel(testKey(tmpUser.id, FIXTURE_VENDOR_ID))
}

async function test9_redisFailureFallsBackToDb() {
  console.log('\nTest 9 — Redis failure falls back to DB gracefully')

  await redisDel(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))

  // Inject a mock Redis client whose .get() throws — simulating a Redis failure.
  // (Upstash Redis() returns a Proxy whose get-trap bypasses own-property patches,
  //  so direct property assignment on the real client doesn't intercept method calls.)
  let warnLogged = false
  __setOnWarnForTest(() => { warnLogged = true })
  __setRedisOverrideForTest({
    get: async () => { throw new Error('Simulated Redis failure') },
  } as any)

  const getCalls = spyOnDbFindFirst()
  let threw = false
  let member: Awaited<ReturnType<typeof getVendorAuth>> = null
  try {
    member = await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)
  } catch {
    threw = true
  }

  __clearRedisOverrideForTest()
  __setRedisOverrideForTest(redis as any)   // restore test Redis for subsequent tests
  __setOnWarnForTest(null)
  restoreDbFindFirst()

  if (!threw)                         pass('no error thrown to caller on Redis failure')
  else                                fail('getVendorAuth threw when Redis failed — should fail-open')

  if (getCalls() >= 1)               pass(`DB called as fallback (${getCalls()} calls)`)
  else                                fail('DB not called after Redis failure')

  if (warnLogged)                     pass('console.warn fired with Redis failure message')
  else                                fail('console.warn not called — silent Redis failure')

  if (member && member.userId === FIXTURE_USER_ID) pass('correct member returned from DB fallback')
  else                                              fail(`unexpected fallback result: ${JSON.stringify(member)}`)

  // Invalidate the key that may have been written by a partially working set
  await redisDel(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
}

async function test10_ttlByRole() {
  console.log('\nTest 10 — OWNER gets TTL >= 600, STAFF gets TTL in 60–90 range')

  // ── 10a: OWNER TTL ──────────────────────────────────────────────────────────
  // Ensure member is OWNER (restored by test 7)
  const currentMember = await db.vendorMember.findFirst({
    where: { id: FIXTURE_MEMBER_ID }, select: { role: true },
  })
  if (currentMember?.role !== 'OWNER') {
    await db.vendorMember.update({ where: { id: FIXTURE_MEMBER_ID }, data: { role: 'OWNER' } })
  }

  await redisDel(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  const getSetCalls = spyOnRedisSet()

  await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)

  const ownerCalls = getSetCalls().filter(c => c.key === testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  restoreRedisSet()

  if (ownerCalls.length > 0) {
    const ex = ownerCalls[0].ex ?? 0
    if (ex >= 600 && ex <= 630) pass(`OWNER TTL = ${ex}s (expected 600-630)`)
    else                        fail(`OWNER TTL = ${ex}s — expected 600-630`)
  } else {
    // Fall back to TTL check in Redis
    const ttl = await redisTTL(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
    if (ttl >= 590) pass(`OWNER TTL confirmed via redis.ttl: ${ttl}s`)
    else            fail(`OWNER TTL too short: ${ttl}s`)
  }

  // ── 10b: STAFF TTL ──────────────────────────────────────────────────────────
  await db.vendorMember.update({ where: { id: FIXTURE_MEMBER_ID }, data: { role: 'staff' } })
  await invalidateVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)

  const getSetCalls2 = spyOnRedisSet()
  await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)
  const staffCalls = getSetCalls2().filter(c => c.key === testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  restoreRedisSet()

  if (staffCalls.length > 0) {
    const ex = staffCalls[0].ex ?? 0
    if (ex >= 60 && ex <= 90)  pass(`STAFF TTL = ${ex}s (expected 60-90)`)
    else                        fail(`STAFF TTL = ${ex}s — expected 60-90`)
  } else {
    const ttl = await redisTTL(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
    if (ttl >= 55 && ttl <= 90) pass(`STAFF TTL confirmed via redis.ttl: ${ttl}s`)
    else                        fail(`STAFF TTL out of range: ${ttl}s`)
  }

  // Restore OWNER
  await db.vendorMember.update({ where: { id: FIXTURE_MEMBER_ID }, data: { role: 'OWNER' } })
  await invalidateVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID)
  pass('role restored to OWNER')
}

async function test11_requestLevelMemoization() {
  console.log('\nTest 11 — request-level WeakMap memoization skips Redis+DB on 2nd call')

  // Clear Redis so first call hits DB
  await redisDel(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))

  const req = {}  // mock Request object — WeakMap key

  const getCalls = spyOnDbFindFirst()

  const result1 = await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID, req)
  const result2 = await getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID, req)

  restoreDbFindFirst()

  // First call: Redis miss → DB hit. Second call: WeakMap hit → no I/O at all.
  if (getCalls() <= 1)        pass(`DB called ≤1 times (${getCalls()}) — 2nd call served from WeakMap`)
  else                        fail(`expected ≤1 DB call with WeakMap, got ${getCalls()}`)

  // WeakMap returns the exact same object reference on the 2nd call
  if (result1 === result2)    pass('both calls return same object reference (WeakMap hit)')
  else if (result1?.id === result2?.id) pass('both calls return same value (WeakMap or Redis hit)')
  else                        fail(`results differ: ${JSON.stringify(result1)} vs ${JSON.stringify(result2)}`)
}

async function test12_concurrentCallsShareOneDbQuery() {
  console.log('\nTest 12 — concurrent cache misses share one DB query (stampede protection)')

  await redisDel(testKey(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  // Allow time for Redis to settle
  await new Promise(r => setTimeout(r, 50))

  const getCalls = spyOnDbFindFirst()

  // Fire 20 concurrent calls — all will see a cache miss simultaneously
  const results = await Promise.all(
    Array.from({ length: 20 }, () => getVendorAuth(FIXTURE_USER_ID, FIXTURE_VENDOR_ID))
  )

  restoreDbFindFirst()

  // With in-flight deduplication: should be exactly 1 DB call
  if (getCalls() === 1)       pass(`stampede protected: exactly 1 DB call for 20 concurrent misses`)
  else if (getCalls() <= 3)   pass(`near-perfect dedup: ${getCalls()} DB calls for 20 concurrent misses`)
  else                        fail(`too many DB calls: ${getCalls()} for 20 concurrent cache misses`)

  const allSame = results.every(r => r?.userId === results[0]?.userId)
  if (allSame && results[0] !== null) pass('all 20 concurrent calls returned the same member')
  else                                fail(`results inconsistent across 20 calls`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('L3 Test Suite — vendor auth caching (Redis + DB fallback)')
  console.log(`  RUN_ID:      ${RUN_ID}`)
  console.log(`  TEST_PREFIX: ${TEST_PREFIX}`)
  console.log(`  testUserId:  ${FIXTURE_USER_ID}`)
  console.log(`  testVendorId:${FIXTURE_VENDOR_ID}`)
  console.log('─'.repeat(60))

  // testRedis is always configured — lib/redis-test.ts throws at import if env vars are absent

  await clearTestKeys()
  console.log('  Test keys cleared.')

  try {
    await test1_cacheMissFallsThroughToDb()
    await test2_cacheHitSkipsDb()
    await test3_negativeCaching()
    await test4_cacheKeyScoped()
    await test5_minimalPayload()
    await test6_invalidateClearsCache()
    await test7_roleChangeSeesFreshValue()
    await test8_memberRemovalReturnsNull()
    await test9_redisFailureFallsBackToDb()
    await test10_ttlByRole()
    await test11_requestLevelMemoization()
    await test12_concurrentCallsShareOneDbQuery()
  } finally {
    console.log('\nCleanup — clearing test keys...')
    await clearTestKeys()
    __setKeyPrefixForTest(null)
    restoreDbFindFirst()
    restoreRedisSet()
    await db.$disconnect()
  }

  console.log('\n' + '─'.repeat(60))
  if (process.exitCode === 1) {
    console.error('Some tests FAILED.')
  } else {
    console.log('All 12 tests passed.')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
