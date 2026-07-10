/**
 * P2 ARCHIVED VISIBILITY TEST — proves the EXCLUDE-archived sweep:
 *   (a) freshly-created UPCOMING fair → hidden from public (list + detail), visible to organizer
 *   (b) taken live (ACTIVE)          → appears publicly
 *   (c) soft-deleted (archivedAt)    → gone from public AND organizer; default resolver 404s it;
 *                                       the includeArchived money-route resolver STILL resolves it
 *
 * Method: the public list/detail fns are unstable_cache-wrapped, so they can't be
 * re-invoked across state transitions in one process. Public assertions therefore
 * query the EXACT predicate the swept routes now use (getAllFairsCached /
 * getFairBySlugCached / /api/fairs / /api/events/[slug] all resolve to
 * { status: ACTIVE, archivedAt: null }); the organizer/manage/money assertions call
 * the REAL resolveOwnedFair. Final proof remains the human browser pass.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { PrismaClient, EventStatus } from '@prisma/client'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

const SLUG = 'p2vis-'
const MAIL = '@p2vis.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

// Predicate parity with the swept routes.
const PUBLIC  = (urlSlug: string)     => ({ urlSlug, status: EventStatus.ACTIVE, archivedAt: null })
const MYFAIRS = (organizerId: string) => ({ organizerId, archivedAt: null })

async function cleanup() {
  await prisma.event.deleteMany({ where: { urlSlug: { startsWith: SLUG } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  const { resolveOwnedFair } = await import('../lib/organizer-fair-context')
  const { ApiError } = await import('../lib/api-error')

  const org = await prisma.fairOrganizer.create({
    data: { name: `${SLUG}org-${rand()}`, contactEmail: `${SLUG}org-${rand()}${MAIL}`, stripeAccountId: `acct_${SLUG}${rand()}`, stripeVerified: true, stripeConnectedAt: new Date() },
  })
  const slug = `${SLUG}${rand()}`
  const ev = await prisma.event.create({
    data: { name: `P2 ${rand()}`, urlSlug: slug, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'UPCOMING', organizerId: org.id },
  })

  console.log('\n(a) freshly-created UPCOMING fair: hidden from public, visible to organizer')
  assert((await prisma.event.findFirst({ where: PUBLIC(slug) })) === null,
    'UPCOMING fair is ABSENT from the public predicate (discovery hidden + direct URL 404s)')
  assert((await prisma.event.findMany({ where: MYFAIRS(org.id), select: { id: true } })).some(e => e.id === ev.id),
    'UPCOMING fair IS present in the organizer My Fairs predicate')
  assert((await resolveOwnedFair(slug, org.id)).id === ev.id,
    'resolveOwnedFair resolves the UPCOMING fair (manage shell + sub-routes reachable)')

  console.log('\n(b) taken live (ACTIVE): now appears publicly')
  await prisma.event.update({ where: { id: ev.id }, data: { status: 'ACTIVE' } })
  assert((await prisma.event.findFirst({ where: PUBLIC(slug) }))?.id === ev.id,
    'ACTIVE fair IS present in the public predicate (discoverable + detail resolves)')

  console.log('\n(c) soft-deleted (archivedAt set): gone from public AND organizer; money route still reachable')
  await prisma.event.update({ where: { id: ev.id }, data: { archivedAt: new Date() } })
  assert((await prisma.event.findFirst({ where: PUBLIC(slug) })) === null,
    'archived fair is ABSENT from the public predicate even though status=ACTIVE (both conditions bite)')
  assert(!(await prisma.event.findMany({ where: MYFAIRS(org.id), select: { id: true } })).some(e => e.id === ev.id),
    'archived fair is GONE from the organizer My Fairs predicate')
  let threw = false
  try { await resolveOwnedFair(slug, org.id) } catch (e) { threw = e instanceof ApiError }
  assert(threw, 'default resolveOwnedFair 404s the archived fair (manage shell + 15 sub-routes unreachable)')
  assert((await resolveOwnedFair(slug, org.id, { includeArchived: true })).id === ev.id,
    'includeArchived resolver STILL resolves the archived fair (refund/chargeback money paths reachable)')

  await cleanup()
  console.log('\n' + '═'.repeat(66))
  console.log(`  P2 ARCHIVED VISIBILITY TEST — ${pass} passed, ${fail} failed`)
  console.log(`  ${fail === 0 ? 'SWEEP HOLDS: UPCOMING hidden · ACTIVE public · archived gone · money reachable ✅' : 'FAILURES ABOVE ❌'}`)
  console.log('  (cohort deleted — DB back to baseline)')
  console.log('═'.repeat(66))
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
