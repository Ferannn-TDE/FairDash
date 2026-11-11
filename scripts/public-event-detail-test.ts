/**
 * PUBLIC EVENT DETAIL — audit M6, end to end against the test DB.
 *
 * Calls the real GET /api/events/[slug] handler, signed out, for a live fair whose internal
 * columns are ALL filled in (operator Stripe account, organizer, GPS boundaries, staging and
 * curbside zones, runner fee split, listing...). The response must carry exactly the approved
 * keys and none of the internal ones. The control proves those columns really were set in the
 * database, so "absent from the response" cannot pass on a row that never had them.
 *
 * scripts/public-event-select-guard.ts pins the select statically; this suite proves what
 * actually leaves the server.
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/public-event-detail-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { NextRequest } from 'next/server'
import { CurbsideMethod, EventListing, EventStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'pevt-'
const MAIL = '@pevt.local'
const rand = () => Math.random().toString(36).slice(2, 8)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

const APPROVED_EVENT_KEYS = [
  'id', 'name', 'urlSlug', 'description', 'status', 'primaryColor', 'startDate', 'endDate',
  'serviceChargeEnabled', 'serviceChargeAmount', 'admissionFree', 'openTime', 'closeTime',
  'fulfillmentConfig', '_count',
]
const APPROVED_FULFILLMENT_KEYS = [
  'boothPickupEnabled', 'curbsideEnabled', 'homeDeliveryEnabled', 'homeDeliveryFee', 'curbsideFee',
  'curbsideZoneDescription',
]
const FORBIDDEN_EVENT_KEYS = [
  'operatorStripeAccountId', 'statementName', 'organizerId', 'gpsBoundaries',
  'stagingZoneLat', 'stagingZoneLng', 'listing',
]
const FORBIDDEN_FULFILLMENT_KEYS = [
  'runnerFeePercent', 'runnerTipsOnlyAck', 'curbsideZoneLat', 'curbsideZoneLng', 'curbsideMethod',
  'homeDeliveryRadiusKm', 'runnerTransportDescription',
]

const sorted = (keys: string[]) => JSON.stringify([...keys].sort())

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  console.log('\n══ PUBLIC EVENT DETAIL (M6) ══')

  // ── seed: a live fair with every internal column set ────────────────────────────────────────
  const org = await prisma.fairOrganizer.create({
    data: { name: `${PFX}org`, contactEmail: `org-${rand()}${MAIL}`, approvalStatus: 'APPROVED' },
  })
  const now = Date.now()
  const event = await prisma.event.create({
    data: {
      name: `${PFX}Fair`,
      urlSlug: `${PFX}${rand()}`,
      status: EventStatus.ACTIVE,
      // UNLISTED is still reachable by direct URL when ACTIVE, and is not the default, so a
      // leaked `listing` would carry a real, non-default value.
      listing: EventListing.UNLISTED,
      startDate: new Date(now - 86_400_000),
      endDate: new Date(now + 86_400_000),
      description: 'A test fair',
      openTime: '10:00',
      closeTime: '22:00',
      serviceChargeEnabled: true,
      serviceChargeAmount: 1.5,
      operatorStripeAccountId: 'acct_pevt_operator',
      statementName: 'PEVT FAIR',
      organizerId: org.id,
      gpsBoundaries: [[38.1, -89.1], [38.2, -89.1], [38.2, -89.2]],
      stagingZoneLat: 38.15,
      stagingZoneLng: -89.15,
      fulfillmentConfig: {
        create: {
          boothPickupEnabled: true,
          curbsideEnabled: true,
          homeDeliveryEnabled: true,
          homeDeliveryFee: 6,
          curbsideFee: 3,
          curbsideZoneDescription: 'North lot, Row A',
          curbsideZoneLat: 38.16,
          curbsideZoneLng: -89.16,
          curbsideMethod: CurbsideMethod.RUNNER_DELIVERS,
          runnerFeePercent: 70,
          runnerTipsOnlyAck: true,
          homeDeliveryRadiusKm: 12,
          runnerTransportDescription: 'Golf cart',
        },
      },
    },
  })

  // ── [0] control: the internal columns really are set in the database ─────────────────────────
  console.log('\n[0] control: every internal column is set on the seeded row')
  const row = await prisma.event.findUnique({ where: { id: event.id }, include: { fulfillmentConfig: true } })
  const unsetEvent = FORBIDDEN_EVENT_KEYS.filter(k => (row as Record<string, unknown> | null)?.[k] == null)
  const unsetFc = FORBIDDEN_FULFILLMENT_KEYS.filter(k => (row?.fulfillmentConfig as Record<string, unknown> | null)?.[k] == null)
  assert(unsetEvent.length === 0, `every forbidden Event column is non-null in the DB (unset: [${unsetEvent.join(', ')}])`)
  assert(unsetFc.length === 0, `every forbidden FulfillmentConfig column is non-null in the DB (unset: [${unsetFc.join(', ')}])`)

  // ── [1] call the real handler, signed out ───────────────────────────────────────────────────
  console.log('\n[1] GET /api/events/[slug], signed out')
  ;(globalThis as { __MOCK_CLERK?: unknown }).__MOCK_CLERK = undefined
  const { GET } = await import('../app/api/events/[slug]/route')
  type Body = { data?: Record<string, unknown> & {
    fulfillmentConfig?: Record<string, unknown>
    _count?: Record<string, unknown>
  } }
  const call = async (slug: string) => {
    const r = await GET(new NextRequest(`http://localhost/api/events/${slug}`), { params: Promise.resolve({ slug }) })
    return { status: r.status, body: (await r.json()) as Body }
  }

  for (const [label, key] of [['by slug', event.urlSlug], ['by raw id', event.id]] as const) {
    const { status, body } = await call(key)
    const data = body?.data ?? {}
    assert(status === 200 && data.id === event.id, `${label}: 200 and the seeded fair (got ${status})`)
    assert(sorted(Object.keys(data)) === sorted(APPROVED_EVENT_KEYS),
      `${label}: Event keys are exactly the approved list + _count (got ${Object.keys(data).sort().join(', ')})`)
    assert(sorted(Object.keys(data.fulfillmentConfig ?? {})) === sorted(APPROVED_FULFILLMENT_KEYS),
      `${label}: fulfillmentConfig keys are exactly the approved list (got ${Object.keys(data.fulfillmentConfig ?? {}).sort().join(', ')})`)
    const leakedEvent = FORBIDDEN_EVENT_KEYS.filter(k => k in data)
    const leakedFc = FORBIDDEN_FULFILLMENT_KEYS.filter(k => k in (data.fulfillmentConfig ?? {}))
    assert(leakedEvent.length === 0, `${label}: no forbidden Event column (leaked: [${leakedEvent.join(', ')}])`)
    assert(leakedFc.length === 0, `${label}: no forbidden FulfillmentConfig column (leaked: [${leakedFc.join(', ')}])`)
    const text = JSON.stringify(body)
    const valuesSeen = ['acct_pevt_operator', 'PEVT FAIR', org.id, 'Golf cart', 'RUNNER_DELIVERS'].filter(v => text.includes(v))
    assert(valuesSeen.length === 0, `${label}: no internal VALUE appears anywhere in the body (found: [${valuesSeen.join(', ')}])`)
    assert(sorted(Object.keys(data._count ?? {})) === sorted(['vendors']) && data._count?.vendors === 0,
      `${label}: _count is the vendor count only (got ${JSON.stringify(data._count)})`)
  }

  // ── [2] positive control: the fields the page needs are still there, with their values ────────
  console.log('\n[2] positive control: what FairContext.normalizeEvent reads is still returned')
  const { body } = await call(event.urlSlug)
  const d = body.data ?? {}
  const fc = d.fulfillmentConfig ?? {}
  assert(d.name === `${PFX}Fair` && d.urlSlug === event.urlSlug && d.description === 'A test fair' && d.status === 'ACTIVE',
    'name, urlSlug, description, status')
  assert(d.serviceChargeEnabled === true && d.serviceChargeAmount === 1.5 && d.openTime === '10:00' && d.closeTime === '22:00',
    'service charge, open and close times')
  assert(fc.curbsideEnabled === true && fc.curbsideFee === 3 &&
    fc.homeDeliveryFee === 6 && fc.curbsideZoneDescription === 'North lot, Row A',
    'fulfillment toggles, fees and the curbside zone description')

  // ── [3] the route's existing gate is unchanged ──────────────────────────────────────────────
  console.log('\n[3] a non-live fair still 404s')
  await prisma.event.update({ where: { id: event.id }, data: { status: EventStatus.UPCOMING } })
  const up = await call(event.urlSlug)
  assert(up.status === 404, `UPCOMING fair → 404 (got ${up.status})`)
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
