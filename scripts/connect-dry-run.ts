/**
 * SEALED DRY RUN of the readiness-1.4 payout-gate writer (lib/connect-status.applyConnectStatus)
 * against a real database — answers "what will the first Connect event or status read do to each
 * payee after the deploy?" before it can. Template: scripts/owed-back-dry-run.ts.
 *
 * Seals, each proven by a control BEFORE any payee is read (the run aborts if one fails):
 *   1. Postgres: ONE connection (session pooler, connection_limit=1) set read-only right after it
 *      opens. Controls: the server must REFUSE a zero-row UPDATE, and at the end the SAME backend
 *      pid must still be read-only.
 *   2. Prisma: a middleware rejects every write action. Control: a write must throw before SQL.
 *   3. Stripe: every method on every resource we could reach is replaced with a throw, except
 *      stripeConnect.v2.core.accounts.retrieve (the live status read). Controls: a transfer and
 *      an account-link create must throw.
 *   4. Queue: REDIS_URL is cleared, and the writer runs with dryRun: true, which returns before
 *      any update or enqueue.
 * PayeeNotice does not exist in production before 20261020120000 is applied, i.e. no notice has
 * ever been sent; while the table is absent the shim answers its one read (findFirst) with null.
 *
 * Run (production):
 *   CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx tsx scripts/connect-dry-run.ts [--out file.md]
 * STRIPE_SECRET_KEY is read from .env.prod.local (only that variable) and must be a test key.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

class SealBroken extends Error {}
const die = (m: string): never => { console.error(`🛑 ${m}`); process.exit(3) }

const direct = process.env.DIRECT_URL || die('DIRECT_URL not set (run through scripts/with-prod-db.sh)')
const sealedUrl = new URL(direct)
sealedUrl.searchParams.set('connection_limit', '1')
sealedUrl.searchParams.delete('pgbouncer')
process.env.DATABASE_URL = sealedUrl.toString()
process.env.REDIS_URL = ''

if (existsSync('.env.prod.local')) {
  const line = readFileSync('.env.prod.local', 'utf8').split('\n').find(l => /^STRIPE_SECRET_KEY\s*=/.test(l))
  if (line) process.env.STRIPE_SECRET_KEY = line.replace(/^STRIPE_SECRET_KEY\s*=\s*/, '').replace(/^"(.*)"$/, '$1').trim()
}
if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) die('STRIPE_SECRET_KEY missing or not a test key — refusing')

const WRITE_ACTIONS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'executeRaw', 'executeRawUnsafe'])
const stripeReads: string[] = []

function seal(api: Record<string, unknown>, label: string, allow: string[] = []) {
  const proto = Object.getPrototypeOf(api)
  const names = new Set([...Object.keys(api), ...Object.getOwnPropertyNames(proto)].filter(n => n !== 'constructor' && typeof api[n] === 'function'))
  for (const n of names) {
    const real = api[n] as (...a: unknown[]) => unknown
    api[n] = allow.includes(n)
      ? (...a: unknown[]) => { stripeReads.push(`${label}.${n}`); return real.apply(api, a) }
      : () => { throw new SealBroken(`SEALED: blocked ${label}.${n}`) }
  }
}

async function main() {
  const outIdx = process.argv.indexOf('--out')
  const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null

  const { db } = await import('../lib/db')
  const { stripe } = await import('../lib/stripe')
  const { stripeConnect, getConnectStatus } = await import('../lib/stripe-connect')

  await db.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
  await db.$executeRawUnsafe('SET default_transaction_read_only = on')
  const pidOf = async () => (await db.$queryRawUnsafe<{ pid: number }[]>('SELECT pg_backend_pid() AS pid'))[0].pid
  const sealedPid = await pidOf()

  const noticeTable = (await db.$queryRawUnsafe<{ t: string | null }[]>(`SELECT to_regclass('public."PayeeNotice"')::text AS t`))[0].t
  const shim = noticeTable === null
  let shimHits = 0

  // ── Seal 2: Prisma ───────────────────────────────────────────────────────────
  db.$use(async (params, next) => {
    if (WRITE_ACTIONS.has(params.action)) throw new SealBroken(`SEALED: blocked ${params.model ?? ''}.${params.action}`)
    if (shim && params.model === 'PayeeNotice') {
      if (params.action !== 'findFirst') throw new SealBroken(`SEALED: PayeeNotice.${params.action} while the table is absent`)
      shimHits++
      return null
    }
    return next(params)
  })

  // ── Seal 3: Stripe ───────────────────────────────────────────────────────────
  const v1 = ['transfers', 'refunds', 'payouts', 'accounts', 'accountLinks', 'charges', 'paymentIntents', 'customers', 'disputes', 'balance']
  for (const client of [stripe as unknown as Record<string, Record<string, unknown>>, stripeConnect as unknown as Record<string, Record<string, unknown>>]) {
    for (const r of v1) if (client[r]) seal(client[r], `stripe.${r}`)
  }
  const core = (stripeConnect as any).v2.core
  seal(core.accounts, 'v2.core.accounts', ['retrieve'])
  seal(core.accountLinks, 'v2.core.accountLinks')
  seal(core.events, 'v2.core.events')

  // ── Controls ─────────────────────────────────────────────────────────────────
  console.log('[controls]')
  const ro = await db.$queryRawUnsafe<{ default_transaction_read_only: string }[]>('SHOW default_transaction_read_only')
  if (ro[0]?.default_transaction_read_only !== 'on') die(`C1 session not read-only (${JSON.stringify(ro)})`)
  console.log('  ✅ C1 Postgres session is read-only')
  let c2 = ''
  try { await db.$queryRawUnsafe('UPDATE "Vendor" SET "stripeVerified" = "stripeVerified" WHERE false') } catch (e) { c2 = String(e) }
  if (!/read-only transaction/i.test(c2)) die(`C2 server did NOT refuse a write: ${c2 || 'no error'}`)
  console.log('  ✅ C2 server refuses a zero-row UPDATE ("read-only transaction")')
  let c3 = false
  try { await db.vendor.updateMany({ where: { id: '__sealed_control__' }, data: { stripeVerified: true } }) } catch (e) { c3 = e instanceof SealBroken }
  if (!c3) die('C3 Prisma write was not blocked by the middleware')
  console.log('  ✅ C3 Prisma write blocked before SQL')
  let c4 = false, c4b = false
  try { await (stripe.transfers.create as unknown as () => Promise<unknown>)() } catch (e) { c4 = e instanceof SealBroken }
  try { await core.accountLinks.create() } catch (e) { c4b = e instanceof SealBroken }
  if (!c4 || !c4b) die('C4 a Stripe write was not blocked')
  console.log('  ✅ C4 stripe.transfers.create and v2.core.accountLinks.create blocked')

  const { applyConnectStatus } = await import('../lib/connect-status')
  const { deriveConnectCardState } = await import('../lib/connect-card-state')

  const payees = [
    ...(await db.vendor.findMany({ where: { stripeAccountId: { not: null } }, select: { id: true, name: true, stripeAccountId: true, stripeVerified: true, stripeConnectedAt: true } })).map(p => ({ kind: 'vendor' as const, ...p })),
    ...(await db.runner.findMany({ where: { stripeAccountId: { not: null } }, select: { id: true, stripeAccountId: true, stripeVerified: true, stripeConnectedAt: true, user: { select: { name: true } } } })).map(p => ({ kind: 'runner' as const, ...p, name: p.user?.name ?? 'runner' })),
    ...(await db.fairOrganizer.findMany({ where: { stripeAccountId: { not: null } }, select: { id: true, name: true, stripeAccountId: true, stripeVerified: true, stripeConnectedAt: true } })).map(p => ({ kind: 'organizer' as const, ...p })),
  ]

  const lines: string[] = []
  const say = (s: string) => { console.log(s); lines.push(s) }
  say(`# Connect payout-gate dry run — ${new Date().toISOString()}`)
  say('')
  say('| Payee | Kind | DB gate | Stripe now | Card | First event / status read would | Notice | Re-check |')
  say('|---|---|---|---|---|---|---|---|')
  const tally = { activated: 0, deactivated: 0, none: 0, notices: 0, rechecks: 0, errors: 0 }
  for (const p of payees) {
    try {
      const live = await getConnectStatus(p.stripeAccountId!)
      const t = await applyConnectStatus(p.kind, p.id, live.readyToReceivePayments, { source: 'dry-run', dryRun: true })
      tally[t.transition]++
      const notice = t.transition === 'activated' ? t.notice : null
      if (notice) tally.notices++
      if (t.transition === 'deactivated') tally.rechecks++
      const card = deriveConnectCardState({ connected: true, ...live })
      say(`| ${p.name} | ${p.kind} | ${p.stripeVerified ? 'open' : 'closed'} | ${live.readyToReceivePayments ? 'transfers active' : 'not active'} | ${card} | ${t.transition === 'none' ? 'nothing' : t.transition} | ${notice ?? '—'} | ${t.transition === 'deactivated' ? 'yes, 10 min' : '—'} |`)
    } catch (e) {
      if (e instanceof SealBroken) die(String(e))
      tally.errors++
      say(`| ${p.name} | ${p.kind} | ${p.stripeVerified ? 'open' : 'closed'} | ERROR: ${String(e).slice(0, 80)} | | | | |`)
    }
  }
  say('')
  // B2 positive control: the probe can see a change. Same writer, dry, asked about the first
  // payee with ready=false — an open gate must come back "deactivated". Proves the zeros above
  // are an answer, not a probe that can only say "nothing".
  const probe = payees.find(p => p.stripeVerified)
  if (probe) {
    const pt = await applyConnectStatus(probe.kind, probe.id, false, { source: 'dry-run', dryRun: true })
    if (pt.transition !== 'deactivated') die(`B2 positive control failed: expected "deactivated", got "${pt.transition}"`)
    say(`B2 positive control ✅ the same probe, asked about ${probe.kind} "${probe.name}" with Stripe NOT ready, answers "would close the gate".`)
  }
  say(`Totals: ${payees.length} payees · would open the gate: ${tally.activated} · would close it: ${tally.deactivated} · no change: ${tally.none} · notices: ${tally.notices} · re-check jobs: ${tally.rechecks} · Stripe read errors: ${tally.errors}`)
  if (shim) say(`PayeeNotice table absent (pre-migration): shim answered ${shimHits} notice lookup(s) with "none sent yet".`)

  console.log('[controls, end]')
  const endRo = await db.$queryRawUnsafe<{ default_transaction_read_only: string }[]>('SHOW default_transaction_read_only')
  const endPid = await pidOf()
  if (endPid !== sealedPid || endRo[0]?.default_transaction_read_only !== 'on') die(`C5 connection changed or lost read-only (pid ${sealedPid} → ${endPid}) — discard this run`)
  console.log(`  ✅ C5 whole run on the same read-only backend (pid ${sealedPid})`)
  say(`Seals: Postgres read-only, one backend pid ${sealedPid} start→end ✅ · Prisma writes blocked ✅ · Stripe writes blocked ✅ · Stripe reads made: ${stripeReads.length} (${[...new Set(stripeReads)].join(', ') || 'none'})`)

  if (outFile) writeFileSync(outFile, lines.join('\n') + '\n')
  await db.$disconnect()
}

main().catch(err => { console.error(err instanceof SealBroken ? `🛑 ${err.message}` : err); process.exit(err instanceof SealBroken ? 3 : 1) })
