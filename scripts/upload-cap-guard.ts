/**
 * UPLOAD CAP GUARD — the 4 MB limit is real, everywhere, and cannot be re-declared.
 *
 * WHAT WENT WRONG. The cap existed in four places and agreed with itself in none: 10 MB in
 * lib/vendor-document-storage.ts, 10 MB in lib/runner-license-storage.ts, a bare literal in
 * the vendor settings page, a local MAX_BYTES in LicenseCard — and the string "Max 5MB" in the
 * menu page's JSX above an input that enforced nothing at all. Meanwhile the proof-of-delivery
 * photo, the one upload that goes DIRECT to Supabase, had no limit in the client, no limit in
 * the route, and no limit on the bucket. Four numbers, one of them fiction, and the one upload
 * nobody had capped was the one the app couldn't cap in code.
 *
 * So this guard checks three different KINDS of thing, because "the cap is enforced" is three
 * different claims:
 *   A. SOURCE   — every server receiver calls the shared validator, and the constant exists
 *                 in exactly one file (a fifth upload point cannot quietly bring its own).
 *   B. BEHAVIOUR— an over-cap POST is actually rejected, with FILE_TOO_LARGE, by the real
 *                 route code; and an under-cap POST actually succeeds.
 *   C. CONFIG   — the buckets carry file_size_limit. For the delivery-proof photo this is the
 *                 ONLY enforcement that exists: the bytes never touch our server, so no amount
 *                 of app code can stand in for a bucket setting. Same reasoning as
 *                 assertPrivateBucket() — the safe state must be ENFORCED, not remembered.
 *
 * [0] POSITIVE CONTROLS FIRST. This suite contains all three shapes that have produced false
 *     greens in this repo — a source scan that matches nothing, a "rejects" assertion that is
 *     really an auth failure, and a remote config read that skips when env is missing. Each is
 *     proven able to FAIL before any of its results are allowed to mean anything.
 *
 * Run: npx tsx scripts/upload-cap-guard.ts   (self-cleaning, prefix ucap-)
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { register } from 'node:module'
register('./_clerk-loader.mjs', import.meta.url)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_MB,
  FILE_TOO_LARGE,
  assertUploadSize,
  assertSafeImageUrl,
} from '../lib/upload-limits'

const prisma = testPrisma()

const PFX = 'ucap-'
const MAIL = '@ucap.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0, warn = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
function advisory(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { warn++; console.log(`  ⚠️  ${label} (advisory — UX only, not the boundary)`) }
}

function login(clerkId: string | null, publicMetadata?: object) {
  ;(globalThis as never as Record<string, unknown>).__MOCK_CLERK =
    clerkId ? { userId: clerkId, publicMetadata } : undefined
}

// ── Handlers under test: the REAL route code, with authentication mocked only ────────────
type IdHandler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
let docsPOST: IdHandler
let licensePOST: (req: NextRequest) => Promise<Response>
let signPOST: (req: Request) => Promise<Response>
let menuRequestPOST: (req: NextRequest) => Promise<Response>

async function loadHandlers() {
  docsPOST        = (await import('../app/api/vendors/[id]/documents/route')).POST as never
  licensePOST     = (await import('../app/api/runners/me/license/route')).POST as never
  signPOST        = (await import('../app/api/storage/upload/route')).POST as never
  menuRequestPOST = (await import('../app/api/menu-requests/route')).POST as never
}

// ── Source scanning ─────────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (e.endsWith('.ts') || e.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Guards scan CODE, not prose — a comment describing the bad shape must not fail the build. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** A route that RECEIVES bytes: it parses a body into files. */
const receivesBytes = (code: string) => /req(uest)?\.formData\(\)|req(uest)?\.arrayBuffer\(\)/.test(code)

/** Returns why a receiver is non-compliant, or null if it's fine. */
function offence(code: string): string | null {
  if (!/from\s+['"]@\/lib\/upload-limits['"]/.test(code)) return 'does not import @/lib/upload-limits'
  if (!/validateUpload\s*\(/.test(code)) return 'does not call validateUpload()'
  if (!/assertUploadSize\s*\(/.test(code)) return 'does not call assertUploadSize() before parsing the body'
  return null
}

/** The cap literal, in any spacing. Written from parts so this line is not itself a hit. */
const CAP_LITERAL = new RegExp(`${1024}\\s*\\*\\s*${1024}`)

async function main() {
  await loadHandlers()

  // ══ [0] POSITIVE CONTROLS — prove every probe below CAN fail ═══════════════════════════
  console.log('\n[0] POSITIVE CONTROLS — a probe that cannot fail is not a probe')

  const oversized = new ArrayBuffer(UPLOAD_MAX_BYTES + 1)
  assert(
    oversized.byteLength > UPLOAD_MAX_BYTES,
    `oversized fixture really measures ${oversized.byteLength} bytes > cap ${UPLOAD_MAX_BYTES} — "rejects" means something`,
  )

  const undersized = new ArrayBuffer(512 * 1024)
  assert(undersized.byteLength < UPLOAD_MAX_BYTES, 'under-cap fixture is genuinely under the cap')

  // The scanner, fed a synthetic route with the bad shape, must FLAG it.
  const BAD_ROUTE = `
    export async function POST(req: Request) {
      const form = await req.formData()
      const file = form.get('file')
      return Response.json({ ok: !!file })
    }`
  const GOOD_ROUTE = `
    import { ALLOWED_DOC_MIME, assertUploadSize, validateUpload } from '@/lib/upload-limits'
    export async function POST(req: Request) {
      assertUploadSize(req)
      const form = await req.formData()
      validateUpload(form.get('file'), { allowedMime: ALLOWED_DOC_MIME })
      return Response.json({ ok: true })
    }`
  assert(receivesBytes(BAD_ROUTE) && offence(BAD_ROUTE) !== null,
    `scanner FLAGS a synthetic uncapped receiver ("${offence(BAD_ROUTE)}") — it is not matching nothing`)
  assert(receivesBytes(GOOD_ROUTE) && offence(GOOD_ROUTE) === null,
    'scanner PASSES a synthetic compliant receiver — it is not flagging everything')

  // And the cap-literal scanner must be able to see a literal at all.
  assert(CAP_LITERAL.test('const x = 4 * 1024 * 1024'), 'cap-literal scanner detects a literal in a known-bad sample')

  // ══ [A] SOURCE — one rule, adopted everywhere, declared once ═══════════════════════════
  console.log('\n[A] SOURCE SCAN — every server receiver calls the shared validator')

  const apiFiles = walk('app/api')
  const receivers = apiFiles.filter(f => f.endsWith('route.ts') && receivesBytes(stripComments(readFileSync(f, 'utf8'))))
  assert(receivers.length >= 2,
    `found ${receivers.length} server upload receivers (≥2 expected — a glob matching zero files is the vacuous pass)`)
  for (const f of receivers) console.log(`       receiver: ${f}`)

  const offenders = receivers
    .map(f => ({ f, why: offence(stripComments(readFileSync(f, 'utf8'))) }))
    .filter(x => x.why !== null)
  for (const o of offenders) console.log(`       OFFENDER: ${o.f} — ${o.why}`)
  assert(offenders.length === 0, `every upload receiver adopts lib/upload-limits (${offenders.length} offenders)`)

  // Anti-drift: the cap is declared ONCE. A future upload point cannot bring its own number.
  const productFiles = [...walk('app'), ...walk('lib')]
  const declarers = productFiles.filter(f => CAP_LITERAL.test(stripComments(readFileSync(f, 'utf8'))))
  for (const f of declarers) console.log(`       declares a MB literal: ${f}`)
  assert(
    declarers.length === 1 && declarers[0] === join('lib', 'upload-limits.ts'),
    `the cap literal exists in exactly one file, lib/upload-limits.ts (found ${declarers.length})`,
  )

  // Advisory: the client pickers read the same module, so the message and the rule agree.
  const clientPickers = productFiles.filter(f => /type="file"/.test(readFileSync(f, 'utf8')))
  assert(clientPickers.length >= 4, `found ${clientPickers.length} client file pickers (≥4 expected)`)
  for (const f of clientPickers) {
    advisory(/from\s+['"]@\/lib\/upload-limits['"]/.test(readFileSync(f, 'utf8')),
      `client picker reads the shared cap: ${f}`)
  }

  // Unit-level: the EARLY check. Content-Length is a caller-supplied hint, so it is checked
  // first (to reject before the body is buffered) and trusted for nothing else.
  const hdr = (v: string | null) => ({ headers: { get: () => v } })
  let threw = false
  try { assertUploadSize(hdr(String(UPLOAD_MAX_BYTES * 4))) } catch { threw = true }
  assert(threw, 'assertUploadSize() rejects a declared Content-Length far over the cap (pre-buffer)')
  threw = false
  try { assertUploadSize(hdr(null)) } catch { threw = true }
  assert(!threw, 'assertUploadSize() does NOT reject a request with no Content-Length (chunked) — the exact check still runs after parse')
  threw = false
  try { assertUploadSize(hdr(String(UPLOAD_MAX_BYTES))) } catch { threw = true }
  assert(!threw, 'assertUploadSize() allows an exactly-at-cap body (multipart framing allowance)')

  // Unit-level: the JSON door. imageUrl is a link, not a payload.
  const rejects = (v: unknown) => { try { assertSafeImageUrl(v); return false } catch { return true } }
  assert(rejects(`data:image/png;base64,${'A'.repeat(50)}`), 'assertSafeImageUrl() rejects a data: URI (the no-file-upload cap bypass)')
  assert(rejects('blob:http://localhost/9f2c'), 'assertSafeImageUrl() rejects a blob: URL (dead outside the tab that made it)')
  assert(rejects('x'.repeat(5000)), 'assertSafeImageUrl() rejects an over-long string')
  assert(!rejects('https://example.supabase.co/storage/v1/object/sign/x.png'), 'assertSafeImageUrl() ACCEPTS a normal https link (not reject-everything)')
  assert(!rejects(''), 'assertSafeImageUrl() accepts an empty value (the field is optional)')

  // ══ [B] BEHAVIOUR — the real routes actually reject ════════════════════════════════════
  console.log('\n[B] BEHAVIOUR — over-cap POSTs are rejected by the REAL route code')

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
  const vendorUser = await prisma.user.create({
    data: { clerkId: `${PFX}vu-${rand()}`, email: `${PFX}vu-${rand()}${MAIL}`, name: 'Booth Owner', role: 'vendor' },
  })
  await prisma.vendorMember.create({
    data: { vendorId: vendor.id, userId: vendorUser.id, role: 'owner', approvalStatus: 'APPROVED' },
  })
  const runnerUser = await prisma.user.create({
    data: { clerkId: `${PFX}ru-${rand()}`, email: `${PFX}ru-${rand()}${MAIL}`, name: 'Runner', role: 'runner' },
  })
  await prisma.runner.create({
    data: { userId: runnerUser.id, eventId: event.id, approvalStatus: 'APPROVED' },
  })

  const pdf = (bytes: ArrayBuffer) => new File([bytes], 'doc.pdf', { type: 'application/pdf' })
  const docsReq = (fd: FormData) =>
    new NextRequest(`http://localhost/api/vendors/${vendor.id}/documents`, { method: 'POST', body: fd })
  const ctx = { params: Promise.resolve({ id: vendor.id }) }
  const codeOf = async (res: Response) => ((await res.json()) as { error?: { code?: string } }).error?.code

  // ⛔ THE TRAP, MADE EXPLICIT. An unauthenticated caller gets 401 — which is NOT a size
  // rejection. A probe asserting merely "not 2xx" would score this as a pass and would keep
  // scoring it as a pass with the cap deleted. That is why every assertion below reads the
  // ERROR CODE, not the status class.
  login(null)
  const anonFd = new FormData()
  anonFd.append('docType', 'insurance')
  anonFd.append('file', pdf(oversized))
  const anon = await docsPOST(docsReq(anonFd), ctx)
  const anonCode = await codeOf(anon)
  assert(anonCode !== FILE_TOO_LARGE,
    `anonymous over-cap POST → ${anon.status} ${anonCode} — NOT ${FILE_TOO_LARGE}; auth runs first, so "rejected" alone proves nothing`)

  // Vendor documents — over cap
  login(vendorUser.clerkId)
  const bigFd = new FormData()
  bigFd.append('docType', 'insurance')
  bigFd.append('file', pdf(oversized))
  const bigRes = await docsPOST(docsReq(bigFd), ctx)
  assert(await codeOf(bigRes) === FILE_TOO_LARGE, `vendor docs: ${UPLOAD_MAX_MB}MB+1 → ${FILE_TOO_LARGE} (status ${bigRes.status})`)

  // Vendor documents — wrong type, still refused (the allowlist didn't get lost in the rework)
  login(vendorUser.clerkId)
  const badFd = new FormData()
  badFd.append('docType', 'insurance')
  badFd.append('file', new File([undersized], 'x.exe', { type: 'application/x-msdownload' }))
  assert(await codeOf(await docsPOST(docsReq(badFd), ctx)) === 'INVALID_MIME', 'vendor docs: disallowed MIME → INVALID_MIME')

  // ✅ POSITIVE CONTROL — an under-cap document SUCCEEDS. Without this the rejections above
  // could just mean "this route is broken".
  login(vendorUser.clerkId)
  const okFd = new FormData()
  okFd.append('docType', 'insurance')
  okFd.append('file', pdf(undersized))
  const okRes = await docsPOST(docsReq(okFd), ctx)
  assert(okRes.status === 200, `vendor docs POSITIVE CONTROL: 0.5MB PDF → 200 (got ${okRes.status}) — rejection is not vacuous`)
  const storedVendor = await prisma.vendor.findUnique({ where: { id: vendor.id }, select: { insurancePath: true } })
  assert(!!storedVendor?.insurancePath, 'vendor docs POSITIVE CONTROL: the path really persisted')
  if (storedVendor?.insurancePath) uploaded.push(['vendor-documents', storedVendor.insurancePath])

  // Runner licence — over cap, then the positive control
  login(runnerUser.clerkId)
  const licBig = new FormData()
  licBig.append('file', pdf(oversized))
  const licBigRes = await licensePOST(new NextRequest('http://localhost/api/runners/me/license', { method: 'POST', body: licBig }))
  assert(await codeOf(licBigRes) === FILE_TOO_LARGE, `runner licence: ${UPLOAD_MAX_MB}MB+1 → ${FILE_TOO_LARGE} (status ${licBigRes.status})`)

  login(runnerUser.clerkId)
  const licOk = new FormData()
  licOk.append('file', pdf(undersized))
  const licOkRes = await licensePOST(new NextRequest('http://localhost/api/runners/me/license', { method: 'POST', body: licOk }))
  assert(licOkRes.status === 200, `runner licence POSITIVE CONTROL: 0.5MB PDF → 200 (got ${licOkRes.status})`)
  const storedRunner = await prisma.runner.findUnique({ where: { userId: runnerUser.id }, select: { licensePath: true } })
  assert(!!storedRunner?.licensePath, 'runner licence POSITIVE CONTROL: the path really persisted')
  if (storedRunner?.licensePath) uploaded.push(['runner-documents', storedRunner.licensePath])

  // Presigned route — it cannot check SIZE (the bytes never arrive here), but it must check TYPE.
  login(runnerUser.clerkId)
  const signBad = await signPOST(new Request('http://localhost/api/storage/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'proof.exe', contentType: 'application/x-msdownload' }),
  }))
  assert(await codeOf(signBad) === 'INVALID_MIME', 'presigned upload: non-image contentType → INVALID_MIME (was previously unchecked)')

  login(runnerUser.clerkId)
  const signOk = await signPOST(new Request('http://localhost/api/storage/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'proof.jpg', contentType: 'image/jpeg' }),
  }))
  assert(signOk.status === 200, `presigned upload POSITIVE CONTROL: image/jpeg → 200 (got ${signOk.status})`)

  // The JSON door, at the route boundary — not just in the helper.
  login(vendorUser.clerkId)
  const dataUriRes = await menuRequestPOST(new NextRequest('http://localhost/api/menu-requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vendorId: vendor.id, type: 'ADD', name: `${PFX}item`, price: 5, category: 'Test',
      imageUrl: `data:image/png;base64,${'A'.repeat(100_000)}`,
    }),
  }))
  assert(await codeOf(dataUriRes) !== undefined && dataUriRes.status === 400,
    `menu request with a data: URI imageUrl → 400 (got ${dataUriRes.status}) — the no-file-upload bypass is closed at the route`)

  login(vendorUser.clerkId)
  const menuOkRes = await menuRequestPOST(new NextRequest('http://localhost/api/menu-requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vendorId: vendor.id, type: 'ADD', name: `${PFX}item2`, price: 5, category: 'Test', imageUrl: '',
    }),
  }))
  assert(menuOkRes.status === 201, `menu request POSITIVE CONTROL: no image → 201 (got ${menuOkRes.status})`)

  // ══ [C] CONFIG — the bucket limit, the only enforcement for the direct-upload path ══════
  console.log('\n[C] BUCKET CONFIG — the only size boundary the delivery-proof photo has')

  const SUPA = process.env.SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  // A config guard that SKIPS when it can't look is a config guard that doesn't exist.
  assert(!!SUPA && !!KEY, 'SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY present (a skip here would be a false green)')
  if (SUPA && KEY) {
    for (const bucket of ['delivery-proofs', 'vendor-documents', 'runner-documents']) {
      const res = await fetch(`${SUPA}/storage/v1/bucket/${bucket}`, {
        headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
      })
      const b = res.ok ? await res.json() as { file_size_limit?: number | null } : null
      assert(
        b?.file_size_limit === UPLOAD_MAX_BYTES,
        `bucket "${bucket}" file_size_limit = ${b?.file_size_limit ?? 'UNSET'} (must be ${UPLOAD_MAX_BYTES})`,
      )
    }
  }
}

/** Objects this run really uploaded, removed on the way out. */
const uploaded: [string, string][] = []

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vs.map(v => v.id) } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vs.map(v => v.id) } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.runner.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function teardown() {
  const SUPA = process.env.SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (SUPA && KEY) {
    for (const [bucket, path] of uploaded) {
      await fetch(`${SUPA}/storage/v1/object/${bucket}/${path}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
      }).catch(() => {})
    }
  }
  await cleanup()
}

main()
  .catch(err => { console.error('\n💥 suite threw:', err); fail++ })
  .finally(async () => {
    await teardown().catch(e => console.error('cleanup failed:', e))
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(70)}`)
    console.log(`${pass} passed, ${fail} failed${warn ? `, ${warn} advisory` : ''}`)
    process.exit(fail === 0 ? 0 : 1)
  })
