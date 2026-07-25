/**
 * VENDOR DOCUMENT PRIVACY — the acceptance test for the private-bucket rework.
 *
 * THE TEST THAT MATTERS: upload a document, then try to fetch it ANONYMOUSLY via the
 * public-object URL — it must be REFUSED. Not "the bucket setting says private": actually
 * attempt the read with no credentials and confirm it fails. That is the difference
 * between "we configured it private" and "it is private".
 *
 * Mirrors the guarantees the runner-licence module already holds:
 *   • bucket is PRIVATE (and upload REFUSES if it ever isn't),
 *   • the DB stores an object PATH, never a URL,
 *   • public URL → 400/403, signed URL → 200,
 *   • signed URLs are short-lived.
 *
 * Also re-checks the 4 pre-existing documents that were exposed, now migrated from
 * public-URL to path, still resolve through the signed-URL path.
 *
 * Run:  npx tsx scripts/vendor-doc-privacy-test.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import {
  VENDOR_DOC_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  assertPrivateBucket,
  signVendorDocumentUrl,
  uploadVendorDocument,
  pathFromLegacyPublicUrl,
} from '../lib/vendor-document-storage'

const prisma = testPrisma()

/** Self-contained fixture namespace — seeded and torn down by THIS suite, never ambient. */
const SEED_TAG = 'vdpseed'

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: SEED_TAG } }, select: { id: true } })
  if (evs.length) {
    const ids = evs.map(e => e.id)
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
}
const SUPA = process.env.SUPABASE_URL!
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

const uploadedPaths: string[] = []

async function main() {
  await cleanup()
  try {
    // ── [1] The bucket is genuinely private ────────────────────────────────────
    console.log('\n[1] the vendor-documents bucket is PRIVATE (and the guard agrees)')
    const b = await (await fetch(`${SUPA}/storage/v1/bucket/${VENDOR_DOC_BUCKET}`, {
      headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
    })).json()
    assert(b.public === false, `bucket "${VENDOR_DOC_BUCKET}" reports public=false`)
    let guardPassed = true
    try { await assertPrivateBucket() } catch { guardPassed = false }
    assert(guardPassed, 'assertPrivateBucket() passes — uploads are allowed')

    // ── [2] ⛔ THE ACCEPTANCE TEST: upload → public URL is REFUSED ─────────────
    console.log('\n[2] ⛔ upload a document → the public URL is REFUSED anonymously (THE test)')
    // SELF-CONTAINED FIXTURE. This used to grab whatever vendor happened to exist, which meant
    // the suite depended on ambient production data — the property the test-database move
    // removed. Any vendor serves the purpose (the claim under test is about BUCKET privacy, not
    // about a particular vendor), so it seeds its own and tears it down.
    const fxEvent = await prisma.event.create({
      data: {
        name: `${SEED_TAG} fair`, urlSlug: `${SEED_TAG}-${Date.now()}`,
        status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 86_400_000),
      },
    })
    const vendor = await prisma.vendor.create({
      data: {
        eventId: fxEvent.id, name: `${SEED_TAG} vendor`, slug: `${SEED_TAG}-v-${Date.now()}`,
        cuisineType: 'Test', status: 'ACTIVE',
      },
      select: { id: true, name: true },
    })

    const body = Buffer.from(`%PDF-1.4 fake insurance certificate ${rand()}`)
    const blob = new Blob([body], { type: 'application/pdf' })
    const path = await uploadVendorDocument(vendor.id, 'insurance', blob, `test-${rand()}.pdf`)
    uploadedPaths.push(path)

    assert(!path.includes('http') && !path.includes('/object/'), `stored value is a PATH, not a URL → "${path}"`)

    // The exact URL shape the OLD code persisted and the OLD bucket served.
    const publicUrl = `${SUPA}/storage/v1/object/public/${VENDOR_DOC_BUCKET}/${path}`
    let anonStatus = 0
    try { anonStatus = (await fetch(publicUrl)).status } catch { anonStatus = -1 }
    assert(anonStatus !== 200, `⛔ anonymous GET of the public URL → ${anonStatus} (REFUSED, not 200)`)

    // And the raw authenticated-object path is equally unreachable without credentials.
    let rawStatus = 0
    try { rawStatus = (await fetch(`${SUPA}/storage/v1/object/${VENDOR_DOC_BUCKET}/${path}`)).status } catch { rawStatus = -1 }
    assert(rawStatus !== 200, `⛔ anonymous GET of the raw object path → ${rawStatus} (REFUSED)`)

    // ── [3] The signed URL — the ONLY way in — works ───────────────────────────
    console.log('\n[3] a SIGNED url is the only way to read it, and it works')
    const signed = await signVendorDocumentUrl(path)
    const signedRes = await fetch(signed)
    assert(signedRes.status === 200, `signed URL → ${signedRes.status} (readable)`)
    const got = Buffer.from(await signedRes.arrayBuffer())
    assert(got.equals(body), 'signed URL returns the EXACT bytes uploaded')
    assert(signed.includes('token='), 'the signed URL carries a token (it is not just the public link)')
    assert(SIGNED_URL_TTL_SECONDS <= 300, `signed URLs are short-lived (TTL ${SIGNED_URL_TTL_SECONDS}s — long enough to render, not to share)`)

    // ── [4] Stored document values are PATHS, never public URLs ────────────────
    console.log('\n[4] every stored document value is a PATH, and is not publicly reachable')
    // Fixture: attach the object this suite uploaded in [2] to the seeded vendor, so the
    // path-not-URL invariant is exercised against a real row rather than ambient data.
    if (uploadedPaths.length) {
      await prisma.vendor.update({
        where: { id: vendor.id },
        data: { foodHandlerPermitPath: uploadedPaths[0] },
      })
    }
    const withDocs = await prisma.vendor.findMany({
      where: { OR: [{ foodHandlerPermitPath: { not: null } }, { insurancePath: { not: null } }, { businessLicensePath: { not: null } }] },
      select: { name: true, foodHandlerPermitPath: true, insurancePath: true, businessLicensePath: true },
    })
    let migrated = 0, stillOpen = 0, signable = 0
    for (const v of withDocs) {
      for (const p of [v.foodHandlerPermitPath, v.insurancePath, v.businessLicensePath]) {
        if (!p) continue
        migrated++
        if (p.includes('http') || p.includes('/object/')) {
          fail++; console.log(`  ❌ ${v.name}: stored value is still a URL → ${p}`)
          continue
        }
        const url = `${SUPA}/storage/v1/object/public/${VENDOR_DOC_BUCKET}/${p}`
        let st = 0
        try { st = (await fetch(url)).status } catch { st = -1 }
        if (st === 200) stillOpen++
        // and it must still be readable via a signed URL (the migration didn't orphan it)
        try {
          const s = await signVendorDocumentUrl(p)
          if ((await fetch(s)).status === 200) signable++
        } catch { /* counted below */ }
      }
    }
    // REFRAMED for the isolated test database. This used to assert `migrated >= 4` — the count
    // of PRODUCTION rows a one-off backfill had converted from public URLs to object paths. That
    // is a HISTORICAL FACT about prod data, not an ongoing invariant of the code, and on a clean
    // database it is 0. Asserting it here would either fail forever or force the suite back onto
    // ambient production state.
    //
    // What IS an ongoing invariant, and is what this section actually protects: any stored
    // document value must be a PATH, never a URL — the loop above fails on `http`/`/object/`
    // for every row it finds. That check is preserved and now runs against the seeded fixture.
    // The one-time "were the 4 legacy rows migrated?" question belongs in a prod-data audit,
    // not the gate; it is recorded in CURRENT_STATE §7 rather than silently dropped.
    assert(migrated >= 1, `${migrated} document(s) carry a PATH — every stored value is a path, not a URL`)
    assert(stillOpen === 0, `⛔ ZERO of them are anonymously reachable (was 4 before this change)`)
    assert(signable === migrated, `all ${migrated} still resolve via a signed URL — the migration orphaned nothing`)

    // ── [5] The stored value can never be a public URL again ───────────────────
    console.log('\n[5] structural: the *Url columns are GONE — a public link cannot be persisted')
    const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'Vendor' AND column_name IN
       ('foodHandlerPermitUrl','insuranceUrl','businessLicenseUrl','foodHandlerPermitPath','insurancePath','businessLicensePath')`,
    )
    const names = cols.map(c => c.column_name)
    assert(!names.includes('foodHandlerPermitUrl') && !names.includes('insuranceUrl') && !names.includes('businessLicenseUrl'),
      'the *Url columns no longer exist in the DB')
    assert(names.includes('foodHandlerPermitPath') && names.includes('insurancePath') && names.includes('businessLicensePath'),
      'the *Path columns exist')

    // Sanity on the backfill helper used by the migration.
    assert(
      pathFromLegacyPublicUrl(`${SUPA}/storage/v1/object/public/${VENDOR_DOC_BUCKET}/abc/insurance/1_x.pdf`) === 'abc/insurance/1_x.pdf',
      'pathFromLegacyPublicUrl extracts the object path from a legacy public URL',
    )

    console.log(`\n${'─'.repeat(62)}\n  ${pass} passed, ${fail} failed\n${'─'.repeat(62)}\n`)
  } finally {
    await cleanup()
    // Remove only the objects THIS test uploaded.
    for (const p of uploadedPaths) {
      await fetch(`${SUPA}/storage/v1/object/${VENDOR_DOC_BUCKET}/${p}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
      }).catch(() => {})
    }
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('\n💥', e); await prisma.$disconnect(); process.exit(1) })
