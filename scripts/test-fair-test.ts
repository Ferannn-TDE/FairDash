/**
 * THE HIDDEN B1.17 TEST FAIR (lib/test-fair.ts + scripts/create-test-fair.ts). Test DB; real readers.
 *
 *   [0] baseline: no stray unarchived UNLISTED event in the test DB (else the one-at-a-time rule is untestable)
 *   [1] refusals: unknown / PENDING / suspended organizer, reversed dates, > 14 days, taken slug (each with a
 *       positive control that a valid plan passes)
 *   [2] create (booth only): ACTIVE, UNLISTED, the organizer's, booth on, curbside + delivery off, no venue;
 *       a second test fair is refused while the first is unarchived
 *   [3] visibility: reachable by direct URL, not indexable, absent from the fairs list, /api/fairs and the sitemap
 *       (a PUBLIC ACTIVE fair is the positive control); orderable state at an instant pinned inside its dates
 *   [4] archive: refuses unknown, PUBLIC and SIGNUP_ONLY events; archives the test fair (count 1, orders kept);
 *       a second archive is refused; afterwards a new test fair may be created
 *   [5] --curbside: curbside on ($3.99 legacy fee, zone text), booth still on, delivery off
 *   [6] the CLI refuses --confirm against production without ALLOW_PROD_WRITES (source check + positive control)
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/test-fair-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)
import { readFileSync } from 'node:fs'
import { EventListing, EventStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'tf-', MAIL = '@tf.local', rand = () => Math.random().toString(36).slice(2, 8)
let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
  await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
  await prisma.event.deleteMany({ where: { id: { in: ids } } })
  const orgs = await prisma.fairOrganizer.findMany({ where: { name: { startsWith: PFX } }, select: { id: true } })
  await prisma.orgMember.deleteMany({ where: { organizerId: { in: orgs.map(o => o.id) } } })
  await prisma.fairOrganizer.deleteMany({ where: { id: { in: orgs.map(o => o.id) } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function refused(fn: () => Promise<unknown>, code: string) {
  try { await fn(); return false } catch (e: any) { return e?.name === 'TestFairRefused' && e.code === code }
}

async function main() {
  await cleanup()
  const tf = await import('../lib/test-fair')
  const D = (s: string, end = false) => new Date(`${s}T${end ? '23:59:59' : '00:00:00'}-06:00`)

  // ── [0] baseline ─────────────────────────────────────────────────────────────────────
  console.log('[0] Baseline')
  const stray = await prisma.event.count({ where: { listing: EventListing.UNLISTED, archivedAt: null, NOT: { urlSlug: { startsWith: PFX } } } })
  assert(stray === 0, `no stray unarchived UNLISTED event in the test DB (found ${stray})`)

  const mkOrg = async (approval: 'APPROVED' | 'PENDING', suspended = false) => {
    const email = `org-${rand()}${MAIL}`
    const user = await prisma.user.create({ data: { clerkId: `${PFX}u-${rand()}`, email, name: 'Org' } })
    const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}org`, contactEmail: email, approvalStatus: approval, suspendedAt: suspended ? new Date() : null } })
    await prisma.orgMember.create({ data: { organizerId: org.id, userId: user.id, role: 'owner' } })
    return { org, email }
  }
  const owner = await mkOrg('APPROVED')
  const input = (over: Partial<Parameters<typeof tf.planTestFair>[1]> = {}) => ({
    organizerEmail: owner.email, name: tf.TEST_FAIR_DEFAULTS.name, slug: `${PFX}${rand()}`,
    startDate: D('2027-03-01'), endDate: D('2027-03-03', true), curbside: false, ...over,
  })

  // ── [1] refusals ─────────────────────────────────────────────────────────────────────
  console.log('\n[1] Refusals (each with a positive control)')
  const ok = await tf.planTestFair(prisma as any, input())
  assert(ok.organizer.id === owner.org.id, '[0] control: a valid plan passes for the approved organizer')
  assert(await refused(() => tf.planTestFair(prisma as any, input({ organizerEmail: `nobody-${rand()}${MAIL}` })), 'NO_ORGANIZER'), 'unknown organizer email → NO_ORGANIZER')
  const pending = await mkOrg('PENDING')
  assert(await refused(() => tf.planTestFair(prisma as any, input({ organizerEmail: pending.email })), 'NOT_APPROVED'), 'PENDING organizer → NOT_APPROVED')
  const susp = await mkOrg('APPROVED', true)
  assert(await refused(() => tf.planTestFair(prisma as any, input({ organizerEmail: susp.email })), 'SUSPENDED'), 'suspended organizer → SUSPENDED')
  assert(await refused(() => tf.planTestFair(prisma as any, input({ startDate: D('2027-03-05'), endDate: D('2027-03-04', true) })), 'BAD_DATES'), 'end before start → BAD_DATES')
  assert(!(await refused(() => tf.planTestFair(prisma as any, input({ startDate: D('2027-03-01'), endDate: D('2027-03-14', true) })), 'BAD_DATES')), '[0] control: a 14-day span is allowed')
  assert(await refused(() => tf.planTestFair(prisma as any, input({ startDate: D('2027-03-01'), endDate: D('2027-03-16', true) })), 'BAD_DATES'), 'a span over 14 days → BAD_DATES')
  const takenSlug = `${PFX}taken-${rand()}`
  await prisma.event.create({ data: { organizerId: owner.org.id, name: `${PFX}public`, urlSlug: takenSlug, status: EventStatus.ACTIVE, startDate: D('2027-03-01'), endDate: D('2027-03-03', true) } })
  assert(await refused(() => tf.planTestFair(prisma as any, input({ slug: takenSlug })), 'SLUG_TAKEN'), 'a slug already in use → SLUG_TAKEN')

  // ── [2] create, booth only ───────────────────────────────────────────────────────────
  console.log('\n[2] Create (booth only)')
  const slug1 = `${PFX}fair-${rand()}`
  const made = await tf.createTestFair(prisma as any, input({ slug: slug1 }))
  const row = await prisma.event.findUnique({ where: { urlSlug: slug1 }, include: { fulfillmentConfig: true } })
  assert(!!row && row.status === EventStatus.ACTIVE && row.listing === EventListing.UNLISTED && row.organizerId === owner.org.id && row.archivedAt === null,
    'ACTIVE, UNLISTED, owned by the organizer, not archived')
  assert(!!row?.fulfillmentConfig && row.fulfillmentConfig.boothPickupEnabled && !row.fulfillmentConfig.curbsideEnabled && !row.fulfillmentConfig.homeDeliveryEnabled,
    'booth pickup on; curbside and delivery off')
  assert(row?.venueAddress == null && row?.venueCity == null && row?.eventLat == null, 'no venue')
  assert(made.urlSlug === slug1 && row?.name === 'FairSynq Test Fair', 'named "FairSynq Test Fair" by default')
  assert(await refused(() => tf.createTestFair(prisma as any, input()), 'ALREADY_EXISTS'), 'a second test fair is refused while the first is unarchived')

  // ── [3] visibility + orderable state ─────────────────────────────────────────────────
  console.log('\n[3] Visibility')
  const pubSlug = `${PFX}pub-${rand()}`
  const now = Date.now()
  await prisma.event.create({ data: { organizerId: owner.org.id, name: `${PFX}pub`, urlSlug: pubSlug, status: EventStatus.ACTIVE, startDate: new Date(now - 864e5), endDate: new Date(now + 3 * 864e5) } })
  await prisma.event.update({ where: { urlSlug: slug1 }, data: { startDate: new Date(now - 864e5), endDate: new Date(now + 3 * 864e5) } }) // live window for the list readers
  const fairs = await import('../lib/fairs')
  const slugs = (xs: Array<{ slug?: string; urlSlug?: string }>) => new Set(xs.map(x => x.slug ?? x.urlSlug))
  const list = slugs(await fairs.getAllFairsCached() as any)
  const api: any = await (await (await import('../app/api/fairs/route')).GET()).json()
  const sitemap = new Set((await fairs.getSitemapFairsCached()).map(f => f.slug))
  for (const [name, s] of [['fairs list', list], ['/api/fairs', slugs(api.data)], ['sitemap', sitemap]] as const) {
    assert(s.has(pubSlug), `[0] control: ${name} shows a PUBLIC ACTIVE fair`)
    assert(!s.has(slug1), `${name} never shows the test fair`)
  }
  assert(!!(await fairs.getFairBySlugCached(slug1)), 'the test fair page resolves by direct URL')
  assert((await fairs.getFairSeoBySlugCached(slug1))?.indexable === false, 'and is not indexable')
  const { deriveEventLiveState } = await import('../lib/event-date')
  const created = await prisma.event.findUnique({ where: { urlSlug: slug1 } })
  const pinned = created!.startDate.getTime() + 36e5 // an instant inside its dates, taken from the data
  assert(created!.status === EventStatus.ACTIVE && created!.listing !== EventListing.SIGNUP_ONLY && !created!.isPaused && deriveEventLiveState(created!.startDate, created!.endDate, pinned) === 'live',
    'orderable: ACTIVE, not sign-up only, not paused, live at an instant inside its dates (the order route\'s event checks)')

  // ── [4] archive ──────────────────────────────────────────────────────────────────────
  console.log('\n[4] Archive')
  assert(await refused(() => tf.planArchiveTestFair(prisma as any, `${PFX}missing-${rand()}`), 'NOT_FOUND'), 'unknown slug → NOT_FOUND')
  assert(await refused(() => tf.archiveTestFair(prisma as any, pubSlug), 'NOT_UNLISTED'), 'a PUBLIC fair is refused (NOT_UNLISTED), never archived')
  const suSlug = `${PFX}su-${rand()}`
  await prisma.event.create({ data: { organizerId: owner.org.id, name: `${PFX}su`, urlSlug: suSlug, status: EventStatus.UPCOMING, listing: EventListing.SIGNUP_ONLY, startDate: D('2027-01-01'), endDate: D('2027-12-31', true) } })
  assert(await refused(() => tf.archiveTestFair(prisma as any, suSlug), 'NOT_UNLISTED'), 'the sign-up event is refused (NOT_UNLISTED)')
  const pubAfter = await prisma.event.findUnique({ where: { urlSlug: pubSlug } }), suAfter = await prisma.event.findUnique({ where: { urlSlug: suSlug } })
  assert(pubAfter?.archivedAt === null && suAfter?.archivedAt === null, 'neither refused event was touched')
  const done = await tf.archiveTestFair(prisma as any, slug1)
  const arch = await prisma.event.findUnique({ where: { urlSlug: slug1 } })
  assert(done.archived === 1 && !!arch?.archivedAt && arch.listing === EventListing.UNLISTED && arch.status === EventStatus.ACTIVE,
    'the test fair is archived (count 1): archivedAt set, nothing else changed')
  assert(done.kept.orders === 0 && done.kept.payouts === 0 && done.kept.refunds === 0, 'reports what it keeps (orders / payouts / refunds)')
  assert(await refused(() => tf.archiveTestFair(prisma as any, slug1), 'ALREADY_ARCHIVED'), 'a second archive is refused')

  // ── [5] --curbside ───────────────────────────────────────────────────────────────────
  console.log('\n[5] --curbside')
  const slug2 = `${PFX}curb-${rand()}`
  await tf.createTestFair(prisma as any, input({ slug: slug2, curbside: true }))
  const c = await prisma.event.findUnique({ where: { urlSlug: slug2 }, include: { fulfillmentConfig: true } })
  assert(!!c?.fulfillmentConfig && c.fulfillmentConfig.curbsideEnabled && c.fulfillmentConfig.boothPickupEnabled && !c.fulfillmentConfig.homeDeliveryEnabled,
    'after archiving, a new test fair can be created; with --curbside: curbside ON, booth still on, delivery off')
  assert(c?.fulfillmentConfig?.curbsideFee === 3.99 && !!c?.fulfillmentConfig?.curbsideZoneDescription, 'curbside fee $3.99 (matches the platform setting) and a zone description')

  // ── [6] CLI production guard ─────────────────────────────────────────────────────────
  console.log('\n[6] CLI guard')
  const cli = readFileSync('scripts/create-test-fair.ts', 'utf8')
  const GUARD = /if \(confirm && process\.env\.CONFIRM_PROD_DB && process\.env\.ALLOW_PROD_WRITES !== 'true'\)\s*\{\s*throw/
  assert(GUARD.test("if (confirm && process.env.CONFIRM_PROD_DB && process.env.ALLOW_PROD_WRITES !== 'true') {\n    throw new Error('x')"), '[0] control: the probe matches the guard shape')
  assert(GUARD.test(cli), '--confirm against production refuses without ALLOW_PROD_WRITES=true')
  assert(cli.indexOf("process.env.ALLOW_PROD_WRITES !== 'true'") < cli.indexOf('planArchiveTestFair(db'), 'the guard runs before any plan or write')
}

main()
  .catch(e => { console.error(e); fail++ })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    console.log(`\n${'─'.repeat(64)}`)
    console.log(fail === 0 ? `  ${pass} passed, 0 failed` : `  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(64)}\n`)
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
