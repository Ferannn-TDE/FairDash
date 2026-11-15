/**
 * MENU ALERTS FOR APPROVERS — audit H5, step 3a (back end). Real lib and routes, test DB.
 *
 * Organizers (or strict admins, for a fair with no organizer) are told when a vendor deletes menu
 * items and when a price increase waits for their approval: a bell notification plus an email
 * queued in the outbox, per each person's own choice.
 *
 *   [1]  pure: allowed choices per type, effective channel, deliveries, alert wording, links
 *   [2]  schema: type/kind/channel/template columns are text, not enums (new types need no migration)
 *   [3]  deletes: every delete path records one event in its own transaction (menu-request DELETE,
 *        DELETE /api/menu/[id], an approved older PENDING DELETE)
 *   [4]  delete grouping: nothing before 10 minutes; one vendor's deletes → ONE notification
 *        listing all; a later delete starts a new group; two vendors → separate notifications
 *   [5]  pending price increases: a higher restore and a higher re-add arrive on the next tick;
 *        two in one submission → one notification; same/lower restore and a brand-new item →
 *        none; a request decided before the tick is not announced
 *   [6]  rollback: a submission that fails part-way leaves no recorded event
 *   [7]  DELETE /api/menu/[id]: one MENU_ITEM_REMOVED row, same keys as the other paths,
 *        requestId null; 409 again with no second row; a failing audit write leaves the item on
 *        the menu and records nothing
 *   [8]  recipients: an organizer's fair → its members only; no organizer → strict admins only
 *        (event_operator and platform_manager left out, paged Clerk list, no-DB-row admin skipped)
 *   [9]  choices: EMAIL / IN_APP / BOTH / NONE / unsaved; a stored NONE on price increases is
 *        ignored (BOTH)
 *   [10] no duplicates: the same run twice, and two workers at once
 *   [11] email: production 'none' holds menu emails (bell rows still made); a working transport
 *        sends the draft wording; nothing private in any notification
 *   [12] expiry: with a provider connected, held menu emails older than 48h → EXPIRED, not sent;
 *        younger ones sent; the bell row is untouched; sign-up and decision emails as before;
 *        with no provider nothing expires
 *   [13] source: DRAFT marks on both templates; worker runs the digest before delivery; every
 *        recorder call passes the caller's tx
 *
 * Clerk identity, next/cache and server-only are mocked (scripts/_route-loader.mjs); the strict
 * admin list goes through a fake Clerk client (the real paging and role filter run).
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/menu-notifications-test.ts
 * Self-cleaning, prefix mnt-.
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

const prisma = testPrisma()
const PFX = 'mnt-'
const MAIL = '@mnt.test'
const rand = () => Math.random().toString(36).slice(2, 9)
const TRIGGER_FN = 'mnt_fail_audit'
const TRIGGER = 'mnt_fail_audit_trg'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

function login(clerkId: string) {
  ;(globalThis as unknown as { __MOCK_CLERK?: { userId: string } }).__MOCK_CLERK = { userId: clerkId }
}
function jsonReq(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
}
type Body = { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } }
async function bodyOf(res: Response): Promise<Body> {
  try { return await res.json() as Body } catch { return {} }
}

async function dropTrigger() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRIGGER} ON "VendorAuditLog"`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TRIGGER_FN}()`)
}

async function cleanup() {
  await dropTrigger()
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const vids = vs.map(v => v.id)
    await prisma.menuChangeEvent.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorAuditLog.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.notification.deleteMany({ where: { OR: [{ to: { endsWith: MAIL } }, { dedupeKey: { startsWith: PFX } }] } })
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  // Bell rows and saved choices go with their user (foreign key, cascade).
  await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: MAIL } }, { clerkId: { startsWith: PFX } }] } })
}

async function main() {
  console.log('\n══ MENU ALERTS FOR APPROVERS (H5, step 3a) ══')
  await cleanup()
  // Isolate from any other suite's rows (the gate runs suites one at a time): the digest and the
  // outbox act on every row, so this suite starts from empty queues.
  await prisma.menuChangeEvent.deleteMany({})
  await prisma.notification.deleteMany({})

  const C = await import('../lib/menu-notify/constants')
  const D = await import('../lib/menu-notify/digest')
  const AR = await import('../lib/menu-notify/admin-recipients')
  const N = await import('../lib/notifications')
  const AD = await import('../lib/menu-requests/apply-decision')

  // ── [1] pure ────────────────────────────────────────────────────────────────────────────────
  console.log('\n[1] choices, wording and links')
  assert(C.ALLOWED_CHANNELS.MENU_ITEMS_DELETED.join() === 'EMAIL,IN_APP,BOTH,NONE', 'deletes: Email / In-app / Both / None')
  assert(C.ALLOWED_CHANNELS.MENU_PRICE_CHANGE_PENDING.join() === 'EMAIL,IN_APP,BOTH', 'price increases: Email / In-app / Both, no None')
  assert(C.isAllowedChannel('MENU_ITEMS_DELETED', 'NONE') && !C.isAllowedChannel('MENU_PRICE_CHANGE_PENDING', 'NONE'),
    'NONE is allowed for deletes and refused for price increases')
  assert(!C.isAllowedChannel('MENU_ITEMS_DELETED', 'none') && !C.isAllowedChannel('MENU_ITEMS_DELETED', 'SMS') && !C.isAllowedChannel('MENU_ITEMS_DELETED', null),
    'anything outside the list (lower case, unknown, null) is refused')
  assert(C.effectiveChannel('MENU_ITEMS_DELETED', undefined) === 'BOTH' && C.effectiveChannel('MENU_ITEMS_DELETED', 'NONE') === 'NONE',
    'unsaved → BOTH; a saved NONE on deletes stands')
  assert(C.effectiveChannel('MENU_PRICE_CHANGE_PENDING', 'NONE') === 'BOTH' && C.effectiveChannel('MENU_PRICE_CHANGE_PENDING', 'EMAIL') === 'EMAIL',
    'a stored NONE on price increases is ignored (BOTH); [0] control: a stored EMAIL stands')
  const d = (ch: 'EMAIL' | 'IN_APP' | 'BOTH' | 'NONE', e: string) => JSON.stringify(C.deliveriesFor(ch, e))
  assert(d('EMAIL', 'a@x') === '{"inApp":false,"email":true}' && d('IN_APP', 'a@x') === '{"inApp":true,"email":false}'
    && d('BOTH', 'a@x') === '{"inApp":true,"email":true}' && d('NONE', 'a@x') === '{"inApp":false,"email":false}',
  'EMAIL → email only; IN_APP → bell only; BOTH → both; NONE → neither')
  assert(d('BOTH', '  ') === '{"inApp":true,"email":false}' && d('EMAIL', '') === '{"inApp":false,"email":false}',
    'no usable email address → bell only (BOTH), nothing (EMAIL)')
  assert(D.deleteLine({ name: 'Fries', price: 6 }) === 'Fries ($6.00)', `delete line: "${D.deleteLine({ name: 'Fries', price: 6 })}"`)
  const pl = D.priceLine({ name: 'Cannoli', reason: 'RESTORE', current: 8, requested: 9.5 })
  assert(pl === 'Cannoli (back on the menu at a higher price): $8.00 → $9.50 (+$1.50, +18.8%)', `price line: "${pl}"`)
  assert(D.priceLine({ name: 'Large', reason: 'NEW_SIZE', current: null, requested: 7 }) === 'Large (new size): $7.00'
    && D.priceLine({ name: 'Fries', reason: 'LIVE_INCREASE', current: 6, requested: 7 }).startsWith('Fries (price increase): $6.00 → $7.00'),
  'ready for the price-increase approval step: new size and live increase wording')
  assert(D.alertTitle('MENU_ITEMS_DELETED', 'Booth', 1) === 'Booth removed 1 menu item' && D.alertTitle('MENU_ITEMS_DELETED', 'Booth', 3) === 'Booth removed 3 menu items'
    && D.alertTitle('MENU_PRICE_CHANGE_PENDING', 'Booth', 2) === 'Booth: 2 price increases waiting for approval', 'titles, singular and plural')
  assert(D.reviewPath('organizer', 'f1') === '/organizer/fairs/f1/menu-requests' && D.reviewPath('admin', 'f1') === '/admin/f1/vendors',
    'review links: organizer menu requests, admin vendors page')

  // ── [2] schema ──────────────────────────────────────────────────────────────────────────────
  console.log('\n[2] the type columns are plain text (a new alert type needs no migration)')
  {
    const cols = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; data_type: string }>>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND (
         (table_name = 'NotificationPreference' AND column_name IN ('eventType', 'channel')) OR
         (table_name = 'InAppNotification' AND column_name = 'type') OR
         (table_name = 'MenuChangeEvent' AND column_name = 'kind') OR
         (table_name = 'Notification' AND column_name IN ('template', 'status')))`)
    assert(cols.length === 6 && cols.every(c => c.data_type === 'text'),
      `6 columns, all text (${cols.map(c => `${c.table_name}.${c.column_name}=${c.data_type}`).join(', ')})`)
  }

  // ── fixture ─────────────────────────────────────────────────────────────────────────────────
  const now = Date.now()
  const mkUser = (tag: string, extra: { clerkId?: string } = {}) => prisma.user.create({
    data: { clerkId: extra.clerkId ?? `${PFX}${tag}-${rand()}`, email: `${tag}-${rand()}${MAIL}`, name: tag },
  })
  const mkOrg = async (tag: string, memberTags: string[]) => {
    const org = await prisma.fairOrganizer.create({
      data: { name: `${PFX}${tag}`, contactEmail: `${tag}-${rand()}${MAIL}`, approvalStatus: 'APPROVED' },
    })
    const members = []
    for (const m of memberTags) {
      const u = await mkUser(`${tag}-${m}`)
      await prisma.orgMember.create({ data: { organizerId: org.id, userId: u.id, role: members.length === 0 ? 'owner' : 'member' } })
      members.push(u)
    }
    return { org, members }
  }
  const mkFair = (organizerId: string | null, name: string) => prisma.event.create({
    data: { name, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', organizerId, startDate: new Date(now - 864e5), endDate: new Date(now + 864e5) },
  })
  const mkVendor = async (eventId: string, name: string) => {
    const vendor = await prisma.vendor.create({
      data: {
        eventId, name, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE',
        // Private columns, set so [11] can prove none of them reaches a notification.
        contactEmail: `private-${rand()}${MAIL}`, contactPhone: '6185550199', stripeAccountId: 'acct_mnt_private',
      },
    })
    const user = await mkUser('op')
    await prisma.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role: 'owner', approvalStatus: 'APPROVED' } })
    return { vendor, user }
  }
  const mkItem = (vendorId: string, name: string, price: number, removedAt: Date | null = null) =>
    prisma.menuItem.create({ data: { vendorId, name, price, category: 'Mains', removedAt } })

  // Organizer A: four members, one per choice for deletes (EMAIL, IN_APP, unsaved, NONE).
  const orgA = await mkOrg('orga', ['email', 'inapp', 'unsaved', 'none'])
  const [mEmail, mInApp, mUnsaved, mNone] = orgA.members
  const orgB = await mkOrg('orgb', ['other'])
  const fair = await mkFair(orgA.org.id, `${PFX}Spring Fair`)
  const fairB = await mkFair(orgB.org.id, `${PFX}Other Fair`)
  const open = await mkFair(null, `${PFX}Open Fair`)
  const A = await mkVendor(fair.id, 'Booth A')
  const B = await mkVendor(fair.id, 'Booth B')
  const O = await mkVendor(open.id, 'Booth O')
  const BB = await mkVendor(fairB.id, 'Booth BB')
  await prisma.notificationPreference.createMany({ data: [
    { userId: mEmail.id, eventType: 'MENU_ITEMS_DELETED', channel: 'EMAIL' },
    { userId: mInApp.id, eventType: 'MENU_ITEMS_DELETED', channel: 'IN_APP' },
    { userId: mNone.id, eventType: 'MENU_ITEMS_DELETED', channel: 'NONE' },
    // Not offered by the API or the screen; stored here directly to prove the worker ignores it.
    { userId: mNone.id, eventType: 'MENU_PRICE_CHANGE_PENDING', channel: 'NONE' },
  ] })

  // Strict admins come from a fake Clerk: 150 users over two pages; the real role filter runs.
  const adminUser = await mkUser('admin')
  const superUser = await mkUser('super')
  const evopUser = await mkUser('evop')
  const pmUser = await mkUser('pm')
  const ghostClerk = `${PFX}ghost-${rand()}` // a strict admin with no User row
  const clerkUsers = Array.from({ length: 150 }, (_, i) => ({ id: `${PFX}filler-${i}`, publicMetadata: { roles: ['customer'] } as Record<string, unknown> }))
  clerkUsers[3] = { id: adminUser.clerkId, publicMetadata: { roles: ['admin'] } }
  clerkUsers[120] = { id: superUser.clerkId, publicMetadata: { roles: ['super_admin'] } } // second page
  clerkUsers[50] = { id: evopUser.clerkId, publicMetadata: { roles: ['event_operator'] } }
  clerkUsers[60] = { id: pmUser.clerkId, publicMetadata: { roles: ['platform_manager'] } }
  clerkUsers[70] = { id: ghostClerk, publicMetadata: { roles: ['admin'] } }
  let clerkCalls = 0
  AR.__setClerkForTest({
    users: {
      getUserList: async ({ limit, offset }: { limit: number; offset: number }) => {
        clerkCalls++
        return { data: clerkUsers.slice(offset, offset + limit), totalCount: clerkUsers.length }
      },
    },
  } as unknown as Parameters<typeof AR.__setClerkForTest>[0])

  const mr = await import('../app/api/menu-requests/route')
  const reqPOST = mr.POST as unknown as (r: NextRequest) => Promise<Response>
  const menuId = await import('../app/api/menu/[id]/route')
  const menuDELETE = menuId.DELETE as unknown as (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>
  const file = (vendorId: string, body: Record<string, unknown>) => reqPOST(jsonReq('/api/menu-requests', 'POST', { vendorId, ...body }))
  const directDelete = (id: string) => menuDELETE(jsonReq(`/api/menu/${id}`, 'DELETE'), { params: Promise.resolve({ id }) })

  const events = (vendorId: string, kind?: string) => prisma.menuChangeEvent.findMany({
    where: { vendorId, ...(kind && { kind }) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const bellFor = (userId: string, type?: string) => prisma.inAppNotification.findMany({
    where: { userId, ...(type && { type }) }, orderBy: { createdAt: 'asc' },
  })
  const mailFor = (to: string, template?: string) => prisma.notification.findMany({
    where: { to, ...(template && { template }) }, orderBy: { createdAt: 'asc' },
  })
  const minutes = (m: number) => new Date(Date.now() + m * 60e3)
  const digest = (at: Date) => D.runMenuNotificationDigests({ now: at })
  /** Clear the queue and every alert between sections, so each section counts only its own. */
  const resetAlerts = async () => {
    await prisma.menuChangeEvent.deleteMany({})
    await prisma.inAppNotification.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
    await prisma.notification.deleteMany({})
  }

  // ── [3] every delete path records one event ────────────────────────────────────────────────
  console.log('\n[3] each delete path records one event, in its own transaction')
  login(A.user.clerkId)
  {
    const i1 = await mkItem(A.vendor.id, `${PFX}Fries`, 6)
    const r1 = await file(A.vendor.id, { type: 'DELETE', menuItemId: i1.id })
    const b1 = await bodyOf(r1)
    const e1 = await events(A.vendor.id)
    assert(r1.status === 201 && e1.length === 1 && e1[0].kind === 'DELETE' && e1[0].menuItemId === i1.id
      && e1[0].menuRequestId === b1.data?.id && e1[0].eventId === fair.id && e1[0].digestId === null,
    `menu-request DELETE: one DELETE event naming the item, its request and the fair (status ${r1.status}, ${e1.length} event(s))`)
    const p1 = e1[0]?.payload as { name?: string; price?: number } | undefined
    assert(p1?.name === `${PFX}Fries` && p1?.price === 6, 'the event keeps the name and the price at removal')

    const i2 = await mkItem(A.vendor.id, `${PFX}Corn Dog`, 7)
    const r2 = await directDelete(i2.id)
    const e2 = (await events(A.vendor.id)).filter(e => e.menuItemId === i2.id)
    assert(r2.status === 200 && e2.length === 1 && e2[0].menuRequestId === null,
      `DELETE /api/menu/[id]: one DELETE event, no request id (status ${r2.status}, ${e2.length} event(s))`)

    const i3 = await mkItem(A.vendor.id, `${PFX}Lemonade`, 4)
    const old = await prisma.menuRequest.create({ data: { vendorId: A.vendor.id, requestedBy: A.user.id, type: 'DELETE', menuItemId: i3.id } })
    await AD.applyMenuRequestDecision({
      requestId: old.id, event: { id: fair.id, organizerId: orgA.org.id },
      approver: { kind: 'organizer', organizerId: orgA.org.id }, reviewerUserId: mEmail.id, action: 'APPROVE',
    })
    const e3 = (await events(A.vendor.id)).filter(e => e.menuItemId === i3.id)
    assert(e3.length === 1 && e3[0].menuRequestId === old.id, `an approved older PENDING DELETE: one DELETE event (${e3.length})`)

    const i4 = await mkItem(A.vendor.id, `${PFX}Pretzel`, 5)
    const old2 = await prisma.menuRequest.create({ data: { vendorId: A.vendor.id, requestedBy: A.user.id, type: 'DELETE', menuItemId: i4.id } })
    await AD.applyMenuRequestDecision({
      requestId: old2.id, event: { id: fair.id, organizerId: orgA.org.id },
      approver: { kind: 'organizer', organizerId: orgA.org.id }, reviewerUserId: mEmail.id, action: 'REJECT', reason: 'keep it',
    })
    assert((await events(A.vendor.id)).every(e => e.menuItemId !== i4.id), '[0] control: a REJECTED older DELETE records nothing')
  }

  // ── [4] delete grouping ─────────────────────────────────────────────────────────────────────
  console.log('\n[4] one vendor\'s deletes within 10 minutes → one notification')
  {
    // [3] left three DELETE events for vendor A. Two more, from vendor B, at the same time.
    const b1 = await mkItem(B.vendor.id, `${PFX}Nachos`, 9)
    login(B.user.clerkId)
    await file(B.vendor.id, { type: 'DELETE', menuItemId: b1.id })

    const early = await digest(minutes(1))
    assert(early.notified === 0 && (await bellFor(mInApp.id)).length === 0 && (await prisma.menuChangeEvent.count({ where: { digestId: { not: null } } })) === 0,
      'one minute after the first delete: nothing sent, nothing claimed')

    // Move vendor A's oldest delete to 9 minutes ago: still inside the window.
    const aEvents = await events(A.vendor.id, 'DELETE')
    await prisma.menuChangeEvent.update({ where: { id: aEvents[0].id }, data: { createdAt: new Date(Date.now() - 9 * 60e3) } })
    const nine = await digest(new Date())
    assert(nine.notified === 0, 'oldest delete 9 minutes old: still waiting')

    await prisma.menuChangeEvent.update({ where: { id: aEvents[0].id }, data: { createdAt: new Date(Date.now() - 10 * 60e3 - 1000) } })
    const ten = await digest(new Date())
    const bellA = await bellFor(mInApp.id, 'MENU_ITEMS_DELETED')
    assert(ten.notified === 1 && bellA.length === 1,
      `oldest delete 10 minutes old: vendor A's group is sent as ONE notification (notified ${ten.notified}, bell ${bellA.length})`)
    assert(bellA[0]?.title === 'Booth A removed 3 menu items'
      && [`${PFX}Fries ($6.00)`, `${PFX}Corn Dog ($7.00)`, `${PFX}Lemonade ($4.00)`].every(l => bellA[0].body.includes(l))
      && bellA[0].body.startsWith(`${PFX}Spring Fair\n`),
    `it lists all three items and their prices, under the fair's name ("${bellA[0]?.title}")`)
    assert(bellA[0]?.link === `/organizer/fairs/${fair.urlSlug}/menu-requests`, 'the bell links to the organizer\'s menu requests')
    assert((await events(B.vendor.id)).every(e => e.digestId === null), 'vendor B\'s delete (1 minute old) is still waiting, not swept into A\'s')

    const bSent = await digest(minutes(11))
    const bellB = (await bellFor(mInApp.id, 'MENU_ITEMS_DELETED')).filter(n => n.title.startsWith('Booth B'))
    assert(bSent.notified === 1 && bellB.length === 1 && bellB[0].title === 'Booth B removed 1 menu item',
      'two vendors → separate notifications')

    login(A.user.clerkId)
    const a4 = await mkItem(A.vendor.id, `${PFX}Funnel Cake`, 8)
    await file(A.vendor.id, { type: 'DELETE', menuItemId: a4.id })
    const soon = await digest(minutes(1))
    assert(soon.notified === 0, 'a delete after the group was sent starts a new 10-minute group (not sent at 1 minute)')
    await digest(minutes(11))
    const bellA2 = (await bellFor(mInApp.id, 'MENU_ITEMS_DELETED')).filter(n => n.title.startsWith('Booth A'))
    assert(bellA2.length === 2 && bellA2[1].title === 'Booth A removed 1 menu item' && bellA2[1].body.includes(`${PFX}Funnel Cake ($8.00)`)
      && !bellA2[1].body.includes('Fries'),
    'the new group is its own notification, listing only the new delete')
  }

  // ── [5] pending price increases ────────────────────────────────────────────────────────────
  console.log('\n[5] pending price increases arrive on the next tick')
  await resetAlerts()
  login(A.user.clerkId)
  {
    const removed = new Date(now - 365 * 864e5)
    const c1 = await mkItem(A.vendor.id, `${PFX}Cannoli`, 8, removed)
    const r1 = await file(A.vendor.id, { type: 'RESTORE', menuItemId: c1.id, price: 9.5 })
    const b1 = await bodyOf(r1)
    const ev1 = await events(A.vendor.id, 'PRICE_PENDING')
    const p1 = ev1[0]?.payload as { reason?: string; previousPrice?: number; requestedPrice?: number } | undefined
    assert(b1.data?.status === 'PENDING' && ev1.length === 1 && ev1[0].menuRequestId === b1.data?.id
      && p1?.reason === 'RESTORE' && p1.previousPrice === 8 && p1.requestedPrice === 9.5,
    `a higher-priced restore: PENDING, one PRICE_PENDING event, reason RESTORE, 8 → 9.5 (${ev1.length})`)

    const tick = await digest(new Date())
    const bell = await bellFor(mInApp.id, 'MENU_PRICE_CHANGE_PENDING')
    assert(tick.notified === 1 && bell.length === 1 && bell[0].title === 'Booth A: 1 price increase waiting for approval'
      && bell[0].body.includes(`${PFX}Cannoli (back on the menu at a higher price): $8.00 → $9.50 (+$1.50, +18.8%)`),
    `sent on the next tick with no wait: "${bell[0]?.body.split('\n')[1]}"`)

    const c2 = await mkItem(A.vendor.id, `${PFX}Gelato`, 5, removed)
    const r2 = await file(A.vendor.id, { type: 'ADD', name: `  ${PFX}gelato `, price: 6, category: 'Desserts' })
    const b2 = await bodyOf(r2)
    const ev2 = (await events(A.vendor.id, 'PRICE_PENDING')).filter(e => e.menuItemId === c2.id)
    assert(b2.data?.status === 'PENDING' && ev2.length === 1 && (ev2[0].payload as { reason?: string }).reason === 'READD',
      `a higher-priced re-add by name: one event, reason READD (${ev2.length})`)
    await digest(new Date())
    assert((await bellFor(mInApp.id, 'MENU_PRICE_CHANGE_PENDING')).some(n => n.body.includes(`${PFX}Gelato (back on the menu at a higher price): $5.00 → $6.00`)),
      'it arrives too, under the stored name')

    const c3 = await mkItem(A.vendor.id, `${PFX}Churro`, 3, removed)
    const c4 = await mkItem(A.vendor.id, `${PFX}Taffy`, 2, removed)
    const r3 = await file(A.vendor.id, { items: [
      { type: 'RESTORE', menuItemId: c3.id, price: 4 },
      { type: 'RESTORE', menuItemId: c4.id, price: 3 },
    ] })
    const before = (await bellFor(mInApp.id, 'MENU_PRICE_CHANGE_PENDING')).length
    const t3 = await digest(new Date())
    const after = await bellFor(mInApp.id, 'MENU_PRICE_CHANGE_PENDING')
    const last = after[after.length - 1]
    assert(r3.status === 201 && t3.notified === 1 && after.length === before + 1 && last.title === 'Booth A: 2 price increases waiting for approval'
      && last.body.includes(`${PFX}Churro`) && last.body.includes(`${PFX}Taffy`),
    `two increases in one submission → ONE notification listing both (${after.length - before} new)`)

    const c5 = await mkItem(A.vendor.id, `${PFX}Popcorn`, 4, removed)
    const c6 = await mkItem(A.vendor.id, `${PFX}Pickle`, 3, removed)
    await file(A.vendor.id, { type: 'RESTORE', menuItemId: c5.id, price: 4 })
    await file(A.vendor.id, { type: 'RESTORE', menuItemId: c6.id, price: 2 })
    await file(A.vendor.id, { type: 'ADD', name: `${PFX}Brand New Thing`, price: 5, category: 'Mains' })
    assert((await events(A.vendor.id)).every(e => ![c5.id, c6.id].includes(e.menuItemId ?? '')) && (await events(A.vendor.id)).length === 4,
      'same-price and lower-price restores, and a brand-new item, record nothing')

    const c7 = await mkItem(A.vendor.id, `${PFX}Kettle Corn`, 4, removed)
    const r7 = await bodyOf(await file(A.vendor.id, { type: 'RESTORE', menuItemId: c7.id, price: 6 }))
    await AD.applyMenuRequestDecision({
      requestId: r7.data?.id as string, event: { id: fair.id, organizerId: orgA.org.id },
      approver: { kind: 'organizer', organizerId: orgA.org.id }, reviewerUserId: mEmail.id, action: 'REJECT', reason: 'no',
    })
    const bellsBefore = (await bellFor(mInApp.id)).length
    const t7 = await digest(new Date())
    assert(t7.nothingToSend === 1 && t7.notified === 0 && (await bellFor(mInApp.id)).length === bellsBefore,
      'a request decided before the tick is not announced (claimed, nothing sent)')
  }

  // ── [6] rollback ────────────────────────────────────────────────────────────────────────────
  console.log('\n[6] a submission that fails part-way records nothing')
  await resetAlerts()
  {
    // The route checks every item before its transaction starts, so a refused submission never
    // writes at all. To prove the events roll back WITH the change, file through the real
    // fileMenuRequestItem inside one transaction that then fails part-way.
    const { fileMenuRequestItem } = await import('../lib/menu-requests/file-item')
    const del = await mkItem(A.vendor.id, `${PFX}Roll Del`, 5)
    const gone = await mkItem(A.vendor.id, `${PFX}Roll Gone`, 5, new Date(now - 864e5))
    const ctx = { vendorId: A.vendor.id, requestedBy: A.user.id, batchId: `${PFX}batch` }
    let insideTx = -1
    let threw = false
    try {
      await prisma.$transaction(async tx => {
        await fileMenuRequestItem(tx, { type: 'DELETE', menuItemId: del.id }, ctx)
        await fileMenuRequestItem(tx, { type: 'RESTORE', menuItemId: gone.id, price: 9 }, ctx)
        insideTx = await tx.menuChangeEvent.count({ where: { vendorId: A.vendor.id } })
        throw new Error('forced failure after both items')
      })
    } catch { threw = true }
    assert(insideTx === 2, `[0] control: inside the transaction both events exist (${insideTx})`)
    assert(threw && (await prisma.menuItem.findUnique({ where: { id: del.id } }))?.removedAt === null
      && (await prisma.menuChangeEvent.count({ where: { vendorId: A.vendor.id } })) === 0
      && (await prisma.menuRequest.count({ where: { vendorId: A.vendor.id, menuItemId: { in: [del.id, gone.id] } } })) === 0,
    'the transaction failed part-way: the delete, the pending restore and both events all rolled back')
    const ok = await file(A.vendor.id, { items: [{ type: 'DELETE', menuItemId: del.id }, { type: 'RESTORE', menuItemId: gone.id, price: 9 }] })
    assert(ok.status === 201 && (await prisma.menuChangeEvent.count({ where: { vendorId: A.vendor.id } })) === 2,
      '[0] control: the same two through the route → 201 and two events')
  }

  // ── [7] DELETE /api/menu/[id] audit row ───────────────────────────────────────────────────────
  console.log('\n[7] DELETE /api/menu/[id] writes its MENU_ITEM_REMOVED row in the same transaction')
  await resetAlerts()
  {
    const item = await mkItem(A.vendor.id, `${PFX}Direct`, 6.5)
    const r = await directDelete(item.id)
    const rows = await prisma.vendorAuditLog.findMany({ where: { vendorId: A.vendor.id, action: 'MENU_ITEM_REMOVED' } })
    const mine = rows.filter(x => (x.metadata as { menuItemId?: string }).menuItemId === item.id)
    const meta = mine[0]?.metadata as Record<string, unknown> | undefined
    assert(r.status === 200 && mine.length === 1, `one MENU_ITEM_REMOVED row (status ${r.status}, ${mine.length} row(s))`)
    assert(!!meta && Object.keys(meta).sort().join() === 'menuItemId,name,price,priceCents,requestId'
      && meta.name === `${PFX}Direct` && meta.price === 6.5 && meta.priceCents === 650 && meta.requestId === null
      && mine[0].userId === A.user.id,
    `same keys as the other delete paths, right name/price/user, requestId null (${JSON.stringify(meta)})`)
    const other = rows.find(x => (x.metadata as { requestId?: string | null }).requestId)
    assert(!other || Object.keys(other.metadata as object).sort().join() === 'menuItemId,name,price,priceCents,requestId',
      '[0] control: a menu-request delete row has the same keys')

    const again = await directDelete(item.id)
    const rows2 = (await prisma.vendorAuditLog.findMany({ where: { vendorId: A.vendor.id, action: 'MENU_ITEM_REMOVED' } }))
      .filter(x => (x.metadata as { menuItemId?: string }).menuItemId === item.id)
    assert(again.status === 409 && rows2.length === 1 && (await events(A.vendor.id)).filter(e => e.menuItemId === item.id).length === 1,
      `a second delete → 409, no second audit row, no second event (status ${again.status})`)

    const doomed = await mkItem(A.vendor.id, `${PFX}Doomed`, 5)
    // Test DB only: make the audit insert for this one item fail, then remove the trigger.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${TRIGGER_FN}() RETURNS trigger AS $$
      BEGIN IF NEW.metadata->>'menuItemId' = '${doomed.id}' THEN RAISE EXCEPTION 'mnt forced audit failure'; END IF; RETURN NEW; END
      $$ LANGUAGE plpgsql`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${TRIGGER} BEFORE INSERT ON "VendorAuditLog" FOR EACH ROW EXECUTE FUNCTION ${TRIGGER_FN}()`)
    let failed: Response
    try { failed = await directDelete(doomed.id) } finally { await dropTrigger() }
    assert(failed.status >= 500 && (await prisma.menuItem.findUnique({ where: { id: doomed.id } }))?.removedAt === null
      && (await events(A.vendor.id)).every(e => e.menuItemId !== doomed.id),
    `a failing audit write → error (${failed.status}), the item stays on the menu, nothing recorded`)
    const retry = await directDelete(doomed.id)
    assert(retry.status === 200 && (await prisma.menuItem.findUnique({ where: { id: doomed.id } }))?.removedAt !== null,
      '[0] control: with the trigger gone the same delete succeeds')
  }

  // ── [8] recipients ──────────────────────────────────────────────────────────────────────────
  console.log('\n[8] who is told')
  await resetAlerts()
  {
    login(A.user.clerkId)
    const a = await mkItem(A.vendor.id, `${PFX}Rcpt A`, 5)
    await file(A.vendor.id, { type: 'DELETE', menuItemId: a.id })
    login(O.user.clerkId)
    const o = await mkItem(O.vendor.id, `${PFX}Rcpt O`, 5)
    await file(O.vendor.id, { type: 'DELETE', menuItemId: o.id })
    login(BB.user.clerkId)
    const bb = await mkItem(BB.vendor.id, `${PFX}Rcpt BB`, 5)
    await file(BB.vendor.id, { type: 'DELETE', menuItemId: bb.id })
    clerkCalls = 0
    await digest(minutes(11))
    const allBell = await prisma.inAppNotification.findMany({ where: { user: { email: { endsWith: MAIL } } }, select: { userId: true, title: true, link: true } })
    const gotA = new Set(allBell.filter(n => n.title.startsWith('Booth A')).map(n => n.userId))
    const gotO = new Set(allBell.filter(n => n.title.startsWith('Booth O')).map(n => n.userId))
    const orgBMember = orgB.members[0].id
    assert(gotA.has(mInApp.id) && gotA.has(mUnsaved.id) && !gotA.has(orgBMember) && !gotA.has(adminUser.id) && !gotA.has(superUser.id),
      'an organizer\'s fair: its members are told; another organizer\'s member and the admins are not')
    const gotBB = new Set(allBell.filter(n => n.title.startsWith('Booth BB')).map(n => n.userId))
    assert(gotBB.size === 1 && gotBB.has(orgBMember),
      `the other organizer's fair: only its own member is told, not organizer A's (${gotBB.size})`)
    assert(gotO.has(adminUser.id) && gotO.has(superUser.id) && gotO.size === 2,
      `no organizer: the admin and the super_admin (on Clerk's second page) are told, and no one else (${gotO.size})`)
    assert(!gotO.has(evopUser.id) && !gotO.has(pmUser.id) && !gotO.has(mInApp.id),
      'event_operator, platform_manager and organizer members are not')
    assert(allBell.filter(n => n.title.startsWith('Booth O')).every(n => n.link === `/admin/${open.urlSlug}/vendors`),
      'admins\' bell links to the admin vendors page')
    assert(clerkCalls === 2, `the Clerk list was paged once per run, both pages (${clerkCalls} calls)`)
    const adminMail = await mailFor(superUser.email, 'menu_items_deleted')
    assert(adminMail.length === 1 && (adminMail[0].payload as { link?: string }).link === `https://www.fairsynq.com/admin/${open.urlSlug}/vendors`,
      'the admin email carries the absolute admin link')
  }

  // ── [9] choices ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[9] each person\'s own choice')
  {
    // [8] sent vendor A's delete to organizer A's four members.
    const has = async (u: { id: string; email: string }) => ({
      bell: (await bellFor(u.id, 'MENU_ITEMS_DELETED')).length, mail: (await mailFor(u.email, 'menu_items_deleted')).length,
    })
    const e = await has(mEmail), i = await has(mInApp), un = await has(mUnsaved), no = await has(mNone)
    assert(e.bell === 0 && e.mail === 1, `EMAIL → one queued email, no bell (${JSON.stringify(e)})`)
    assert(i.bell === 1 && i.mail === 0, `IN_APP → one bell, no email (${JSON.stringify(i)})`)
    assert(un.bell === 1 && un.mail === 1, `no saved choice → both (${JSON.stringify(un)})`)
    assert(no.bell === 0 && no.mail === 0, `NONE on deletes → nothing (${JSON.stringify(no)})`)

    login(A.user.clerkId)
    const p = await mkItem(A.vendor.id, `${PFX}Choice Price`, 4, new Date(now - 864e5))
    await file(A.vendor.id, { type: 'RESTORE', menuItemId: p.id, price: 5 })
    await digest(new Date())
    const noP = { bell: (await bellFor(mNone.id, 'MENU_PRICE_CHANGE_PENDING')).length, mail: (await mailFor(mNone.email, 'menu_price_change_pending')).length }
    assert(noP.bell === 1 && noP.mail === 1, `a stored NONE on price increases is ignored: both (${JSON.stringify(noP)})`)
    const mail = (await mailFor(mUnsaved.email, 'menu_price_change_pending'))[0]
    assert(mail?.audience === 'user' && mail.status === 'PENDING' && mail.dedupeKey.startsWith('menu:PRICE_PENDING:') && mail.dedupeKey.endsWith(`:${mUnsaved.id}`),
      'the queued email: audience user, PENDING, dedupeKey menu:{kind}:{digestId}:{userId}')
  }

  // ── [10] no duplicates ──────────────────────────────────────────────────────────────────────
  console.log('\n[10] no duplicates')
  await resetAlerts()
  {
    login(B.user.clerkId)
    const x = await mkItem(B.vendor.id, `${PFX}Dup`, 5)
    await file(B.vendor.id, { type: 'DELETE', menuItemId: x.id })
    const [r1, r2] = await Promise.all([digest(minutes(11)), digest(minutes(11))])
    const bell = await prisma.inAppNotification.count({ where: { userId: mInApp.id } })
    const mails = await prisma.notification.count({ where: { to: mEmail.email } })
    assert(bell === 1 && mails === 1 && r1.notified + r2.notified === 1,
      `two workers at once: one notification (bell ${bell}, email ${mails}; notified ${r1.notified}+${r2.notified}, lost ${r1.claimLost}+${r2.claimLost})`)
    const r3 = await digest(minutes(12))
    assert(r3.notified === 0 && await prisma.inAppNotification.count({ where: { userId: mInApp.id } }) === 1,
      'the same run again sends nothing')
  }

  // ── [11] email delivery and privacy ─────────────────────────────────────────────────────────
  console.log('\n[11] email: held with no provider, the draft wording, nothing private')
  {
    const none = { kind: 'none' as const, canSend: false, send: async () => { throw new Error('none') } }
    const held = await N.deliverDueNotifications({ transport: none })
    const row = (await mailFor(mEmail.email))[0]
    assert(held.held >= 1 && row?.status === 'PENDING' && row.heldReason === 'NO_EMAIL_PROVIDER'
      && await prisma.inAppNotification.count({ where: { userId: mInApp.id } }) === 1,
    'production (no provider): the menu email waits as NO_EMAIL_PROVIDER, the bell row is there')

    const sent: Array<{ to: string[]; subject: string; text: string }> = []
    const okT = { kind: 'log' as const, canSend: true, send: async (e: { to: string[]; subject: string; text: string }) => { sent.push(e) } }
    await N.deliverDueNotifications({ transport: okT, alertEmails: async () => [] })
    const m = sent.find(s => s.to[0] === mEmail.email)
    assert(!!m && m.subject === `Booth B removed 1 menu item at ${PFX}Spring Fair` && m.text.includes(`- ${PFX}Dup ($5.00)`)
      && m.text.includes(`https://www.fairsynq.com/organizer/fairs/${fair.urlSlug}/menu-requests`),
    `with a provider it sends the draft wording (subject "${m?.subject}")`)
    const pr = N.renderEmail('menu_price_change_pending', { alertType: 'MENU_PRICE_CHANGE_PENDING', fairName: 'F', vendorName: 'V', lines: ['a', 'b'], link: 'L' })
    assert(pr.subject === '2 price increases are waiting for your approval: V' && pr.text.includes('Nothing changes on the menu until it is approved')
      && pr.text.endsWith('Approve or reject: L'), `price template: "${pr.subject}"`)

    // Nothing private: vendor contact details and Stripe ids never reach any notification.
    const everything = JSON.stringify([
      await prisma.inAppNotification.findMany({ where: { user: { email: { endsWith: MAIL } } } }),
      await prisma.notification.findMany({ where: { to: { endsWith: MAIL } } }),
      sent,
    ])
    assert(!everything.includes('private-') && !everything.includes('6185550199') && !everything.includes('acct_mnt_private'),
      'no vendor contact email, phone or Stripe id in any bell row, outbox row or sent email')
    assert(everything.includes('Booth B'), '[0] control: the scan reads real notification content')
  }

  // ── [12] expiry ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[12] held menu emails older than 48 hours expire when a provider is connected')
  await resetAlerts()
  {
    const ago = (h: number) => new Date(Date.now() - h * 3600e3)
    const mk = (key: string, data: { audience: string; to?: string; template: string; payload: object; createdAt: Date }) =>
      prisma.notification.create({ data: { ...data, status: 'PENDING', heldReason: 'NO_EMAIL_PROVIDER', dedupeKey: `${PFX}${key}` } })
    const payload = { alertType: 'MENU_ITEMS_DELETED', fairName: 'F', vendorName: 'V', lines: ['x ($1.00)'], link: 'L' }
    const oldMenu = await mk('old-menu', { audience: 'user', to: `old${MAIL}`, template: 'menu_items_deleted', payload, createdAt: ago(49) })
    const oldPrice = await mk('old-price', { audience: 'user', to: `oldp${MAIL}`, template: 'menu_price_change_pending', payload, createdAt: ago(49) })
    const newMenu = await mk('new-menu', { audience: 'user', to: `new${MAIL}`, template: 'menu_items_deleted', payload, createdAt: ago(47) })
    const oldAdmin = await mk('old-admin', { audience: 'admin', template: 'signup_admin_alert', payload: { kind: 'vendor', name: 'X', contactName: null, email: null, phone: null }, createdAt: ago(49) })
    const oldApplicant = await mk('old-app', { audience: 'applicant', to: `app${MAIL}`, template: 'decision_approved', payload: { kind: 'vendor', name: 'X', contactName: 'P' }, createdAt: ago(49) })
    const bell = await prisma.inAppNotification.create({
      data: { userId: mInApp.id, type: 'MENU_ITEMS_DELETED', title: 'T', body: 'B', link: '/x', payload: {}, dedupeKey: `${PFX}bell-expiry` },
    })

    const none = { kind: 'none' as const, canSend: false, send: async () => { throw new Error('none') } }
    const r0 = await N.deliverDueNotifications({ transport: none })
    assert(r0.expired === 0 && (await prisma.notification.findUnique({ where: { id: oldMenu.id } }))?.status === 'PENDING',
      'no provider: nothing expires, the old menu email keeps waiting')

    const sent: Array<{ to: string[] }> = []
    const okT = { kind: 'log' as const, canSend: true, send: async (e: { to: string[] }) => { sent.push(e) } }
    const r1 = await N.deliverDueNotifications({ transport: okT, alertEmails: async () => ['ops@client.test'] })
    const st = async (id: string) => prisma.notification.findUnique({ where: { id } })
    const om = await st(oldMenu.id), op = await st(oldPrice.id)
    assert(r1.expired === 2 && om?.status === 'EXPIRED' && op?.status === 'EXPIRED'
      && om.lastError === 'Expired: older than 48 hours when email was connected' && om.sentAt === null,
    `provider connected: both menu templates older than 48h → EXPIRED with the reason, never sent (expired ${r1.expired})`)
    assert(!sent.some(s => s.to.includes(`old${MAIL}`) || s.to.includes(`oldp${MAIL}`)), 'and they were not handed to the transport')
    assert((await st(newMenu.id))?.status === 'SENT' && sent.some(s => s.to.includes(`new${MAIL}`)),
      '[0] control: a menu email 47 hours old is sent')
    assert((await st(oldAdmin.id))?.status === 'SKIPPED' && (await st(oldApplicant.id))?.status === 'SENT',
      'sign-up alerts and applicant emails behave as before (SKIPPED / SENT)')
    const b = await prisma.inAppNotification.findUnique({ where: { id: bell.id } })
    assert(!!b && b.readAt === null, 'the bell row is untouched and still unread')
  }

  // ── [13] source ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[13] source checks')
  {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/(?! DRAFT).*$/gm, '')
    const notif = readFileSync('lib/notifications.ts', 'utf8').replace(/\r\n/g, '\n')
    const mark = '// DRAFT – not approved by Jordan; move to branded FairSynq template when built.'
    const marks = notif.split(mark).length - 1
    const del = notif.indexOf('if (template === MENU_ALERT_TEMPLATE.MENU_ITEMS_DELETED)')
    const pri = notif.indexOf('if (template === MENU_ALERT_TEMPLATE.MENU_PRICE_CHANGE_PENDING)')
    assert(marks === 2 && notif.lastIndexOf(mark, del) > 0 && del - notif.lastIndexOf(mark, del) < mark.length + 5
      && pri - notif.lastIndexOf(mark, pri) < mark.length + 5,
    `both menu templates are marked DRAFT on the line above them (${marks} mark(s))`)

    const worker = readFileSync('workers/order-worker.ts', 'utf8')
    const dg = worker.indexOf('await runMenuNotificationDigests()')
    const dl = worker.indexOf('await deliverDueNotifications()')
    assert(dg > 0 && dl > dg, 'the worker runs the menu digest before delivery, in the same timer')

    for (const f of ['lib/menu-requests/file-item.ts', 'lib/menu-requests/apply-decision.ts', 'app/api/menu/[id]/route.ts']) {
      const src = strip(readFileSync(f, 'utf8'))
      const calls = [...src.matchAll(/record(?:MenuDeleted|PriceChangePending)\((\w+),/g)]
      assert(calls.length > 0 && calls.every(c => c[1] === 'tx'), `${f}: every alert record passes the caller's tx (${calls.length} call(s))`)
    }
    const planted = [...'await recordMenuDeleted(db, {'.matchAll(/record(?:MenuDeleted|PriceChangePending)\((\w+),/g)][0]?.[1]
    assert(planted === 'db', '[0] control: the scan reads the client argument')
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
