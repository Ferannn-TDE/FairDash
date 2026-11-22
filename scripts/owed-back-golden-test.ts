/**
 * TODAY'S OWED-BACK FOR OLD (feeModel null) ORDERS, FROZEN (item 10 stage 5, test plan S5-1) — test DB, Stripe stubbed.
 *
 * Nine legacy cases: tip + fee owed back; tip only (cancelled before the fee cutoff); runner earned; already refunded;
 * not cancelled; nothing owed; organizer share without a runner (halt); refunds on the charge we can't account for
 * (halt); an earlier owed-back refund on the charge (covered). Captured per case, ids normalised: planTipRefund(),
 * processTipRefund(dryRun), whether owedBackCandidateWhere() includes the order, and — for the live case — the Stripe
 * refund params + idempotency key and the order's markers after the run.
 *
 *   record → writes scripts/fixtures/owed-back-legacy-golden.json from the code as it is NOW. Recorded 2026-11-21 on
 *            `refunds` (788f16d) BEFORE any stage 5 code. Never re-record to make a run pass.
 *   check  → (default) runs the same cases and compares field by field (only the keys the golden holds).
 *
 * Exported for scripts/refunds-stage5-test.ts: runOwedBackCases(), compareOwedBackGolden(), loadOwedBackGolden().
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/owed-back-golden-test.ts [record|check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { testPrisma } from '../lib/test-db'

const prisma = testPrisma()
const PFX = 'obgold-', MAIL = '@obgold.local'
const FILE = 'scripts/fixtures/owed-back-legacy-golden.json'
const rand = () => Math.random().toString(36).slice(2, 8)

interface Case {
  name: string
  status: string
  tip: number | null
  deliveryFee: number | null
  cancelledAt: string | null
  runnerEarned?: boolean
  organizerOnly?: boolean
  tipRefundId?: boolean
  refunds?: { amount: number; kind?: string }[]
  live?: boolean
}
export const OWED_BACK_CASES: Case[] = [
  { name: 'tip + fee owed back (live)', status: 'CANCELLED', tip: 2, deliveryFee: 3.99, cancelledAt: '2026-11-01T12:00:00Z', refunds: [{ amount: 5000 }], live: true },
  { name: 'tip only, cancelled before the fee cutoff', status: 'CANCELLED', tip: 1.5, deliveryFee: 3.99, cancelledAt: '2026-10-01T12:00:00Z', refunds: [{ amount: 5000 }] },
  { name: 'runner earned it', status: 'CANCELLED', tip: 2, deliveryFee: 3.99, cancelledAt: '2026-11-01T12:00:00Z', runnerEarned: true },
  { name: 'already refunded', status: 'CANCELLED', tip: 2, deliveryFee: 3.99, cancelledAt: '2026-11-01T12:00:00Z', tipRefundId: true },
  { name: 'not cancelled', status: 'DELIVERED', tip: 2, deliveryFee: 3.99, cancelledAt: null },
  { name: 'nothing owed', status: 'CANCELLED', tip: null, deliveryFee: null, cancelledAt: '2026-11-01T12:00:00Z' },
  { name: 'organizer share without a runner (halt)', status: 'CANCELLED', tip: 2, deliveryFee: 3.99, cancelledAt: '2026-11-01T12:00:00Z', organizerOnly: true },
  { name: 'unaccounted refunds on the charge (halt)', status: 'CANCELLED', tip: 2, deliveryFee: 3.99, cancelledAt: '2026-11-01T12:00:00Z', refunds: [{ amount: 5000 }, { amount: 600 }] },
  { name: 'earlier owed-back on the charge (covered)', status: 'CANCELLED', tip: 2, deliveryFee: 3.99, cancelledAt: '2026-11-01T12:00:00Z', refunds: [{ amount: 5000 }, { amount: 599, kind: 'owed_back' }] },
]

const charges = new Map<string, { amount: number; refunds: any[] }>()
const created: any[] = []
async function stubStripe() {
  const { stripe } = await import('../lib/stripe')
  const s = stripe as any
  s.charges.retrieve = async (id: string) => ({ id, amount: charges.get(id)!.amount, disputed: false })
  s.refunds.list = async ({ charge }: { charge: string }) => ({ data: charges.get(charge)!.refunds, has_more: false })
  s.refunds.create = async (p: any, o: any) => { created.push({ p, o }); return { id: `re_obgold_${created.length}` } }
  s.paymentIntents.retrieve = async () => ({ latest_charge: null })
}

export async function cleanup() {
  const evs = (await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })).map(e => e.id)
  const oids = (await prisma.order.findMany({ where: { eventId: { in: evs } }, select: { id: true } })).map(o => o.id)
  for (const m of ['runnerEarning', 'organizerEarning', 'owedBackHalt', 'adminMoneyAction', 'orderItem', 'vendorOrderStatus'] as const) {
    await (prisma as any)[m].deleteMany({ where: { orderId: { in: oids } } }).catch(() => {})
  }
  await prisma.order.deleteMany({ where: { id: { in: oids } } })
  await prisma.runner.deleteMany({ where: { eventId: { in: evs } } })
  const vids = (await prisma.vendor.findMany({ where: { eventId: { in: evs } }, select: { id: true } })).map(v => v.id)
  await prisma.vendor.deleteMany({ where: { id: { in: vids } } })
  await prisma.event.deleteMany({ where: { id: { in: evs } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

/** One legacy (feeModel null) order for a case; also programs the stubbed charge. */
export async function buildCase(c: Case, extra: Record<string, unknown> = {}) {
  const ev = await prisma.event.create({ data: { name: `${PFX}ev`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-03') } })
  const cust = await prisma.user.create({ data: { clerkId: `${PFX}c-${rand()}`, email: `c-${rand()}${MAIL}`, name: 'C' } })
  const v = await prisma.vendor.create({ data: { eventId: ev.id, name: `${PFX}v`, slug: `${PFX}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
  const chargeId = `ch_${PFX}${rand()}`
  const food = 50, fee = 7.5
  // The charge is exactly the order's parts: food + service fee + curbside fee + tip.
  const chargeAmount = 5000 + 750 + Math.round((c.deliveryFee ?? 0) * 100) + Math.round((c.tip ?? 0) * 100)
  const order = await prisma.order.create({ data: {
    eventId: ev.id, customerId: cust.id, vendorId: v.id, status: c.status as any, fulfillmentType: 'CURBSIDE',
    subtotal: food, fairSynqFee: fee, deliveryFee: c.deliveryFee, tip: c.tip, total: chargeAmount / 100, vendorPayout: 0,
    customerName: 'C', customerPhone: '6185550100', stripeChargeId: chargeId, stripePaymentIntentId: `pi_${PFX}${rand()}`,
    cancelledAt: c.cancelledAt ? new Date(c.cancelledAt) : null,
    ...(c.tipRefundId ? { tipRefundId: `re_prior_${rand()}`, tipRefundedAt: new Date('2026-11-02') } : {}),
    ...extra,
  } as any })
  if (c.runnerEarned || c.organizerOnly) {
    if (c.runnerEarned) {
      const ru = await prisma.user.create({ data: { clerkId: `${PFX}r-${rand()}`, email: `r-${rand()}${MAIL}`, name: 'R' } })
      const runner = await prisma.runner.create({ data: { userId: ru.id, eventId: ev.id, approvalStatus: 'APPROVED' } as any })
      await prisma.runnerEarning.create({ data: { eventId: ev.id, orderId: order.id, runnerId: runner.id, amountCents: 400 } as any })
    } else {
      await prisma.organizerEarning.create({ data: { eventId: ev.id, orderId: order.id, amountCents: 199, source: 'curbside_fee_share' } as any })
    }
  }
  charges.set(chargeId, {
    amount: chargeAmount,
    refunds: (c.refunds ?? []).map((r, i) => ({ id: `re_${PFX}${i}_${rand()}`, amount: r.amount, status: 'succeeded', created: 1_700_000_000 + i, metadata: r.kind ? { orderId: order.id, kind: r.kind } : { orderId: order.id, kind: 'vendor_portion_refund' } })),
  })
  return { orderId: order.id, eventId: ev.id, chargeId, vendorId: v.id }
}

function normaliser(ids: { orderId: string; eventId: string; chargeId: string }) {
  const norm = (x: unknown): unknown => {
    if (typeof x === 'string') return x.split(ids.orderId).join('ORDER').split(ids.eventId).join('EVENT').split(ids.chargeId).join('CHARGE')
      .replace(/re_obgold-\d+_[a-z0-9]+/g, 'RE_PRIOR').replace(/re_prior_[a-z0-9]+/g, 'RE_PRIOR').replace(/re_obgold_\d+/g, 'RE_NEW')
    if (Array.isArray(x)) return x.map(norm)
    if (x instanceof Date) return 'DATE'
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, norm(v)]))
    return x
  }
  return norm
}

export async function runOwedBackCases(): Promise<Record<string, unknown>> {
  await cleanup()
  await stubStripe()
  const tr = await import('../lib/tip-refund')
  const out: Record<string, unknown> = {}
  try {
    for (const c of OWED_BACK_CASES) {
      const ids = await buildCase(c)
      const norm = normaliser(ids)
      const plan = await tr.planTipRefund(ids.orderId)
      const dry = await tr.processTipRefund(ids.orderId, { dryRun: true })
      const inScan = (await prisma.order.count({ where: { AND: [tr.owedBackCandidateWhere(), { id: ids.orderId }] } })) === 1
      let live: unknown = null
      if (c.live) {
        const at = created.length
        const res = await tr.processTipRefund(ids.orderId)
        const marker = await prisma.order.findUnique({ where: { id: ids.orderId }, select: { tipRefundId: true, deliveryFeeRefundCents: true } })
        live = { res, stripe: created.slice(at).map(x => ({ params: x.p, idempotencyKey: x.o?.idempotencyKey })), marker: { tipRefundId: marker?.tipRefundId, deliveryFeeRefundCents: marker?.deliveryFeeRefundCents } }
      }
      out[c.name] = norm({ plan, dry, inScan, live })
    }
  } finally { await cleanup() }
  return out
}

/** Compares only the keys the golden holds (new keys a later stage adds are not a difference). */
export function compareOwedBackGolden(run: Record<string, unknown>, golden: Record<string, unknown>): string[] {
  const diffs: string[] = []
  const pick = (g: unknown, r: unknown): unknown => {
    if (g && typeof g === 'object' && !Array.isArray(g) && r && typeof r === 'object' && !Array.isArray(r)) {
      return Object.fromEntries(Object.keys(g as object).map(k => [k, pick((g as any)[k], (r as any)[k])]))
    }
    return r
  }
  for (const k of Object.keys(golden)) {
    const a = JSON.stringify(golden[k]), b = JSON.stringify(pick(golden[k], run[k]))
    if (a !== b) diffs.push(`${k}:\n      golden ${a}\n      now    ${b}`)
  }
  return diffs
}
export const loadOwedBackGolden = () => JSON.parse(readFileSync(FILE, 'utf8')).results as Record<string, unknown>

async function main() {
  const mode = process.argv[2] ?? 'check'
  const run = await runOwedBackCases()
  if (mode === 'record') {
    writeFileSync(FILE, JSON.stringify({ note: 'Today\'s owed-back for old (feeModel null) orders, recorded BEFORE item 10 stage 5 code. Never re-record to make a run pass.', recordedAt: new Date().toISOString(), results: run }, null, 2) + '\n')
    console.log(`recorded ${Object.keys(run).length} cases to ${FILE}`)
    for (const [n, r] of Object.entries<any>(run)) console.log(`  ${n}: plan ${r.plan.outcome} ${r.plan.owedBackCents}¢, dry ${r.dry.outcome}${r.dry.amountCents != null ? ` ${r.dry.amountCents}¢` : ''}, in scan ${r.inScan}${r.live ? `, live ${r.live.res.outcome} ${JSON.stringify(r.live.stripe.map((s: any) => s.params.amount))}` : ''}`)
  } else {
    const d = compareOwedBackGolden(run, loadOwedBackGolden())
    console.log(d.length === 0 ? `✅ owed-back golden: ${Object.keys(run).length} old-order cases identical` : `❌ owed-back golden:\n  ${d.join('\n  ')}`)
    process.exitCode = d.length ? 1 : 0
  }
}
if (process.argv[1]?.endsWith('owed-back-golden-test.ts')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0) })
}
