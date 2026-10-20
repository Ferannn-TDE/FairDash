/**
 * Seeds demo fairs on the LOCAL dev DB for eyeballing the shared FairCard on the
 * landing page and /fairs: a live fair with a long description and 1 vendor, an
 * upcoming fair with no description and 17 vendors, and an ended fair that is still
 * ACTIVE. Vendors are made listable (stripeVerified + one sellable item). Refuses any
 * non-local database.
 *
 * Run:  npx tsx scripts/seed-fair-card-demo.ts [--clean]
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { isLocalHost, assertNotProductionDatabase } from '../lib/prod-db-guard'

const SLUG = 'fair-card-demo-'
const DAY = 86_400_000

async function main() {
  if (!isLocalHost(process.env.DATABASE_URL)) throw new Error('refusing: DATABASE_URL is not a local database')
  assertNotProductionDatabase('seed-fair-card-demo.ts')
  const db = new PrismaClient()
  try {
    const old = await db.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
    if (old.length) {
      const ids = old.map(e => e.id)
      await db.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
      await db.vendor.deleteMany({ where: { eventId: { in: ids } } })
      await db.event.deleteMany({ where: { id: { in: ids } } })
    }
    if (process.argv.includes('--clean')) { console.log(`removed ${old.length} demo fairs`); return }

    const now = Date.now()
    const fairs = [
      {
        key: 'harvest', name: 'Harvest Days Festival', color: '#FF0077', vendors: 1,
        start: now - DAY, end: now + 2 * DAY,
        description: 'Three days of fresh produce, smoked meats and funnel cakes on the county fairgrounds, with live bluegrass every evening and a kids’ corner by the main gate.',
      },
      { key: 'night', name: 'Riverside Night Market', color: '#F59E0B', vendors: 17, start: now + 10 * DAY, end: now + 12 * DAY, description: null },
      { key: 'summer', name: 'Summer Sizzle Fair', color: '#10B981', vendors: 3, start: now - 9 * DAY, end: now - 6 * DAY, description: 'Last summer’s fair.' },
    ]
    for (const f of fairs) {
      const ev = await db.event.create({ data: {
        name: f.name, urlSlug: `${SLUG}${f.key}`, status: 'ACTIVE', primaryColor: f.color,
        startDate: new Date(f.start), endDate: new Date(f.end), description: f.description,
      } })
      for (let i = 1; i <= f.vendors; i++) {
        await db.vendor.create({ data: {
          eventId: ev.id, name: `${f.name} Vendor ${i}`, slug: `${SLUG}${f.key}-v${i}`, cuisineType: 'Demo',
          status: 'ACTIVE', stripeVerified: true,
          menuItems: { create: { name: 'Demo item', price: 5, category: 'Demo', isAvailable: true } },
        } })
      }
      console.log(`${f.name}: ${f.vendors} vendors, ${f.description ? 'with' : 'no'} description`)
    }
  } finally {
    await db.$disconnect()
  }
}

main().catch(err => { console.error(err.message ?? err); process.exit(1) })
