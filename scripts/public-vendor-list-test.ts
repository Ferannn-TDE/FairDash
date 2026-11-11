/**
 * PUBLIC VENDOR LIST — audit H2, end to end against the test DB.
 *
 * Calls the real GET /api/vendors handler, signed out, for a fair whose vendor has ALL its
 * private columns filled in (contact name, email and phone, legal-signature name and IP, Stripe
 * account, commission rate, payout-freeze fields, document storage paths). Each vendor in the
 * response must carry exactly the approved keys and none of the private ones. The control
 * proves those columns really were set in the database, so "absent from the response" cannot
 * pass on a row that never had them.
 *
 * scripts/public-vendor-select-guard.ts pins the select statically; this suite proves what
 * actually leaves the server.
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/public-vendor-list-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
// The select is under test, not the vendor readiness bar (it has its own suites).
process.env.ENFORCE_VENDOR_READINESS = 'false'

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { NextRequest } from 'next/server'
import { EventStatus, VendorStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'pvl-'
const rand = () => Math.random().toString(36).slice(2, 8)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

const APPROVED_KEYS = [
  'id', 'name', 'slug', 'cuisineType', 'description', 'boothNumber', 'isBusy', 'isOffline', '_count',
]
const FORBIDDEN_KEYS = [
  'contactName', 'contactEmail', 'contactPhone',
  'termsAcceptedName', 'termsAcceptedIp',
  'stripeAccountId', 'commissionRate',
  'payoutsFrozenAt', 'payoutsFrozenReason', 'payoutsFrozenBy',
  'foodHandlerPermitPath', 'insurancePath', 'businessLicensePath',
]
/** Seeded private values: none may appear anywhere in the response body. */
const SECRET_VALUES = {
  contactName: 'Pat Private',
  contactEmail: 'pat.private@pvl.local',
  contactPhone: '+15550199',
  termsAcceptedName: 'Patricia Q. Private',
  termsAcceptedIp: '203.0.113.77',
  stripeAccountId: 'acct_pvl_vendor',
  payoutsFrozenReason: 'pvl freeze reason',
  payoutsFrozenBy: 'user_pvl_admin',
  foodHandlerPermitPath: 'pvl/permit.pdf',
  insurancePath: 'pvl/insurance.pdf',
  businessLicensePath: 'pvl/licence.pdf',
}

const sorted = (keys: string[]) => JSON.stringify([...keys].sort())

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    await prisma.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
}

async function main() {
  await cleanup()
  console.log('\n══ PUBLIC VENDOR LIST (H2) ══')

  // ── seed: a live fair, one ACTIVE online vendor with every private column set ────────────────
  const now = Date.now()
  const event = await prisma.event.create({
    data: {
      name: `${PFX}Fair`,
      urlSlug: `${PFX}${rand()}`,
      status: EventStatus.ACTIVE,
      startDate: new Date(now - 86_400_000),
      endDate: new Date(now + 86_400_000),
    },
  })
  const vendor = await prisma.vendor.create({
    data: {
      eventId: event.id,
      name: `${PFX}Taco Stand`,
      slug: `${PFX}taco-${rand()}`,
      cuisineType: 'Tacos',
      description: 'Street tacos',
      boothNumber: 'B12',
      status: VendorStatus.ACTIVE,
      isOffline: false,
      ...SECRET_VALUES,
      termsVersion: 'pvl-v1',
      termsAcceptedAt: new Date(),
      stripeVerified: true,
      commissionRate: 0.17,
      payoutsFrozenAt: new Date(),
    },
  })
  // One item on sale, one sold out, one removed: only the first is SELLABLE.
  await prisma.menuItem.createMany({
    data: [
      { vendorId: vendor.id, name: `${PFX}on sale`, price: 5, category: 'Mains', isAvailable: true },
      { vendorId: vendor.id, name: `${PFX}sold out`, price: 5, category: 'Mains', isAvailable: false },
      { vendorId: vendor.id, name: `${PFX}removed`, price: 5, category: 'Mains', isAvailable: true, removedAt: new Date() },
    ],
  })

  // ── [0] control: the private columns really are set in the database ──────────────────────────
  console.log('\n[0] control: every private column is set on the seeded vendor')
  const row = await prisma.vendor.findUnique({ where: { id: vendor.id } }) as Record<string, unknown> | null
  const unset = FORBIDDEN_KEYS.filter(k => row?.[k] == null)
  assert(unset.length === 0, `every forbidden column is non-null in the DB (unset: [${unset.join(', ')}])`)

  // ── [1] call the real handler, signed out ───────────────────────────────────────────────────
  console.log('\n[1] GET /api/vendors?eventSlug=…, signed out')
  ;(globalThis as { __MOCK_CLERK?: unknown }).__MOCK_CLERK = undefined
  const { GET } = await import('../app/api/vendors/route')
  const r = await GET(new NextRequest(`http://localhost/api/vendors?eventSlug=${event.urlSlug}&limit=100`))
  type Body = { data?: Array<Record<string, unknown> & { _count?: Record<string, unknown> }>, pagination?: { total?: number } }
  const body = (await r.json()) as Body
  const list = body.data ?? []
  assert(r.status === 200 && list.length === 1 && list[0].id === vendor.id && body.pagination?.total === 1,
    `200 with exactly the seeded vendor (got ${r.status}, ${list.length} vendor(s))`)
  const v = list[0] ?? {}
  assert(sorted(Object.keys(v)) === sorted(APPROVED_KEYS),
    `vendor keys are exactly the approved list (got ${Object.keys(v).sort().join(', ')})`)
  const leaked = FORBIDDEN_KEYS.filter(k => k in v)
  assert(leaked.length === 0, `no forbidden column (leaked: [${leaked.join(', ')}])`)
  const text = JSON.stringify(body)
  const valuesSeen = Object.values(SECRET_VALUES).filter(s => text.includes(s))
  assert(valuesSeen.length === 0, `no private VALUE appears anywhere in the body (found: [${valuesSeen.join(', ')}])`)

  // ── [2] the SELLABLE count ──────────────────────────────────────────────────────────────────
  console.log('\n[2] _count counts only items a customer could order now')
  assert(sorted(Object.keys(v._count ?? {})) === sorted(['menuItems']) && v._count?.menuItems === 1,
    `_count is { menuItems: 1 } — on sale counted, sold out and removed not (got ${JSON.stringify(v._count)})`)

  // ── [3] positive control: what FairContext.normalizeVendor reads is still returned ───────────
  console.log('\n[3] positive control: the fields the vendor list shows are still returned')
  assert(v.name === `${PFX}Taco Stand` && v.slug === vendor.slug && v.cuisineType === 'Tacos' &&
    v.description === 'Street tacos' && v.boothNumber === 'B12' && v.isBusy === false && v.isOffline === false,
    'name, slug, cuisineType, description, boothNumber, isBusy, isOffline')
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
