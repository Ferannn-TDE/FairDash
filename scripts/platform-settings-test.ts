/**
 * PLATFORM SETTINGS + platform_manager (Batch 1 item 5) — real handlers, real DB, Clerk mocked.
 *
 * Only Clerk identity is mocked (scripts/_route-loader.mjs → _clerk-mock.mjs, plus next/cache).
 * Every gate, write and transaction under test is the real code. Each negative section has a
 * positive control on the probe itself, so a green result can't be vacuous.
 *
 *   [1] Settings route gate: admin / super_admin / platform_manager in; event_operator, vendor,
 *       customer 403; anonymous 401.
 *   [2] platform_manager gets 403 on EVERY other /api/admin route (found from the file tree);
 *       control: super_admin gets past the gate on the same calls.
 *   [3] Page gates: /admin → /admin/settings for platform_manager; fair, organizer and booth
 *       operator pages send it away; event_operator is sent from /admin/settings to /admin.
 *   [4] Writes: setting + log in one transaction (forced failure → neither), no-op writes
 *       nothing, clear deletes the row and logs null, invalid values write nothing.
 *   [5] Concurrency: stale version → 409 and nothing changes; two simultaneous first saves →
 *       exactly one wins.
 *   [6] Registry: unknown key refused at runtime (and a type error).
 *   [7] "Not in effect yet" notes exist exactly while nothing reads the key.
 *   [8] Role sync + the hourly reconcile keep platform_manager; grant/revoke scripts handle it.
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/platform-settings-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { NextRequest } from 'next/server'

const prisma = testPrisma()
const PFX = 'pset-'
const MAIL = '@pset.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

function login(clerkId: string | null, roles: string[] = []) {
  (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles } } : undefined
}

const ROLE_USERS = {
  platform_manager: { clerkId: `${PFX}pm`, roles: ['platform_manager'] },
  admin: { clerkId: `${PFX}admin`, roles: ['admin'] },
  super_admin: { clerkId: `${PFX}super`, roles: ['super_admin'] },
  event_operator: { clerkId: `${PFX}evop`, roles: ['event_operator'] },
  vendor: { clerkId: `${PFX}vendor`, roles: ['vendor'] },
  customer: { clerkId: `${PFX}cust`, roles: [] as string[] },
}
const as = (who: keyof typeof ROLE_USERS) => login(ROLE_USERS[who].clerkId, ROLE_USERS[who].roles)

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body ?? {}),
  })
}

/** Where a server page/layout redirected to, or null if it rendered. */
async function redirectOf(render: () => unknown): Promise<string | null> {
  try {
    await render()
    return null
  } catch (e: any) {
    const digest = String(e?.digest ?? '')
    if (digest.startsWith('NEXT_REDIRECT')) return digest.split(';')[2] ?? '?'
    throw e
  }
}

function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) {
    const q = join(dir, n)
    if (statSync(q).isDirectory()) walk(q, out)
    else out.push(q)
  }
  return out
}

async function cleanup() {
  await prisma.platformSettingChange.deleteMany({})
  await prisma.platformSetting.deleteMany({})
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  if (events.length) {
    await prisma.runner.deleteMany({ where: { eventId: { in: events.map(e => e.id) } } })
    await prisma.event.deleteMany({ where: { id: { in: events.map(e => e.id) } } })
  }
  await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: MAIL } }, { clerkId: { startsWith: PFX } }] } })
}

async function main() {
  await cleanup()
  const settingsRoute = await import('../app/api/admin/settings/route')
  const settingsLib = await import('../lib/settings')
  const roles = await import('../lib/roles')

  // A DB user for the platform_manager, so the change log can show an email.
  await prisma.user.create({ data: { clerkId: ROLE_USERS.platform_manager.clerkId, email: `pm${MAIL}`, name: 'PM' } })

  const GET = () => settingsRoute.GET(req('/api/admin/settings'))
  const PATCH = (body: unknown) => settingsRoute.PATCH(req('/api/admin/settings', 'PATCH', body))
  const current = async (key: string) => (await settingsLib.listSettings()).settings.find(s => s.key === key)!
  const changeCount = () => prisma.platformSettingChange.count()

  // ── [1] settings route gate ────────────────────────────────────────────────────────────
  console.log('\n[1] Who can open and save platform settings')
  for (const who of ['platform_manager', 'admin', 'super_admin'] as const) {
    as(who)
    const r = await GET()
    assert(r.status === 200, `${who} → GET 200 (got ${r.status})`)
  }
  for (const who of ['event_operator', 'vendor', 'customer'] as const) {
    as(who)
    const g = await GET()
    const p = await PATCH({ key: 'alerts.phone', value: '6185550100', expectedVersion: 'unset' })
    assert(g.status === 403 && p.status === 403, `${who} → GET and PATCH 403 (got ${g.status}/${p.status})`)
  }
  login(null)
  assert((await GET()).status === 401, 'anonymous → 401')
  assert((await prisma.platformSetting.count()) === 0, 'none of the refused PATCHes wrote anything')
  assert(!(roles.ADMIN_ROLES as readonly string[]).includes('platform_manager'),
    'platform_manager is NOT in ADMIN_ROLES (so no requireAdminAuth route admits it)')

  // ── [2] every other admin route refuses platform_manager ──────────────────────────────
  console.log('\n[2] platform_manager is refused by every other /api/admin route')
  const API_ROOT = join(process.cwd(), 'app', 'api', 'admin')
  const routeFiles = walk(API_ROOT).filter(f => f.endsWith(`${sep}route.ts`))
  // Static info stubs: no gate and no data (no db import). Listed, not silently skipped.
  const STATIC_STUBS = ['route.ts', join('dashboard', 'route.ts')]
  const SELF = join('settings', 'route.ts')
  // platform_manager's second agreed grant (item 9): the approvals page's routes, and nothing else.
  const APPROVALS = join('approvals') + sep
  let approvalsProbed = 0, approvalsAdmitted = 0
  // REFUSED WITH 404 BY DESIGN (Jordan, Nov 16; decision of Nov 12, H5 2g `ed24d3a`):
  // requireAdminMenuApprover (lib/menu-requests/admin-approver.ts) answers every non-strict-admin
  // with 404 "Event not found", so a refusal looks exactly like a fair that does not exist. These
  // two handlers must answer platform_manager with EXACTLY 404; every other handler with EXACTLY 403.
  // This list is pinned at two entries below: a new 404 elsewhere is still a LEAK.
  const NOT_FOUND_BY_DESIGN = new Set([
    `GET ${join('events', '[id]', 'menu-requests', 'route.ts')}`,
    `PATCH ${join('events', '[id]', 'menu-requests', '[requestId]', 'route.ts')}`,
  ])
  let notFoundProbed = 0, notFoundRefused = 0
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
  let probed = 0, refused = 0, controlPassed = 0
  const leaks: string[] = [], controlFails: string[] = []
  for (const file of routeFiles) {
    const rel = relative(API_ROOT, file)
    if (rel === SELF) continue
    if (rel.startsWith(APPROVALS)) {
      const params: Record<string, string> = {}
      for (const m of rel.matchAll(/\[([^\]]+)\]/g)) params[m[1]] = m[1] === 'kind' ? 'vendor' : `${PFX}nope`
      const mod: Record<string, any> = await import(file)
      for (const method of METHODS) {
        if (typeof mod[method] !== 'function') continue
        approvalsProbed++
        as('platform_manager')
        const r: Response = await mod[method](req('/api/admin/' + rel, method, {}), { params: Promise.resolve(params) })
        if (r.status !== 401 && r.status !== 403) approvalsAdmitted++
      }
      continue
    }
    if (STATIC_STUBS.includes(rel)) {
      const s = readFileSync(file, 'utf8')
      assert(!/from '@\/lib\/db'|from '\.\.?\/.*db'/.test(s) && !/prisma/i.test(s),
        `static stub /api/admin/${rel.replace(/route\.ts$/, '')} has no data access (exempt from the 403 rule)`)
      continue
    }
    const params: Record<string, string> = {}
    for (const m of rel.matchAll(/\[([^\]]+)\]/g)) params[m[1]] = `${PFX}nope`
    const url = '/api/admin/' + rel.replace(/route\.ts$/, '').replace(/\[([^\]]+)\]/g, `${PFX}nope`)
    const mod: Record<string, any> = await import(file)
    for (const method of METHODS) {
      if (typeof mod[method] !== 'function') continue
      const byDesign404 = NOT_FOUND_BY_DESIGN.has(`${method} ${rel}`)
      if (byDesign404) notFoundProbed++
      else probed++
      as('platform_manager')
      const r: Response = await mod[method](req(url, method), { params: Promise.resolve(params) })
      if (byDesign404) {
        if (r.status === 404) notFoundRefused++
        else leaks.push(`${method} ${url} → ${r.status} (expected exactly 404, by design)`)
      } else if (r.status === 403) refused++
      else leaks.push(`${method} ${url} → ${r.status}`)
      // Control: the same call as super_admin gets PAST the gate (any status but 401/403).
      as('super_admin')
      const c: Response = await mod[method](req(url, method), { params: Promise.resolve(params) })
      if (c.status !== 401 && c.status !== 403) controlPassed++
      else controlFails.push(`${method} ${url} → ${c.status}`)
    }
  }
  for (const l of leaks) console.log(`     ↳ LEAK ${l}`)
  for (const l of controlFails) console.log(`     ↳ control refused ${l}`)
  assert(probed >= 40, `[0] the scan found the admin API (${probed} + ${notFoundProbed} handler methods across ${routeFiles.length} route files)`)
  assert(controlPassed === probed + notFoundProbed, `[0] positive control: super_admin gets past the gate on all ${probed + notFoundProbed} (${controlPassed})`)
  assert(refused === probed, `platform_manager → 403 on all ${probed} other admin handlers (${refused})`)
  assert(notFoundProbed === NOT_FOUND_BY_DESIGN.size && NOT_FOUND_BY_DESIGN.size === 2,
    `[0] both 404-by-design handlers exist and were probed, and the list is exactly 2 (${notFoundProbed})`)
  assert(notFoundRefused === notFoundProbed, `platform_manager → exactly 404 on the ${notFoundProbed} menu-request handlers (refusal looks like a missing fair) (${notFoundRefused})`)
  assert(approvalsProbed === 3 && approvalsAdmitted === 3, `platform_manager gets past the gate on exactly the 3 approvals handlers (${approvalsAdmitted}/${approvalsProbed})`)

  // ── [3] page gates ─────────────────────────────────────────────────────────────────────
  console.log('\n[3] Where each role lands')
  const adminIndex = (await import('../app/admin/page')).default
  const settingsPage = (await import('../app/admin/settings/page')).default
  const fairLayout = (await import('../app/admin/[eventSlug]/layout')).default
  const organizersPage = (await import('../app/admin/organizers/page')).default
  const operatorsPage = (await import('../app/admin/vendor-members/page')).default

  as('platform_manager')
  assert(await redirectOf(() => adminIndex()) === '/admin/approvals', 'platform_manager: /admin → /admin/approvals (their work queue, item 9)')
  assert(await redirectOf(() => settingsPage()) === null, 'platform_manager: /admin/settings renders')
  assert(await redirectOf(() => fairLayout({ children: null })) === '/', 'platform_manager: a fair\'s admin pages send it away')
  assert(await redirectOf(() => organizersPage()) === '/', 'platform_manager: /admin/organizers sends it away')
  assert(await redirectOf(() => operatorsPage()) === '/', 'platform_manager: /admin/vendor-members sends it away')

  login(ROLE_USERS.platform_manager.clerkId, ['platform_manager', 'admin'])
  assert(await redirectOf(() => adminIndex()) === null, 'platform_manager who is ALSO admin keeps the fair picker')

  as('super_admin')
  assert(await redirectOf(() => adminIndex()) === null, '[0] control: super_admin: /admin renders the picker (the probe sees a non-redirect)')
  assert(await redirectOf(() => settingsPage()) === null, 'super_admin: /admin/settings renders')
  as('admin')
  assert(await redirectOf(() => settingsPage()) === null, 'admin: /admin/settings renders')
  as('event_operator')
  assert(await redirectOf(() => settingsPage()) === '/admin', 'event_operator: /admin/settings → /admin')
  as('customer')
  assert(await redirectOf(() => settingsPage()) === '/admin', 'customer: /admin/settings → /admin (which sends them home)')
  login(null)
  assert(await redirectOf(() => settingsPage()) === '/admin/login', 'anonymous: /admin/settings → /admin/login')

  // ── [4] writes ─────────────────────────────────────────────────────────────────────────
  console.log('\n[4] Saving, no-ops, clearing, invalid values, one transaction')
  as('platform_manager')
  const first = await PATCH({ key: 'alerts.email', value: ' A@Fair.test, b@fair.test,a@fair.test ', expectedVersion: 'unset', reason: 'client inbox' })
  const firstJson: any = await first.json()
  assert(first.status === 200 && firstJson.data.outcome === 'saved', `first save → 200 saved (got ${first.status})`)
  assert(JSON.stringify(firstJson.data.setting.value) === JSON.stringify(['a@fair.test', 'b@fair.test']),
    'emails trimmed, lowercased, de-duplicated')
  const log1 = await prisma.platformSettingChange.findFirst({ where: { key: 'alerts.email' }, orderBy: { createdAt: 'desc' } })
  assert(!!log1 && log1.oldValue === null && log1.actorType === 'platform_manager' && log1.actorId === ROLE_USERS.platform_manager.clerkId && log1.reason === 'client inbox',
    'change log row: old = null, actor + role recorded, reason kept')

  const v1 = (await current('alerts.email')).version
  const before = await changeCount()
  const noop = await PATCH({ key: 'alerts.email', value: 'b@fair.test, a@fair.test', expectedVersion: v1 })
  const noopJson: any = await noop.json()
  // Order differs → it IS a change. The real no-op is the same normalised list.
  assert(noop.status === 200 && noopJson.data.outcome === 'saved', '[0] control: a reordered list counts as a change (the no-op probe can see writes)')
  const v2 = (await current('alerts.email')).version
  const before2 = await changeCount()
  const same = await PATCH({ key: 'alerts.email', value: 'B@fair.test,a@fair.test', expectedVersion: v2 })
  const sameJson: any = await same.json()
  assert(same.status === 200 && sameJson.data.outcome === 'unchanged', 'same normalised value → unchanged')
  assert((await changeCount()) === before2 && (await current('alerts.email')).version === v2,
    'a no-op writes nothing: no log row, version unchanged')
  assert(before2 === before + 1, 'and the real change before it logged exactly one row')

  // Forced failure between the setting write and the log write → neither survives.
  const beforeFail = await current('alerts.email')
  const countFail = await changeCount()
  let threw = false
  try {
    await settingsLib.saveSetting({
      key: 'alerts.email', raw: 'c@fair.test', expectedVersion: beforeFail.version,
      actorId: ROLE_USERS.platform_manager.clerkId, actorType: 'platform_manager',
      hooks: { afterSettingWrite: () => { throw new Error('forced') } },
    })
  } catch { threw = true }
  const afterFail = await current('alerts.email')
  assert(threw && JSON.stringify(afterFail.value) === JSON.stringify(beforeFail.value) && afterFail.version === beforeFail.version && (await changeCount()) === countFail,
    'forced failure after the setting write → setting AND log both rolled back')
  const ok = await settingsLib.saveSetting({
    key: 'alerts.email', raw: 'c@fair.test', expectedVersion: beforeFail.version,
    actorId: ROLE_USERS.platform_manager.clerkId, actorType: 'platform_manager',
  })
  assert(ok.outcome === 'saved' && (await changeCount()) === countFail + 1, '[0] control: the same save without the failure writes both')

  // Clear → row deleted, log newValue null, reads "not set".
  const clr = await PATCH({ key: 'alerts.email', value: '', expectedVersion: ok.setting.version })
  const clrJson: any = await clr.json()
  const lastLog = await prisma.platformSettingChange.findFirst({ where: { key: 'alerts.email' }, orderBy: { createdAt: 'desc' } })
  assert(clr.status === 200 && clrJson.data.outcome === 'cleared', 'empty value → cleared')
  assert((await prisma.platformSetting.findUnique({ where: { key: 'alerts.email' } })) === null, 'the row is deleted (back to the default)')
  assert(lastLog?.newValue === null && JSON.stringify(lastLog?.oldValue) === JSON.stringify(['c@fair.test']), 'log: old = previous value, new = null')
  const view = await settingsLib.listSettings()
  assert(view.changes[0].to === 'not set' && view.changes[0].from === 'c@fair.test', 'log shows "c@fair.test → not set" (empty default reads "not set")')
  assert(view.changes.some(c => c.actor === `pm${MAIL}`), 'log shows the actor email from the User table')
  assert(settingsLib.formatSettingValue('alerts.phone', null) === 'not set', 'formatter: no value + empty default → "not set"')

  // Invalid values → 400 with a field error, nothing written.
  const invalid: Array<[string, unknown]> = [
    ['alerts.email', 'not-an-email'],
    ['alerts.email', Array.from({ length: 6 }, (_, i) => `x${i}@fair.test`).join(',')],
    ['alerts.phone', '12345'],
    ['alerts.phone', '(123) 555-0100'],
    ['alerts.phone', '+44 20 7946 0958'],
  ]
  const countInvalid = await changeCount()
  for (const [key, value] of invalid) {
    const r = await PATCH({ key, value, expectedVersion: 'unset' })
    const j: any = await r.json()
    assert(r.status === 400 && typeof j.error?.details?.fieldErrors?.[key] === 'string', `${key} = ${JSON.stringify(value).slice(0, 40)} → 400 with a field error`)
  }
  assert((await changeCount()) === countInvalid && (await prisma.platformSetting.count()) === 0, 'invalid values wrote nothing')
  for (const v of ['(618) 555-0100', '618-555-0100', '+16185550100', '1 618 555 0100']) {
    assert(settingsLib.normalizeUsPhone(v) === '+16185550100', `[0] control: "${v}" → +16185550100`)
  }

  // ── [5] concurrency ────────────────────────────────────────────────────────────────────
  console.log('\n[5] Two people saving at once')
  const p1 = await PATCH({ key: 'alerts.phone', value: '618-555-0100', expectedVersion: 'unset' })
  const p1Json: any = await p1.json()
  const vA = p1Json.data.setting.version
  const p2 = await PATCH({ key: 'alerts.phone', value: '618-555-0111', expectedVersion: vA })
  const vB = (await p2.json() as any).data.setting.version
  const countStale = await changeCount()
  const stale = await PATCH({ key: 'alerts.phone', value: '618-555-0122', expectedVersion: vA })
  const staleJson: any = await stale.json()
  assert(stale.status === 409 && staleJson.error?.code === 'SETTING_CONFLICT', 'a save carrying an old version → 409')
  assert(staleJson.error?.details?.current?.value === '+16185550111', 'the 409 carries the current value (for the "changed by someone else" message)')
  assert((await current('alerts.phone')).value === '+16185550111' && (await changeCount()) === countStale, 'the stale save changed nothing')
  const fresh = await PATCH({ key: 'alerts.phone', value: '618-555-0122', expectedVersion: vB })
  assert(fresh.status === 200 && (await current('alerts.phone')).value === '+16185550122', '[0] control: the same save with the current version succeeds')

  await prisma.platformSetting.deleteMany({ where: { key: 'alerts.email' } })
  const race = await Promise.all([
    PATCH({ key: 'alerts.email', value: 'one@fair.test', expectedVersion: 'unset' }),
    PATCH({ key: 'alerts.email', value: 'two@fair.test', expectedVersion: 'unset' }),
  ])
  const statuses = race.map(r => r.status).sort()
  assert(statuses[0] === 200 && statuses[1] === 409, `two simultaneous first saves → one 200, one 409 (got ${statuses.join('/')})`)

  // ── [6] registry ───────────────────────────────────────────────────────────────────────
  console.log('\n[6] Only registry keys exist')
  const unk = await PATCH({ key: 'fees.serviceFee.percentBps', value: 1500, expectedVersion: 'unset' })
  assert(unk.status === 400 && ((await unk.json()) as any).error?.code === 'UNKNOWN_SETTING', 'a money key (not in the registry yet) → 400 UNKNOWN_SETTING')
  assert(!(await prisma.platformSetting.findUnique({ where: { key: 'fees.serviceFee.percentBps' } })), 'and nothing was written for it')
  let unknownThrew = false
  try {
    // @ts-expect-error — an unknown key is a type error (tsc fails this file if it ever isn't)
    await settingsLib.getSetting('sms.enabled')
  } catch { unknownThrew = true }
  assert(unknownThrew, 'getSetting on an unknown key throws at runtime too')
  assert(JSON.stringify(settingsLib.SETTING_KEYS) === JSON.stringify(['delivery.enabled', 'alerts.email', 'alerts.phone']),
    'the registry holds delivery.enabled (item 6) and the two alert contacts (no SMS or money keys)')

  // ── [7] "not in effect yet" notes ──────────────────────────────────────────────────────
  console.log('\n[7] "Not in effect yet" notes match reality')
  // A reader is any source outside the settings plumbing that names the key in quotes.
  const PLUMBING = new Set(['lib/settings.ts', 'app/api/admin/settings/route.ts', 'app/admin/_components/PlatformSettingsPanel.tsx'])
  const sources = ['app', 'lib', 'workers'].flatMap(d => walk(join(process.cwd(), d)))
    .filter(f => /\.(ts|tsx)$/.test(f))
    .map(f => ({ path: relative(process.cwd(), f).split(sep).join('/'), text: readFileSync(f, 'utf8') }))
  function noteViolations(files: { path: string; text: string }[]) {
    const out: string[] = []
    for (const key of settingsLib.SETTING_KEYS) {
      const readers = files.filter(f => !PLUMBING.has(f.path) && (f.text.includes(`'${key}'`) || f.text.includes(`"${key}"`)))
      const hasNote = !!(settingsLib.SETTINGS[key] as { notInEffect?: string }).notInEffect
      if (readers.length && hasNote) out.push(`${key}: read by ${readers.map(r => r.path).join(', ')}; remove its "not in effect yet" note`)
      if (!readers.length && !hasNote) out.push(`${key}: nothing reads it; it needs a "not in effect yet" note`)
    }
    return out
  }
  const fake = noteViolations([...sources, { path: 'lib/sms-alerts.ts', text: "await getSetting('alerts.phone')" }])
  assert(fake.some(v => v.startsWith('alerts.phone: read by lib/sms-alerts.ts')), '[0] positive control: a fabricated reader makes the check demand the note\'s removal')
  assert(!settingsLib.SETTINGS['alerts.email'].hasOwnProperty('notInEffect') && sources.some(f => f.path === 'lib/notifications.ts' && f.text.includes("'alerts.email'")),
    'alerts.email is read by the outbox (lib/notifications.ts) and its note is gone; alerts.phone keeps its note')
  const real = noteViolations(sources)
  for (const v of real) console.log(`     ↳ ${v}`)
  assert(real.length === 0, 'the alert settings carry the note (nothing reads them yet); delivery.enabled is read, so it has none')

  // ── [8] role sync keeps platform_manager; grant/revoke ─────────────────────────────────
  console.log('\n[8] Role sync, the hourly reconcile, grant and revoke')
  const clerkUsers = new Map<string, { id: string; publicMetadata: Record<string, unknown> }>()
  const fakeClerk = {
    users: {
      async getUser(id: string) { const u = clerkUsers.get(id); if (!u) throw new Error('not found'); return u },
      async updateUserMetadata(id: string, p: { publicMetadata: Record<string, unknown> }) { const u = clerkUsers.get(id)!; u.publicMetadata = p.publicMetadata; return u },
      async getUserList({ limit = 100, offset = 0 }: { limit?: number; offset?: number }) {
        const all = [...clerkUsers.values()]; return { data: all.slice(offset, offset + limit), totalCount: all.length }
      },
    },
  }
  const roleSync = await import('../lib/role-sync')
  roleSync.__setClerkForTest(fakeClerk as any)
  const event = await prisma.event.create({ data: { name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })
  const mk = async (tag: string, initial: string[], runner: boolean) => {
    const clerkId = `${PFX}${tag}-${rand()}`
    const u = await prisma.user.create({ data: { clerkId, email: `${tag}-${rand()}${MAIL}`, name: tag } })
    if (runner) await prisma.runner.create({ data: { userId: u.id, eventId: event.id } })
    clerkUsers.set(clerkId, { id: clerkId, publicMetadata: { roles: initial } })
    return { u, clerkId }
  }
  const rolesOf = (id: string) => ((clerkUsers.get(id)!.publicMetadata.roles as string[]) ?? []).slice().sort()

  const a = await mk('sync', ['platform_manager'], true)
  await roleSync.syncUserRoleMetadata(a.u.id)
  assert(rolesOf(a.clerkId).includes('runner'), '[0] positive control: sync DID change roles (added the DB-backed runner role)')
  assert(rolesOf(a.clerkId).includes('platform_manager'), 'syncUserRoleMetadata keeps platform_manager')

  const b = await mk('sweep', ['platform_manager'], true)
  const summary = await roleSync.reconcileAllRoles({ dryRun: false })
  assert(summary.updated >= 1 && rolesOf(b.clerkId).includes('runner'), '[0] positive control: the hourly reconcile DID write (added runner)')
  assert(rolesOf(b.clerkId).includes('platform_manager'), 'the hourly reconcile keeps platform_manager')
  const c = await mk('sweep2', ['platform_manager'], false)
  await roleSync.reconcileAllRoles({ dryRun: false })
  assert(JSON.stringify(rolesOf(c.clerkId)) === JSON.stringify(['platform_manager']), 'a platform_manager with no DB rows is left exactly as is by the sweep')
  roleSync.__setClerkForTest(null)

  assert(roles.isGrantableRole('platform_manager') && roles.isGrantableRole('admin') && !roles.isGrantableRole('vendor'),
    'grant/revoke accept platform_manager and the admin roles, not DB-derived roles')
  assert(JSON.stringify(roles.withRoleAdded(['vendor'], 'platform_manager')) === JSON.stringify(['vendor', 'platform_manager']), 'grant adds platform_manager and keeps other roles')
  assert(JSON.stringify(roles.withRoleRemoved(['vendor', 'platform_manager', 'admin'], 'platform_manager')) === JSON.stringify(['vendor', 'admin']),
    'revoking platform_manager removes it')
  assert(JSON.stringify(roles.withRoleRemoved(['platform_manager', 'admin'], 'admin')) === JSON.stringify(['platform_manager']),
    '[0] control: revoking a different role keeps platform_manager')
  const grantSrc = readFileSync('scripts/grant-admin.ts', 'utf8'), revokeSrc = readFileSync('scripts/revoke-admin.ts', 'utf8')
  assert(/isGrantableRole\(ROLE\)/.test(grantSrc) && /withRoleAdded\(before, ROLE\)/.test(grantSrc), 'grant-admin.ts uses those exact helpers')
  assert(/isGrantableRole\(ROLE\)/.test(revokeSrc) && /withRoleRemoved\(before, ROLE\)/.test(revokeSrc), 'revoke-admin.ts uses those exact helpers')
  assert(/assertNotProductionClerk/.test(grantSrc) && /assertNotProductionClerk/.test(revokeSrc), 'both still refuse production Clerk')
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(64)}`)
    console.log(fail === 0 ? `  ${pass} passed, 0 failed` : `  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(64)}\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
