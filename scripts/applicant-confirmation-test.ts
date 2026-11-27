/**
 * APPLICANT CONFIRMATION EMAIL (sign-up-fixes, commit 2) — "We got your application" for vendors,
 * partners and runners (organizers join in commit 4). Real routes, test DB.
 *
 *   [1] The wording: each kind's subject and body exactly as approved (Jordan, Nov 26); runners get
 *       no decision sentence; heading, preheader, no button, and the standard footer
 *   [2] POST /api/vendors queues exactly ONE confirmation to the form email (beside the admin alert);
 *       queuing it again adds nothing; a blank form email queues none and the application stands
 *   [3] POST /api/partners/apply: the same
 *   [4] POST /api/drivers: the same, named by the typed first name
 *   [5] Only the application-creating routes queue it (never an edit route), in the same transaction
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/applicant-confirmation-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync, readdirSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { EventStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'apc-'
const MAIL = '@apc.local'
const rand = () => Math.random().toString(36).slice(2, 8)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const login = (clerkId: string | null) => { (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles: [] } } : undefined }
const json = (url: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

const received = (kind: string, id: string) => prisma.notification.findMany({ where: { dedupeKey: `received:${kind}:${id}` } })

async function cleanup() {
  await prisma.notification.deleteMany({ where: { OR: [{ to: { endsWith: MAIL } }, { dedupeKey: { contains: PFX } }] } })
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const evIds = evs.map(e => e.id)
  if (evIds.length) {
    const vendors = await prisma.vendor.findMany({ where: { eventId: { in: evIds } }, select: { id: true } })
    await prisma.notification.deleteMany({ where: { dedupeKey: { in: vendors.flatMap(v => [`signup:vendor:${v.id}`, `received:vendor:${v.id}`]) } } })
    await prisma.vendorMember.deleteMany({ where: { vendor: { eventId: { in: evIds } } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: evIds } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: evIds } } })
    await prisma.event.deleteMany({ where: { id: { in: evIds } } })
  }
  const partners = await prisma.partnerOrganization.findMany({ where: { name: { startsWith: PFX } }, select: { id: true } })
  await prisma.notification.deleteMany({ where: { dedupeKey: { in: partners.flatMap(p => [`signup:partner:${p.id}`, `received:partner:${p.id}`]) } } })
  await prisma.partnerOrganization.deleteMany({ where: { id: { in: partners.map(p => p.id) } } })
  const apps = await prisma.runnerApplication.findMany({ where: { firstName: { startsWith: PFX } }, select: { id: true } })
  await prisma.notification.deleteMany({ where: { dedupeKey: { in: apps.map(a => `received:runner:${a.id}`) } } })
  await prisma.runnerApplication.deleteMany({ where: { id: { in: apps.map(a => a.id) } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  const stubs = await import('./_network-stubs'); stubs.stubClerkUsers()
  const T = await import('../lib/email/templates')
  const L = await import('../lib/email/layout')
  const N = await import('../lib/notifications')

  // ── [1] wording ────────────────────────────────────────────────────────────────────────
  console.log('\n[1] The wording')
  const WANT: Array<[string, string, string, string]> = [
    ['vendor', 'Taco Stand', 'We got your FairSynq application', "Thanks, Taco Stand. We got your vendor application and FairSynq is reviewing it now. We'll email you here when there's a decision."],
    ['partner', 'Rotary Club', 'We got your FairSynq partner application', "Thanks, Rotary Club. We got your partner application and FairSynq is reviewing it now. We'll email you here when there's a decision."],
    ['organizer', 'County Fair Board', 'We got your FairSynq organizer application', "Thanks, County Fair Board. We got your organizer application and FairSynq is reviewing it now. We'll email you here when there's a decision."],
    ['runner', 'Dee', 'We got your FairSynq runner application', 'Thanks, Dee. We got your runner application and FairSynq is reviewing it now.'],
  ]
  for (const [kind, name, subject, body] of WANT) {
    const r = T.renderEmail('application_received', { kind, name })
    assert(r.subject === subject, `${kind}: subject "${subject}"`)
    assert(r.text === L.emailTextWithFooter(body, 'standard'), `${kind}: body word for word, then the footer`)
    assert(r.text.includes('Questions? Just reply to this email') && r.html.includes('Questions? Just reply to this email'), `${kind}: footer keeps "Questions? Just reply to this email"`)
    assert(r.html.includes('>We got your application</h1>') && r.html.includes('FairSynq is reviewing it now.'), `${kind}: heading and preheader`)
    assert(!r.html.includes(L.BUTTON_FALLBACK) && !/class="fs-btn-cell/.test(r.html.replace(/<style[\s\S]*?<\/style>/g, '')), `${kind}: no button`)
  }
  assert(!T.renderEmail('application_received', { kind: 'runner', name: 'Dee' }).text.includes('decision'), 'runner: no promise of a decision email')

  // ── [2] vendor ─────────────────────────────────────────────────────────────────────────
  console.log('\n[2] POST /api/vendors')
  const { POST: vendorsPOST } = await import('../app/api/vendors/route')
  const event = await prisma.event.create({
    data: { name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: EventStatus.UPCOMING, startDate: new Date(), endDate: new Date(Date.now() + 864e5) },
  })
  const applyVendor = async (contactEmail: string) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'V' } })
    login(u.clerkId)
    const r = await vendorsPOST(json('/api/vendors', 'POST', {
      eventSlug: event.urlSlug, name: `${PFX}Booth ${rand()}`, cuisineType: 'Tacos', legalName: 'Jane Smith',
      agreedToVendorAgreement: true, contactEmail, contactPhone: '(217) 555-0134',
    }) as any)
    const j: any = await r.json()
    return { status: r.status, id: j?.data?.id as string | undefined, name: j?.data?.name as string | undefined }
  }
  const vEmail = `ana-${rand()}${MAIL}`
  const v = await applyVendor(vEmail)
  const vRows = v.id ? await received('vendor', v.id) : []
  assert(v.status === 201 && vRows.length === 1, `one confirmation queued (got ${v.status}, ${vRows.length} row(s))`)
  const vRow = vRows[0]
  assert(vRow?.audience === 'applicant' && vRow?.to === vEmail && vRow?.template === 'application_received' && vRow?.status === 'PENDING',
    'to the form email, as an applicant email, PENDING in the outbox')
  assert(JSON.stringify(vRow?.payload) === JSON.stringify({ kind: 'vendor', name: v.name }), 'payload: kind vendor and the business name')
  assert(v.id ? (await prisma.notification.count({ where: { dedupeKey: `signup:vendor:${v.id}` } })) === 1 : false, '[0] control: the admin alert is still queued beside it')
  if (v.id) await N.enqueueApplicationReceived(prisma, v.id, vEmail, { kind: 'vendor', name: v.name ?? '' })
  assert(v.id ? (await received('vendor', v.id)).length === 1 : false, 'queuing it again for the same application adds nothing')
  const vBlank = await applyVendor('   ')
  assert(vBlank.status === 201 && vBlank.id ? (await received('vendor', vBlank.id)).length === 0 : false, 'a blank form email: the application is saved and no confirmation is queued')

  // ── [3] partner ────────────────────────────────────────────────────────────────────────
  console.log('\n[3] POST /api/partners/apply')
  const rl = await import('../lib/ratelimit')
  const allowAll = { limit: async () => ({ success: true, limit: 3, remaining: 3, reset: Date.now() + 3600e3 }) }
  rl.__setStateForTest({ type: 'ready', limiters: new Proxy({}, { get: () => allowAll }) as any })
  const { POST: partnerPOST } = await import('../app/api/partners/apply/route')
  const pEmail = `sam-${rand()}${MAIL}`
  const pName = `${PFX}PTA ${rand()}`
  const p = await partnerPOST(json('/api/partners/apply', 'POST',
    { name: pName, groupType: 'school', contactName: 'Sam', email: pEmail, phone: '(217) 555-0134', city: 'Alton', state: 'IL' },
    { 'x-forwarded-for': '203.0.113.60' }))
  const pRow = await prisma.partnerOrganization.findFirst({ where: { name: pName }, select: { id: true } })
  const pRows = pRow ? await received('partner', pRow.id) : []
  assert(p.status === 201 && pRows.length === 1 && pRows[0].to === pEmail && pRows[0].audience === 'applicant', `one confirmation to the form email (got ${p.status}, ${pRows.length} row(s))`)
  assert(JSON.stringify(pRows[0]?.payload) === JSON.stringify({ kind: 'partner', name: pName }), 'payload: kind partner and the organization name')
  const dup = await partnerPOST(json('/api/partners/apply', 'POST',
    { name: pName, groupType: 'school', contactName: 'Sam', email: pEmail, phone: '(217) 555-0134', city: 'Alton', state: 'IL' },
    { 'x-forwarded-for': '203.0.113.60' }))
  assert(dup.status === 200 && pRow ? (await prisma.notification.count({ where: { template: 'application_received', to: pEmail } })) === 1 : false,
    'a second application from the same pending email writes nothing and queues no second confirmation')
  rl.__resetForTest()

  // ── [4] runner ─────────────────────────────────────────────────────────────────────────
  console.log('\n[4] POST /api/drivers')
  login(null)
  const { POST: driversPOST } = await import('../app/api/drivers/route')
  const applyRunner = async (email: string) => {
    const first = `${PFX}Dee${rand()}`
    const r = await driversPOST(json('/api/drivers', 'POST', {
      personal: { firstName: first, lastName: 'Driver', email, phone: '(217) 555-0134', dob: '1990-01-01', city: 'Alton' },
      agreed: true, bgConsent: true, termsVersion: 'test',
    }))
    const app = await prisma.runnerApplication.findFirst({ where: { firstName: first }, select: { id: true } })
    return { status: r.status, first, appId: app?.id }
  }
  const rEmail = `dee-${rand()}${MAIL}`
  const rApp = await applyRunner(rEmail)
  const rRows = rApp.appId ? await received('runner', rApp.appId) : []
  assert(rApp.status === 201 && rRows.length === 1 && rRows[0].to === rEmail && rRows[0].audience === 'applicant', `one confirmation to the typed email (got ${rApp.status}, ${rRows.length} row(s))`)
  assert(JSON.stringify(rRows[0]?.payload) === JSON.stringify({ kind: 'runner', name: rApp.first }), 'payload: kind runner and the typed first name')

  // ── [5] who queues it ──────────────────────────────────────────────────────────────────
  console.log('\n[5] Only the application-creating routes queue it')
  const walk = (dir: string): string[] => (readdirSync(dir, { recursive: true }) as string[])
    .filter(f => /\.(ts|tsx)$/.test(f)).map(f => `${dir}/${f.replace(/\\/g, '/')}`)
  const callers = [...walk('app'), ...walk('lib')].filter(f => /enqueueApplicationReceived\(/.test(readFileSync(f, 'utf8')) && f !== 'lib/notifications.ts')
  assert(JSON.stringify(callers.sort()) === JSON.stringify(['app/api/drivers/route.ts', 'app/api/partners/apply/route.ts', 'app/api/vendors/route.ts']),
    `called only by the three application routes (found: ${callers.join(', ')})`)
  for (const f of ['app/api/vendors/route.ts', 'app/api/partners/apply/route.ts', 'app/api/drivers/route.ts']) {
    const src = readFileSync(f, 'utf8')
    const tx = src.indexOf('db.$transaction(async tx')
    const call = src.indexOf('enqueueApplicationReceived(tx,')
    assert(tx > 0 && call > tx, `${f}: queued with tx, inside the application's transaction`)
  }
  assert(!/enqueueApplicationReceived/.test(readFileSync('app/api/vendors/[id]/route.ts', 'utf8')), 'the vendor edit route never queues it')
  assert(stubs.stubCalls.clerkUpdate === 0, '[stub] nothing reached the Clerk network')
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
