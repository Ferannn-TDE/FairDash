/**
 * READ-ONLY queue inspection, raw Redis commands only.
 *
 * BullMQ's getJobCounts() runs an EVAL that Upstash rejects at its quota ceiling,
 * and that same Lua can RPOP a legacy marker. So we read the key structure
 * directly with LLEN / ZCARD / LRANGE / ZRANGE / HGETALL / HGET.
 * Every command below is read-only. Nothing is created, moved, or removed.
 * No Worker, no QueueScheduler, no promote / retry / drain / obliterate.
 *
 * TARGET IS EXPLICIT — there is no implicit fallback to .env.local, deliberately.
 * .env.local still points at the exhausted Upstash instance, and an accidental
 * run against it burns requests that are already unavailable. You must say where.
 *
 *   npx tsx scripts/step-b-inspect.ts --url 'redis://default:PASS@host:port'
 *   PROBE_REDIS_URL='redis://…' npx tsx scripts/step-b-inspect.ts
 *   npx tsx scripts/step-b-inspect.ts --env    # opt IN to .env.local's REDIS_URL
 *
 * Optional: --prefix bull,test   (default: both)
 *
 * Railway's TCP proxy is redis:// (not rediss://), so no TLS is applied — that is
 * expected for Railway, not a misconfiguration. TLS turns on only for rediss://.
 */

import Redis from 'ioredis'

const QUEUE = 'fairsynq-orders'
const argv = process.argv.slice(2)

function arg(name: string): string | undefined {
  const eq = argv.find(a => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

function resolveTarget(): string {
  const fromArg = arg('url')
  if (fromArg) return fromArg
  if (process.env.PROBE_REDIS_URL) return process.env.PROBE_REDIS_URL
  if (argv.includes('--env')) {
    // Opt-in only. Load .env.local lazily so the import has no side effect otherwise.
    require('dotenv').config({ path: '.env.local' })
    if (!process.env.REDIS_URL) {
      console.error('--env given but REDIS_URL is not set in .env.local')
      process.exit(1)
    }
    console.error('⚠️  Using .env.local REDIS_URL — verify this is not the exhausted Upstash instance.')
    return process.env.REDIS_URL
  }
  console.error(
    'No Redis target given. Pass --url <redis-url>, set PROBE_REDIS_URL, or --env to opt into .env.local.\n' +
    'Refusing to default to .env.local: it points at the exhausted Upstash instance.'
  )
  process.exit(1)
}

const u = new URL(resolveTarget())
const PREFIXES = (arg('prefix') ?? 'bull,test').split(',').map(s => s.trim()).filter(Boolean)

const r = new Redis({
  host: u.hostname,
  port: parseInt(u.port || '6379', 10),
  password: u.password ? decodeURIComponent(u.password) : undefined,
  username: u.username && u.username !== 'default' ? decodeURIComponent(u.username) : undefined,
  tls: u.protocol === 'rediss:' ? {} : undefined,
  maxRetriesPerRequest: 2,
  enableReadyCheck: false,
  lazyConnect: true,
})

const now = Date.now()
const iso = (t: number) => new Date(t).toISOString()
const ago = (t: number) => {
  const s = Math.round((now - t) / 1000)
  const a = Math.abs(s)
  const d = a >= 86400 ? `${(a / 86400).toFixed(1)}d` : a >= 3600 ? `${(a / 3600).toFixed(1)}h` : `${(a / 60).toFixed(1)}m`
  return s >= 0 ? `${d} ago` : `in ${d}`
}

interface JobRow {
  id: string
  name: string
  timestamp: number
  delay: number
  attemptsMade: number
  failedReason: string
  processedOn: string
  fireAt: number
  data: string
}

async function readJob(base: string, id: string, score?: number): Promise<JobRow> {
  const h = (await r.hgetall(`${base}${id}`)) as Record<string, string>
  const timestamp = Number(h.timestamp || 0)
  let delay = Number(h.delay || 0)
  if (!delay && h.opts) { try { delay = Number(JSON.parse(h.opts).delay || 0) } catch { delay = 0 } }
  // BullMQ delayed zset score = fireTime * 0x1000 + seq
  const fireAt = score !== undefined ? Math.floor(score / 4096) : timestamp + delay
  return {
    id,
    name: h.name || '(no name — job hash missing)',
    timestamp,
    delay,
    attemptsMade: Number(h.attemptsMade || h.atm || 0),
    failedReason: h.failedReason || '',
    processedOn: h.processedOn ? iso(Number(h.processedOn)) : 'null',
    fireAt,
    data: h.data || '',
  }
}

const LABELS: Record<string, string> = {
  bull: 'PRODUCTION — Vercel enqueues here (TEST_REDIS_PREFIX unset)',
  test: 'LOCAL TEST SESSIONS — no consumer reads this',
}

async function inspect(prefix: string, label = LABELS[prefix] ?? 'unlabelled namespace') {
  const base = `${prefix}:${QUEUE}:`
  console.log(`\n${'='.repeat(74)}`)
  console.log(`NAMESPACE prefix="${prefix}"  (${label})   queue=${QUEUE}`)
  console.log('='.repeat(74))

  // THE SIGNAL. BullMQ increments :id on every add() and never deletes it.
  // Present ⇒ at least one job has been enqueued under this prefix, ever.
  // Absent  ⇒ no add() has EVER succeeded here — a strictly stronger statement
  //           than "the queue is empty right now". Do not conflate the two.
  const idCounter = await r.get(`${base}id`)
  console.log(`\n[:id counter] ${idCounter ?? 'ABSENT — no add() has ever succeeded under this prefix'}`)

  const [wait, active, delayed, failed, completed, paused, prioritized] = await Promise.all([
    r.llen(`${base}wait`),
    r.llen(`${base}active`),
    r.zcard(`${base}delayed`),
    r.zcard(`${base}failed`),
    r.zcard(`${base}completed`),
    r.llen(`${base}paused`),
    r.zcard(`${base}prioritized`),
  ])
  const metaPaused = await r.hget(`${base}meta`, 'paused')
  const metaExists = await r.exists(`${base}meta`)

  console.log(`\n[counts] waiting=${wait} active=${active} delayed=${delayed} failed=${failed} completed=${completed} paused=${paused} prioritized=${prioritized}`)
  console.log(`[isPaused] ${metaPaused === '1' ? 'TRUE' : 'false'}   (meta key exists=${metaExists === 1})`)

  const names: Record<string, number> = {}
  const tally = (j: JobRow) => { names[j.name] = (names[j.name] || 0) + 1 }

  // ── waiting
  console.log(`\n[waiting] ${wait}`)
  if (wait > 0) {
    const ids = await r.lrange(`${base}wait`, 0, -1)
    const jobs = await Promise.all(ids.map((id) => readJob(base, id)))
    jobs.forEach(tally)
    const oldest = jobs.reduce((a, b) => (a.timestamp <= b.timestamp ? a : b))
    console.log(`  oldest: name=${oldest.name} id=${oldest.id} ts=${iso(oldest.timestamp)} (${ago(oldest.timestamp)}) attemptsMade=${oldest.attemptsMade}`)
  } else console.log('  none')

  // ── active  ← the one that matters
  console.log(`\n[active] ${active}`)
  if (active > 0) {
    const ids = await r.lrange(`${base}active`, 0, -1)
    const jobs = await Promise.all(ids.map((id) => readJob(base, id)))
    jobs.forEach(tally)
    for (const j of jobs) {
      console.log(`  *** name=${j.name} id=${j.id} ts=${iso(j.timestamp)} (${ago(j.timestamp)}) attemptsMade=${j.attemptsMade} processedOn=${j.processedOn}`)
      console.log(`      data=${j.data}`)
    }
  } else console.log('  none')

  // ── delayed
  console.log(`\n[delayed] ${delayed}`)
  if (delayed > 0) {
    const flat = await r.zrange(`${base}delayed`, 0, -1, 'WITHSCORES')
    const pairs: Array<[string, number]> = []
    for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i], Number(flat[i + 1])])
    const jobs = await Promise.all(pairs.map(([id, s]) => readJob(base, id, s)))
    jobs.forEach(tally)
    const byTs = [...jobs].sort((a, b) => a.timestamp - b.timestamp)
    const line = (t: string, j: JobRow) =>
      console.log(`  ${t}: name=${j.name} id=${j.id} enqueued=${iso(j.timestamp)} (${ago(j.timestamp)}) delay=${j.delay}ms fireAt=${iso(j.fireAt)} (${ago(j.fireAt)})`)
    line('oldest  ', byTs[0])
    line('newest  ', byTs[byTs.length - 1])
    const elapsed = jobs.filter((j) => j.fireAt <= now)
    console.log(`\n  >>> FIRE TIME ALREADY IN THE PAST: ${elapsed.length} of ${delayed}`)
    const eb: Record<string, number> = {}
    for (const j of elapsed) eb[j.name] = (eb[j.name] || 0) + 1
    console.log(`  >>> elapsed by job name: ${JSON.stringify(eb)}`)
    const fb: Record<string, number> = {}
    for (const j of jobs.filter((j) => j.fireAt > now)) fb[j.name] = (fb[j.name] || 0) + 1
    console.log(`  >>> still-future by job name: ${JSON.stringify(fb)}`)
  } else console.log('  none')

  // ── failed (bounded to 10)
  console.log(`\n[failed] ${failed} total, showing up to 10`)
  if (failed > 0) {
    const ids = await r.zrange(`${base}failed`, 0, 9)
    const jobs = await Promise.all(ids.map((id) => readJob(base, id)))
    jobs.forEach(tally)
    for (const j of jobs) {
      console.log(`  name=${j.name} id=${j.id} attemptsMade=${j.attemptsMade} ts=${iso(j.timestamp)} (${ago(j.timestamp)})`)
      console.log(`      failedReason=${j.failedReason.slice(0, 240)}`)
    }
  } else console.log('  none')

  console.log(`\n[distinct job names present] (waiting+active+delayed+failed-sampled)`)
  console.log(Object.keys(names).length ? '  ' + JSON.stringify(names) : '  none')
}

async function main() {
  await r.connect()
  console.log(
    `Redis host: ${u.hostname}:${u.port || 6379}  scheme=${u.protocol.replace(':', '')}  ` +
    `tls=${u.protocol === 'rediss:'}  dbsize=${await r.dbsize()}`
  )
  console.log(`prefixes: ${PREFIXES.join(', ')}`)
  for (const p of PREFIXES) await inspect(p)
  console.log('\nDone — read-only, no state modified.')
  r.disconnect()
}
main().catch((e) => { console.error(e); r.disconnect(); process.exit(1) })
