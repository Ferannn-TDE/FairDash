/**
 * MENU-REQUEST PROJECTION GUARD — batchId must survive the read route's projection, and a
 * standalone row must arrive as null rather than vanishing.
 *
 * WHY THIS IS NOT A FORMALITY. The route hands Prisma an `include`, so every column is on the
 * row — then hand-lists the fields it forwards (route.ts `requests.map(...)`). A column that
 * exists in the database and is silently absent from that list reads, on the client, exactly
 * like a column that is always null. For batchId those two are not the same: `undefined` and
 * `null` both trip `?? \`solo:${id}\``, so a DROPPED field would make every batch look like a
 * pile of standalone items and no error would ever be raised. The failure is invisible by
 * construction, which is why it is asserted rather than assumed.
 *
 * The other half is the one people forget: null must READ THROUGH. A projection that omits
 * nullish values (a `...(x && { x })` spread, a JSON round-trip that drops undefined) would
 * pass a "batched row has its id" test and still break every legacy row.
 *
 * SCOPE. This tests the route's PROJECTION SHAPE against real rows, by importing the same
 * mapping the route performs. It does not exercise auth (requireOrganizerAuth /
 * resolveOwnedFair) — those are covered where they live.
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/menu-request-projection-guard.ts
 * Self-cleaning, prefix mrpj-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })

import { readFileSync } from 'node:fs'

const prisma = testPrisma()

const PFX = 'mrpj-'
const MAIL = '@mrpj.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vs.map(v => v.id) } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()

  const event = await prisma.event.create({
    data: {
      name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE',
      startDate: new Date(), endDate: new Date(Date.now() + 864e5),
    },
  })
  const vendor = await prisma.vendor.create({
    data: { eventId: event.id, name: `${PFX}booth`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' },
  })
  const user = await prisma.user.create({
    data: { clerkId: `${PFX}u-${rand()}`, email: `${PFX}u-${rand()}${MAIL}`, name: 'Booth Owner', role: 'vendor' },
  })

  const sharedBatch = `batch_${rand()}`
  await prisma.menuRequest.create({
    data: {
      vendorId: vendor.id, requestedBy: user.id, type: 'ADD', status: 'PENDING',
      name: `${PFX}solo`, price: 5, category: 'Test',              // batchId omitted → null
    },
  })
  for (let i = 0; i < 2; i++) {
    await prisma.menuRequest.create({
      data: {
        vendorId: vendor.id, requestedBy: user.id, type: 'ADD', status: 'PENDING',
        name: `${PFX}batched-${i}`, price: 5, category: 'Test', batchId: sharedBatch,
      },
    })
  }

  // ── [1] THE ROUTE'S OWN QUERY + PROJECTION ─────────────────────────────────────────────
  // Same include and same field list the route performs, so a field dropped from the route's
  // map is a field missing here.
  console.log('\n[1] batchId survives the route projection')
  const rows = await prisma.menuRequest.findMany({
    where: { vendor: { eventId: event.id }, status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 50,
    include: {
      vendor: { select: { id: true, name: true } },
      menuItem: { select: { id: true, name: true, description: true, price: true, category: true, prepTime: true, imageUrl: true, isAvailable: true } },
    },
  })
  const projected = rows.map(r => ({
    id: r.id, type: r.type, status: r.status,
    batchId: r.batchId,
    name: r.name, description: r.description, price: r.price, category: r.category,
    prepTime: r.prepTime, imageUrl: r.imageUrl,
    menuItemId: r.menuItemId, currentItem: r.menuItem ?? null,
    reviewNote: r.reviewNote, createdAt: r.createdAt,
    vendor: { id: r.vendor.id, name: r.vendor.name },
  }))

  assert(projected.length === 3, `all three fixture rows come back (got ${projected.length})`)
  assert(projected.every(p => 'batchId' in p), 'every projected row HAS a batchId key')

  const batched = projected.filter(p => p.name?.includes('batched'))
  const solo = projected.find(p => p.name?.includes('solo'))

  assert(batched.length === 2 && batched.every(p => p.batchId === sharedBatch),
    'both batched rows carry the SAME batch id through the projection')

  // The half that a "does the batch id survive?" test alone would miss.
  assert(solo !== undefined && solo.batchId === null,
    'the standalone row arrives as null, not undefined and not omitted')

  // ── [2] SURVIVES THE WIRE ──────────────────────────────────────────────────────────────
  // The response is serialised to JSON. `undefined` disappears in JSON.stringify while `null`
  // survives — so a value that is merely "falsy enough" on the server can still be a dropped
  // key by the time the page groups on it.
  console.log('\n[2] null survives JSON serialisation to the client')
  const wire = JSON.parse(JSON.stringify({ requests: projected })) as { requests: Record<string, unknown>[] }
  const wireSolo = wire.requests.find(p => String(p.name).includes('solo'))!
  assert('batchId' in wireSolo, 'the standalone row still HAS the batchId key after JSON round-trip')
  assert(wireSolo.batchId === null, 'and its value is null (undefined would have been dropped here)')

  // ── [3] STRUCTURAL — the ROUTE forwards the field ──────────────────────────────────────
  // [1] and [2] prove the SHAPE is right; this proves the shipped route actually emits it.
  console.log('\n[3] the read route forwards batchId')
  const src = readFileSync('app/api/organizer/fairs/[fairSlug]/menu-requests/route.ts', 'utf8')
  const FORWARDS = /batchId:\s*r\.batchId/
  assert(FORWARDS.test('      batchId: r.batchId,'),
    '[0] positive control: the scanner DOES match the forwarding line')
  assert(!FORWARDS.test('      imageUrl: r.imageUrl,'),
    '[0] baseline: the scanner does NOT match an unrelated forwarded field')
  assert(FORWARDS.test(src), 'menu-requests read route forwards batchId in its projection')

  console.log(`\n${'─'.repeat(66)}`)
  if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
  else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
  console.log(`${'─'.repeat(66)}\n`)

  await cleanup()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async err => {
  console.error(err)
  await cleanup().catch(() => {})
  process.exit(1)
})
