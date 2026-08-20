/**
 * VENDOR OPERATOR ADMITTANCE — STEP 4: the accept-verb gate, EXERCISED.
 *
 * scripts/vendor-operator-gate-test.ts is a STATIC suite — it proves the gate is wired, reads
 * fresh, and reuses the shared derivations, by reading source. It cannot prove the gate REFUSES.
 * This one runs requireVendorMayOperate() against a real database and asserts the outcome for
 * every cell of the two-axis matrix, because "it type-checks" has never been evidence that an
 * authorisation check says no. (Step 3 shipped with the same reasoning and the API stayed open
 * for the whole arc — the gap this file exists to make visible.)
 *
 * ⚠️ WRITES TO A DATABASE. Run it through the wrapper, which is the only thing that makes the
 * connection non-production:
 *
 *   npm run test:db:up
 *   ./scripts/with-test-db.sh npx tsx scripts/vendor-accept-verb-test.ts
 *
 * It refuses to run against anything that is not a local host.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { db } from '../lib/db'
import { testPrisma } from '../lib/test-db'
import { requireVendorMayOperate } from '../lib/auth'
import { ApiError } from '../lib/api-error'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/**
 * THE CONNECTION REFUSAL, BEFORE A SINGLE WRITE.
 *
 * This suite is unusual: the code under test is an authorisation helper that uses the APP's
 * `db` singleton internally, so it cannot be handed an injected test client the way a pure
 * money helper can. The singleton reads DATABASE_URL, and with-test-db.sh is the only thing
 * that points it at the container.
 *
 * ⚠️ CHECKING THE URL STRING IS NOT ENOUGH, AND READING process.env.DATABASE_URL IS BANNED
 * OUTRIGHT (scripts/test-isolation-guard.ts [2] — a registered suite that can name that
 * variable is a suite that can construct a production client). The partial-environment trap is
 * real and documented in with-test-db.sh: TEST_DATABASE_URL can point local while DATABASE_URL
 * still points at production, and a suite that only inspected the former would seed the latter.
 *
 * So this proves IDENTITY instead of inspecting configuration. `testPrisma()` is guaranteed
 * non-production by lib/test-db (hard throw on unset or prod-looking TEST_DATABASE_URL). Write
 * a marker through it, then read it back through the singleton the gate will actually use. If
 * the two are different databases the read misses and we refuse. That is the only check that
 * cannot be satisfied by a half-set environment.
 */
async function assertSingletonIsTheTestDatabase(): Promise<void> {
  const probe = testPrisma()      // throws unless TEST_DATABASE_URL is set AND non-production
  const markerSlug = `${TAG}-identity-probe`
  try {
    const marker = await probe.event.create({
      data: {
        name: `${TAG} identity probe`,
        urlSlug: markerSlug,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86_400_000),
      },
    })
    const seen = await db.event.findUnique({ where: { id: marker.id }, select: { id: true } })
    await probe.event.delete({ where: { id: marker.id } })
    if (!seen) {
      console.error(
        '\n🛑 REFUSING: the app `db` singleton is NOT the test database.\n' +
        '   A row written to TEST_DATABASE_URL was invisible to it, so this run would have\n' +
        '   seeded somewhere else — the partial-environment trap with-test-db.sh exists to stop.\n' +
        '   Run:  ./scripts/with-test-db.sh npx tsx scripts/vendor-accept-verb-test.ts\n',
      )
      process.exit(1)
    }
    console.log('  (verified: the app singleton and TEST_DATABASE_URL are the same database)')
  } finally {
    await probe.$disconnect()
  }
}

const TAG = `avt-${Date.now()}`

/** Runs the gate and reduces the outcome to something assertable. */
async function outcome(userId: string, vendorId: string): Promise<{ ok: boolean; code?: string; status?: number; message?: string }> {
  try {
    await requireVendorMayOperate(userId, vendorId)
    return { ok: true }
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, status: err.statusCode, message: err.message }
    throw err
  }
}

async function main() {
  console.log('\n══ VENDOR ACCEPT-VERB GATE — behavioural ══\n')
  await assertSingletonIsTheTestDatabase()

  const event = await db.event.create({
    data: {
      name: `${TAG} fair`,
      urlSlug: `${TAG}-fair`,
      startDate: new Date(),
      endDate: new Date(Date.now() + 86_400_000),
    },
  })

  const mkVendor = (name: string, status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'SUSPENDED' | 'REJECTED') =>
    db.vendor.create({
      data: { eventId: event.id, name: `${TAG} ${name}`, slug: `${TAG}-${name}`, cuisineType: 'test', status },
    })

  const mkUser = (who: string) =>
    db.user.create({ data: { clerkId: `${TAG}-${who}`, email: `${TAG}-${who}@example.test` } })

  // ── [1] the operator axis, booth held ACTIVE so only that axis can speak ────
  console.log('\n[1] operator axis (booth ACTIVE throughout)')
  const boothActive = await mkVendor('active', 'ACTIVE')

  for (const [approval, expectOk] of [['APPROVED', true], ['PENDING', false], ['REJECTED', false]] as const) {
    const user = await mkUser(`op-${approval}`)
    await db.vendorMember.create({
      data: {
        userId: user.id, vendorId: boothActive.id, role: 'owner',
        approvalStatus: approval,
        rejectionReason: approval === 'REJECTED' ? 'incomplete insurance' : null,
      },
    })
    const r = await outcome(user.id, boothActive.id)
    if (expectOk) {
      // THE POSITIVE CONTROL for this whole file. Without a cell that PASSES, every "it throws"
      // assertion below could be satisfied by a gate that refuses everyone — including the
      // operators who are supposed to work. A suite of negatives alone proves nothing.
      assert(r.ok, `APPROVED operator on an ACTIVE booth is ALLOWED (positive control — the gate is not refusing everyone)`)
    } else {
      assert(!r.ok && r.code === 'VENDOR_OPERATOR_NOT_APPROVED',
        `${approval} operator is refused with VENDOR_OPERATOR_NOT_APPROVED (got ${r.code ?? 'ALLOWED'})`)
      assert(r.status === 403, `${approval} operator gets 403, not a 500 (got ${r.status})`)
      assert(typeof r.message === 'string' && r.message.length > 0,
        `${approval} operator is told why (message: "${r.message}")`)
    }
  }

  // ── [2] the booth axis, operator held APPROVED so only that axis can speak ──
  console.log('\n[2] booth axis (operator APPROVED throughout)')
  for (const status of ['PENDING', 'PAUSED', 'SUSPENDED', 'REJECTED'] as const) {
    const booth = await mkVendor(`booth-${status}`, status)
    const user = await mkUser(`booth-${status}`)
    await db.vendorMember.create({
      data: { userId: user.id, vendorId: booth.id, role: 'owner', approvalStatus: 'APPROVED', rejectionReason: null },
    })
    const r = await outcome(user.id, booth.id)
    assert(!r.ok && r.code === 'VENDOR_BOOTH_NOT_OPERATING',
      `an APPROVED operator on a ${status} booth is refused with VENDOR_BOOTH_NOT_OPERATING (got ${r.code ?? 'ALLOWED'})`)
    assert(r.status === 403, `${status} booth gets 403 (got ${r.status})`)
  }

  // ── [3] both axes bad → the OPERATOR reason wins ────────────────────────────
  // Precedence matters for the message, not the outcome: telling someone "your booth is pending"
  // when the real blocker is their own unreviewed admittance sends them to the wrong person.
  console.log('\n[3] precedence when both axes refuse')
  const bothBad = await mkVendor('both-bad', 'PENDING')
  const bothBadUser = await mkUser('both-bad')
  await db.vendorMember.create({
    data: { userId: bothBadUser.id, vendorId: bothBad.id, role: 'owner', approvalStatus: 'PENDING', rejectionReason: null },
  })
  const both = await outcome(bothBadUser.id, bothBad.id)
  assert(!both.ok && both.code === 'VENDOR_OPERATOR_NOT_APPROVED',
    `a PENDING operator on a PENDING booth hears about the OPERATOR axis first (got ${both.code})`)

  // ── [4] PER-BOOTH — stricter than the door, on purpose ─────────────────────
  // The door admits "one APPROVED membership admits you to the portal" as a deliberate
  // simplification for NAVIGATION. If that leaked into the action verbs, an operator approved at
  // one booth could work another booth they were never admitted to. This is the cell that proves
  // it did not.
  console.log('\n[4] approval does not travel between booths')
  const boothB = await mkVendor('booth-b', 'ACTIVE')
  const twoBooths = await mkUser('two-booths')
  await db.vendorMember.create({
    data: { userId: twoBooths.id, vendorId: boothActive.id, role: 'owner', approvalStatus: 'APPROVED', rejectionReason: null },
  })
  await db.vendorMember.create({
    data: { userId: twoBooths.id, vendorId: boothB.id, role: 'owner', approvalStatus: 'PENDING', rejectionReason: null },
  })
  const atA = await outcome(twoBooths.id, boothActive.id)
  const atB = await outcome(twoBooths.id, boothB.id)
  assert(atA.ok, 'allowed at the booth they were approved for')
  assert(!atB.ok && atB.code === 'VENDOR_OPERATOR_NOT_APPROVED',
    `refused at the booth they were NOT approved for (got ${atB.code ?? 'ALLOWED'}) — approval is per-booth, unlike the door`)

  // ── [5] no membership at all → fail closed ─────────────────────────────────
  console.log('\n[5] a stranger fails closed')
  const stranger = await mkUser('stranger')
  const strangerR = await outcome(stranger.id, boothActive.id)
  assert(!strangerR.ok && strangerR.status === 403,
    `a user with no membership on this booth is refused (got ${strangerR.code ?? 'ALLOWED'})`)

  // ── Cleanup ────────────────────────────────────────────────────────────────
  // Cascades from Event → Vendor → VendorMember; Users are not cascaded, so drop them by tag.
  await db.event.delete({ where: { id: event.id } })
  await db.user.deleteMany({ where: { clerkId: { startsWith: TAG } } })

  console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exit(1)
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => db.$disconnect())
