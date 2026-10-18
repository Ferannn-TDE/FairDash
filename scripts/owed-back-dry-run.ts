/**
 * SEALED DRY RUN of the owed-back sweep (Pattern R + L) against a real database — answers "what
 * will the FIRST live sweep do?" before it does it.
 *
 * Three seals, each proven by a control BEFORE any order is read (the run aborts if one fails):
 *   1. Postgres: ONE connection (session pooler, connection_limit=1) set read-only right after it
 *      opens (Supabase's pooler rejects the startup `options` parameter). Controls: the server must
 *      REFUSE a zero-row UPDATE, and at the end the SAME backend pid must still be read-only — a
 *      silent reconnect would show as a new pid and fail the run.
 *   2. Prisma: a middleware rejects every write action. Control: a write must throw before SQL.
 *   3. Stripe: every money-moving method is replaced with a throw. Only GET reads are allowed —
 *      charges.retrieve, refunds.list, paymentIntents.retrieve — because the decision needs the
 *      charge's refund list. Control: refunds.create must throw.
 * The sweep itself runs with dryRun: true, which returns before any write or refund.
 *
 * Run (production):
 *   CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx tsx scripts/owed-back-dry-run.ts [--out file.md]
 * STRIPE_SECRET_KEY is read from .env.prod.local (only that variable).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

class SealBroken extends Error {}
const die = (m: string): never => { console.error(`🛑 ${m}`); process.exit(3) }

// ── Seal 1: read-only Postgres session on the DIRECT url, one connection ──────
const direct = process.env.DIRECT_URL || die('DIRECT_URL not set (run through scripts/with-prod-db.sh)')
const sealedUrl = new URL(direct)
sealedUrl.searchParams.set('connection_limit', '1')
sealedUrl.searchParams.delete('pgbouncer')
process.env.DATABASE_URL = sealedUrl.toString()
process.env.REDIS_URL = ''

if (!process.env.STRIPE_SECRET_KEY && existsSync('.env.prod.local')) {
  const line = readFileSync('.env.prod.local', 'utf8').split('\n').find(l => /^STRIPE_SECRET_KEY\s*=/.test(l))
  if (line) process.env.STRIPE_SECRET_KEY = line.replace(/^STRIPE_SECRET_KEY\s*=\s*/, '').replace(/^"(.*)"$/, '$1').trim()
}
if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) die('STRIPE_SECRET_KEY missing or not a test key — refusing')

const WRITE_ACTIONS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'executeRaw', 'executeRawUnsafe'])
const STRIPE_READS: Record<string, string[]> = { charges: ['retrieve'], refunds: ['list'], paymentIntents: ['retrieve'] }
const stripeReads: string[] = []

async function main() {
  const outIdx = process.argv.indexOf('--out')
  const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null

  const { db } = await import('../lib/db')
  const { stripe } = await import('../lib/stripe')

  await db.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
  await db.$executeRawUnsafe('SET default_transaction_read_only = on')
  const pidOf = async () => (await db.$queryRawUnsafe<{ pid: number }[]>('SELECT pg_backend_pid() AS pid'))[0].pid
  const sealedPid = await pidOf()

  // PRE-MIGRATION SHIM. Before 20261019120000 is applied the OwedBackHalt table does not exist,
  // i.e. no order has a halt. The code's two references to it (the scan's NOT-resolved clause and
  // the executor's select) are then exactly equivalent to "no halt": strip them and report null.
  // Only active when the table is absent; reported in the output.
  const haltTable = (await db.$queryRawUnsafe<{ t: string | null }[]>(`SELECT to_regclass('public."OwedBackHalt"')::text AS t`))[0].t
  const shim = haltTable === null
  const stripHalt = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(stripHalt).filter(v => !(v && typeof v === 'object' && Object.keys(v as object).length === 0))
    if (!o || typeof o !== 'object' || o instanceof Date) return o
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === 'owedBackHalt') continue
      const sv = stripHalt(v)
      if (k === 'NOT' && sv && typeof sv === 'object' && !Array.isArray(sv) && Object.keys(sv as object).length === 0) continue
      out[k] = sv
    }
    return out
  }
  let shimHits = 0

  // ── Seal 2: Prisma middleware ────────────────────────────────────────────────
  db.$use(async (params, next) => {
    if (WRITE_ACTIONS.has(params.action)) throw new SealBroken(`SEALED: blocked ${params.model ?? ''}.${params.action}`)
    if (shim && params.model === 'Order' && JSON.stringify(params.args ?? {}).includes('owedBackHalt')) {
      shimHits++
      const wantsHalt = JSON.stringify(params.args?.select ?? {}).includes('owedBackHalt')
      const res = await next({ ...params, args: stripHalt(params.args) as typeof params.args })
      return wantsHalt && res && typeof res === 'object' ? { ...(res as object), owedBackHalt: null } : res
    }
    if (shim && params.model === 'OwedBackHalt') throw new SealBroken('SEALED: OwedBackHalt queried while the table is absent')
    return next(params)
  })

  // ── Seal 3: Stripe — replace every method on the resources we touch; allow listed GETs ──
  for (const resource of ['refunds', 'charges', 'paymentIntents', 'transfers', 'payouts', 'customers', 'disputes']) {
    const api = (stripe as unknown as Record<string, Record<string, unknown>>)[resource]
    const proto = Object.getPrototypeOf(api)
    const names = new Set([...Object.keys(api), ...Object.getOwnPropertyNames(proto)].filter(n => n !== 'constructor' && typeof api[n] === 'function'))
    for (const n of names) {
      const real = api[n] as (...a: unknown[]) => unknown
      api[n] = STRIPE_READS[resource]?.includes(n)
        ? (...a: unknown[]) => { stripeReads.push(`${resource}.${n}`); return real.apply(api, a) }
        : () => { throw new SealBroken(`SEALED: blocked stripe.${resource}.${n}`) }
    }
  }

  // ── Controls ─────────────────────────────────────────────────────────────────
  console.log('[controls]')
  const ro = await db.$queryRawUnsafe<{ default_transaction_read_only: string }[]>('SHOW default_transaction_read_only')
  if (ro[0]?.default_transaction_read_only !== 'on') die(`C1 session not read-only (${JSON.stringify(ro)})`)
  console.log('  ✅ C1 Postgres session is read-only')
  let c2 = ''
  try { await db.$queryRawUnsafe('UPDATE "Order" SET "tipRefundedAt" = "tipRefundedAt" WHERE false') } catch (e) { c2 = String(e) }
  if (!/read-only transaction/i.test(c2)) die(`C2 server did NOT refuse a write: ${c2 || 'no error'}`)
  console.log('  ✅ C2 server refuses a zero-row UPDATE ("read-only transaction")')
  let c3 = false
  try { await db.order.updateMany({ where: { id: '__sealed_control__' }, data: { voidReason: 'x' } }) } catch (e) { c3 = e instanceof SealBroken }
  if (!c3) die('C3 Prisma write was not blocked by the middleware')
  console.log('  ✅ C3 Prisma write blocked before SQL')
  let c4 = false
  try { await (stripe.refunds.create as unknown as () => Promise<unknown>)() } catch (e) { c4 = e instanceof SealBroken }
  if (!c4) die('C4 stripe.refunds.create was not blocked')
  console.log('  ✅ C4 stripe.refunds.create blocked')

  const T = await import('../lib/tip-refund')
  const cents = (v: number | null | undefined) => Math.round((v ?? 0) * 100)
  const money = (c: number) => `$${(c / 100).toFixed(2)}`
  const lines: string[] = []
  const say = (s = '') => { console.log(s); lines.push(s) }

  say(`# Owed-back sweep — sealed dry run`)
  say(`Run ${new Date().toISOString()} · fee cutoff OWED_BACK_FEE_FROM = ${T.OWED_BACK_FEE_FROM.toISOString()}`)
  if (shim) say('Migration not applied yet: OwedBackHalt is absent (= no halts); its two filters were treated as "no halt" (see shim note in the script).')
  say()

  // ── A. What the first live sweep would do (Pattern R, maxPerRun as live = 100) ──
  const candidates = await db.order.count({ where: T.owedBackCandidateWhere() })
  const sweep = await T.reconcileTipRefunds({ dryRun: true, maxPerRun: 100 })
  const meta = await db.order.findMany({
    where: { id: { in: (sweep.results ?? []).map(r => r.orderId) } },
    select: { id: true, cancelledAt: true, tip: true, deliveryFee: true, fulfillmentType: true, event: { select: { name: true } } },
  })
  const m = new Map(meta.map(o => [o.id, o]))
  say(`## A. First sweep (Pattern R): ${candidates} candidate order(s); live sweep takes up to 100`)
  say()
  say('| Order | Fair | Cancelled | Tip | Fee (owed part) | Would | Amount | Why |')
  say('|---|---|---|---|---|---|---|---|')
  for (const r of sweep.results ?? []) {
    const o = m.get(r.orderId)
    const feeOwed = o?.cancelledAt && o.cancelledAt >= T.OWED_BACK_FEE_FROM ? cents(o.deliveryFee) : 0
    say(`| ${r.orderId} | ${o?.event.name ?? '?'} | ${o?.cancelledAt?.toISOString() ?? '—'} | ${money(cents(o?.tip))} | ${money(cents(o?.deliveryFee))} (${money(feeOwed)}) | ${r.outcome}${r.haltReason ? ` ${r.haltReason}` : ''} | ${money(r.amountCents ?? 0)} | ${(r.detail ?? (r.refundId ? `adopts ${r.refundId}` : '')).replace(/\|/g, '/')} |`)
  }
  if (sweep.alerts.some(a => a.includes('SEALED'))) die(`a seal fired INSIDE the sweep — the dry run tried to write: ${sweep.alerts.filter(a => a.includes('SEALED')).join(' / ')}`)
  const failed = sweep.alerts.filter(a => a.includes('failed'))
  for (const a of failed) say(`- READ FAILED (would retry, no refund): ${a}`)
  const tot = (k: string) => (sweep.results ?? []).filter(r => r.outcome === k).reduce((s, r) => s + (r.amountCents ?? 0), 0)
  say()
  say(`Totals: refund ${(sweep.results ?? []).filter(r => r.outcome === 'refunded').length} order(s) ${money(tot('refunded'))} · adopt ${(sweep.results ?? []).filter(r => r.outcome === 'covered').length} · halt ${(sweep.results ?? []).filter(r => r.outcome === 'halted').length} (${money(tot('halted'))} owed) · read failures ${failed.length}`)
  say()

  // ── B. What the cutoff keeps out (would have been swept without it) ───────────
  const excluded = await db.order.findMany({
    where: {
      status: 'CANCELLED', deliveryFee: { gt: 0 }, runnerEarning: { is: null }, tipRefundId: null, voidedAt: null,
      OR: [{ cancelledAt: null }, { cancelledAt: { lt: T.OWED_BACK_FEE_FROM } }],
    },
    select: { id: true, cancelledAt: true, tip: true, deliveryFee: true, event: { select: { name: true } } },
    orderBy: { cancelledAt: 'asc' },
  })
  const feeOnly = excluded.filter(o => cents(o.tip) === 0)
  say(`## B. Kept out by the cutoff: ${excluded.length} pre-cutoff cancelled order(s) with an unrefunded fee`)
  say(`- ${feeOnly.length} fee-only (never scanned before 1.2) → not scanned now: ${money(feeOnly.reduce((s, o) => s + cents(o.deliveryFee), 0))} NOT refunded`)
  say(`- ${excluded.length - feeOnly.length} tipped → tip only, as before 1.2: ${money(excluded.filter(o => cents(o.tip) > 0).reduce((s, o) => s + cents(o.deliveryFee), 0))} of fees NOT refunded`)
  const byFair = new Map<string, { n: number; c: number; first: string; last: string }>()
  for (const o of excluded) {
    const k = o.event.name; const e = byFair.get(k) ?? { n: 0, c: 0, first: '', last: '' }
    const d = o.cancelledAt?.toISOString().slice(0, 10) ?? 'no date'
    e.n++; e.c += cents(o.deliveryFee); e.first ||= d; e.last = d; byFair.set(k, e)
  }
  for (const [k, e] of byFair) say(`  - ${k}: ${e.n} order(s), fees ${money(e.c)}, cancelled ${e.first} … ${e.last}`)
  say()

  // ── B2. Positive control on the probe: what the cutoff PREVENTS, decided with live Stripe reads ──
  // Without this, "0 candidates" could mean the probe never looks. For each excluded order, read
  // its charge + full refund list and run the same ceiling as if there were no cutoff.
  if (excluded.length) {
    say('### B2. Without the cutoff, the live code would have done (Stripe reads, same ceiling):')
    say()
    say('| Order | Charge | Refunds on charge | Would | Amount | Why |')
    say('|---|---|---|---|---|---|')
    for (const o of excluded.slice(0, 25)) {
      const full = await db.order.findUniqueOrThrow({ where: { id: o.id }, select: { stripeChargeId: true, fairSynqFee: true, serviceCharge: true, total: true } })
      if (!full.stripeChargeId) { say(`| ${o.id} | — | — | halt NO_CHARGE | ${money(cents(o.tip) + cents(o.deliveryFee))} | no charge id |`); continue }
      try {
        const ch = await stripe.charges.retrieve(full.stripeChargeId, {}, { timeout: T.STRIPE_READ_TIMEOUT_MS })
        const refunds = await T.readChargeRefunds(full.stripeChargeId)
        const d = ch.disputed ? { kind: 'halt CHARGE_DISPUTED', amount: 0, why: 'disputed' } : (() => {
          const x = T.decideOwedBack({ orderId: o.id, owedCents: cents(o.tip) + cents(o.deliveryFee), chargeAmountCents: ch.amount, keptCents: cents(full.fairSynqFee) + cents(full.serviceCharge), refunds })
          return x.kind === 'refund' ? { kind: 'refund', amount: x.amountCents, why: `room ${x.roomCents}¢` }
            : x.kind === 'covered' ? { kind: 'adopt', amount: 0, why: x.adoptRefundId }
            : { kind: 'halt REFUND_ROOM_SHORT', amount: x.owedNetCents, why: x.detail.replace(/\|/g, '/') }
        })()
        say(`| ${o.id} | ${full.stripeChargeId} (${money(ch.amount)}) | ${refunds.length}: ${refunds.map(r => `${money(r.amount)} ${r.status}${r.metadata?.kind ? ' ' + r.metadata.kind : ''}`).join(', ') || 'none'} | ${d.kind} | ${money(d.amount)} | ${d.why} |`)
      } catch (e) {
        say(`| ${o.id} | ${full.stripeChargeId} | read failed | — | — | ${String(e).slice(0, 120).replace(/\|/g, '/')} |`)
      }
    }
    say()
  }

  // ── C. Pattern L ──────────────────────────────────────────────────────────────
  say(`## C. Pattern L would alert on the same ${candidates} order(s) (same scan) until each is refunded or its halt resolved.`)
  say()
  const endRo = await db.$queryRawUnsafe<{ default_transaction_read_only: string }[]>('SHOW default_transaction_read_only')
  const endPid = await pidOf()
  if (endPid !== sealedPid || endRo[0]?.default_transaction_read_only !== 'on') die(`C5 connection changed or lost read-only (pid ${sealedPid} → ${endPid}, ${endRo[0]?.default_transaction_read_only}) — discard this run`)
  console.log(`  ✅ C5 whole run on the same read-only backend (pid ${sealedPid})`)
  if (shim) say(`Shim applied to ${shimHits} Order queries.`)
  say(`Seals: Postgres read-only, one backend pid ${sealedPid} start→end ✅ · Prisma writes blocked ✅ · Stripe money calls blocked ✅ · Stripe reads made: ${stripeReads.length} (${[...new Set(stripeReads)].join(', ') || 'none'})`)

  if (outFile) writeFileSync(outFile, lines.join('\n') + '\n')
  await db.$disconnect()
}

main().catch(e => { console.error('[owed-back-dry-run] FAILED:', e); process.exit(e instanceof SealBroken ? 4 : 2) })
