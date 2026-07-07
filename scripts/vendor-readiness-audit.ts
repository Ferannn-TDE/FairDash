import { config } from 'dotenv'; config({ path: '.env.local' })
import { db } from '../lib/db'
import { vendorReady, readyVendorWhere } from '../lib/vendor-readiness'

// READ-ONLY vendor-readiness audit for the live fair. Uses the REAL vendorReady
// predicate (the same (c) bar the Phase-5 gate enforces via readyVendorWhere), so
// the count here EXACTLY predicts what flipping ENFORCE_VENDOR_READINESS would do.
// NO writes, NO flip.
//   npx tsx scripts/vendor-readiness-audit.ts

const FAIR_SLUG = 'springfield-state-fair-2026' // Italian Fest 2026

async function main() {
  const event = await db.event.findFirst({ where: { urlSlug: FAIR_SLUG }, select: { id: true, name: true } })
  if (!event) throw new Error(`no fair ${FAIR_SLUG}`)

  const vendors = await db.vendor.findMany({
    where: { eventId: event.id },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, status: true, stripeVerified: true, boothNumber: true,
      _count: { select: { menuItems: { where: { isAvailable: true } } } },
    },
  })

  const rows = vendors.map(v => {
    const availableMenuCount = v._count.menuItems
    const ready = vendorReady({ status: v.status, stripeVerified: v.stripeVerified, availableMenuCount })
    const fails: string[] = []
    if (v.status !== 'ACTIVE')     fails.push('not-approved')
    if (!v.stripeVerified)         fails.push('no-Stripe')
    if (availableMenuCount === 0)  fails.push('no-menu')
    return { name: v.name, status: v.status, stripe: v.stripeVerified, menu: availableMenuCount, ready, fails }
  })

  console.log(`\n=== VENDOR READINESS AUDIT — ${event.name} (${vendors.length} vendors) ===\n`)
  console.log('  READY  VENDOR                          STATUS    STRIPE  MENU  FAILING')
  console.log('  ' + '─'.repeat(84))
  for (const r of rows) {
    console.log(
      `  ${r.ready ? '✅   ' : '❌   '} ${r.name.padEnd(32)} ${String(r.status).padEnd(9)} ` +
      `${(r.stripe ? 'yes' : 'NO ').padEnd(6)} ${String(r.menu).padEnd(5)} ${r.fails.join(', ')}`
    )
  }

  const ready       = rows.filter(r => r.ready)
  const active      = rows.filter(r => r.status === 'ACTIVE')
  const disappear   = active.filter(r => !r.ready)               // currently shown, would vanish on flip
  const notApproved = rows.filter(r => r.status !== 'ACTIVE')

  // Why-categories among the currently-visible (ACTIVE) vendors that would disappear.
  const noStripe = disappear.filter(r => !r.stripe)
  const noMenu   = disappear.filter(r => r.menu === 0)

  console.log(`\n=== HEADLINE ===`)
  console.log(`  Total vendors:            ${rows.length}`)
  console.log(`  READY (stay visible):     ${ready.length}`)
  console.log(`  NOT-ready:                ${rows.length - ready.length}`)
  console.log(`    • of which currently ACTIVE (would DISAPPEAR on flip): ${disappear.length}`)
  console.log(`    • not-approved (already hidden, not affected by flip): ${notApproved.length}`)

  console.log(`\n=== WHY the ACTIVE ones aren't ready (each a different fix) ===`)
  console.log(`  no Stripe (vendor completes Connect): ${noStripe.length}  → ${noStripe.map(r => r.name).join(', ') || '—'}`)
  console.log(`  no menu   (vendor adds items):        ${noMenu.length}  → ${noMenu.map(r => r.name).join(', ') || '—'}`)

  // Cross-check: audit predicate count == gate query count (readyVendorWhere).
  const gateCount = await db.vendor.count({ where: { eventId: event.id, ...readyVendorWhere } })
  console.log(`\n=== AUDIT == GATE (proves the count predicts the flip) ===`)
  console.log(`  vendorReady predicate says ready: ${ready.length}`)
  console.log(`  readyVendorWhere query (the gate): ${gateCount}`)
  console.log(`  ${ready.length === gateCount ? '✅ MATCH — audit uses the exact logic the gate enforces' : '❌ MISMATCH — investigate'}`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
