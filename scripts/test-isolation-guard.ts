/**
 * TEST-ISOLATION GUARD — production must be UNREACHABLE from a gate suite.
 *
 * WHY THE CAUSE, NOT THE SYMPTOM. The tempting assertion is "no suite wrote to production."
 * That is a symptom check: it passes on every run where nothing happened to go wrong, and it
 * only fails AFTER the damage. This asserts the structural property instead — that a gate
 * suite has no route to a production connection string:
 *
 *   1. TEST_DATABASE_URL is set, is not production, and is not either production variable.
 *   2. No gate suite constructs a client from DATABASE_URL / DIRECT_URL.
 *   3. The resolver REFUSES rather than falling back — proven by calling it, not by reading it.
 *   4. lib/db's redirect is opt-in and is inert when NODE_ENV=production.
 *
 * [0] POSITIVE CONTROLS FIRST, on the resolver itself.
 *
 * Run: npx tsx scripts/test-isolation-guard.ts
 */

import { readFileSync, readdirSync } from 'fs'
import { resolveTestDatabaseUrl, resolveToolingDatabaseUrl, TestDatabaseMisconfigured } from '../lib/test-db'
import { resolveAppDatabaseUrl } from '../lib/db'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}
function refuses(env: Record<string, string | undefined>): boolean {
  try { resolveTestDatabaseUrl(env); return false }
  catch (e) { return e instanceof TestDatabaseMisconfigured }
}

console.log('\n════ TEST-ISOLATION GUARD ════')

// ── [0] the resolver refuses every way back to production ────────────────────
console.log('\n[0] POSITIVE CONTROLS: the resolver REFUSES, it does not fall back')
const PROD = 'postgresql://u:p@aws-1-us-east-1.pooler.supabase.com:6543/postgres'
const TEST = 'postgresql://fairsynq:fairsynq@localhost:55432/fairsynq_test'

assert(refuses({ DATABASE_URL: PROD }),
  'TEST_DATABASE_URL unset → THROWS (never silently uses DATABASE_URL — the whole point)')
assert(refuses({ TEST_DATABASE_URL: PROD }),
  'TEST_DATABASE_URL pointing at a Supabase host → THROWS')
assert(refuses({ TEST_DATABASE_URL: PROD, DATABASE_URL: PROD }),
  'TEST_DATABASE_URL identical to DATABASE_URL → THROWS')
// Equality with a NON-LOCAL value is the failure; equality with a local one is the CORRECT
// state under scripts/with-test-db.sh, which sets all three from a single source precisely
// because Prisma's CLI reads directUrl and a partial env falls through to .env.local.
assert(refuses({ TEST_DATABASE_URL: 'postgresql://u:p@db.example.net:5432/x', DIRECT_URL: 'postgresql://u:p@db.example.net:5432/x' }),
  'TEST_DATABASE_URL identical to DIRECT_URL on a NON-LOCAL host → THROWS')
assert(resolveTestDatabaseUrl({ TEST_DATABASE_URL: TEST, DATABASE_URL: TEST, DIRECT_URL: TEST }) === TEST,
  'all three identical AND local → ACCEPTED (this is exactly what the wrapper does)')
assert(resolveTestDatabaseUrl({ TEST_DATABASE_URL: TEST, DATABASE_URL: PROD }) === TEST,
  'a genuine local test URL is ACCEPTED (the probe is not just refusing everything)')

// ── [1] this process is actually pointed at a test database ──────────────────
console.log('\n[1] the RUNNING environment is isolated')
let live = ''
try { live = resolveTestDatabaseUrl(process.env); assert(true, 'TEST_DATABASE_URL resolves for this run') }
catch (e) { assert(false, `TEST_DATABASE_URL does not resolve: ${(e as Error).message.split('\n')[0]}`) }
if (live) {
  const h = new URL(live).hostname
  assert(['localhost', '127.0.0.1', 'fairsynq-test-db'].includes(h), `test DB host is local (${h})`)
}

// ── [2] no gate suite constructs a client from a production variable ─────────
console.log('\n[2] no GATE suite can construct a production client')
const registered = [...readFileSync('scripts/verify-all.ts', 'utf8')
  .matchAll(/file: 'scripts\/([^']+\.ts)'/g)].map(m => m[1])
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const offenders: string[] = []
for (const f of registered) {
  let src: string
  try { src = stripComments(readFileSync(`scripts/${f}`, 'utf8')) } catch { continue }
  if (/process\.env\.(DATABASE_URL|DIRECT_URL)/.test(src)) offenders.push(f)
}
assert(offenders.length === 0,
  `no registered suite references DATABASE_URL/DIRECT_URL (offenders: ${offenders.join(', ') || 'none'})`)

const rawClients = registered.filter(f => {
  try { return /new PrismaClient\(/.test(stripComments(readFileSync(`scripts/${f}`, 'utf8'))) } catch { return false }
})
assert(rawClients.length === 0,
  `no registered suite constructs a bare PrismaClient (must go through testPrisma/guardedPrisma) (offenders: ${rawClients.join(', ') || 'none'})`)

// ── [3] the app singleton's redirect is opt-in and prod-inert ────────────────
console.log('\n[3] lib/db redirects ONLY outside production, and only when asked')
const dbSrc = stripComments(readFileSync('lib/db.ts', 'utf8'))
// Keyed on STRUCTURE, not on a literal condition string — the previous version of this
// assertion scanned for the exact text `NODE_ENV !== 'production' && …` and broke the moment
// the logic was extracted into a function, without the behaviour changing at all. Shape, not
// spelling: buildDatabaseUrl must delegate to the pure resolver, whose behaviour §[4] proves.
assert(/const redirected = resolveAppDatabaseUrl\(process\.env\)/.test(dbSrc),
  'buildDatabaseUrl delegates to resolveAppDatabaseUrl (the single, tested decision)')
assert(!/process\.env\.TEST_DATABASE_URL/.test(dbSrc.replace(/export function resolveAppDatabaseUrl[\s\S]*?\n\}/, '')),
  'no OTHER place in lib/db reads TEST_DATABASE_URL — one decision point, not two')
assert(!/TEST_DATABASE_URL\s*\?\?\s*process\.env\.DATABASE_URL/.test(dbSrc),
  'lib/db contains no TEST_DATABASE_URL ?? DATABASE_URL fallback')
const tdbSrc = stripComments(readFileSync('lib/test-db.ts', 'utf8'))
assert(!/\?\?\s*(process\.env\.)?(DATABASE_URL|DIRECT_URL)/.test(tdbSrc),
  'lib/test-db contains NO fallback to either production variable (the load-bearing line)')

// ── [4] THE INVERSE DIRECTION — production must NEVER be redirected ──────────
// The danger nobody guards for. §[0]-[3] prove a suite cannot reach production. This proves
// the opposite: that production cannot be pointed at a test database. If this condition ever
// inverts, live orders start landing in an ephemeral container — a worse outcome than the one
// this change exists to prevent, and one that would look like data simply vanishing.
console.log('\n[4] POSITIVE CONTROL (inverse): production is NEVER redirected to a test DB')
assert(resolveAppDatabaseUrl({ NODE_ENV: 'production', TEST_DATABASE_URL: TEST, DATABASE_URL: PROD }) === null,
  'NODE_ENV=production + TEST_DATABASE_URL present → redirect is INERT (the load-bearing case)')
assert(resolveAppDatabaseUrl({ NODE_ENV: 'production', DATABASE_URL: PROD }) === null,
  'NODE_ENV=production without TEST_DATABASE_URL → inert')
assert(resolveAppDatabaseUrl({ NODE_ENV: 'development', DATABASE_URL: PROD }) === null,
  'no TEST_DATABASE_URL → inert even outside production (opt-in, never automatic)')
assert(resolveAppDatabaseUrl({ NODE_ENV: 'development', TEST_DATABASE_URL: TEST }) === TEST,
  'dev + explicit TEST_DATABASE_URL → redirects (proves the control is not just returning null)')
assert(resolveAppDatabaseUrl({ NODE_ENV: 'test', TEST_DATABASE_URL: TEST }) === TEST,
  'NODE_ENV=test + explicit opt-in → redirects')

// ── [5] THE PRISMA CLI PATH — the gap that let a resolve reach production ────
// §[2] scans SUITE files. It did NOT scan the shared helpers those suites import, and it
// knows nothing about the Prisma CLI, which connects through schema.prisma's `directUrl`
// rather than `url`. Both gaps were live: guardedPrisma resolved `DIRECT_URL ?? DATABASE_URL`
// to PRODUCTION on every isolated gate run, and `DATABASE_URL=<local> prisma migrate resolve`
// silently used the production directUrl. Closed here.
console.log('\n[5] the PRISMA CLI path and shared helpers cannot resolve to production')

const schemaSrc = readFileSync('prisma/schema.prisma', 'utf8')
assert(/directUrl\s*=\s*env\("DIRECT_URL"\)/.test(schemaSrc),
  'schema.prisma still declares directUrl — so DIRECT_URL must be set for EVERY prisma CLI call')

// Every npm script that invokes the prisma CLI must go through the one wrapper, which sets all
// three variables from a single value. A script setting only DATABASE_URL is the incident shape.
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
const cliScripts = Object.entries(pkg.scripts).filter(([, v]) => /prisma\s+(migrate|db)\b/.test(v))
const unwrapped = cliScripts.filter(([, v]) => !v.includes('with-test-db.sh'))
assert(cliScripts.length > 0, `[0] POSITIVE CONTROL: found ${cliScripts.length} prisma-CLI npm script(s) to check (not vacuous)`)
assert(unwrapped.length === 0,
  `every prisma-CLI npm script goes through scripts/with-test-db.sh (unwrapped: ${unwrapped.map(([k]) => k).join(', ') || 'none'})`)

// The wrapper must set all three, from one value — omitting DIRECT_URL is the exact bug.
const wrapper = readFileSync('scripts/with-test-db.sh', 'utf8')
for (const v of ['DATABASE_URL', 'DIRECT_URL', 'TEST_DATABASE_URL']) {
  assert(new RegExp(`${v}="\\$TEST_DB"`).test(wrapper), `the wrapper sets ${v} from the single source`)
}
assert(/REFUSING/.test(wrapper) && /localhost\|127\.0\.0\.1/.test(wrapper),
  'the wrapper REFUSES a non-local host rather than trusting the caller')

// Shared helpers that gate suites construct clients through must honour TEST_DATABASE_URL.
const guardSrc = stripComments(readFileSync('lib/prod-write-guard.ts', 'utf8'))
assert(/resolveToolingDatabaseUrl\(process\.env\)/.test(guardSrc),
  'guardedPrisma resolves through resolveToolingDatabaseUrl (was DIRECT_URL ?? DATABASE_URL → production)')
assert(!/DIRECT_URL\s*\?\?\s*process\.env\.DATABASE_URL/.test(guardSrc),
  'guardedPrisma no longer contains the raw DIRECT_URL ?? DATABASE_URL fallback')
assert(resolveToolingDatabaseUrl({ TEST_DATABASE_URL: TEST, DIRECT_URL: PROD, DATABASE_URL: PROD }) === TEST,
  'TEST_DATABASE_URL WINS over DIRECT_URL/DATABASE_URL in the tooling resolver')
assert(resolveToolingDatabaseUrl({ DIRECT_URL: PROD }) === PROD,
  '[0] POSITIVE CONTROL: without TEST_DATABASE_URL it still reaches prod — prod ops keep working')

console.log('\n────────────────────────────────────')
console.log(failed === 0 ? `  ✅ ${passed} passed, 0 failed` : `  ❌ ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
