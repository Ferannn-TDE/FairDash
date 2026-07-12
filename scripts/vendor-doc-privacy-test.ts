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
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import {
  VENDOR_DOC_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  assertPrivateBucket,
  signVendorDocumentUrl,
  uploadVendorDocument,
  pathFromLegacyPublicUrl,
} from '../lib/vendor-document-storage'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
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
    const vendor = await prisma.vendor.findFirst({ select: { id: true, name: true } })
    if (!vendor) throw new Error('no vendor to test with')

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

    // ── [4] The 4 previously-EXPOSED documents: migrated, and now refused ──────
    console.log('\n[4] the 4 previously-exposed documents: migrated to paths, no longer publicly reachable')
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
    assert(migrated >= 4, `${migrated} documents carry a PATH (the ≥4 migrated rows)`)
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
