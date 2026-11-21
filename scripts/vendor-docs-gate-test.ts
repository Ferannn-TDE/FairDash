/**
 * VENDOR DOCUMENTS GATE — acceptance test for the mandatory-documents change.
 *
 * WHAT THIS PROVES:
 *   • the SSOT predicate agrees with its own where-fragment (the dual-form invariant
 *     lib/vendor-readiness.ts established — a predicate that disagrees with the query
 *     is exactly the drift both files exist to prevent),
 *   • BOTH doors into ACTIVE refuse a docs-incomplete vendor with 409
 *     VENDOR_NOT_READY_TO_GO_LIVE — organizer PATCH *and* platform-admin approve, so admin is
 *     a second door to one rule (lib/vendor-go-live.ts) and not a bypass,
 *   • both doors ACCEPT once all three documents are present,
 *   • REACTIVATE IS GATED since M1 (decided Nov 12): a docs-incomplete PAUSED, SUSPENDED or
 *     REJECTED vendor can't be moved into ACTIVE. This reverses the old "reactivate is never
 *     gated" rule, which is what let PENDING → PAUSED → ACTIVE put an unapproved booth live.
 *     A VENDOR's own pause (isBusy/isOffline) never touches status and is not affected.
 *
 * POSITIVE CONTROLS ON THE PROBE ITSELF. A suite of "this is refused" assertions passes
 * vacuously if the probe is broken (wrong id, unresolvable route, throwing harness), so
 * every negative here is paired with a positive that must SUCCEED through the same probe.
 *
 * Run:  npx tsx scripts/vendor-docs-gate-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import {
  REQUIRED_VENDOR_DOCS,
  docsCompleteFromPresence,
  docsCompleteWhere,
  vendorDocsComplete,
  vendorDocsPresence,
  type VendorDocPaths,
} from '../lib/vendor-documents'

// The gate is a pure predicate over loaded columns, so sections [1] and [2]-[3] need no
// database at all. Only the dual-form cross-check (query form vs predicate form over real
// rows) does — it is SKIPPED LOUDLY, never silently, when the test DB is down, and it
// NEVER falls back to DATABASE_URL (that fallback is how a test run lands in production).
const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL)

/** Self-contained fixture namespace — seeded and torn down by THIS suite, never ambient. */
const SEED_TAG = 'vdgateseed'

let pass = 0
let fail = 0
let skipped = 0
function check(label: string, ok: boolean) {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else    { fail++; console.log(`  ✗ ${label}`) }
}

const FAKE_PATH = (v: string, d: string) => `${v}/${d}/1700000000000_test.pdf`

const none:    VendorDocPaths = { foodHandlerPermitPath: null, insurancePath: null, businessLicensePath: null }
const partial: VendorDocPaths = { foodHandlerPermitPath: 'a',  insurancePath: 'b',  businessLicensePath: null }
const all:     VendorDocPaths = { foodHandlerPermitPath: 'a',  insurancePath: 'b',  businessLicensePath: 'c' }

/**
 * The dual-form cross-check: run `docsCompleteWhere` as a real query and confirm it
 * selects exactly the rows `vendorDocsComplete` accepts. Requires the test database.
 */
async function dualFormCrossCheck() {
  const { testPrisma } = await import('../lib/test-db')
  const prisma = testPrisma()

  const cleanup = async () => {
    const evs = await prisma.event.findMany({
      where: { urlSlug: { startsWith: SEED_TAG } },
      select: { id: true },
    })
    if (evs.length) {
      const ids = evs.map(e => e.id)
      await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
      await prisma.event.deleteMany({ where: { id: { in: ids } } })
    }
  }

  try {
    // Opening sweep too: a run killed mid-flight (Ctrl-C, a thrown create) leaves rows
    // behind, and Event.urlSlug is GLOBALLY unique — so without this a crashed run would
    // poison every later one.
    await cleanup()

    const event = await prisma.event.create({
      data: {
        // Exactly the required scalars (schema.prisma:15-24): name, urlSlug, startDate,
        // endDate. `status` carries a default and organizerId is optional.
        name: 'Docs Gate Test Fair',
        urlSlug: `${SEED_TAG}-fair-${Date.now()}`,
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(Date.now() + 86_400_000),
      },
      select: { id: true },
    })

    const seed = async (name: string, slug: string, paths: VendorDocPaths) =>
      prisma.vendor.create({
        data: { eventId: event.id, name, slug, cuisineType: 'Test', status: 'PENDING', ...paths },
        select: {
          id: true,
          foodHandlerPermitPath: true,
          insurancePath: true,
          businessLicensePath: true,
        },
      })

    // THE BOUNDARY MATTERS. All-three and none-at-all agree under any implementation of
    // either form — including a broken one that only ever looks at a single column. The
    // TWO-OF-THREE row is the only fixture that can catch the two forms disagreeing, so
    // it is the reason this check exists at all.
    const bareRow     = await seed('Bare Booth',     `${SEED_TAG}-bare`,     none)
    const partialRow  = await seed('Partial Booth',  `${SEED_TAG}-partial`,  partial)
    const completeRow = await seed('Complete Booth', `${SEED_TAG}-complete`, {
      foodHandlerPermitPath: FAKE_PATH('c', 'foodHandler'),
      insurancePath:         FAKE_PATH('c', 'insurance'),
      businessLicensePath:   FAKE_PATH('c', 'businessLicense'),
    })
    const rows = [bareRow, partialRow, completeRow]
    const ids  = rows.map(r => r.id)

    check('fixture spans the boundary: one 0/3, one 2/3, one 3/3',
      [bareRow, partialRow, completeRow].map(r =>
        [r.foodHandlerPermitPath, r.insurancePath, r.businessLicensePath].filter(Boolean).length,
      ).join(',') === '0,2,3')

    // FORM A — the Prisma where-fragment, executed against the database. Scoped by the
    // exact seeded ids so no ambient row can influence the result either way.
    const whereComplete = new Set(
      (await prisma.vendor.findMany({
        where: { id: { in: ids }, ...docsCompleteWhere },
        select: { id: true },
      })).map(v => v.id),
    )

    // FORM B — the in-memory predicate, over those same rows.
    const predicateComplete = new Set(rows.filter(vendorDocsComplete).map(r => r.id))

    // Both directions explicitly. Equal sizes plus one-way containment would already
    // imply it, but spelling out both makes a failure say WHICH form over-selected.
    const whereSubsetOfPredicate = [...whereComplete].every(id => predicateComplete.has(id))
    const predicateSubsetOfWhere = [...predicateComplete].every(id => whereComplete.has(id))

    check('every id the WHERE form selects, the PREDICATE also accepts',
      whereSubsetOfPredicate)
    check('every id the PREDICATE accepts, the WHERE form also selects',
      predicateSubsetOfWhere)
    check('the two SSOT forms select identical id-sets',
      whereSubsetOfPredicate && predicateSubsetOfWhere && whereComplete.size === predicateComplete.size)

    // COUNT ANCHOR — without this, two forms that are wrong in LOCKSTEP (both ignoring
    // businessLicense, say) still agree with each other and pass every check above.
    check('exactly ONE vendor is docs-complete (anchors "agreeing but both wrong")',
      whereComplete.size === 1)
    check('…and it is the 3/3 vendor, not the 2/3 one',
      whereComplete.has(completeRow.id) && !whereComplete.has(partialRow.id) && !whereComplete.has(bareRow.id))
  } finally {
    // In FINALLY, not at the end of the try: an assertion helper that ever throws, or a
    // failed create, must not leave a stray Event behind — its urlSlug is globally unique.
    await cleanup()
    await prisma.$disconnect()
  }
}

async function main() {
  // ── 1. SSOT internal consistency ────────────────────────────────────────────
  console.log('\n[1] SSOT: predicate ↔ presence map')

  check('vendorDocsComplete(none) === false', vendorDocsComplete(none) === false)
  check('vendorDocsComplete(partial) === false', vendorDocsComplete(partial) === false)
  check('vendorDocsComplete(all) === true', vendorDocsComplete(all) === true)
  check('presence map agrees with predicate (all)',
    docsCompleteFromPresence(vendorDocsPresence(all)) === vendorDocsComplete(all))
  check('presence map agrees with predicate (partial)',
    docsCompleteFromPresence(vendorDocsPresence(partial)) === vendorDocsComplete(partial))
  check('presence map has exactly the required keys',
    Object.keys(vendorDocsPresence(all)).sort().join(',') === [...REQUIRED_VENDOR_DOCS].sort().join(','))

  // ── 1b. Dual-form cross-check (needs the test DB) ───────────────────────────
  console.log('\n[1b] SSOT: where-fragment ↔ predicate over real rows')
  if (HAS_TEST_DB) {
    await dualFormCrossCheck()
  } else {
    skipped++
    console.log('  ⚠ SKIPPED — TEST_DATABASE_URL unset. Start it with `npm run test:db:up`.')
    console.log('    (Deliberately NOT falling back to DATABASE_URL: that is production.)')
  }

  const bare     = { status: 'PENDING', ...none }
  const partialV = { status: 'PENDING', ...partial }
  const complete = { status: 'PENDING', ...all }
  const pausedIncomplete = { status: 'PAUSED', ...none }

  // ── 2. Both approve doors ───────────────────────────────────────────────────
  // The gate is a pure predicate over loaded columns, so it is exercised directly
  // against each door's real precondition rather than over HTTP (no server needed).
  console.log('\n[2] Two-door gate: organizer PATCH + admin approve, one rule')

  // Door 1 — organizer: gated on EVERY move into ACTIVE (M1, Nov 12).
  const organizerWouldRefuse = (v: { status: string } & VendorDocPaths, next: string) =>
    v.status !== 'ACTIVE' && next === 'ACTIVE' && !vendorDocsComplete(v)

  // Door 2 — admin: the route's own PENDING check runs first, so the gate is unconditional.
  const adminWouldRefuse = (v: VendorDocPaths) => !vendorDocsComplete(v)

  check('organizer REFUSES docs-incomplete PENDING → ACTIVE',
    organizerWouldRefuse(bare as never, 'ACTIVE') === true)
  check('organizer REFUSES partially-documented PENDING → ACTIVE',
    organizerWouldRefuse(partialV as never, 'ACTIVE') === true)
  check('organizer ACCEPTS fully-documented PENDING → ACTIVE (positive control)',
    organizerWouldRefuse(complete as never, 'ACTIVE') === false)

  check('admin REFUSES docs-incomplete approve',
    adminWouldRefuse(bare as never) === true)
  check('admin REFUSES partially-documented approve',
    adminWouldRefuse(partialV as never) === true)
  check('admin ACCEPTS fully-documented approve (positive control)',
    adminWouldRefuse(complete as never) === false)

  check('BOTH doors agree on every seeded vendor (no bypass)',
    [bare, partialV, complete].every(v =>
      organizerWouldRefuse(v as never, 'ACTIVE') === adminWouldRefuse(v as never)))

  // ── 3. Reactivate IS gated (M1, decided Nov 12) ─────────────────────────────
  console.log('\n[3] Every move into ACTIVE is gated, including lifting a pause or suspension')

  check('PAUSED → ACTIVE with NO documents is REFUSED (the PENDING → PAUSED → ACTIVE bypass)',
    organizerWouldRefuse(pausedIncomplete as never, 'ACTIVE') === true)
  check('SUSPENDED → ACTIVE with NO documents is REFUSED',
    organizerWouldRefuse({ ...pausedIncomplete, status: 'SUSPENDED' } as never, 'ACTIVE') === true)
  check('…and the same PAUSED vendor WITH documents is not refused on documents (positive control)',
    organizerWouldRefuse({ ...pausedIncomplete, ...all } as never, 'ACTIVE') === false)

  const rejected = { ...bare, status: 'REJECTED' }
  check('REJECTED → ACTIVE (re-approve) with NO documents is REFUSED',
    organizerWouldRefuse(rejected as never, 'ACTIVE') === true)
  check('PENDING → REJECTED is never doc-gated',
    organizerWouldRefuse(bare as never, 'REJECTED') === false)
  check('ACTIVE → PAUSED (pausing a vendor) is never doc-gated',
    organizerWouldRefuse({ ...bare, status: 'ACTIVE' } as never, 'PAUSED') === false)

  // ── 4. Source fingerprint ───────────────────────────────────────────────────
  // Sections [2]–[3] model the gate conditions; this asserts the ROUTES actually
  // implement them. Without it the suite could pass green against routes that never
  // call the predicate at all.
  console.log('\n[4] The routes really call the shared predicate')

  const { readFileSync } = await import('node:fs')
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

  /**
   * "A appears before B" — and BOTH must actually appear. A bare
   * `indexOf(a) < indexOf(b)` passes vacuously when `a` is absent, because indexOf
   * returns -1 and -1 is less than everything. That is the exact shape that makes a
   * negative suite go green against code that never implements the thing.
   */
  const orderedBefore = (haystack: string, a: string, b: string) => {
    const ia = haystack.indexOf(a)
    const ib = haystack.indexOf(b)
    return ia !== -1 && ib !== -1 && ia < ib
  }

  const organizerSrc = src('app/api/organizer/vendors/[id]/route.ts')
  const adminSrc     = src('app/api/admin/vendors/[id]/approve/route.ts')
  const approvalsSrc = src('lib/approvals.ts')
  const goLiveSrc    = src('lib/vendor-go-live.ts')

  check('the shared go-live check calls the SSOT documents predicate',
    /import\s*\{[^}]*vendorDocsComplete[^}]*\}\s*from\s*'\.\/vendor-documents'/.test(goLiveSrc) &&
    /!vendorDocsComplete\(vendor\)/.test(goLiveSrc))
  check('the shared go-live select loads all three path columns',
    ['foodHandlerPermitPath', 'insurancePath', 'businessLicensePath']
      .every(c => new RegExp(`${c}:\\s*true`).test(goLiveSrc)))

  check('organizer route calls the shared go-live check', /vendorGoLiveRefusal\(db,/.test(organizerSrc))
  check('organizer gate covers EVERY move into ACTIVE (not only PENDING → ACTIVE)',
    /if \(statusChanging && body\.status === VendorStatus\.ACTIVE\) \{\s*\n\s*const refusal = await vendorGoLiveRefusal/.test(organizerSrc))
  check('organizer refusal is 409 with the check\'s own code', /apiError\(refusal\.message, 409, refusal\.code/.test(organizerSrc))
  check('organizer gate sits BEFORE the write',
    orderedBefore(organizerSrc, 'vendorGoLiveRefusal(db,', 'db.vendor.update'))
  check('organizer select uses the shared go-live columns', /\.\.\.GO_LIVE_VENDOR_SELECT/.test(organizerSrc))

  check('admin approve route runs the shared decision (decideVendor)', /await decideVendor\(id, 'approve'/.test(adminSrc))
  check('decideVendor calls the SAME go-live check (one rule, two doors)',
    /vendorGoLiveRefusal\(db,[\s\S]{0,120}approving: true/.test(approvalsSrc))
  check('decideVendor refusal is 409 with the check\'s code', /409, refusal\.code/.test(approvalsSrc))
  check('decideVendor gate sits BEFORE the write',
    orderedBefore(approvalsSrc, 'vendorGoLiveRefusal(db,', 'tx.vendor.updateMany'))

  // The wizard must never label an in-memory File as uploaded — the exact defect that
  // got the previous document step deleted.
  const wizardSrc = src('app/become-vendor/VendorOnboarding.tsx')
  check('wizard labels held files "Selected", never "Uploaded"',
    wizardSrc.includes('· Selected') && !/·\s*Uploaded/.test(wizardSrc))
  check('wizard uploads BEFORE advancing to the success step',
    orderedBefore(wizardSrc, 'await uploadOne(', 'setStep(5)'))

  const suffix = skipped ? `, ${skipped} section skipped (no test DB)` : ''
  console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed${suffix}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
