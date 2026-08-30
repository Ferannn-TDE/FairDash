/**
 * MENU-REQUEST RESTORE-TYPE GUARD — the RESTORE enum label lands, and lands INERT.
 *
 * This is the migration gate for the fourth MenuRequestType. It asserts three things, and the
 * middle one is the point:
 *
 *  [1] the label exists IN THE DATABASE — read from pg_enum, not from schema.prisma, because
 *      the schema file is a claim and the catalog is the fact.
 *  [2] INERT ON ARRIVAL, in the specific sense that matters here: Postgres will ACCEPT a
 *      RESTORE row, and the API will REFUSE to create one, because
 *      lib/menu-requests/validate-item.ts still lists only ADD/EDIT/DELETE. Both halves are
 *      asserted — "the DB accepts it" alone would be a hazard, "the API refuses it" alone
 *      would not prove the migration worked.
 *  [3] nothing existing changed: the three original labels are intact and still writable.
 *
 *  [4] is a PIN on the blast radius. A fourth enum value is a new case in every place that
 *      switches on type, and the dangerous one is the approval route: RESTORE currently falls
 *      through its ADD/EDIT/DELETE chain, which would flip a request to APPROVED while writing
 *      NOTHING. That is unreachable today (the API cannot mint a RESTORE row) — so this pin
 *      asserts the gap exists and is closed off, and step 3 must invert it.
 *
 * ⚠️ Enum labels cannot be dropped in Postgres — this migration is forward-only by nature.
 * ⚠️ Test DB only: MenuItem/MenuRequest carry vendorId, not eventId, so the prod-write-guard
 *    cannot see writes here (lib/prod-write-guard.ts documents the gap).
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/menu-request-restore-type-guard.ts
 * Self-cleaning, prefix mrrt-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })

import { readFileSync } from 'node:fs'
import { MENU_REQUEST_TYPES, validateMenuRequestItem } from '../lib/menu-requests/validate-item'

const prisma = testPrisma()

const PFX = 'mrrt-'
const MAIL = '@mrrt.test'
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
    const vids = vs.map(v => v.id)
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()

  // ── [1] THE LABEL EXISTS IN THE DATABASE ───────────────────────────────────────────────
  console.log('\n[1] RESTORE is in pg_enum (the catalog, not the schema file)')
  const labels = await prisma.$queryRawUnsafe<{ enumlabel: string; sortorder: number }[]>(
    `SELECT e.enumlabel, e.enumsortorder::float8 AS sortorder
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'MenuRequestType'
      ORDER BY e.enumsortorder`,
  )
  const names = labels.map(l => l.enumlabel)
  assert(names.includes('RESTORE'), `RESTORE is a real enum label (got: ${names.join(', ')})`)
  assert(['ADD', 'EDIT', 'DELETE'].every(n => names.includes(n)),
    'the three original labels are still present — nothing was replaced')
  assert(names.length === 4, `the enum has exactly four labels (got ${names.length})`)
  // [0] control: this query CAN come back without a label, so "includes" is discriminating.
  const absent = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'MenuRequestType' AND e.enumlabel = 'NOT_A_REAL_LABEL'`,
  )
  assert(absent.length === 0, '[0] positive control: a label that does NOT exist comes back empty')

  // ── [2] INERT ON ARRIVAL — both halves ─────────────────────────────────────────────────
  console.log('\n[2] the DB accepts RESTORE; the API refuses to create one')
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
    data: { clerkId: `${PFX}u-${rand()}`, email: `${PFX}u-${rand()}${MAIL}`, name: 'Owner', role: 'vendor' },
  })
  const item = await prisma.menuItem.create({
    data: { vendorId: vendor.id, name: `${PFX}item`, price: 5, category: 'Mains', removedAt: new Date() },
  })

  // The DB half: a RESTORE row is storable, which is what the migration bought.
  const stored = await prisma.menuRequest.create({
    data: { vendorId: vendor.id, requestedBy: user.id, type: 'RESTORE', menuItemId: item.id },
  })
  assert(stored.type === 'RESTORE', 'Postgres stores a MenuRequest of type RESTORE')

  // The API half: the shared validator still refuses it, so nothing can mint one through the
  // route. This is what makes the label inert rather than merely unused.
  // STEP-3 INVERSION: the label is now live. The write route ACCEPTS a well-formed RESTORE,
  // and still refuses a malformed one — the type being real does not relax its validation.
  assert(validateMenuRequestItem({ type: 'RESTORE', menuItemId: item.id }) === null,
    'the write route now ACCEPTS a well-formed RESTORE request')
  assert(validateMenuRequestItem({ type: 'RESTORE' })?.message === 'menuItemId is required for RESTORE',
    'and still REFUSES a RESTORE with no menuItemId — it names an existing item, like EDIT and DELETE')
  assert((MENU_REQUEST_TYPES as readonly string[]).includes('RESTORE'),
    'MENU_REQUEST_TYPES lists RESTORE')
  // [0] control: the validator DOES accept a real type, so the refusal above is about RESTORE.
  assert(validateMenuRequestItem({ type: 'DELETE', menuItemId: item.id }) === null,
    '[0] positive control: a DELETE request still validates — the validator is not refusing everything')

  // ── [3] NOTHING EXISTING CHANGED ───────────────────────────────────────────────────────
  console.log('\n[3] the three original types still work end to end')
  for (const t of ['ADD', 'EDIT', 'DELETE'] as const) {
    const row = await prisma.menuRequest.create({
      data: {
        vendorId: vendor.id, requestedBy: user.id, type: t,
        ...(t === 'ADD' ? { name: `${PFX}n`, price: 1, category: 'X' } : { menuItemId: item.id }),
      },
    })
    assert(row.type === t, `a ${t} request still writes and reads back as ${t}`)
  }

  // ── [4] PIN — the approval route has no RESTORE branch yet ─────────────────────────────
  // A fourth enum value is a new case everywhere that switches on type. The dangerous site is
  // the approval route: RESTORE falls through ADD/EDIT/DELETE, so the request would flip to
  // APPROVED having written nothing. Unreachable today because [2] proves the API cannot mint
  // one — but asserted, so step 3 landing without the branch is RED rather than silent.
  console.log('\n[4] the approval route HANDLES RESTORE (step-2 pin, inverted by step 3)')
  const approvalSrc = readFileSync('app/api/organizer/fairs/[fairSlug]/menu-requests/[id]/route.ts', 'utf8')
  assert(/case 'DELETE'/.test(approvalSrc),
    "[0] positive control: the scanner DOES find the existing DELETE branch")
  assert(/case 'RESTORE'/.test(approvalSrc),
    'the approval route has a RESTORE branch — no fall-through to approval theatre')
  assert(/assertNeverRequestType/.test(approvalSrc),
    'and the switch is exhaustive, so a FIFTH type fails tsc instead of falling through')

  console.log(`\n${'─'.repeat(72)}`)
  if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
  else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
  console.log(`${'─'.repeat(72)}\n`)

  await cleanup()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async err => {
  console.error(err)
  await cleanup().catch(() => {})
  process.exit(1)
})
