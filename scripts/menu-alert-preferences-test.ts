/**
 * MENU-ALERT PREFERENCES — audit H5, step 3b. Real route, test DB.
 *
 * Each organizer member and each strict admin picks their own channel per alert type, through
 * GET/PUT /api/notification-preferences. Deletes: Email / In-app / Both / None. Price increases
 * awaiting approval: Email / In-app / Both — "None" is refused with 400 (Jordan, Nov 15).
 *
 *   [1] access: signed out 401; customer, vendor, event_operator, platform_manager 403; pending
 *       and suspended organizer 403 with their own codes; approved member and strict admin 200;
 *       a strict admin with no User row 404
 *   [2] GET with nothing saved: both rows Both, saved false, allowed lists of 4 and 3
 *   [3] PUT: NONE for deletes saved; NONE for price increases 400 CHANNEL_NOT_ALLOWED and the saved
 *       value unchanged; unknown type, lower case, unknown word, non-JSON 400; saving again
 *       updates the one row
 *   [4] isolation: one person's choice never changes another's
 *   [5] end to end with 3a: a member who saved In-app gets a bell notification and no email
 *   [6] screens (source checks; the repo has no browser test framework)
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/menu-alert-preferences-test.ts
 * Self-cleaning, prefix map-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST

import { register } from 'node:module'
import { readFileSync } from 'node:fs'
register('./_route-loader.mjs', import.meta.url)

import { NextRequest } from 'next/server'
import type { ApprovalStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'map-'
const MAIL = '@map.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

function login(clerkId: string | null, roles?: string[]) {
  const g = globalThis as unknown as { __MOCK_CLERK?: { userId: string; publicMetadata?: unknown } }
  g.__MOCK_CLERK = clerkId ? { userId: clerkId, ...(roles && { publicMetadata: { roles } }) } : undefined
}
type Pref = { eventType: string; label: string; channel: string; allowed: string[]; saved: boolean }
type Body = { success?: boolean; data?: { preferences?: Pref[] }; error?: { code?: string; message?: string } }
async function bodyOf(res: Response): Promise<Body> {
  try { return await res.json() as Body } catch { return {} }
}
const prefOf = (b: Body, type: string) => b.data?.preferences?.find(p => p.eventType === type)

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const vids = vs.map(v => v.id)
    await prisma.menuChangeEvent.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.notification.deleteMany({ where: { to: { endsWith: MAIL } } })
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  // Saved choices and bell rows go with their user (foreign key, cascade).
  await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: MAIL } }, { clerkId: { startsWith: PFX } }] } })
}

async function main() {
  console.log('\n══ MENU-ALERT PREFERENCES (H5, step 3b) ══')
  await cleanup()

  const route = await import('../app/api/notification-preferences/route')
  const GET = route.GET as unknown as () => Promise<Response>
  const PUT = route.PUT as unknown as (r: NextRequest) => Promise<Response>
  const put = (body: unknown, raw?: string) => PUT(new NextRequest('http://localhost/api/notification-preferences', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body),
  }))

  // ── fixture ─────────────────────────────────────────────────────────────────────────────────
  const mkUser = (tag: string) => prisma.user.create({
    data: { clerkId: `${PFX}${tag}-${rand()}`, email: `${tag}-${rand()}${MAIL}`, name: tag },
  })
  const mkOrg = async (tag: string, data: { approvalStatus?: ApprovalStatus; suspendedAt?: Date } = {}) => {
    const org = await prisma.fairOrganizer.create({
      data: { name: `${PFX}${tag}`, contactEmail: `${tag}-${rand()}${MAIL}`, approvalStatus: data.approvalStatus ?? 'APPROVED', suspendedAt: data.suspendedAt },
    })
    const user = await mkUser(tag)
    await prisma.orgMember.create({ data: { organizerId: org.id, userId: user.id, role: 'owner' } })
    return { org, user }
  }
  const approved = await mkOrg('approved')
  const second = await mkUser('second')
  await prisma.orgMember.create({ data: { organizerId: approved.org.id, userId: second.id, role: 'member' } })
  const pending = await mkOrg('pending', { approvalStatus: 'PENDING' })
  const suspended = await mkOrg('suspended', { suspendedAt: new Date() })
  const customer = await mkUser('customer')
  const admin = await mkUser('admin')
  const evop = await mkUser('evop')
  const pm = await mkUser('pm')
  const now = Date.now()
  const fair = await prisma.event.create({
    data: { name: `${PFX}Fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', organizerId: approved.org.id, startDate: new Date(now - 864e5), endDate: new Date(now + 864e5) },
  })
  const vendor = await prisma.vendor.create({ data: { eventId: fair.id, name: 'Booth P', slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } })
  const vendorUser = await mkUser('vendor')
  await prisma.vendorMember.create({ data: { vendorId: vendor.id, userId: vendorUser.id, role: 'owner', approvalStatus: 'APPROVED' } })

  // ── [1] access ──────────────────────────────────────────────────────────────────────────────
  console.log('\n[1] who may read and save menu-alert settings')
  login(null)
  assert((await GET()).status === 401 && (await put({ eventType: 'MENU_ITEMS_DELETED', channel: 'EMAIL' })).status === 401, 'signed out → 401 (GET and PUT)')
  const refused: Array<[string, string, string[] | undefined]> = [
    ['customer', customer.clerkId, undefined],
    ['vendor', vendorUser.clerkId, ['vendor']],
    ['event_operator', evop.clerkId, ['event_operator']],
    ['platform_manager', pm.clerkId, ['platform_manager']],
  ]
  for (const [label, clerkId, roles] of refused) {
    login(clerkId, roles)
    const g = await GET()
    const p = await put({ eventType: 'MENU_ITEMS_DELETED', channel: 'NONE' })
    assert(g.status === 403 && p.status === 403, `${label} → 403 (GET ${g.status}, PUT ${p.status})`)
  }
  assert(await prisma.notificationPreference.count({ where: { userId: { in: [customer.id, vendorUser.id, evop.id, pm.id] } } }) === 0,
    'and none of them saved anything')
  login(pending.user.clerkId)
  const pg = await bodyOf(await GET())
  assert(pg.error?.code === 'ORGANIZER_NOT_APPROVED', `a pending organizer → 403 ORGANIZER_NOT_APPROVED (${pg.error?.code})`)
  login(suspended.user.clerkId)
  const sg = await bodyOf(await GET())
  assert(sg.error?.code === 'ORGANIZER_SUSPENDED', `a suspended organizer → 403 ORGANIZER_SUSPENDED (${sg.error?.code})`)
  login(approved.user.clerkId)
  assert((await GET()).status === 200, '[0] control: an approved organizer member → 200')
  login(admin.clerkId, ['admin'])
  assert((await GET()).status === 200, 'a strict admin (no organizer membership) → 200')
  login(`${PFX}ghost-${rand()}`, ['super_admin'])
  const ghost = await GET()
  assert(ghost.status === 404 && (await bodyOf(ghost)).error?.code === 'USER_NOT_FOUND', `a strict admin with no User row → 404 USER_NOT_FOUND (${ghost.status})`)

  // ── [2] GET defaults ────────────────────────────────────────────────────────────────────────
  console.log('\n[2] with nothing saved')
  login(approved.user.clerkId)
  {
    const b = await bodyOf(await GET())
    const del = prefOf(b, 'MENU_ITEMS_DELETED'), pri = prefOf(b, 'MENU_PRICE_CHANGE_PENDING')
    assert(b.data?.preferences?.length === 2 && del?.channel === 'BOTH' && pri?.channel === 'BOTH' && !del.saved && !pri.saved,
      'two rows, both "Both", saved false')
    assert(del?.allowed.join() === 'EMAIL,IN_APP,BOTH,NONE' && pri?.allowed.join() === 'EMAIL,IN_APP,BOTH',
      'deletes offer 4 choices; price increases 3, without None')
    assert(del?.label === 'Menu items deleted' && pri?.label === 'Price increases awaiting approval', 'labels')
  }

  // ── [3] PUT ─────────────────────────────────────────────────────────────────────────────────
  console.log('\n[3] saving')
  {
    const saved = (type: string) => prisma.notificationPreference.findMany({ where: { userId: approved.user.id, eventType: type } })
    const r1 = await put({ eventType: 'MENU_ITEMS_DELETED', channel: 'NONE' })
    const b1 = await bodyOf(r1)
    assert(r1.status === 200 && prefOf(b1, 'MENU_ITEMS_DELETED')?.channel === 'NONE' && prefOf(b1, 'MENU_ITEMS_DELETED')?.saved === true
      && (await saved('MENU_ITEMS_DELETED'))[0]?.channel === 'NONE', 'None for deletes is saved, and the answer shows it')

    const r2 = await put({ eventType: 'MENU_PRICE_CHANGE_PENDING', channel: 'EMAIL' })
    assert(r2.status === 200 && (await saved('MENU_PRICE_CHANGE_PENDING'))[0]?.channel === 'EMAIL', '[0] control: Email for price increases is saved')
    const r3 = await put({ eventType: 'MENU_PRICE_CHANGE_PENDING', channel: 'NONE' })
    const b3 = await bodyOf(r3)
    assert(r3.status === 400 && b3.error?.code === 'CHANNEL_NOT_ALLOWED' && b3.error.message === "Price increases waiting for your approval can't be switched off",
      `None for price increases → 400 CHANNEL_NOT_ALLOWED, "${b3.error?.message}"`)
    assert((await saved('MENU_PRICE_CHANGE_PENDING'))[0]?.channel === 'EMAIL', 'and the saved value is unchanged (Email)')

    const bad: Array<[string, Response]> = [
      ['unknown type', await put({ eventType: 'MENU_SOMETHING', channel: 'EMAIL' })],
      ['lower-case channel', await put({ eventType: 'MENU_ITEMS_DELETED', channel: 'email' })],
      ['unknown channel', await put({ eventType: 'MENU_ITEMS_DELETED', channel: 'SMS' })],
      ['missing channel', await put({ eventType: 'MENU_ITEMS_DELETED' })],
      ['non-JSON body', await put(undefined, 'channel=EMAIL')],
    ]
    for (const [label, res] of bad) assert(res.status === 400, `${label} → 400 (${res.status})`)
    assert((await saved('MENU_ITEMS_DELETED'))[0]?.channel === 'NONE', 'none of those changed the saved delete setting')

    await put({ eventType: 'MENU_ITEMS_DELETED', channel: 'IN_APP' })
    const rows = await saved('MENU_ITEMS_DELETED')
    assert(rows.length === 1 && rows[0].channel === 'IN_APP', `saving again updates the one row (${rows.length} row(s), ${rows[0]?.channel})`)
  }

  // ── [4] isolation ───────────────────────────────────────────────────────────────────────────
  console.log('\n[4] each person\'s own choice')
  {
    login(second.clerkId)
    const b = await bodyOf(await GET())
    assert(prefOf(b, 'MENU_ITEMS_DELETED')?.channel === 'BOTH' && prefOf(b, 'MENU_ITEMS_DELETED')?.saved === false,
      'a second member of the same organizer still sees the default, not the first member\'s choice')
    await put({ eventType: 'MENU_ITEMS_DELETED', channel: 'EMAIL' })
    const first = await prisma.notificationPreference.findUnique({ where: { userId_eventType: { userId: approved.user.id, eventType: 'MENU_ITEMS_DELETED' } } })
    assert(first?.channel === 'IN_APP', 'the second member\'s save did not change the first member\'s (still In-app)')
    login(admin.clerkId, ['admin'])
    await put({ eventType: 'MENU_ITEMS_DELETED', channel: 'NONE' })
    assert((await prisma.notificationPreference.count({ where: { userId: admin.id } })) === 1
      && (await prisma.notificationPreference.findUnique({ where: { userId_eventType: { userId: second.id, eventType: 'MENU_ITEMS_DELETED' } } }))?.channel === 'EMAIL',
    'an admin saves their own row only')
  }

  // ── [5] end to end with 3a ──────────────────────────────────────────────────────────────────
  console.log('\n[5] a saved choice is what the worker uses')
  {
    const { recordMenuDeleted } = await import('../lib/menu-notify/record')
    const { runMenuNotificationDigests } = await import('../lib/menu-notify/digest')
    const item = await prisma.menuItem.create({ data: { vendorId: vendor.id, name: `${PFX}Fries`, price: 6, category: 'Mains' } })
    await prisma.$transaction(tx => recordMenuDeleted(tx, { vendorId: vendor.id, menuItemId: item.id, name: item.name, price: 6, menuRequestId: null }))
    await runMenuNotificationDigests({ now: new Date(Date.now() + 11 * 60e3), listStrictAdminClerkIds: async () => [] })
    const firstBell = await prisma.inAppNotification.count({ where: { userId: approved.user.id } })
    const firstMail = await prisma.notification.count({ where: { to: approved.user.email } })
    const secondBell = await prisma.inAppNotification.count({ where: { userId: second.id } })
    const secondMail = await prisma.notification.count({ where: { to: second.email } })
    assert(firstBell === 1 && firstMail === 0, `the member who saved In-app: one bell notification, no email (bell ${firstBell}, email ${firstMail})`)
    assert(secondBell === 0 && secondMail === 1, `the member who saved Email: one queued email, no bell (bell ${secondBell}, email ${secondMail})`)
  }

  // ── [6] screens ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[6] the settings screens (source checks)')
  {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/^\s*\/\/.*$/gm, '')
    const comp = strip(readFileSync('app/_components/MenuAlertPreferences.tsx', 'utf8'))
    assert(/ALLOWED_CHANNELS\[p\.eventType\]\.map\(/.test(comp), 'the buttons are built from ALLOWED_CHANNELS (the same list as the API and the worker)')
    assert(!/\[\s*'EMAIL'\s*,\s*'IN_APP'/.test(comp), 'no channel list is hard-coded in the component')
    assert(comp.includes("'/api/notification-preferences'") && /method: 'PUT'/.test(comp), 'it saves with PUT /api/notification-preferences')
    assert(/role="radiogroup"/.test(comp) && /role="radio"/.test(comp) && /aria-checked=\{selected\}/.test(comp), 'each row is a radio group with aria-checked')
    assert(/setPrefs\(before\)/.test(comp), 'a failed save puts the old choice back')

    const org = strip(readFileSync('app/organizer/settings/page.tsx', 'utf8'))
    assert(/<MenuAlertPreferences \/>/.test(org), 'the organizer settings page shows the menu alerts block')
    assert(!/key: 'notifMenuRequests'/.test(org), 'it no longer shows the old "Menu approval requests" toggle')
    assert(/notifMenuRequests/.test(org), '[0] control: the old field is still loaded and typed (kept, not deleted)')

    const adm = strip(readFileSync('app/admin/settings/page.tsx', 'utf8'))
    const gateAt = adm.indexOf('{strictAdmin && (')
    const cardAt = adm.indexOf('<MenuAlertPreferences />')
    assert(/const strictAdmin = hasStrictAdminRole\(user\.publicMetadata\)/.test(adm) && gateAt > 0 && cardAt > gateAt,
      'the admin settings page shows the card only to strict admins')
  }
}

main()
  .catch(e => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
