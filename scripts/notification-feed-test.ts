/**
 * BELL FEED — audit H5, step 3c. Real route, test DB.
 *
 * GET/PATCH /api/notifications/feed: the signed-in person's own bell notifications, newest first,
 * with the unread count; mark some or all read. The bell in the admin and organizer portals reads it.
 *
 *   [1] access: signed out 401 (GET and PATCH); a sign-in with no User row 404
 *   [2] GET: only the caller's rows; newest first (ties broken by id); default 20; limit capped at
 *       50; paging with `before` has no gaps or repeats; another person's id as `before` 400; bad
 *       limit 400; payload never sent
 *   [3] PATCH: Content-Type must be application/json (text/plain and none → 400; with charset →
 *       ok); ids mark only the caller's rows; a second mark keeps the first readAt; bad bodies 400;
 *       { all: true } marks only the caller's
 *   [4] end to end with 3a: a grouped delete shows up in the feed with a link the bell will follow
 *   [5] link check (lib/notification-link.ts): //, /\, http(s), javascript:, backslash, tab refused
 *   [6] screens (source checks; the repo has no browser test framework)
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/notification-feed-test.ts
 * Self-cleaning, prefix nft-.
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
const PFX = 'nft-'
const MAIL = '@nft.test'
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
type Item = { id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string; payload?: unknown }
type Body = { success?: boolean; data?: { items?: Item[]; unreadCount?: number; nextBefore?: string | null }; error?: { code?: string; message?: string } }
async function bodyOf(res: Response): Promise<Body> {
  try { return await res.json() as Body } catch { return {} }
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const vids = vs.map(v => v.id)
    await prisma.menuChangeEvent.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.notification.deleteMany({ where: { to: { endsWith: MAIL } } })
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  // Bell rows go with their user (foreign key, cascade).
  await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: MAIL } }, { clerkId: { startsWith: PFX } }] } })
}

async function main() {
  console.log('\n══ BELL FEED (H5, step 3c) ══')
  await cleanup()

  const route = await import('../app/api/notifications/feed/route')
  const GET = route.GET as unknown as (r: NextRequest) => Promise<Response>
  const PATCH = route.PATCH as unknown as (r: NextRequest) => Promise<Response>
  const URL_ = 'http://localhost/api/notifications/feed'
  const get = (qs = '') => GET(new NextRequest(`${URL_}${qs}`))
  const patch = (body: unknown, opts: { raw?: string; contentType?: string | null } = {}) => {
    const text = opts.raw ?? JSON.stringify(body)
    const contentType = opts.contentType === undefined ? 'application/json' : opts.contentType
    // Bytes, not a string: a string body would make fetch add text/plain on its own.
    return PATCH(new NextRequest(URL_, {
      method: 'PATCH',
      headers: contentType === null ? {} : { 'Content-Type': contentType },
      body: new TextEncoder().encode(text),
    }))
  }

  // ── fixture ─────────────────────────────────────────────────────────────────────────────────
  const mkUser = (tag: string) => prisma.user.create({
    data: { clerkId: `${PFX}${tag}-${rand()}`, email: `${tag}-${rand()}${MAIL}`, name: tag },
  })
  const alice = await mkUser('alice')
  const bob = await mkUser('bob')
  const base = Date.now() - 3600e3
  // 55 rows for Alice, one second apart; rows 10 and 11 share a timestamp (tie broken by id).
  const aliceRows = Array.from({ length: 55 }, (_, i) => ({
    userId: alice.id, type: 'MENU_ITEMS_DELETED', title: `A${i}`, body: 'b', link: '/admin',
    payload: { secret: 'not for the browser' }, dedupeKey: `${PFX}a-${i}-${rand()}`,
    createdAt: new Date(base + (i === 11 ? 10 : i) * 1000),
  }))
  await prisma.inAppNotification.createMany({ data: aliceRows })
  await prisma.inAppNotification.createMany({
    data: Array.from({ length: 3 }, (_, i) => ({
      userId: bob.id, type: 'MENU_ITEMS_DELETED', title: `B${i}`, body: 'b', link: null,
      payload: {}, dedupeKey: `${PFX}b-${i}-${rand()}`, createdAt: new Date(base + 100e3 + i * 1000),
    })),
  })
  const aliceIds = new Set((await prisma.inAppNotification.findMany({ where: { userId: alice.id }, select: { id: true } })).map(r => r.id))
  const bobFirst = await prisma.inAppNotification.findFirstOrThrow({ where: { userId: bob.id } })

  // ── [1] access ──────────────────────────────────────────────────────────────────────────────
  console.log('\n[1] who may use the feed')
  login(null)
  assert((await get()).status === 401 && (await patch({ all: true })).status === 401, 'signed out → 401 (GET and PATCH)')
  login(`${PFX}ghost-${rand()}`)
  const ghost = await get()
  assert(ghost.status === 404 && (await bodyOf(ghost)).error?.code === 'USER_NOT_FOUND', `a sign-in with no User row → 404 USER_NOT_FOUND (${ghost.status})`)
  login(alice.clerkId)
  assert((await get()).status === 200, '[0] control: a signed-in person with an account → 200')

  // ── [2] GET ─────────────────────────────────────────────────────────────────────────────────
  console.log('\n[2] reading the feed')
  {
    login(alice.clerkId)
    const b = await bodyOf(await get())
    const items = b.data?.items ?? []
    assert(items.length === 20 && b.data?.unreadCount === 55 && typeof b.data?.nextBefore === 'string',
      `default page: 20 items, unreadCount 55, a nextBefore (${items.length}, ${b.data?.unreadCount})`)
    assert(items.every(i => aliceIds.has(i.id)), 'every item is the caller\'s own (none of Bob\'s)')
    const sorted = items.every((it, k) => k === 0 || items[k - 1].createdAt > it.createdAt || (items[k - 1].createdAt === it.createdAt && items[k - 1].id > it.id))
    assert(sorted && items[0].title === 'A54', `newest first, ties by id (first: ${items[0]?.title})`)
    assert(items.every(i => !('payload' in i)), 'the stored payload is not sent')
    assert(Object.keys(items[0] ?? {}).sort().join() === 'body,createdAt,id,link,readAt,title,type', 'only the display fields are sent')

    // Walk every page: 20 + 20 + 15, no gaps, no repeats.
    const seen: string[] = []
    let before: string | null | undefined = undefined
    let pages = 0
    do {
      const pb: Body = await bodyOf(await get(before ? `?before=${before}` : ''))
      seen.push(...(pb.data?.items ?? []).map(i => i.id))
      before = pb.data?.nextBefore
      pages++
    } while (before && pages < 10)
    assert(pages === 3 && seen.length === 55 && new Set(seen).size === 55 && seen.every(id => aliceIds.has(id)),
      `paging: ${pages} pages, ${seen.length} items, ${new Set(seen).size} distinct — all 55, no gaps or repeats (incl. the two with the same time)`)

    const big = await bodyOf(await get('?limit=100'))
    assert(big.data?.items?.length === 50, `limit=100 is capped at 50 (${big.data?.items?.length})`)
    const five = await bodyOf(await get('?limit=5'))
    assert(five.data?.items?.length === 5, '[0] control: limit=5 → 5')
    for (const bad of ['?limit=0', '?limit=abc', '?limit=-3', '?limit=2.5']) {
      assert((await get(bad)).status === 400, `${bad} → 400`)
    }
    const stranger = await get(`?before=${bobFirst.id}`)
    assert(stranger.status === 400, `another person's notification as before → 400 (${stranger.status})`)
    assert((await get('?before=nope')).status === 400, 'an unknown id as before → 400')

    login(bob.clerkId)
    const bb = await bodyOf(await get())
    assert(bb.data?.items?.length === 3 && bb.data.unreadCount === 3 && bb.data.nextBefore === null && (bb.data.items ?? []).every(i => !aliceIds.has(i.id)),
      'Bob sees only his own 3, unreadCount 3, no next page')
  }

  // ── [3] PATCH ───────────────────────────────────────────────────────────────────────────────
  console.log('\n[3] marking read')
  {
    login(alice.clerkId)
    const unreadOf = (userId: string) => prisma.inAppNotification.count({ where: { userId, readAt: null } })
    const [a1, a2] = [...aliceIds]

    const plain = await patch({ ids: [a1] }, { contentType: 'text/plain' })
    assert(plain.status === 400, `Content-Type text/plain → 400 (${plain.status})`)
    const none = await patch({ ids: [a1] }, { contentType: null })
    assert(none.status === 400, `no Content-Type → 400 (${none.status})`)
    const form = await patch({ ids: [a1] }, { contentType: 'application/x-www-form-urlencoded' })
    assert(form.status === 400, `Content-Type form → 400 (${form.status})`)
    assert(await unreadOf(alice.id) === 55, 'none of those marked anything')

    const r = await patch({ ids: [a1, a2, bobFirst.id] }, { contentType: 'application/json; charset=utf-8' })
    const rb = await bodyOf(r)
    assert(r.status === 200 && rb.data?.unreadCount === 53, `application/json with charset is accepted; two of Alice's marked, unreadCount 53 (${r.status}, ${rb.data?.unreadCount})`)
    assert((await prisma.inAppNotification.findUniqueOrThrow({ where: { id: bobFirst.id } })).readAt === null, 'Bob\'s id in Alice\'s request: left unread')

    const firstReadAt = (await prisma.inAppNotification.findUniqueOrThrow({ where: { id: a1 } })).readAt
    await new Promise(res => setTimeout(res, 20))
    await patch({ ids: [a1] })
    const againReadAt = (await prisma.inAppNotification.findUniqueOrThrow({ where: { id: a1 } })).readAt
    assert(firstReadAt !== null && againReadAt?.getTime() === firstReadAt.getTime(), 'marking again keeps the first readAt')

    const tooMany = Array.from({ length: 101 }, (_, i) => `x${i}`)
    const bad: Array<[string, Response]> = [
      ['empty object', await patch({})],
      ['empty ids', await patch({ ids: [] })],
      ['101 ids', await patch({ ids: tooMany })],
      ['a number id', await patch({ ids: [1] })],
      ['an empty-string id', await patch({ ids: [''] })],
      ['ids not a list', await patch({ ids: a1 })],
      ['all: false', await patch({ all: false })],
      ['all and ids together', await patch({ all: true, ids: [a1] })],
      ['non-JSON body', await patch(undefined, { raw: 'all=true' })],
      ['JSON null', await patch(null)],
    ]
    for (const [label, res] of bad) assert(res.status === 400, `${label} → 400 (${res.status})`)
    assert(await unreadOf(alice.id) === 53, 'none of those changed anything (still 53)')
    const hundred = await patch({ ids: Array.from({ length: 100 }, (_, i) => `y${i}`) })
    assert(hundred.status === 200, '[0] control: exactly 100 ids → 200')

    const all = await bodyOf(await patch({ all: true }))
    assert(all.data?.unreadCount === 0 && await unreadOf(alice.id) === 0, '{ all: true } → Alice has 0 unread')
    assert(await unreadOf(bob.id) === 3, 'and Bob still has 3')
  }

  // ── [4] end to end with 3a ──────────────────────────────────────────────────────────────────
  console.log('\n[4] a menu alert from 3a shows up in the feed')
  {
    const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}Org`, contactEmail: `org-${rand()}${MAIL}`, approvalStatus: 'APPROVED' } })
    const member = await mkUser('member')
    await prisma.orgMember.create({ data: { organizerId: org.id, userId: member.id, role: 'owner' } })
    const now = Date.now()
    const fair = await prisma.event.create({
      data: { name: `${PFX}Fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', organizerId: org.id, startDate: new Date(now - 864e5), endDate: new Date(now + 864e5) },
    })
    const vendor = await prisma.vendor.create({ data: { eventId: fair.id, name: 'Booth F', slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } })
    const { recordMenuDeleted } = await import('../lib/menu-notify/record')
    const { runMenuNotificationDigests } = await import('../lib/menu-notify/digest')
    const { safeBellLink } = await import('../lib/notification-link')
    const item = await prisma.menuItem.create({ data: { vendorId: vendor.id, name: `${PFX}Corn`, price: 5, category: 'Mains' } })
    await prisma.$transaction(tx => recordMenuDeleted(tx, { vendorId: vendor.id, menuItemId: item.id, name: item.name, price: 5, menuRequestId: null }))
    await runMenuNotificationDigests({ now: new Date(Date.now() + 11 * 60e3), listStrictAdminClerkIds: async () => [] })

    login(member.clerkId)
    const b = await bodyOf(await get())
    const it = b.data?.items?.[0]
    assert(b.data?.items?.length === 1 && it?.type === 'MENU_ITEMS_DELETED' && b.data.unreadCount === 1,
      `the organizer member sees the grouped delete, unread (${b.data?.items?.length}, ${it?.type}, ${b.data?.unreadCount})`)
    assert(typeof it?.link === 'string' && safeBellLink(it.link) === it.link, `its link is one the bell will follow (${it?.link})`)
    const m = await bodyOf(await patch({ ids: [it?.id] }))
    assert(m.data?.unreadCount === 0, 'marking it read → unreadCount 0')
  }

  // ── [5] link check ──────────────────────────────────────────────────────────────────────────
  console.log('\n[5] the bell only follows links on this site')
  {
    const { safeBellLink } = await import('../lib/notification-link')
    const ok = ['/admin', '/admin/my-fair/approvals', '/organizer/fairs/x/menu-requests?tab=deletes']
    for (const l of ok) assert(safeBellLink(l) === l, `accepts ${l}`)
    const refused: Array<[string, unknown]> = [
      ['//evil.example', '//evil.example'],
      ['/\\evil.example', '/\\evil.example'],
      ['https://evil.example', 'https://evil.example'],
      ['http://evil.example', 'http://evil.example'],
      ['javascript:alert(1)', 'javascript:alert(1)'],
      ['a backslash later', '/admin\\..\\\\evil.example'],
      ['a tab after the slash', '/\t/evil.example'],
      ['a newline', '/admin\n'],
      ['a space', '/ /evil.example'],
      ['a relative path', 'admin/x'],
      ['empty', ''],
      ['null', null],
      ['a number', 42],
    ]
    for (const [label, l] of refused) assert(safeBellLink(l) === null, `refuses ${label}`)
  }

  // ── [6] screens ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[6] the bell and the portal headers (source checks)')
  {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/^\s*\/\/.*$/gm, '')
    const bell = strip(readFileSync('app/_components/NotificationBell.tsx', 'utf8'))
    assert(/const href = safeBellLink\(item\.link\)\s*\n\s*if \(href\) \{[\s\S]*?router\.push\(href\)/.test(bell), 'the bell only navigates to a link that passed safeBellLink')
    assert((bell.match(/router\.push\(/g) ?? []).length === 1 && !/window\.location/.test(bell) && !/href=\{item\.link\}/.test(bell),
      'no other way out: one router.push, no window.location, no raw link in an href')
    assert(/method: 'PATCH',\s*\n\s*headers: \{ 'Content-Type': 'application\/json' \}/.test(bell), 'the bell sends PATCH as application/json')
    assert(/unread > 0 && \(/.test(bell), 'the dot shows only when there is something unread')
    assert(/aria-label=\{label\}/.test(bell) && /aria-expanded=\{open\}/.test(bell), 'the button says how many are unread and whether it is open')
    assert(/document\.visibilityState === 'visible'/.test(bell) && /POLL_MS = 60_000/.test(bell), 'refreshes every 60 s, only while the tab is visible')

    for (const [name, file] of [['admin', 'app/admin/_components/AdminShell.tsx'], ['organizer', 'app/organizer/_components/OrganizerShell.tsx']]) {
      const src = strip(readFileSync(file, 'utf8'))
      assert(/import NotificationBell from '@\/app\/_components\/NotificationBell'/.test(src), `${name} portal imports the bell`)
      assert(!/BellIcon/.test(src), `${name} portal: the decorative bell is gone`)
    }
    const org = strip(readFileSync('app/organizer/_components/OrganizerShell.tsx', 'utf8'))
    assert((org.match(/<NotificationBell\b/g) ?? []).length === 2 && /<NotificationBell align="left" \/>/.test(org),
      'organizer: a bell in the phone header and one in the desktop sidebar (panel opens to the right)')
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
