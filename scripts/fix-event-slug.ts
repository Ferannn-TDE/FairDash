/**
 * scripts/fix-event-slug.ts
 *
 * Updates the event urlSlug from springfield-fair-2026 → springfield-state-fair-2026
 * so the DB matches the URL the frontend uses.
 *
 * Run with:  npx tsx scripts/fix-event-slug.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const OLD_SLUG = 'springfield-fair-2026'
const NEW_SLUG = 'springfield-state-fair-2026'
const EVENT_ID = 'cmni6x63n000011znjwlln5k2'

async function main() {
  console.log('\n🔍  Looking up event...\n')

  const event = await prisma.event.findUnique({
    where: { id: EVENT_ID },
    select: { id: true, name: true, urlSlug: true, status: true },
  })

  if (!event) {
    console.error(`❌  Event ID "${EVENT_ID}" not found. Check your DB.\n`)
    process.exit(1)
  }

  console.log(`   Found    : "${event.name}"`)
  console.log(`   urlSlug  : ${event.urlSlug}`)
  console.log(`   Status   : ${event.status}`)

  // ── 1. Update slug ────────────────────────────────────────────────────────

  if (event.urlSlug === NEW_SLUG) {
    console.log(`\n✅  urlSlug is already "${NEW_SLUG}". Nothing to update.`)
  } else {
    const conflict = await prisma.event.findUnique({ where: { urlSlug: NEW_SLUG } })
    if (conflict && conflict.id !== EVENT_ID) {
      console.error(`\n❌  Another event already has urlSlug "${NEW_SLUG}" (id: ${conflict.id}).`)
      process.exit(1)
    }

    await prisma.event.update({
      where: { id: EVENT_ID },
      data: { urlSlug: NEW_SLUG },
    })
    console.log(`\n✅  urlSlug updated: "${OLD_SLUG}" → "${NEW_SLUG}"`)
  }

  // ── 2. Ensure all vendors are on this event ───────────────────────────────

  const orphans = await prisma.vendor.count({ where: { eventId: { not: EVENT_ID } } })
  if (orphans > 0) {
    const moved = await prisma.vendor.updateMany({
      where: { eventId: { not: EVENT_ID } },
      data: { eventId: EVENT_ID },
    })
    console.log(`✅  Re-parented ${moved.count} vendor(s) to this event.`)
  } else {
    console.log('✅  All vendors already attached to this event.')
  }

  // ── 3. Verify ─────────────────────────────────────────────────────────────

  const [vendorCount, menuCount] = await Promise.all([
    prisma.vendor.count({ where: { eventId: EVENT_ID } }),
    prisma.menuItem.count({ where: { vendor: { eventId: EVENT_ID } } }),
  ])

  console.log('\n📊  Final state:')
  console.log(`   urlSlug     : ${NEW_SLUG}`)
  console.log(`   Vendors     : ${vendorCount}`)
  console.log(`   Menu items  : ${menuCount}`)

  console.log('\n🎉  Done. Verify these endpoints:')
  console.log(`   /api/events/${NEW_SLUG}`)
  console.log(`   /api/vendors?eventSlug=${NEW_SLUG}  → ${vendorCount} vendors`)
  console.log(`   /api/menu?eventSlug=${NEW_SLUG}     → ${menuCount} items`)
  console.log(`   /fair/${NEW_SLUG}/browse\n`)
}

main()
  .catch(e => { console.error('\n❌  Script failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
