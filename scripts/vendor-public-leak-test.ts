/**
 * PUBLIC VENDOR ENDPOINT — sensitive-field leak guard.
 *
 * GET /api/vendors/[id] is anonymous (rate-limited only). Its Prisma `select` IS the
 * access-control boundary: whatever it selects is returned verbatim to any stranger.
 * It was leaking the vendor's compliance documents (food-handler permit, INSURANCE
 * CERTIFICATE, BUSINESS LICENSE — legal PII) and their Stripe Connect account id.
 *
 * This test asserts the shape of what that endpoint hands out, by driving the route's
 * real handler against real vendors. It is a REGRESSION GUARD: re-adding any of those
 * fields to the select fails this test rather than quietly re-opening the leak.
 *
 * NOTE: this covers the API leak only. Whether the storage objects themselves are
 * reachable by direct URL is the bucket's problem — see the private-bucket slice.
 *
 * Run:  npx tsx scripts/vendor-public-leak-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** Fields a stranger must NEVER receive from the public vendor endpoint. */
const FORBIDDEN = [
  'foodHandlerPermitUrl',
  'insuranceUrl',
  'businessLicenseUrl',
  'stripeAccountId',
  'stripeVerified',
  'notificationPrefs',
]

async function main() {
  try {
    const { GET } = await import('../app/api/vendors/[id]/route')

    // Every vendor that actually HAS documents — the ones with something to leak.
    const withDocs = await prisma.vendor.findMany({
      where: {
        OR: [
          { foodHandlerPermitUrl: { not: null } },
          { insuranceUrl: { not: null } },
          { businessLicenseUrl: { not: null } },
        ],
      },
      select: { id: true, name: true, slug: true, isOffline: true, event: { select: { urlSlug: true } } },
    })

    console.log(`\n[1] the public endpoint must not emit document URLs or Stripe ids`)
    console.log(`    (testing ${withDocs.length} vendor(s) that actually have documents)`)

    let checked = 0
    for (const v of withDocs) {
      const url = `http://local/api/vendors/${v.slug}?fair=${v.event.urlSlug}`
      const res = await GET(
        new Request(url) as any,
        { params: Promise.resolve({ id: v.slug }) },
      )
      const body = await res.json()

      // An offline / not-ready vendor is legitimately 404/503 — no body to leak.
      if (!body?.success) continue
      checked++

      const payload = body.data ?? {}
      const keys = Object.keys(payload)
      for (const f of FORBIDDEN) {
        assert(!(f in payload), `${v.name}: response does NOT contain "${f}"`)
      }
      // And nothing anywhere in the serialised body may point at the storage bucket.
      const raw = JSON.stringify(payload)
      assert(!raw.includes('/storage/v1/'), `${v.name}: response contains NO storage URL of any kind`)
      assert(!raw.includes('acct_'), `${v.name}: response contains NO Stripe account id`)
      // Sanity: it still returns the customer-facing data (we didn't gut the endpoint).
      assert(keys.includes('name') && keys.includes('menuItems'), `${v.name}: still returns name + menuItems (endpoint still works)`)
    }

    if (checked === 0) {
      console.log('  ⚠️  no vendor with documents was publicly visible (all offline/not-ready) — ran the shape check on any live vendor instead')
      const any = await prisma.vendor.findFirst({
        where: { isOffline: false },
        select: { slug: true, name: true, event: { select: { urlSlug: true } } },
      })
      if (any) {
        const res = await GET(
          new Request(`http://local/api/vendors/${any.slug}?fair=${any.event.urlSlug}`) as any,
          { params: Promise.resolve({ id: any.slug }) },
        )
        const body = await res.json()
        if (body?.success) {
          for (const f of FORBIDDEN) assert(!(f in (body.data ?? {})), `${any.name}: response does NOT contain "${f}"`)
        }
      }
    }

    console.log(`\n${'─'.repeat(60)}\n  ${pass} passed, ${fail} failed\n${'─'.repeat(60)}\n`)
  } finally {
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('\n💥', e); await prisma.$disconnect(); process.exit(1) })
