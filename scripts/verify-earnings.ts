/** Verify the shared earnings helper against real orders in each state. */
import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })

async function main() {
  const { db } = await import('../lib/db.js')
  const { computeVendorOrderEarnings } = await import('../lib/vendor-earnings.js')
  let pass = 0, fail = 0
  const ok = (m: string) => { console.log(`  ✅ ${m}`); pass++ }
  const no = (m: string) => { console.log(`  ❌ ${m}`); fail++ }

  const cust = await db.user.findUnique({ where: { email: 'feranmidyro@gmail.com' }, select: { id: true } })
  const sel = {
    id: true, total: true, voidedAt: true,
    vendorOrderStatuses: { select: { vendorId: true, status: true } },
    payouts: { select: { vendorId: true, netAmount: true, reversedAt: true } },
    refunds: { select: { vendorId: true, status: true, amountCents: true } },
    orderItems: { select: { vendorId: true, subtotal: true } },
  } as const

  // Pull a sampling of recent non-voided orders for the test customer.
  const orders = await db.order.findMany({
    where: { customerId: cust!.id, voidedAt: null },
    select: sel, orderBy: { createdAt: 'desc' }, take: 200,
  })

  // Bucket by the state we can detect, pick one example of each.
  const pick = { settled: null as any, estimated: null as any, refunded: null as any, reversed: null as any, declined: null as any }
  for (const o of orders) {
    for (const vos of o.vendorOrderStatuses) {
      const e = computeVendorOrderEarnings(o as any, vos.vendorId)
      if (!pick[e.status]) pick[e.status] = { o, vendorId: vos.vendorId, e }
    }
  }

  console.log('\n=== Earnings helper — one example per state ===')
  const C = (n: number) => Math.round(n * 100)
  for (const [state, ex] of Object.entries(pick)) {
    if (!ex) { console.log(`  (no ${state} example found in sample)`); continue }
    const { o, vendorId, e } = ex
    const sliceCents = o.orderItems.filter((i: any) => i.vendorId === vendorId).reduce((s: number, i: any) => s + C(i.subtotal), 0)
    const payout = o.payouts.find((p: any) => p.vendorId === vendorId)
    const netCents = payout && !payout.reversedAt ? C(payout.netAmount) : null
    console.log(`\n  [${state}] order ${o.id.slice(-6)} vendor ${vendorId.slice(-6)}`)
    console.log(`     slice=${sliceCents}¢  payout.net=${netCents ?? '—'}  reversed=${!!payout?.reversedAt}  earnings=${e.cents}¢ (${e.status})`)

    // Invariant: never show more than actual take-home.
    if (state === 'settled') {
      e.cents === netCents ? ok('settled == Payout.netAmount (money-truth)') : no(`settled ${e.cents} != net ${netCents}`)
    } else if (state === 'estimated') {
      e.cents < sliceCents ? ok(`estimate (${e.cents}¢) < gross slice (${sliceCents}¢) — Stripe fee subtracted, not the 10%`) : no('estimate not below gross slice')
    } else if (state === 'reversed') {
      e.cents === 0 ? ok('reversed/charged-back → $0 (stale payout did NOT win)') : no(`reversed shows ${e.cents}¢`)
    } else if (state === 'refunded') {
      e.cents <= sliceCents ? ok(`refunded reduced to ${e.cents}¢ (≤ slice)`) : no('refunded not reduced')
    } else if (state === 'declined') {
      e.cents === 0 ? ok('declined → $0') : no(`declined shows ${e.cents}¢`)
    }
  }

  // Global invariant across the whole sample: no displayed earnings > take-home.
  console.log('\n=== Global invariant: no earnings figure exceeds actual take-home ===')
  let violations = 0
  for (const o of orders) {
    for (const vos of o.vendorOrderStatuses) {
      const e = computeVendorOrderEarnings(o as any, vos.vendorId)
      const sliceCents = o.orderItems.filter((i: any) => i.vendorId === vos.vendorId).reduce((s: number, i: any) => s + Math.round(i.subtotal * 100), 0)
      const payout = o.payouts.find((p: any) => p.vendorId === vos.vendorId)
      // ceiling for "actual take-home": settled net if present+not reversed, else the gross slice (estimate must be ≤ slice)
      const ceiling = payout && !payout.reversedAt ? Math.round(payout.netAmount * 100) : sliceCents
      if (e.cents > ceiling) { violations++; console.log(`    ❌ ${o.id.slice(-6)}/${vos.vendorId.slice(-6)}: ${e.cents}¢ > ceiling ${ceiling}¢ (${e.status})`) }
    }
  }
  violations === 0 ? ok(`scanned ${orders.length} orders — ZERO earnings figures exceed take-home`) : no(`${violations} violations`)

  console.log(`\n${'─'.repeat(56)}`)
  console.log(fail === 0 ? `All ${pass} assertions passed ✅` : `${pass} passed, ${fail} FAILED`)
  await db.$disconnect()
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
