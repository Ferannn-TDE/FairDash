/**
 * HOME DELIVERY BEHIND A PLATFORM SWITCH (Batch 1 item 6, B1.2) — real handlers, test DB.
 *
 * Only Clerk identity and next/cache are mocked (scripts/_route-loader.mjs). Each refusal has a
 * positive control showing the same call gets past the gate once delivery is on.
 *
 *   [1] deliveryAvailable / effectiveFulfillment / turnsDeliveryOn truth tables (null config too)
 *   [2] POST /api/orders: HOME_DELIVERY refused while off, passes the gate when on; a fair with NO
 *       config offers booth pickup only (the old `if (config)` hole), even with delivery on
 *   [3] POST /api/orders/delivery-check: same pair
 *   [4] admin fulfillment PATCH: can't switch delivery ON while off; keeping an old true flag or
 *       switching it off is allowed; on → gets past the switch
 *   [5] organizer create + [6] organizer draft PATCH: same rules
 *   [7] the settings page's "these events start offering delivery" list
 *   [8] fair data + go-live checklist use the gated value
 *   [9] copy guard: every customer-visible "deliver" word sits on an allowlist with a reason
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/delivery-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST
process.env.ENFORCE_VENDOR_READINESS = 'false'
// No network: the order route's radius check would call Google; the fixtures have no coordinates.
process.env.GOOGLE_MAPS_SERVER_KEY = ''

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { NextRequest } from 'next/server'
import { EventStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'dlv-'
const MAIL = '@dlv.local'
const rand = () => Math.random().toString(36).slice(2, 8)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const login = (clerkId: string | null, roles: string[] = []) => {
  (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles } } : undefined
}
const req = (url: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method, headers: { 'Content-Type': 'application/json' },
  body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
})
async function call(p: Promise<Response>) {
  const r = await p
  const j: any = await r.json().catch(() => ({}))
  return { status: r.status, code: j?.error?.code as string | undefined, data: j?.data }
}
async function setPlatformDelivery(on: boolean) {
  if (on) {
    await prisma.platformSetting.upsert({
      where: { key: 'delivery.enabled' },
      create: { key: 'delivery.enabled', value: true, updatedAt: new Date(), updatedById: `${PFX}t`, updatedByType: 'super_admin' },
      update: { value: true, updatedAt: new Date() },
    })
  } else {
    await prisma.platformSetting.deleteMany({ where: { key: 'delivery.enabled' } })
  }
}
function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) { const q = join(dir, n); statSync(q).isDirectory() ? walk(q, out) : out.push(q) }
  return out
}

async function cleanup() {
  await prisma.platformSetting.deleteMany({ where: { key: 'delivery.enabled' } })
  const evs = await prisma.event.findMany({ where: { OR: [{ urlSlug: { startsWith: PFX } }, { name: { startsWith: PFX } }] }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  const delivery = await import('../lib/delivery')

  // ── [1] truth tables ───────────────────────────────────────────────────────────────────
  console.log('\n[1] deliveryAvailable, effectiveFulfillment, turnsDeliveryOn')
  const on = { homeDeliveryEnabled: true }, off = { homeDeliveryEnabled: false }
  assert(delivery.deliveryAvailable(true, on) === true, 'platform on + event on → available')
  assert(delivery.deliveryAvailable(false, on) === false, 'platform off + event on → NOT available')
  assert(delivery.deliveryAvailable(true, off) === false, 'platform on + event off → not available')
  assert(delivery.deliveryAvailable(true, null) === false && delivery.deliveryAvailable(true, undefined) === false, 'no config → never available')
  const none = delivery.effectiveFulfillment(true, null)
  assert(none.boothPickupEnabled && !none.curbsideEnabled && !none.homeDeliveryEnabled, 'no config → booth pickup only (not "everything on")')
  const eff = delivery.effectiveFulfillment(false, { boothPickupEnabled: true, curbsideEnabled: true, homeDeliveryEnabled: true })
  assert(eff.curbsideEnabled && eff.boothPickupEnabled && !eff.homeDeliveryEnabled, 'platform off leaves booth + curbside alone, removes delivery')
  assert(delivery.turnsDeliveryOn(true, false) && delivery.turnsDeliveryOn(true, null), 'true over false/none = switching ON')
  assert(!delivery.turnsDeliveryOn(true, true) && !delivery.turnsDeliveryOn(false, true) && !delivery.turnsDeliveryOn(undefined, false),
    'keeping an existing true, switching off, or not sending it = not switching on')
  assert((await delivery.isDeliveryEnabled()) === false, 'with no saved setting, the platform switch reads OFF (default)')

  // ── fixtures ───────────────────────────────────────────────────────────────────────────
  const now = Date.now()
  const live = { startDate: new Date(now - 864e5), endDate: new Date(now + 3 * 864e5) }
  const orgEmail = `org-${rand()}${MAIL}`
  const orgUser = await prisma.user.create({ data: { clerkId: `${PFX}org-${rand()}`, email: orgEmail, name: 'Org' } })
  const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}org`, contactEmail: orgEmail, approvalStatus: 'APPROVED' } })
  await prisma.orgMember.create({ data: { organizerId: org.id, userId: orgUser.id, role: 'owner' } })
  const mkEvent = (tag: string, fc: { boothPickupEnabled: boolean; curbsideEnabled: boolean; homeDeliveryEnabled: boolean } | null, status: EventStatus = EventStatus.ACTIVE) =>
    prisma.event.create({
      data: {
        name: `${PFX}${tag}`, urlSlug: `${PFX}${tag}-${rand()}`, status, organizerId: org.id, ...live,
        ...(fc ? { fulfillmentConfig: { create: fc } } : {}),
      },
    })
  const deliveryFair = await mkEvent('delivery', { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: true })
  const noConfigFair = await mkEvent('noconfig', null)
  const customer = await prisma.user.create({ data: { clerkId: `${PFX}cust-${rand()}`, email: `cust-${rand()}${MAIL}`, name: 'C' } })

  // ── [2] orders ─────────────────────────────────────────────────────────────────────────
  console.log('\n[2] POST /api/orders')
  const ordersPOST = (await import('../app/api/orders/route')).POST
  const order = (eventId: string, fulfillmentType: string) => {
    login(customer.clerkId)
    return call(ordersPOST(req('/api/orders', 'POST', {
      eventId, fulfillmentType, customerName: 'C', customerPhone: '6185550100',
      vehicleMake: 'Honda', vehicleColor: 'Blue',
      deliveryStreet: '1 Main St', deliveryCity: 'Springfield', deliveryState: 'IL', deliveryZip: '62701',
      items: [{ menuItemId: `${PFX}nope`, vendorId: `${PFX}nope`, quantity: 1 }],
    }) as any))
  }
  const pastGate = (o: { code?: string }) => o.code !== 'FULFILLMENT_DISABLED'
  await setPlatformDelivery(false)
  const offDel = await order(deliveryFair.id, 'HOME_DELIVERY')
  assert(offDel.status === 409 && offDel.code === 'FULFILLMENT_DISABLED', `platform off: HOME_DELIVERY at a delivery fair → 409 FULFILLMENT_DISABLED (got ${offDel.status} ${offDel.code})`)
  const offBooth = await order(deliveryFair.id, 'BOOTH_PICKUP')
  assert(pastGate(offBooth), `platform off: booth pickup at the same fair gets past the gate (stopped later at ${offBooth.code})`)
  await setPlatformDelivery(true)
  const onDel = await order(deliveryFair.id, 'HOME_DELIVERY')
  assert(pastGate(onDel), `[0] control: platform on: the same HOME_DELIVERY order gets past the gate (stopped later at ${onDel.status} ${onDel.code})`)
  const ncDel = await order(noConfigFair.id, 'HOME_DELIVERY'), ncCurb = await order(noConfigFair.id, 'CURBSIDE'), ncBooth = await order(noConfigFair.id, 'BOOTH_PICKUP')
  assert(ncDel.code === 'FULFILLMENT_DISABLED' && ncCurb.code === 'FULFILLMENT_DISABLED',
    `no-config fair refuses HOME_DELIVERY and CURBSIDE even with delivery on (got ${ncDel.code} / ${ncCurb.code}) — the old hole is closed`)
  assert(pastGate(ncBooth), `[0] control: no-config fair still takes booth pickup past the gate (stopped later at ${ncBooth.code})`)

  // ── [3] delivery-check ────────────────────────────────────────────────────────────────
  console.log('\n[3] POST /api/orders/delivery-check')
  const checkPOST = (await import('../app/api/orders/delivery-check/route')).POST
  const check = () => { login(customer.clerkId); return call(checkPOST(req('/api/orders/delivery-check', 'POST', { eventId: deliveryFair.id, street: '1 Main St', city: 'Springfield', state: 'IL', zip: '62701' }) as any)) }
  await setPlatformDelivery(false)
  const cOff = await check()
  assert(cOff.status === 409 && cOff.code === 'FULFILLMENT_DISABLED', `platform off → 409 FULFILLMENT_DISABLED (got ${cOff.status} ${cOff.code})`)
  await setPlatformDelivery(true)
  const cOn = await check()
  assert(cOn.code !== 'FULFILLMENT_DISABLED', `[0] control: platform on → gets past the switch (got ${cOn.status} ${cOn.code})`)

  // ── [4] admin fulfillment ──────────────────────────────────────────────────────────────
  console.log('\n[4] Admin fulfillment PATCH')
  const fulfillPATCH = (await import('../app/api/admin/events/[id]/fulfillment/route')).PATCH
  const patchFulfil = (id: string, body: object) => { login(`${PFX}super`, ['super_admin']); return call(fulfillPATCH(req(`/api/admin/events/${id}/fulfillment`, 'PATCH', body), { params: Promise.resolve({ id }) })) }
  const offFair = await mkEvent('offfair', { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: false })
  const flagOf = async (id: string) => (await prisma.fulfillmentConfig.findUnique({ where: { eventId: id } }))?.homeDeliveryEnabled
  await setPlatformDelivery(false)
  const aOn = await patchFulfil(offFair.id, { homeDeliveryEnabled: true })
  assert(aOn.status === 409 && aOn.code === 'DELIVERY_OFF_PLATFORM', `platform off: switching delivery ON → 409 DELIVERY_OFF_PLATFORM (got ${aOn.status} ${aOn.code})`)
  assert((await flagOf(offFair.id)) === false, 'and the flag stayed off')
  const aKeep = await patchFulfil(deliveryFair.id, { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: true, runnerFeePercent: 0 })
  assert(aKeep.status === 200, `platform off: an unrelated save that keeps an old true flag → 200 (got ${aKeep.status} ${aKeep.code})`)
  const aOff = await patchFulfil(deliveryFair.id, { homeDeliveryEnabled: false })
  assert(aOff.status === 200 && (await flagOf(deliveryFair.id)) === false, `platform off: switching delivery OFF → 200 (got ${aOff.status})`)
  await setPlatformDelivery(true)
  const aOnOk = await patchFulfil(offFair.id, { homeDeliveryEnabled: true })
  assert(aOnOk.code !== 'DELIVERY_OFF_PLATFORM', `[0] control: platform on: the same switch-on gets past the platform gate (got ${aOnOk.status} ${aOnOk.code})`)

  // ── [5] organizer create ───────────────────────────────────────────────────────────────
  console.log('\n[5] Organizer create')
  const createPOST = (await import('../app/api/organizer/fairs/route')).POST
  const create = (deliveryEnabled: boolean) => {
    login(orgUser.clerkId)
    return call(createPOST(req('/api/organizer/fairs', 'POST', {
      name: `${PFX}new ${rand()}`, startDate: '2027-06-01', endDate: '2027-06-03', asDraft: true, deliveryEnabled, pickupEnabled: true,
    }) as any))
  }
  await setPlatformDelivery(false)
  const oOn = await create(true), oOff = await create(false)
  assert(oOn.status === 409 && oOn.code === 'DELIVERY_OFF_PLATFORM', `platform off: create with delivery → 409 DELIVERY_OFF_PLATFORM (got ${oOn.status} ${oOn.code})`)
  assert(oOff.status === 201, `[0] control: platform off: create without delivery → 201 (got ${oOff.status} ${oOff.code})`)
  await setPlatformDelivery(true)
  const oOnOk = await create(true)
  assert(oOnOk.status === 201, `[0] control: platform on: create with delivery → 201 (got ${oOnOk.status} ${oOnOk.code})`)

  // ── [6] organizer draft PATCH ─────────────────────────────────────────────────────────
  console.log('\n[6] Organizer draft PATCH')
  const draftPATCH = (await import('../app/api/organizer/fairs/drafts/[fairSlug]/route')).PATCH
  const draftOff = await mkEvent('draft-off', { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: false }, EventStatus.DRAFT)
  const draftOn = await mkEvent('draft-on', { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: true }, EventStatus.DRAFT)
  const saveDraft = (slug: string, deliveryEnabled: boolean) => {
    login(orgUser.clerkId)
    return call(draftPATCH(req(`/api/organizer/fairs/drafts/${slug}`, 'PATCH', { name: `${PFX}draft`, startDate: '2027-06-01', endDate: '2027-06-03', deliveryEnabled, pickupEnabled: true }) as any, { params: Promise.resolve({ fairSlug: slug }) }))
  }
  await setPlatformDelivery(false)
  const dOn = await saveDraft(draftOff.urlSlug, true)
  assert(dOn.status === 409 && dOn.code === 'DELIVERY_OFF_PLATFORM', `platform off: a draft switching delivery ON → 409 (got ${dOn.status} ${dOn.code})`)
  const dKeep = await saveDraft(draftOn.urlSlug, true)
  assert(dKeep.status === 200, `platform off: a draft that already had delivery keeps it on save → 200 (got ${dKeep.status} ${dKeep.code})`)
  await setPlatformDelivery(true)
  const dOnOk = await saveDraft(draftOff.urlSlug, true)
  assert(dOnOk.status === 200, `[0] control: platform on: the same draft switch-on → 200 (got ${dOnOk.status} ${dOnOk.code})`)

  // ── [7] settings warning list ─────────────────────────────────────────────────────────
  // A fair whose own delivery flag is on (set directly: [4] proved writes can't do it while off).
  const onFair = await mkEvent('onfair', { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: true })

  console.log('\n[7] "These events start offering delivery" list')
  const archived = await mkEvent('archived', { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: true })
  await prisma.event.update({ where: { id: archived.id }, data: { archivedAt: new Date() } })
  const listed = new Set((await delivery.listEventsWithDeliveryOn()).map(e => e.slug))
  assert(listed.has(onFair.urlSlug), '[0] control: an event with its delivery flag on is listed')
  assert(!listed.has(deliveryFair.urlSlug) && !listed.has(noConfigFair.urlSlug), 'events with the flag off, or no config, are not listed')
  assert(!listed.has(archived.urlSlug) && !listed.has(draftOn.urlSlug), 'archived events and drafts are not listed')
  const settingsGET = (await import('../app/api/admin/settings/route')).GET
  login(`${PFX}super`, ['super_admin'])
  const sg = await call(settingsGET(req('/api/admin/settings') as any))
  assert(Array.isArray(sg.data?.deliveryEventsOn) && sg.data.deliveryEventsOn.some((e: any) => e.slug === onFair.urlSlug), 'GET /api/admin/settings returns that list for the page')

  // ── [8] fair data + go-live ───────────────────────────────────────────────────────────
  console.log('\n[8] Fair data and the go-live checklist')
  const fairs = await import('../lib/fairs')
  await setPlatformDelivery(false)
  assert((await fairs.getFairBySlugCached(onFair.urlSlug))?.fulfillmentConfig?.homeDeliveryEnabled === false, 'platform off: a delivery-on fair sends homeDeliveryEnabled = false to checkout')
  assert((await fairs.getFairSeoBySlugCached(onFair.urlSlug))?.fulfillment?.homeDeliveryEnabled === false, 'platform off: its SEO description data says no delivery either')
  const nc = (await fairs.getFairBySlugCached(noConfigFair.urlSlug))?.fulfillmentConfig
  assert(!!nc && nc.boothPickupEnabled && !nc.curbsideEnabled && !nc.homeDeliveryEnabled, 'a no-config fair sends booth-pickup-only flags, never null')
  const { getGoLiveChecklist } = await import('../lib/go-live-checklist')
  const onlyDelivery = await mkEvent('onlydel', { boothPickupEnabled: false, curbsideEnabled: false, homeDeliveryEnabled: true }, EventStatus.UPCOMING)
  const fairArgs = { eventLat: null, eventLng: null, venueAddress: null, venueCity: null, venueState: null, venueZip: null }
  assert((await getGoLiveChecklist(onlyDelivery.id, fairArgs)).hasFulfillmentMode === false, 'platform off: a delivery-only fair has no fulfillment mode for Go Live')
  await setPlatformDelivery(true)
  assert((await fairs.getFairBySlugCached(onFair.urlSlug))?.fulfillmentConfig?.homeDeliveryEnabled === true, '[0] control: platform on: the same fair sends homeDeliveryEnabled = true')
  assert((await getGoLiveChecklist(onlyDelivery.id, fairArgs)).hasFulfillmentMode === true, '[0] control: platform on: delivery counts as its fulfillment mode')

  // ── [9] copy guard ─────────────────────────────────────────────────────────────────────
  console.log('\n[9] Copy guard: customer-visible "deliver" words')
  // Customer-facing app code only (operator portals and API routes are out of scope). Whole words
  // only, so identifiers like homeDeliveryEnabled / HOME_DELIVERY / deliveryStreet don't count.
  const WORD = /\b(deliver|delivers|delivered|delivering|delivery|deliveries)\b/gi
  const OPERATOR = /^app\/(admin|organizer|vendor|runner|api)\//
  const countWords = (text: string) => text.split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
    .reduce((n, l) => n + (l.match(WORD)?.length ?? 0), 0)
  // Every remaining hit, file by file, with the exact count and why it stays. A NEW mention, even
  // in a listed file, changes the count and fails.
  const ALLOW: Record<string, { count: number; why: string }> = {
    'app/MarketplaceLanding.tsx': { count: 2, why: 'runner card "Deliver with FairSynq" — replaced by the partner card in item 7 (B1.8)' },
    'app/sign-in/runner/page.tsx': { count: 2, why: 'runner sign-in copy — runner/partner rework, item 7' },
    'app/become-driver/layout.tsx': { count: 1, why: 'runner application metadata — runner/partner rework, item 7' },
    'app/become-driver/page.tsx': { count: 9, why: 'runner wizard + Driver Terms — runner rework (item 7) and legal pages (item 11)' },
    'app/_components/faq-content.ts': { count: 4, why: 'runner + organizer FAQ answers — rewritten with the runner/partner rework (item 7)' },
    'app/refund-policy/page.tsx': { count: 4, why: 'refund policy — replaced in full by the legal pages (item 11)' },
    'app/become-vendor/VendorOnboarding.tsx': { count: 1, why: 'Vendor Agreement text — legal pages (item 11)' },
    'app/fair/[fairSlug]/checkout/page.tsx': { count: 10, why: 'the Home Delivery option, its address/area sections and fee label (render only when delivery is offered or chosen), plus an import and the delivery-check URL' },
    'app/account/orders/[orderId]/page.tsx': { count: 5, why: 'existing delivery orders: fee label + address (HOME_DELIVERY only); the DELIVERED status token (curbside handoff state, stays); an import' },
    'app/fair/[fairSlug]/order/[orderId]/page.tsx': { count: 1, why: 'the DELIVERED status token in the terminal-status set (curbside handoff state, stays)' },
    'app/account/settings/page.tsx': { count: 1, why: '"Default Delivery Address", rendered only while the platform delivery switch is on' },
    'app/_components/AddressAutocomplete.tsx': { count: 2, why: 'import path + placeholder of the address field used only by delivery checkout' },
    'app/_components/usePlatformDelivery.ts': { count: 1, why: 'code: the /api/platform/delivery fetch URL' },
  }
  const files = walk(join(process.cwd(), 'app')).filter(f => /\.(ts|tsx)$/.test(f))
    .map(f => ({ path: relative(process.cwd(), f).split(sep).join('/'), text: readFileSync(f, 'utf8') }))
    .filter(f => !OPERATOR.test(f.path))
  assert(countWords("label: 'Delivery Fee'") === 1 && countWords('title: "We deliver to your door"') === 1, '[0] positive control: the counter sees "Delivery" and "deliver" in strings')
  assert(countWords('const homeDeliveryEnabled = x; type T = "HOME_DELIVERY"; deliveryStreet') === 0 && countWords('// we deliver here') === 0,
    '[0] baseline: identifiers and comment lines are not counted')
  const unexpected: string[] = []
  for (const f of files) {
    const n = countWords(f.text)
    const allow = ALLOW[f.path]
    if (n === 0 && !allow) continue
    if (!allow) unexpected.push(`${f.path}: ${n} new mention(s), not on the allowlist`)
    else if (n !== allow.count) unexpected.push(`${f.path}: ${n} mention(s), allowlist says ${allow.count} (${allow.why})`)
  }
  for (const [p, a] of Object.entries(ALLOW)) if (!files.some(f => f.path === p)) unexpected.push(`${p}: on the allowlist but the file is gone`)
  for (const u of unexpected) console.log(`     ↳ ${u}`)
  assert(unexpected.length === 0, 'every customer-visible delivery word is on the allowlist, at its exact count')
  const meta = readFileSync('app/page.tsx', 'utf8')
  assert(meta.includes("'FairSynq | Skip-the-Line Ordering for Fairs & Festivals'") && meta.includes("'Order fair food from your phone and pick it up at the booth or curbside. Free for vendors.'"),
    'homepage metadata uses the client\'s exact title and description')
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
