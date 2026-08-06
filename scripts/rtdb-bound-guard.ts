/**
 * EVERY REALTIME-DB READ IS BOUNDED. The guard that would have caught the original regression.
 *
 * THE BUG IT PINS. `rtdb.ref(...).get()` is the one external call in the dashboard request path,
 * and on a cold serverless start establishing a fresh authenticated RTDB connection can HANG
 * rather than error. A hang never rejects, so the try/catch wrapped around it is dead code
 * against exactly the failure it looks like it handles. The admin dashboard 504'd on prod for
 * this reason and was fixed — by wrapping THAT ONE CALL SITE. The two organizer routes were
 * hand-copied from the same original, never got the wrap, and kept hanging until
 * FUNCTION_INVOCATION_TIMEOUT. Three copies of a safety wrap is three chances to fix two.
 *
 * SO THE RULE IS STRUCTURAL, NOT STYLISTIC: no route may call rtdb.ref(...).get()/.once() at all.
 * The bound lives in ONE function, lib/heartbeat-read.ts, and every caller goes through it. That
 * is a property this guard can check by reading the source — which a runtime test cannot do,
 * because the hang only reproduces on a cold serverless container talking to a real Firebase.
 *
 * WHAT THIS CANNOT SEE: whether the timeout is the right length, or whether Firebase is actually
 * reachable. It proves no unbounded read site exists. That is the regression that shipped.
 *
 * Run: npx tsx scripts/rtdb-bound-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** The single sanctioned home of the bound. Everything else must delegate to it. */
const BOUND_MODULE = 'lib/heartbeat-read.ts'

/** An RTDB READ — the shape that can hang. Writes are fire-and-forget and bounded elsewhere. */
const RTDB_READ = /\.ref\s*\([^)]*\)\s*\.\s*(?:get|once)\s*\(/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

/** Strip comments — a doc block that DESCRIBES an unbounded read is not an unbounded read.
 *  This suite has been bitten three times by grepping prose; see test-probe-positive-control. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Returns the offending file:line list for a given source body. */
function unboundedReadSites(path: string, src: string): string[] {
  const hits: string[] = []
  code(src).split('\n').forEach((line, i) => {
    if (RTDB_READ.test(line)) hits.push(`${path}:${i + 1}`)
  })
  return hits
}

function main() {
  const files = [...walk('app'), ...walk('lib')]

  // ── [0] PROBE BASELINE ──────────────────────────────────────────────────────
  // Before "no offenders" can mean anything, prove the detector recognises the shape at all.
  console.log('\n[0] the detector recognises an unbounded RTDB read (baseline — not a feature test)')
  assert(RTDB_READ.test(`const snap = await rtdb.ref(\`fairs/\${id}/heartbeats\`).get()`),
    'detects the exact call that shipped the bug (.ref(...).get())')
  assert(RTDB_READ.test(`await db.ref('x').once('value')`), 'detects the .once() form too')
  assert(!RTDB_READ.test(`const heartbeats = await boundedHeartbeatRead(event.id)`),
    'does NOT fire on the sanctioned helper call — otherwise every fixed route would look broken')
  assert(!RTDB_READ.test(`rtdb.ref(path).update(data)`), 'does not fire on WRITES (a different path)')
  assert(files.length > 50, `the walker actually found source files (${files.length}) — not scanning an empty set`)

  // ── [1] THE INVARIANT ───────────────────────────────────────────────────────
  console.log('\n[1] ⛔ no route or lib performs an unbounded RTDB read')
  const offenders: string[] = []
  for (const f of files) {
    const rel = f.replace(/\\/g, '/')
    if (rel === BOUND_MODULE) continue // the one place the raw call is allowed
    offenders.push(...unboundedReadSites(rel, readFileSync(f, 'utf8')))
  }
  assert(offenders.length === 0,
    offenders.length
      ? `UNBOUNDED RTDB READ — wrap via boundedHeartbeatRead(): ${offenders.join(', ')}`
      : 'every RTDB read goes through the bounded helper')

  // ── [2] THE BOUND ITSELF IS REAL ────────────────────────────────────────────
  console.log('\n[2] the sanctioned helper is actually bounded')
  const boundSrc = readFileSync(BOUND_MODULE, 'utf8')
  const boundCode = code(boundSrc)
  assert(RTDB_READ.test(boundCode), `positive control: ${BOUND_MODULE} DOES contain the raw read — so [1]'s exemption is load-bearing, not decorative`)
  assert(/Promise\.race\(/.test(boundCode), 'the read is raced against a timeout')
  assert(/setTimeout\(/.test(boundCode), 'the race has a real timer')
  assert(/clearTimeout\(/.test(boundCode), 'the losing timer is cleared — a won race must not hold the function alive')
  const ms = boundCode.match(/HEARTBEAT_TIMEOUT_MS\s*=\s*(\d+)/)
  assert(!!ms && Number(ms[1]) > 0 && Number(ms[1]) <= 5000,
    `the timeout is a sane page-facing bound (got ${ms?.[1] ?? 'none'}ms, must be 1–5000)`)
  assert(/return \{\}/.test(boundCode) && !/throw /.test(boundCode),
    'it always resolves and never throws — callers degrade to the DB fallback rather than 500')

  // ── [3] EVERY CALLER STILL HAS THE DB FALLBACK ──────────────────────────────
  // The bound is only half the fix. If a caller stopped falling back to lastHeartbeatAt, a
  // timeout would trade a hang for a BLANK vendor grid — fixed-looking, still broken.
  console.log('\n[3] every caller degrades to the DB heartbeat, so a timeout is not a blank grid')
  const callers = files.filter(f => /boundedHeartbeatRead\(/.test(code(readFileSync(f, 'utf8'))))
    .map(f => f.replace(/\\/g, '/'))
    .filter(f => f !== BOUND_MODULE)
  assert(callers.length === 3, `all three dashboard-class routes use the helper (found ${callers.length}: ${callers.join(', ')})`)
  for (const c of callers) {
    const src = code(readFileSync(c, 'utf8'))
    assert(/heartbeats\[[^\]]+\]\s*\?\?/.test(src) && /lastHeartbeatAt/.test(src),
      `${c.split('/').slice(-3).join('/')} falls through to lastHeartbeatAt when the map is empty`)
  }

  // ── [4] THE POLL CANNOT STACK ───────────────────────────────────────────────
  // Bounding the route without this only trades "one request hangs forever" for "a fresh doomed
  // request every 30s".
  console.log('\n[4] the organizer overview poll cannot stack requests')
  const page = code(readFileSync('app/organizer/fairs/[fairSlug]/page.tsx', 'utf8'))
  assert(/setInterval\(/.test(page), 'probe anchor: the page really does poll on a timer')
  assert(/inFlightRef/.test(page), 'an in-flight guard exists')
  assert(/if \(inFlightRef\.current\)/.test(page), 'the guard is CHECKED before firing, not merely declared')
  assert(/new AbortController\(\)/.test(page) && /signal: controller\.signal/.test(page),
    'the request is abortable and the signal is actually passed to fetch')

  console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exit(1)
}

main()
