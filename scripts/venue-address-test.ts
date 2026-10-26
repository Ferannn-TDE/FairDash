/**
 * VENUE ADDRESS — no real fair reaches customers without a full address (street, city, state,
 * ZIP). Customers need it, and Google's event results require it (lib/seo.ts never invents one).
 *
 *   [1] parseVenueAddress: what passes, what is refused, how it is cleaned
 *   [2] organizer create, through the real POST handler on the test DB: publish refused without a
 *       full address (and nothing written), a draft saved without one, a full one stored cleaned
 *   [3] draft publish, through the real PATCH handler: refused without an address (still a draft),
 *       re-saving the draft allowed, publishing with one promotes it
 *   [4] the admin Go Live checklist: everything else passing, the address alone decides canGoLive
 *   [5] the admin create route refuses ACTIVE (it would skip the whole checklist)
 *   [6] wiring: the wizard has all four inputs required and runs the same check before publishing
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/venue-address-test.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
process.env.UPSTASH_REDIS_REST_URL = process.env.TEST_UPSTASH_URL ?? 'http://localhost:58080'
process.env.UPSTASH_REDIS_REST_TOKEN = 'fairsynq-test-token'

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { parseVenueAddress, hasVenueAddress } from '../lib/venue-address'

const prisma = testPrisma()
const PFX = 'vat-'
const rand = () => Math.random().toString(36).slice(2, 10)
let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')

const FULL = { venueAddress: '125 W Main St', venueCity: 'Collinsville', venueState: 'IL', venueZip: '62234' }
const DATES = { startDate: '2027-03-01', endDate: '2027-03-03' }

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    await prisma.vendor.deleteMany({ where: { id: { in: vs.map(v => v.id) } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { startsWith: PFX } } })
  await prisma.user.deleteMany({ where: { clerkId: { startsWith: PFX } } })
}

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function main() {
  console.log('[1] parseVenueAddress')
  const ok = parseVenueAddress({ venueAddress: '  125  W Main St ', venueCity: 'Collinsville ', venueState: ' il', venueZip: '62234-1234' })
  assert(ok.ok && JSON.stringify(ok.value) === JSON.stringify({ venueAddress: '125 W Main St', venueCity: 'Collinsville', venueState: 'IL', venueZip: '62234-1234' }), 'full address → cleaned (spaces collapsed, state upper-cased, ZIP+4 kept)')
  const cases: [string, Record<string, unknown>, string][] = [
    ['no street', { ...FULL, venueAddress: '  ' }, 'street address'],
    ['no city', { ...FULL, venueCity: undefined }, 'city'],
    ['no state', { ...FULL, venueState: '' }, 'state'],
    ['bad state', { ...FULL, venueState: 'Illinois' }, 'state (2-letter code'],
    ['made-up state', { ...FULL, venueState: 'ZZ' }, 'state (2-letter code'],
    ['no ZIP', { ...FULL, venueZip: '' }, 'ZIP'],
    ['short ZIP', { ...FULL, venueZip: '6223' }, 'ZIP (5 digits)'],
    ['letters in ZIP', { ...FULL, venueZip: '6223A' }, 'ZIP (5 digits)'],
    ['non-string', { ...FULL, venueCity: 42 }, 'city'],
  ]
  for (const [name, input, want] of cases) {
    const r = parseVenueAddress(input)
    assert(!r.ok && r.problems.some(p => p.startsWith(want)) && r.message.includes(want), `${name} → refused, names "${want}"`)
  }
  const all = parseVenueAddress({})
  assert(!all.ok && all.problems.length === 4, 'nothing → all four named in one message')
  assert(hasVenueAddress(FULL) && !hasVenueAddress({ ...FULL, venueZip: null }), 'hasVenueAddress agrees')
  assert(!hasVenueAddress({ venueAddress: 'eef', venueCity: 'x', venueState: 'IL', venueZip: '' }), 'production\'s test fair shape (street "eef", empty ZIP) → not live-ready')

  await cleanup()
  // An approved organizer, signed in through the Clerk mock. Every check below is real route code.
  const clerkId = `${PFX}${rand()}`
  const user = await prisma.user.create({ data: { clerkId, email: `${clerkId}@vat.local`, name: 'Venue Test', role: 'organizer' } })
  const org = await prisma.fairOrganizer.create({ data: { name: 'Venue Test Org', contactEmail: `${PFX}${rand()}@vat.local`, approvalStatus: 'APPROVED' } })
  await prisma.orgMember.create({ data: { organizerId: org.id, userId: user.id, role: 'owner' } })
  ;(globalThis as Record<string, unknown>).__MOCK_CLERK = { userId: clerkId }
  const { POST: createFair } = await import('../app/api/organizer/fairs/route')
  const { PATCH: editDraft } = await import('../app/api/organizer/fairs/drafts/[fairSlug]/route')
  const create = async (body: Record<string, unknown>) => {
    const res = await createFair(new NextRequest('http://localhost/api/organizer/fairs', json(body)))
    return { status: res.status, body: await res.json() as any }
  }
  const countOrg = () => prisma.event.count({ where: { organizerId: org.id } })

  console.log('\n[2] organizer create')
  // Control: the probe can create at all (a full address → 201), so the refusals below are real.
  const good = await create({ name: 'Venue Fest', slug: `${PFX}good-${rand()}`, ...DATES, ...FULL, venueState: 'il', venueAddress: ' 125 W Main St ' })
  assert(good.status === 201 && good.body.data?.status === 'UPCOMING', `control: full address → published (HTTP ${good.status})`)
  const stored = good.body.data ? await prisma.event.findUnique({ where: { id: good.body.data.id }, select: { venueAddress: true, venueState: true, venueZip: true } }) : null
  assert(stored?.venueAddress === '125 W Main St' && stored?.venueState === 'IL' && stored?.venueZip === '62234', 'stored cleaned')
  const before = await countOrg()
  const noZip = await create({ name: 'No Zip Fest', slug: `${PFX}nozip-${rand()}`, ...DATES, ...FULL, venueZip: '' })
  assert(noZip.status === 400 && /ZIP/.test(noZip.body.error?.message ?? ''), `publish without ZIP → 400 naming ZIP (${noZip.body.error?.message})`)
  const noAddr = await create({ name: 'No Address Fest', slug: `${PFX}noaddr-${rand()}`, ...DATES })
  assert(noAddr.status === 400 && /street address, city, state, ZIP/.test(noAddr.body.error?.message ?? ''), 'publish with no address → 400 naming all four')
  assert(await countOrg() === before, 'a refused publish writes nothing')
  const draft = await create({ name: 'Draft Fest', slug: `${PFX}draft-${rand()}`, ...DATES, asDraft: true })
  assert(draft.status === 201 && draft.body.data?.status === 'DRAFT', 'a draft saves without an address')

  console.log('\n[3] draft publish')
  const slug = draft.body.data?.urlSlug as string
  const patch = async (body: Record<string, unknown>) => {
    const res = await editDraft(new NextRequest(`http://localhost/api/organizer/fairs/drafts/${slug}`, { ...json(body), method: 'PATCH' }), { params: Promise.resolve({ fairSlug: slug }) })
    return { status: res.status, body: await res.json() as any }
  }
  const resave = await patch({ name: 'Draft Fest', ...DATES, venueCity: 'Collinsville' })
  assert(resave.status === 200 && resave.body.data?.status === 'DRAFT', 're-saving the draft without a full address is fine')
  const pubBad = await patch({ name: 'Draft Fest', ...DATES, ...FULL, venueState: 'XX', publish: true })
  assert(pubBad.status === 400 && /state/.test(pubBad.body.error?.message ?? ''), 'publish with a bad state → 400')
  assert((await prisma.event.findUnique({ where: { urlSlug: slug }, select: { status: true } }))?.status === 'DRAFT', 'still a draft after the refusal')
  const pubOk = await patch({ name: 'Draft Fest', ...DATES, ...FULL, publish: true })
  assert(pubOk.status === 200 && pubOk.body.data?.status === 'UPCOMING', 'publish with a full address → UPCOMING')

  console.log('\n[4] admin Go Live checklist')
  const { getGoLiveChecklist, GO_LIVE_KEYS } = await import('../lib/go-live-checklist')
  // Everything else on the checklist passing: an active, Stripe-verified vendor, booth pickup on, coordinates.
  const ev = await prisma.event.create({ data: { name: 'Go Live Fest', urlSlug: `${PFX}golive-${rand()}`, status: 'UPCOMING', startDate: new Date(DATES.startDate), endDate: new Date(DATES.endDate), eventLat: 38.67, eventLng: -89.98, fulfillmentConfig: { create: { boothPickupEnabled: true } } } })
  await prisma.vendor.create({ data: { eventId: ev.id, name: `${PFX}booth`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE', stripeVerified: true } })
  const fairOf = async () => prisma.event.findUniqueOrThrow({ where: { id: ev.id }, select: { eventLat: true, eventLng: true, venueAddress: true, venueCity: true, venueState: true, venueZip: true } })
  const without = await getGoLiveChecklist(ev.id, await fairOf())
  const others = GO_LIVE_KEYS.filter(k => k !== 'hasVenueAddress').every(k => without[k])
  assert(others, 'control: every other check passes for this fair')
  assert(!without.hasVenueAddress && !without.canGoLive, 'no address → hasVenueAddress false, cannot go live')
  assert((GO_LIVE_KEYS as readonly string[]).includes('hasVenueAddress'), 'hasVenueAddress is a Go Live key (the 409 names it)')
  await prisma.event.update({ where: { id: ev.id }, data: FULL })
  const withAddr = await getGoLiveChecklist(ev.id, await fairOf())
  assert(withAddr.hasVenueAddress && withAddr.canGoLive, 'full address → can go live')

  console.log('\n[5] admin create cannot skip Go Live')
  const { POST: adminCreate } = await import('../app/api/events/route')
  ;(globalThis as Record<string, unknown>).__MOCK_CLERK = { userId: `${PFX}admin`, publicMetadata: { roles: ['admin'] } }
  const asActive = await adminCreate(new Request('http://localhost/api/events', json({ name: 'Bypass', urlSlug: `${PFX}bypass-${rand()}`, ...DATES, status: 'ACTIVE' })))
  assert(asActive.status === 400, `status ACTIVE → 400 (HTTP ${asActive.status})`)
  const asUpcoming = await adminCreate(new Request('http://localhost/api/events', json({ name: 'Plain', urlSlug: `${PFX}plain-${rand()}`, ...DATES })))
  assert(asUpcoming.status === 201, `control: no status → created UPCOMING (HTTP ${asUpcoming.status})`)

  console.log('\n[6] wiring')
  const wizard = strip(readFileSync('app/organizer/fairs/new/page.tsx', 'utf8'))
  for (const [name, ac] of [['address', 'address-line1'], ['city', 'address-level2'], ['state', 'address-level1'], ['zip', 'postal-code']])
    assert(new RegExp(`name="${name}"[^\\n]*required[^\\n]*autoComplete="${ac}"`).test(wizard), `wizard: ${name} input is required, autocomplete ${ac}`)
  assert(/if \(!asDraft\) \{\s*const venue = parseVenueAddress\([^\n]*\)\s*if \(!venue\.ok\) \{ toast\.error\(venue\.message\); setStep\(1\); return \}/.test(wizard) && wizard.indexOf('parseVenueAddress(') < wizard.indexOf('setSubmitting(true)'), 'wizard: the same check runs before publishing, not before a draft save')
  const dash = readFileSync('app/admin/[eventSlug]/dashboard/page.tsx', 'utf8')
  assert(/pass: checklist\.hasVenueAddress/.test(dash), 'admin dashboard lists the address in the Go Live checklist')
  for (const f of ['app/api/admin/events/[id]/status/route.ts', 'app/api/admin/events/[id]/dashboard/route.ts'])
    assert(/getGoLiveChecklist\(event\.id, event\)/.test(readFileSync(f, 'utf8')), `${f.split('/').slice(-2).join('/')} passes the resolved fair (with its venue)`)
  assert(/venueZip: true/.test(readFileSync('lib/admin-fair-context.ts', 'utf8')), 'the admin fair context selects the venue fields')
}

main()
  .catch(err => { console.error(err); fail++ })
  .finally(async () => {
    await cleanup().catch(e => console.error('cleanup failed', e))
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} venue-address: ${pass} passed, ${fail} failed`)
    process.exit(fail === 0 ? 0 : 1)
  })
