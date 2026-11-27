/**
 * CONFIRMATION EMAIL SAFETY (confirmation-email-safety, Jordan Nov 27) — the "we got your
 * application" email can't be used to send someone's own words, or a flood, to a stranger.
 * Every sign-up form lets the applicant type the address the confirmation goes to.
 *
 *   [1] No typed name in any confirmation (vendor, partner, organizer, runner): not in the subject,
 *       the text or the html, raw or escaped, even for an old queued row that still carries one
 *   [2] The four routes queue a payload with the kind only; the applications keep their names
 *   [3] At most 3 confirmations per address per 24 hours, all kinds together, ignoring letter case and
 *       spaces; over the limit the application is saved, the reply is unchanged, no email is queued,
 *       and the log line names no address; another address is unaffected; the window moves on
 *   [4] The limit in the function itself, and its constants
 *   [5] The screens don't reveal the limit: the organizer "under review" line and the vendor success
 *       screen read the same whether or not a confirmation was queued, and name the decision address
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/confirmation-safety-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { NextRequest } from 'next/server'
import { EventStatus } from '@prisma/client'
import type { RateLimitState } from '../lib/ratelimit'

type Limiters = Extract<RateLimitState, { type: 'ready' }>['limiters']
type Obj = Record<string, unknown>
type ApiJson = { data?: { id?: string; message?: string; created?: boolean }; error?: { code?: string } }
const readJson = async (r: Response): Promise<ApiJson | null> => (await r.json().catch(() => null)) as ApiJson | null

const prisma = testPrisma()
const PFX = 'cfs-'
const MAIL = '@cfs.local'
const rand = () => Math.random().toString(36).slice(2, 8)
const HOSTILE_NAME = '<a href="https://evil.example">Claim your prize</a> at evil.example'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const login = (clerkId: string | null) => { (globalThis as { __MOCK_CLERK?: unknown }).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles: [] } } : undefined }
const json = (url: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAhead = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d) }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const confirmationsTo = (address: string) => prisma.notification.count({
  where: { template: 'application_received', to: { equals: address.trim(), mode: 'insensitive' } },
})

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } })
  const orgIds = [...users.map(u => `org_${u.id}`), ...(await prisma.fairOrganizer.findMany({ where: { name: { startsWith: PFX } }, select: { id: true } })).map(o => o.id)]
  const evs = await prisma.event.findMany({ where: { OR: [{ organizerId: { in: orgIds } }, { urlSlug: { startsWith: PFX } }] }, select: { id: true } })
  const evIds = evs.map(e => e.id)
  const vendors = await prisma.vendor.findMany({ where: { eventId: { in: evIds } }, select: { id: true } })
  const vIds = vendors.map(v => v.id)
  const partners = await prisma.partnerOrganization.findMany({ where: { name: { startsWith: PFX } }, select: { id: true } })
  const pIds = partners.map(p => p.id)
  const apps = await prisma.runnerApplication.findMany({ where: { email: { endsWith: MAIL, mode: 'insensitive' } }, select: { id: true } })
  const appIds = [...orgIds, ...vIds, ...pIds, ...apps.map(a => a.id)]
  await prisma.notification.deleteMany({ where: { OR: [{ to: { endsWith: MAIL, mode: 'insensitive' } }, ...appIds.map(id => ({ dedupeKey: { contains: id } }))] } })
  await prisma.approvalAction.deleteMany({ where: { applicationId: { in: appIds } } })
  await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vIds } } })
  await prisma.vendor.deleteMany({ where: { id: { in: vIds } } })
  await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: evIds } } })
  await prisma.event.deleteMany({ where: { id: { in: evIds } } })
  await prisma.orgMember.deleteMany({ where: { organizerId: { in: orgIds } } })
  await prisma.fairOrganizer.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.partnerOrganization.deleteMany({ where: { id: { in: pIds } } })
  await prisma.runnerApplication.deleteMany({ where: { id: { in: apps.map(a => a.id) } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  const stubs = await import('./_network-stubs'); stubs.stubClerkUsers()
  const rl = await import('../lib/ratelimit')
  const allowAll = { limit: async () => ({ success: true, limit: 5, remaining: 5, reset: Date.now() + 3600e3 }) }
  rl.__setStateForTest({ type: 'ready', limiters: new Proxy({}, { get: () => allowAll }) as unknown as Limiters })
  const T = await import('../lib/email/templates')
  const N = await import('../lib/notifications')

  // ── [1] no typed name in any confirmation ──────────────────────────────────────────────
  console.log('\n[1] No typed name in any confirmation')
  const KINDS = ['vendor', 'partner', 'organizer', 'runner'] as const
  for (const kind of KINDS) {
    for (const name of ['Taco Stand', HOSTILE_NAME]) {
      const r = T.renderEmail('application_received', { kind, name })
      const shown = [r.subject, r.text, r.html].some(s => s.includes(name) || s.includes(esc(name)))
      assert(!shown && !r.html.includes('evil.example') && !r.text.includes('evil.example'),
        `${kind}: a payload name (${name === HOSTILE_NAME ? 'a hostile link' : `"${name}"`}) appears nowhere in the email, raw or escaped`)
    }
    const r = T.renderEmail('application_received', { kind })
    assert(r.text.startsWith(`Thanks for applying. We got your ${kind} application and FairSynq is reviewing it now.`), `${kind}: starts "Thanks for applying. We got your ${kind} application…"`)
  }
  assert(T.renderEmail('application_received', { kind: 'vendor', name: 'X' }).text === T.renderEmail('application_received', { kind: 'vendor' }).text,
    'an old queued row with a name renders exactly like a new one without')

  // ── [2] the routes queue the kind only ─────────────────────────────────────────────────
  console.log('\n[2] The four routes queue the kind only')
  const payloadOf = async (key: string) => (await prisma.notification.findUnique({ where: { dedupeKey: key } }))?.payload as Obj | undefined

  const { POST: partnerPOST } = await import('../app/api/partners/apply/route')
  const partnerBody = (email: string, name = `${PFX}PTA ${rand()}`) =>
    ({ name, groupType: 'school', contactName: 'Sam', email, phone: '(217) 555-0134', city: 'Alton', state: 'IL', agreedToTerms: true })
  const applyPartner = async (email: string) => {
    const b = partnerBody(email)
    const r = await partnerPOST(json('/api/partners/apply', 'POST', b, { 'x-forwarded-for': '203.0.113.90' }))
    const row = await prisma.partnerOrganization.findFirst({ where: { name: b.name }, select: { id: true, name: true } })
    return { status: r.status, body: await readJson(r), id: row?.id, name: row?.name }
  }

  const { POST: driversPOST } = await import('../app/api/drivers/route')
  const applyRunner = async (email: string) => {
    login(null)
    const first = `${PFX}Dee${rand()}`
    const r = await driversPOST(json('/api/drivers', 'POST', {
      personal: { firstName: first, lastName: 'Driver', email, phone: '(217) 555-0134', dob: '1990-01-01', city: 'Alton' },
      agreed: true, bgConsent: true, termsVersion: 'test',
    }, { 'x-forwarded-for': '203.0.113.91' }))
    const row = await prisma.runnerApplication.findFirst({ where: { firstName: first }, select: { id: true, firstName: true } })
    return { status: r.status, body: await readJson(r), id: row?.id, name: row?.firstName }
  }

  const event = await prisma.event.create({ data: { name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: EventStatus.UPCOMING, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })
  const { POST: vendorsPOST } = await import('../app/api/vendors/route')
  const applyVendor = async (contactEmail: string) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'V' } })
    login(u.clerkId)
    const r = await vendorsPOST(json('/api/vendors', 'POST', {
      eventSlug: event.urlSlug, name: `${PFX}Booth ${rand()}`, cuisineType: 'Tacos', legalName: 'Jane Smith',
      agreedToVendorAgreement: true, contactEmail, contactPhone: '(217) 555-0134',
    }))
    const body = await readJson(r)
    const row = body?.data?.id ? await prisma.vendor.findUnique({ where: { id: body.data.id }, select: { id: true, name: true } }) : null
    return { status: r.status, body, id: row?.id, name: row?.name }
  }

  const { POST: organizerApplyPOST } = await import('../app/api/organizer/apply/route')
  const applyOrganizer = async (email: string) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}ou-${rand()}`, email: `ou-${rand()}${MAIL}`, name: 'O' } })
    login(u.clerkId)
    const organizationName = `${PFX}Board ${rand()}`
    const r = await organizerApplyPOST(json('/api/organizer/apply', 'POST', {
      organizationName, phone: '(217) 555-0134', email, website: 'https://facebook.com/countyfair', eventName: `${PFX}County Fair ${rand()}`,
      city: 'Alton', state: 'IL', startDate: daysAhead(30), endDate: daysAhead(32), openTime: '10:00', closeTime: '21:00',
      address: '1 Fairground Rd', agreedToTerms: true,
    }))
    const row = await prisma.fairOrganizer.findUnique({ where: { id: `org_${u.id}` }, select: { id: true, name: true } })
    return { status: r.status, body: await readJson(r), id: row?.id, name: row?.name }
  }

  const pA = await applyPartner(`p-${rand()}${MAIL}`)
  const rA = await applyRunner(`r-${rand()}${MAIL}`)
  const vA = await applyVendor(`v-${rand()}${MAIL}`)
  const oA = await applyOrganizer(`o-${rand()}${MAIL}`)
  for (const [kind, a] of [['partner', pA], ['runner', rA], ['vendor', vA], ['organizer', oA]] as const) {
    const p = a.id ? await payloadOf(`received:${kind}:${a.id}`) : undefined
    assert(a.status === 201 && JSON.stringify(p) === JSON.stringify({ kind }), `${kind}: 201 and the queued payload is { kind: '${kind}' } only (got ${a.status} ${JSON.stringify(p)})`)
    assert(!!a.name && a.name.startsWith(PFX), `${kind}: the application itself still keeps its typed name`)
  }

  // ── [3] the per-address limit, through the real routes ─────────────────────────────────
  console.log('\n[3] At most 3 confirmations per address per day, all kinds together')
  const base = `lim-${rand()}${MAIL}`
  const one = await applyPartner(base)                       // the partner route lower-cases
  const two = await applyRunner(base.toUpperCase())          // the runner route keeps the case
  const three = await applyVendor(`  ${base.replace('lim', 'Lim')}  `)  // the vendor route trims
  assert([one, two, three].every(a => a.status === 201) && (await confirmationsTo(base)) === 3,
    `three applications of three kinds to one address (any case, spaces around) all get their email (count ${await confirmationsTo(base)})`)

  const warns: string[] = []
  const realWarn = console.warn
  console.warn = (...args: unknown[]) => { warns.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')) }
  const four = await (async () => { try { return await applyRunner(base) } finally { console.warn = realWarn } })()
  const fourRow = four.id ? await prisma.runnerApplication.findUnique({ where: { id: four.id }, select: { email: true } }) : null
  assert(four.status === 201 && !!fourRow, 'a 4th application to that address is still saved (201)')
  assert((await confirmationsTo(base)) === 3 && (four.id ? (await prisma.notification.count({ where: { dedupeKey: `received:runner:${four.id}` } })) === 0 : false),
    'and no 4th confirmation is queued')
  assert(four.body?.data?.message === rA.body?.data?.message && four.body?.data?.id !== undefined && four.body?.error === undefined,
    'the reply is the same as a normal one (nobody learns the address hit the limit)')
  const limitLine = warns.find(w => w.includes('address limit reached'))
  assert(!!limitLine && !limitLine.toLowerCase().includes(base.toLowerCase()) && !limitLine.includes('@'),
    `one warning is logged and it names no address (${limitLine ? 'found, no address in it' : 'not found'})`)

  const five = await applyVendor(base)
  assert(five.status === 201 && (await confirmationsTo(base)) === 3, 'a 5th, of another kind, is saved and also gets no email')

  const other = `other-${rand()}${MAIL}`
  const otherApp = await applyRunner(other)
  assert(otherApp.status === 201 && (await confirmationsTo(other)) === 1, '[0] control: another address still gets its confirmation')

  await prisma.notification.updateMany({
    where: { template: 'application_received', to: { equals: base, mode: 'insensitive' } },
    data: { createdAt: new Date(Date.now() - N.CONFIRMATION_WINDOW_MS - 3600e3) },
  })
  const later = await applyRunner(base)
  assert(later.status === 201 && (later.id ? (await prisma.notification.count({ where: { dedupeKey: `received:runner:${later.id}` } })) === 1 : false),
    'once the earlier three are more than 24 hours old, a new application gets its email again')

  // ── [4] the function itself ────────────────────────────────────────────────────────────
  console.log('\n[4] The limit in enqueueApplicationReceived')
  assert(N.CONFIRMATIONS_PER_ADDRESS_PER_DAY === 3 && N.CONFIRMATION_WINDOW_MS === 24 * 3600e3, 'the limit is 3 per address per 24 hours')
  const direct = `direct-${rand()}${MAIL}`
  for (let i = 0; i < 5; i++) await N.enqueueApplicationReceived(prisma, `${PFX}direct-${i}-${rand()}`, i % 2 ? direct.toUpperCase() : ` ${direct} `, { kind: 'vendor' })
  assert((await confirmationsTo(direct)) === 3, `five calls for five applications to one address queue exactly 3 (got ${await confirmationsTo(direct)})`)
  await N.enqueueApplicationReceived(prisma, `${PFX}blank-${rand()}`, '   ', { kind: 'vendor' })
  assert((await prisma.notification.count({ where: { dedupeKey: { startsWith: `received:vendor:${PFX}blank-` } } })) === 0, 'a blank address still queues nothing')

  // ── [5] the screens don't reveal the limit ─────────────────────────────────────────────
  console.log("\n[5] The screens read the same whether or not a confirmation was queued")
  const { organizerAwaitingLinesFor } = await import('../lib/organizer-onboarding')
  const { organizerDecisionAddress } = await import('../lib/organizer-portal-state')
  const oAEmail = (await prisma.fairOrganizer.findUnique({ where: { id: oA.id ?? '' }, select: { contactEmail: true } }))?.contactEmail ?? ''
  const oLimited = await applyOrganizer(direct)   // `direct` already has 3 confirmations today
  const queued = oA.id ? await prisma.notification.count({ where: { dedupeKey: `received:organizer:${oA.id}` } }) : -1
  const held = oLimited.id ? await prisma.notification.count({ where: { dedupeKey: `received:organizer:${oLimited.id}` } }) : -1
  assert(oLimited.status === 201 && queued === 1 && held === 0, `setup: one organizer got its confirmation, the other was held back by the limit (queued ${queued}, held ${held})`)
  const linesQueued = oA.id ? await organizerAwaitingLinesFor(oA.id) : []
  const linesHeld = oLimited.id ? await organizerAwaitingLinesFor(oLimited.id) : []
  assert(linesQueued[0] === `We'll email you at ${oAEmail} about your application.` && linesHeld[0] === `We'll email you at ${direct} about your application.`,
    `both organizers see "We'll email you at {their address} about your application." (got "${linesQueued[0]}" / "${linesHeld[0]}")`)
  assert(linesQueued.length === linesHeld.length && linesQueued[0].replace(oAEmail, 'X') === linesHeld[0].replace(direct, 'X'),
    'the two screens are identical apart from the address: nothing shows whether an email was queued')
  assert(organizerDecisionAddress('  ', 'owner@x.test') === 'owner@x.test' && organizerDecisionAddress(' org@x.test ', 'owner@x.test') === 'org@x.test',
    'the line names the decision address: the organization email, or the owner sign-in email when it is blank')
  const { readFileSync } = await import('node:fs')
  assert(/const to = organizerDecisionAddress\(org\.contactEmail, org\.members\[0\]\?\.user\.email\)/.test(readFileSync('lib/approvals.ts', 'utf8')),
    'the organizer decision email uses the same rule (lib/approvals.ts)')
  const onboardingSrc = readFileSync('lib/organizer-onboarding.ts', 'utf8')
  assert(!/notification/i.test(onboardingSrc.slice(onboardingSrc.indexOf('export async function organizerAwaitingLinesFor'))),
    'organizerAwaitingLinesFor never reads the email outbox')
  const vendorSrc = readFileSync('app/become-vendor/VendorOnboarding.tsx', 'utf8')
  assert(/We&apos;ll email you at <span className="text-white">\{data\.email\}<\/span> about your application\./.test(vendorSrc) && !/Confirmation sent to/.test(vendorSrc),
    'vendor success screen: "We\'ll email you at {email} about your application." and no "Confirmation sent to"')
  // The screen names the typed email; that is the decision address only because the wizard can't be
  // sent with a blank one (a blank one would fall back to the sign-in email in lib/approvals.ts).
  assert(/case 1: return !!\([^\n]*data\.email\.trim\(\)/.test(vendorSrc),
    'pin: vendor step 1 still requires a non-blank email, so the screen never names a blank address')

  rl.__resetForTest()
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
