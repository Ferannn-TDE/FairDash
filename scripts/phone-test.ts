/**
 * PHONE CHECK (sign-up-fixes, commit 1) — lib/phone.ts and every route that saves a vendor,
 * partner or organizer phone. Real routes, test DB.
 *
 *   [1] The rule: 9 digits and 555-000-0000 are refused; "+1 (217) 555-0134", "217.555.0134" and
 *       "2175550134" are accepted and become +12175550134; the message is verbatim; an unchanged
 *       stored number passes untouched; lib/settings uses the same function
 *   [2] POST /api/vendors: a bad, blank or missing phone → 400 INVALID_PHONE with the message and no
 *       vendor written; each good format is saved as +12175550134
 *   [3] POST /api/partners/apply: a bad phone → the phone field error, nothing written; each good
 *       format is saved as +12175550134
 *   [4] PATCH /api/organizer/profile: a bad phone → 400 and nothing changes; an unchanged number is
 *       not copied anywhere; a good one lands in FairOrganizer.contactPhone (User.phone untouched);
 *       GET shows contactPhone, else the sign-in phone; an older-format stored number still saves
 *   [5] PATCH /api/user/preferences: the same rule for the sign-in phone
 *   [6] Wiring: the browser screens and all four routes use lib/phone; the INVALID_PHONE toast is
 *       the exact message
 *
 * Every server check is made with no browser in front of it: the routes are called directly.
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/phone-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { EventStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'phn-'
const MAIL = '@phn.local'
const GOOD = '+12175550134'
const GOOD_FORMATS = ['+1 (217) 555-0134', '217.555.0134', '2175550134']
const rand = () => Math.random().toString(36).slice(2, 8)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const login = (clerkId: string | null) => { (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles: [] } } : undefined }
const json = (url: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const evIds = evs.map(e => e.id)
  if (evIds.length) {
    const vendors = await prisma.vendor.findMany({ where: { eventId: { in: evIds } }, select: { id: true } })
    await prisma.notification.deleteMany({ where: { dedupeKey: { in: vendors.map(v => `signup:vendor:${v.id}`) } } })
    await prisma.vendorMember.deleteMany({ where: { vendor: { eventId: { in: evIds } } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: evIds } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: evIds } } })
    await prisma.event.deleteMany({ where: { id: { in: evIds } } })
  }
  const partners = await prisma.partnerOrganization.findMany({ where: { contactEmail: { endsWith: MAIL } }, select: { id: true } })
  await prisma.notification.deleteMany({ where: { dedupeKey: { in: partners.map(p => `signup:partner:${p.id}`) } } })
  await prisma.partnerOrganization.deleteMany({ where: { id: { in: partners.map(p => p.id) } } })
  const orgs = await prisma.fairOrganizer.findMany({ where: { name: { startsWith: PFX } }, select: { id: true } })
  await prisma.orgMember.deleteMany({ where: { organizerId: { in: orgs.map(o => o.id) } } })
  await prisma.fairOrganizer.deleteMany({ where: { id: { in: orgs.map(o => o.id) } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  // No network: the vendor route's role sync calls Clerk, which is stubbed (scripts/_network-stubs.ts).
  const stubs = await import('./_network-stubs'); stubs.stubClerkUsers()
  const P = await import('../lib/phone')

  // ── [1] the rule ───────────────────────────────────────────────────────────────────────
  console.log('\n[1] The rule (lib/phone)')
  assert(P.PHONE_ERROR === 'Enter a 10-digit US phone number, like (217) 555-0134.', 'the message is verbatim')
  for (const bad of ['217555013', '555-000-0000']) {
    const c = P.checkPhone(bad, { required: true })
    assert(!c.ok && c.error === P.PHONE_ERROR, `"${bad}" is refused with the message`)
  }
  for (const good of GOOD_FORMATS) {
    const c = P.checkPhone(good, { required: true })
    assert(c.ok && c.value === GOOD, `"${good}" → ${GOOD}`)
  }
  assert(P.normalizeUsPhone('1 217 555 0134') === GOOD, '11 digits starting with 1: the 1 is dropped')
  assert(P.normalizeUsPhone('2171555013') === null, 'an exchange starting with 1 is refused')
  const blankReq = P.checkPhone('   ', { required: true })
  assert(!blankReq.ok && blankReq.error === P.PHONE_ERROR, 'blank is refused when the phone is required')
  const blankOpt = P.checkPhone('', { required: false })
  assert(blankOpt.ok && blankOpt.value === null, '[0] control: blank is allowed when the phone is optional')
  assert(!P.checkPhone(2175550134, { required: true }).ok, 'a number that is not text is refused')
  const kept = P.checkPhone(' 618-555-01 ', { required: false, previous: '618-555-01' })
  assert(kept.ok && kept.unchanged && kept.value === '618-555-01', 'an unchanged stored number (older format) passes untouched')
  assert(!P.checkPhone('618-555-02', { required: false, previous: '618-555-01' }).ok, '[0] control: a changed number is checked')
  const settingsLib = await import('../lib/settings')
  assert(settingsLib.normalizeUsPhone === P.normalizeUsPhone, 'the admin alerts.phone setting uses the same function')

  // ── [2] vendor sign-up ─────────────────────────────────────────────────────────────────
  console.log('\n[2] POST /api/vendors')
  const { POST: vendorsPOST } = await import('../app/api/vendors/route')
  const event = await prisma.event.create({
    data: { name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: EventStatus.UPCOMING, startDate: new Date(), endDate: new Date(Date.now() + 864e5) },
  })
  const applyVendor = async (phone: { contactPhone?: unknown }) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'V' } })
    login(u.clerkId)
    const r = await vendorsPOST(json('/api/vendors', 'POST', {
      eventSlug: event.urlSlug, name: `${PFX}Booth ${rand()}`, cuisineType: 'Tacos', legalName: 'Jane Smith',
      agreedToVendorAgreement: true, contactEmail: `v-${rand()}${MAIL}`, ...phone,
    }) as any)
    const j: any = await r.json()
    return { status: r.status, code: j?.error?.code as string | undefined, message: j?.error?.message as string | undefined, id: j?.data?.id as string | undefined }
  }
  const countVendors = () => prisma.vendor.count({ where: { eventId: event.id } })
  const v0 = await countVendors()
  const BAD_VENDOR: Array<[string, { contactPhone?: unknown }]> = [
    ['9 digits', { contactPhone: '217555013' }], ['555-000-0000', { contactPhone: '555-000-0000' }],
    ['blank', { contactPhone: '  ' }], ['missing', {}],
  ]
  for (const [label, phone] of BAD_VENDOR) {
    const r = await applyVendor(phone)
    assert(r.status === 400 && r.code === 'INVALID_PHONE' && r.message === P.PHONE_ERROR, `${label} → 400 INVALID_PHONE with the message (got ${r.status} ${r.code})`)
  }
  assert((await countVendors()) === v0, 'none of the refused applications wrote a vendor')
  for (const good of GOOD_FORMATS) {
    const r = await applyVendor({ contactPhone: good })
    const row = r.id ? await prisma.vendor.findUnique({ where: { id: r.id }, select: { contactPhone: true } }) : null
    assert(r.status === 201 && row?.contactPhone === GOOD, `"${good}" → 201, saved as ${GOOD} (got ${r.status}, ${row?.contactPhone})`)
  }

  // ── [3] partner application ────────────────────────────────────────────────────────────
  console.log('\n[3] POST /api/partners/apply')
  // Always-allow limiter: the route's rate limit is covered in partner-application-test.
  const rl = await import('../lib/ratelimit')
  const allowAll = { limit: async () => ({ success: true, limit: 3, remaining: 3, reset: Date.now() + 3600e3 }) }
  rl.__setStateForTest({ type: 'ready', limiters: new Proxy({}, { get: () => allowAll }) as any })
  const { POST: partnerPOST } = await import('../app/api/partners/apply/route')
  const applyPartner = async (phone: string) => {
    const email = `p-${rand()}${MAIL}`
    const r = await partnerPOST(json('/api/partners/apply', 'POST',
      { name: `${PFX}PTA`, groupType: 'school', contactName: 'Pat', email, phone, city: 'Alton', state: 'IL', agreedToTerms: true },
      { 'x-forwarded-for': '203.0.113.50' }))
    return { status: r.status, body: (await r.json()) as any, email }
  }
  const countPartners = () => prisma.partnerOrganization.count({ where: { contactEmail: { endsWith: MAIL } } })
  const p0 = await countPartners()
  for (const bad of ['217555013', '555-000-0000']) {
    const r = await applyPartner(bad)
    assert(r.status === 400 && r.body?.error?.details?.fieldErrors?.phone === P.PHONE_ERROR, `"${bad}" → 400 with the phone field error (got ${r.status})`)
  }
  assert((await countPartners()) === p0, 'nothing was written for the refused applications')
  for (const good of GOOD_FORMATS) {
    const r = await applyPartner(good)
    const row = await prisma.partnerOrganization.findFirst({ where: { contactEmail: r.email }, select: { contactPhone: true } })
    assert(r.status === 201 && row?.contactPhone === GOOD, `"${good}" → 201, saved as ${GOOD} (got ${r.status}, ${row?.contactPhone})`)
  }
  rl.__resetForTest()

  // ── [4] organizer settings ─────────────────────────────────────────────────────────────
  console.log('\n[4] /api/organizer/profile')
  const profile = await import('../app/api/organizer/profile/route')
  const ou = await prisma.user.create({ data: { clerkId: `${PFX}ou-${rand()}`, email: `ou-${rand()}${MAIL}`, name: 'O', phone: '+16185550100' } })
  const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}Org`, contactEmail: ou.email } })
  await prisma.orgMember.create({ data: { organizerId: org.id, userId: ou.id, role: 'owner' } })
  login(ou.clerkId)
  const getProfile = async () => ((await (await profile.GET(new NextRequest('http://localhost/api/organizer/profile') as any)).json()) as any).data
  const patchProfile = async (body: unknown) => {
    const r = await profile.PATCH(json('/api/organizer/profile', 'PATCH', body) as any)
    const j: any = await r.json()
    return { status: r.status, code: j?.error?.code as string | undefined, message: j?.error?.message as string | undefined, data: j?.data }
  }
  const orgPhone = async () => (await prisma.fairOrganizer.findUnique({ where: { id: org.id }, select: { contactPhone: true } }))?.contactPhone
  const userPhone = async () => (await prisma.user.findUnique({ where: { id: ou.id }, select: { phone: true } }))?.phone
  assert((await getProfile())?.phone === '+16185550100', 'GET: contactPhone is blank → shows the sign-in phone')
  const badO = await patchProfile({ name: 'O', phone: '555-000-0000', organizationName: `${PFX}Org` })
  assert(badO.status === 400 && badO.code === 'INVALID_PHONE' && badO.message === P.PHONE_ERROR, `a bad phone → 400 INVALID_PHONE with the message (got ${badO.status} ${badO.code})`)
  assert((await orgPhone()) === null && (await userPhone()) === '+16185550100', 'and nothing changed')
  const sameO = await patchProfile({ name: 'O2', phone: '+16185550100', organizationName: `${PFX}Org` })
  const renamed = await prisma.user.findUnique({ where: { id: ou.id }, select: { name: true } })
  assert(sameO.status === 200 && (await orgPhone()) === null && renamed?.name === 'O2', 'the shown number sent back unchanged is not copied; the rest of the save goes through')
  const goodO = await patchProfile({ name: 'O2', phone: '(217) 555-0134', organizationName: `${PFX}Org` })
  assert(goodO.status === 200 && goodO.data?.phone === GOOD && (await orgPhone()) === GOOD, `a good phone is saved to FairOrganizer.contactPhone as ${GOOD}`)
  assert((await userPhone()) === '+16185550100', 'the sign-in phone (User.phone) is untouched')
  assert((await getProfile())?.phone === GOOD, 'GET now shows FairOrganizer.contactPhone')
  await prisma.fairOrganizer.update({ where: { id: org.id }, data: { contactPhone: '618-555-01' } })
  const keepO = await patchProfile({ name: 'O2', phone: '618-555-01', organizationName: `${PFX}Org` })
  assert(keepO.status === 200 && (await orgPhone()) === '618-555-01', 'an older-format stored number sent back unchanged still saves, untouched')
  const clearO = await patchProfile({ name: 'O2', phone: '', organizationName: `${PFX}Org` })
  assert(clearO.status === 200 && (await orgPhone()) === null, 'a blank phone clears contactPhone (the phone is optional in Settings)')

  // ── [5] preferences ────────────────────────────────────────────────────────────────────
  console.log('\n[5] PATCH /api/user/preferences')
  const prefs = await import('../app/api/user/preferences/route')
  const pu = await prisma.user.create({ data: { clerkId: `${PFX}pu-${rand()}`, email: `pu-${rand()}${MAIL}`, name: 'P', phone: '618-555-01' } })
  login(pu.clerkId)
  const patchPrefs = async (body: unknown) => {
    const r = await prefs.PATCH(json('/api/user/preferences', 'PATCH', body) as any)
    const j: any = await r.json()
    return { status: r.status, code: j?.error?.code as string | undefined, message: j?.error?.message as string | undefined }
  }
  const prefsPhone = async () => (await prisma.user.findUnique({ where: { id: pu.id }, select: { phone: true } }))?.phone
  const badP = await patchPrefs({ phone: '217555013' })
  assert(badP.status === 400 && badP.code === 'INVALID_PHONE' && badP.message === P.PHONE_ERROR && (await prefsPhone()) === '618-555-01', 'a bad phone → 400 INVALID_PHONE with the message, nothing changed')
  const sameP = await patchPrefs({ phone: '618-555-01', notifNewOrder: true })
  const notif = await prisma.user.findUnique({ where: { id: pu.id }, select: { notifNewOrder: true } })
  assert(sameP.status === 200 && (await prefsPhone()) === '618-555-01' && notif?.notifNewOrder === true, 'the stored number sent back unchanged is left as it is; the switch still saves')
  const goodP = await patchPrefs({ phone: '217.555.0134' })
  assert(goodP.status === 200 && (await prefsPhone()) === GOOD, `a good phone is saved as ${GOOD}`)
  const onlySwitch = await patchPrefs({ notifDailySummary: true })
  assert(onlySwitch.status === 200 && (await prefsPhone()) === GOOD, '[0] control: a save without a phone leaves the phone alone')

  // ── [6] wiring ─────────────────────────────────────────────────────────────────────────
  console.log('\n[6] One rule everywhere')
  const read = (p: string) => readFileSync(p, 'utf8')
  const wizard = read('app/become-vendor/VendorOnboarding.tsx')
  assert(/from '@\/lib\/phone'/.test(wizard) && /case 1: return[^\n]*checkPhone\(data\.phone, \{ required: true \}\)\.ok/.test(wizard),
    'vendor step 1 cannot continue without a valid phone (same helper)')
  assert(/from '@\/lib\/phone'/.test(read('lib/partner-application.ts')) && !/validatePhone/.test(read('lib/partner-application.ts')),
    'the partner form and route share lib/phone (no runner phone rule left)')
  assert(/checkPhone\(phone, \{ required: false, previous: profile\?\.phone \?\? null \}\)/.test(read('app/organizer/settings/page.tsx')),
    'organizer Settings checks the phone before saving')
  for (const route of ['app/api/vendors/route.ts', 'app/api/organizer/profile/route.ts', 'app/api/user/preferences/route.ts']) {
    assert(/import \{ checkPhone, INVALID_PHONE \} from '@\/lib\/phone'/.test(read(route)), `${route} uses lib/phone`)
  }
  assert(/INVALID_PHONE:\s+PHONE_ERROR,/.test(read('lib/toast-error.ts')), 'the INVALID_PHONE toast is the exact message')
  assert(stubs.stubCalls.clerkUpdate === 0, '[stub] the role sync never reached the network')
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
