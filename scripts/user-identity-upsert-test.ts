/**
 * USER-IDENTITY UPSERT TEST — proves the fix for the prod 500 of 2026-08-01.
 *
 * THE BUG. `User.clerkId` is @unique, but so is `User.email`. All three DB-User write sites
 * upserted keyed ONLY on clerkId. When a row already owned an email under a DIFFERENT
 * clerkId — the state left behind when a `user.deleted` webhook could not remove a row
 * (Order_customerId_fkey is ON DELETE RESTRICT) — the `where` missed, execution fell through
 * to `create`, and create collided on email: P2002 target ['email'], uncaught 500. Permanent
 * for that email.
 *
 * THE FIX. lib/ensure-db-user.ts resolves clerkId → email → create, RE-POINTING the existing
 * row's clerkId rather than inserting into a collision. lib/delete-clerk-user.ts soft-deletes
 * users who have orders instead of attempting a delete the FK forbids.
 *
 * ── WHY THE POSITIVE CONTROLS ARE HERE ───────────────────────────────────────────────────
 * A suite that only asserts "the new code works" cannot tell you whether the FIXTURE actually
 * reproduces the bug. If the fixture is wrong, every negative passes vacuously and the suite
 * reports green over an unproven fix — the failure class this repo keeps re-finding. So:
 *
 *   [0]  BASELINE — the fixture resolves normally before anything is broken. If step 0 fails,
 *        nothing after it means anything.
 *   [P1] PROBE CONTROL — the ORIGINAL upsert, replayed verbatim against the very same fixture,
 *        MUST throw P2002 on ['email']. This proves the fixture reproduces the prod bug. If it
 *        does NOT throw, the suite FAILS LOUDLY (it does not crash, and it does not pass) —
 *        because then the fix is being credited for a bug the fixture never created.
 *   [P2] PROBE CONTROL — that same original upsert MUST succeed for a genuinely new email,
 *        proving the probe is not simply broken for all inputs.
 *
 * Every assertion is scoped to this suite's fixture prefix. No global counts.
 *
 * Run:  npx tsx scripts/user-identity-upsert-test.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { ensureDbUser } from '../lib/ensure-db-user'
import { softDeleteClerkUser } from '../lib/delete-clerk-user'

const prisma = testPrisma()

const SLUG = 'uidtest-'
const MAIL = '@uidtest.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0
let fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else      { fail++; console.log(`  ❌ ${label}`) }
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: MAIL } },
    select: { id: true },
  })
  const ids = users.map(u => u.id)
  if (ids.length) {
    await prisma.orderItem.deleteMany({ where: { order: { customerId: { in: ids } } } })
    await prisma.vendorOrderStatus.deleteMany({ where: { order: { customerId: { in: ids } } } })
    await prisma.order.deleteMany({ where: { customerId: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
  await prisma.menuItem.deleteMany({ where: { vendor: { slug: { startsWith: SLUG } } } })
  await prisma.vendor.deleteMany({ where: { slug: { startsWith: SLUG } } })
  await prisma.event.deleteMany({ where: { urlSlug: { startsWith: SLUG } } })
}

/**
 * THE ORIGINAL CODE, verbatim, as the probe. This is what app/onboarding/page.tsx,
 * app/api/webhooks/clerk/route.ts and app/api/orders/route.ts all ran before the fix.
 * It exists ONLY to prove the fixture reproduces the bug — nothing in the app calls it.
 */
function naiveUpsert(clerkId: string, email: string) {
  return prisma.user.upsert({
    where:  { clerkId },
    create: { clerkId, email, name: 'Naive', isActive: true, role: 'customer' },
    update: { email, name: 'Naive', isActive: true, role: 'customer' },
  })
}

/** Capture a throw without letting it abort the suite. Returns the error, or null. */
async function capture(fn: () => Promise<unknown>): Promise<{ code?: string; target?: unknown } | null> {
  try { await fn(); return null }
  catch (err) {
    const e = err as { code?: string; meta?: { target?: unknown } }
    return { code: e?.code, target: e?.meta?.target }
  }
}

async function seedFair() {
  const event = await prisma.event.create({
    data: {
      name: `UID ${rand()}`,
      urlSlug: `${SLUG}fair-${rand()}`,
      status: 'ACTIVE',
      startDate: new Date(Date.now() - 86_400_000),
      endDate: new Date(Date.now() + 86_400_000),
      venueAddress: '1 Test Way',
    },
  })
  const vendor = await prisma.vendor.create({
    data: {
      eventId: event.id,
      name: `UID Vendor ${rand()}`,
      slug: `${SLUG}vendor-${rand()}`,
      cuisineType: 'Test',
      status: 'ACTIVE',
    },
  })
  return { eventId: event.id, vendorId: vendor.id }
}

async function seedOrder(eventId: string, vendorId: string, customerId: string) {
  return prisma.order.create({
    data: {
      eventId, vendorId, customerId,
      status: 'PLACED',
      fulfillmentType: 'BOOTH_PICKUP',
      subtotal: 10, fairSynqFee: 1, total: 11, vendorPayout: 10,
      customerName: 'UID Customer', customerPhone: '+10000000000',
    },
    select: { id: true, customerId: true },
  })
}

async function main() {
  await cleanup()
  const fair = await seedFair()

  try {
    // ── [0] BASELINE ────────────────────────────────────────────────────────────────────
    // The fixture behaves normally before we break anything. Everything downstream is
    // meaningless if this fails.
    console.log('\n[0] baseline — a fixture user resolves by clerkId')
    const baseEmail = `${SLUG}base-${rand()}${MAIL}`
    const baseClerk = `${SLUG}clerk-${rand()}`
    const seeded = await prisma.user.create({
      data: { clerkId: baseClerk, email: baseEmail, name: 'Base', role: 'customer' },
    })
    const baseRead = await prisma.user.findUnique({ where: { clerkId: baseClerk }, select: { id: true } })
    assert(baseRead?.id === seeded.id, 'seeded user is resolvable by its clerkId')

    // ── [P1] PROBE POSITIVE CONTROL — the fixture MUST reproduce the prod bug ───────────
    // An orphaned row (email owned under a stale clerkId) + a NEW clerkId is the exact prod
    // shape. The ORIGINAL upsert must die on it, with P2002 on ['email'] specifically — the
    // detail that distinguishes this bug from a concurrent-insert race (which would collide
    // on clerkId, the field the upsert keys on).
    console.log('\n[P1] PROBE CONTROL — original upsert throws P2002 on the orphan fixture')
    const orphanEmail = `${SLUG}orphan-${rand()}${MAIL}`
    const staleClerk  = `${SLUG}stale-${rand()}`
    const freshClerk  = `${SLUG}fresh-${rand()}`
    const orphan = await prisma.user.create({
      data: { clerkId: staleClerk, email: orphanEmail, name: 'Orphan', role: 'customer' },
    })
    const probeErr = await capture(() => naiveUpsert(freshClerk, orphanEmail))
    assert(probeErr !== null, 'original upsert THROWS on the orphan fixture (fixture reproduces the bug)')
    assert(probeErr?.code === 'P2002', `original upsert throws P2002 (got ${probeErr?.code ?? 'no throw'})`)
    assert(
      Array.isArray(probeErr?.target) && (probeErr!.target as string[]).includes('email'),
      `P2002 target is ['email'], not ['clerkId'] (got ${JSON.stringify(probeErr?.target)})`,
    )

    // ── [P2] PROBE POSITIVE CONTROL — the probe is not simply broken for everything ─────
    console.log('\n[P2] PROBE CONTROL — original upsert SUCCEEDS for a genuinely new email')
    const probeOkEmail = `${SLUG}probeok-${rand()}${MAIL}`
    const probeOkClerk = `${SLUG}probeok-${rand()}`
    const probeOkErr = await capture(() => naiveUpsert(probeOkClerk, probeOkEmail))
    assert(probeOkErr === null, 'original upsert succeeds for a new email (probe discriminates)')

    // ── [1] THE FIX — re-points instead of inserting ────────────────────────────────────
    console.log('\n[1] ensureDbUser re-points the orphaned row')
    const before = await prisma.user.findUnique({ where: { id: orphan.id }, select: { id: true, clerkId: true } })
    assert(before?.clerkId === staleClerk, 'pre-state: row still carries the stale clerkId')

    const res = await ensureDbUser(freshClerk, {
      email: orphanEmail, name: 'Repointed', phone: null, avatarUrl: null, isActive: true, role: 'organizer',
    }, { db: prisma })

    assert(res.outcome === 'repointed', `outcome is 'repointed' (got '${res.outcome}')`)
    assert(res.previousClerkId === staleClerk, 'previousClerkId names the stale id (the audit fact)')
    assert(res.user.id === orphan.id, 'SAME User.id — re-pointed in place, not inserted')

    const after = await prisma.user.findUnique({ where: { id: orphan.id }, select: { clerkId: true, role: true } })
    assert(after?.clerkId === freshClerk, 'row now carries the NEW clerkId (re-read from DB)')
    assert(after?.role === 'organizer', 'profile applied on re-point')

    const staleGone = await prisma.user.findUnique({ where: { clerkId: staleClerk }, select: { id: true } })
    assert(staleGone === null, 'stale clerkId no longer resolves to any row')

    // Scoped duplicate check — this email must be owned by exactly ONE row in the fixture.
    const orphanRows = await prisma.user.findMany({ where: { email: orphanEmail }, select: { id: true } })
    assert(orphanRows.length === 1, `exactly one row owns the email (got ${orphanRows.length})`)

    // ── [2] ORDER ATTRIBUTION SURVIVES THE RE-POINT ─────────────────────────────────────
    // The whole point of never touching User.id. Named set, re-read after the write —
    // NOT inferred from a status field or a count.
    console.log('\n[2] Order attribution is preserved across a re-point')
    const attribEmail = `${SLUG}attrib-${rand()}${MAIL}`
    const attribStale = `${SLUG}astale-${rand()}`
    const attribFresh = `${SLUG}afresh-${rand()}`
    const attribUser = await prisma.user.create({
      data: { clerkId: attribStale, email: attribEmail, name: 'Attrib', role: 'customer' },
    })
    const o1 = await seedOrder(fair.eventId, fair.vendorId, attribUser.id)
    const o2 = await seedOrder(fair.eventId, fair.vendorId, attribUser.id)
    const o3 = await seedOrder(fair.eventId, fair.vendorId, attribUser.id)
    const NAMED = [o1.id, o2.id, o3.id]

    const attribRes = await ensureDbUser(attribFresh, { email: attribEmail, isActive: true }, { db: prisma })
    assert(attribRes.outcome === 'repointed', 'attribution fixture re-pointed')
    assert(attribRes.user.id === attribUser.id, 'attribution fixture kept its User.id')

    const reread = await prisma.order.findMany({
      where: { id: { in: NAMED } },
      select: { id: true, customerId: true },
      orderBy: { id: 'asc' },
    })
    assert(reread.length === 3, `all 3 named orders still exist (got ${reread.length})`)
    assert(
      reread.every(o => o.customerId === attribUser.id),
      'every named order still points at the SAME User.id after the re-point',
    )
    assert(
      NAMED.every(id => reread.some(o => o.id === id)),
      'the named order ids are exactly the ones re-read (no substitution)',
    )

    // ── [3] NO REGRESSION — a genuinely new email still creates cleanly ─────────────────
    console.log('\n[3] a never-before-seen email creates cleanly')
    const newEmail = `${SLUG}new-${rand()}${MAIL}`
    const newClerk = `${SLUG}newclerk-${rand()}`
    const created = await ensureDbUser(newClerk, { email: newEmail, name: 'Fresh', role: 'vendor' }, { db: prisma })
    assert(created.outcome === 'created', `outcome is 'created' (got '${created.outcome}')`)
    assert(created.previousClerkId === undefined, 'no previousClerkId on a create')
    const createdRead = await prisma.user.findUnique({ where: { clerkId: newClerk }, select: { id: true, email: true } })
    assert(createdRead?.id === created.user.id, 'created row is resolvable by its clerkId')
    assert(createdRead?.email === newEmail, 'created row carries the email')

    // ── [4] IDEMPOTENCE — same clerkId twice updates, never duplicates ──────────────────
    console.log('\n[4] same clerkId twice → updates, no duplicate')
    const again = await ensureDbUser(newClerk, { email: newEmail, name: 'Fresh2', role: 'vendor' }, { db: prisma })
    assert(again.outcome === 'updated', `second call is 'updated' (got '${again.outcome}')`)
    assert(again.user.id === created.user.id, 'second call returns the SAME row id')
    const dupRows = await prisma.user.findMany({ where: { email: newEmail }, select: { id: true } })
    assert(dupRows.length === 1, `still exactly one row for this email (got ${dupRows.length})`)
    const nameApplied = await prisma.user.findUnique({ where: { id: created.user.id }, select: { name: true } })
    assert(nameApplied?.name === 'Fresh2', 'profile was updated on the second call')

    // ── [5] syncProfile:false — the checkout path must not overwrite a profile ──────────
    console.log('\n[5] syncProfile:false leaves an existing profile untouched')
    const noSync = await ensureDbUser(newClerk, { email: newEmail, name: 'SHOULD-NOT-APPLY' }, { db: prisma, syncProfile: false })
    assert(noSync.outcome === 'updated', 'syncProfile:false still resolves the row')
    const untouched = await prisma.user.findUnique({ where: { id: created.user.id }, select: { name: true } })
    assert(untouched?.name === 'Fresh2', 'profile NOT overwritten when syncProfile is false')

    // ── [6] FIX B — a user WITH orders is soft-deleted, and does not throw ──────────────
    console.log('\n[6] user.deleted with orders → soft-delete, no throw')
    const delEmail = `${SLUG}del-${rand()}${MAIL}`
    const delClerk = `${SLUG}delclerk-${rand()}`
    const delUser = await prisma.user.create({
      data: { clerkId: delClerk, email: delEmail, name: 'Deleteme', role: 'customer' },
    })
    const delOrder = await seedOrder(fair.eventId, fair.vendorId, delUser.id)

    // POSITIVE CONTROL on the FK itself: the ORIGINAL hard delete must be impossible here.
    // If this does not throw, RESTRICT is not in force on the test DB and step [6] would
    // pass vacuously.
    const fkErr = await capture(() => prisma.user.delete({ where: { id: delUser.id } }))
    assert(fkErr !== null, 'PROBE CONTROL: hard delete of an ordering user THROWS (FK RESTRICT is in force)')

    let softThrew = false
    let softOutcome = ''
    try {
      const r = await softDeleteClerkUser(delClerk, { db: prisma })
      softOutcome = r.outcome
    } catch { softThrew = true }
    assert(!softThrew, 'softDeleteClerkUser does NOT throw for an ordering user')
    assert(softOutcome === 'soft_deleted', `outcome is 'soft_deleted' (got '${softOutcome}')`)

    const survivor = await prisma.user.findUnique({ where: { id: delUser.id }, select: { id: true, isActive: true } })
    assert(survivor !== null, 'row survives the soft delete')
    assert(survivor?.isActive === false, 'isActive flipped to false')

    const orderSurvivor = await prisma.order.findUnique({ where: { id: delOrder.id }, select: { customerId: true } })
    assert(orderSurvivor?.customerId === delUser.id, 'the order still points at the same User.id')

    // ── [7] FIX B — a user with NO orders is hard-deleted ───────────────────────────────
    console.log('\n[7] user.deleted with no orders → hard delete')
    const cleanEmail = `${SLUG}clean-${rand()}${MAIL}`
    const cleanClerk = `${SLUG}cleanclerk-${rand()}`
    await prisma.user.create({ data: { clerkId: cleanClerk, email: cleanEmail, name: 'Clean', role: 'customer' } })
    const cleanRes = await softDeleteClerkUser(cleanClerk, { db: prisma })
    assert(cleanRes.outcome === 'deleted', `outcome is 'deleted' (got '${cleanRes.outcome}')`)
    const cleanGone = await prisma.user.findUnique({ where: { clerkId: cleanClerk }, select: { id: true } })
    assert(cleanGone === null, 'row is gone')

    // ── [8] FIX B — absent user is a no-op, not a throw ─────────────────────────────────
    console.log('\n[8] user.deleted for an unknown clerkId → no-op')
    const absent = await softDeleteClerkUser(`${SLUG}never-${rand()}`, { db: prisma })
    assert(absent.outcome === 'absent', `outcome is 'absent' (got '${absent.outcome}')`)

    // ── [9] THE SELF-HEAL — soft-deleted, then re-signup on the same email ──────────────
    // This is the live prod scenario end to end: account deleted (row retained), then the
    // same human signs up again and gets a new clerkId.
    console.log('\n[9] soft-deleted user re-signs-up → re-pointed and reactivated')
    const healClerk = `${SLUG}heal-${rand()}`
    const healed = await ensureDbUser(healClerk, { email: delEmail, name: 'Healed', isActive: true, role: 'organizer' }, { db: prisma })
    assert(healed.outcome === 'repointed', `outcome is 'repointed' (got '${healed.outcome}')`)
    assert(healed.user.id === delUser.id, 'self-heal kept the SAME User.id')
    const healedRead = await prisma.user.findUnique({ where: { id: delUser.id }, select: { clerkId: true, isActive: true } })
    assert(healedRead?.clerkId === healClerk, 'row re-bound to the new clerkId')
    assert(healedRead?.isActive === true, 'isActive restored from the fresh Clerk profile')
    const healedOrder = await prisma.order.findUnique({ where: { id: delOrder.id }, select: { customerId: true } })
    assert(healedOrder?.customerId === delUser.id, 'the order STILL points at the same User.id after self-heal')

    // ── [10] SOURCE INVARIANT — no bare user.upsert survives outside the helper ─────────
    // The bug was three hand-copies of one operation. This is the structural block on a
    // fourth appearing.
    console.log('\n[10] source invariant — ensureDbUser is the only creator of User rows')
    const { execSync } = await import('node:child_process')
    const repoRoot = new URL('..', import.meta.url).pathname
    const all = execSync(
      `grep -rn "user\\.upsert(\\|user\\.create(" --include="*.ts" --include="*.tsx" app lib || true`,
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean)

    // POSITIVE CONTROL ON THE GREP ITSELF. `|| true` means a broken grep (wrong cwd, changed
    // flags) yields an empty list, and "no hits" would then pass vacuously — a guard that
    // reports green precisely when it has stopped looking. So first prove the grep can SEE
    // the one call site that must exist.
    const selfHits = all.filter(l => l.startsWith('lib/ensure-db-user.ts:'))
    assert(selfHits.length > 0, `PROBE CONTROL: grep sees ensure-db-user's own create (found ${selfHits.length})`)

    const hits = all.filter(l => !l.startsWith('lib/ensure-db-user.ts:'))
    assert(hits.length === 0, `no user.upsert/create outside lib/ensure-db-user.ts (found: ${hits.join(' | ') || 'none'})`)

  } finally {
    await cleanup()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
  .catch(err => { console.error('FATAL', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
