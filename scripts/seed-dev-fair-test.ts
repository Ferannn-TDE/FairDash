/**
 * DEV FAIR SEED — scripts/_dev-fair-seed.ts and its runner scripts/seed-dev-fair.ts, against the
 * test DB with a fake Clerk (no network).
 *
 *   [0] the date window is "live" by the app's own rule (lib/event-date.ts deriveEventLiveState)
 *   [1] first run: one ACTIVE public fair open today, 3 ACTIVE vendors (booths A1–A3, no Stripe
 *       data), 9 sellable items priced $1.00–$20.00 that pass the app's price rule
 *   [2] re-run: dates move, nothing duplicated, existing vendors and items untouched (price,
 *       removal, status), a missing vendor is recreated with its items
 *   [3] a wrong email refuses before anything is written
 *   [4] --vendor-email: APPROVED owner of Dev Grill through lib/payee-membership, "vendor" added
 *       to the Clerk roles, a second run adds no second row
 *   [5] --organizer-email: the fair belongs to that person's organizer account, approval untouched
 *   [6] the runner refuses a bad argument, a production, a remote and a split (TEST_DATABASE_URL)
 *       database before it connects
 *   [7] source: the seed module builds no client, writes no Stripe field, creates memberships only
 *       through lib/payee-membership; the runner checks before it builds a client
 *
 * Cleanup removes test users with user.deleteMany, which cascades to their VendorMember and
 * OrgMember rows (the whole-account delete scripts/membership-delete-guard.ts allows).
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/seed-dev-fair-test.ts
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { ApprovalStatus, EventListing, EventStatus, VendorStatus } from '@prisma/client'
import { testPrisma } from '../lib/test-db'
import { __setClerkForTest } from '../lib/role-sync'
import { addOrgOwner } from '../lib/payee-membership'
import { deriveEventLiveState } from '../lib/event-date'
import { parseInPersonPrice } from '../lib/menu/price'
import { SELLABLE } from '../lib/menu/on-menu'
import {
  DEV_FAIR_SLUG, DEV_LINKED_VENDOR_SLUG, DEV_VENDORS, DevSeedRefused, devFairWindow, seedDevFair,
} from './_dev-fair-seed'

process.env.REDIS_URL = ''

const prisma = testPrisma()
const DAY_MS = 24 * 60 * 60 * 1000
const MAIL = '@seed-dev-fair.test'
const VENDOR_EMAIL = `sdf-vendor${MAIL}`
const ORGANIZER_EMAIL = `sdf-organizer${MAIL}`
const PLAIN_EMAIL = `sdf-plain${MAIL}`
const ORGANIZER_ID = 'sdf-organizer'
const REPO = fileURLToPath(new URL('..', import.meta.url))
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli')

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

// ── Fake Clerk: roles per Clerk id, in memory ────────────────────────────────────────────────
const clerkRoles = new Map<string, unknown[]>()
const fakeClerk = {
  users: {
    async getUser(id: string) {
      if (!clerkRoles.has(id)) throw new Error('not found')
      return { id, publicMetadata: { roles: clerkRoles.get(id) } }
    },
    async updateUserMetadata(id: string, p: { publicMetadata: Record<string, unknown> }) {
      clerkRoles.set(id, Array.isArray(p.publicMetadata.roles) ? p.publicMetadata.roles : [])
      return { id, publicMetadata: p.publicMetadata }
    },
  },
}
__setClerkForTest(fakeClerk as unknown as Parameters<typeof __setClerkForTest>[0])

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
  const ev = await prisma.event.findUnique({ where: { urlSlug: DEV_FAIR_SLUG }, select: { id: true } })
  if (ev) {
    await prisma.menuItem.deleteMany({ where: { vendor: { eventId: ev.id } } })
    await prisma.vendor.deleteMany({ where: { eventId: ev.id } })
    await prisma.event.delete({ where: { id: ev.id } })
  }
  await prisma.fairOrganizer.deleteMany({ where: { id: ORGANIZER_ID } })
  clerkRoles.clear()
}

const fairVendors = (eventId: string) =>
  prisma.vendor.findMany({ where: { eventId }, include: { menuItems: true }, orderBy: { slug: 'asc' } })

function runCli(args: string[], env: Record<string, string>) {
  const base: Record<string, string | undefined> = { ...process.env }
  for (const k of ['DATABASE_URL', 'DIRECT_URL', 'TEST_DATABASE_URL', 'CONFIRM_PROD_DB', 'VERCEL',
    'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_PROJECT_ID', 'RAILWAY_GIT_COMMIT_SHA']) delete base[k]
  const r = spawnSync(process.execPath, [TSX_CLI, 'scripts/seed-dev-fair.ts', ...args], {
    cwd: REPO, env: { ...base, NODE_ENV: 'development', ...env }, encoding: 'utf8', timeout: 60_000,
  })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

async function main() {
  await cleanup()
  console.log('\n══ DEV FAIR SEED ══')

  console.log('\n[0] the date window is live by the app rule')
  const fixed = new Date('2026-11-16T15:00:00Z')
  const w = devFairWindow(fixed)
  assert(w.startDate.toISOString() === '2026-11-15T00:00:00.000Z', 'starts yesterday at UTC midnight')
  assert(w.endDate.toISOString() === '2026-12-16T00:00:00.000Z', 'ends 30 days from today at UTC midnight')
  for (const iso of ['2026-11-16T00:00:00Z', '2026-11-16T12:00:00Z', '2026-11-16T23:59:59Z']) {
    const now = new Date(iso)
    const ww = devFairWindow(now)
    assert(deriveEventLiveState(ww.startDate, ww.endDate, now.getTime()) === 'live', `live when seeded at ${iso}`)
  }
  assert(deriveEventLiveState(w.startDate, w.endDate, new Date('2026-12-17T00:00:00Z').getTime()) === 'ended',
    'control: the same window reads "ended" after its last day')

  console.log('\n[1] first run')
  const r1 = await seedDevFair(prisma)
  const ev = await prisma.event.findUniqueOrThrow({ where: { urlSlug: DEV_FAIR_SLUG } })
  assert(ev.status === EventStatus.ACTIVE && ev.listing === EventListing.PUBLIC, 'fair is ACTIVE and PUBLIC')
  assert(deriveEventLiveState(ev.startDate, ev.endDate) === 'live', 'fair is open today')
  assert(ev.onlineMarkupBps === 0 && !ev.isPaused && ev.archivedAt === null, 'markup 0%, not paused, not archived')
  assert(ev.organizerId === null, 'no organizer without --organizer-email')
  const vendors = await fairVendors(ev.id)
  assert(vendors.length === 3, '3 vendors')
  assert(JSON.stringify(r1.createdVendors) === JSON.stringify(DEV_VENDORS.map(v => v.name)) && r1.keptVendors.length === 0,
    'the result lists the 3 created vendors')
  assert(vendors.every(v => v.status === VendorStatus.ACTIVE && !v.isOffline && !v.isBusy), 'every vendor ACTIVE, online, not busy')
  assert(JSON.stringify(vendors.map(v => v.boothNumber)) === '["A1","A2","A3"]', 'booths A1, A2, A3')
  assert(vendors.every(v => v.stripeAccountId === null && v.stripeVerified === false), 'no Stripe data on any vendor')
  const items = vendors.flatMap(v => v.menuItems)
  assert(items.length === 9, '9 items')
  assert(items.every(i => i.price >= 1 && i.price <= 20), 'every price between $1.00 and $20.00')
  assert(items.some(i => i.price === 1) && items.some(i => i.price === 20), 'the $1.00 and $20.00 edges are both present')
  assert(items.every(i => parseInPersonPrice(i.price).ok), 'every price passes the app price rule (lib/menu/price.ts)')
  assert(await prisma.menuItem.count({ where: { vendor: { eventId: ev.id }, ...SELLABLE } }) === 9, 'all 9 items are SELLABLE')

  console.log('\n[2] re-run keeps what exists')
  const grill = vendors.find(v => v.slug === 'dev-grill')!
  const sweets = vendors.find(v => v.slug === 'dev-sweets')!
  const tacos = vendors.find(v => v.slug === 'dev-tacos')!
  const fries = grill.menuItems.find(i => i.name === 'Fries')!
  const burger = grill.menuItems.find(i => i.name === 'Burger')!
  // Test-only changes standing in for what happens while clicking through the site.
  await prisma.menuItem.update({ where: { id: fries.id }, data: { price: 5 } })
  await prisma.menuItem.update({ where: { id: burger.id }, data: { removedAt: new Date() } })
  await prisma.vendor.update({ where: { id: tacos.id }, data: { status: VendorStatus.PAUSED } })
  await prisma.menuItem.deleteMany({ where: { vendorId: sweets.id } })
  await prisma.vendor.delete({ where: { id: sweets.id } })
  await prisma.event.update({ where: { id: ev.id }, data: {
    status: EventStatus.UPCOMING, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-01-02T00:00:00Z'),
  } })
  const later = new Date(Date.now() + 3 * DAY_MS)
  const r2 = await seedDevFair(prisma, { now: later })
  const ev2 = await prisma.event.findUniqueOrThrow({ where: { urlSlug: DEV_FAIR_SLUG } })
  const w2 = devFairWindow(later)
  assert(ev2.id === ev.id, 'same fair row (found by slug)')
  assert(ev2.startDate.getTime() === w2.startDate.getTime() && ev2.endDate.getTime() === w2.endDate.getTime(),
    'dates moved to the new window')
  assert(ev2.status === EventStatus.ACTIVE, 'fair is ACTIVE again')
  const v2 = await fairVendors(ev.id)
  assert(v2.length === 3 && v2.flatMap(v => v.menuItems).length === 9, 'still 3 vendors and 9 items, no duplicates')
  assert(JSON.stringify(r2.createdVendors) === '["Dev Sweets"]', 'the missing vendor is recreated')
  assert(v2.find(v => v.slug === 'dev-sweets')!.menuItems.length === 3, '...with its 3 items')
  assert(JSON.stringify(r2.keptVendors.map(k => k.name)) === '["Dev Grill","Dev Tacos"]', 'the other two are reported as kept')
  assert(r2.keptVendors.find(k => k.name === 'Dev Tacos')!.status === VendorStatus.PAUSED, 'a kept vendor\'s real status is reported')
  assert(v2.find(v => v.slug === 'dev-tacos')!.status === VendorStatus.PAUSED, 'a PAUSED vendor stays PAUSED (no move into ACTIVE)')
  const grill2 = v2.find(v => v.slug === 'dev-grill')!
  assert(grill2.menuItems.find(i => i.name === 'Fries')!.price === 5, 'a changed price is not reset')
  assert(grill2.menuItems.find(i => i.name === 'Burger')!.removedAt !== null, 'a removed item stays removed')

  console.log('\n[3] a wrong email refuses before writing')
  await cleanup()
  let refused: unknown = null
  try { await seedDevFair(prisma, { vendorEmail: `nobody${MAIL}` }) } catch (e) { refused = e }
  assert(refused instanceof DevSeedRefused && /no FairSynq account/.test(refused.message), 'unknown --vendor-email is refused')
  assert(await prisma.event.count({ where: { urlSlug: DEV_FAIR_SLUG } }) === 0, '...and nothing was written')
  await prisma.user.create({ data: { clerkId: 'user_sdf_plain', email: PLAIN_EMAIL } })
  refused = null
  try { await seedDevFair(prisma, { organizerEmail: PLAIN_EMAIL }) } catch (e) { refused = e }
  assert(refused instanceof DevSeedRefused && /has no organizer account/.test(refused.message),
    '--organizer-email of a person with no organizer account is refused')
  assert(await prisma.event.count({ where: { urlSlug: DEV_FAIR_SLUG } }) === 0, '...and nothing was written')

  console.log('\n[4] --vendor-email')
  const vUser = await prisma.user.create({ data: { clerkId: 'user_sdf_vendor', email: VENDOR_EMAIL } })
  clerkRoles.set('user_sdf_vendor', [])
  const r4 = await seedDevFair(prisma, { vendorEmail: VENDOR_EMAIL.toUpperCase() })
  assert(r4.vendorLink?.outcome === 'created' && r4.vendorLink.approvalStatus === ApprovalStatus.APPROVED,
    'linked as a new APPROVED member (email matched without regard to case)')
  const grill4 = await prisma.vendor.findFirstOrThrow({ where: { slug: DEV_LINKED_VENDOR_SLUG, event: { urlSlug: DEV_FAIR_SLUG } } })
  const members = await prisma.vendorMember.findMany({ where: { userId: vUser.id } })
  assert(members.length === 1 && members[0].vendorId === grill4.id && members[0].role === 'owner'
    && members[0].approvalStatus === ApprovalStatus.APPROVED, 'one APPROVED owner row, on Dev Grill')
  assert((clerkRoles.get('user_sdf_vendor') ?? []).includes('vendor'), '"vendor" added to the Clerk roles')
  const r4b = await seedDevFair(prisma, { vendorEmail: VENDOR_EMAIL })
  assert(r4b.vendorLink?.outcome === 'already-member', 'a second run reports the existing membership')
  assert(await prisma.vendorMember.count({ where: { userId: vUser.id } }) === 1, '...and adds no second row')

  console.log('\n[5] --organizer-email')
  const oUser = await prisma.user.create({ data: { clerkId: 'user_sdf_org', email: ORGANIZER_EMAIL } })
  clerkRoles.set('user_sdf_org', [])
  await prisma.fairOrganizer.create({ data: { id: ORGANIZER_ID, name: 'SDF Organizer', contactEmail: ORGANIZER_EMAIL } })
  await addOrgOwner(ORGANIZER_ID, oUser.id, { db: prisma })
  const r5 = await seedDevFair(prisma, { organizerEmail: ORGANIZER_EMAIL })
  const ev5 = await prisma.event.findUniqueOrThrow({ where: { urlSlug: DEV_FAIR_SLUG } })
  assert(ev5.organizerId === ORGANIZER_ID, 'the fair belongs to that organizer account')
  assert(r5.organizerLink?.approvalStatus === ApprovalStatus.PENDING, 'the result reports the organizer as PENDING')
  const org = await prisma.fairOrganizer.findUniqueOrThrow({ where: { id: ORGANIZER_ID } })
  assert(org.approvalStatus === ApprovalStatus.PENDING, 'the organizer\'s approval is not changed (the admin approves it)')

  console.log('\n[6] the runner refuses before connecting')
  const LOCAL = 'postgresql://fairsynq:fairsynq@localhost:54329/fairsynq_dev'
  const bad = runCli(['--bogus'], { DATABASE_URL: LOCAL, DIRECT_URL: LOCAL })
  assert(bad.code === 1 && bad.out.includes('unknown argument'), 'an unknown argument is refused')
  const prod = 'postgresql://postgres.abcdefghijklmnopqrst:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres'
  const p = runCli([], { DATABASE_URL: prod, DIRECT_URL: prod })
  assert(p.code === 1 && p.out.includes('PRODUCTION database'), 'a production database is refused (prod-db guard)')
  const remote = 'postgresql://u:p@db.example.com:5432/x'
  const r = runCli([], { DATABASE_URL: remote, DIRECT_URL: remote })
  assert(r.code === 1 && r.out.includes('is not a local database'), 'a remote, non-production database is refused')
  const split = runCli([], { DATABASE_URL: LOCAL, DIRECT_URL: LOCAL, TEST_DATABASE_URL: LOCAL })
  assert(split.code === 1 && split.out.includes('TEST_DATABASE_URL is set'), 'a set TEST_DATABASE_URL is refused')
  assert(![bad, p, r, split].some(x => x.out.includes('✅ Dev Test Fair')), 'none of the refused runs seeded anything')

  console.log('\n[7] source')
  const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // Built from pieces: scripts/test-isolation-guard.ts scans every suite's text for the
  // constructor call, so a literal one here would read as this suite building a client.
  const CTOR = ['new', 'PrismaClient()'].join(' ')
  assert(/new\s+PrismaClient/.test(strip(`const c = ${CTOR}`)) && !/new\s+PrismaClient/.test(strip(`// ${CTOR}\r\n`)),
    'control: the scan finds code and ignores comments (CRLF included)')
  const seedSrc = strip(readFileSync(new URL('./_dev-fair-seed.ts', import.meta.url), 'utf8'))
  const cliSrc = strip(readFileSync(new URL('./seed-dev-fair.ts', import.meta.url), 'utf8'))
  assert(!/new\s+PrismaClient/.test(seedSrc), 'the seed module builds no database client')
  assert(!/stripeAccountId|stripeVerified/.test(seedSrc), 'the seed module writes no Stripe field')
  assert(/addVendorMember\(/.test(seedSrc) && !/vendorMember\.create|orgMember\.create/.test(seedSrc),
    'memberships only through lib/payee-membership')
  const guardAt = cliSrc.indexOf('refuseUnlessLocalDevDatabase()', cliSrc.indexOf('async function main'))
  const clientAt = cliSrc.indexOf('new PrismaClient')
  assert(guardAt > 0 && clientAt > guardAt, 'the runner checks the database before it builds a client')
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    __setClerkForTest(null)
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
