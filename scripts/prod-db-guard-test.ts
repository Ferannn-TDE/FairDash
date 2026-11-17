/**
 * PROD-DB GUARD — a local process cannot reach the production database or job queue by default.
 *
 * Structural, like test-isolation-guard: it proves the decision (by calling it) and proves every
 * client construction is behind it (by reading the source), rather than checking that nothing
 * happened to go wrong.
 *
 *   [0] positive controls: the classifiers recognise a production URL and a local one
 *   [1] the database decision: refuse / confirm / deployed exemption
 *   [2] the queue decision
 *   [3] every `new PrismaClient` in scripts/, prisma/, lib/, workers/ sits behind the guard or the
 *       test-DB boundary — with a control proving the scan flags an unguarded file
 *   [4] the runtime chokepoints call it (lib/db, worker, guardedPrisma, queue)
 *   [5] the Redis decision, and the 3 Redis clients that had none (health/heartbeat, rate limiter,
 *       vendor auth cache): refused on first use, never at import; health degrades, never throws
 *
 * Run: ./scripts/with-test-db.sh npx tsx scripts/prod-db-guard-test.ts   ([5] loads lib/db)
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { stripComments } from './_strip-comments'
import {
  decideDatabaseAccess, decideQueueAccess, isProductionDatabaseUrl, isLocalHost,
  supabaseProjectRef, isDeployedRuntime,
} from '../lib/prod-db-guard'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

const REF = 'abcdefghijklmnopqrst'
const POOLER = `postgresql://postgres.${REF}:pw@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true`
const DIRECT = `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`
const DEV = 'postgresql://fairsynq:fairsynq@localhost:54329/fairsynq_dev'
const LOCAL: Record<string, string | undefined> = {}  // a laptop: no NODE_ENV, no platform vars

console.log('\n════ PROD-DB GUARD ════')

console.log('\n[0] POSITIVE CONTROLS: the classifiers')
assert(isProductionDatabaseUrl(POOLER), 'pooler URL is production')
assert(isProductionDatabaseUrl(DIRECT), 'direct supabase.co URL is production')
assert(!isProductionDatabaseUrl(DEV), 'dev URL is not production')
assert(supabaseProjectRef(POOLER) === REF && supabaseProjectRef(DIRECT) === REF, 'project ref parsed from both URL shapes')
assert(isLocalHost('redis://localhost:56379') && !isLocalHost('rediss://default:x@foo.upstash.io:6379'), 'local vs remote Redis host')
assert(!isDeployedRuntime(LOCAL), 'an empty environment is NOT a deployed runtime')

console.log('\n[1] database decision')
assert(!decideDatabaseAccess(LOCAL, [POOLER]).allowed, 'local + production URL → refused')
assert(!decideDatabaseAccess(LOCAL, [DEV, DIRECT]).allowed, 'refused when EITHER url is production (DIRECT_URL is what the CLI uses)')
assert(!decideDatabaseAccess({ CONFIRM_PROD_DB: 'true' }, [POOLER]).allowed, 'CONFIRM_PROD_DB=true is not a project ref → refused')
assert(!decideDatabaseAccess({ CONFIRM_PROD_DB: 'zzzzzzzzzzzzzzzzzzzz' }, [POOLER]).allowed, 'wrong ref → refused')
assert(decideDatabaseAccess({ CONFIRM_PROD_DB: REF }, [POOLER, DIRECT]).allowed, 'matching ref → allowed')
assert(decideDatabaseAccess(LOCAL, [DEV, DEV]).allowed, 'local dev URLs → allowed')
assert(decideDatabaseAccess(LOCAL, [undefined, undefined]).allowed, 'no URL → allowed (Prisma reports the missing var itself)')
for (const [k, v] of [['NODE_ENV', 'production'], ['VERCEL', '1'], ['RAILWAY_GIT_COMMIT_SHA', 'abc'], ['RAILWAY_PROJECT_ID', 'p'], ['RAILWAY_ENVIRONMENT_ID', 'e']]) {
  assert(decideDatabaseAccess({ [k]: v }, [POOLER]).allowed, `deployed runtime (${k}) → allowed — the guard must never fire in production`)
}
assert(!decideDatabaseAccess({ NODE_ENV: 'development' }, [POOLER]).allowed, 'NODE_ENV=development (next dev) + production → refused')

console.log('\n[2] queue decision')
assert(!decideQueueAccess(LOCAL, 'rediss://default:x@prod.upstash.io:6379').allowed, 'local + remote queue → refused')
assert(decideQueueAccess(LOCAL, 'redis://localhost:56379').allowed, 'local + dev Redis → allowed')
assert(decideQueueAccess(LOCAL, undefined).allowed && decideQueueAccess(LOCAL, '').allowed, 'unset queue → allowed (enqueue is a no-op)')
assert(decideQueueAccess({ NODE_ENV: 'production' }, 'rediss://default:x@prod.upstash.io:6379').allowed, 'deployed runtime + remote queue → allowed')

console.log('\n[3] every PrismaClient construction is behind a guard')
const SAFE = /assertNotProductionDatabase\(|testPrisma\(|resolveTestDatabaseUrl\(/
// Built from parts so this file does not itself contain a client construction — the
// test-isolation suite rightly flags any gate suite that does.
const CTOR = new RegExp('new ' + 'PrismaClient' + '\\s*\\(')
const CTOR_TEXT = 'new ' + 'PrismaClient()'
// Scans CODE, not prose (stripComments), and the guard must come BEFORE the first construction:
// a guard that is only mentioned in a comment, or called after the client already exists,
// protects nothing.
function unguarded(raw: string): boolean {
  const src = stripComments(raw)
  const ctorAt = src.search(CTOR)
  if (ctorAt < 0) return false
  const guardAt = src.search(SAFE)
  return guardAt < 0 || guardAt > ctorAt
}
// Controls on the scanner itself.
assert(unguarded(`import { PrismaClient } from '@prisma/client'\nconst p = ${CTOR_TEXT}`), 'control: scanner flags an unguarded client')
assert(!unguarded(`assertNotProductionDatabase('x')\nconst p = ${CTOR_TEXT}`), 'control: scanner accepts a guarded client')
assert(unguarded(`// assertNotProductionDatabase('x')\nconst p = ${CTOR_TEXT}`), 'control: scanner flags a guard that is only a comment')
assert(unguarded(`const p = ${CTOR_TEXT}\nassertNotProductionDatabase('x')`), 'control: scanner flags a guard called after the client')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(name)) out.push(p)
  }
  return out
}
const files = ['scripts', 'prisma', 'lib', 'workers'].flatMap(d => walk(d))
  .filter(f => f !== 'scripts/prod-db-guard-test.ts')
const constructing = files.filter(f => CTOR.test(readFileSync(f, 'utf8')))
const offenders = constructing.filter(f => unguarded(readFileSync(f, 'utf8')))
assert(constructing.length >= 20, `scan found ${constructing.length} files constructing a client (≥20 — a scan that finds none proves nothing)`)
assert(offenders.length === 0, offenders.length === 0
  ? 'no unguarded PrismaClient construction'
  : `unguarded PrismaClient in: ${offenders.join(', ')} — add assertNotProductionDatabase('<name>') before it`)

console.log('\n[4] runtime chokepoints call the guard')
const src = (f: string) => readFileSync(f, 'utf8')
assert(/assertNotProductionDatabase\('lib\/db', \[url\]\)/.test(src('lib/db.ts')), 'lib/db.ts guards the resolved URL')
assert(/assertNotProductionDatabase\('worker'/.test(src('workers/order-worker.ts')), 'worker client guarded')
assert(/assertNotProductionDatabase\('worker'\)/.test(src('workers/index.ts')) && /assertLocalQueue\('worker'\)/.test(src('workers/index.ts')), 'worker boot guards DB and queue')
assert(/assertNotProductionDatabase\('guardedPrisma'/.test(src('lib/prod-write-guard.ts')), 'guardedPrisma guarded')
assert(/decideQueueAccess\(process\.env, url\)/.test(src('lib/queues.ts')), 'queue producer refuses a remote queue locally')
assert(/assertNotProductionDatabase\('seed\.ts'\)/.test(src('prisma/seed.ts')), 'seed guarded')

// ── [5] the three Redis clients that had no guard (found Nov 16) ─────────────────────────────
// The health check / sweep heartbeat (lib/health.ts), the rate limiter (lib/ratelimit.ts) and the
// vendor auth cache (lib/redis.ts) let a local process whose .env.local named a remote Redis write
// heartbeats and rate-limit counters there. Each now asks decideRedisAccess on FIRST USE.
console.log('\n[5] Redis decision + the health/heartbeat, rate-limiter and auth-cache clients')
type RedisDecision = { allowed: boolean; reason?: string }
type RedisDecide = (env: Record<string, string | undefined>, url: string | undefined, what: string) => RedisDecision
// Looked up on the module (not a named import), so this suite still LOADS on code without it and
// fails row by row instead.
const guardModule = await import('../lib/prod-db-guard') as unknown as { decideRedisAccess?: RedisDecide }
assert(typeof guardModule.decideRedisAccess === 'function', 'lib/prod-db-guard.ts exports decideRedisAccess')
const decideRedis: RedisDecide = guardModule.decideRedisAccess ?? (() => ({ allowed: true }))

// Fake addresses only: the .invalid domain can never resolve, so nothing real is ever contacted.
// The URL with a user and password is built from parts, so this file holds no
// "scheme://user:password@host" text for a key scan to match.
const FAKE_HOST = 'redis-guard-test.invalid'
const FAKE_SECRET = 'not-a-real-secret-7f3a'
const REMOTE_REDIS_URL = 'rediss://default:' + FAKE_SECRET + '@' + FAKE_HOST + ':6379'
const REMOTE_REST_URL = 'https://' + FAKE_HOST

assert(!decideRedis(LOCAL, REMOTE_REDIS_URL, 'x').allowed && !decideRedis(LOCAL, REMOTE_REST_URL, 'x').allowed,
  'local + remote Redis (an ioredis URL or an Upstash REST address) → refused')
assert(!decideRedis(LOCAL, 'not a url', 'x').allowed, 'local + an address that cannot be parsed → refused (fails closed)')
assert(decideRedis(LOCAL, 'http://localhost:58080', 'x').allowed && decideRedis(LOCAL, 'redis://127.0.0.1:56379', 'x').allowed,
  'local + local host (test stand-in, dev Redis) → allowed')
assert(decideRedis(LOCAL, undefined, 'x').allowed && decideRedis(LOCAL, '', 'x').allowed, 'unset → allowed (the client is simply off)')
assert(decideRedis({ CONFIRM_PROD_DB: REF }, REMOTE_REST_URL, 'x').allowed, 'CONFIRM_PROD_DB set → allowed (a deliberate operation)')
const DEPLOYED: Array<[string, Record<string, string>]> = [
  ['NODE_ENV=production (every Vercel deployment and next build)', { NODE_ENV: 'production' }],
  ['VERCEL=1 alone (Vercel, including preview and build)', { VERCEL: '1' }],
  ['a Railway-like env (the worker)', { RAILWAY_ENVIRONMENT_ID: 'e', RAILWAY_PROJECT_ID: 'p', RAILWAY_GIT_COMMIT_SHA: 'abc' }],
]
for (const [label, env] of DEPLOYED) {
  assert(decideRedis(env, REMOTE_REDIS_URL, 'x').allowed && decideRedis(env, REMOTE_REST_URL, 'x').allowed,
    `deployed runtime: ${label} + remote host → allowed`)
}
const redisReason = decideRedis(LOCAL, REMOTE_REDIS_URL, 'test Redis').reason ?? ''
assert(redisReason.includes(FAKE_HOST) && !redisReason.includes(FAKE_SECRET) && !redisReason.includes('default:'),
  'the refusal names the host only, never the user or password')
const guardLib = stripComments(src('lib/prod-db-guard.ts'))
assert(/export function decideRedisAccess[\s\S]*?if \(isDeployedRuntime\(env\) \|\| !url \|\| isLocalHost\(url\)\) return \{ allowed: true \}/.test(guardLib)
    && (guardLib.match(/function isDeployedRuntime\(/g) ?? []).length === 1,
  'decideRedisAccess uses the one shared isDeployedRuntime (the same helper as the queue decision, not a copy)')

// Each client asks the decision INSIDE its first-use function, before it builds a connection.
for (const [file, fn, ctor] of [
  ['lib/health.ts', 'function healthRedis(', 'new IORedis('],
  ['lib/ratelimit.ts', 'async function initRatelimit(', 'new Redis('],
  ['lib/redis.ts', 'function buildRedis(', 'new Redis('],
] as const) {
  const code = stripComments(src(file))
  const fnAt = code.indexOf(fn)
  const guardAt = code.indexOf('decideRedisAccess(process.env', fnAt)
  const ctorAt = fnAt >= 0 ? code.indexOf(ctor, fnAt) : -1
  const calls = (code.match(/decideRedisAccess\(/g) ?? []).length
  assert(fnAt >= 0 && guardAt > fnAt && ctorAt > guardAt && calls === 1,
    `${file}: ${fn.replace('(', '')} asks decideRedisAccess before building the client (once, inside the function: on first use, not at import)`)
}

// Behaviour, with the fake host only. The environment is set for this section and restored after;
// platform markers are cleared so this process counts as local.
const ENV_KEYS = ['REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'NODE_ENV', 'VERCEL',
  'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_PROJECT_ID', 'RAILWAY_GIT_COMMIT_SHA', 'CONFIRM_PROD_DB']
const envVars = process.env as Record<string, string | undefined>
const savedEnv: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map(k => [k, envVars[k]]))
const setEnv = (vals: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(vals)) { if (v === undefined) delete envVars[k]; else envVars[k] = v }
}
const logged: string[] = []
const realError = console.error, realWarn = console.warn
const capture = () => {
  logged.length = 0
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')) }
  console.warn = console.error
}
const release = () => { console.error = realError; console.warn = realWarn }
const refusedBy = (tag: string) => logged.some(l => l.includes(tag) && l.includes('REFUSING') && l.includes(FAKE_HOST))
const leaked = () => logged.some(l => l.includes(FAKE_SECRET) || l.includes('guard-test-token'))

type HealthMod = {
  runHealthChecks: () => Promise<{ status: string; redis: string }>
  recordSweepHeartbeat: () => Promise<void>
  computeHealth: (i: { database: string; redis: string; lastSweepAt: null; migrations: { status: string; pending: string[] } }) => { status: string }
  publicHealthBody: (h: unknown, commit: string) => { status: string; checks: { redis: string } }
}
type RateLimitMod = {
  __resetForTest: () => void
  enforceRateLimit: (key: string, policy: 'orderCreate' | 'publicAnonymous', opts?: { failClosed?: boolean }) => Promise<{ allowed: boolean; headers: Record<string, string> }>
}
type RedisMod = { getRedis: () => unknown }

if (!process.env.TEST_DATABASE_URL) {
  assert(false, 'the [5] behaviour rows run under scripts/with-test-db.sh (lib/health loads lib/db, which needs the test database)')
} else {
  setEnv({
    NODE_ENV: undefined, VERCEL: undefined, RAILWAY_ENVIRONMENT_ID: undefined, RAILWAY_PROJECT_ID: undefined,
    RAILWAY_GIT_COMMIT_SHA: undefined, CONFIRM_PROD_DB: undefined,
    REDIS_URL: REMOTE_REDIS_URL, UPSTASH_REDIS_REST_URL: REMOTE_REST_URL, UPSTASH_REDIS_REST_TOKEN: 'guard-test-token',
  })

  // Importing with remote hosts already set must not throw: the guard runs on first use.
  let importFailed = false
  let healthMod: HealthMod | null = null, rlMod: RateLimitMod | null = null, redisMod: RedisMod | null = null
  try {
    healthMod = await import('../lib/health') as unknown as HealthMod
    rlMod = await import('../lib/ratelimit') as unknown as RateLimitMod
    redisMod = await import('../lib/redis') as unknown as RedisMod
  } catch { importFailed = true }
  assert(!importFailed && !!healthMod && !!rlMod && !!redisMod,
    'importing lib/health, lib/ratelimit and lib/redis with remote hosts set does not throw (the guard runs on first use, not at import)')

  // Vendor auth cache.
  if (redisMod) {
    const g = globalThis as unknown as { __redis?: unknown }
    g.__redis = undefined
    capture()
    const remoteClient = redisMod.getRedis()
    release()
    assert(remoteClient === null && refusedBy('[Redis]') && !leaked(),
      'vendor auth cache: a remote Upstash address → no client (null, so callers read the database); refusal logged with the host only')
    g.__redis = undefined
    setEnv({ UPSTASH_REDIS_REST_URL: 'http://localhost:58080' })
    assert(redisMod.getRedis() !== null, 'vendor auth cache: the local test stand-in → a client (allowed)')
    g.__redis = undefined
    setEnv({ UPSTASH_REDIS_REST_URL: REMOTE_REST_URL })
  }

  // Rate limiter.
  if (rlMod) {
    rlMod.__resetForTest()
    capture()
    let rlThrew = false
    let closed = { allowed: true, headers: {} as Record<string, string> }
    let open = { allowed: false, headers: {} as Record<string, string> }
    try {
      closed = await rlMod.enforceRateLimit('prod-db-guard-test', 'orderCreate', { failClosed: true })
      open = await rlMod.enforceRateLimit('prod-db-guard-test', 'orderCreate')
    } catch { rlThrew = true }
    release()
    assert(!rlThrew && refusedBy('[Ratelimit]') && !leaked(),
      'rate limiter: a remote Upstash address is refused on first use, logged with the host only; nothing throws')
    assert(!closed.allowed && open.allowed && Object.keys(open.headers).length === 0,
      'rate limiter: refused = disabled — a failClosed route refuses, any other passes with no limiter headers')
    rlMod.__resetForTest()
    const savedUrl = savedEnv.UPSTASH_REDIS_REST_URL
    setEnv({
      UPSTASH_REDIS_REST_URL: savedUrl && isLocalHost(savedUrl) ? savedUrl : 'http://localhost:58080',
      UPSTASH_REDIS_REST_TOKEN: savedEnv.UPSTASH_REDIS_REST_TOKEN ?? 'guard-test-token',
    })
    capture()
    try { await rlMod.enforceRateLimit('prod-db-guard-test-local', 'publicAnonymous') } catch { /* reachability is not under test here */ }
    release()
    assert(!logged.some(l => l.includes('REFUSING')), 'rate limiter: the local test stand-in is allowed (no refusal)')
    rlMod.__resetForTest()
    setEnv({ UPSTASH_REDIS_REST_URL: REMOTE_REST_URL, UPSTASH_REDIS_REST_TOKEN: 'guard-test-token' })
  }

  // Health check and sweep heartbeat: a refused Redis is reported, never thrown.
  if (healthMod) {
    capture()
    let report: { status: string; redis: string } | null = null
    let healthThrew = false
    try { report = await healthMod.runHealthChecks() } catch { healthThrew = true }
    let heartbeatThrew = false
    try { await healthMod.recordSweepHeartbeat() } catch { heartbeatThrew = true }
    release()
    assert(!healthThrew && report?.redis === 'refused' && report.status === 'degraded',
      `health: a refused Redis reports redis 'refused' and status 'degraded', and does not throw (got ${report?.redis ?? 'none'} / ${report?.status ?? 'none'})`)
    assert(!heartbeatThrew && refusedBy('[Health]') && !leaked(),
      'health/heartbeat: the refusal is logged with the host only; the heartbeat write skips without throwing')
    const pub = report ? healthMod.publicHealthBody(report, 'x') : null
    assert(pub?.status === 'degraded' && pub.checks.redis === 'fail', 'public /api/health body: status degraded, redis fail')
    assert(healthMod.computeHealth({ database: 'ok', redis: 'refused', lastSweepAt: null, migrations: { status: 'ok', pending: [] } }).status === 'degraded',
      "computeHealth: redis 'refused' alone makes the report degraded")
  }

  setEnv(savedEnv)
  // lib/health loaded lib/db; close its connection so this process can exit.
  try {
    const dbMod = await import('../lib/db') as unknown as { db: { $disconnect: () => Promise<void> } }
    await dbMod.db.$disconnect()
  } catch { /* nothing to close */ }
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
