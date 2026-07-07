import { config } from 'dotenv'; config({ path: '.env.local' })
import { db } from '../lib/db'
import { EventStatus, VendorStatus } from '@prisma/client'
import { toPublicFairStatus } from '../lib/fair-view'

// THE visibility check: a customer lands → sees the REAL fair (not mock) → clicks
// in → sees real vendors/menus; fake fairs gone; non-public fairs hidden.
//
// Runs the EXACT queries the cached helpers / public endpoints wrap (getAllFairsCached
// = /api/fairs; getFairBySlugCached = /api/events/[slug]; getVendorsBySlugCached) —
// the cache wrappers can't run outside a Next request, so we exercise their queries.
//   npx tsx scripts/public-discovery-visibility-check.ts

// Fairs that existed ONLY in lib/mock (NOT in the DB) — springfield/"Italian Fest
// 2026" is excluded because it's the REAL event's name+slug (the mock was modeled
// on it). These mock-only fairs must be absent now that discovery reads the DB.
const MOCK_ONLY_NAMES = ['STL Street Food Festival', 'Columbus Taste Fest', 'Edwardsville Night Market']
const MOCK_ONLY_SLUGS = ['stl-food-festival-2026', 'columbus-taste-fest-2026', 'edwardsville-night-market-2026']

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

async function main() {
  // ── Discovery list — mirrors getAllFairsCached / GET /api/fairs ───────────
  const events = await db.event.findMany({
    where: { status: { in: [EventStatus.ACTIVE, EventStatus.UPCOMING] } },
    orderBy: { startDate: 'asc' },
    select: { name: true, urlSlug: true, status: true, _count: { select: { vendors: { where: { status: VendorStatus.ACTIVE } } } } },
  })
  const list = events.map(e => ({ name: e.name, slug: e.urlSlug, status: toPublicFairStatus(e.status), vendorCount: e._count.vendors }))
  console.log(`\nDISCOVERY LIST (${list.length} fair(s)):`)
  for (const f of list) console.log(`   • ${f.name}  [${f.status}]  slug=${f.slug}  vendors=${f.vendorCount}`)

  console.log('\n── Fake (mock-only) fairs gone ──')
  const mockLeak = list.filter(f => MOCK_ONLY_NAMES.some(m => f.name.includes(m)) || MOCK_ONLY_SLUGS.includes(f.slug))
  check('no mock-only fairs (STL/Columbus/Edwardsville) in the list', mockLeak.length === 0, mockLeak.map(f => f.name).join(', ') || 'clean')

  console.log('\n── Only public statuses listed ──')
  check('every listed fair is active/upcoming', list.every(f => ['active', 'upcoming'].includes(f.status)))
  const inactive = await db.event.findMany({ where: { status: 'INACTIVE' }, select: { urlSlug: true } })
  const inactiveLeak = inactive.filter(e => list.some(f => f.slug === e.urlSlug))
  check(`INACTIVE events excluded from discovery (${inactive.length} inactive in DB)`, inactiveLeak.length === 0)

  // ── Reach the real fair end-to-end ────────────────────────────────────────
  const target = list.find(f => f.status === 'active') ?? list[0]
  check('there IS a reachable fair to land on', !!target)
  if (!target) { process.exit(1) }

  console.log(`\n── Click into "${target.name}" (/fair/${target.slug}) ──`)
  // mirrors getFairBySlugCached / GET /api/events/[slug]
  const detail = await db.event.findFirst({ where: { urlSlug: target.slug }, select: { name: true, urlSlug: true } })
  check('single-fair page resolves the real fair', detail?.urlSlug === target.slug, detail?.name)
  check('detail resolves a real (non-mock-only) fair', !!detail && !MOCK_ONLY_NAMES.some(m => detail.name.includes(m)), detail?.name)

  // mirrors getVendorsBySlugCached / GET /api/vendors?eventSlug=
  const vendors = await db.vendor.findMany({ where: { event: { urlSlug: target.slug }, status: VendorStatus.ACTIVE }, select: { id: true } })
  check('real vendors load for the fair', vendors.length > 0, `${vendors.length} active vendors`)

  const withMenus = await db.vendor.count({
    where: { event: { urlSlug: target.slug }, status: 'ACTIVE', menuItems: { some: { isAvailable: true } } },
  })
  check('at least one vendor has an available menu', withMenus > 0, `${withMenus} vendors with menus`)

  console.log(`\n${failures === 0 ? '✅ VISIBILITY CONFIRMED — real fair reachable, fakes gone, non-public hidden' : `❌ ${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
