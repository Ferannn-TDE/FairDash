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
 *
 * Run: npx tsx scripts/prod-db-guard-test.ts
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

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
