/**
 * TODAY'S PAYOUT FOR OLD (feeModel null) ORDERS, FROZEN (item 10 / B1.13 stage 4, plan B[1]) — test DB,
 * Stripe stubbed in-process (charges.retrieve returns a fixed fee; transfers.create records its params).
 *
 * Scenarios: booth one vendor; two vendors; one vendor unconnected (held); one portion REFUNDED (skipped);
 * an admin hold (blocked); curbside delivered by a runner (runner + organizer earnings, then the payout).
 * Captured per scenario, ids normalised: the PayoutResult, every transfer's params + idempotency key,
 * Payout / VendorEarning / PayoutHold rows, and the curbside RunnerEarning / OrganizerEarning.
 *
 *   record → writes scripts/fixtures/payout-legacy-golden.json from the code as it is NOW. Recorded
 *            2026-11-19 on fees-3-4 (25956f1) BEFORE any stage 4 code. Never re-record to make a run pass.
 *   check  → (default) runs the same scenarios and compares field by field.
 *
 * Exported for scripts/fees-stage4-test.ts: runPayoutScenarios(), comparePayoutGolden(), and the harness
 * (buildOrder, stubStripe, setStripeFee, transfers, cleanup) for its feeModel 2 orders.
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/payout-golden-test.ts [record|check]
 */
import './fee-baseline' // test environment (test Upstash, stub Stripe key, no queue) + route loader
import { readFileSync, writeFileSync } from 'node:fs'
import { testPrisma } from '../lib/test-db'

const prisma = testPrisma()
const PFX = 'pgold-'
const MAIL = '@pgold.local'
const FILE = 'scripts/fixtures/payout-legacy-golden.json'
const rand = () => Math.random().toString(36).slice(2, 8)

interface V { price: number; connected?: boolean; vos?: string; earning?: string }
interface Scenario { name: string; fee: number; vendors: V[]; curbside?: { fee: number; tip: number; runnerPct: number } }
export const PAYOUT_SCENARIOS: Scenario[] = [
  { name: 'booth one vendor $50', fee: 197, vendors: [{ price: 50 }] },
  { name: 'booth two vendors 30 + 20', fee: 167, vendors: [{ price: 30 }, { price: 20 }] },
  { name: 'two vendors, second unconnected (held)', fee: 167, vendors: [{ price: 30 }, { price: 20, connected: false }] },
  { name: 'two vendors, second REFUNDED (skipped)', fee: 167, vendors: [{ price: 30 }, { price: 20, vos: 'REFUNDED' }] },
  { name: 'one vendor under an admin hold (blocked)', fee: 197, vendors: [{ price: 50, earning: 'held' }] },
  { name: 'curbside delivered, fee 3.99 + tip 2', fee: 210, vendors: [{ price: 50 }], curbside: { fee: 3.99, tip: 2, runnerPct: 50 } },
]

export const transfers: any[] = []
let currentFee = 0
export const setStripeFee = (cents: number) => { currentFee = cents }
export async function stubStripe() {
  const { stripe } = await import('../lib/stripe')
  const s = stripe as any
  s.charges.retrieve = async (id: string) => ({ id, balance_transaction: { id: `txn_${id}`, fee: currentFee } })
  s.paymentIntents.retrieve = async () => { throw new Error('payout-golden: unexpected paymentIntents.retrieve') }
  s.transfers.create = async (params: any, opts: any) => { transfers.push({ params, opts }); return { id: `tr_${transfers.length}_${rand()}` } }
}

export async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (!ids.length) { await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } }); return }
  const oids = (await prisma.order.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(o => o.id)
  for (const m of ['payout', 'payoutHold', 'vendorEarning', 'runnerEarning', 'organizerEarning', 'vendorOrderStatus', 'orderItem'] as const) {
    await (prisma as any)[m].deleteMany({ where: { orderId: { in: oids } } })
  }
  await (prisma as any).partnerEarning?.deleteMany?.({ where: { orderId: { in: oids } } }).catch?.(() => {})
  await (prisma as any).orderFeeSplitVendor?.deleteMany?.({ where: { orderId: { in: oids } } }).catch?.(() => {})
  await (prisma as any).orderFeeSplit?.deleteMany?.({ where: { orderId: { in: oids } } }).catch?.(() => {})
  await prisma.order.deleteMany({ where: { id: { in: oids } } })
  await prisma.runner.deleteMany({ where: { eventId: { in: ids } } })
  const vids = (await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(v => v.id)
  await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
  await prisma.vendor.deleteMany({ where: { id: { in: vids } } })
  await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
  await prisma.event.deleteMany({ where: { id: { in: ids } } })
  const orgs = await prisma.fairOrganizer.findMany({ where: { name: { startsWith: PFX } }, select: { id: true } })
  await prisma.fairOrganizer.deleteMany({ where: { id: { in: orgs.map(o => o.id) } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

/** Build one paid legacy order (feeModel null) for a scenario. Returns ids for normalisation. */
export async function buildOrder(s: Scenario, opts: { feeModel?: number | null; snapshot?: Record<string, unknown>; serviceCents?: number } = {}) {
  const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}org`, contactEmail: `o-${rand()}${MAIL}`, approvalStatus: 'APPROVED' } })
  const ev = await prisma.event.create({ data: {
    name: `${PFX}${s.name}`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', organizerId: org.id,
    startDate: new Date(Date.now() - 864e5), endDate: new Date(Date.now() + 864e5),
    fulfillmentConfig: { create: { boothPickupEnabled: true, curbsideEnabled: !!s.curbside, runnerFeePercent: s.curbside?.runnerPct ?? 0 } },
  } })
  const cust = await prisma.user.create({ data: { clerkId: `${PFX}c-${rand()}`, email: `c-${rand()}${MAIL}`, name: 'C' } })
  const vendors = []
  for (const [i, v] of s.vendors.entries()) {
    const connected = v.connected !== false
    vendors.push(await prisma.vendor.create({ data: {
      eventId: ev.id, name: `${PFX}v${i}`, slug: `${PFX}${rand()}`, cuisineType: 'T', status: 'ACTIVE',
      stripeAccountId: connected ? `acct_${PFX}${i}_${rand()}` : null, stripeVerified: connected,
    } }))
  }
  const food = s.vendors.reduce((a, v) => a + Math.round(v.price * 100), 0)
  const service = opts.serviceCents ?? Math.round(food * 0.10) // legacy 10% (exact for these prices); stage 4 tests pass 15%
  const curb = s.curbside ? Math.round(s.curbside.fee * 100) : 0, tip = s.curbside ? Math.round(s.curbside.tip * 100) : 0
  const total = food + service + curb + tip
  let runnerId: string | null = null
  if (s.curbside) {
    const ru = await prisma.user.create({ data: { clerkId: `${PFX}r-${rand()}`, email: `r-${rand()}${MAIL}`, name: 'R' } })
    runnerId = (await prisma.runner.create({ data: { userId: ru.id, eventId: ev.id, approvalStatus: 'APPROVED' } as any })).id
  }
  const order = await prisma.order.create({ data: {
    eventId: ev.id, customerId: cust.id, vendorId: vendors[0].id,
    status: s.curbside ? 'RUNNER_COLLECTED' : 'COMPLETED', fulfillmentType: s.curbside ? 'CURBSIDE' : 'BOOTH_PICKUP',
    subtotal: food / 100, fairSynqFee: service / 100, deliveryFee: s.curbside ? curb / 100 : null, tip: tip ? tip / 100 : null,
    total: total / 100, vendorPayout: 0, customerName: 'C', customerPhone: '6185550100',
    stripeChargeId: `ch_${PFX}${rand()}`, stripePaymentIntentId: `pi_${PFX}${rand()}`,
    runnerId, ...(s.curbside ? { deliveryProofPath: 'proof/x.jpg' } : {}),
    ...(opts.feeModel != null ? { feeModel: opts.feeModel, ...(opts.snapshot ?? {}) } : {}),
  } as any })
  for (const [i, v] of s.vendors.entries()) {
    const mi = await prisma.menuItem.create({ data: { vendorId: vendors[i].id, name: 'Item', price: v.price, category: 'T' } })
    await prisma.orderItem.create({ data: { orderId: order.id, vendorId: vendors[i].id, menuItemId: mi.id, itemName: 'Item', quantity: 1, unitPrice: v.price, totalPrice: v.price, subtotal: v.price } as any })
    await prisma.vendorOrderStatus.create({ data: { orderId: order.id, vendorId: vendors[i].id, status: (v.vos ?? 'COMPLETED') as any } })
    if (v.earning) await prisma.vendorEarning.create({ data: { eventId: ev.id, orderId: order.id, vendorId: vendors[i].id, subtotalCents: Math.round(v.price * 100), status: v.earning } })
  }
  return { orderId: order.id, eventId: ev.id, vendorIds: vendors.map(v => v.id), accounts: vendors.map(v => v.stripeAccountId), runnerId, organizerId: org.id, chargeId: order.stripeChargeId! }
}

/** Replace generated ids with stable names so two runs compare. */
function normaliser(ids: Awaited<ReturnType<typeof buildOrder>>) {
  const map = new Map<string, string>([[ids.orderId, 'ORDER'], [ids.eventId, 'EVENT'], [ids.chargeId, 'CHARGE'], ...(ids.runnerId ? [[ids.runnerId, 'RUNNER'] as [string, string]] : []), [ids.organizerId, 'ORGANIZER']])
  ids.vendorIds.forEach((v, i) => map.set(v, `V${i}`))
  ids.accounts.forEach((a, i) => a && map.set(a, `ACCT${i}`))
  const norm = (x: unknown): unknown => {
    if (typeof x === 'string') { let s = x; for (const [k, v] of map) s = s.split(k).join(v); return s.replace(/tr_\d+_[a-z0-9]+/g, 'TRANSFER') }
    if (Array.isArray(x)) return x.map(norm)
    if (x && typeof x === 'object' && !(x instanceof Date)) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, norm(v)]))
    return x
  }
  return norm
}

export async function capture(orderId: string, norm: (x: unknown) => unknown, result: unknown, fromTransfer: number) {
  const sel = { vendorId: true } as const
  return norm({
    result,
    transfers: transfers.slice(fromTransfer).map(t => ({ params: t.params, idempotencyKey: t.opts?.idempotencyKey })),
    payouts: await prisma.payout.findMany({ where: { orderId }, orderBy: { vendorId: 'asc' }, select: { ...sel, grossAmount: true, fairSynqFee: true, netAmount: true, stripeStatus: true, stripeTransferId: true } }),
    earnings: await prisma.vendorEarning.findMany({ where: { orderId }, orderBy: { vendorId: 'asc' }, select: { ...sel, subtotalCents: true, status: true, feeShareCents: true, netCents: true, stripeTransferId: true } }),
    holds: await prisma.payoutHold.findMany({ where: { orderId }, orderBy: { vendorId: 'asc' }, select: { ...sel, amountCents: true, reason: true, resolved: true } }),
    runnerEarning: await prisma.runnerEarning.findUnique({ where: { orderId }, select: { runnerId: true, amountCents: true, status: true } }),
    organizerEarning: await prisma.organizerEarning.findUnique({ where: { orderId }, select: { organizerId: true, amountCents: true, source: true, status: true } }),
  })
}

export async function runPayoutScenarios(): Promise<Record<string, unknown>> {
  await cleanup()
  await stubStripe()
  const { processOrderPayout } = await import('../lib/process-payout')
  const { reconcileMasterStatus } = await import('../lib/reconcile-order-status')
  const out: Record<string, unknown> = {}
  try {
    for (const s of PAYOUT_SCENARIOS) {
      const ids = await buildOrder(s)
      if (s.curbside) await reconcileMasterStatus(ids.orderId) // RUNNER_COLLECTED → DELIVERED: runner + organizer accrual
      currentFee = s.fee
      const from = transfers.length
      const result = await processOrderPayout(ids.orderId)
      out[s.name] = await capture(ids.orderId, normaliser(ids), result, from)
    }
  } finally { await cleanup() }
  return out
}

export function comparePayoutGolden(run: Record<string, unknown>, golden: Record<string, unknown>): string[] {
  const diffs: string[] = []
  for (const k of Object.keys(golden)) {
    const a = JSON.stringify(golden[k]), b = JSON.stringify(run[k])
    if (a !== b) diffs.push(`${k}:\n      golden ${a}\n      now    ${b}`)
  }
  return diffs
}
export const loadPayoutGolden = () => JSON.parse(readFileSync(FILE, 'utf8')).results as Record<string, unknown>

async function main() {
  const mode = process.argv[2] ?? 'check'
  const run = await runPayoutScenarios()
  if (mode === 'record') {
    writeFileSync(FILE, JSON.stringify({ note: 'Today\'s payout for old (feeModel null) orders, recorded BEFORE item 10 stage 4 code. Never re-record to make a run pass.', recordedAt: new Date().toISOString(), results: run }, null, 2) + '\n')
    console.log(`recorded ${Object.keys(run).length} scenarios to ${FILE}`)
    for (const [n, r] of Object.entries<any>(run)) console.log(`  ${n}: transfers ${JSON.stringify(r.transfers.map((t: any) => t.params.amount))}, held ${r.holds.length}, runner ${r.runnerEarning?.amountCents ?? '-'}, organizer ${r.organizerEarning?.amountCents ?? '-'}`)
  } else {
    const d = comparePayoutGolden(run, loadPayoutGolden())
    console.log(d.length === 0 ? `✅ payout golden: ${Object.keys(run).length} old-order scenarios identical` : `❌ payout golden:\n  ${d.join('\n  ')}`)
    process.exitCode = d.length ? 1 : 0
  }
}
if (process.argv[1]?.endsWith('payout-golden-test.ts')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0) })
}
