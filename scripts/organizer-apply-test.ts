/**
 * ORGANIZER SIGN-UP FORM + DRAFT EVENT + GO LIVE RULES + TERMS RECORDS (sign-up-fixes, commit 4) —
 * real routes, test DB.
 *
 *   [0] Terms and Privacy version constants match their "Effective …" lines (positive-controlled)
 *   [1] Visiting /organizer or the sign-up page creates NOTHING; only the apply route (and the two
 *       scripts) can create an organizer
 *   [2] Submitting: the organizer (trimmed email, +1 phone, website), ONE hidden DRAFT event
 *       (America/Chicago, with its FulfillmentConfig), ONE admin alert carrying the event, ONE
 *       confirmation, ONE TERMS_ACCEPTED row, the owner membership; a second submit adds nothing
 *   [3] Refusals, each creating nothing: bad phone, blank name, all-spaces email, no Terms box,
 *       end before start, start too far out or in the past, signed out, over 10 KB, over the limit
 *   [4] A vendor who applies keeps vendor access; the phone typed on the form shows in Settings
 *   [5] While pending the draft is invisible and unjoinable; the join refusal doesn't name it
 *   [6] Approve: the draft is untouched, the wizard opens it prefilled, the email button finishes it
 *       through a same-site redirect; the Approvals list and the alert show the event
 *   [7] Reject: drafts archived and their address freed; the decision email falls back to the
 *       sign-in email (organizer and vendor)
 *   [8] TERMS_ACCEPTED is never a decision: vendor status, the decision number, the latest review,
 *       the go-live approval, the pending count and the emails are all unchanged by it
 *   [9] Partners: the Terms box is required and recorded the same way
 *   [10] Go Live: DRAFT can't go live or close, a closed fair can't re-open, a pending organizer's
 *        fair can't go live; control: an approved organizer's fair reaches the checklist
 *   [11] "Application under review" lines; dashboard card; 18-month window; vendor description
 *        limit and email check; vendor and driver body cap and rate limit
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/organizer-apply-test.ts
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
import type { RateLimitState } from '../lib/ratelimit'

type Limiters = Extract<RateLimitState, { type: 'ready' }>['limiters']
/** A saved JSON field (a notification payload or an approval record's detail), read key by key. */
type Obj = Record<string, unknown>
/** The reply shape of the API routes this test calls (lib/api-response.ts). */
type ApiJson = {
  data?: { id?: string; created?: boolean; phone?: string; draft?: { name?: string; venueCity?: string; openTime?: string } }
  error?: { code?: string; message?: string; details?: { fieldErrors?: Record<string, unknown> } }
}
const readJson = async (r: Response): Promise<ApiJson | null> => (await r.json().catch(() => null)) as ApiJson | null

const prisma = testPrisma()
const PFX = 'oapp-'
const MAIL = '@oapp.local'
const rand = () => Math.random().toString(36).slice(2, 8)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const login = (clerkId: string | null, roles: string[] = []) => { (globalThis as { __MOCK_CLERK?: unknown }).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles } } : undefined }
const json = (url: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAhead = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d) }
const monthsAheadYmd = (m: number) => { const d = new Date(); d.setMonth(d.getMonth() + m); return ymd(d) }
const ADMIN = { clerkId: `${PFX}admin`, actorType: 'admin' as const, name: 'Test Admin' }

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } })
  const orgIds = [...users.map(u => `org_${u.id}`), ...(await prisma.fairOrganizer.findMany({ where: { name: { startsWith: PFX } }, select: { id: true } })).map(o => o.id)]
  const evs = await prisma.event.findMany({ where: { OR: [{ organizerId: { in: orgIds } }, { urlSlug: { startsWith: PFX } }, { name: { startsWith: PFX } }] }, select: { id: true } })
  const evIds = evs.map(e => e.id)
  const vendors = await prisma.vendor.findMany({ where: { eventId: { in: evIds } }, select: { id: true } })
  const vIds = vendors.map(v => v.id)
  const partners = await prisma.partnerOrganization.findMany({ where: { name: { startsWith: PFX } }, select: { id: true } })
  const pIds = partners.map(p => p.id)
  const appIds = [...orgIds, ...vIds, ...pIds]
  await prisma.notification.deleteMany({ where: { OR: [{ to: { endsWith: MAIL } }, ...appIds.flatMap(id => [{ dedupeKey: { contains: id } }])] } })
  await prisma.approvalAction.deleteMany({ where: { applicationId: { in: appIds } } })
  await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vIds } } })
  await prisma.vendor.deleteMany({ where: { id: { in: vIds } } })
  await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: evIds } } })
  await prisma.event.deleteMany({ where: { id: { in: evIds } } })
  await prisma.orgMember.deleteMany({ where: { organizerId: { in: orgIds } } })
  await prisma.fairOrganizer.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.partnerOrganization.deleteMany({ where: { id: { in: pIds } } })
  await prisma.runnerApplication.deleteMany({ where: { email: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  const stubs = await import('./_network-stubs'); stubs.stubClerkUsers()
  const rl = await import('../lib/ratelimit')
  const allowAll = { limit: async () => ({ success: true, limit: 5, remaining: 5, reset: Date.now() + 3600e3 }) }
  const denyAll = { limit: async () => ({ success: false, limit: 5, remaining: 0, reset: Date.now() + 3600e3 }) }
  const setLimiter = (l: unknown) => rl.__setStateForTest({ type: 'ready', limiters: new Proxy({}, { get: () => l }) as unknown as Limiters })
  setLimiter(allowAll)

  const L = await import('../lib/application-limits')
  const { WEBSITE_TERMS_VERSION, WEBSITE_TERMS_TEXT } = await import('../lib/legal/website-terms')
  const { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_TEXT } = await import('../lib/legal/privacy-policy')
  const { POST: applyPOST } = await import('../app/api/organizer/apply/route')

  const mkUser = async (extra: { phone?: string | null } = {}) =>
    prisma.user.create({ data: { clerkId: `${PFX}u-${rand()}`, email: `u-${rand()}${MAIL}`, name: 'Org Person', ...(extra.phone !== undefined ? { phone: extra.phone } : {}) } })
  const body = (over: Record<string, unknown> = {}) => ({
    organizationName: `${PFX}Board ${rand()}`, phone: '(217) 555-0134', email: `  lee-${rand()}${MAIL}  `, website: 'https://facebook.com/countyfair',
    eventName: `${PFX}County Fair ${rand()}`, city: 'Alton', state: 'il', startDate: daysAhead(30), endDate: daysAhead(32),
    openTime: '10:00', closeTime: '21:00', address: '1 Fairground Rd', agreedToTerms: true, ...over,
  })
  const apply = async (clerkId: string | null, b: unknown) => {
    login(clerkId)
    const r = await applyPOST(json('/api/organizer/apply', 'POST', b))
    const j = await readJson(r)
    return { status: r.status, code: j?.error?.code as string | undefined, message: j?.error?.message as string | undefined, data: j?.data, fieldErrors: j?.error?.details?.fieldErrors }
  }
  const counts = async (userId: string) => {
    const orgId = `org_${userId}`
    const [org, member, ev, notif, terms] = await Promise.all([
      prisma.fairOrganizer.count({ where: { id: orgId } }),
      prisma.orgMember.count({ where: { userId } }),
      prisma.event.count({ where: { organizerId: orgId } }),
      prisma.notification.count({ where: { dedupeKey: { contains: orgId } } }),
      prisma.approvalAction.count({ where: { applicationId: orgId } }),
    ])
    return { org, member, ev, notif, terms, total: org + member + ev + notif + terms }
  }

  // ── [0] versions ───────────────────────────────────────────────────────────────────────
  console.log('\n[0] Terms and Privacy versions')
  const effective = (text: string) => {
    const m = text.match(/^Effective ([A-Z][a-z]+) (\d{1,2}), (\d{4})$/m)
    if (!m) return null
    const idx = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(m[1])
    if (idx === -1) return null // not a full month name ("Nov") → no date
    return `${m[3]}-${String(idx + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  assert(effective('x\nEffective November 23, 2026\ny') === '2026-11-23' && effective('Effective Nov 23, 2026') === null, '[0] positive control: the date reader finds the right line and rejects a malformed one')
  assert(WEBSITE_TERMS_VERSION === effective(WEBSITE_TERMS_TEXT) && WEBSITE_TERMS_VERSION === '2026-11-23', `WEBSITE_TERMS_VERSION ${WEBSITE_TERMS_VERSION} matches the Terms' Effective line`)
  assert(PRIVACY_POLICY_VERSION === effective(PRIVACY_POLICY_TEXT) && PRIVACY_POLICY_VERSION === '2026-11-23', `PRIVACY_POLICY_VERSION ${PRIVACY_POLICY_VERSION} matches the Privacy Policy's Effective line`)

  // ── [1] visiting creates nothing ───────────────────────────────────────────────────────
  console.log('\n[1] Visiting creates nothing')
  const { organizerOnboardingDestination } = await import('../lib/organizer-onboarding')
  const visitor = await mkUser()
  const before = await counts(visitor.id)
  assert((await organizerOnboardingDestination(visitor.id)) === 'apply', 'a signed-in person with no organizer record is sent to the sign-up form')
  assert((await counts(visitor.id)).total === before.total && before.total === 0, 'and visiting created no organizer, membership, event, email or record')
  const src = (f: string) => readFileSync(f, 'utf8')
  for (const f of ['app/onboarding/page.tsx', 'app/onboarding/organizer/page.tsx', 'app/organizer/layout.tsx', 'lib/organizer-onboarding.ts']) {
    const s = src(f)
    assert(!/ensureOrganizerBootstrap|createFairRecord|fairOrganizer\.create|\.create\(|createMany\(/.test(s), `${f} creates nothing (no bootstrap, no create calls)`)
  }
  assert(/redirect\(ORGANIZER_APPLY_PATH\)/.test(src('app/organizer/layout.tsx')) && /redirect\('\/onboarding\/organizer'\)/.test(src('app/onboarding/page.tsx')),
    'no organizer record → the sign-up form (from /organizer and from onboarding)')
  const walk = (dir: string): string[] => (readdirSync(dir, { recursive: true }) as string[]).filter(f => /\.(ts|tsx|mjs)$/.test(f)).map(f => `${dir}/${f.replace(/\\/g, '/')}`)
  const importers = [...walk('app'), ...walk('lib'), ...walk('scripts')]
    .filter(f => !f.endsWith('-test.ts') && f !== 'lib/organizer-bootstrap.ts' && /from ['"][^'"]*organizer-bootstrap['"]|import\(['"][^'"]*organizer-bootstrap['"]\)/.test(src(f)))
  assert(JSON.stringify(importers.sort()) === JSON.stringify(['app/api/organizer/apply/route.ts', 'scripts/backfill-clerk-users.ts', 'scripts/seed-connect-walkthrough.ts']),
    `only the apply route and the two scripts can create an organizer (found: ${importers.join(', ')})`)

  // ── [2] submitting ─────────────────────────────────────────────────────────────────────
  console.log('\n[2] Submitting the form')
  const ou = await mkUser()
  const b1 = body()
  const r1 = await apply(ou.clerkId, b1)
  const orgId = `org_${ou.id}`
  const org = await prisma.fairOrganizer.findUnique({ where: { id: orgId } })
  assert(r1.status === 201 && org?.approvalStatus === 'PENDING', `201, the organizer is PENDING (got ${r1.status} ${r1.code ?? ''})`)
  assert(org?.name === b1.organizationName && org?.contactEmail === String(b1.email).trim() && org?.contactPhone === '+12175550134' && org?.website === b1.website,
    'organizer saved: name, trimmed email, +1 phone, website')
  const drafts = await prisma.event.findMany({ where: { organizerId: orgId }, include: { fulfillmentConfig: true } })
  const d = drafts[0]
  assert(drafts.length === 1 && d.status === EventStatus.DRAFT && d.archivedAt === null, 'exactly one event, a hidden DRAFT')
  assert(d?.name === b1.eventName && d.venueCity === 'Alton' && d.venueState === 'IL' && ymd(new Date(d.startDate.getTime() + d.startDate.getTimezoneOffset() * 60000)) === b1.startDate
    && d.openTime === '10:00' && d.closeTime === '21:00' && d.venueAddress === '1 Fairground Rd', 'the draft holds the event name, city, state, dates, times and address')
  assert(d?.timezone === 'America/Chicago', `the draft gets the wizard's default timezone (got ${d?.timezone})`)
  assert(!!d?.fulfillmentConfig, 'the draft has its FulfillmentConfig (so the wizard can publish it later)')
  assert(d?.listing === 'PUBLIC', 'listing is the default; nothing writes listing')
  const alert = await prisma.notification.findUnique({ where: { dedupeKey: `signup:organizer:${orgId}` } })
  const ev = (alert?.payload as Obj | undefined)?.event as Obj | undefined
  assert(!!alert && ev?.name === b1.eventName && ev?.city === 'Alton' && ev?.state === 'IL' && ev?.startDate === b1.startDate && ev?.endDate === b1.endDate,
    'one admin alert, carrying the event')
  const conf = await prisma.notification.findUnique({ where: { dedupeKey: `received:organizer:${orgId}` } })
  assert(conf?.to === String(b1.email).trim() && conf?.template === 'application_received' && (conf?.payload as Obj | undefined)?.kind === 'organizer', 'one confirmation, to the trimmed organization email')
  const terms = await prisma.approvalAction.findMany({ where: { applicationId: orgId } })
  assert(terms.length === 1 && terms[0].action === 'TERMS_ACCEPTED' && terms[0].applicationType === 'organizer' && terms[0].actorId === ou.clerkId
    && (terms[0].detail as Obj | null)?.terms === WEBSITE_TERMS_VERSION && (terms[0].detail as Obj | null)?.privacy === PRIVACY_POLICY_VERSION,
    'one TERMS_ACCEPTED record with both versions (its createdAt is the time)')
  assert((await prisma.orgMember.count({ where: { userId: ou.id, organizerId: orgId, role: 'owner' } })) === 1, 'the owner membership exists')
  const once = await counts(ou.id)
  const r2 = await apply(ou.clerkId, body())
  assert(r2.status === 200 && r2.data?.created === false && (await counts(ou.id)).total === once.total, 'a second submit creates nothing new')

  // ── [3] refusals ───────────────────────────────────────────────────────────────────────
  console.log('\n[3] Refusals create nothing')
  const refuse = async (label: string, over: Record<string, unknown>, field: string, code = 'VALIDATION_ERROR') => {
    const u = await mkUser()
    const r = await apply(u.clerkId, body(over))
    const nothing = (await counts(u.id)).total === 0
    assert(r.status === 400 && r.code === code && typeof r.fieldErrors?.[field] === 'string' && nothing, `${label} → 400 ${code} on ${field}, nothing created (got ${r.status} ${r.code})`)
  }
  await refuse('bad phone', { phone: '555-000-0000' }, 'phone')
  await refuse('blank organization name', { organizationName: '   ' }, 'organizationName')
  await refuse('all-spaces email', { email: '    ' }, 'email')
  await refuse('no Terms box', { agreedToTerms: false }, 'agreedToTerms', 'CONSENT_REQUIRED')
  await refuse('end before start', { startDate: daysAhead(10), endDate: daysAhead(9) }, 'endDate')
  await refuse('start more than 18 months out', { startDate: monthsAheadYmd(19), endDate: monthsAheadYmd(19) }, 'startDate')
  await refuse('start in the past', { startDate: daysAhead(-5), endDate: daysAhead(2) }, 'startDate')
  await refuse('bad state', { state: 'ZZ' }, 'state')
  const signedOut = await apply(null, body())
  assert(signedOut.status === 401, `signed out → 401 (got ${signedOut.status})`)
  const big = await mkUser()
  const bigR = await apply(big.clerkId, body({ address: 'x'.repeat(11 * 1024) }))
  assert(bigR.status === 413 && bigR.code === L.PAYLOAD_TOO_LARGE && (await counts(big.id)).total === 0, `over 10 KB → 413, nothing created (got ${bigR.status})`)
  setLimiter(denyAll)
  const lim = await mkUser()
  const limR = await apply(lim.clerkId, body())
  assert(limR.status === 429 && limR.code === L.APPLY_RATE_LIMITED && limR.message === L.APPLY_RATE_LIMITED_MESSAGE && (await counts(lim.id)).total === 0,
    `over the limit → 429 with "${L.APPLY_RATE_LIMITED_MESSAGE}", nothing created`)
  setLimiter(allowAll)
  assert(rl.RATE_LIMITS.organizerApply.requests === 5 && rl.RATE_LIMITS.vendorApply.requests === 10 && rl.RATE_LIMITS.runnerApply.requests === 5, 'limits: organizer 5/h, vendor 10/h, runner 5/h')

  // ── [4] a vendor applies; phone in Settings ────────────────────────────────────────────
  console.log('\n[4] A vendor who applies; the phone in Settings')
  const vEvent = await prisma.event.create({ data: { name: `${PFX}vfair`, urlSlug: `${PFX}v-${rand()}`, status: EventStatus.UPCOMING, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })
  const vu = await mkUser()
  const vend = await prisma.vendor.create({ data: { eventId: vEvent.id, name: `${PFX}Booth`, slug: `${PFX}b-${rand()}`, cuisineType: 'T', status: 'ACTIVE', vendorMembers: { create: { userId: vu.id, role: 'owner', approvalStatus: 'APPROVED' } } } })
  const vr = await apply(vu.clerkId, body())
  const { computeRolesFromDb } = await import('../lib/role-sync')
  const roles = await computeRolesFromDb(vu.id)
  assert(vr.status === 201 && (await prisma.vendorMember.count({ where: { userId: vu.id, vendorId: vend.id } })) === 1, 'the vendor membership is untouched')
  assert(roles.includes('vendor') && roles.includes('organizer'), `roles are added, never replaced (now: ${roles.join(', ')})`)
  login(ou.clerkId)
  const profile = await import('../app/api/organizer/profile/route')
  const prof = await readJson(await profile.GET(new NextRequest('http://localhost/api/organizer/profile')))
  assert(prof?.data?.phone === '+12175550134', `the phone typed on the form shows in Settings (got ${prof?.data?.phone})`)

  // ── [5] invisible while pending ────────────────────────────────────────────────────────
  console.log('\n[5] The draft stays hidden while pending')
  const { GET: fairsGET } = await import('../app/api/fairs/route')
  const fairsList = JSON.stringify(await (await fairsGET()).json())
  assert(!fairsList.includes(d.urlSlug) && !fairsList.includes(d.name), 'not on Find a Fair (/api/fairs)')
  const { GET: eventGET } = await import('../app/api/events/[slug]/route')
  const evRes = await eventGET(new Request('http://localhost/api/events/x'), { params: Promise.resolve({ slug: d.urlSlug }) })
  assert(evRes.status === 404, `not reachable by its address (/api/events/<slug> → ${evRes.status})`)
  assert(/status: EventStatus\.ACTIVE/.test(src('lib/fairs.ts')) && /notFound\(\)/.test(src('app/fair/[fairSlug]/layout.tsx')), 'the fair page and the sitemap read ACTIVE fairs only (source)')
  const joinUser = await mkUser()
  login(joinUser.clerkId)
  const { POST: vendorsPOST } = await import('../app/api/vendors/route')
  const join = await vendorsPOST(json('/api/vendors', 'POST', { eventSlug: d.urlSlug, name: `${PFX}J`, cuisineType: 'T', legalName: 'J J', agreedToVendorAgreement: true, contactPhone: '2175550134' }))
  const joinJ = await readJson(join)
  assert(join.status === 404 && joinJ?.error?.code === 'FAIR_NOT_JOINABLE', `a vendor can't join it (got ${join.status} ${joinJ?.error?.code})`)
  assert(!String(joinJ?.error?.message ?? '').includes(d.name), 'and the refusal does not name the event')
  // The gate's own message never names the fair, even if a caller hands it the name (the old gate
  // took a label and put it in the sentence; this row bites on lib/fair-join-gate.ts by itself).
  const { assertFairAcceptsJoins } = await import('../lib/fair-join-gate')
  let gateMessage = ''
  try { (assertFairAcceptsJoins as (status: EventStatus, label?: string) => void)(EventStatus.DRAFT, d.name) } catch (e) { gateMessage = (e as Error).message }
  assert(gateMessage === 'This event isn’t open for applications.', `the join gate's own message is the fixed sentence, even when given the event name (got "${gateMessage}")`)

  // ── [6] approve ────────────────────────────────────────────────────────────────────────
  console.log('\n[6] Approve')
  const { listPendingApplications, decide, rejectedDraftSlug } = await import('../lib/approvals')
  const pending = await listPendingApplications()
  const card = pending.organizers.find(o => o.id === orgId)
  assert(card?.draft?.name === d.name && card?.draft?.venueCity === 'Alton' && card?.draft?.venueState === 'IL', 'the Approvals card shows the event, city and state')
  assert(card?.termsAccepted?.terms === WEBSITE_TERMS_VERSION && card?.termsAccepted?.privacy === PRIVACY_POLICY_VERSION, 'and the Terms + Privacy acceptance')
  const N = await import('../lib/notifications')
  const alertMail = N.renderEmail('signup_admin_alert', alert!.payload)
  assert(alertMail.text.includes(`Event: ${d.name}, Alton, IL,`) && alertMail.html.includes('>Event</td>') && alertMail.html.includes('>Dates</td>'), 'the admin alert email shows the event')
  await decide('organizer', orgId, 'approve', undefined, ADMIN)
  const dAfter = await prisma.event.findUnique({ where: { id: d.id } })
  assert(dAfter?.status === EventStatus.DRAFT && dAfter.archivedAt === null && dAfter.urlSlug === d.urlSlug, 'approval leaves the draft exactly as it is')
  login(ou.clerkId)
  const draftsRoute = await import('../app/api/organizer/fairs/drafts/[fairSlug]/route')
  const dr = await readJson(await draftsRoute.GET(new NextRequest(`http://localhost/api/organizer/fairs/drafts/${d.urlSlug}`), { params: Promise.resolve({ fairSlug: d.urlSlug }) }))
  assert(dr?.data?.draft?.name === d.name && dr?.data?.draft?.venueCity === 'Alton' && dr?.data?.draft?.openTime === '10:00', 'the wizard opens the draft prefilled once approved')
  const approvedMail = await prisma.notification.findFirst({ where: { dedupeKey: `decision:organizer:${orgId}:approved` } })
  assert(approvedMail?.to === org?.contactEmail && ((approvedMail?.payload as Obj | undefined)?.draft as Obj | undefined)?.slug === d.urlSlug, 'the approval email goes to the organization email and carries the draft')
  const rendered = N.renderEmail('decision_approved', approvedMail!.payload)
  // The first link in the plain text is the button link; it ends at the line break before the footer.
  const url = rendered.text.match(/https?:\/\/\S+/)![0]
  const redirect = new URL(url).searchParams.get('redirect')
  const { safeRedirect } = await import('../lib/safe-redirect')
  assert(url.includes('redirect=%2Forganizer%2Ffairs%2Fnew%3Fdraft%3D') && redirect === `/organizer/fairs/new?draft=${d.urlSlug}`, `the button link is URL-encoded and decodes to the wizard (${redirect})`)
  assert(safeRedirect(redirect, '/organizer') === redirect && rendered.html.includes(`>Finish setting up ${d.name}</a>`), 'the login page follows it (same-site "/" path); the button says Finish setting up {event}')
  assert(safeRedirect('//evil.com', '/organizer') === '/organizer' && safeRedirect('https://evil.com', '/organizer') === '/organizer', '[0] control: //evil.com and https://evil.com fall back to /organizer')

  // ── [7] reject; email fallbacks ────────────────────────────────────────────────────────
  console.log('\n[7] Reject, and the email fallbacks')
  const ru = await mkUser()
  const rb = body()
  await apply(ru.clerkId, rb)
  const rOrg = `org_${ru.id}`
  const rDraft = (await prisma.event.findFirst({ where: { organizerId: rOrg } }))!
  await prisma.fairOrganizer.update({ where: { id: rOrg }, data: { contactEmail: '   ' } })
  await decide('organizer', rOrg, 'reject', 'Could not verify the event', ADMIN)
  const rAfter = await prisma.event.findUnique({ where: { id: rDraft.id } })
  assert(!!rAfter?.archivedAt && rAfter.urlSlug === rejectedDraftSlug(rDraft.urlSlug, rDraft.id) && rAfter.status === EventStatus.DRAFT, `the draft is archived and its address renamed (${rAfter?.urlSlug})`)
  const { uniqueEventSlug } = await import('../lib/create-fair')
  assert((await uniqueEventSlug(prisma, rDraft.urlSlug)) === rDraft.urlSlug, 'its old address is free for a new fair')
  const rMail = await prisma.notification.findFirst({ where: { dedupeKey: `decision:organizer:${rOrg}:rejected` } })
  assert(rMail?.to === ru.email, `blank organization email → the decline goes to the sign-in email (got ${rMail?.to})`)
  // Vendor: a blank form email falls back to the owner's sign-in email.
  const vu2 = await mkUser()
  login(vu2.clerkId)
  const v2 = await vendorsPOST(json('/api/vendors', 'POST', { eventSlug: vEvent.urlSlug, name: `${PFX}Booth2 ${rand()}`, cuisineType: 'T', legalName: 'Ann Lee', agreedToVendorAgreement: true, contactPhone: '2175550134', contactEmail: '  ' }))
  const v2Id = (await readJson(v2))?.data?.id as string
  const vTerms = await prisma.approvalAction.findMany({ where: { applicationId: v2Id } })

  // ── [8] TERMS_ACCEPTED is never a decision ─────────────────────────────────────────────
  console.log('\n[8] TERMS_ACCEPTED is never a decision')
  assert(vTerms.length === 1 && vTerms[0].action === 'TERMS_ACCEPTED' && !!(vTerms[0].detail as Obj | null)?.vendorAgreement && (vTerms[0].detail as Obj | null)?.terms === WEBSITE_TERMS_VERSION,
    'a vendor application records TERMS_ACCEPTED with the Terms, Privacy and Vendor Agreement versions')
  const v2Row = await prisma.vendor.findUnique({ where: { id: v2Id }, select: { status: true, termsVersion: true } })
  assert(v2Row?.status === 'PENDING' && !!v2Row.termsVersion, 'the vendor is still PENDING and its own terms columns are unchanged')
  const { latestVendorReviews } = await import('../lib/vendor-review')
  const { vendorApprovedForEvent } = await import('../lib/vendor-go-live')
  assert(!(await latestVendorReviews([v2Id], { kind: 'admin' })).has(v2Id), 'latestVendorReviews: no decision for it')
  assert((await vendorApprovedForEvent(prisma as unknown as Parameters<typeof vendorApprovedForEvent>[0], v2Id)) === false, 'vendorApprovedForEvent: still not approved')
  await decide('vendor', v2Id, 'reject', 'Missing documents', ADMIN)
  const rej = await prisma.approvalAction.findFirst({ where: { applicationId: v2Id, action: 'REJECT' } })
  const rejSeq = (rej?.detail as Obj | null | undefined)?.seq
  assert(rejSeq === 1, `the first real decision is number 1 (nextDecisionSeq ignored the Terms record; got ${String(rejSeq)})`)
  const vMail = await prisma.notification.findFirst({ where: { dedupeKey: { startsWith: `decision:vendor:${v2Id}:rejected` } } })
  assert(vMail?.to === vu2.email, `vendor: blank form email → the decision goes to the sign-in email (got ${vMail?.to})`)
  // An all-spaces address already saved on a vendor (from before the route trimmed it) must also fall
  // back to the sign-in email. The route now saves '  ' as null, so this sets the row directly.
  const vu3 = await mkUser()
  login(vu3.clerkId)
  const v3 = await vendorsPOST(json('/api/vendors', 'POST', { eventSlug: vEvent.urlSlug, name: `${PFX}Booth5 ${rand()}`, cuisineType: 'T', legalName: 'Bo Lee', agreedToVendorAgreement: true, contactPhone: '2175550134' }))
  const v3Id = (await readJson(v3))?.data?.id as string
  await prisma.vendor.update({ where: { id: v3Id }, data: { contactEmail: '   ' } })
  await decide('vendor', v3Id, 'reject', 'Missing documents', ADMIN)
  const v3Mail = await prisma.notification.findFirst({ where: { dedupeKey: { startsWith: `decision:vendor:${v3Id}:rejected` } } })
  assert(v3Mail?.to === vu3.email, `vendor: an all-spaces saved email → the decision goes to the sign-in email (got ${JSON.stringify(v3Mail?.to)})`)
  const pendingNow = await (await import('../lib/approvals')).countPendingApplications()
  const expected = (await prisma.vendor.count({ where: { status: 'PENDING', event: { archivedAt: null } } })) + (await prisma.fairOrganizer.count({ where: { approvalStatus: 'PENDING' } })) + (await prisma.partnerOrganization.count({ where: { approvalStatus: 'PENDING' } }))
  assert(pendingNow === expected, 'the pending count counts applications only, never Terms records')
  // Only WRITES count: a TERMS_ACCEPTED that sits directly inside `approvalAction.create({ data: {`
  // (a read such as the Approvals card's `where: { action: 'TERMS_ACCEPTED' }` is skipped).
  const creates: { file: string; text: string }[] = []
  for (const f of [...walk('app'), ...walk('lib')]) {
    const s = src(f)
    let i = s.indexOf("action: 'TERMS_ACCEPTED'")
    while (i !== -1) {
      const start = s.lastIndexOf('approvalAction.create(', i)
      const between = start === -1 ? '' : s.slice(start + 'approvalAction.create('.length, i)
      if (start !== -1 && /^\s*\{\s*data:\s*\{\s*$/.test(between)) creates.push({ file: f, text: s.slice(start, s.indexOf('})', i)) })
      i = s.indexOf("action: 'TERMS_ACCEPTED'", i + 1)
    }
  }
  assert(creates.length === 3 && creates.every(c => !/'APPROVE'|'REJECT'/.test(c.text)), `the 3 TERMS_ACCEPTED writes never say APPROVE or REJECT (found ${creates.length})`)
  assert(JSON.stringify(creates.map(c => c.file).sort()) === JSON.stringify(['app/api/partners/apply/route.ts', 'app/api/vendors/route.ts', 'lib/organizer-bootstrap.ts']),
    `one each, in exactly the organizer bootstrap, the vendor route and the partner route (found: ${creates.map(c => c.file).join(', ')})`)

  // ── [9] partners ───────────────────────────────────────────────────────────────────────
  console.log('\n[9] Partners: the Terms box')
  const { POST: partnerPOST } = await import('../app/api/partners/apply/route')
  const pBody = (over: Record<string, unknown> = {}) => ({ name: `${PFX}PTA ${rand()}`, groupType: 'school', contactName: 'Sam', email: `sam-${rand()}${MAIL}`, phone: '(217) 555-0134', city: 'Alton', state: 'IL', agreedToTerms: true, ...over })
  const noBox = pBody({ agreedToTerms: false })
  const pr0 = await partnerPOST(json('/api/partners/apply', 'POST', noBox, { 'x-forwarded-for': '203.0.113.70' }))
  const pj0 = await readJson(pr0)
  assert(pr0.status === 400 && typeof pj0?.error?.details?.fieldErrors?.agreedToTerms === 'string' && !(await prisma.partnerOrganization.findFirst({ where: { name: noBox.name } })),
    'without the box → 400 with the agreement field error, nothing written')
  const okP = pBody()
  const pr1 = await partnerPOST(json('/api/partners/apply', 'POST', okP, { 'x-forwarded-for': '203.0.113.70' }))
  const pRow = await prisma.partnerOrganization.findFirst({ where: { name: okP.name } })
  const pTerms = pRow ? await prisma.approvalAction.findMany({ where: { applicationId: pRow.id } }) : []
  assert(pr1.status === 201 && pTerms.length === 1 && pTerms[0].action === 'TERMS_ACCEPTED' && pTerms[0].applicationType === 'partner' && (pTerms[0].detail as Obj | null)?.privacy === PRIVACY_POLICY_VERSION,
    'with it → recorded as TERMS_ACCEPTED with both versions')
  assert(pRow?.approvalStatus === 'PENDING' && (await prisma.notification.count({ where: { dedupeKey: { contains: pRow!.id } } })) === 2, 'the partner stays PENDING; only the alert and the confirmation are queued')

  // ── [10] Go Live ───────────────────────────────────────────────────────────────────────
  console.log('\n[10] Go Live rules')
  const statusRoute = await import('../app/api/admin/events/[id]/status/route')
  login(`${PFX}super`, ['super_admin'])
  const setStatus = async (id: string, status: string) => {
    const r = await statusRoute.PATCH(json(`/api/admin/events/${id}/status`, 'PATCH', { status }), { params: Promise.resolve({ id }) })
    return { status: r.status, code: (await readJson(r))?.error?.code, message: undefined as string | undefined }
  }
  const pendOrg = await prisma.fairOrganizer.create({ data: { name: `${PFX}Pending`, contactEmail: `p${MAIL}` } })
  const apprOrg = await prisma.fairOrganizer.create({ data: { name: `${PFX}Approved`, contactEmail: `a${MAIL}`, approvalStatus: 'APPROVED' } })
  const mkEv = (status: EventStatus, organizerId: string | null) => prisma.event.create({ data: { name: `${PFX}ev`, urlSlug: `${PFX}e-${rand()}`, status, startDate: new Date(), endDate: new Date(Date.now() + 864e5), organizerId } })
  const draftEv = await mkEv(EventStatus.DRAFT, pendOrg.id)
  const g1 = await setStatus(draftEv.id, 'ACTIVE')
  const g2 = await setStatus(draftEv.id, 'INACTIVE')
  assert(g1.status === 409 && g1.code === 'FAIR_IS_DRAFT' && g2.status === 409 && g2.code === 'FAIR_IS_DRAFT', `DRAFT → ACTIVE and DRAFT → INACTIVE are refused (${g1.code}, ${g2.code})`)
  assert((await prisma.event.findUnique({ where: { id: draftEv.id } }))?.status === EventStatus.DRAFT, 'and it is still a DRAFT')
  const closed = await mkEv(EventStatus.INACTIVE, null)
  const statusSrc = src('app/api/admin/events/[id]/status/route.ts')
  const g3 = await setStatus(closed.id, 'ACTIVE')
  assert(g3.status === 409 && g3.code === 'FAIR_CLOSED' && statusSrc.includes("This fair is closed, so it can\\'t go live again. Contact FairSynq support if it was closed by mistake."),
    `a closed fair can't go live again, with the agreed sentence (${g3.code})`)
  const pendUp = await mkEv(EventStatus.UPCOMING, pendOrg.id)
  const g4 = await setStatus(pendUp.id, 'ACTIVE')
  assert(g4.status === 409 && g4.code === 'ORGANIZER_NOT_APPROVED', `a pending organizer's UPCOMING fair can't go live (${g4.code})`)
  const apprUp = await mkEv(EventStatus.UPCOMING, apprOrg.id)
  const g5 = await setStatus(apprUp.id, 'ACTIVE')
  assert(g5.code === 'GO_LIVE_CHECKLIST_FAILED', `[0] control: an approved organizer's UPCOMING fair gets past these rules to the checklist (${g5.status} ${g5.code})`)

  // ── [11] screens, window, vendor and driver limits ─────────────────────────────────────
  console.log('\n[11] Screens, the 18-month window, vendor and driver limits')
  const { organizerAwaitingLines } = await import('../lib/organizer-portal-state')
  const both = organizerAwaitingLines({ updatesTo: 'lee@x.test', draftEventName: 'County Fair' })
  assert(both[0] === "We'll email you at lee@x.test about your application." && both[1] === "Your event, County Fair, is saved. Once you're approved, you can finish setting it up. You'll be able to change these details after approval.",
    'under review: the email line and the saved-event line, word for word')
  assert(organizerAwaitingLines({ updatesTo: null, draftEventName: null }).length === 0 && organizerAwaitingLines({ updatesTo: null, draftEventName: 'X' }).length === 1,
    'with no data the screen is unchanged; each line needs its own fact')
  const layoutSrc = src('app/organizer/layout.tsx')
  assert(/awaitingLines = await organizerAwaitingLinesFor\(orgMember\.organizerId\)/.test(layoutSrc) && !/notification\./.test(layoutSrc),
    'the layout gets the lines from organizerAwaitingLinesFor and never reads the email outbox (confirmation-email-safety)')
  assert(/Finish setting up \{firstDraft\.name\}/.test(src('app/organizer/page.tsx')) && /\/organizer\/fairs\/new\?draft=\$\{encodeURIComponent\(firstDraft\.slug\)\}/.test(src('app/organizer/page.tsx')),
    'the dashboard card says Finish setting up {event} and links to the wizard with the draft')
  const C = await import('../lib/calendar-date')
  const NOW = new Date(2026, 10, 27)
  assert(C.CREATION_HORIZON_MONTHS === 18 && C.startDateInCreationWindow('2028-04-27', NOW) && !C.startDateInCreationWindow('2028-06-27', NOW) && !C.startDateInCreationWindow('2026-11-20', NOW),
    '18 months: +17 months is allowed, +19 months and last week are not')
  const vd = await mkUser()
  login(vd.clerkId)
  const vBase = { eventSlug: vEvent.urlSlug, name: `${PFX}Booth3 ${rand()}`, cuisineType: 'T', legalName: 'Ann Lee', agreedToVendorAgreement: true, contactPhone: '2175550134' }
  const vCount = () => prisma.vendor.count({ where: { eventId: vEvent.id } })
  const vc0 = await vCount()
  const long = await vendorsPOST(json('/api/vendors', 'POST', { ...vBase, description: 'x'.repeat(2001) }))
  assert(long.status === 400 && (await readJson(long))?.error?.code === L.DESCRIPTION_TOO_LONG, 'a 2,001-character description → 400 DESCRIPTION_TOO_LONG')
  const badMail = await vendorsPOST(json('/api/vendors', 'POST', { ...vBase, contactEmail: 'not-an-email' }))
  assert(badMail.status === 400 && (await readJson(badMail))?.error?.code === 'INVALID_EMAIL', 'a malformed email → 400 INVALID_EMAIL')
  const vBig = await vendorsPOST(json('/api/vendors', 'POST', { ...vBase, description: 'x'.repeat(11 * 1024) }))
  assert(vBig.status === 413, `vendor body over 10 KB → 413 (got ${vBig.status})`)
  setLimiter(denyAll)
  const vLim = await vendorsPOST(json('/api/vendors', 'POST', vBase))
  const vLimJ = await readJson(vLim)
  assert(vLim.status === 429 && vLimJ?.error?.message === L.APPLY_RATE_LIMITED_MESSAGE, 'vendor over the limit → 429 with the agreed sentence')
  setLimiter(allowAll)
  assert((await vCount()) === vc0, 'none of those wrote a vendor')
  const okDesc = await vendorsPOST(json('/api/vendors', 'POST', { ...vBase, name: `${PFX}Booth4 ${rand()}`, description: 'y'.repeat(2000) }))
  assert(okDesc.status === 201, `[0] control: exactly 2,000 characters is accepted (got ${okDesc.status})`)
  login(null)
  const { POST: driversPOST } = await import('../app/api/drivers/route')
  const dCount = () => prisma.runnerApplication.count({ where: { email: { endsWith: MAIL } } })
  const dc0 = await dCount()
  const dBig = await driversPOST(json('/api/drivers', 'POST', { personal: { firstName: 'x'.repeat(11 * 1024) } }))
  assert(dBig.status === 413, `driver body over 10 KB → 413 (got ${dBig.status})`)
  setLimiter(denyAll)
  const dLim = await driversPOST(json('/api/drivers', 'POST', { personal: { firstName: 'Dee', lastName: 'D', email: `d-${rand()}${MAIL}`, phone: '2175550134', dob: '1990-01-01' }, agreed: true, bgConsent: true }))
  const dLimJ = await readJson(dLim)
  assert(dLim.status === 429 && dLimJ?.error?.message === L.APPLY_RATE_LIMITED_MESSAGE && (await dCount()) === dc0, 'driver over the limit → 429 with the agreed sentence, nothing written')
  setLimiter(allowAll)
  const toast = src('lib/toast-error.ts')
  assert(/APPLY_RATE_LIMITED:\s+APPLY_RATE_LIMITED_MESSAGE/.test(toast) && /PAYLOAD_TOO_LARGE:\s+PAYLOAD_TOO_LARGE_MESSAGE/.test(toast) && /DESCRIPTION_TOO_LONG:\s+DESCRIPTION_TOO_LONG_MESSAGE/.test(toast),
    'pages show fixed sentences for these codes (lib/toast-error.ts)')

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
