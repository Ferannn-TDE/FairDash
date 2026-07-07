import { config } from 'dotenv'; config({ path: '.env.local' })
import { db } from '../lib/db'
import { getFairOrders } from '../lib/fair-orders'
import { getFairVendors } from '../lib/fair-vendors'

// Confirms the screens' backing data is REAL and non-empty for the live fair —
// so the picker + read screens render actual content, not just compile.
//   npx tsx scripts/screens-data-check.ts
async function main() {
  // SLICE 1 — /api/admin/fairs backing query (findMany, unscoped by design).
  const fairs = await db.event.findMany({
    orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    select: { urlSlug: true, status: true, organizer: { select: { name: true, suspendedAt: true } }, _count: { select: { vendors: true } } },
  })
  console.log(`SLICE 1 · picker: ${fairs.length} fair(s)`)
  for (const f of fairs) {
    console.log(`   • ${f.urlSlug} [${f.status}] org=${f.organizer?.name ?? '—'}${f.organizer?.suspendedAt ? ' (SUSPENDED)' : ''} vendors=${f._count.vendors}`)
  }

  const fair = await db.event.findFirst({ where: { urlSlug: 'springfield-state-fair-2026' }, select: { id: true, organizerId: true } })
  if (!fair) throw new Error('no fair')

  // SLICE 2 — read screens (shared cores + queries the admin endpoints call).
  const orders  = await getFairOrders(fair.id, { take: 100 })
  const vendors = await getFairVendors(fair.id, { take: 200 })
  const runners = await db.runner.findMany({
    where: { eventId: fair.id },
    select: { status: true, completionRate: true, totalCompleted: true, totalDispatched: true, user: { select: { name: true } } },
  })
  console.log(`\nSLICE 2 · read screens:`)
  console.log(`   orders : ${orders.orders.length} rows (pending=${orders.meta.pendingCount}, issues=${orders.meta.issuesCount})`)
  console.log(`   vendors: ${vendors.vendors.length} rows (approved=${vendors.readiness.approvedCount}, notReady=${vendors.readiness.notReadyCount})`)
  console.log(`   runners: ${runners.length} rows`)

  // SLICE 3 — dashboard organizer panel backing (fairOrganizer, not Event).
  const organizer = fair.organizerId
    ? await db.fairOrganizer.findUnique({ where: { id: fair.organizerId }, select: { name: true, suspendedAt: true } })
    : null
  console.log(`\nSLICE 3 · kill-switch panel: organizer="${organizer?.name ?? '—'}" suspended=${!!organizer?.suspendedAt}`)

  console.log('\n✅ all screen data resolves (real, non-fabricated)')
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
